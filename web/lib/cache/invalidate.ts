/**
 * Cache Invalidation Utilities
 *
 * Story: 8.3 - Performance Optimization
 * Purpose: Explicit cache invalidation for Redis cached data
 * Usage: Call after scraper updates or manual data modifications
 */

import { safeDelPattern, safeDel, getRedisClient } from './redis-client';
import { logger } from '../logger';
import { getRegistrarInvalidationKeys } from './cache-keys';
import { invalidateIPOCaches } from './ipo-cache-invalidation';

/**
 * Invalidate all cached data for a specific IPO.
 *
 * #551: this used to hand-roll `ipo:detail:<slug>` + `ipo:subscription:<slug>`
 * — TWO keys nothing populates (readers cache the detail lookup under
 * `getIPOBySlugKey` -> `ipo:slug:<slug>`, and the subscription snapshot under
 * `getLatestSubscriptionKey` -> `subscription:latest:<ipoId>`). It never had
 * a caller, so the wrong keys shipped invisibly. Now delegates to the one
 * canonical module (`ipo-cache-invalidation.ts`), which derives its key set
 * from the same `cache-keys.ts` generators the readers use. `ipoId` is
 * required by that module; pass `''` when only a slug is known (a create/
 * update path that has it should call `invalidateIPOCaches` directly with the
 * real id instead of this slug-only convenience wrapper).
 */
export async function invalidateIPOCache(slug: string, ipoId = ''): Promise<void> {
  try {
    logger.info({ slug }, 'Invalidating IPO cache');
    await invalidateIPOCaches(getRedisClient(), ipoId, slug);
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
