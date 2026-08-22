/**
 * Listing Performance Updater
 *
 * Keeps `listing_performance` current for every LISTED IPO: the real day-1
 * listing price, the issue price, the listing gain, and the latest traded price
 * with its gain-since-issue.
 *
 * ROOT-CAUSE HISTORY (GitHub #139) - read before changing the data source
 * ----------------------------------------------------------------------
 * This module used to read the listing price from `nseData.listingPrice`, an
 * OPTIONAL field on `NSEPastIPOResponse`. NSE's /api/public-past-issues has
 * never actually returned that field (verified live 2026-08-22: 0 of 1411
 * records carry it; the payload is company/symbol/htmSym/ipoStartDate/
 * ipoEndDate/linkRemovalDate/priceRange/issuePrice/listingDate/securityType).
 * So `listingPrice` - and `listingGainPercent`, which is derived from it - was
 * `null` for EVERY IPO. Prod's `listing_performance.listing_price` is NOT NULL,
 * so all 243 upserts failed with SQLSTATE 23502 on every cycle, for seven weeks,
 * while the log line only ever said "Failed to upsert listing performance"
 * because the repository's `DatabaseError` wrapper kept the real error in
 * `cause` and the caller logged `error.message`.
 *
 * Three things changed and must stay changed:
 *  1. The listing price now comes from Chittorgarh report-25 - the only reachable
 *     source publishing a real day-1 close for mainboard AND SME (NSE is
 *     bot-blocked; BSE StockReachGraph returns only the current intraday
 *     series). Matching and record-building reuse the tested pure core in
 *     `services/listing-reconciliation.ts`.
 *  2. An IPO with no usable listing price is SKIPPED, not attempted. Writing an
 *     all-null row is not success - it publishes a blank listing gain to users.
 *  3. Every DB failure logs its Postgres cause (SQLSTATE, column, constraint,
 *     DETAIL) via `describeDbCause`, so the next regression is diagnosable from
 *     the first log line instead of taking seven weeks.
 *
 * The per-IPO NSE quote-API and BSE StockReachGraph calls were removed in the
 * same change: both are bot-blocked from the production hosts and returned null
 * for every symbol, contributing nothing but ~24s of sleep per cycle.
 * Chittorgarh report-25 already carries the current BSE/NSE price and gain in
 * the same row.
 */

import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { invalidateHistoryCache } from '../services/cache-invalidator.js';
import { describeDbCause } from '@ipodhan/shared/errors/db-cause';
import { fetchChittorgarhListingRows } from './chittorgarh-listing-scraper.js';
import type { StuckIpo } from '../services/listing-reconciliation.js';
import { planListingPerformanceUpdates } from './listing-performance-plan.js';
import logger from '../utils/logger.js';

export interface ListingPerformanceUpdateResult {
  totalListedIPOs: number;
  existingRecords: number;
  newRecordsCreated: number;
  recordsUpdated: number;
  /** IPOs with no usable listing price this cycle - expected, not an error. */
  skipped: number;
  /** Real write failures. A healthy cycle has 0 here. */
  failures: number;
  duration: number;
  timestamp: string;
}

/**
 * Fiscal-year x category windows to pull from Chittorgarh report-25. Covers the
 * current and previous two Indian fiscal years, which is where every IPO that
 * can still move a listing gain lives. Both `year` values that report-25
 * accepts for a range are requested because the report keys some rows off the
 * calendar year and some off the fiscal year.
 */
export function recentFiscalYears(now: Date): Array<{ year: number; range: string }> {
  // Indian FY starts in April: months 0-2 (Jan-Mar) still belong to the prior FY.
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const windows: Array<{ year: number; range: string }> = [];
  for (let i = 0; i < 3; i++) {
    const start = fyStart - i;
    const range = `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
    windows.push({ year: start + 1, range });
    windows.push({ year: start, range });
  }
  return windows;
}

/**
 * Main function to update listing performance for all LISTED IPOs.
 */
export async function updateListingPerformance(): Promise<ListingPerformanceUpdateResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info('Starting listing performance update');

  let totalListedIPOs = 0;
  let existingRecords = 0;
  let newRecordsCreated = 0;
  let recordsUpdated = 0;
  let skipped = 0;
  let failures = 0;
  let skipReasons: Record<string, number> = {};

  try {
    const redis = getRedisClient();
    const repository = new ListingPerformanceRepository(db, redis);

    // Step 1: every LISTED IPO, with the fields the matcher needs
    // (ISIN > symbol > slug > normalized name).
    const listedIPOsResult = await db.query.ipos.findMany({
      where: eq(schema.ipos.status, 'LISTED'),
      columns: {
        id: true,
        companyName: true,
        slug: true,
        symbol: true,
        isin: true,
        segment: true,
        offeringType: true,
        status: true,
        openDate: true,
        closeDate: true,
        listingDate: true,
        priceRangeMax: true,
        issueSize: true,
      },
    });

    totalListedIPOs = listedIPOsResult.length;
    logger.info({ totalListedIPOs }, 'Found LISTED IPOs in database');

    const ipos: StuckIpo[] = listedIPOsResult.map((i) => ({
      id: i.id,
      companyName: i.companyName,
      slug: i.slug,
      symbol: i.symbol ?? null,
      isin: i.isin ?? null,
      segment: i.segment ?? null,
      offeringType: i.offeringType as string,
      status: i.status as string,
      openDate: i.openDate ?? null,
      closeDate: i.closeDate ?? null,
      listingDate: i.listingDate ?? null,
      priceRangeMax: i.priceRangeMax ?? null,
      issueSize: i.issueSize ?? null,
    }));

    // Step 2: the real day-1 listing prices.
    const listingRows = await fetchChittorgarhListingRows(recentFiscalYears(new Date()));
    logger.info({ listingRows: listingRows.length }, 'Chittorgarh listing rows fetched');

    if (listingRows.length === 0) {
      // Nothing to write is a source outage, not 243 failures. Say so plainly.
      logger.error(
        { totalListedIPOs },
        'Listing source returned zero rows - skipping this cycle without writes'
      );
    }

    // Step 3: which IPOs already have a record (for the created/updated split).
    const existingPerformanceRecords = await db.query.listingPerformance.findMany({
      columns: { ipoId: true },
    });
    const existingIPOIds = new Set(existingPerformanceRecords.map((r) => r.ipoId));
    existingRecords = existingPerformanceRecords.length;

    // Step 4: decide what to write (pure, unit-tested).
    const plan = planListingPerformanceUpdates(ipos, listingRows);
    skipped = plan.skipped.length;

    skipReasons = plan.skipped.reduce<Record<string, number>>((acc, s) => {
      acc[s.reason] = (acc[s.reason] ?? 0) + 1;
      return acc;
    }, {});
    logger.info(
      { planned: plan.records.length, skipped, skipReasons },
      'Listing performance plan computed'
    );

    // Step 5: write.
    for (const planned of plan.records) {
      try {
        await repository.upsert(planned.record);

        if (existingIPOIds.has(planned.ipo.id)) {
          recordsUpdated++;
        } else {
          newRecordsCreated++;
        }
      } catch (error) {
        failures++;
        // #139: log the Postgres cause, not just the wrapper's generic message.
        const cause = describeDbCause(error);
        logger.error(
          {
            ipoId: planned.ipo.id,
            symbol: planned.ipo.symbol,
            companyName: planned.ipo.companyName,
            matchMethod: planned.matchMethod,
            pgCode: cause.code,
            pgColumn: cause.column,
            pgConstraint: cause.constraint,
            pgDetail: cause.detail,
            errorChain: cause.chain,
          },
          'Failed to update listing performance for IPO'
        );
      }
    }

    const duration = Date.now() - startTime;

    const result: ListingPerformanceUpdateResult = {
      totalListedIPOs,
      existingRecords,
      newRecordsCreated,
      recordsUpdated,
      skipped,
      failures,
      duration,
      timestamp,
    };

    logger.info(result, 'Listing performance update completed');
    printReport(result, skipReasons);

    // F1 (T-264): this write is the source of the issue price / listing gain %
    // rendered on /history. Nothing else purges `ipos:history:*`, so without
    // this the page can serve a stale snapshot for the full 24h TTL after a
    // real write. Event-driven: only worth purging when something changed.
    if (newRecordsCreated + recordsUpdated > 0) {
      await invalidateHistoryCache(redis);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const cause = describeDbCause(error);
    logger.error(
      {
        pgCode: cause.code,
        pgColumn: cause.column,
        pgConstraint: cause.constraint,
        pgDetail: cause.detail,
        errorChain: cause.chain,
        duration,
      },
      'Listing performance update failed'
    );

    return {
      totalListedIPOs,
      existingRecords,
      newRecordsCreated,
      recordsUpdated,
      skipped,
      failures: failures + 1,
      duration,
      timestamp,
    };
  }
}

function printReport(
  result: ListingPerformanceUpdateResult,
  skipReasons: Record<string, number>
): void {
  const pct = (n: number) =>
    result.totalListedIPOs > 0 ? Math.round((n / result.totalListedIPOs) * 100) : 0;
  const bar = '='.repeat(80);
  const covered = result.existingRecords + result.newRecordsCreated;

  console.log('\n' + bar);
  console.log('LISTING PERFORMANCE UPDATE REPORT');
  console.log(bar);
  console.log(`Timestamp: ${result.timestamp}`);
  console.log(`Duration: ${Math.round(result.duration / 1000)}s`);
  console.log('');
  console.log('Coverage:');
  console.log(`  Total LISTED IPOs: ${result.totalListedIPOs}`);
  console.log(`  Existing Records: ${result.existingRecords} (${pct(result.existingRecords)}%)`);
  console.log(`  New Records Created: ${result.newRecordsCreated}`);
  console.log(`  Records Updated: ${result.recordsUpdated}`);
  console.log(`  Skipped (no listing price available): ${result.skipped}`);
  for (const [reason, count] of Object.entries(skipReasons)) {
    console.log(`    - ${reason}: ${count}`);
  }
  console.log(`  Failures: ${result.failures}`);
  console.log('');
  console.log('Result:');
  console.log(`  Total Coverage: ${covered}/${result.totalListedIPOs} (${pct(covered)}%)`);
  console.log(bar + '\n');
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await updateListingPerformance();
    process.exit(0);
  } catch (error) {
    logger.error(
      { errorChain: describeDbCause(error).chain },
      'Listing performance updater failed'
    );
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
