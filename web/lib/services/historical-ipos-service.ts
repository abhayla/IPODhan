/**
 * /history default view — server-side data fetch (T-473 / #201)
 *
 * `/history` shipped a server component that only pre-fetched the filter
 * dropdown options (sectors/years) — the IPO rows themselves were entirely
 * client-fetched via `/api/ipos/history` inside `HistoricalIPOsContent`'s
 * `useEffect`, so the initial HTML carried chrome + "Loading..." only.
 *
 * This mirrors the `/api/ipos/history` route's own repository call (per
 * `web-data-access.md`: Server Components call repositories directly, never
 * their own HTTP API) so the first paint of the DEFAULT (no-filter) view
 * ships real rows. Non-default filter combinations still resolve via the
 * client's existing fetch — this only covers the page's default entry.
 */

import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';
import type { HistoricalIPO, HistoricalIPOQueryParams, PaginatedResponse } from '@/lib/repositories/types';

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch `/history` rows server-side for the given filters, enriched with
 * live current price/gain from `listing_performance` exactly as
 * `/api/ipos/history` does.
 *
 * Returns `undefined` on error (never `[]`) — the client
 * (`HistoricalIPOsContent`) treats `initialData === undefined` as "no server
 * data, fetch client-side" and a defined array (including `[]`) as "server
 * data present, genuinely zero rows for these filters" (same contract as
 * `mainboard-performance-service.ts`).
 */
export async function getHistoricalIPOsData(
  filters: HistoricalIPOQueryParams
): Promise<PaginatedResponse<HistoricalIPO> | undefined> {
  try {
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    const result = await ipoRepository.findHistorical(filters);

    const lpRepo = new ListingPerformanceRepository(db, redis);
    const lpRows = await lpRepo
      .findByIPOIds(result.data.map((ipo) => ipo.id))
      .catch(() => []);
    const lpByIpo = new Map(lpRows.filter((r) => r.ipoId).map((r) => [r.ipoId as string, r]));

    const enrichedData = result.data.map((ipo) => {
      const lp = lpByIpo.get(ipo.id);
      return {
        ...ipo,
        currentPriceLive: toNumber(lp?.currentPrice ?? null),
        currentGainLive: toNumber(lp?.currentGainPercent ?? null),
      };
    });

    return { ...result, data: enrichedData };
  } catch (error) {
    console.error('Error fetching server-rendered /history data:', error);
    return undefined;
  }
}
