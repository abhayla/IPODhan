import type Redis from 'ioredis';
import logger from '../utils/logger.js';

/**
 * Invalidate IPO-related cache keys
 * @param redis - Redis client instance
 * @param slug - IPO slug for targeted invalidation
 */
export async function invalidateIPOCaches(
  redis: Redis,
  slug: string
): Promise<void> {
  try {
    logger.debug({ slug }, 'Invalidating IPO caches');

    const keysToDelete: string[] = [
      `ipo:detail:${slug}`,
      `ipo:slug:${slug}`,
    ];

    // Delete specific keys
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }

    // Delete pattern-based keys (all IPO lists and searches)
    await deleteKeysByPattern(redis, 'ipo:list:*');
    await deleteKeysByPattern(redis, 'ipo:search:*');
    await deleteKeysByPattern(redis, 'ipos:history:*');

    logger.debug({ slug, keysDeleted: keysToDelete.length }, 'IPO caches invalidated');
  } catch (error) {
    // Log error but don't crash scraper (cache miss is acceptable)
    logger.error(
      { error: error instanceof Error ? error.message : String(error), slug },
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
