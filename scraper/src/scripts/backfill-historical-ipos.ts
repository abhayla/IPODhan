#!/usr/bin/env tsx
/**
 * Story 11.4: Historical IPO Data Backfill Script
 *
 * Backfills historical IPO listing performance data from NSE past endpoints.
 * Implements all acceptance criteria (AC1-AC7):
 * - AC1: NSE Past Endpoints Integration
 * - AC2: Data Extraction & Transformation
 * - AC3: Data Matching & Validation
 * - AC4: Listing Performance Persistence
 * - AC5: Backfill Coverage Target (200+ IPOs, 60%+ match rate)
 * - AC6: Data Quality Validation
 * - AC7: Operational Requirements (dry-run, resume, progress tracking)
 *
 * Usage:
 *   npm run backfill            # Production mode
 *   npm run backfill:dry        # Dry-run mode (preview only)
 *   npm run backfill -- --resume --start-batch=5  # Resume from batch 5
 */

import { Command } from 'commander';
import cliProgress from 'cli-progress';
import logger from '../utils/logger.js';
import { fetchPastIPOs } from '../scrapers/nse-api-client.js';
import { transformPastIPOs } from '../utils/transform-past-ipo.js';
import { batchMatchIPOs, generateUnmatchedReport } from '../utils/match-ipo.js';
import { getDb } from '@ipodhan/shared/db';
import { getRedisClient } from '@ipodhan/shared/cache/redis-client';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import type { TransformedPastIPO } from '../utils/transform-past-ipo.js';
import type { IPOMatchResult } from '../utils/match-ipo.js';
import type { ListingPerformanceInsert } from '@ipodhan/shared/repositories/types';
import fs from 'fs/promises';
import path from 'path';

/**
 * Backfill options (AC7)
 */
export interface BackfillOptions {
  dryRun: boolean;           // Preview mode without DB writes
  batchSize: number;         // Records per batch (default: 50)
  startBatch: number;        // Start from specific batch (for resume)
  skipConfirmation: boolean; // Skip confirmation prompt
}

/**
 * Backfill report with statistics (AC5, AC6)
 */
export interface BackfillReport {
  // Timing
  startTime: string;
  endTime: string;
  durationMs: number;

  // Coverage (AC5)
  totalFetched: number;
  totalTransformed: number;
  totalMatched: number;
  totalUnmatched: number;
  matchRate: number;

  // Matching breakdown (AC3)
  matchedBySymbol: number;
  matchedByNameHigh: number;
  matchedByNameMedium: number;

  // Quality metrics (AC6)
  recordsWithAllRequired: number;
  recordsWithCurrentPrice: number;
  recordsWithListingGain: number;
  qualityScore: number;

  // Persistence (AC4)
  totalUpserted: number;
  batchesProcessed: number;
  conflicts: number;

  // Output
  unmatchedReportPath: string | null;
}

/**
 * Checkpoint for resume capability (AC7)
 */
interface Checkpoint {
  lastBatch: number;
  totalUpserted: number;
  timestamp: string;
}

const CHECKPOINT_FILE = 'backfill-checkpoint.json';

/**
 * Save checkpoint for resume capability (AC7)
 */
async function saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
  try {
    const checkpointPath = path.join(process.cwd(), CHECKPOINT_FILE);
    await fs.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2));
    logger.debug({ checkpoint }, 'Checkpoint saved (AC7)');
  } catch (error) {
    logger.error({ error }, 'Failed to save checkpoint (AC7)');
  }
}

/**
 * Load checkpoint for resume capability (AC7)
 */
async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const checkpointPath = path.join(process.cwd(), CHECKPOINT_FILE);
    const content = await fs.readFile(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(content) as Checkpoint;
    logger.info({ checkpoint }, 'Checkpoint loaded (AC7)');
    return checkpoint;
  } catch (error) {
    logger.debug('No checkpoint file found (AC7)');
    return null;
  }
}

/**
 * Clear checkpoint file (AC7)
 */
async function clearCheckpoint(): Promise<void> {
  try {
    const checkpointPath = path.join(process.cwd(), CHECKPOINT_FILE);
    await fs.unlink(checkpointPath);
    logger.debug('Checkpoint cleared (AC7)');
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

/**
 * Calculate data quality score (AC6)
 * Formula: (recordsWithAllRequired * 0.4 + recordsWithCurrentPrice * 0.3 + matchedRecords * 0.3) * 100
 */
function calculateQualityScore(
  recordsWithAllRequired: number,
  recordsWithCurrentPrice: number,
  matchedRecords: number,
  totalRecords: number
): number {
  if (totalRecords === 0) return 0;

  const requiredScore = (recordsWithAllRequired / totalRecords) * 0.4;
  const currentPriceScore = (recordsWithCurrentPrice / totalRecords) * 0.3;
  const matchScore = (matchedRecords / totalRecords) * 0.3;

  return Math.round((requiredScore + currentPriceScore + matchScore) * 100);
}

/**
 * Main backfill function (AC1-AC7)
 */
export async function backfillHistoricalIPOs(options: BackfillOptions): Promise<BackfillReport> {
  const startTime = new Date();
  logger.info({ options }, 'Starting historical IPO backfill (Story 11.4)');

  // Initialize progress bar (AC7)
  const progressBar = new cliProgress.SingleBar({
    format: 'Backfill Progress |{bar}| {percentage}% | {value}/{total} Records | ETA: {eta}s',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  let db: Awaited<ReturnType<typeof getDb>> | null = null;
  let redis: ReturnType<typeof getRedisClient> | null = null;
  let checkpoint: Checkpoint | null = null;

  try {
    // Step 1: Initialize connections
    logger.info('Initializing database and Redis connections');
    db = await getDb();
    redis = getRedisClient();

    // Step 2: Load checkpoint if resuming (AC7)
    if (options.startBatch > 0) {
      checkpoint = await loadCheckpoint();
      if (!checkpoint) {
        logger.warn('Resume requested but no checkpoint found, starting from beginning');
      }
    }

    // Step 3: Fetch past IPOs from NSE (AC1)
    logger.info('Fetching past IPOs from NSE /api/public-past-issues (AC1)');
    const { pastIPOs: nseResponses } = await fetchPastIPOs();

    if (nseResponses.length === 0) {
      throw new Error('No past IPOs fetched from NSE (AC1, AC5)');
    }

    logger.info({
      fetchedCount: nseResponses.length,
      target: 200
    }, 'NSE past IPOs fetched (AC5 - Target: 200+)');

    // Step 4: Transform data (AC2)
    logger.info('Transforming NSE responses to database format (AC2)');
    const transformedIPOs = transformPastIPOs(nseResponses);

    if (transformedIPOs.length === 0) {
      throw new Error('No IPOs transformed successfully (AC2)');
    }

    logger.info({
      transformedCount: transformedIPOs.length,
      skippedCount: nseResponses.length - transformedIPOs.length
    }, 'Data transformation completed (AC2)');

    // Step 5: Match IPOs against database (AC3)
    logger.info('Matching IPOs against database (AC3)');
    const { matches, statistics, unmatchedRecords } = await batchMatchIPOs(db, transformedIPOs);

    logger.info({
      ...statistics
    }, 'IPO matching completed (AC3, AC5 - Target: 60%+ match rate)');

    // Step 6: Generate unmatched report (AC3)
    let unmatchedReportPath: string | null = null;
    if (unmatchedRecords.length > 0) {
      unmatchedReportPath = await generateUnmatchedReport(unmatchedRecords);
      logger.info({
        unmatchedCount: unmatchedRecords.length,
        reportPath: unmatchedReportPath
      }, 'Unmatched records report generated (AC3)');
    }

    // Step 7: Prepare listing performance records (AC4)
    const listingPerformanceRecords: ListingPerformanceInsert[] = [];

    for (const [pastIPO, matchResult] of matches.entries()) {
      const record: ListingPerformanceInsert = {
        ipoId: matchResult.ipoId || null, // NULL for unmatched (AC3)
        symbol: pastIPO.symbol,
        companyName: pastIPO.companyName,
        listingDate: pastIPO.listingDate,
        listingPrice: pastIPO.listingPrice ? Math.round(pastIPO.listingPrice) : null,
        issuePrice: pastIPO.issuePrice ? Math.round(pastIPO.issuePrice) : null,
        listingGainPercent: pastIPO.listingGainPercent,
        currentPrice: pastIPO.currentPrice ? Math.round(pastIPO.currentPrice) : null,
        dataSource: 'NSE_PAST_API',
      };

      listingPerformanceRecords.push(record);
    }

    // Step 8: Calculate quality metrics (AC6)
    const recordsWithAllRequired = listingPerformanceRecords.filter(
      r => r.symbol && r.listingDate && r.listingPrice
    ).length;

    const recordsWithCurrentPrice = listingPerformanceRecords.filter(
      r => r.currentPrice !== null
    ).length;

    const recordsWithListingGain = listingPerformanceRecords.filter(
      r => r.listingGainPercent !== null
    ).length;

    const qualityScore = calculateQualityScore(
      recordsWithAllRequired,
      recordsWithCurrentPrice,
      statistics.matchedBySymbol + statistics.matchedByNameHigh + statistics.matchedByNameMedium,
      listingPerformanceRecords.length
    );

    logger.info({
      qualityScore,
      recordsWithAllRequired,
      recordsWithCurrentPrice,
      recordsWithListingGain,
      target: 95
    }, 'Data quality validation (AC6 - Target: >95%)');

    // Step 9: Upsert to database (AC4, AC7)
    let totalUpserted = 0;
    let batchesProcessed = 0;

    if (options.dryRun) {
      logger.info({
        recordCount: listingPerformanceRecords.length,
        mode: 'DRY-RUN'
      }, 'Dry-run mode: Skipping database writes (AC7)');
    } else {
      logger.info({
        recordCount: listingPerformanceRecords.length,
        batchSize: options.batchSize
      }, 'Starting batch upsert (AC4)');

      const repository = new ListingPerformanceRepository(db, redis);

      // Initialize progress bar
      progressBar.start(listingPerformanceRecords.length, 0);

      // Split into batches
      const batches: ListingPerformanceInsert[][] = [];
      for (let i = 0; i < listingPerformanceRecords.length; i += options.batchSize) {
        batches.push(listingPerformanceRecords.slice(i, i + options.batchSize));
      }

      // Process batches with delay (AC7 - rate limiting)
      for (let i = options.startBatch; i < batches.length; i++) {
        const batch = batches[i];

        try {
          const upserted = await repository.batchUpsert(batch, options.batchSize);
          totalUpserted += upserted;
          batchesProcessed++;

          // Update progress bar
          progressBar.update(totalUpserted);

          // Save checkpoint after each batch (AC7)
          await saveCheckpoint({
            lastBatch: i,
            totalUpserted,
            timestamp: new Date().toISOString()
          });

          // Add delay between batches (AC7 - 2s delay)
          if (i < batches.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

        } catch (error) {
          logger.error({
            batchIndex: i,
            error: error instanceof Error ? error.message : String(error)
          }, 'Batch upsert failed (AC4, AC7)');

          progressBar.stop();
          throw error;
        }
      }

      progressBar.stop();

      // Clear checkpoint on successful completion (AC7)
      await clearCheckpoint();
    }

    // Step 10: Generate report (AC5, AC6)
    const endTime = new Date();
    const report: BackfillReport = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      totalFetched: nseResponses.length,
      totalTransformed: transformedIPOs.length,
      totalMatched: statistics.matchedBySymbol + statistics.matchedByNameHigh + statistics.matchedByNameMedium,
      totalUnmatched: statistics.unmatched,
      matchRate: statistics.matchRate,
      matchedBySymbol: statistics.matchedBySymbol,
      matchedByNameHigh: statistics.matchedByNameHigh,
      matchedByNameMedium: statistics.matchedByNameMedium,
      recordsWithAllRequired,
      recordsWithCurrentPrice,
      recordsWithListingGain,
      qualityScore,
      totalUpserted,
      batchesProcessed,
      conflicts: statistics.conflicts,
      unmatchedReportPath,
    };

    logger.info({
      report
    }, 'Historical IPO backfill completed successfully (Story 11.4)');

    // Print summary to console
    console.log('\n' + '='.repeat(80));
    console.log('BACKFILL REPORT - Story 11.4');
    console.log('='.repeat(80));
    console.log(`Mode: ${options.dryRun ? 'DRY-RUN (Preview)' : 'PRODUCTION'}`);
    console.log(`Duration: ${Math.round(report.durationMs / 1000)}s`);
    console.log('');
    console.log('Coverage (AC5):');
    console.log(`  Fetched from NSE: ${report.totalFetched} (Target: 200+)`);
    console.log(`  Transformed: ${report.totalTransformed}`);
    console.log(`  Matched: ${report.totalMatched} (${report.matchRate}%) [Target: 60%+]`);
    console.log(`  Unmatched: ${report.totalUnmatched}`);
    console.log('');
    console.log('Matching Breakdown (AC3):');
    console.log(`  By Symbol (100%): ${report.matchedBySymbol}`);
    console.log(`  By Name High (90%): ${report.matchedByNameHigh}`);
    console.log(`  By Name Medium (70%): ${report.matchedByNameMedium}`);
    console.log('');
    console.log('Data Quality (AC6):');
    console.log(`  Quality Score: ${report.qualityScore}% (Target: >95%)`);
    console.log(`  All Required Fields: ${report.recordsWithAllRequired}/${report.totalTransformed}`);
    console.log(`  With Current Price: ${report.recordsWithCurrentPrice}/${report.totalTransformed}`);
    console.log(`  With Listing Gain: ${report.recordsWithListingGain}/${report.totalTransformed}`);
    console.log('');
    console.log('Persistence (AC4):');
    console.log(`  Upserted: ${report.totalUpserted}`);
    console.log(`  Batches Processed: ${report.batchesProcessed}`);
    console.log(`  Conflicts: ${report.conflicts}`);
    console.log('');
    if (report.unmatchedReportPath) {
      console.log(`Unmatched Report: ${report.unmatchedReportPath}`);
    }
    console.log('='.repeat(80) + '\n');

    return report;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Historical IPO backfill failed (AC7)');
    throw error;
  }
}

/**
 * CLI entry point (AC7)
 */
async function main() {
  const program = new Command();

  program
    .name('backfill-historical-ipos')
    .description('Backfill historical IPO listing performance data from NSE past endpoints (Story 11.4)')
    .version('1.0.0')
    .option('--dry-run', 'Preview mode without database writes (AC7)', false)
    .option('--batch-size <number>', 'Number of records per batch (AC7)', '50')
    .option('--resume', 'Resume from last checkpoint (AC7)', false)
    .option('--start-batch <number>', 'Start from specific batch number (AC7)', '0')
    .option('--yes', 'Skip confirmation prompt (AC7)', false)
    .parse(process.argv);

  const opts = program.opts();

  const options: BackfillOptions = {
    dryRun: opts.dryRun || false,
    batchSize: parseInt(opts.batchSize, 10),
    startBatch: opts.resume ? -1 : parseInt(opts.startBatch, 10), // -1 means load from checkpoint
    skipConfirmation: opts.yes || false,
  };

  // Load checkpoint if resuming
  if (options.startBatch === -1) {
    const checkpoint = await loadCheckpoint();
    if (checkpoint) {
      options.startBatch = checkpoint.lastBatch + 1;
      logger.info({
        startBatch: options.startBatch,
        totalUpserted: checkpoint.totalUpserted
      }, 'Resuming from checkpoint (AC7)');
    } else {
      options.startBatch = 0;
    }
  }

  // Confirmation prompt for production mode (AC7)
  if (!options.dryRun && !options.skipConfirmation) {
    console.log('\n⚠️  WARNING: Running in PRODUCTION mode - will write to database!\n');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  try {
    await backfillHistoricalIPOs(options);
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Backfill script failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
