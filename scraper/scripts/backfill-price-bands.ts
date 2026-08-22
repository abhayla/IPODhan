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
 * Run:
 * cd scraper
 * npx tsx scripts/backfill-price-bands.ts             # apply
 * npx tsx scripts/backfill-price-bands.ts --dry-run   # report only, no writes
 *
 * @module scraper/scripts/backfill-price-bands
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { sql, isNull, or } from 'drizzle-orm';
import logger from '../src/utils/logger.js';
import { invalidateIPOCaches } from '../src/services/cache-invalidator.js';
import {
  matchNSEPastIssue,
  parsePriceRange,
  type NSEPastIssue,
} from '../src/services/nse-past-issue-matcher.js';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Fetch NSE past IPO data from API
 */
async function fetchNSEPastIPOs(): Promise<NSEPastIssue[]> {
  const BASE_URL = 'https://www.nseindia.com';
  const ENDPOINT = '/api/public-past-issues';

  logger.info('Fetching NSE past IPO data...');

  try {
    // Step 1: Initialize session by visiting homepage
    const homepageResponse = await fetch(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const homepageCookies = homepageResponse.headers.getSetCookie?.() || [];
    const cookieHeader = homepageCookies.map(c => c.split(';')[0]).join('; ');

    // Wait 1.5 seconds (human-like behavior)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 2: Fetch past IPO data with cookies
    const apiResponse = await fetch(BASE_URL + ENDPOINT, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
        'Cookie': cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`NSE API returned ${apiResponse.status}: ${apiResponse.statusText}`);
    }

    const data = await apiResponse.json() as NSEPastIssue[];

    if (!Array.isArray(data)) {
      throw new Error('NSE API returned non-array response');
    }

    logger.info({ ipoCount: data.length }, 'NSE past IPO data fetched successfully');
    return data;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to fetch NSE past IPO data');
    throw error;
  }
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
        or(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax),
          // F5: collapsed - both set but equal (min = max), the 232-row bug.
          sql`${ipos.priceRangeMin} = ${ipos.priceRangeMax}`
        )
      );

    console.log(`Found ${iposWithoutPriceBands.length} IPOs without a real price band\n`);

    if (iposWithoutPriceBands.length === 0) {
      console.log('✅ No IPOs need price band backfill!\n');
      process.exit(0);
    }

    // Step 2: Fetch NSE past IPO data
    console.log('Step 2: Fetching NSE past IPO data...\n');
    const nseIPOs = await fetchNSEPastIPOs();

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
      try {
        // T-270: only a CONFIDENT identity match (exact symbol, or a unique
        // normalized name) is accepted. The old fuzzy name-overlap scorer
        // produced false positives that wrote wrong bands into 80 prod rows.
        const match = matchNSEPastIssue(dbIPO, nseIPOs);

        if (!match) {
          console.log(`⚠️  No confident match: ${dbIPO.companyName}`);
          notFound++;
          continue;
        }

        const nseIPO = match.issue;
        const priceRange = parsePriceRange(nseIPO.priceRange);

        if (!priceRange) {
          console.log(`⚠️  Invalid price range: ${dbIPO.companyName} (${nseIPO.priceRange})`);
          failed++;
          continue;
        }

        // NSE itself only carries a single price for this IPO (fixed-price
        // issue, or its own data is incomplete) - nothing to fix here.
        if (priceRange.min === priceRange.max && dbIPO.priceRangeMin === priceRange.min) {
          console.log(`ℹ️  Already correct (no range on NSE either): ${dbIPO.companyName}`);
          continue;
        }

        if (DRY_RUN) {
          console.log(`🔎 Would update: ${dbIPO.companyName} → ₹${priceRange.min}-₹${priceRange.max} (matched by ${match.matchedBy}: ${nseIPO.company}/${nseIPO.symbol ?? '-'})`);
          updated++;
          continue;
        }

        // Update database
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

        console.log(`✅ Updated: ${dbIPO.companyName} → ₹${priceRange.min}-₹${priceRange.max} (matched by ${match.matchedBy}: ${nseIPO.company}/${nseIPO.symbol ?? '-'})`);
        updated++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error updating ${dbIPO.companyName}:`, error instanceof Error ? error.message : String(error));
        failed++;
      }
    }

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
        or(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax),
          sql`${ipos.priceRangeMin} = ${ipos.priceRangeMax}`
        )
      );

    const totalIPOs = await db.select({ count: sql<number>`count(*)` }).from(ipos);
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
