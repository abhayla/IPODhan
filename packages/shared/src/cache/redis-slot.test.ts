/**
 * #151: every Redis key is namespaced by the slot derived from the connected
 * database. These tests drive the REAL getRedisClient / safeDelPattern of
 * this package against one shared in-memory backend (the one Redis prod and
 * staging share on the VPS).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { InMemoryRedisBackend } from '../testing/in-memory-redis-backend';
import {
  BOX_WIDE_KEY_PREFIX,
  applyRedisSlotNamespace,
  createBuildTimeNoCacheClient,
  redisSlotNamespaceOf,
  resolveRedisKeyPrefix,
  resolveRedisKeyPrefixOrBuildNoCache,
} from './redis-slot';
import IORedis from 'ioredis';

const PROD_URL = 'postgresql://ipodhan_app@db:5432/ipodhan';
const STAGING_URL = 'postgresql://ipodhan_app@db:5432/ipodhan_staging';

const fixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../scripts/tests/fixtures/redis-slot-cases.json'), 'utf8')
) as { cases: Array<{ env: Record<string, string>; prefix?: string; error?: string }> };

describe('resolveRedisKeyPrefix (shared fixture with the bash twin)', () => {
  for (const c of fixture.cases) {
    it(`${JSON.stringify(c.env)} -> ${c.prefix ?? `throws "${c.error}"`}`, () => {
      if (c.prefix) expect(resolveRedisKeyPrefix(c.env)).toBe(c.prefix);
      else expect(() => resolveRedisKeyPrefix(c.env)).toThrow(c.error);
    });
  }
});

type ClientModule = typeof import('./redis-client');

const saved = { ...process.env };
const opened: Redis[] = [];

async function clientFor(databaseUrl: string, backend: InMemoryRedisBackend): Promise<{ mod: ClientModule; client: Redis }> {
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  delete process.env.DATABASE_HOST;
  delete process.env.DEPLOY_SLOT;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  const mod = await import('./redis-client');
  const client = backend.attach(mod.getRedisClient());
  opened.push(client);
  return { mod, client };
}

describe('real shared getRedisClient: prod and staging on ONE Redis', () => {
  let backend: InMemoryRedisBackend;

  beforeEach(() => {
    backend = new InMemoryRedisBackend();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const c of opened.splice(0)) c.disconnect();
    process.env = { ...saved };
    vi.restoreAllMocks();
  });

  it('a key written by staging is not visible to prod, and the reverse', async () => {
    const { client: staging } = await clientFor(STAGING_URL, backend);
    const { client: prod } = await clientFor(PROD_URL, backend);

    await staging.set('listing:42', 'staging-row');
    expect(await prod.get('listing:42')).toBeNull();

    await prod.set('listing:42', 'prod-row');
    expect(await staging.get('listing:42')).toBe('staging-row');
    expect(await prod.get('listing:42')).toBe('prod-row');

    expect([...backend.store.keys()].sort()).toEqual(['prod:listing:42', 'staging:listing:42']);
  });

  it('KEYS-pattern invalidation (safeDelPattern) deletes only its own slot, and finds the prefixed keys', async () => {
    const { client: staging } = await clientFor(STAGING_URL, backend);
    const { mod: prodMod, client: prod } = await clientFor(PROD_URL, backend);

    await staging.set('ipo:list:a', '1');
    await prod.set('ipo:list:a', '1');
    await prod.set('ipo:list:b', '1');
    await prod.set('gmp:x', '1');

    expect((await prod.keys('ipo:list:*')).sort()).toEqual(['ipo:list:a', 'ipo:list:b']);

    await prodMod.safeDelPattern('ipo:list:*');

    expect(await prod.get('ipo:list:a')).toBeNull();
    expect(await prod.get('ipo:list:b')).toBeNull();
    expect(await prod.get('gmp:x')).toBe('1');
    expect(await staging.get('ipo:list:a')).toBe('1');
  });

  it('a bare keys("*") (admin clear-all) never reaches the other slot', async () => {
    const { client: staging } = await clientFor(STAGING_URL, backend);
    const { client: prod } = await clientFor(PROD_URL, backend);
    await staging.set('ipo:1', 's');
    await prod.set('ipo:1', 'p');

    const all = await staging.keys('*');
    expect(all).toEqual(['ipo:1']);
    await staging.del(...all);

    expect(await prod.get('ipo:1')).toBe('p');
    expect(await staging.get('ipo:1')).toBeNull();
  });

  it('SCAN MATCH (scraper cache-invalidator loop) is scoped and its keys delete cleanly', async () => {
    const { client: staging } = await clientFor(STAGING_URL, backend);
    const { client: prod } = await clientFor(PROD_URL, backend);
    await staging.set('ipo:slug:x', 's');
    await prod.set('ipo:slug:x', 'p');

    const [, found] = await prod.scan('0', 'MATCH', 'ipo:*', 'COUNT', 100);
    expect(found).toEqual(['ipo:slug:x']);
    await prod.del(...found);
    expect(await prod.get('ipo:slug:x')).toBeNull();
    expect(await staging.get('ipo:slug:x')).toBe('s');

    const [, noMatch] = await staging.scan('0');
    expect(noMatch).toEqual(['ipo:slug:x']);
  });

  it('fails closed: no database name -> getRedisClient throws, never an unprefixed client', async () => {
    vi.resetModules();
    delete process.env.DATABASE_URL;
    delete process.env.DATABASE_HOST;
    const mod = await import('./redis-client');
    expect(() => mod.getRedisClient()).toThrow(/no database name/);
  });
});


describe('build-time no-cache path (round-1 finding 1: next build has no database env)', () => {
  const BUILD = { NEXT_PHASE: 'phase-production-build' };

  it('no database at BUILD time -> no-cache (null), never a throw and never an unprefixed prefix', () => {
    expect(resolveRedisKeyPrefixOrBuildNoCache(BUILD)).toBeNull();
  });

  it('no database at RUNTIME (next start sets phase-production-server; scraper sets none) -> still throws', () => {
    expect(() => resolveRedisKeyPrefixOrBuildNoCache({ NEXT_PHASE: 'phase-production-server' })).toThrow(/no database name/);
    expect(() => resolveRedisKeyPrefixOrBuildNoCache({})).toThrow(/no database name/);
  });

  it('a database at build time still gets its slot (the VPS build has the env)', () => {
    expect(resolveRedisKeyPrefixOrBuildNoCache({ ...BUILD, DATABASE_URL: STAGING_URL })).toBe('staging:');
  });

  it('a DEPLOY_SLOT/database mismatch at build time is NOT turned into no-cache', () => {
    expect(() =>
      resolveRedisKeyPrefixOrBuildNoCache({ ...BUILD, DATABASE_URL: PROD_URL, DEPLOY_SLOT: 'staging' })
    ).toThrow(/disagrees/);
  });

  it('the no-cache client rejects every command like Redis-down, is not thenable, and opens no socket', async () => {
    const client = createBuildTimeNoCacheClient();
    await expect(client.get('ipo:list:x')).rejects.toThrow(/build-time no-cache/);
    await expect(client.setex('k', 1, 'v')).rejects.toThrow(/build-time no-cache/);
    await expect(client.keys('*')).rejects.toThrow(/build-time no-cache/);
    await expect(client.pipeline().get('a').exec()).rejects.toThrow(/build-time no-cache/);
    expect((client as unknown as { then?: unknown }).then).toBeUndefined();
    expect(client.on('error', () => {})).toBe(client);
    expect(client.status).toBe('end');
    await expect(client.quit()).resolves.toBe('OK');
    expect(redisSlotNamespaceOf(client)).toBe('build-no-cache');
  });
});

describe('duplicate() keeps the slot namespace (round-1 minor)', () => {
  const opened2: IORedis[] = [];
  afterEach(() => {
    for (const c of opened2.splice(0)) c.disconnect();
  });

  it('a duplicate carries the prefix AND the KEYS/SCAN patch', async () => {
    const backend = new InMemoryRedisBackend();
    const base = applyRedisSlotNamespace(
      new IORedis('redis://127.0.0.1:1', { keyPrefix: 'prod:', lazyConnect: true }),
      'prod:'
    );
    const dup = backend.attach(base.duplicate());
    opened2.push(base, dup);
    expect(dup.options.keyPrefix).toBe('prod:');
    expect(redisSlotNamespaceOf(dup)).toBe('prod:');
    backend.store.set('staging:ipo:1', { value: 's' });
    await dup.set('ipo:1', 'p');
    expect(await dup.keys('ipo:*')).toEqual(['ipo:1']);
  });

  it('a duplicate may not override the keyPrefix (that would be an unprefixed or foreign key space)', () => {
    const base = applyRedisSlotNamespace(
      new IORedis('redis://127.0.0.1:1', { keyPrefix: 'prod:', lazyConnect: true }),
      'prod:'
    );
    opened2.push(base);
    expect(() => base.duplicate({ keyPrefix: '' })).toThrow(/keyPrefix/);
    expect(() => base.duplicate({ keyPrefix: 'staging:' })).toThrow(/keyPrefix/);
  });
});

describe('the box-wide key space is explicit and never a slot', () => {
  it('BOX_WIDE_KEY_PREFIX is "box:", which no database name can produce', () => {
    expect(BOX_WIDE_KEY_PREFIX).toBe('box:');
    for (const c of fixture.cases) if (c.prefix) expect(c.prefix).not.toBe(BOX_WIDE_KEY_PREFIX);
  });
});
