/**
 * Redis slot namespace (#151).
 *
 * Prod and staging share ONE Redis (same host, port, password and db index),
 * so every key both slots write must carry the slot, or a staging write is
 * served on prod (measured: a staging listing-performance write was served by
 * https://ipodhan.com within the same minute). The VPS env files are not
 * changed; the slot is derived from what every slot already sets — the
 * database it connects to (`ipodhan` = prod, `ipodhan_staging` = staging).
 * A cache entry mirrors a database, so the database name is the right key.
 *
 * Precedence: the connected database name DECIDES the namespace. DEPLOY_SLOT,
 * where a process has it, never overrides it; it is only cross-checked, and a
 * disagreement throws (a prod-labelled process reading the staging database is
 * a misconfiguration, not something to paper over).
 *
 * Fail closed: no derivable database name -> throw. There is no silent
 * fallback to an unprefixed key space.
 *
 * The shell twin of this derivation is scripts/lib/redis-slot-prefix.sh; both
 * are pinned to scripts/tests/fixtures/redis-slot-cases.json.
 */

import type Redis from 'ioredis';

const KNOWN_SLOT_BY_DATABASE: Record<string, string> = {
  ipodhan: 'prod',
  ipodhan_staging: 'staging',
};

const SAFE_DATABASE_NAME = /^[A-Za-z0-9_-]+$/;

type Env = Record<string, string | undefined>;

export class RedisSlotError extends Error {
  constructor(message: string) {
    super(`[redis-slot] ${message}`);
    this.name = 'RedisSlotError';
  }
}

function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new RedisSlotError('DATABASE_URL is not a parseable URL; cannot derive the Redis key namespace');
  }
  return decodeURIComponent(parsed.pathname.replace(/^\/+/, '')).split('/')[0] ?? '';
}

/**
 * The database name this process connects to, using the SAME branch the pg
 * pool uses (packages/shared/src/db/index.ts initPool): discrete
 * DATABASE_HOST + DATABASE_PASSWORD -> DATABASE_NAME, otherwise DATABASE_URL.
 */
export function resolveConnectedDatabaseName(env: Env = process.env): string {
  const name =
    env.DATABASE_HOST && env.DATABASE_PASSWORD
      ? (env.DATABASE_NAME ?? '')
      : env.DATABASE_URL
        ? databaseNameFromUrl(env.DATABASE_URL)
        : '';
  if (!name) {
    throw new RedisSlotError(
      'no database name (DATABASE_URL path, or DATABASE_NAME with DATABASE_HOST) is set; ' +
        'refusing to open Redis without a slot namespace, because an unprefixed key is shared by prod and staging'
    );
  }
  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new RedisSlotError(`database name "${name}" contains characters that are unsafe in a Redis key pattern`);
  }
  return name;
}

/** `prod` / `staging` for the two deployed databases, `db-<name>` for any other. */
export function resolveRedisSlot(env: Env = process.env): string {
  const database = resolveConnectedDatabaseName(env);
  const slot = KNOWN_SLOT_BY_DATABASE[database] ?? `db-${database}`;
  const deploySlot = env.DEPLOY_SLOT;
  if (deploySlot && deploySlot !== slot) {
    throw new RedisSlotError(
      `DEPLOY_SLOT=${deploySlot} disagrees with the connected database "${database}" (slot ${slot}); ` +
        'the database decides the Redis namespace and a mismatch means this process is misconfigured'
    );
  }
  return slot;
}

/** The ioredis `keyPrefix` every client must carry, e.g. `prod:`. */
export function resolveRedisKeyPrefix(env: Env = process.env): string {
  return `${resolveRedisSlot(env)}:`;
}

const NAMESPACED = Symbol.for('ipodhan.redisSlotNamespace');

/**
 * ioredis `keyPrefix` rewrites every KEY argument (GET/SET/DEL/EVAL KEYS...),
 * but NOT the pattern of KEYS / SCAN MATCH, and it returns keys WITH the
 * prefix. Left alone, `keys('ipo:list:*')` would match the other slot's (or
 * legacy unprefixed) keys and `del(...found)` would prefix them a second time.
 * This patches both on the instance so every existing caller keeps working:
 * the pattern is scoped to this slot and the returned keys are relative again.
 */
export function applyRedisSlotNamespace<T extends Redis>(client: T, prefix: string): T {
  const tagged = client as unknown as Record<symbol, string>;
  if (tagged[NAMESPACED]) return client;

  const strip = (key: unknown): unknown =>
    typeof key === 'string' && key.startsWith(prefix) ? key.slice(prefix.length) : key;

  const originalKeys = client.keys.bind(client) as (pattern: string) => Promise<string[]>;
  (client as unknown as { keys: (pattern: string) => Promise<string[]> }).keys = async (pattern: string) =>
    (await originalKeys(prefix + pattern)).map((k) => strip(k) as string);

  const originalScan = client.scan.bind(client) as (...args: unknown[]) => Promise<[string, string[]]>;
  (client as unknown as { scan: (...args: unknown[]) => Promise<[string, string[]]> }).scan = async (
    ...args: unknown[]
  ) => {
    const scanArgs = [...args];
    const matchAt = scanArgs.findIndex((a) => typeof a === 'string' && a.toUpperCase() === 'MATCH');
    if (matchAt >= 0 && matchAt + 1 < scanArgs.length) {
      scanArgs[matchAt + 1] = prefix + String(scanArgs[matchAt + 1]);
    } else {
      scanArgs.push('MATCH', `${prefix}*`);
    }
    const [cursor, keys] = await originalScan(...scanArgs);
    return [cursor, keys.map((k) => strip(k) as string)];
  };

  tagged[NAMESPACED] = prefix;
  return client;
}

/** The prefix a client was namespaced with, or undefined (used by the factory-coverage test). */
export function redisSlotNamespaceOf(client: unknown): string | undefined {
  if (!client || typeof client !== 'object') return undefined;
  return (client as Record<symbol, string>)[NAMESPACED];
}
