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
 * T-310 (P2) root cause of the page going 76 days stale, VERIFIED against the
 * prod DB (2026-08-24): `offering_type='OFS'` has only 19 rows total, newest
 * open_date 2026-06-08 — well under the old `limit:100`, so the previous
 * ascending sort was NOT hiding rows behind a 100-row cap (that theory does
 * not hold once you count the rows). Sorting DESCENDING here is still correct
 * practice (surfaces the newest — including any upcoming — record first if
 * the table ever does grow past the cap), but it is not what was stale.
 *
 * The real cause is scraper-side: no source in the live pipeline actively
 * refreshes OFS rows once they close.
 * - `scraper/src/scrapers/nse-api-client.ts` implements a dedicated NSE OFS
 *   API endpoint (`fetchAllIPOs(category: 'ofs')`), but it is dead code —
 *   `grep -rn fetchAllIPOs scraper/src` shows the only caller is the
 *   standalone `scripts/debug-nse-api-response.ts`; the production NSE
 *   orchestrator (`nse-scraper-orchestrator-v2.ts`) calls `scrapeNSEIPOs()`
 *   (the HTML "current issues" scraper) instead, which never queries OFS.
 * - `scraper/src/scrapers/bse-api-scraper.ts` explicitly EXCLUDES OFS/NCD/
 *   rights rows (empty `Price_Band`) from its output by design.
 * - The only live path that can produce an OFS row at all is the BSE/NSE
 *   HTML "current issues" scrape via `detectOfferingType()`
 *   (`scraper/src/utils/detect-offering-type.ts`), which free-text matches
 *   an issue-type field containing "OFS"/"OFFER FOR SALE" — and only while
 *   that OFS book is listed as CURRENT on the page. Once it closes and drops
 *   off "current issues", nothing backfills it, so the table only grows when
 *   a new OFS happens to be live on scrape day.
 * Filed as a scraper-scope finding (T-309/T-311), not fixed here — this repo
 * is web/ only for T-310. See the GitHub issue referenced in the PR.
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
