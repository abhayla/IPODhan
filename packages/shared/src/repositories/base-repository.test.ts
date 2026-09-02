/**
 * W-15 — `getFromCache` unconditionally wrote EVERY dbQuery() result to
 * Redis, including `null`. For an identity lookup (findBySlug/findById) that
 * means a miss gets cached as the literal string "null" for the full TTL: an
 * insert that follows moments later stays invisible to readers until the
 * cache entry expires — a duplicate-row hazard.
 *
 * `cacheNullResult: false` (the option `ipo-repository.ts` now passes for
 * findBySlug/findById) must skip the cache SET when the DB result is
 * null/undefined, while every existing caller (which omits the option)
 * keeps caching null/undefined exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseRepository } from './base-repository';

// Minimal concrete subclass — BaseRepository is abstract and getFromCache is
// protected, so a thin subclass is the only way to exercise it directly.
class TestRepository extends BaseRepository {
  callGetFromCache<T>(
    cacheKey: string,
    dbQuery: () => Promise<T>,
    ttl?: number,
    options?: { cacheNullResult?: boolean }
  ) {
    return this.getFromCache(cacheKey, dbQuery, ttl, options);
  }
}

function makeMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
  };
}

describe('BaseRepository.getFromCache — negative-result caching (W-15)', () => {
  let redis: ReturnType<typeof makeMockRedis>;
  let repo: TestRepository;

  beforeEach(() => {
    redis = makeMockRedis();
    repo = new TestRepository({} as any, redis as any);
  });

  it('cacheNullResult: false — a miss does NOT write to Redis', async () => {
    const dbQuery = vi.fn().mockResolvedValue(null);

    const result = await repo.callGetFromCache('ipo:slug:missing-ipo', dbQuery, 900, {
      cacheNullResult: false,
    });

    expect(result).toBeNull();
    expect(dbQuery).toHaveBeenCalledTimes(1);
    expect(redis.setex).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('cacheNullResult: false — a HIT (non-null result) still gets cached normally', async () => {
    const row = { id: 'ipo-1', slug: 'acme-ltd' };
    const dbQuery = vi.fn().mockResolvedValue(row);

    const result = await repo.callGetFromCache('ipo:slug:acme-ltd', dbQuery, 900, {
      cacheNullResult: false,
    });

    expect(result).toEqual(row);
    // setCache is fire-and-forget (non-blocking); flush microtasks so the
    // Promise.race inside setCacheWithTimeout resolves before asserting.
    await new Promise((resolve) => setImmediate(resolve));
    expect(redis.setex).toHaveBeenCalledWith('ipo:slug:acme-ltd', 900, JSON.stringify(row));
  });

  it('default (no options) — a miss is STILL cached, preserving every other caller\'s existing behavior', async () => {
    const dbQuery = vi.fn().mockResolvedValue(null);

    const result = await repo.callGetFromCache('some:other:key', dbQuery, 300);

    expect(result).toBeNull();
    await new Promise((resolve) => setImmediate(resolve));
    expect(redis.setex).toHaveBeenCalledWith('some:other:key', 300, JSON.stringify(null));
  });

  it('a subsequent create() following a cacheNullResult:false miss is visible on the next read (no stale-null shadow)', async () => {
    // Simulates: findBySlug miss (nothing cached) -> row created -> findBySlug
    // again. Because nothing was cached on the miss, the second read is a
    // fresh cache MISS that queries the DB and finds the new row -- it is
    // never shadowed by a cached "null" from the first read.
    const dbQueryMiss = vi.fn().mockResolvedValue(null);
    await repo.callGetFromCache('ipo:slug:brand-new', dbQueryMiss, 900, {
      cacheNullResult: false,
    });
    expect(redis.setex).not.toHaveBeenCalled();

    // redis.get still returns null (nothing was ever written for this key)
    const created = { id: 'ipo-2', slug: 'brand-new' };
    const dbQueryHit = vi.fn().mockResolvedValue(created);
    const secondRead = await repo.callGetFromCache('ipo:slug:brand-new', dbQueryHit, 900, {
      cacheNullResult: false,
    });

    expect(dbQueryHit).toHaveBeenCalledTimes(1);
    expect(secondRead).toEqual(created);
  });
});
