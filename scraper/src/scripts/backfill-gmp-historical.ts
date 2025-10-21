#!/usr/bin/env tsx
/**
 * Phase 5: GMP Historical Data Backfill Script
 *
 * **Mission:** Collect time-series GMP (Grey Market Premium) data for active IPOs
 *
 * **Current State (from data-consistency-tests.md):**
 * - Current GMP Records: Only latest snapshots exist (2.63% coverage - 13 IPOs)
 * - Missing: Historical time-series data for trend analysis
 * - **Target:** 30+ days of GMP history for each active IPO (OPEN, UPCOMING, CLOSED)
 *
 * **Data Source:**
 * - Chittorgarh GMP API: https://webnodejs.chittorgarh.com/cloud/...
 * - InvestorGain: Secondary source for GMP data
 * - Target IPOs: Status = OPEN, UPCOMING, CLOSED (not LISTED)
 *
 * **GMP Data Structure:**
 * - gmp: Grey market premium in INR
 * - expected_listing_price: Estimated listing price
 * - subject_rate: Subject/Safalya rate
 * - kostak_rate: Kostak rate
 * - timestamp: When GMP was recorded
 *
 * **Success Criteria:**
 * - Collect 30+ days of GMP history for all active IPOs
 * - No duplicate records (same ipo_id + timestamp)
 * - GMP values within reasonable range (-500 to +500 INR)
 */

import { eq, inArray, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { GMPRepository } from '@ipodhan/shared/repositories/gmp-repository';
import type { GMPRecordInsert } from '@ipodhan/shared/repositories/types';
import logger from '../utils/logger.js';

export interface GMPBackfillResult {
  // Target metrics
  totalActiveIPOs: number;
  targetDaysPerIPO: number; // 30 days

  // Collection results
  iposProcessed: number;
  totalRecordsCollected: number;
  duplicatesSkipped: number;
  validationFailures: number;

  // Coverage by IPO status
  upcomingIPOs: number;
  openIPOs: number;
  closedIPOs: number;

  // Data quality
  avgRecordsPerIPO: number;
  maxDaysCollected: number;
  minDaysCollected: number;

  duration: number;
  timestamp: string;
}

/**
 * Chittorgarh GMP API response structure
 */
interface ChittorgarhGMPResponse {
  success: boolean;
  data: Array<{
    date: string; // ISO 8601 format
    gmp: number;
    gmpPercent: number;
    estimatedListing: number;
    subjectRate: number;
    kostakRate: number;
  }>;
}

/**
 * Fetch historical GMP data from Chittorgarh API
 * Note: This is a placeholder - actual API endpoint needs to be discovered
 */
async function fetchChittorgarhGMPHistory(
  companyName: string,
  slug: string,
  days: number = 30
): Promise<ChittorgarhGMPResponse['data']> {
  try {
    // Chittorgarh API endpoint pattern (to be discovered)
    // This is a placeholder URL - actual endpoint needs reverse engineering
    const baseUrl = 'https://webnodejs.chittorgarh.com/cloud/gmp/history';
    const params = new URLSearchParams({
      company: slug,
      days: days.toString(),
    });

    const url = `${baseUrl}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://www.chittorgarh.com/',
      }
    });

    if (!response.ok) {
      logger.debug({
        companyName,
        slug,
        status: response.status
      }, 'Chittorgarh GMP API failed');
      return [];
    }

    const data: ChittorgarhGMPResponse = await response.json();

    if (data.success && Array.isArray(data.data)) {
      return data.data;
    }

    return [];
  } catch (error) {
    logger.debug({
      companyName,
      error: error instanceof Error ? error.message : String(error)
    }, 'Chittorgarh GMP fetch error');
    return [];
  }
}

/**
 * Alternative: Scrape GMP history from Chittorgarh IPO detail page
 * This is a fallback method when API is not available
 */
async function scrapeChittorgarhGMPHistory(
  companyName: string,
  slug: string
): Promise<Array<{
  date: string;
  gmp: number;
  gmpPercent: number;
  estimatedListing: number;
  subjectRate: number;
  kostakRate: number;
}>> {
  try {
    // Chittorgarh IPO detail page
    const url = `https://www.chittorgarh.com/ipo/${slug}/`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      logger.debug({
        companyName,
        slug,
        status: response.status
      }, 'Chittorgarh page fetch failed');
      return [];
    }

    const html = await response.text();

    // Parse GMP history table from HTML
    // This is a simplified example - actual implementation would need proper HTML parsing
    const gmpHistory: Array<any> = [];

    // Use regex to find GMP data table (placeholder logic)
    const gmpTableMatch = html.match(/<table[^>]*class="gmp-history"[^>]*>(.*?)<\/table>/is);

    if (gmpTableMatch) {
      // Parse table rows
      const rowMatches = gmpTableMatch[1].matchAll(/<tr[^>]*>(.*?)<\/tr>/gis);

      for (const rowMatch of rowMatches) {
        const cellMatches = rowMatch[1].matchAll(/<td[^>]*>(.*?)<\/td>/gis);
        const cells: string[] = [];

        for (const cellMatch of cellMatches) {
          cells.push(cellMatch[1].trim().replace(/<[^>]*>/g, ''));
        }

        // Typical GMP table structure:
        // Date | GMP | GMP % | Est. Listing | Subject | Kostak
        if (cells.length >= 4) {
          try {
            gmpHistory.push({
              date: new Date(cells[0]).toISOString(),
              gmp: parseInt(cells[1].replace(/[^\d-]/g, ''), 10),
              gmpPercent: parseFloat(cells[2].replace(/[^\d.-]/g, '')),
              estimatedListing: parseInt(cells[3].replace(/[^\d]/g, ''), 10),
              subjectRate: cells[4] ? parseInt(cells[4].replace(/[^\d]/g, ''), 10) : 0,
              kostakRate: cells[5] ? parseInt(cells[5].replace(/[^\d]/g, ''), 10) : 0,
            });
          } catch (error) {
            // Skip invalid rows
            continue;
          }
        }
      }
    }

    return gmpHistory;
  } catch (error) {
    logger.debug({
      companyName,
      error: error instanceof Error ? error.message : String(error)
    }, 'Chittorgarh GMP scrape error');
    return [];
  }
}

/**
 * Validate GMP record data
 */
function validateGMPRecord(record: {
  gmp: number;
  gmpPercent: number;
  estimatedListing: number;
}): boolean {
  // GMP should be within reasonable range (-500 to +500 INR)
  if (record.gmp < -500 || record.gmp > 500) {
    logger.warn({ record }, 'GMP value out of range');
    return false;
  }

  // GMP percent should be within -100% to +100%
  if (record.gmpPercent < -100 || record.gmpPercent > 200) {
    logger.warn({ record }, 'GMP percent out of range');
    return false;
  }

  // Estimated listing price should be positive
  if (record.estimatedListing <= 0) {
    logger.warn({ record }, 'Invalid estimated listing price');
    return false;
  }

  return true;
}

/**
 * Main backfill function
 */
export async function backfillGMPHistorical(): Promise<GMPBackfillResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info('Starting Phase 5: GMP Historical Data Backfill');

  let totalActiveIPOs = 0;
  let iposProcessed = 0;
  let totalRecordsCollected = 0;
  let duplicatesSkipped = 0;
  let validationFailures = 0;
  let upcomingIPOs = 0;
  let openIPOs = 0;
  let closedIPOs = 0;

  const recordsPerIPO: number[] = [];

  try {
    const redis = getRedisClient();
    const repository = new GMPRepository(db, redis);

    // Step 1: Fetch all active IPOs (OPEN, UPCOMING, CLOSED)
    logger.info('Fetching active IPOs for GMP history collection');

    const activeIPOs = await db.query.ipos.findMany({
      where: inArray(schema.ipos.status, ['OPEN', 'UPCOMING', 'CLOSED']),
      columns: {
        id: true,
        companyName: true,
        symbol: true,
        slug: true,
        status: true,
        openDate: true,
        closeDate: true,
      },
    });

    totalActiveIPOs = activeIPOs.length;

    // Count by status
    upcomingIPOs = activeIPOs.filter(ipo => ipo.status === 'UPCOMING').length;
    openIPOs = activeIPOs.filter(ipo => ipo.status === 'OPEN').length;
    closedIPOs = activeIPOs.filter(ipo => ipo.status === 'CLOSED').length;

    logger.info({
      totalActiveIPOs,
      upcomingIPOs,
      openIPOs,
      closedIPOs
    }, 'Active IPOs found');

    // Step 2: Fetch existing GMP records to check for duplicates
    logger.info('Checking for existing GMP records');

    const existingGMPRecords = await db.query.gmpRecords.findMany({
      columns: {
        ipoId: true,
        timestamp: true,
      },
    });

    // Create lookup set for duplicate checking: "ipoId:timestamp"
    const existingRecordsSet = new Set(
      existingGMPRecords.map(r => `${r.ipoId}:${r.timestamp.toISOString()}`)
    );

    logger.info({
      existingRecordsCount: existingGMPRecords.length
    }, 'Existing GMP records loaded');

    // Step 3: Process each active IPO
    for (const ipo of activeIPOs) {
      try {
        logger.info({
          companyName: ipo.companyName,
          symbol: ipo.symbol,
          status: ipo.status
        }, 'Fetching GMP history');

        // Try Chittorgarh API first, fallback to scraping
        let gmpHistory = await fetchChittorgarhGMPHistory(ipo.companyName, ipo.slug, 30);

        if (gmpHistory.length === 0) {
          logger.debug({
            companyName: ipo.companyName
          }, 'API failed, trying scraping');

          gmpHistory = await scrapeChittorgarhGMPHistory(ipo.companyName, ipo.slug);
        }

        if (gmpHistory.length === 0) {
          logger.warn({
            companyName: ipo.companyName,
            symbol: ipo.symbol
          }, 'No GMP history found');
          recordsPerIPO.push(0);
          continue;
        }

        // Insert GMP records
        let insertedCount = 0;

        for (const record of gmpHistory) {
          try {
            // Validate record
            if (!validateGMPRecord(record)) {
              validationFailures++;
              continue;
            }

            // Check for duplicates
            const recordKey = `${ipo.id}:${record.date}`;
            if (existingRecordsSet.has(recordKey)) {
              duplicatesSkipped++;
              continue;
            }

            // Prepare GMP record
            const gmpRecord: GMPRecordInsert = {
              ipoId: ipo.id,
              timestamp: new Date(record.date),
              gmp: record.gmp,
              expectedListingPrice: record.estimatedListing,
              subjectRate: record.subjectRate || null,
              kostakRate: record.kostakRate || null,
              saudaDetails: null, // Not available from API
              source: 'chittorgarh',
            };

            // Insert record
            await repository.create(gmpRecord);

            insertedCount++;
            totalRecordsCollected++;

            // Add to existing records set to prevent duplicates within this run
            existingRecordsSet.add(recordKey);

          } catch (error) {
            logger.error({
              ipoId: ipo.id,
              companyName: ipo.companyName,
              record,
              error: error instanceof Error ? error.message : String(error)
            }, 'Failed to insert GMP record');
            validationFailures++;
          }
        }

        recordsPerIPO.push(insertedCount);
        iposProcessed++;

        logger.info({
          companyName: ipo.companyName,
          symbol: ipo.symbol,
          recordsInserted: insertedCount,
          daysOfHistory: gmpHistory.length
        }, 'GMP history collected');

        // Rate limiting - 500ms delay between IPOs
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        logger.error({
          ipoId: ipo.id,
          companyName: ipo.companyName,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to process IPO for GMP history');
      }
    }

    const duration = Date.now() - startTime;

    // Calculate statistics
    const avgRecordsPerIPO = recordsPerIPO.length > 0
      ? Math.round(recordsPerIPO.reduce((a, b) => a + b, 0) / recordsPerIPO.length)
      : 0;

    const maxDaysCollected = recordsPerIPO.length > 0 ? Math.max(...recordsPerIPO) : 0;
    const minDaysCollected = recordsPerIPO.length > 0 ? Math.min(...recordsPerIPO) : 0;

    const result: GMPBackfillResult = {
      totalActiveIPOs,
      targetDaysPerIPO: 30,
      iposProcessed,
      totalRecordsCollected,
      duplicatesSkipped,
      validationFailures,
      upcomingIPOs,
      openIPOs,
      closedIPOs,
      avgRecordsPerIPO,
      maxDaysCollected,
      minDaysCollected,
      duration,
      timestamp,
    };

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: GMP HISTORICAL DATA BACKFILL REPORT');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log('');
    console.log('Target:');
    console.log(`  Active IPOs: ${totalActiveIPOs}`);
    console.log(`    - UPCOMING: ${upcomingIPOs}`);
    console.log(`    - OPEN: ${openIPOs}`);
    console.log(`    - CLOSED: ${closedIPOs}`);
    console.log(`  Target Days per IPO: ${result.targetDaysPerIPO}`);
    console.log('');
    console.log('Results:');
    console.log(`  IPOs Processed: ${iposProcessed}/${totalActiveIPOs}`);
    console.log(`  Total Records Collected: ${totalRecordsCollected}`);
    console.log(`  Avg Records per IPO: ${avgRecordsPerIPO}`);
    console.log(`  Max Days Collected: ${maxDaysCollected}`);
    console.log(`  Min Days Collected: ${minDaysCollected}`);
    console.log('');
    console.log('Quality:');
    console.log(`  Duplicates Skipped: ${duplicatesSkipped}`);
    console.log(`  Validation Failures: ${validationFailures}`);
    console.log('');
    console.log(`Achievement: ${avgRecordsPerIPO >= 30 ? '✅ TARGET ACHIEVED' : '⚠️  PARTIAL'}`);
    console.log('='.repeat(80) + '\n');

    logger.info(result, 'GMP historical backfill completed');

    return result;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'GMP historical backfill failed');

    return {
      totalActiveIPOs,
      targetDaysPerIPO: 30,
      iposProcessed,
      totalRecordsCollected,
      duplicatesSkipped,
      validationFailures,
      upcomingIPOs,
      openIPOs,
      closedIPOs,
      avgRecordsPerIPO: 0,
      maxDaysCollected: 0,
      minDaysCollected: 0,
      duration: Date.now() - startTime,
      timestamp,
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await backfillGMPHistorical();
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'GMP backfill script failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
