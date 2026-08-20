#!/usr/bin/env tsx
/**
 * Phase 5: Listing Performance Backfill Script
 *
 * **Mission:** Improve listing performance coverage from 37.2% to 90%+ (445+ IPOs)
 *
 * **Current State (from data-consistency-tests.md):**
 * - Total LISTED IPOs: 388
 * - IPOs with listing_performance: 77 (19.85%)
 * - Missing listing_performance: 311 (80.15%)
 * - **Target:** 90%+ coverage (350+ IPOs)
 *
 * **Data Sources (Priority Order):**
 * 1. NSE API `/api/public-past-issues` - 1,268 historical IPOs with listing prices
 * 2. BSE API - Real-time/historical price data
 * 3. Moneycontrol - Scrape from IPO detail pages
 * 4. Manual CSV - Last resort for very old IPOs
 *
 * **Strategy:**
 * - Leverage existing `listing-performance-updater.ts` for NSE data
 * - Add BSE fallback for IPOs not found in NSE
 * - Add Moneycontrol scraping for remaining gaps
 * - Provide manual entry CSV template for final 5-10%
 *
 * **Success Criteria:**
 * - Listing performance coverage >= 90% (350+ IPOs)
 * - All data validated (listing_price > 0, dates valid)
 * - Cache invalidated after backfill
 */

import { pathToFileURL } from 'node:url';
import { eq, and, sql, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';
import { fetchPastIPOs } from '../scrapers/nse-api-client.js';
import logger from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

export interface BackfillResult {
  // Coverage metrics
  totalListedIPOs: number;
  existingRecords: number;
  missingRecords: number;
  targetCoverage: number; // 90%

  // Results by source
  nseMatches: number;
  bseMatches: number;
  moneycontrolMatches: number;
  manualRequired: number;

  // Data quality
  newRecordsCreated: number;
  recordsUpdated: number;
  validationFailures: number;

  // Output
  duration: number;
  timestamp: string;
  manualEntryCsvPath: string | null;
  coverageImprovement: {
    before: number;
    after: number;
    improvement: number;
  };
}

/**
 * Fetch listing price from BSE API for a given scrip code
 */
async function fetchBSEListingData(
  bseCode: string,
  companyName: string
): Promise<{
  listingPrice: number | null;
  listingDate: string | null;
  currentPrice: number | null;
} | null> {
  try {
    // BSE Historical data API
    const url = `https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=${bseCode}&flag=0&fromdate=&todate=&seriesid=`;

    const response = await fetch(url);

    if (!response.ok) {
      logger.debug({ bseCode, status: response.status }, 'BSE API failed');
      return null;
    }

    const data = await response.json();

    // Extract listing price and date
    const listingPrice = data?.Data?.[0]?.CurrRate?.LTP || null;
    const listingDate = data?.Data?.[0]?.TDate || null;
    const currentPrice = data?.ltp || listingPrice;

    if (listingPrice && typeof listingPrice === 'number' && listingPrice > 0) {
      return {
        listingPrice: Math.round(listingPrice),
        listingDate: listingDate ? new Date(listingDate).toISOString().split('T')[0] : null,
        currentPrice: currentPrice ? Math.round(currentPrice) : null,
      };
    }

    return null;
  } catch (error) {
    logger.debug({ bseCode, error }, 'BSE fetch error');
    return null;
  }
}

/**
 * Scrape listing data from Moneycontrol IPO detail page
 * Uses the IPO slug to construct the URL
 */
async function scrapeMoneycontrolListing(
  ipoSlug: string,
  companyName: string
): Promise<{
  listingPrice: number | null;
  listingGain: number | null;
} | null> {
  try {
    // Moneycontrol IPO detail URL pattern
    const url = `https://www.moneycontrol.com/ipo/${ipoSlug}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      logger.debug({ ipoSlug, status: response.status }, 'Moneycontrol fetch failed');
      return null;
    }

    const html = await response.text();

    // Parse listing price using regex
    const listingPriceMatch = html.match(/Listing Price[^₹]*₹\s*([\d,]+(?:\.\d+)?)/i);
    const listingGainMatch = html.match(/Listing Gain[^%]*(\-?[\d,]+(?:\.\d+)?)\s*%/i);

    if (listingPriceMatch) {
      const listingPrice = parseFloat(listingPriceMatch[1].replace(/,/g, ''));
      const listingGain = listingGainMatch ? parseFloat(listingGainMatch[1]) : null;

      if (!isNaN(listingPrice) && listingPrice > 0) {
        return {
          listingPrice: Math.round(listingPrice),
          listingGain,
        };
      }
    }

    return null;
  } catch (error) {
    logger.debug({ ipoSlug, error }, 'Moneycontrol scrape error');
    return null;
  }
}

/**
 * Generate manual entry CSV for IPOs that couldn't be backfilled
 */
async function generateManualEntryCsv(
  ipos: Array<{
    id: string;
    companyName: string;
    symbol: string | null;
    slug: string;
    listingDate: string | null;
    priceRangeMax: number | null;
  }>
): Promise<string> {
  const csvPath = path.join(process.cwd(), 'manual-listing-entries.csv');

  const csvHeader = 'ipo_id,company_name,symbol,slug,listing_date,listing_price,issue_price,listing_gain_percent,notes\n';

  const csvRows = ipos.map(ipo => {
    return `${ipo.id},"${ipo.companyName}",${ipo.symbol || 'N/A'},${ipo.slug},${ipo.listingDate || 'UNKNOWN'},,,,"Please research and fill"`;
  }).join('\n');

  await fs.writeFile(csvPath, csvHeader + csvRows, 'utf-8');

  logger.info({ csvPath, count: ipos.length }, 'Manual entry CSV generated');

  return csvPath;
}

/**
 * Main backfill function
 */
export async function backfillListingPerformance(): Promise<BackfillResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Safety: dry-run by default discipline (.claude/rules backfill-script). Pass --execute to write.
  const DRY_RUN = !process.argv.includes('--execute');
  logger.info({ mode: DRY_RUN ? 'DRY-RUN (no writes; pass --execute to persist)' : 'EXECUTE (writing to DB)' }, 'Starting Phase 5: Listing Performance Backfill');

  let totalListedIPOs = 0;
  let existingRecords = 0;
  let nseMatches = 0;
  let bseMatches = 0;
  let moneycontrolMatches = 0;
  let newRecordsCreated = 0;
  let recordsUpdated = 0;
  let validationFailures = 0;

  try {
    const redis = getRedisClient();
    const repository = new ListingPerformanceRepository(db, redis);

    // Step 1: Fetch all LISTED IPOs without listing_performance
    logger.info('Fetching LISTED IPOs without listing_performance records');

    const iposWithoutListing = await db
      .select({
        id: schema.ipos.id,
        companyName: schema.ipos.companyName,
        symbol: schema.ipos.symbol,
        slug: schema.ipos.slug,
        listingDate: schema.ipos.listingDate,
        priceRangeMin: schema.ipos.priceRangeMin,
        priceRangeMax: schema.ipos.priceRangeMax,
      })
      .from(schema.ipos)
      .leftJoin(
        schema.listingPerformance,
        eq(schema.ipos.id, schema.listingPerformance.ipoId)
      )
      .where(
        and(
          eq(schema.ipos.status, 'LISTED'),
          isNull(schema.listingPerformance.ipoId) // No listing performance record
        )
      );

    // Count total LISTED IPOs and existing records
    const allListedIPOs = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ipos)
      .where(eq(schema.ipos.status, 'LISTED'));

    totalListedIPOs = allListedIPOs[0]?.count || 0;

    const existingPerformance = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.listingPerformance);

    existingRecords = existingPerformance[0]?.count || 0;

    const missingRecords = iposWithoutListing.length;
    const targetCoverage = Math.ceil(totalListedIPOs * 0.90); // 90% target

    logger.info({
      totalListedIPOs,
      existingRecords,
      missingRecords,
      targetCoverage,
      coveragePercent: ((existingRecords / totalListedIPOs) * 100).toFixed(2)
    }, 'Current coverage status');

    // Step 2: Fetch NSE historical data
    logger.info('Fetching NSE historical IPO data');
    const { pastIPOs: nseHistoricalData } = await fetchPastIPOs();
    logger.info({
      nseRecordsCount: nseHistoricalData.length
    }, 'NSE historical data fetched');

    // Create lookup map: symbol -> NSE data
    const nseDataMap = new Map(
      nseHistoricalData.map(ipo => [ipo.symbol?.toUpperCase(), ipo])
    );

    // Step 3: Process each missing IPO
    const manualEntryRequired: typeof iposWithoutListing = [];

    for (const ipo of iposWithoutListing) {
      try {
        const symbol = ipo.symbol?.toUpperCase();
        let listingData: ListingPerformanceInsert | null = null;
        let source: 'NSE' | 'BSE' | 'Moneycontrol' | null = null;

        // Try NSE first
        if (symbol) {
          const nseData = nseDataMap.get(symbol);

          if (nseData && nseData.listingPrice) {
            const listingPrice = parseFloat(String(nseData.listingPrice));
            const issuePrice = parseFloat(String(nseData.issuePrice || '').replace(/\s+/g, '')) || ipo.priceRangeMax;

            if (!isNaN(listingPrice) && listingPrice > 0) {
              const listingGainPercent = issuePrice && issuePrice > 0
                ? ((listingPrice - issuePrice) / issuePrice) * 100
                : null;

              listingData = {
                ipoId: ipo.id,
                symbol: ipo.symbol,
                companyName: ipo.companyName,
                listingDate: nseData.listingDate || ipo.listingDate || null,
                listingPrice: Math.round(listingPrice),
                issuePrice: issuePrice ? Math.round(issuePrice) : null,
                listingGainPercent: listingGainPercent ? listingGainPercent.toFixed(2) : null,
                currentPrice: null,
                currentPriceBSE: null,
                currentPriceNSE: null,
                currentGainPercent: null,
                dataSource: 'NSE_PAST_API',
              };

              source = 'NSE';
              nseMatches++;
            }
          }
        }

        // Fallback to BSE if NSE failed (placeholder - BSE scrip code needed)
        // In production, you would need to maintain a mapping of symbol -> BSE scrip code
        // or fetch it from BSE search API

        // Fallback to Moneycontrol if BSE failed
        if (!listingData) {
          const mcData = await scrapeMoneycontrolListing(ipo.slug, ipo.companyName);

          if (mcData && mcData.listingPrice) {
            listingData = {
              ipoId: ipo.id,
              symbol: ipo.symbol,
              companyName: ipo.companyName,
              listingDate: ipo.listingDate || null,
              listingPrice: mcData.listingPrice,
              issuePrice: ipo.priceRangeMax ? Math.round(ipo.priceRangeMax) : null,
              listingGainPercent: mcData.listingGain ? mcData.listingGain.toString() : null,
              currentPrice: null,
              currentPriceBSE: null,
              currentPriceNSE: null,
              currentGainPercent: null,
              dataSource: 'SCRAPER',
            };

            source = 'Moneycontrol';
            moneycontrolMatches++;
          }
        }

        // If we found data, upsert it
        if (listingData) {
          // Validate data
          if (!listingData.listingPrice || listingData.listingPrice <= 0) {
            validationFailures++;
            logger.warn({
              symbol: ipo.symbol,
              companyName: ipo.companyName,
              reason: 'Invalid listing price'
            }, 'Validation failed');
            manualEntryRequired.push(ipo);
            continue;
          }

          if (DRY_RUN) {
            logger.info({ symbol: ipo.symbol, companyName: ipo.companyName, listingPrice: listingData.listingPrice, issuePrice: listingData.issuePrice, listingGainPercent: listingData.listingGainPercent, source }, '[DRY-RUN] would upsert listing_performance');
          } else {
            await repository.upsert(listingData);
          }
          newRecordsCreated++;

          logger.info({
            symbol: ipo.symbol,
            companyName: ipo.companyName,
            source,
            listingPrice: listingData.listingPrice,
            listingGain: listingData.listingGainPercent
          }, 'Listing performance backfilled');
        } else {
          // No data found, mark for manual entry
          manualEntryRequired.push(ipo);
        }

        // Rate limiting - 100ms delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        validationFailures++;
        logger.error({
          ipoId: ipo.id,
          symbol: ipo.symbol,
          companyName: ipo.companyName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to backfill listing performance');
        manualEntryRequired.push(ipo);
      }
    }

    // Step 4: Generate manual entry CSV
    let manualEntryCsvPath: string | null = null;
    if (manualEntryRequired.length > 0) {
      manualEntryCsvPath = await generateManualEntryCsv(manualEntryRequired);
    }

    const duration = Date.now() - startTime;
    const finalCoverage = existingRecords + newRecordsCreated;
    const coveragePercent = (finalCoverage / totalListedIPOs) * 100;

    const result: BackfillResult = {
      totalListedIPOs,
      existingRecords,
      missingRecords,
      targetCoverage,
      nseMatches,
      bseMatches,
      moneycontrolMatches,
      manualRequired: manualEntryRequired.length,
      newRecordsCreated,
      recordsUpdated,
      validationFailures,
      duration,
      timestamp,
      manualEntryCsvPath,
      coverageImprovement: {
        before: (existingRecords / totalListedIPOs) * 100,
        after: coveragePercent,
        improvement: coveragePercent - (existingRecords / totalListedIPOs) * 100,
      },
    };

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: LISTING PERFORMANCE BACKFILL REPORT');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log('');
    console.log('Coverage:');
    console.log(`  Total LISTED IPOs: ${totalListedIPOs}`);
    console.log(`  Before: ${existingRecords} (${result.coverageImprovement.before.toFixed(2)}%)`);
    console.log(`  After: ${finalCoverage} (${result.coverageImprovement.after.toFixed(2)}%)`);
    console.log(`  Improvement: +${newRecordsCreated} records (+${result.coverageImprovement.improvement.toFixed(2)}%)`);
    console.log(`  Target: ${targetCoverage} (90%)`);
    console.log(`  Achievement: ${coveragePercent >= 90 ? '✅ ACHIEVED' : '⚠️  PARTIAL'}`);
    console.log('');
    console.log('Data Sources:');
    console.log(`  NSE API: ${nseMatches}`);
    console.log(`  BSE API: ${bseMatches}`);
    console.log(`  Moneycontrol: ${moneycontrolMatches}`);
    console.log(`  Manual Required: ${manualEntryRequired.length}`);
    console.log('');
    console.log('Quality:');
    console.log(`  New Records: ${newRecordsCreated}`);
    console.log(`  Validation Failures: ${validationFailures}`);
    console.log('');
    if (manualEntryCsvPath) {
      console.log(`Manual Entry CSV: ${manualEntryCsvPath}`);
      console.log('  Please review and manually fill the CSV, then import using:');
      console.log('  npm run import:manual-listing-data');
    }
    console.log('='.repeat(80) + '\n');

    logger.info(result, 'Listing performance backfill completed');

    return result;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Listing performance backfill failed');

    return {
      totalListedIPOs,
      existingRecords,
      missingRecords: 0,
      targetCoverage: 0,
      nseMatches: 0,
      bseMatches: 0,
      moneycontrolMatches: 0,
      manualRequired: 0,
      newRecordsCreated,
      recordsUpdated,
      validationFailures,
      duration: Date.now() - startTime,
      timestamp,
      manualEntryCsvPath: null,
      coverageImprovement: {
        before: 0,
        after: 0,
        improvement: 0,
      },
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await backfillListingPerformance();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Backfill script failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
