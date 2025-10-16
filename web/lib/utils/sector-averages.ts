/**
 * Sector Average Utilities
 *
 * Functions for calculating and caching sector average listing gains.
 * Used for historical context comparison on IPO detail pages (Story 6.3).
 */

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { ipos, listingPerformance } from '@/lib/db/schema';
import { getRedisClient } from '@/lib/cache/redis-client';

/**
 * Cache TTL for sector averages: 7 days (604800 seconds)
 * Sector averages change slowly as new IPOs are listed
 */
const SECTOR_AVERAGE_TTL = 604800;

/**
 * Generate cache key for sector average
 */
function getSectorAverageCacheKey(sector: string): string {
  return `sector:average:listing-gain:${sector}`;
}

/**
 * Calculate sector average listing gain percentage
 *
 * Queries the database for all listed IPOs in the specified sector
 * and calculates the average listing gain percentage.
 *
 * Formula: AVG((listing_close - issue_price) / issue_price * 100)
 *
 * Filters:
 * - status = 'LISTED'
 * - sector = {sector}
 * - listing_date IS NOT NULL
 *
 * @param sector - Sector name (e.g., "Technology", "Healthcare")
 * @returns Average listing gain percentage for the sector (or 0 if no data)
 *
 * @example
 * const avgGain = await getSectorAverage('Technology');
 * // Returns: 15.75 (representing 15.75% average listing gain)
 */
export async function getSectorAverage(sector: string): Promise<number> {
  // Return 0 for empty or invalid sector
  if (!sector || sector.trim() === '') {
    return 0;
  }

  const cacheKey = getSectorAverageCacheKey(sector);
  const redis = getRedisClient();

  try {
    // Check cache first
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
      console.log(`[Cache] HIT: ${cacheKey}`);
      return parseFloat(cached);
    }

    console.log(`[Cache] MISS: ${cacheKey}`);

    // Query database for sector average
    // Join ipos with listing_performance to get listing gain data
    const result = await db
      .select({
        average: sql<string>`AVG(${listingPerformance.listingGainPercent})`,
      })
      .from(ipos)
      .innerJoin(listingPerformance, sql`${ipos.id} = ${listingPerformance.ipoId}`)
      .where(
        sql`${ipos.status} = 'LISTED' AND ${ipos.sector} = ${sector} AND ${ipos.listingDate} IS NOT NULL`
      );

    // Extract average value (handle null case)
    const average = result[0]?.average ? parseFloat(result[0].average) : 0;

    // Cache result for 7 days
    await redis.setex(cacheKey, SECTOR_AVERAGE_TTL, average.toString());
    console.log(`[Cache] SET: ${cacheKey} = ${average} (TTL: ${SECTOR_AVERAGE_TTL}s)`);

    return average;
  } catch (error) {
    console.error(`Error calculating sector average for ${sector}:`, error);
    // Return 0 as fallback if calculation fails
    return 0;
  }
}

/**
 * Invalidate sector average cache for a specific sector
 * Should be called when a new IPO is listed in the sector
 *
 * @param sector - Sector name
 */
export async function invalidateSectorAverageCache(sector: string): Promise<void> {
  if (!sector || sector.trim() === '') {
    return;
  }

  const cacheKey = getSectorAverageCacheKey(sector);
  const redis = getRedisClient();

  try {
    await redis.del(cacheKey);
    console.log(`[Cache] DEL: ${cacheKey}`);
  } catch (error) {
    console.error(`Error invalidating sector average cache for ${sector}:`, error);
    // Don't throw - cache invalidation failures shouldn't break operations
  }
}

/**
 * Invalidate all sector average caches
 * Should be called when multiple IPOs are listed or during maintenance
 */
export async function invalidateAllSectorAverageCaches(): Promise<void> {
  const redis = getRedisClient();

  try {
    const pattern = 'sector:average:listing-gain:*';
    const keys = await redis.keys(pattern);

    if (keys.length > 0) {
      await redis.del(...keys);
      console.log(`[Cache] DEL_PATTERN: ${pattern} (${keys.length} keys)`);
    }
  } catch (error) {
    console.error('Error invalidating all sector average caches:', error);
    // Don't throw - cache invalidation failures shouldn't break operations
  }
}
