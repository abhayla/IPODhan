/**
 * #551: three modules invalidated IPO caches, each clearing a different,
 * partly-wrong key set —
 *
 *   web/lib/cache/invalidate.ts            (invalidateIPOCache)  -> ipo:detail:<slug>, ipo:subscription:<slug>
 *   packages/shared/src/cache/invalidate.ts (same)                -> same wrong keys
 *   web/lib/cache/ipo-cache-invalidation.ts (invalidateIPOCaches) -> ipo:slug:, ipo:id: via getIPOInvalidationKeys
 *
 * `IPORepository.findBySlug()`/`findById()` cache under `getIPOBySlugKey`
 * (`ipo:slug:<slug>`) and `getIPOByIdKey` (`ipo:id:<id>`) — NOT
 * `ipo:detail:<slug>` and NOT `ipo:subscription:<slug>` (that key belongs to
 * `getLatestSubscriptionKey`, keyed by ipoId, not slug). This test is the
 * detection: it derives the expected key set from the SAME generators the
 * readers use, so `invalidateIPOCache` clearing the wrong keys fails it, and
 * it fails on any future drift too.
 *
 * Before this fix: `invalidateIPOCache('acme-ltd')` deleted `ipo:detail:
 * acme-ltd` and `ipo:subscription:acme-ltd` — neither of which
 * `IPORepository` reads back from — so the real cached row survived an
 * "invalidation" untouched. This is that regression, pinned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A fake Redis that behaves like the real one: DEL matches names literally. */
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

vi.mock('../../../../lib/cache/redis-client', () => ({
  safeDel: vi.fn().mockResolvedValue(undefined),
  safeDelPattern: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn(() => redisInstance),
}));

import { invalidateIPOCache } from '@/lib/cache/invalidate';
import { invalidateIPOCaches } from '@/lib/cache/ipo-cache-invalidation';
import {
  getIPOBySlugKey,
  getIPOByIdKey,
  getIPOListKey,
  getIPOInvalidationKeys,
} from '@/lib/cache/cache-keys';

describe('getIPOInvalidationKeys derives from the readers own key generators', () => {
  it('includes the exact keys IPORepository.findBySlug()/findById() actually cache under', () => {
    const keys = getIPOInvalidationKeys('ipo-1', 'acme-ltd');
    expect(keys).toContain(getIPOBySlugKey('acme-ltd'));
    expect(keys).toContain(getIPOByIdKey('ipo-1'));
  });

  it('never includes the wrong slug-keyed subscription key the old invalidate.ts deleted', () => {
    const keys = getIPOInvalidationKeys('ipo-1', 'acme-ltd');
    expect(keys).not.toContain('ipo:subscription:acme-ltd');
  });
});

describe('invalidateIPOCache (web/lib/cache/invalidate.ts) — post-#551', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the real detail-lookup key readers populate (ipo:slug:<slug>)', async () => {
    redisInstance = fakeRedis([getIPOBySlugKey('acme-ltd'), getIPOByIdKey('ipo-1')]);
    await invalidateIPOCache('acme-ltd', 'ipo-1');

    expect(redisInstance.store.has(getIPOBySlugKey('acme-ltd'))).toBe(false);
    expect(redisInstance.store.has(getIPOByIdKey('ipo-1'))).toBe(false);
  });

  it('clears every ipo:list:<hash> key, not a literal "ipo:list:*"', async () => {
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
    };
    await expect(invalidateIPOCache('acme-ltd', 'ipo-1')).resolves.not.toThrow();
  });
});
