/**
 * Listing Performance Updater
 *
 * ISS-001 Fix: Updates current prices for all LISTED IPOs
 *
 * This scraper addresses the issue where only 77/388 (19.85%) of LISTED IPOs
 * have listing_performance records. It performs two critical functions:
 *
 * 1. **Backfill Gap**: Creates listing_performance records for 311 missing IPOs
 * 2. **Price Updates**: Updates current prices (BSE/NSE) for all listed IPOs
 *
 * Data Sources (priority order):
 * - NSE API: /api/public-past-issues (1,268 historical IPOs with listing prices)
 * - BSE API: Real-time price data
 * - Moneycontrol: Current market prices as fallback
 *
 * Architecture:
 * - Fetches all LISTED IPOs from database
 * - Matches against NSE historical data for initial listing performance
 * - Fetches current prices from NSE/BSE APIs
 * - Upserts to listing_performance table via repository pattern
 * - Invalidates cache after updates
 */

import { eq, and } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';
import { fetchPastIPOs } from './nse-api-client.js';
import logger from '../utils/logger.js';

export interface ListingPerformanceUpdateResult {
  totalListedIPOs: number;
  existingRecords: number;
  newRecordsCreated: number;
  recordsUpdated: number;
  failures: number;
  duration: number;
  timestamp: string;
}

/**
 * Fetch current price from NSE for a given symbol
 * Uses NSE's quote API endpoint
 */
async function fetchNSECurrentPrice(symbol: string): Promise<number | null> {
  try {
    // NSE quote API - provides real-time price data
    const url = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;

    const headers = {
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.nseindia.com/',
      'X-Requested-With': 'XMLHttpRequest'
    };

    const response = await fetch(url, { headers });

    if (!response.ok) {
      logger.debug({ symbol, status: response.status }, 'NSE price fetch failed');
      return null;
    }

    const data = await response.json();
    const price = data?.priceInfo?.lastPrice || data?.lastPrice;

    if (price && typeof price === 'number' && price > 0) {
      return Math.round(price);
    }

    return null;
  } catch (error) {
    logger.debug({ symbol, error }, 'NSE price fetch error');
    return null;
  }
}

/**
 * Fetch current price from BSE for a given symbol/scrip code
 * Uses BSE's stock quote API
 */
async function fetchBSECurrentPrice(bseCode: string): Promise<number | null> {
  try {
    // BSE quote API - provides real-time price data
    const url = `https://api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=${bseCode}&flag=0&fromdate=&todate=&seriesid=`;

    const response = await fetch(url);

    if (!response.ok) {
      logger.debug({ bseCode, status: response.status }, 'BSE price fetch failed');
      return null;
    }

    const data = await response.json();
    const price = data?.Data?.[0]?.CurrRate?.LTP || data?.ltp;

    if (price && typeof price === 'number' && price > 0) {
      return Math.round(price);
    }

    return null;
  } catch (error) {
    logger.debug({ bseCode, error }, 'BSE price fetch error');
    return null;
  }
}

/**
 * Calculate current gain percentage from issue price
 */
function calculateCurrentGain(
  currentPrice: number | null,
  issuePrice: number | null
): string | null {
  if (!currentPrice || !issuePrice || issuePrice === 0) {
    return null;
  }

  const gain = ((currentPrice - issuePrice) / issuePrice) * 100;
  return gain.toFixed(2);
}

/**
 * Main function to update listing performance for all LISTED IPOs
 */
export async function updateListingPerformance(): Promise<ListingPerformanceUpdateResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info('Starting listing performance update (ISS-001 Fix)');

  let totalListedIPOs = 0;
  let existingRecords = 0;
  let newRecordsCreated = 0;
  let recordsUpdated = 0;
  let failures = 0;

  try {
    const redis = getRedisClient();
    const repository = new ListingPerformanceRepository(db, redis);

    // Step 1: Fetch all LISTED IPOs from database
    logger.info('Fetching all LISTED IPOs from database');
    const listedIPOsResult = await db.query.ipos.findMany({
      where: eq(schema.ipos.status, 'LISTED'),
      columns: {
        id: true,
        companyName: true,
        symbol: true,
        listingDate: true,
        priceRangeMin: true,
        priceRangeMax: true,
        bseScripCode: true,
      },
    });

    totalListedIPOs = listedIPOsResult.length;
    logger.info({ totalListedIPOs }, 'Found LISTED IPOs in database');

    // Step 2: Fetch NSE historical data for listing prices
    logger.info('Fetching NSE historical IPO data for listing prices');
    const { pastIPOs: nseHistoricalData } = await fetchPastIPOs();
    logger.info({
      nseRecordsCount: nseHistoricalData.length
    }, 'NSE historical data fetched');

    // Create lookup map: symbol -> NSE historical data
    const nseDataMap = new Map(
      nseHistoricalData.map(ipo => [ipo.symbol?.toUpperCase(), ipo])
    );

    // Step 3: Check which IPOs already have listing_performance records
    const existingPerformanceRecords = await db.query.listingPerformance.findMany({
      columns: {
        ipoId: true,
      },
    });

    const existingIPOIds = new Set(existingPerformanceRecords.map(r => r.ipoId));
    existingRecords = existingPerformanceRecords.length;

    logger.info({
      totalListedIPOs,
      existingRecords,
      missingRecords: totalListedIPOs - existingRecords,
    }, 'Existing listing performance records found');

    // Step 4: Process each LISTED IPO
    for (const ipo of listedIPOsResult) {
      try {
        const symbol = ipo.symbol?.toUpperCase();
        const nseData = symbol ? nseDataMap.get(symbol) : null;

        // Fetch current prices from exchanges
        const currentPriceNSE = symbol ? await fetchNSECurrentPrice(symbol) : null;
        const currentPriceBSE = ipo.bseScripCode
          ? await fetchBSECurrentPrice(ipo.bseScripCode)
          : null;

        // Use NSE price as primary, BSE as fallback
        const currentPrice = currentPriceNSE || currentPriceBSE || null;

        // Parse listing price from NSE data
        let listingPrice: number | null = null;
        if (nseData?.listingPrice) {
          const parsed = parseFloat(String(nseData.listingPrice));
          if (!isNaN(parsed) && parsed > 0) {
            listingPrice = Math.round(parsed);
          }
        }

        // Parse issue price from NSE data
        let issuePrice: number | null = null;
        if (nseData?.issuePrice) {
          const parsed = parseFloat(String(nseData.issuePrice).replace(/\s+/g, ''));
          if (!isNaN(parsed) && parsed > 0) {
            issuePrice = Math.round(parsed);
          }
        }

        // If NSE doesn't have issue price, use IPO's price range max
        if (!issuePrice && ipo.priceRangeMax) {
          issuePrice = Math.round(ipo.priceRangeMax);
        }

        // Calculate listing gain from NSE data
        let listingGainPercent: string | null = null;
        if (listingPrice && issuePrice && issuePrice > 0) {
          const gain = ((listingPrice - issuePrice) / issuePrice) * 100;
          listingGainPercent = gain.toFixed(2);
        }

        // Calculate current gain
        const currentGainPercent = calculateCurrentGain(currentPrice, issuePrice);

        // Use NSE listing date or IPO's listing date
        const listingDate = nseData?.listingDate
          ? new Date(nseData.listingDate).toISOString().split('T')[0]
          : ipo.listingDate;

        // Prepare upsert data
        const performanceData: ListingPerformanceInsert = {
          ipoId: ipo.id,
          symbol: ipo.symbol || null,
          companyName: ipo.companyName,
          listingDate: listingDate || null,
          listingPrice: listingPrice,
          issuePrice: issuePrice,
          listingGainPercent: listingGainPercent,
          currentPrice: currentPrice, // Deprecated field for backward compatibility
          currentPriceBSE: currentPriceBSE,
          currentPriceNSE: currentPriceNSE,
          currentGainPercent: currentGainPercent,
          dataSource: 'NSE_PAST_API',
        };

        // Upsert to database
        await repository.upsert(performanceData);

        // Track statistics
        if (existingIPOIds.has(ipo.id)) {
          recordsUpdated++;
          logger.debug({
            symbol: ipo.symbol,
            companyName: ipo.companyName,
            currentPrice,
            listingPrice
          }, 'Updated listing performance');
        } else {
          newRecordsCreated++;
          logger.info({
            symbol: ipo.symbol,
            companyName: ipo.companyName,
            currentPrice,
            listingPrice
          }, 'Created new listing performance record');
        }

        // Add delay to avoid rate limiting (100ms between requests)
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        failures++;
        logger.error({
          ipoId: ipo.id,
          symbol: ipo.symbol,
          companyName: ipo.companyName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to update listing performance for IPO');
      }
    }

    const duration = Date.now() - startTime;

    const result: ListingPerformanceUpdateResult = {
      totalListedIPOs,
      existingRecords,
      newRecordsCreated,
      recordsUpdated,
      failures,
      duration,
      timestamp,
    };

    logger.info(result, 'Listing performance update completed (ISS-001 Fix)');

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('LISTING PERFORMANCE UPDATE REPORT (ISS-001 Fix)');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log('');
    console.log('Coverage:');
    console.log(`  Total LISTED IPOs: ${totalListedIPOs}`);
    console.log(`  Existing Records: ${existingRecords} (${Math.round(existingRecords/totalListedIPOs*100)}%)`);
    console.log(`  New Records Created: ${newRecordsCreated}`);
    console.log(`  Records Updated: ${recordsUpdated}`);
    console.log(`  Failures: ${failures}`);
    console.log('');
    console.log('Result:');
    console.log(`  Total Coverage: ${existingRecords + newRecordsCreated}/${totalListedIPOs} (${Math.round((existingRecords + newRecordsCreated)/totalListedIPOs*100)}%)`);
    console.log('='.repeat(80) + '\n');

    return result;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      duration,
    }, 'Listing performance update failed (ISS-001)');

    return {
      totalListedIPOs,
      existingRecords,
      newRecordsCreated,
      recordsUpdated,
      failures: failures + 1,
      duration,
      timestamp,
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await updateListingPerformance();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Listing performance updater failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
