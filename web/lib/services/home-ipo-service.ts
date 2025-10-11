/**
 * Home IPO Service
 *
 * Service for fetching IPO data for the four home page tables.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.1: Data Layer & API Integration for Home Page IPO Tables
 */

import { getRedisClient, safeGet, safeSet } from '@/lib/cache/redis-client';
import { getIPOs } from '@/lib/api-client';
import type { IPO } from '@/lib/api-client';

// ==================== TYPES ====================

/**
 * Home Page IPO Table Data
 * Compatible with DataTable component columns (companyName, openDate, closeDate)
 */
export interface HomeIPOTableData {
  id: string;
  companyName: string;
  slug: string;
  category: string;
  openDate: string | null;
  closeDate: string | null;
  issuePrice: number | null; // Computed from priceRangeMax
  issueSize: string | null; // Matches IPO schema (numeric -> string)
  listingDate: string | null;
  status: string;
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds
const RESULT_LIMIT = 10; // Limit to 10 items per table (AC#3)

// Cache key prefixes
const CACHE_KEYS = {
  MAINBOARD_ACTIVE: 'home:mainboard:active',
  SME_ACTIVE: 'home:sme:active',
  MAINBOARD_UPCOMING: 'home:mainboard:upcoming',
  SME_UPCOMING: 'home:sme:upcoming',
} as const;

// ==================== HELPER FUNCTIONS ====================

/**
 * Transform IPO data to HomeIPOTableData format
 */
function transformIPOData(ipo: IPO): HomeIPOTableData {
  return {
    id: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    category: ipo.category,
    openDate: ipo.openDate,
    closeDate: ipo.closeDate,
    issuePrice: ipo.priceRangeMax, // Use max price from range
    issueSize: ipo.issueSize, // Already string | null from schema
    listingDate: ipo.listingDate,
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

/**
 * Check if IPO was closed within last 30 days
 */
function isClosedWithinLast30Days(closeDate: string | null): boolean {
  if (!closeDate) return false;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const closeDateObj = new Date(closeDate);
  return closeDateObj >= thirtyDaysAgo;
}

// ==================== PUBLIC API FUNCTIONS ====================

/**
 * Get active Mainboard IPOs
 * Returns IPOs with status OPEN or CLOSED (within last 30 days)
 * Limited to 10 most relevant results
 *
 * AC#1: Function returns properly typed IPO data
 * AC#2: Fetches correct category (MAINBOARD) and status (OPEN, CLOSED last 30 days)
 * AC#3: Results limited to 10 items
 * AC#4: Data cached in Redis with proper cache key
 * AC#5: Handles API errors without throwing
 */
export async function getMainboardIPOs(): Promise<HomeIPOTableData[]> {
  return getCachedOrFetch(CACHE_KEYS.MAINBOARD_ACTIVE, async () => {
    try {
      // Fetch OPEN mainboard IPOs
      const openIPOsResponse = await getIPOs({
        category: 'MAINBOARD',
        status: 'OPEN',
        limit: RESULT_LIMIT,
      });

      // Fetch CLOSED mainboard IPOs
      const closedIPOsResponse = await getIPOs({
        category: 'MAINBOARD',
        status: 'CLOSED',
        limit: 50, // Get more to filter by date
      });

      // Filter closed IPOs to only include those closed within last 30 days
      const recentlyClosedIPOs = closedIPOsResponse.data.filter((ipo) =>
        isClosedWithinLast30Days(ipo.closeDate)
      );

      // Combine OPEN and recently CLOSED IPOs
      const combinedIPOs = [
        ...openIPOsResponse.data,
        ...recentlyClosedIPOs,
      ];

      // Sort by openDate (most recent first) and limit to 10
      const sortedIPOs = combinedIPOs
        .sort((a, b) => {
          const dateA = a.openDate ? new Date(a.openDate).getTime() : 0;
          const dateB = b.openDate ? new Date(b.openDate).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, RESULT_LIMIT);

      return sortedIPOs.map(transformIPOData);
    } catch (error) {
      console.error('Error fetching mainboard IPOs:', error);
      return []; // AC#5: Return empty array on error
    }
  });
}

/**
 * Get active SME IPOs
 * Returns IPOs with status OPEN or CLOSED (within last 30 days)
 * Limited to 10 most relevant results
 *
 * AC#1: Function returns properly typed IPO data
 * AC#2: Fetches correct category (SME) and status (OPEN, CLOSED last 30 days)
 * AC#3: Results limited to 10 items
 * AC#4: Data cached in Redis with proper cache key
 * AC#5: Handles API errors without throwing
 */
export async function getSMEIPOs(): Promise<HomeIPOTableData[]> {
  return getCachedOrFetch(CACHE_KEYS.SME_ACTIVE, async () => {
    try {
      // Fetch OPEN SME IPOs
      const openIPOsResponse = await getIPOs({
        category: 'SME',
        status: 'OPEN',
        limit: RESULT_LIMIT,
      });

      // Fetch CLOSED SME IPOs
      const closedIPOsResponse = await getIPOs({
        category: 'SME',
        status: 'CLOSED',
        limit: 50, // Get more to filter by date
      });

      // Filter closed IPOs to only include those closed within last 30 days
      const recentlyClosedIPOs = closedIPOsResponse.data.filter((ipo) =>
        isClosedWithinLast30Days(ipo.closeDate)
      );

      // Combine OPEN and recently CLOSED IPOs
      const combinedIPOs = [
        ...openIPOsResponse.data,
        ...recentlyClosedIPOs,
      ];

      // Sort by openDate (most recent first) and limit to 10
      const sortedIPOs = combinedIPOs
        .sort((a, b) => {
          const dateA = a.openDate ? new Date(a.openDate).getTime() : 0;
          const dateB = b.openDate ? new Date(b.openDate).getTime() : 0;
          return dateB - dateA;
        })
        .slice(0, RESULT_LIMIT);

      return sortedIPOs.map(transformIPOData);
    } catch (error) {
      console.error('Error fetching SME IPOs:', error);
      return []; // AC#5: Return empty array on error
    }
  });
}

/**
 * Get upcoming Mainboard IPOs
 * Returns IPOs with status UPCOMING
 * Limited to 10 most relevant results
 *
 * AC#1: Function returns properly typed IPO data
 * AC#2: Fetches correct category (MAINBOARD) and status (UPCOMING)
 * AC#3: Results limited to 10 items
 * AC#4: Data cached in Redis with proper cache key
 * AC#5: Handles API errors without throwing
 */
export async function getUpcomingMainboardIPOs(): Promise<HomeIPOTableData[]> {
  return getCachedOrFetch(CACHE_KEYS.MAINBOARD_UPCOMING, async () => {
    try {
      const response = await getIPOs({
        category: 'MAINBOARD',
        status: 'UPCOMING',
        limit: RESULT_LIMIT,
      });

      // Sort by expected openDate (soonest first)
      const sortedIPOs = response.data.sort((a, b) => {
        const dateA = a.openDate ? new Date(a.openDate).getTime() : Infinity;
        const dateB = b.openDate ? new Date(b.openDate).getTime() : Infinity;
        return dateA - dateB;
      });

      return sortedIPOs.map(transformIPOData);
    } catch (error) {
      console.error('Error fetching upcoming mainboard IPOs:', error);
      return []; // AC#5: Return empty array on error
    }
  });
}

/**
 * Get upcoming SME IPOs
 * Returns IPOs with status UPCOMING
 * Limited to 10 most relevant results
 *
 * AC#1: Function returns properly typed IPO data
 * AC#2: Fetches correct category (SME) and status (UPCOMING)
 * AC#3: Results limited to 10 items
 * AC#4: Data cached in Redis with proper cache key
 * AC#5: Handles API errors without throwing
 */
export async function getUpcomingSMEIPOs(): Promise<HomeIPOTableData[]> {
  return getCachedOrFetch(CACHE_KEYS.SME_UPCOMING, async () => {
    try {
      const response = await getIPOs({
        category: 'SME',
        status: 'UPCOMING',
        limit: RESULT_LIMIT,
      });

      // Sort by expected openDate (soonest first)
      const sortedIPOs = response.data.sort((a, b) => {
        const dateA = a.openDate ? new Date(a.openDate).getTime() : Infinity;
        const dateB = b.openDate ? new Date(b.openDate).getTime() : Infinity;
        return dateA - dateB;
      });

      return sortedIPOs.map(transformIPOData);
    } catch (error) {
      console.error('Error fetching upcoming SME IPOs:', error);
      return []; // AC#5: Return empty array on error
    }
  });
}

/**
 * Clear all home page caches
 * Utility function for cache invalidation
 */
export async function clearHomeIPOCaches(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(
      CACHE_KEYS.MAINBOARD_ACTIVE,
      CACHE_KEYS.SME_ACTIVE,
      CACHE_KEYS.MAINBOARD_UPCOMING,
      CACHE_KEYS.SME_UPCOMING
    );
    console.log('Home IPO caches cleared successfully');
  } catch (error) {
    console.error('Error clearing home IPO caches:', error);
  }
}
