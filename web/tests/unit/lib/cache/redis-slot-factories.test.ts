import { afterEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { redisSlotNamespaceOf } from '@ipodhan/shared/cache/redis-slot';

/**
 * #151 detection: EVERY exported Redis client factory in the repo must carry
 * the slot namespace (ioredis keyPrefix + the KEYS/SCAN patch). A fifth
 * factory, or one of these four losing the prefix, fails here. The CI grep
 * scripts/ci/check-redis-client-factories.mjs refuses a `new Redis(` outside
 * these four files.
 */
const FACTORIES: Array<[string, () => Promise<{ getRedisClient: () => Redis }>]> = [
  ['web/lib/cache/redis-client.ts', () => import('../../../../lib/cache/redis-client')],
  ['web/lib/redis-client.ts', () => import('../../../../lib/redis-client')],
  ['packages/shared/src/cache/redis-client.ts', () => import('../../../../../packages/shared/src/cache/redis-client')],
  ['packages/shared/src/redis-client.ts', () => import('../../../../../packages/shared/src/redis-client')],
];

const saved = { ...process.env };
const opened: Redis[] = [];

afterEach(() => {
  for (const c of opened.splice(0)) c.disconnect();
  process.env = { ...saved };
  vi.restoreAllMocks();
});

function slotEnv(databaseUrl: string | undefined): void {
  vi.resetModules();
  if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
  else delete process.env.DATABASE_URL;
  delete process.env.DATABASE_HOST;
  delete process.env.DEPLOY_SLOT;
  delete process.env.NEXT_PHASE;
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('every Redis client factory is slot-namespaced (#151)', () => {
  for (const [file, load] of FACTORIES) {
    it(`${file}: staging database -> keyPrefix "staging:" and KEYS/SCAN patched`, async () => {
      slotEnv('postgresql://u@db:5432/ipodhan_staging');
      const client = (await load()).getRedisClient();
      opened.push(client);
      expect(client.options.keyPrefix).toBe('staging:');
      expect(redisSlotNamespaceOf(client)).toBe('staging:');
    });

    it(`${file}: prod database -> keyPrefix "prod:"`, async () => {
      slotEnv('postgresql://u@db:5432/ipodhan');
      const client = (await load()).getRedisClient();
      opened.push(client);
      expect(client.options.keyPrefix).toBe('prod:');
    });

    it(`${file}: no database -> throws instead of an unprefixed client`, async () => {
      slotEnv(undefined);
      const mod = await load();
      expect(() => mod.getRedisClient()).toThrow(/no database name/);
    });

    // Round-1 finding 1: CI's `next build` (job 108374259774) has no database
    // env; /sitemap.xml's prerender called getRedisClient() outside a try and
    // the build died. At BUILD time only, the factory hands back the no-cache
    // client (every command rejects = the Redis-down path callers handle).
    it(`${file}: no database during next build -> no-cache client, not a throw`, async () => {
      slotEnv(undefined);
      process.env.NEXT_PHASE = 'phase-production-build';
      const client = (await load()).getRedisClient();
      expect(redisSlotNamespaceOf(client)).toBe('build-no-cache');
      await expect(client.get('ipo:list:x')).rejects.toThrow(/build-time no-cache/);
    });

    it(`${file}: no database at runtime (phase-production-server) -> still throws`, async () => {
      slotEnv(undefined);
      process.env.NEXT_PHASE = 'phase-production-server';
      const mod = await load();
      expect(() => mod.getRedisClient()).toThrow(/no database name/);
    });
  }
});
