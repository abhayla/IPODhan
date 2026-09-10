/**
 * Clear every cache an IPO write touches — the exact-name keys AND the
 * pattern-matched ones.
 *
 * WHY THIS EXISTS (#538). Two admin write paths did this:
 *
 *   web/app/api/admin/ipos/route.ts:270        await redis.del('ipo:list:*');
 *   web/app/api/admin/ipos/[id]/route.ts:299   await redis.del('ipo:list:*');
 *
 * `DEL` matches key names LITERALLY. Those calls deleted a key named
 * `ipo:list:*`, which nothing creates, and returned 0. The real keys are
 * `ipo:list:<filterHash>` — one per filter combination, written by
 * `getIPOListKey` and read by `IPORepository.findAll()`. So every list cache
 * survived an admin edit: the detail page updated at once while every list,
 * calendar and listings page kept the old number for the full
 * `CacheTTL.IPO_LIST = 900` seconds, with no error and a `del` that "succeeded".
 *
 * The correct pieces already existed and had ZERO callers between them:
 * `getIPOInvalidationKeys` (the pattern list) and the `keys()`-then-`del()`
 * shape in `safeDelPattern`. This function is where they finally get used.
 * A helper with no caller is perfectly testable and perfectly useless, which is
 * the class item 20's wiring gate was built for — and could not see here,
 * because that gate only knows about security boundaries.
 */
import { getIPOInvalidationKeys } from './cache-keys';

/** Only what this needs; keeps the unit tests free of a real Redis. */
export interface CacheDeleter {
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Never throws. A cache that will not clear must not fail the admin write that
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
