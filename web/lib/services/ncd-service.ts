/**
 * NCD (Non-Convertible Debentures) Service
 *
 * Service for fetching NCD data for the NCD page.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.6: NCD Issue Page
 *
 * ⚠️ ARCHITECTURAL NOTE: Services should use repositories directly,
 * not HTTP API calls. This follows the 3-layer architecture:
 * Service → Repository (not Service → HTTP → API → Repository)
 */

import { getRedisClient, safeGet, safeSet } from '@/lib/cache/redis-client';
import { db } from '@/lib/db/index';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import type { IPO } from '@/lib/db/types';

// ==================== TYPES ====================

/**
 * NCD Table Data
 * Compatible with DataTable component columns
 */
export interface NCDData {
  id: string;
  companyName: string;
  slug: string;
  openDate: string | null;
  closeDate: string | null;
  issuePrice: number | null;
  issueSize: string | null;
  status: string;
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds

// Cache key prefix
const CACHE_KEY = 'ncd:all';

// ==================== HELPER FUNCTIONS ====================

/**
 * Transform IPO data to NCDData format
 */
function transformNCDData(ipo: IPO): NCDData {
  return {
    id: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    openDate: ipo.openDate,
    closeDate: ipo.closeDate,
    issuePrice: ipo.priceRangeMax,
    issueSize: ipo.issueSize,
    status: ipo.status,
  };
}

/**
 * Get data from cache or fetch from API
 */
async function getCachedOrFetch<T>(
  cacheKey: string,
  fetchFunction: () => Promise<T>
): Promise<T> {
  try {
    // Try to get from cache
    const cached = await safeGet(cacheKey);
    if (cached) {
      return JSON.parse(cached) as T;
    }

    // Fetch from API
    const data = await fetchFunction();

    // Store in cache (non-blocking)
    safeSet(cacheKey, JSON.stringify(data), CACHE_TTL).catch((error) => {
      console.error(`Failed to cache data for key ${cacheKey}:`, error);
    });

    return data;
  } catch (error) {
    console.error(`Error in getCachedOrFetch for key ${cacheKey}:`, error);
    // Fallback: try to fetch without cache
    return fetchFunction();
  }
}

// ==================== PUBLIC API FUNCTIONS ====================

/**
 * Get all NCD issues
 * Returns all NCD (Non-Convertible Debentures) issues
 *
 * AC#3: Page fetches NCD category IPOs correctly
 * AC#6: ISR with 5-minute revalidation (cache TTL)
 * AC#8: NCDs sorted by Open Date (descending - newest first)
 * AC#12: Page renders successfully even if API call fails (returns empty array on error)
 *
 * @returns Array of NCD issues sorted by openDate (newest first - descending)
 */
export async function getNCDIssues(): Promise<NCDData[]> {
  return getCachedOrFetch(CACHE_KEY, async () => {
    try {
      // Initialize repository (Services use repositories directly)
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Use repository pattern instead of HTTP API calls
      const result = await ipoRepository.findAll({
        segment: ['MAINBOARD'],
        offeringType: 'NCD',
        limit: 100,
        sortBy: 'openDate',
        sortOrder: 'desc', // AC#8: Newest first
        page: 1,
      });

      return result.data.map(transformNCDData);
    } catch (error) {
      console.error('Error fetching NCD issues:', error);
      return []; // AC#12: Return empty array on error (graceful degradation)
    }
  });
}

/**
 * Clear NCD cache
 * Utility function for cache invalidation
 */
export async function clearNCDCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(CACHE_KEY);
    console.log('NCD cache cleared successfully');
  } catch (error) {
    console.error('Error clearing NCD cache:', error);
  }
}
