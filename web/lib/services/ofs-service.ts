/**
 * OFS (Offer for Sale) Service
 *
 * Service for fetching OFS data for the OFS page.
 * Implements Redis caching with 5-minute TTL for optimal performance.
 *
 * Story 9.5: Offer for Sale (OFS) Page
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
 * OFS Table Data
 * Compatible with DataTable component columns
 *
 * Note: Schema doesn't have nonRetailDate/retailDate fields yet.
 * Using temporary mapping (validated):
 * - nonRetailDate (Non-Retail/Institutional Day) → openDate
 * - retailDate (Retail Day) → closeDate
 * TODO: Schema enhancement - Add dedicated nonRetailDate and retailDate fields
 */
export interface OFSData {
  id: string;
  companyName: string;
  slug: string;
  nonRetailDate: string | null; // Maps to openDate (institutional investors - Day 1)
  retailDate: string | null; // Maps to closeDate (retail investors - Day 2)
  openDate: string | null;
  closeDate: string | null;
  issuePrice: number | null;
  issueSize: string | null;
  status: string;
  /** T-310 (P2): row freshness — drives the page's "Last updated" banner. */
  updatedAt: string | null;
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds

// Cache key prefix
const CACHE_KEY = 'ofs:all';

// ==================== HELPER FUNCTIONS ====================

/**
 * Transform IPO data to OFSData format
 *
 * Temporary field mapping (validated in Phase 0):
 * - nonRetailDate = openDate (Day 1 - institutional investors)
 * - retailDate = closeDate (Day 2 - retail investors)
 *
 * Field mapping semantics verified: openDate/closeDate match OFS Non-Retail/Retail dates
 */
function transformOFSData(ipo: IPO): OFSData {
  return {
    id: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    nonRetailDate: ipo.openDate, // Temporary mapping (validated)
    retailDate: ipo.closeDate, // Temporary mapping (validated)
    openDate: ipo.openDate,
    closeDate: ipo.closeDate,
    issuePrice: ipo.priceRangeMax,
    issueSize: ipo.issueSize,
    status: ipo.status,
    updatedAt: ipo.updatedAt ? new Date(ipo.updatedAt).toISOString() : null,
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
 * Get all OFS issues
 * Returns all OFS (Offer for Sale) opportunities
 *
 * AC#3: Page fetches OFS category IPOs correctly
 * AC#5: ISR with 5-minute revalidation (cache TTL)
 * AC#11: Page renders successfully even if API call fails (returns empty array on error)
 *
 * T-310 (P2) root cause of the page going 76 days stale: this query has no
 * status filter and previously sorted openDate ASCENDING with limit:100 — with
 * more than 100 historical (closed/listed) OFS rows in the table, ascending
 * order fills the entire 100-row cap with old records before ever reaching
 * today's date, silently excluding every current/recent OFS from the result.
 * Sorting DESCENDING surfaces the newest records (including any upcoming
 * ones) first, so the cap can no longer hide current data behind old rows.
 * This was a query bug in this service, not a stalled/broken scraper — no
 * GitHub issue filed against T-309/T-311 scraper scope.
 *
 * @returns Array of OFS issues sorted by openDate (most recent first)
 */
export async function getOFSIssues(): Promise<OFSData[]> {
  return getCachedOrFetch(CACHE_KEY, async () => {
    try {
      // Initialize repository (Services use repositories directly)
      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      // Use repository pattern instead of HTTP API calls
      const result = await ipoRepository.findAll({
        segment: ['MAINBOARD'],
        offeringType: 'OFS',
        limit: 100,
        sortBy: 'openDate',
        sortOrder: 'desc', // Most recent first — see root-cause note above
        page: 1,
      });

      return result.data.map(transformOFSData);
    } catch (error) {
      console.error('Error fetching OFS issues:', error);
      return []; // AC#11: Return empty array on error (graceful degradation)
    }
  });
}

/**
 * Clear OFS cache
 * Utility function for cache invalidation
 */
export async function clearOFSCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(CACHE_KEY);
    console.log('OFS cache cleared successfully');
  } catch (error) {
    console.error('Error clearing OFS cache:', error);
  }
}
