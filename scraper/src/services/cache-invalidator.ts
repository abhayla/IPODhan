import type Redis from 'ioredis';
import logger from '../utils/logger.js';
import { getIPOInvalidationKeys } from '@ipodhan/shared/cache/cache-keys';

/**
 * Invalidate IPO-related cache keys.
 *
 * #551 round 2: this used to take only a slug and hand-roll `ipo:detail:
 * <slug>` (a key nothing populates) — it never cleared `ipo:id:<id>`, the key
 * `IPORepository.findById()` actually caches under, because it never took an
 * id at all. Its four scraper/scripts callers each hold the real IPO row
 * (`.id` and `.slug`) already. Now derives its EXACT keys from the shared
 * `getIPOInvalidationKeys` SSOT (same generators the readers use) so this
 * module can never drift from the web/packages-shared copy again — but keeps
 * its own SCAN-based `deleteKeysByPattern` for the pattern keys (this file's
 * whole reason to exist over the web/shared modules, which use blocking
 * `KEYS`) and its extra `ipos:history:*` pattern, which `getIPOInvalidationKeys`
 * does not cover.
 * @param redis - Redis client instance
 * @param ipoId - IPO id for targeted invalidation (required — see above)
 * @param slug - IPO slug for targeted invalidation
 */
export async function invalidateIPOCaches(
  redis: Redis,
  ipoId: string,
  slug: string
): Promise<void> {
  try {
    logger.debug({ ipoId, slug }, 'Invalidating IPO caches');

    const entries = getIPOInvalidationKeys(ipoId, slug);
    const exact = entries.filter((k) => !k.includes('*'));
    const patterns = entries.filter((k) => k.includes('*'));

    // Delete specific keys
    if (exact.length > 0) {
      await redis.del(...exact);
    }

    // Delete pattern-based keys (all IPO lists and searches), plus the
    // history-page pattern getIPOInvalidationKeys doesn't know about.
    for (const pattern of patterns) {
      await deleteKeysByPattern(redis, pattern);
    }
    await deleteKeysByPattern(redis, 'ipos:history:*');

    logger.debug({ ipoId, slug, exactKeysDeleted: exact.length }, 'IPO caches invalidated');
  } catch (error) {
    // Log error but don't crash scraper (cache miss is acceptable)
    logger.error(
      { error: error instanceof Error ? error.message : String(error), ipoId, slug },
      'Failed to invalidate IPO caches'
    );
  }
}

/**
 * Invalidate subscription-related cache keys
 * @param redis - Redis client instance
 * @param ipoId - IPO ID for targeted invalidation
 */
export async function invalidateSubscriptionCache(
  redis: Redis,
  ipoId: string
): Promise<void> {
  try {
    logger.debug({ ipoId }, 'Invalidating subscription caches');

    const keysToDelete: string[] = [
      `subscription:latest:${ipoId}`,
    ];

    // Delete specific keys
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }

    // Delete pattern-based keys (subscription history)
    await deleteKeysByPattern(redis, `subscription:history:${ipoId}:*`);

    logger.debug({ ipoId }, 'Subscription caches invalidated');
  } catch (error) {
    // Log error but don't crash scraper
    logger.error(
      { error: error instanceof Error ? error.message : String(error), ipoId },
      'Failed to invalidate subscription caches'
    );
  }
}

/**
 * Invalidate the /history page cache (`ipos:history:*`).
 *
 * F1 (T-264): the job that writes `listing_performance` - the source of the
 * issue price / listing gain % rendered on /history - never purged this
 * cache. `CacheTTL.HISTORICAL_IPOS` is 24h, so a stale snapshot (missing the
 * newest listings, blank gain columns) could survive a full day. Call this
 * whenever `listing_performance` rows are created/updated so the next page
 * view reflects the write instead of waiting out the TTL.
 * @param redis - Redis client instance
 */
export async function invalidateHistoryCache(redis: Redis): Promise<void> {
  try {
    await deleteKeysByPattern(redis, 'ipos:history:*');
    logger.debug('History cache invalidated');
  } catch (error) {
    // Log error but don't crash scraper (cache miss is acceptable)
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to invalidate history cache'
    );
  }
}

/**
 * Delete keys matching a pattern using SCAN for production safety
 * @param redis - Redis client instance
 * @param pattern - Key pattern to match (e.g., 'ipo:list:*')
 */
async function deleteKeysByPattern(
  redis: Redis,
  pattern: string
): Promise<void> {
  const keys: string[] = [];
  let cursor = '0';

  // Use SCAN for production-safe iteration
  do {
    const [nextCursor, matchedKeys] = await redis.scan(
      cursor,
      'MATCH',
      pattern,
      'COUNT',
      100
    );
    cursor = nextCursor;
    keys.push(...matchedKeys);
  } while (cursor !== '0');

  // Delete in batches
  if (keys.length > 0) {
    logger.debug({ pattern, count: keys.length }, 'Deleting keys by pattern');
    await redis.del(...keys);
  }
}
