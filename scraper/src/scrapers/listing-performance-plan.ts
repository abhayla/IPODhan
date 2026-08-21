/**
 * Listing-Performance Planning Core (GitHub #139)
 *
 * WHY THIS EXISTS
 * ---------------
 * `listing-performance-updater.ts` used to derive its listing price from
 * `nseData.listingPrice` — an OPTIONAL field on `NSEPastIPOResponse` that NSE's
 * /api/public-past-issues endpoint has never actually returned (verified live
 * 2026-08-22: 0 of 1411 records carry it). `listingPrice` was therefore null for
 * EVERY IPO, `listingGainPercent` with it, and prod's NOT NULL
 * `listing_performance.listing_price` rejected all 243 upserts on every cycle
 * (SQLSTATE 23502) for seven weeks.
 *
 * The real day-1 close lives in Chittorgarh report-25, which
 * `listing-reconciliation.ts` already knows how to match and convert. This module
 * is the deterministic, DB-free core that decides — per IPO — whether we have a
 * publishable record or should SKIP. Skipping matters: writing an all-null row
 * is not "success", it is publishing a blank listing gain to users.
 */
import {
  findBestListingMatch,
  buildListingPerformanceRecord,
  computeListingGainPct,
  isPlausibleListingGain,
  type MatchMethod,
  type StuckIpo,
} from '../services/listing-reconciliation.js';
import type { ChittorgarhListingRow } from './chittorgarh-listing-scraper.js';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';

/** Why an IPO produced no listing_performance row this cycle. */
export type SkipReason =
  | 'no-listing-source-match'
  | 'no-listing-price'
  | 'implausible-listing-gain';

export interface PlannedRecord {
  ipo: StuckIpo;
  matchMethod: MatchMethod;
  record: ListingPerformanceInsert;
}

export interface SkippedIpo {
  ipoId: string;
  companyName: string;
  reason: SkipReason;
}

export interface ListingPerformancePlan {
  records: PlannedRecord[];
  skipped: SkippedIpo[];
}

/**
 * Decide what to write for each LISTED IPO given the listing rows we fetched.
 * Pure: no DB, no network, no clock — so the 243/243 regression is unit-testable.
 */
export function planListingPerformanceUpdates(
  ipos: StuckIpo[],
  listingRows: ChittorgarhListingRow[]
): ListingPerformancePlan {
  const records: PlannedRecord[] = [];
  const skipped: SkippedIpo[] = [];

  for (const ipo of ipos) {
    const match = findBestListingMatch(ipo, listingRows);
    if (!match) {
      skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason: 'no-listing-source-match' });
      continue;
    }

    const record = buildListingPerformanceRecord(ipo, match.row);

    // The exact condition prod's NOT NULL column rejects. Never send it.
    if (record.listingPrice === null || record.listingPrice === undefined) {
      skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason: 'no-listing-price' });
      continue;
    }

    // A wildly out-of-range gain means the source or the parse is wrong; a blank
    // cell is better for the user than a confidently wrong +10,208%.
    const gain = computeListingGainPct(record.issuePrice ?? null, record.listingPrice);
    if (!isPlausibleListingGain(gain)) {
      skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason: 'implausible-listing-gain' });
      continue;
    }

    records.push({ ipo, matchMethod: match.method, record });
  }

  return { records, skipped };
}
