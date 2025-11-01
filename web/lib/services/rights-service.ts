/**
 * Rights Issue Service
 *
 * Service for fetching Rights Issue data for the Rights Issues page.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.4: Rights Issue Page
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
 * Rights Issue Table Data
 * Compatible with DataTable component columns
 *
 * Note: Schema doesn't have recordDate/renunciationDate fields yet.
 * Using temporary mapping:
 * - recordDate → openDate
 * - renunciationDate → closeDate
 */
export interface RightsIssueData {
  id: string;
  companyName: string;
  slug: string;
  recordDate: string | null; // Maps to openDate
  openDate: string | null;
  renunciationDate: string | null; // Maps to closeDate
  closeDate: string | null;
  issuePrice: number | null;
  issueSize: string | null;
  status: string;
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds

// Cache key prefixes
const CACHE_KEYS = {
  RIGHTS_UPCOMING: 'rights:upcoming',
  RIGHTS_LIVE: 'rights:live',
} as const;

// ==================== HELPER FUNCTIONS ====================

/**
 * Transform IPO data to RightsIssueData format
 *
 * Temporary field mapping until schema is updated:
 * - recordDate = openDate (when record date is finalized)
 * - renunciationDate = closeDate (last date to renounce rights)
 */
function transformRightsData(ipo: IPO): RightsIssueData {
  return {
    id: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    recordDate: ipo.openDate, // Temporary mapping
    openDate: ipo.openDate,
    renunciationDate: ipo.closeDate, // Temporary mapping
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
 * Get upcoming Rights Issues
 * Returns Rights Issues with status UPCOMING
 *
 * AC#1: Function returns properly typed Rights Issue data
 * AC#2: Fetches correct category (RIGHTS) and status (UPCOMING)
 * AC#3: Data cached in Redis with proper cache key
 * AC#4: Handles API errors without throwing (graceful degradation)
 */
export async function getUpcomingRightsIssues(): Promise<RightsIssueData[]> {
  return getCachedOrFetch(CACHE_KEYS.RIGHTS_UPCOMING, async () => {
    try {
      // Initialize repository (Services use repositories directly)
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Use repository pattern instead of HTTP API calls
      const result = await ipoRepository.findAll({
        segment: ['MAINBOARD'],
        offeringType: 'RIGHTS',
        status: ['UPCOMING'],
        limit: 100,
        sortBy: 'openDate',
        sortOrder: 'asc', // Soonest first
        page: 1,
      });

      return result.data.map(transformRightsData);
    } catch (error) {
      console.error('Error fetching upcoming rights issues:', error);
      return []; // AC#4: Return empty array on error
    }
  });
}

/**
 * Get live/open Rights Issues
 * Returns Rights Issues with status OPEN
 *
 * AC#1: Function returns properly typed Rights Issue data
 * AC#2: Fetches correct category (RIGHTS) and status (OPEN)
 * AC#3: Data cached in Redis with proper cache key
 * AC#4: Handles API errors without throwing (graceful degradation)
 */
export async function getLiveRightsIssues(): Promise<RightsIssueData[]> {
  return getCachedOrFetch(CACHE_KEYS.RIGHTS_LIVE, async () => {
    try {
      // Initialize repository (Services use repositories directly)
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Use repository pattern instead of HTTP API calls
      const result = await ipoRepository.findAll({
        segment: ['MAINBOARD'],
        offeringType: 'RIGHTS',
        status: ['OPEN'],
        limit: 100,
        sortBy: 'openDate',
        sortOrder: 'desc', // Most recent first
        page: 1,
      });

      return result.data.map(transformRightsData);
    } catch (error) {
      console.error('Error fetching live rights issues:', error);
      return []; // AC#4: Return empty array on error
    }
  });
}

/**
 * Get Rights Issues by status
 * Convenience function for getting rights issues by status
 */
export async function getRightsIssues(
  status: 'upcoming' | 'live'
): Promise<RightsIssueData[]> {
  if (status === 'upcoming') {
    return getUpcomingRightsIssues();
  }
  return getLiveRightsIssues();
}

/**
 * Clear all rights issues caches
 * Utility function for cache invalidation
 */
export async function clearRightsIssuesCaches(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(CACHE_KEYS.RIGHTS_UPCOMING, CACHE_KEYS.RIGHTS_LIVE);
    console.log('Rights issues caches cleared successfully');
  } catch (error) {
    console.error('Error clearing rights issues caches:', error);
  }
}
