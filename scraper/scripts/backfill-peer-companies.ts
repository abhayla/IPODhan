/**
 * Backfill Script: Peer Companies
 *
 * Backfills peer company data for existing IPOs
 * Usage:
 *   npx tsx scripts/backfill-peer-companies.ts [options]
 *
 * Options:
 *   --limit=N         Process only N IPOs (for testing)
 *   --force          Re-scrape even if peer data exists
 *   --status=STATUS   Only process IPOs with given status (OPEN, CLOSED, LISTED)
 *   --sector=SECTOR   Only process IPOs in given sector (e.g., "FMCG", "IT Services")
 *
 * Examples:
 *   npx tsx scripts/backfill-peer-companies.ts --limit=5
 *   npx tsx scripts/backfill-peer-companies.ts --status=OPEN
 *   npx tsx scripts/backfill-peer-companies.ts --sector="FMCG"
 *   npx tsx scripts/backfill-peer-companies.ts --force
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { runPeerCompaniesJob } from '../src/jobs/peer-companies-job.js';
import { db } from '@ipodhan/shared';
import { logger } from '../src/utils/logger.js';
import * as schema from '@ipodhan/shared/db/schema';
import { isNull, not, inArray, eq } from 'drizzle-orm';

interface BackfillOptions {
  limit?: number;
  force?: boolean;
  status?: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED';
  sector?: string;
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
    } else if (arg.startsWith('--sector=')) {
      options.sector = arg.split('=')[1];
    }
  }

  return options;
}

async function main() {
  console.log('='.repeat(80));
  console.log('PEER COMPANIES BACKFILL SCRIPT');
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
        sector: schema.ipos.sector,
        status: schema.ipos.status,
      })
      .from(schema.ipos)
      .where(not(isNull(schema.ipos.sector))); // Only IPOs with valid sector

    // Apply filters
    if (options.status) {
      query = query.where(eq(schema.ipos.status, options.status));
    }

    if (options.sector) {
      query = query.where(eq(schema.ipos.sector, options.sector));
    }

    const ipos = await query;

    logger.info(
      { totalIPOs: ipos.length },
      `[Backfill] Found ${ipos.length} IPOs with valid sectors`
    );

    if (ipos.length === 0) {
      console.log('\n❌ No IPOs found matching criteria');
      return;
    }

    // Filter out IPOs that already have peer data (unless force=true)
    let iposToProcess = ipos;
    if (!options.force) {
      const iposWithPeers = await db
        .selectDistinct({ ipoId: schema.peerCompanies.ipoId })
        .from(schema.peerCompanies)
        .where(inArray(schema.peerCompanies.ipoId, ipos.map((i) => i.id)));

      const ipoIdsWithPeers = new Set(iposWithPeers.map((p) => p.ipoId));
      iposToProcess = ipos.filter((ipo) => !ipoIdsWithPeers.has(ipo.id));

      console.log(`\n📊 IPOs with existing peer data: ${ipoIdsWithPeers.size}`);
      console.log(`📊 IPOs to process: ${iposToProcess.length}`);
    }

    if (iposToProcess.length === 0) {
      console.log('\n✅ All IPOs already have peer data (use --force to re-scrape)');
      return;
    }

    // Apply limit
    if (options.limit) {
      iposToProcess = iposToProcess.slice(0, options.limit);
      console.log(`\n🔍 Processing limited to ${options.limit} IPOs`);
    }

    // Display summary
    console.log('\n' + '='.repeat(80));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total IPOs to process: ${iposToProcess.length}`);
    console.log(`Estimated time: ${(iposToProcess.length * 5) / 60} minutes`);
    console.log('='.repeat(80));
    console.log();

    // Confirm before proceeding (unless limit is small)
    if (iposToProcess.length > 10 && !options.limit) {
      console.log('⚠️  WARNING: This will process many IPOs and may take a while.');
      console.log('⚠️  Press Ctrl+C to cancel, or wait 5 seconds to continue...');
      console.log();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // Run the job
    await runPeerCompaniesJob({
      ipoIds: iposToProcess.map((ipo) => ipo.id),
      force: options.force,
    });

    console.log('\n' + '='.repeat(80));
    console.log('✅ BACKFILL COMPLETED SUCCESSFULLY');
    console.log('='.repeat(80));

  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      '[Backfill] ✗ Backfill failed'
    );

    console.log('\n' + '='.repeat(80));
    console.log('❌ BACKFILL FAILED');
    console.log('='.repeat(80));
    console.log(`Error: ${error.message}`);
    console.log();

    process.exit(1);
  }
}

main();
