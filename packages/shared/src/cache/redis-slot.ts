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
 * fallback to an unprefixed key space. The ONE exception is `next build`
 * (NEXT_PHASE=phase-production-build) with no database env, e.g. CI: there
 * the factories return a no-cache client that rejects every command, which
 * is exactly the Redis-down path every caller already handles (before #151 a
 * build reached an unreachable localhost Redis and fell back the same way).
 * It never writes anywhere, and the runtime (next start, the scraper, every
 * script) never takes it: at runtime a missing database still throws.
 *
 * The ONLY deliberately cross-slot key space is BOX_WIDE_KEY_PREFIX ("box:"),
 * reached through getBoxWideRedisClient() (packages/shared/src/cache/
 * redis-client.ts). It exists for box-wide resources such as the extractor
 * lock (two slots' python extractors on one 2-vCPU box starved the site into
 * Cloudflare 522s, W-178), and no database name can derive it.
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

const NAMESPACED = Symbol.for('ipodhan.redisSlotNamespace');

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

/**
 * The deliberately shared key space for box-wide resources (see header). A
 * database-derived prefix is always `prod:`, `staging:` or `db-<name>:`, so it
 * can never collide with this one.
 */
export const BOX_WIDE_KEY_PREFIX = 'box:';

/** Next.js sets NEXT_PHASE=phase-production-build in `next build` and its workers. */
export function isNextProductionBuild(env: Env = process.env): boolean {
  return env.NEXT_PHASE === 'phase-production-build';
}

/**
 * What every client factory calls: the slot prefix, or `null` meaning "use the
 * build-time no-cache client". `null` is returned ONLY for a missing database
 * name during `next build`; any other failure (a DEPLOY_SLOT mismatch, an
 * unsafe name) and any failure at runtime still throws.
 */
export function resolveRedisKeyPrefixOrBuildNoCache(env: Env = process.env): string | null {
  try {
    return resolveRedisKeyPrefix(env);
  } catch (error) {
    if (isNextProductionBuild(env) && error instanceof RedisSlotError && /no database name/.test(error.message)) {
      return null;
    }
    throw error;
  }
}

const NO_CACHE_TAG = 'build-no-cache';
const NO_CACHE_MESSAGE =
  'build-time no-cache: `next build` has no database env, so there is no Redis slot namespace; ' +
  'the caller falls back to the database exactly as when Redis is down';

/**
 * A Redis stand-in for `next build` without a database env: every command
 * rejects (the Redis-down path), pipelines/multi reject on exec, event
 * registration is a no-op, and no socket is ever opened. Typed as Redis so
 * factories can return it unchanged.
 */
export function createBuildTimeNoCacheClient(): Redis {
  const reject = () => Promise.reject(new RedisSlotError(NO_CACHE_MESSAGE));
  const chain: Record<string, unknown> = {};
  const chainProxy: unknown = new Proxy(chain, {
    get: (_t, prop) => {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'exec') return reject;
      return () => chainProxy;
    },
  });
  const target: Record<string | symbol, unknown> = { [NAMESPACED]: NO_CACHE_TAG };
  const client: unknown = new Proxy(target, {
    get: (t, prop) => {
      if (prop === NAMESPACED) return NO_CACHE_TAG;
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      switch (prop) {
        case 'status':
          return 'end';
        case 'options':
          return { keyPrefix: '' };
        case 'on':
        case 'once':
        case 'off':
        case 'addListener':
        case 'removeListener':
        case 'removeAllListeners':
        case 'setMaxListeners':
          return () => client;
        case 'quit':
          return () => Promise.resolve('OK');
        case 'disconnect':
          return () => undefined;
        case 'duplicate':
          return () => createBuildTimeNoCacheClient();
        case 'pipeline':
        case 'multi':
          return () => chainProxy;
        default:
          return t[prop as string] ?? reject;
      }
    },
  });
  return client as Redis;
}


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

  // round-1 minor: ioredis duplicate() copies options (so the keyPrefix
  // survives) but not these instance patches. Re-apply them, and refuse a
  // keyPrefix override: a duplicate must stay in its parent's key space
  // (the one cross-slot space goes through getBoxWideRedisClient()).
  if (typeof client.duplicate === 'function') {
    const originalDuplicate = client.duplicate.bind(client) as (override?: Record<string, unknown>) => T;
    (client as unknown as { duplicate: (override?: Record<string, unknown>) => T }).duplicate = (
      override?: Record<string, unknown>
    ) => {
      if (override && 'keyPrefix' in override && override.keyPrefix !== prefix) {
        throw new RedisSlotError(
          `duplicate() may not change the keyPrefix (${prefix} -> ${String(override.keyPrefix)}); ` +
            'a duplicate stays in its parent key space'
        );
      }
      return applyRedisSlotNamespace(originalDuplicate(override), prefix);
    };
  }

  tagged[NAMESPACED] = prefix;
  return client;
}

/** The prefix a client was namespaced with, or undefined (used by the factory-coverage test). */
export function redisSlotNamespaceOf(client: unknown): string | undefined {
  if (!client || typeof client !== 'object') return undefined;
  return (client as Record<symbol, string>)[NAMESPACED];
}
