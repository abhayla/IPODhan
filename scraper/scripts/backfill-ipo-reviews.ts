/**
 * Backfill Script: IPO Reviews
 *
 * Backfills IPO review data from multiple sources for existing IPOs
 * Usage:
 *   npx tsx scripts/backfill-ipo-reviews.ts [options]
 *
 * Options:
 *   --limit=N         Process only N IPOs (for testing)
 *   --force          Re-scrape even if reviews exist
 *   --status=STATUS   Only process IPOs with given status (OPEN, CLOSED, LISTED)
 *   --segment=SEGMENT Only process IPOs with given segment (MAINBOARD, SME)
 *
 * Examples:
 *   npx tsx scripts/backfill-ipo-reviews.ts --limit=5
 *   npx tsx scripts/backfill-ipo-reviews.ts --status=OPEN
 *   npx tsx scripts/backfill-ipo-reviews.ts --segment=MAINBOARD
 *   npx tsx scripts/backfill-ipo-reviews.ts --force
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { runIPOReviewsJob } from '../src/jobs/ipo-reviews-job.js';
import { db } from '@ipodhan/shared';
import { logger } from '../src/utils/logger.js';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, or } from 'drizzle-orm';

interface BackfillOptions {
  limit?: number;
  force?: boolean;
  status?: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  segment?: 'MAINBOARD' | 'SME';
}

async function parseArgs(): Promise<BackfillOptions> {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--status=')) {
      options.status = arg.split('=')[1] as any;
    } else if (arg.startsWith('--segment=')) {
      options.segment = arg.split('=')[1] as any;
    }
  }

  return options;
}

async function main() {
  console.log('='.repeat(80));
  console.log('IPO REVIEWS BACKFILL SCRIPT');
  console.log('='.repeat(80));
  console.log();

  const options = await parseArgs();

  logger.info({ options }, '[Backfill] Starting with options');

  try {
    // db is already imported from @ipodhan/shared

    // Get IPOs to process
    let query = db
      .select({
        id: schema.ipos.id,
        companyName: schema.ipos.companyName,
        slug: schema.ipos.slug,
        status: schema.ipos.status,
        segment: schema.ipos.segment,
      })
      .from(schema.ipos);

    // Apply filters
    if (options.status) {
      query = query.where(eq(schema.ipos.status, options.status));
    } else {
      // Default: Only OPEN, CLOSED, LISTED (skip UPCOMING - no reviews yet)
      query = query.where(
        or(
          eq(schema.ipos.status, 'OPEN'),
          eq(schema.ipos.status, 'CLOSED'),
          eq(schema.ipos.status, 'LISTED')
        )
      );
    }

    if (options.segment) {
      query = query.where(eq(schema.ipos.segment, options.segment));
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    const ipos = await query;

    console.log(`Found ${ipos.length} IPOs to process`);
    console.log();

    if (ipos.length === 0) {
      console.log('No IPOs found matching criteria. Exiting.');
      return;
    }

    // Show sample of IPOs
    console.log('Sample IPOs to process:');
    ipos.slice(0, 5).forEach((ipo, index) => {
      console.log(
        `  ${index + 1}. ${ipo.companyName} (${ipo.slug}) - ${ipo.status} - ${ipo.segment || 'N/A'}`
      );
    });

    if (ipos.length > 5) {
      console.log(`  ... and ${ipos.length - 5} more`);
    }

    console.log();
    console.log('Starting backfill...');
    console.log();

    // Extract IPO IDs
    const ipoIds = ipos.map((ipo) => ipo.id);

    // Run the job
    await runIPOReviewsJob({
      ipoIds,
      force: options.force,
      status: options.status,
    });

    console.log();
    console.log('='.repeat(80));
    console.log('✓ BACKFILL COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));

  } catch (error) {
    console.error();
    console.error('='.repeat(80));
    console.error('✗ BACKFILL FAILED');
    console.error('='.repeat(80));
    console.error();
    console.error('Error:', error);

    if (error instanceof Error) {
      logger.error(
        { error: error.message, stack: error.stack },
        '[Backfill] Fatal error during backfill'
      );
    }

    process.exit(1);
  }
}

// Run the script
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
