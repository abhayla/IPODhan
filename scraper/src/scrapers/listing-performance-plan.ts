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
  buildListingScrapedIPO,
  computeListingGainPct,
  isPlausibleListingGain,
  parseCgListingDate,
  type MatchMethod,
  type StuckIpo,
} from '../services/listing-reconciliation.js';
import type { ScrapedIPO } from '../utils/validators.js';
import type { ChittorgarhListingRow } from './chittorgarh-listing-scraper.js';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';

/** Why an IPO produced no listing_performance row this cycle. */
export type SkipReason =
  | 'no-listing-source-match'
  | 'no-listing-price'
  | 'implausible-listing-gain'
  // #70: a CLOSED row the listing source cannot safely advance.
  | 'not-an-ipo'
  | 'not-listed-yet'
  | 'no-close-date'
  | 'listing-date-unparseable'
  | 'listing-date-in-future'
  | 'listing-date-not-after-close'
  // #70: the ipos write did not take the listing date, so no row may claim it.
  | 'listing-not-advanced';

export interface PlannedRecord {
  ipo: StuckIpo;
  matchMethod: MatchMethod;
  record: ListingPerformanceInsert;
  /**
   * #70: set when `ipos.listing_date` is empty. The listing source's date has to
   * reach `ipos` (as a CHITTORGARH write through the consolidated path, rank 3
   * after NSE and BSE, spec field 7) BEFORE this record is written, because
   * `listing_performance.listing_date` is a copy of `ipos.listing_date` (spec
   * fields 176-178 / 224) and must never exist on its own.
   */
  advance?: ScrapedIPO;
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
  listingRows: ChittorgarhListingRow[],
  todayIst?: string
): ListingPerformancePlan {
  const records: PlannedRecord[] = [];
  const skipped: SkippedIpo[] = [];

  for (const ipo of ipos) {
    const match = findBestListingMatch(ipo, listingRows);
    if (!match) {
      skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason: 'no-listing-source-match' });
      continue;
    }

    // #70: a row whose ipos.listing_date is empty (a CLOSED row the listing has
    // passed by, or a LISTED row an exchange marked without a date) is advanced
    // from the listing source — but only when the date is one an IPO can have.
    let advance: ScrapedIPO | undefined;
    if (ipo.listingDate && String(ipo.status).toUpperCase() !== 'LISTED') {
      // A stored listing date the status updater has not acted on (it is in the
      // future): not listed yet, so no listing_performance row either.
      skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason: 'not-listed-yet' });
      continue;
    }
    if (!ipo.listingDate) {
      const reason = advanceBlocker(ipo, match.row, todayIst);
      if (reason) {
        skipped.push({ ipoId: ipo.id, companyName: ipo.companyName, reason });
        continue;
      }
      advance = buildListingScrapedIPO(ipo, match.row, match.method);
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

    records.push(advance ? { ipo, matchMethod: match.method, record, advance } : { ipo, matchMethod: match.method, record });
  }

  return { records, skipped };
}

/**
 * #70: why a row with an empty `ipos.listing_date` may NOT take the listing
 * source's date, or null when it may. Spec field 7 (`listing_date`): T class,
 * NSE > BSE > CG, "listing > close". A listing date after today is not a
 * listing yet; one on or before the close date belongs to another offer (a
 * name match to an earlier issue of the same company). Report-25 lists IPOs
 * only, so a TENDER / BUYBACK / RIGHTS row never takes a listing from it (§1.11).
 */
function advanceBlocker(
  ipo: StuckIpo,
  row: ChittorgarhListingRow,
  todayIst: string | undefined
): SkipReason | null {
  if (ipo.offeringType !== 'IPO') return 'not-an-ipo';
  // #70 round 3: "listing > close" cannot be checked without a close date, and a
  // row with no window is not known to have closed at all.
  if (!ipo.closeDate) return 'no-close-date';
  const listingDate = parseCgListingDate(row.listingDate);
  if (!listingDate) return 'listing-date-unparseable';
  if (!todayIst || listingDate > todayIst) return 'listing-date-in-future';
  if (ipo.closeDate && listingDate <= ipo.closeDate) return 'listing-date-not-after-close';
  return null;
}
