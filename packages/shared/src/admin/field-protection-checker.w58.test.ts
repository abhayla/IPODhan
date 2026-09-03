/**
 * W-58 — protection writes must invalidate the Redis protection cache.
 *
 * `FieldProtectionService.isFieldProtected` caches per-field status for
 * `PROTECTION_CACHE_TTL` (1h). Any write that toggles protection MUST
 * invalidate that cache — otherwise a scraper run within the TTL keeps
 * reading a stale `isProtected:false` and overwrites the admin's correction.
 *
 * These tests exercise the shared `FieldProtectionService` directly (the
 * canonical read+write path) rather than the Next.js route handlers, so they
 * stay fast/unit and framework-free.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldProtectionService } from './field-protection-checker';

function makeMockRedis(existingKeys: string[] = []) {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    setex: vi.fn(async (key: string, _ttl: number, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      for (const k of keys) store.delete(k);
      return keys.length;
    }),
    keys: vi.fn(async (pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return existingKeys.filter((k) => k.startsWith(prefix));
    }),
    __store: store,
  };
}

function makeMockDb(row: { isProtected: boolean; autoProtected?: boolean } | null) {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(row ? [row] : []),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  } as any;
}

describe('W-58: protection write invalidates the field-protection Redis cache', () => {
  let redis: ReturnType<typeof makeMockRedis>;

  beforeEach(() => {
    redis = makeMockRedis();
  });

  it('a protection write followed immediately by isFieldProtected returns the fresh value with a warm cache', async () => {
    // Warm the cache with a STALE "not protected" entry, as if a scraper
    // checked this field a moment ago (before the admin protected it).
    const db = makeMockDb({ isProtected: false });
    const service = new FieldProtectionService(db, redis as any);

    const stale = await service.isFieldProtected('ipo-1', 'financial_data', 'ronw');
    expect(stale.isProtected).toBe(false);
    expect(redis.setex).toHaveBeenCalledWith(
      'protection:field:ipo-1:financial_data:ronw',
      3600,
      expect.any(String)
    );

    // Admin now protects the field — flip the DB row AND invalidate the cache.
    db.limit.mockResolvedValue([{ isProtected: true, autoProtected: false }]);
    await service.invalidateProtectionCache('ipo-1', 'financial_data', 'ronw');

    // A read immediately after, still within the 1h TTL, MUST see the fresh
    // value — not the stale cached entry (this is the bug: without the
    // invalidation call the cache HIT would still return isProtected:false).
    const fresh = await service.isFieldProtected('ipo-1', 'financial_data', 'ronw');
    expect(fresh.isProtected).toBe(true);
    expect(redis.get).toHaveBeenLastCalledWith('protection:field:ipo-1:financial_data:ronw');
  });

  it('invalidateProtectionCacheForIpo clears every field key for that IPO (bulk write)', async () => {
    redis = makeMockRedis([
      'protection:field:ipo-1:financial_data:ronw',
      'protection:field:ipo-1:financial_data:issueSize',
      'protection:field:ipo-1:ipos:lotSize',
    ]);
    const db = makeMockDb(null);
    const service = new FieldProtectionService(db, redis as any);

    await service.invalidateProtectionCacheForIpo('ipo-1');

    expect(redis.keys).toHaveBeenCalledWith('protection:field:ipo-1:*');
    expect(redis.del).toHaveBeenCalledWith(
      'protection:ipo_locked:ipo-1',
      'protection:field:ipo-1:financial_data:ronw',
      'protection:field:ipo-1:financial_data:issueSize',
      'protection:field:ipo-1:ipos:lotSize'
    );
  });

  it('invalidateProtectionCacheForIpo does NOT touch a different IPO\'s cache keys', async () => {
    redis = makeMockRedis([
      'protection:field:ipo-1:financial_data:ronw',
      'protection:field:ipo-2:financial_data:ronw',
    ]);
    const db = makeMockDb(null);
    const service = new FieldProtectionService(db, redis as any);

    await service.invalidateProtectionCacheForIpo('ipo-1');

    expect(redis.keys).toHaveBeenCalledWith('protection:field:ipo-1:*');
    const deletedKeys = redis.del.mock.calls[0];
    expect(deletedKeys).not.toContain('protection:field:ipo-2:financial_data:ronw');
    expect(deletedKeys).toContain('protection:field:ipo-1:financial_data:ronw');
  });
});
