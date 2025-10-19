/**
 * NCD (Non-Convertible Debentures) Service
 *
 * Service for fetching NCD data for the NCD page.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.6: NCD Issue Page
 */

import { getRedisClient, safeGet, safeSet } from '@/lib/cache/redis-client';
import { getIPOs } from '@/lib/api-client';
import type { IPO } from '@/lib/api-client';

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
      const response = await getIPOs({
        segment: 'MAINBOARD',
        offeringType: 'NCD',
        limit: 100, // Get all NCD issues
      });

      // Sort by openDate descending (newest first) - AC#8
      const sortedData = response.data.sort((a, b) => {
        const dateA = a.openDate ? new Date(a.openDate).getTime() : 0;
        const dateB = b.openDate ? new Date(b.openDate).getTime() : 0;
        return dateB - dateA; // Descending order (newest first)
      });

      return sortedData.map(transformNCDData);
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
