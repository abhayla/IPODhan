/**
 * Sector Average Utilities
 *
 * Calculates and caches sector-wise listing performance averages.
 * Used for comparison against individual IPO performance.
 */

import { db } from '@/lib/db/index';
import { ipos, listingPerformance } from '@/lib/db';
import { eq, and, isNotNull, sql } from 'drizzle-orm';
import { safeGet, safeSet } from '@/lib/cache/redis-client';

/**
 * Cache TTL for sector averages (7 days in seconds)
 */
const SECTOR_AVERAGE_TTL = 7 * 24 * 60 * 60; // 604800 seconds

/**
 * Generate cache key for sector average
 */
function getSectorAverageCacheKey(sector: string): string {
  return `sector:average:listing-gain:${sector.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Calculate sector average listing gain from database
 */
async function calculateSectorAverage(sector: string): Promise<number | null> {
  try {
    const result = await db
      .select({
        avgListingGain: sql<number>`AVG(${listingPerformance.listingGainPercent})`,
      })
      .from(listingPerformance)
      .innerJoin(ipos, eq(ipos.id, listingPerformance.ipoId))
      .where(
        and(
          eq(ipos.sector, sector),
          isNotNull(ipos.listingDate),
          eq(ipos.status, 'LISTED')
        )
      )
      .limit(1);

    if (!result || result.length === 0 || result[0].avgListingGain === null) {
      return null;
    }

    // Round to 2 decimal places
    return Math.round(result[0].avgListingGain * 100) / 100;
  } catch (error) {
    console.error('[getSectorAverage] Database query failed:', error);
    return null;
  }
}

/**
 * Get sector average listing gain percentage with caching
 *
 * @param sector - IPO sector name
 * @returns Average listing gain percentage for the sector, or null if unavailable
 *
 * @example
 * const avg = await getSectorAverage('Technology');
 * // Returns: 25.5 (meaning 25.5% average gain)
 */
export async function getSectorAverage(sector: string | null): Promise<number | null> {
  // Return null if sector is not provided
  if (!sector) {
    return null;
  }

  const cacheKey = getSectorAverageCacheKey(sector);

  try {
    // Try to get from cache first
    const cachedValue = await safeGet(cacheKey);

    if (cachedValue !== null) {
      const parsedValue = parseFloat(cachedValue);
      if (!isNaN(parsedValue)) {
        return parsedValue;
      }
    }

    // Calculate from database if not in cache
    const average = await calculateSectorAverage(sector);

    // Cache the result (even if null to prevent repeated DB queries)
    if (average !== null) {
      await safeSet(cacheKey, average.toString(), SECTOR_AVERAGE_TTL);
    } else {
      // Cache null result for shorter duration (1 hour)
      await safeSet(cacheKey, 'null', 3600);
    }

    return average;
  } catch (error) {
    console.error('[getSectorAverage] Error:', error);
    // Fallback to database query if cache fails
    try {
      return await calculateSectorAverage(sector);
    } catch (dbError) {
      console.error('[getSectorAverage] Fallback query failed:', dbError);
      return null;
    }
  }
}

/**
 * Invalidate sector average cache
 * Should be called when new listing performance data is added
 */
export async function invalidateSectorAverageCache(sector: string): Promise<void> {
  const cacheKey = getSectorAverageCacheKey(sector);
  try {
    const { safeDel } = await import('@/lib/cache/redis-client');
    await safeDel(cacheKey);
  } catch (error) {
    console.error('[invalidateSectorAverageCache] Error:', error);
  }
}
