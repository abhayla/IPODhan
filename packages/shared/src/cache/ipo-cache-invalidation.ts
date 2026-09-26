/**
 * Clear every cache an IPO write touches — the exact-name keys AND the
 * pattern-matched ones.
 *
 * #551: mirror of `web/lib/cache/ipo-cache-invalidation.ts`, byte-similar by
 * design (`.claude/rules/cache-key-and-ttl-ssot.md` requires the two parallel
 * cache-keys modules to stay in step). This is the canonical IPO-cache
 * invalidation implementation for packages/shared — `invalidateIPOCache` in
 * `./invalidate.ts` now delegates here instead of hand-rolling its own,
 * partly-wrong key set.
 */
import { getIPOInvalidationKeys } from './cache-keys';

/** Only what this needs; keeps the unit tests free of a real Redis. */
export interface CacheDeleter {
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Never throws. A cache that will not clear must not fail the write that
 * already succeeded — the row is saved; the worst case is the pre-existing
 * behaviour of a page serving a stale value until its TTL expires.
 */
export async function invalidateIPOCaches(
  redis: CacheDeleter,
  ipoId: string,
  slug?: string
): Promise<void> {
  const entries = getIPOInvalidationKeys(ipoId, slug);
  const exact = entries.filter((k) => !k.includes('*'));
  const patterns = entries.filter((k) => k.includes('*'));

  try {
    if (exact.length > 0) await redis.del(...exact);
  } catch {
    // fall through — a pattern may still clear
  }

  for (const pattern of patterns) {
    try {
      const matched = await redis.keys(pattern);
      if (matched.length > 0) await redis.del(...matched);
    } catch {
      // one unreachable pattern must not cost the others their clear
    }
  }
}
