/**
 * Cache Invalidation Utilities
 *
 * Story: 8.3 - Performance Optimization
 * Purpose: Explicit cache invalidation for Redis cached data
 * Usage: Call after scraper updates or manual data modifications
 */

import { safeDelPattern, safeDel } from './redis-client';
import { logger } from '../logger';
import { getRegistrarInvalidationKeys } from './cache-keys';

/**
 * Invalidate all cached data for a specific IPO
 * Removes: detail cache, subscription cache, list caches containing this IPO
 */
export async function invalidateIPOCache(slug: string): Promise<void> {
  try {
    logger.info({ slug }, 'Invalidating IPO cache');

    // Delete specific IPO caches
    await safeDel([`ipo:detail:${slug}`, `ipo:subscription:${slug}`]);

    // Invalidate all list caches (they may contain this IPO)
    await safeDelPattern('ipo:list:*');

    logger.info({ slug }, 'IPO cache invalidated successfully');
  } catch (error) {
    logger.error({ error, slug }, 'Failed to invalidate IPO cache');
    throw error;
  }
}

/**
 * Invalidate all IPO list caches
 * Use when: Global scraper update completes, filter options change
 */
export async function invalidateIPOListCaches(): Promise<void> {
  try {
    logger.info('Invalidating all IPO list caches');
    await safeDelPattern('ipo:list:*');
    logger.info('IPO list caches invalidated successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate IPO list caches');
    throw error;
  }
}

/**
 * Invalidate subscription data cache
 * Use when: Subscription data is updated (new scrape run)
 */
export async function invalidateSubscriptionCache(slug: string): Promise<void> {
  try {
    logger.info({ slug }, 'Invalidating subscription cache');
    await safeDel(`ipo:subscription:${slug}`);
    logger.info({ slug }, 'Subscription cache invalidated successfully');
  } catch (error) {
    logger.error({ error, slug }, 'Failed to invalidate subscription cache');
    throw error;
  }
}

/**
 * Invalidate GMP (Grey Market Premium) data cache
 * Use when: GMP data is updated manually or via scraper
 */
export async function invalidateGMPCache(slug: string): Promise<void> {
  try {
    logger.info({ slug }, 'Invalidating GMP cache');
    await safeDel(`ipo:gmp:${slug}`);
    logger.info({ slug }, 'GMP cache invalidated successfully');
  } catch (error) {
    logger.error({ error, slug }, 'Failed to invalidate GMP cache');
    throw error;
  }
}

/**
 * Invalidate all caches (nuclear option)
 * Use sparingly: Only for major schema changes or cache corruption
 */
export async function invalidateAllCaches(): Promise<void> {
  try {
    logger.warn('Invalidating ALL caches - this is a nuclear option');
    await safeDelPattern('ipo:*');
    logger.info('All caches invalidated successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate all caches');
    throw error;
  }
}

/**
 * Invalidate sector-specific caches
 * Use when: Sector list is updated
 */
export async function invalidateSectorCache(): Promise<void> {
  try {
    logger.info('Invalidating sector cache');
    await safeDel('sectors:list');
    logger.info('Sector cache invalidated successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate sector cache');
    throw error;
  }
}

/**
 * Invalidate registrar directory cache
 * Use when: Registrar data is updated
 */
export async function invalidateRegistrarCache(): Promise<void> {
  try {
    logger.info('Invalidating registrar cache');
    // T-275: previously deleted the literal key 'registrars:list', which the
    // RegistrarRepository never wrote to (it uses 'registrars:all:*' /
    // 'registrars:search:*' via cache-keys.ts) -- this call was a silent
    // no-op. Now shares the same SSOT generator as the repository.
    for (const pattern of getRegistrarInvalidationKeys()) {
      await safeDelPattern(pattern);
    }
    logger.info('Registrar cache invalidated successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to invalidate registrar cache');
    throw error;
  }
}
