/**
 * Backfill Missing / Collapsed Price Bands
 *
 * Fixes Phase 5 data quality issue: originally 493/495 IPOs (99.6%) missing
 * price band data.
 *
 * F5 (T-264 P2-1): field-priority-matrix.ts registered the band under
 * snake_case `price_band_min`/`price_band_max` while consolidation actually
 * keys on camelCase `priceRangeMin`/`priceRangeMax` (fixed in this same
 * change), so `getFieldRules('priceRangeMin')` fell through to the DEFAULT
 * rule with no validation - a stale single-price write (e.g. from an early
 * scrape before the full band was known) was never re-consolidated even
 * though later cycles carried the real range. Result: 232/267 IPO rows
 * (87%) had `price_range_min = price_range_max`, showing a single price
 * where NSE/Chittorgarh/IPOWatch all agree it is a range. This script also
 * targets that COLLAPSED case, not just the NULL case the name implies.
 *
 * This script:
 * 1. Queries database for IPOs with missing OR collapsed price_range_min/max
 * 2. Uses NSE public-past-issues API to fetch price range data
 * 3. Updates database with price band information
 * 4. Purges the affected list/detail caches so the fix is visible immediately
 * 5. Provides progress reporting and error handling
 *
 * T-276 hardening (this script has a corruption history - T-268F wrote 80 wrong
 * bands through a fuzzy name matcher; see evidence/2026-08-22-T-270/ROOT-CAUSE.md):
 *   - `--identity=symbol` (DEFAULT) accepts ONLY an exact stock-symbol match.
 *     The normalized-name fallback must be opted into with `--identity=symbol+name`,
 *     and even that is exact-after-normalization, never fuzzy.
 *     (NSE's two band endpoints carry no ISIN, so symbol is the only exact
 *     identifier available - see fetchNSEBandSources.)
 *   - A DEGENERATE source band (min === max) is NEVER written. A single price is
 *     not a band; writing one is what produced the 82% collapse in the first place.
 *   - `--csv=<path>` writes a per-row before/after ledger with the matching
 *     provenance (endpoint, matched symbol, raw NSE string) so a dry run is
 *     reviewable BEFORE any write, and an applied run is auditable after.
 *   - Bands are read from BOTH `/api/all-upcoming-issues?category=ipo` (live and
 *     recently-closed issues, `issuePrice`) and `/api/public-past-issues`
 *     (historical, `priceRange`), upcoming first - a currently-OPEN IPO is absent
 *     from past-issues, which is why the open rows stayed wrong.
 *
 * Run:
 * cd scraper
 * npx tsx scripts/backfill-price-bands.ts --dry-run --csv=../dry-run.csv   # review first
 * npx tsx scripts/backfill-price-bands.ts --csv=../applied.csv             # apply
 *
 * @module scraper/scripts/backfill-price-bands
 */

import fs from 'node:fs';
import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { and, eq, sql, isNull, or } from 'drizzle-orm';
import logger from '../src/utils/logger.js';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import {
  matchNSEPastIssue,
  parsePriceRange,
  type NSEPastIssue,
} from '../src/services/nse-past-issue-matcher.js';

const DRY_RUN = process.argv.includes('--dry-run');

/** Exact-identifier-only by default - see the T-276 note above. */
const IDENTITY: 'symbol' | 'symbol+name' =
  process.argv.includes('--identity=symbol+name') ? 'symbol+name' : 'symbol';

const CSV_PATH = (process.argv.find(a => a.startsWith('--csv=')) || '').slice('--csv='.length);

interface LedgerRow {
  slug: string;
  companyName: string;
  dbSymbol: string;
  beforeMin: string;
  beforeMax: string;
  afterMin: string;
  afterMax: string;
  action: string;
  matchedBy: string;
  sourceEndpoint: string;
  sourceCompany: string;
  sourceSymbol: string;
  sourceRaw: string;
}

const ledger: LedgerRow[] = [];

function csvCell(v: unknown): string {
  const str = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function writeLedger(): void {
  if (!CSV_PATH) return;
  const header: (keyof LedgerRow)[] = [
    'slug', 'companyName', 'dbSymbol', 'beforeMin', 'beforeMax', 'afterMin', 'afterMax',
    'action', 'matchedBy', 'sourceEndpoint', 'sourceCompany', 'sourceSymbol', 'sourceRaw',
  ];
  const lines = [header.join(',')];
  for (const row of ledger) lines.push(header.map(h => csvCell(row[h])).join(','));
  fs.writeFileSync(CSV_PATH, lines.join('\n') + '\n', 'utf8');
  console.log('\nLedger written: ' + CSV_PATH + ' (' + ledger.length + ' rows)\n');
}

/**
 * Fetch the price band from BOTH NSE endpoints that publish one, normalized into
 * the `NSEPastIssue` shape the matcher consumes.
 *
 * `/api/all-upcoming-issues?category=ipo` carries live + recently-closed issues
 * (band in `issuePrice`, e.g. "Rs.285 to Rs.300"); `/api/public-past-issues`
 * carries the ~1400-row history (band in `priceRange`). An IPO that is OPEN today
 * is absent from past-issues entirely - fetching only that endpoint is why the
 * currently-open rows were never repairable.
 *
 * Upcoming is listed FIRST so the matcher's exact-symbol filter resolves to the
 * live row when an issue appears in both. Neither endpoint carries an ISIN, so
 * `symbol` is the only exact identifier available.
 */
async function fetchNSEBandSources(): Promise<Array<NSEPastIssue & { endpoint: string }>> {
  const BASE_URL = 'https://www.nseindia.com';
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  logger.info('Fetching NSE price-band sources...');

  const homepageResponse = await fetch(BASE_URL, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
  });
  const cookieHeader = (homepageResponse.headers.getSetCookie?.() || [])
    .map(c => c.split(';')[0])
    .join('; ');

  // Human-like pause; NSE rate-limits aggressive clients.
  await new Promise(resolve => setTimeout(resolve, 1500));

  const get = async (path: string): Promise<any> => {
    const response = await fetch(BASE_URL + path, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
        'Cookie': cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    if (!response.ok) throw new Error(`NSE ${path} returned ${response.status}: ${response.statusText}`);
    return response.json();
  };

  const combined: Array<NSEPastIssue & { endpoint: string }> = [];

  const UPCOMING = '/api/all-upcoming-issues?category=ipo';
  const PAST = '/api/public-past-issues';

  const upcoming = await get(UPCOMING);
  if (!Array.isArray(upcoming)) throw new Error(`NSE ${UPCOMING} returned a non-array response`);
  for (const row of upcoming) {
    combined.push({
      company: row.companyName,
      symbol: row.symbol,
      // This endpoint publishes the band under `issuePrice` ("Rs.285 to Rs.300").
      priceRange: row.issuePrice,
      ipoStartDate: row.issueStartDate,
      ipoEndDate: row.issueEndDate,
      endpoint: UPCOMING,
    });
  }

  await new Promise(resolve => setTimeout(resolve, 1200));

  const past = await get(PAST);
  if (!Array.isArray(past)) throw new Error(`NSE ${PAST} returned a non-array response`);
  for (const row of past) {
    combined.push({
      company: row.company,
      symbol: row.symbol,
      priceRange: row.priceRange,
      ipoStartDate: row.ipoStartDate,
      ipoEndDate: row.ipoEndDate,
      listingDate: row.listingDate,
      endpoint: PAST,
    });
  }

  logger.info(
    { upcoming: upcoming.length, past: past.length, total: combined.length },
    'NSE price-band sources fetched'
  );
  return combined;
}

/**
 * Main backfill function
 */
async function backfillPriceBands() {
  console.log('========================================');
  console.log('Backfill Missing / Collapsed Price Bands');
  if (DRY_RUN) console.log('(DRY RUN - no database writes)');
  console.log('========================================\n');

  try {
    // Step 1: Get IPOs with missing OR collapsed price bands
    console.log('Step 1: Querying IPOs with missing/collapsed price bands...\n');

    const iposWithoutPriceBands = await db.select({
      id: ipos.id,
      companyName: ipos.companyName,
      symbol: ipos.symbol,
      slug: ipos.slug,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax
    })
      .from(ipos)
      .where(
        and(
          // T-276: IPO rows ONLY. NSE's band endpoints are IPO endpoints, and a
          // RIGHTS/NCD row on an already-listed company shares that company's
          // stock symbol - an exact-symbol match would happily write the old IPO
          // band onto a rights issue.
          eq(ipos.offeringType, 'IPO'),
          or(
            isNull(ipos.priceRangeMin),
            isNull(ipos.priceRangeMax),
            // F5: collapsed - both set but equal (min = max), the 232-row bug.
            sql`${ipos.priceRangeMin} = ${ipos.priceRangeMax}`
          )
        )
      );

    console.log(`Found ${iposWithoutPriceBands.length} IPOs without a real price band\n`);

    if (iposWithoutPriceBands.length === 0) {
      console.log('✅ No IPOs need price band backfill!\n');
      process.exit(0);
    }

    // Step 2: Fetch NSE band sources (upcoming + past)
    console.log('Step 2: Fetching NSE price-band sources (upcoming + past)...\n');
    const nseIPOs = await fetchNSEBandSources();

    if (nseIPOs.length === 0) {
      console.log('❌ No NSE IPO data available for backfill\n');
      process.exit(1);
    }

    // Step 3: Match and update
    console.log('Step 3: Matching and updating price bands...\n');

    let updated = 0;
    let notFound = 0;
    let failed = 0;

    for (const dbIPO of iposWithoutPriceBands) {
      const before = {
        slug: dbIPO.slug,
        companyName: dbIPO.companyName,
        dbSymbol: dbIPO.symbol ?? '',
        beforeMin: dbIPO.priceRangeMin ?? '',
        beforeMax: dbIPO.priceRangeMax ?? '',
      };
      const skip = (action: string, matchedBy = '', src?: NSEPastIssue & { endpoint: string }) => {
        ledger.push({
          ...before,
          beforeMin: String(before.beforeMin),
          beforeMax: String(before.beforeMax),
          afterMin: '',
          afterMax: '',
          action,
          matchedBy,
          sourceEndpoint: src?.endpoint ?? '',
          sourceCompany: src?.company ?? '',
          sourceSymbol: src?.symbol ?? '',
          sourceRaw: src?.priceRange ?? '',
        });
      };

      try {
        // T-270/T-276: only a CONFIDENT identity match writes. `--identity=symbol`
        // (the default) is exact-symbol ONLY - the fuzzy name-overlap scorer that
        // preceded this wrote wrong bands into 80 live rows.
        const match = matchNSEPastIssue(dbIPO, nseIPOs, IDENTITY);

        if (!match) {
          console.log(`No confident match: ${dbIPO.companyName}`);
          skip('SKIP_NO_MATCH');
          notFound++;
          continue;
        }

        const nseIPO = match.issue as NSEPastIssue & { endpoint: string };
        const priceRange = parsePriceRange(nseIPO.priceRange);

        if (!priceRange) {
          console.log(`Unparseable price range: ${dbIPO.companyName} (${nseIPO.priceRange})`);
          skip('SKIP_UNPARSEABLE', match.matchedBy, nseIPO);
          failed++;
          continue;
        }

        // T-276 HARD RULE: never write a zero-width band. NSE reports a single
        // `issuePrice` before a band is announced (and for fixed-price issues);
        // widening that into {min: p, max: p} is exactly the write that produced
        // the 82% collapse. A missing band is honest; a fake one is not.
        if (priceRange.min === priceRange.max) {
          console.log(`Source has no real range (single price ${priceRange.min}): ${dbIPO.companyName}`);
          skip('SKIP_DEGENERATE_SOURCE', match.matchedBy, nseIPO);
          continue;
        }

        // Nothing to change.
        if (dbIPO.priceRangeMin === priceRange.min && dbIPO.priceRangeMax === priceRange.max) {
          skip('SKIP_ALREADY_CORRECT', match.matchedBy, nseIPO);
          continue;
        }

        ledger.push({
          ...before,
          beforeMin: String(before.beforeMin),
          beforeMax: String(before.beforeMax),
          afterMin: String(priceRange.min),
          afterMax: String(priceRange.max),
          action: DRY_RUN ? 'WOULD_UPDATE' : 'UPDATED',
          matchedBy: match.matchedBy,
          sourceEndpoint: nseIPO.endpoint,
          sourceCompany: nseIPO.company,
          sourceSymbol: nseIPO.symbol ?? '',
          sourceRaw: nseIPO.priceRange ?? '',
        });

        if (DRY_RUN) {
          console.log(`Would update: ${dbIPO.companyName} ${dbIPO.priceRangeMin}-${dbIPO.priceRangeMax} -> ${priceRange.min}-${priceRange.max} (${match.matchedBy}: ${nseIPO.symbol ?? '-'} @ ${nseIPO.endpoint})`);
          updated++;
          continue;
        }

        await db.update(ipos)
          .set({
            priceRangeMin: priceRange.min,
            priceRangeMax: priceRange.max,
            updatedAt: new Date()
          })
          .where(sql`${ipos.id} = ${dbIPO.id}`);

        // Keep the site consistent with the write - purge this IPO's cached
        // detail/list entries so the corrected band is visible immediately
        // instead of waiting out CacheTTL.IPO_DETAIL/IPO_LIST.
        try {
          const redis = getRedisClient();
          await invalidateIPOCaches(redis, dbIPO.slug);
        } catch (cacheError) {
          logger.warn(
            { slug: dbIPO.slug, error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
            'Cache invalidation failed after price band backfill (non-fatal)'
          );
        }

        console.log(`Updated: ${dbIPO.companyName} ${dbIPO.priceRangeMin}-${dbIPO.priceRangeMax} -> ${priceRange.min}-${priceRange.max} (${match.matchedBy}: ${nseIPO.symbol ?? '-'} @ ${nseIPO.endpoint})`);
        updated++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error updating ${dbIPO.companyName}:`, error instanceof Error ? error.message : String(error));
        skip('ERROR');
        failed++;
      }
    }

    writeLedger();

    // Step 4: Summary
    console.log('\n========================================');
    console.log('Backfill Summary');
    console.log('========================================\n');

    console.log(`Total IPOs processed: ${iposWithoutPriceBands.length}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`⚠️  No confident NSE match: ${notFound}`);
    console.log(`❌ Failed to update: ${failed}\n`);

    const successRate = ((updated / iposWithoutPriceBands.length) * 100).toFixed(2);
    console.log(`Success rate: ${successRate}%\n`);

    // Verify improvement
    const remainingWithout = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(
        and(
          eq(ipos.offeringType, 'IPO'),
          or(
            isNull(ipos.priceRangeMin),
            isNull(ipos.priceRangeMax),
            sql`${ipos.priceRangeMin} = ${ipos.priceRangeMax}`
          )
        )
      );

    const totalIPOs = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(eq(ipos.offeringType, 'IPO'));
    const remaining = Number(remainingWithout[0]?.count || 0);
    const total = Number(totalIPOs[0]?.count || 0);
    const coverage = ((total - remaining) / total * 100).toFixed(2);

    console.log('Current coverage:');
    console.log(`  IPOs with price bands: ${total - remaining}/${total} (${coverage}%)`);
    console.log(`  IPOs without price bands: ${remaining}\n`);

    if (parseFloat(coverage) >= 90) {
      console.log('✅ TARGET ACHIEVED: Price band coverage >= 90%\n');
    } else {
      console.log(`⚠️  Target not met: Need ${90 - parseFloat(coverage)}% more coverage\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR: Backfill failed\n');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nStack trace:');
    console.error(error instanceof Error ? error.stack : 'No stack trace available');
    process.exit(1);
  }
}

backfillPriceBands();
