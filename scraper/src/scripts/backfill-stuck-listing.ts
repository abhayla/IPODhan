#!/usr/bin/env tsx
/**
 * Backfill: advance stuck CLOSED IPOs to LISTED (GitHub #70 / #36)
 *
 * 142 of 167 genuine CLOSED IPOs (85%) are stuck at status=CLOSED with
 * listing_date=NULL — the status state-machine only advances CLOSED -> LISTED
 * once listing_date is set, but no working source ever set it.
 *
 * This script:
 *   1. Pulls the deterministic listing source (Chittorgarh report-25, mainboard +
 *      SME, real day-1 close — paginated for full coverage).
 *   2. Loads genuine CLOSED IPOs whose close_date is > 21d old and listing_date
 *      is NULL (the stuck set), READ-ONLY.
 *   3. Matches by ISIN > NSE symbol > slug > normalized name.
 *   4. For each match: sets listing_date + status=LISTED via upsertIPO (write-path
 *      SSOT) and writes the listing_performance row (day-1 price / issue / gain).
 *
 * DRY-RUN by default (logs what it WOULD write). Pass --execute to persist.
 * Per the data-quality contract, this run is DRY-RUN ONLY — the real backfill is
 * the owner's July-1 batch.
 */
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { IPORepository } from '@ipodhan/shared/repositories/ipo-repository';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { resolveIpoRow } from '@ipodhan/shared/repositories';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { upsertIPO } from '../services/data-persister.js';
import { fetchChittorgarhListingRows } from '../scrapers/chittorgarh-listing-scraper.js';
import {
  findBestListingMatch,
  buildListingScrapedIPO,
  buildListingPerformanceRecord,
  isPlausibleListingGain,
  computeListingGainPct,
  type StuckIpo,
} from '../services/listing-reconciliation.js';
import logger from '../utils/logger.js';

// Fiscal years to pull from Chittorgarh (calendar-year, range) pairs. Extend for
// older stuck IPOs. The report paginates per (year, range, category).
// Recent windows first (the stuck set is recent — avoid CG rate-limiting an
// older heavy pull before reaching the windows that actually match).
const FISCAL_YEARS = [
  { year: 2026, range: '2026-27' },
  { year: 2026, range: '2025-26' },
  { year: 2025, range: '2025-26' },
  { year: 2025, range: '2024-25' },
  { year: 2026, range: '2024-25' },
];

async function main() {
  const DRY_RUN = !process.argv.includes('--execute');
  logger.info({ mode: DRY_RUN ? 'DRY-RUN (no writes; --execute to persist)' : 'EXECUTE (writing)' }, 'Stuck-listing backfill start (#70)');

  // 1. Deterministic listing source (paginated).
  const listingRows = await fetchChittorgarhListingRows(FISCAL_YEARS, 10);
  logger.info({ listingRows: listingRows.length }, 'Chittorgarh listing rows fetched');

  // 2. Stuck set (READ-ONLY): genuine IPO, CLOSED, close_date > 21d old, no listing_date.
  const stuckRows = await db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      symbol: schema.ipos.symbol,
      isin: schema.ipos.isin,
      segment: schema.ipos.segment,
      offeringType: schema.ipos.offeringType,
      status: schema.ipos.status,
      openDate: schema.ipos.openDate,
      closeDate: schema.ipos.closeDate,
      listingDate: schema.ipos.listingDate,
      priceRangeMax: schema.ipos.priceRangeMax,
      issueSize: schema.ipos.issueSize,
    })
    .from(schema.ipos)
    .where(
      and(
        eq(schema.ipos.offeringType, 'IPO'),
        eq(schema.ipos.status, 'CLOSED'),
        isNull(schema.ipos.listingDate),
        lt(schema.ipos.closeDate, sql`now() - interval '21 days'`)
      )
    );

  logger.info({ stuck: stuckRows.length }, 'Stuck CLOSED IPOs loaded (read-only)');

  const redis = getRedisClient();
  const ipoRepo = new IPORepository(db, redis);
  const lpRepo = new ListingPerformanceRepository(db, redis);

  let matched = 0, wouldAdvance = 0, implausible = 0, written = 0;
  const byMethod: Record<string, number> = {};
  const samples: string[] = [];

  let errors = 0;
  for (const ipo of stuckRows as StuckIpo[]) {
   try {
    const best = findBestListingMatch(ipo, listingRows);
    if (!best) continue;
    matched++;
    byMethod[best.method] = (byMethod[best.method] || 0) + 1;

    const lp = buildListingPerformanceRecord(ipo, best.row);
    const gain = lp.listingGainPercent ? parseFloat(lp.listingGainPercent) : null;
    if (!isPlausibleListingGain(gain)) {
      implausible++;
      logger.warn({ company: ipo.companyName, gain }, 'Implausible listing gain — skipping (needs review)');
      continue;
    }
    wouldAdvance++;

    if (samples.length < 12) {
      samples.push(
        `${ipo.companyName} [${best.method}] -> LISTED ${lp.listingDate} @ ₹${lp.listingPrice} (issue ₹${lp.issuePrice}, gain ${lp.listingGainPercent}%)`
      );
    }

    if (DRY_RUN) {
      logger.info(
        { company: ipo.companyName, method: best.method, listingDate: lp.listingDate, listingPrice: lp.listingPrice, gain: lp.listingGainPercent },
        '[DRY-RUN] would advance CLOSED->LISTED + write listing_performance'
      );
    } else {
      const scraped = buildListingScrapedIPO(ipo, best.row);
      // T-318 (Phase-1 completion): resolve identity ONCE here instead of
      // letting upsertIPO re-resolve independently (one of the 6 direct
      // callers named in review-round2 P1-2/C2).
      const preResolvedIPO = await resolveIpoRow(ipoRepo, {
        companyName: ipo.companyName,
        normalizedName: normalizeCompanyNameForMatching(ipo.companyName),
        slug: ipo.slug,
        isin: ipo.isin,
        symbol: ipo.symbol,
      });
      await upsertIPO(ipoRepo, scraped, 'CHITTORGARH', preResolvedIPO);
      await lpRepo.upsert(lp);
      written++;
    }
   } catch (err) {
     // Per-IPO isolation: one bad row must not strand the rest of the batch.
     errors++;
     logger.warn({ company: ipo.companyName, error: err instanceof Error ? err.message : String(err) }, 'backfill row failed (continuing)');
   }
  }

  console.log('\n' + '='.repeat(70));
  console.log('STUCK-LISTING BACKFILL REPORT (#70)');
  console.log('='.repeat(70));
  console.log(`Mode:            ${DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE'}`);
  console.log(`Listing rows:    ${listingRows.length} (Chittorgarh report-25)`);
  console.log(`Stuck IPOs:      ${stuckRows.length}`);
  console.log(`Matched:         ${matched}  (${JSON.stringify(byMethod)})`);
  console.log(`Would advance:   ${wouldAdvance}  CLOSED->LISTED`);
  console.log(`Implausible:     ${implausible} (skipped, need review)`);
  console.log(`Unmatched:       ${stuckRows.length - matched}  (residual -> sub-issue / older FYs)`);
  if (!DRY_RUN) console.log(`Written:         ${written}`);
  console.log(`Row errors:      ${errors} (isolated, batch continued)`);
  console.log('\nSamples:');
  for (const s of samples) console.log('  ' + s);
  console.log('='.repeat(70) + '\n');

  process.exit(0);
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Stuck-listing backfill failed');
  process.exit(1);
});
