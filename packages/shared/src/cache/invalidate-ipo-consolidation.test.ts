/**
 * #551: `packages/shared/src/cache/invalidate.ts` was a byte-similar mirror of
 * the web copy's `invalidateIPOCache`, wrong the same way — it deleted
 * `ipo:detail:<slug>` and `ipo:subscription:<slug>`, neither of which
 * `IPORepository.findBySlug()`/`findById()` (`packages/shared/src/repositories/
 * ipo-repository.ts`) actually cache under (`getIPOBySlugKey` ->
 * `ipo:slug:<slug>`, `getIPOByIdKey` -> `ipo:id:<id>`). It had zero callers
 * anywhere in this package, web or scraper (measured: no importer of
 * `cache/invalidate` outside this file's own test, and the package's public
 * export map does not re-export it either) — a dead helper that would have
 * been wrong the moment something finally called it.
 *
 * Now delegates to the canonical `ipo-cache-invalidation.ts`, which derives
 * its key set from the same `cache-keys.ts` generators the repository reads
 * from. This test is the detection: it fails if the wrapper ever drifts back
 * to a hand-rolled, reader-mismatched key set.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

function fakeRedis(initial: string[]) {
  const store = new Set(initial);
  return {
    store,
    del: vi.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    }),
    keys: vi.fn(async (pattern: string) => {
      const star = pattern.indexOf('*');
      if (star === -1) return [...store].filter((k) => k === pattern);
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      return [...store].filter(
        (k) => k.length >= prefix.length + suffix.length && k.startsWith(prefix) && k.endsWith(suffix)
      );
    }),
  };
}

let redisInstance = fakeRedis([]);

vi.mock('./redis-client', () => ({
  safeDel: vi.fn().mockResolvedValue(undefined),
  safeDelPattern: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn(() => redisInstance),
}));

import { invalidateIPOCache } from './invalidate';
import { invalidateIPOCaches } from './ipo-cache-invalidation';
import { getIPOBySlugKey, getIPOByIdKey, getIPOListKey, getIPOInvalidationKeys } from './cache-keys';

describe('getIPOInvalidationKeys (packages/shared) derives from the readers own generators', () => {
  it('includes the exact keys IPORepository.findBySlug()/findById() cache under', () => {
    const keys = getIPOInvalidationKeys('ipo-1', 'acme-ltd');
    expect(keys).toContain(getIPOBySlugKey('acme-ltd'));
    expect(keys).toContain(getIPOByIdKey('ipo-1'));
  });

  it('never includes the wrong slug-keyed subscription key the old invalidate.ts deleted', () => {
    const keys = getIPOInvalidationKeys('ipo-1', 'acme-ltd');
    expect(keys).not.toContain('ipo:subscription:acme-ltd');
  });
});

describe('invalidateIPOCache (packages/shared/src/cache/invalidate.ts) — post-#551', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the real detail-lookup key readers populate (ipo:slug:<slug>)', async () => {
    redisInstance = fakeRedis([getIPOBySlugKey('acme-ltd'), getIPOByIdKey('ipo-1')]);
    await invalidateIPOCache('acme-ltd', 'ipo-1');

    expect(redisInstance.store.has(getIPOBySlugKey('acme-ltd'))).toBe(false);
    expect(redisInstance.store.has(getIPOByIdKey('ipo-1'))).toBe(false);
  });

  it('clears every ipo:list:<hash> key', async () => {
    const listKey = getIPOListKey({ segment: ['MAINBOARD'] });
    redisInstance = fakeRedis([listKey]);
    await invalidateIPOCache('acme-ltd', 'ipo-1');

    expect(redisInstance.store.has(listKey)).toBe(false);
  });

  it('does not touch keys outside the IPO namespace', async () => {
    redisInstance = fakeRedis(['unrelated:key', 'documents:ipo-1']);
    await invalidateIPOCache('acme-ltd', 'ipo-1');

    expect(redisInstance.store.has('unrelated:key')).toBe(true);
    expect(redisInstance.store.has('documents:ipo-1')).toBe(true);
  });

  it('routes through the ONE canonical module — same keys deleted as invalidateIPOCaches', async () => {
    const seed = [getIPOBySlugKey('acme-ltd'), getIPOByIdKey('ipo-1'), getIPOListKey({ x: 1 })];

    const viaWrapper = fakeRedis(seed);
    redisInstance = viaWrapper;
    await invalidateIPOCache('acme-ltd', 'ipo-1');

    const viaCanonical = fakeRedis(seed);
    await invalidateIPOCaches(viaCanonical, 'ipo-1', 'acme-ltd');

    expect([...viaWrapper.store].sort()).toEqual([...viaCanonical.store].sort());
  });

  it('is not fatal when redis throws', async () => {
    redisInstance = {
      store: new Set(),
      del: vi.fn(async () => { throw new Error('down'); }),
      keys: vi.fn(async () => { throw new Error('down'); }),
    } as unknown as ReturnType<typeof fakeRedis>;
    await expect(invalidateIPOCache('acme-ltd', 'ipo-1')).resolves.not.toThrow();
  });
});
