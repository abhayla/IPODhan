/**
 * Mainboard IPO Performance Tracker — server-side data fetch (T-302 / P3-13)
 *
 * `/mainboard-ipo-performance-tracker` shipped as a server component wrapper
 * around a fully client-fetched table — the initial HTML carried no real IPO
 * data at all (zero server-rendered rows). This mirrors the same repository
 * query the `/api/ipos/history` route already runs (per `web-data-access.md`:
 * Server Components call repositories directly, never their own HTTP API) so
 * the FIRST paint ships real rows; the client component still owns
 * client-side year-switch refetching.
 */

import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
import type { PerformanceData } from '@/components/performance/MainboardPerformanceTrackerClient';

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Shared server-side fetch behind `getMainboardPerformanceData` /
 * `getSMEPerformanceData` — same repository query, filtered to the requested
 * segment. Fails open to an empty array (honest empty state) on any
 * repository error; this is a supplementary "ship something real on first
 * paint" fetch, not the page's sole data source — the client component still
 * refetches on year changes.
 */
async function getSegmentPerformanceData(
  year: string,
  segment: 'MAINBOARD' | 'SME'
): Promise<PerformanceData[]> {
  try {
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const result = await ipoRepository.findHistorical({
      year,
      sort: 'listing_date',
      sortOrder: 'desc',
      limit: 100,
    });

    const segmentRows = result.data.filter(
      (ipo) => ipo.segment === segment && ipo.listingGainPercent !== null && ipo.listingGainPercent !== undefined
    );

    const lpRepo = new ListingPerformanceRepository(db, redis);
    const lpRows = await lpRepo.findByIPOIds(segmentRows.map((ipo) => ipo.id)).catch(() => []);
    const lpByIpo = new Map(lpRows.filter((r) => r.ipoId).map((r) => [r.ipoId as string, r]));

    return segmentRows.map((ipo) => {
      const lp = lpByIpo.get(ipo.id);
      return {
        id: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        listedOn: ipo.listingDate,
        issuePrice: toNumber(ipo.issuePrice) ?? 0,
        listingDayClose: toNumber(ipo.listingClose) ?? 0,
        listingDayGain: ipo.listingGainPercent as number,
        currentPrice: toNumber(lp?.currentPrice ?? null),
        profitLoss: toNumber(lp?.currentGainPercent ?? null),
      };
    });
  } catch (error) {
    console.error(`Error fetching server-rendered ${segment} performance data:`, error);
    return [];
  }
}

/** Fetch Mainboard IPO performance rows for a given year, server-side. */
export async function getMainboardPerformanceData(year: string): Promise<PerformanceData[]> {
  return getSegmentPerformanceData(year, 'MAINBOARD');
}

/** Fetch SME IPO performance rows for a given year, server-side. */
export async function getSMEPerformanceData(year: string): Promise<PerformanceData[]> {
  return getSegmentPerformanceData(year, 'SME');
}
