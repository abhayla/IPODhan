#!/usr/bin/env node

/**
 * Calculate Ratings Script
 *
 * Batch script to calculate and update IPO ratings for all OPEN and CLOSED IPOs.
 * Can be run manually or scheduled to run after scraper updates.
 *
 * Usage:
 *   npm run calculate-ratings --workspace=web
 *   node --loader ts-node/esm lib/scripts/calculate-ratings.ts
 *
 * @module calculate-ratings
 */

import { db, closePool } from '../db/index.js';
import { getRedisClient, closeRedisClient } from '../cache/redis-client.js';
import { IPORepository } from '../repositories/ipo-repository.js';
import { SubscriptionRepository } from '../repositories/subscription-repository.js';
import { GMPRepository } from '../repositories/gmp-repository.js';
import { FinancialDataRepository } from '../repositories/financial-data-repository.js';
import { calculateIPORating } from '../services/rating-service.js';
import { logger } from '../logger.js';
import * as schema from '../db/schema.js';
import { eq, inArray } from 'drizzle-orm';

// ==================== TYPES ====================

interface RatingStats {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  startTime: Date;
}

// ==================== SCRIPT CONFIGURATION ====================

const SCRIPT_CONFIG = {
  // Only calculate ratings for OPEN and CLOSED IPOs
  targetStatuses: ['OPEN', 'CLOSED'] as const,
  // Batch size for processing IPOs
  batchSize: 10,
  // Enable verbose logging
  verbose: process.argv.includes('--verbose') || process.argv.includes('-v'),
  // Dry run mode (don't update database)
  dryRun: process.argv.includes('--dry-run'),
  // Specific IPO slug to process (optional)
  targetSlug: process.argv.find((arg) => arg.startsWith('--slug='))?.split('=')[1],
};

// ==================== HELPER FUNCTIONS ====================

/**
 * Log message with timestamp
 */
function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}]`;

  switch (level) {
    case 'info':
      logger.info({ msg: message, script: 'calculate-ratings' });
      console.log(`${prefix} ${message}`);
      break;
    case 'warn':
      logger.warn({ msg: message, script: 'calculate-ratings' });
      console.warn(`${prefix} ⚠️  ${message}`);
      break;
    case 'error':
      logger.error({ msg: message, script: 'calculate-ratings' });
      console.error(`${prefix} ❌ ${message}`);
      break;
  }
}

/**
 * Log verbose message (only if verbose mode enabled)
 */
function logVerbose(message: string) {
  if (SCRIPT_CONFIG.verbose) {
    console.log(`  ${message}`);
  }
}

/**
 * Format duration in seconds
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

// ==================== MAIN SCRIPT LOGIC ====================

/**
 * Calculate rating for a single IPO
 */
async function calculateRatingForIPO(
  ipo: typeof schema.ipos.$inferSelect,
  repositories: {
    ipoRepo: IPORepository;
    subscriptionRepo: SubscriptionRepository;
    gmpRepo: GMPRepository;
    financialRepo: FinancialDataRepository;
  }
): Promise<{ success: boolean; updated: boolean; reason?: string }> {
  try {
    logVerbose(`Processing IPO: ${ipo.companyName} (${ipo.slug})`);

    // Check if rating override is set (skip if true)
    if (ipo.ratingOverride === true) {
      logVerbose('  Skipped: Rating override is set');
      return { success: true, updated: false, reason: 'Rating override enabled' };
    }

    // Fetch all required data for rating calculation
    const [latestSubscription, gmpRecords, financialData, peerCompanies] =
      await Promise.all([
        repositories.subscriptionRepo.findLatest(ipo.id),
        repositories.gmpRepo.findByIPO({ ipoId: ipo.id, limit: 7 }),
        repositories.financialRepo.findByIPO(ipo.id),
        // Fetch peer companies from database
        db
          .select()
          .from(schema.peerCompanies)
          .where(eq(schema.peerCompanies.ipoId, ipo.id)),
      ]);

    logVerbose(
      `  Data: Subscription=${latestSubscription ? 'Yes' : 'No'}, ` +
        `GMP=${gmpRecords.length} records, ` +
        `Financials=${financialData ? 'Yes' : 'No'}, ` +
        `Peers=${peerCompanies.length}`
    );

    // Calculate rating
    const result = calculateIPORating(
      ipo,
      latestSubscription,
      gmpRecords,
      peerCompanies,
      financialData
    );

    logVerbose(
      `  Rating: ${result.rating !== null ? result.rating.toFixed(1) : 'N/A'} ` +
        `(${result.availableFactors.length}/5 factors)`
    );
    logVerbose(`  Rationale: ${result.rationale}`);

    // Check if rating changed
    const ratingChanged =
      ipo.rating !== result.rating ||
      ipo.ratingRationale !== result.rationale;

    if (!ratingChanged) {
      logVerbose('  No changes to rating');
      return { success: true, updated: false, reason: 'Rating unchanged' };
    }

    // Update database (unless dry run)
    if (!SCRIPT_CONFIG.dryRun) {
      await repositories.ipoRepo.updateRating(
        ipo.id,
        result.rating,
        result.rationale
      );
      logVerbose('  ✓ Rating updated in database');
    } else {
      logVerbose('  [DRY RUN] Would update rating in database');
    }

    return { success: true, updated: true };
  } catch (error) {
    log(
      `Error calculating rating for ${ipo.companyName}: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    return { success: false, updated: false, reason: 'Error occurred' };
  }
}

/**
 * Main script execution
 */
async function main() {
  const stats: RatingStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    startTime: new Date(),
  };

  try {
    log('=== IPO Rating Calculation Script ===');
    log(`Mode: ${SCRIPT_CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`);
    log(`Target Statuses: ${SCRIPT_CONFIG.targetStatuses.join(', ')}`);
    if (SCRIPT_CONFIG.targetSlug) {
      log(`Target Slug: ${SCRIPT_CONFIG.targetSlug}`);
    }
    log('');

    // Initialize repositories
    const redis = getRedisClient();
    const ipoRepo = new IPORepository(db, redis);
    const subscriptionRepo = new SubscriptionRepository(db, redis);
    const gmpRepo = new GMPRepository(db, redis);
    const financialRepo = new FinancialDataRepository(db, redis);

    const repositories = { ipoRepo, subscriptionRepo, gmpRepo, financialRepo };

    // Fetch IPOs to process
    let iposToProcess: (typeof schema.ipos.$inferSelect)[];

    if (SCRIPT_CONFIG.targetSlug) {
      // Process specific IPO by slug
      log(`Fetching IPO with slug: ${SCRIPT_CONFIG.targetSlug}...`);
      const ipoData = await ipoRepo.findBySlug(SCRIPT_CONFIG.targetSlug);
      if (!ipoData) {
        throw new Error(`IPO not found: ${SCRIPT_CONFIG.targetSlug}`);
      }
      iposToProcess = [ipoData];
    } else {
      // Process all IPOs with target statuses
      log(`Fetching IPOs with status: ${SCRIPT_CONFIG.targetStatuses.join(', ')}...`);
      iposToProcess = await db
        .select()
        .from(schema.ipos)
        .where(inArray(schema.ipos.status, [...SCRIPT_CONFIG.targetStatuses]));
    }

    log(`Found ${iposToProcess.length} IPO(s) to process`);
    log('');

    // Process IPOs
    for (let i = 0; i < iposToProcess.length; i++) {
      const ipo = iposToProcess[i];
      stats.processed++;

      log(
        `[${i + 1}/${iposToProcess.length}] Processing: ${ipo.companyName} (${ipo.slug})`
      );

      const result = await calculateRatingForIPO(ipo, repositories);

      if (!result.success) {
        stats.errors++;
      } else if (result.updated) {
        stats.updated++;
      } else {
        stats.skipped++;
      }

      // Add delay between requests to avoid overloading
      if (i < iposToProcess.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Print summary
    const duration = Date.now() - stats.startTime.getTime();
    log('');
    log('=== Summary ===');
    log(`Total Processed: ${stats.processed}`);
    log(`Updated: ${stats.updated}`);
    log(`Skipped (no changes): ${stats.skipped}`);
    log(`Errors: ${stats.errors}`);
    log(`Duration: ${formatDuration(duration)}`);

    if (SCRIPT_CONFIG.dryRun) {
      log('');
      log('Note: This was a DRY RUN. No changes were made to the database.');
    }
  } catch (error) {
    log(
      `Fatal error: ${error instanceof Error ? error.message : String(error)}`,
      'error'
    );
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await closeRedisClient();
      await closePool();
      log('');
      log('Connections closed. Script complete.');
    } catch (error) {
      log(
        `Error during cleanup: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
    }
  }
}

// ==================== SCRIPT EXECUTION ====================

// Run the script if executed directly
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

// Export for testing
export { main, calculateRatingForIPO };
