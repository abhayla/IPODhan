/**
 * Listing Gains Service
 *
 * Surfaces REAL listing-performance data (listing gain %, current gain %) for a
 * set of IPOs, so listing-index pages can show an honest, colored gain column
 * instead of the fabricated Math.random() performance data that used to feed the
 * "Performance Highlights" cards (#98).
 *
 * The canonical source is the `listing_performance` table — NOT the
 * `ipos.listing_gain_percentage` column, which is empty in production
 * (0/43 mainboard, 0/115 SME as of 2026-07-03). A missing id in the returned
 * map means "no listing-performance row yet" (data gap #89/#98) — callers render
 * an em dash, never a fabricated value.
 */

import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';

export interface ListingGain {
  listingGainPercent: number | null;
  currentGainPercent: number | null;
  currentPrice: number | null;
}

export type ListingGainsMap = Record<string, ListingGain>;

/**
 * Fetch listing-gain data for the given IPO ids, keyed by ipoId.
 * Best-effort: on any failure returns an empty map (page still renders, gain
 * column shows em dashes) — never throws into the page render path.
 */
export async function getListingGainsByIds(ipoIds: string[]): Promise<ListingGainsMap> {
  if (ipoIds.length === 0) return {};

  try {
    const redis = getRedisClient();
    const repo = new ListingPerformanceRepository(db, redis);
    const rows = await repo.findByIPOIds(ipoIds);

    // numeric() columns without mode:'number' come back as strings — coerce to a
    // finite number or null (never NaN into the UI).
    const toNum = (v: string | number | null): number | null => {
      if (v === null || v === undefined) return null;
      const n = typeof v === 'string' ? parseFloat(v) : v;
      return Number.isFinite(n) ? n : null;
    };

    const map: ListingGainsMap = {};
    for (const row of rows) {
      if (!row.ipoId) continue;
      map[row.ipoId] = {
        listingGainPercent: toNum(row.listingGainPercent),
        currentGainPercent: toNum(row.currentGainPercent),
        currentPrice: toNum(row.currentPrice),
      };
    }
    return map;
  } catch (error) {
    console.error('Error fetching listing gains:', error);
    return {};
  }
}
