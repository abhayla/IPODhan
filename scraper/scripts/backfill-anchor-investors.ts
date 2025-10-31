/**
 * Backfill Anchor Investors Script
 *
 * Backfills anchor investor data for IPOs with DRHP documents.
 *
 * Usage:
 *   npx tsx scripts/backfill-anchor-investors.ts                    # Process all IPOs
 *   npx tsx scripts/backfill-anchor-investors.ts --limit 10         # Process first 10 IPOs
 *   npx tsx scripts/backfill-anchor-investors.ts --force            # Force reprocess existing data
 *   npx tsx scripts/backfill-anchor-investors.ts --status=OPEN      # Process only OPEN IPOs
 *   npx tsx scripts/backfill-anchor-investors.ts --ipo-id=<uuid>    # Process specific IPO
 *
 * @module scripts/backfill-anchor-investors
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import { db, getRedisClient } from '@ipodhan/shared';
import { logger } from '../src/utils/logger.js';
import { scrapeAnchorInvestors } from '../src/scrapers/anchor-investors-scraper.js';
import { AnchorInvestorRepository } from '../src/repositories/anchor-investor-repository.js';
import { createAnchorInvestors } from '../src/services/data-persister.js';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, and, isNotNull, inArray, sql } from 'drizzle-orm';

/**
 * Parse command-line arguments
 */
function parseArgs(): {
  limit?: number;
  force: boolean;
  status?: string;
  ipoId?: string;
} {
  const args = process.argv.slice(2);

  const parsed = {
    limit: undefined as number | undefined,
    force: false,
    status: undefined as string | undefined,
    ipoId: undefined as string | undefined
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      parsed.limit = parseInt(arg.split('=')[1]);
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg.startsWith('--status=')) {
      parsed.status = arg.split('=')[1].toUpperCase();
    } else if (arg.startsWith('--ipo-id=')) {
      parsed.ipoId = arg.split('=')[1];
    }
  }

  return parsed;
}

/**
 * Main backfill function
 */
async function main() {
  const args = parseArgs();

  logger.info('[Backfill Anchor Investors] Starting backfill script', args);

  const startTime = Date.now();
  const result = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as Array<{ ipoId: string; companyName: string; error: string }>
  };

  try {
    // db and getRedisClient are already imported from @ipodhan/shared
    const redis = getRedisClient();

    const anchorInvestorRepository = new AnchorInvestorRepository(db);

    // Step 1: Get IPOs with DRHP documents
    let iposQuery = db
      .select({
        ipoId: schema.documents.ipoId,
        companyName: schema.ipos.companyName,
        slug: schema.ipos.slug,
        status: schema.ipos.status
      })
      .from(schema.documents)
      .innerJoin(schema.ipos, eq(schema.documents.ipoId, schema.ipos.id))
      .where(
        and(
          inArray(schema.documents.documentType, ['DRHP', 'RHP', 'PROSPECTUS']),
          isNotNull(schema.documents.documentUrl)
        )
      )
      .groupBy(schema.documents.ipoId, schema.ipos.companyName, schema.ipos.slug, schema.ipos.status)
      .$dynamic();

    // Apply filters
    if (args.ipoId) {
      logger.info(`[Backfill Anchor Investors] Processing specific IPO: ${args.ipoId}`);
      iposQuery = iposQuery.where(eq(schema.ipos.id, args.ipoId));
    } else if (args.status) {
      logger.info(`[Backfill Anchor Investors] Filtering by status: ${args.status}`);
      iposQuery = iposQuery.where(eq(schema.ipos.status, args.status as any));
    }

    if (args.limit) {
      logger.info(`[Backfill Anchor Investors] Limiting to ${args.limit} IPOs`);
      iposQuery = iposQuery.limit(args.limit);
    }

    const iposWithDRHP = await iposQuery;

    if (iposWithDRHP.length === 0) {
      logger.warn('[Backfill Anchor Investors] No IPOs with DRHP documents found');
      return;
    }

    logger.info(`[Backfill Anchor Investors] Found ${iposWithDRHP.length} IPOs with DRHP documents`);

    // Step 2: Process each IPO
    for (const ipo of iposWithDRHP) {
      try {
        result.processed++;

        logger.info(`[Backfill Anchor Investors] [${result.processed}/${iposWithDRHP.length}] Processing ${ipo.companyName}`);

        // Check if anchor data already exists
        const existing = await anchorInvestorRepository.findByIPOId(ipo.ipoId);

        // Skip if data exists and not forcing
        if (existing && !args.force) {
          logger.info(`[Backfill Anchor Investors] Skipping ${ipo.companyName} - anchor data already exists (use --force to override)`);
          result.skipped++;
          continue;
        }

        // Scrape anchor investor data
        const anchorData = await scrapeAnchorInvestors(db, ipo.ipoId, ipo.companyName);

        if (!anchorData) {
          logger.warn(`[Backfill Anchor Investors] No anchor data found for ${ipo.companyName}`);
          result.skipped++;
          continue;
        }

        // Persist to database
        await createAnchorInvestors(anchorInvestorRepository, ipo.ipoId, anchorData);

        if (existing) {
          result.updated++;
          logger.info(`[Backfill Anchor Investors] ✓ Updated anchor data for ${ipo.companyName} (${anchorData.anchorInvestorsCount} investors, ₹${anchorData.totalAmountRaised.toFixed(2)} Cr)`);
        } else {
          result.created++;
          logger.info(`[Backfill Anchor Investors] ✓ Created anchor data for ${ipo.companyName} (${anchorData.anchorInvestorsCount} investors, ₹${anchorData.totalAmountRaised.toFixed(2)} Cr)`);
        }

        // Rate limiting: 5 seconds between IPOs (PDF processing is CPU-intensive)
        if (result.processed < iposWithDRHP.length) {
          await new Promise(resolve => setTimeout(resolve, 5000));
        }

      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Backfill Anchor Investors] Failed to process ${ipo.companyName}:`, error);

        result.errors.push({
          ipoId: ipo.ipoId,
          companyName: ipo.companyName,
          error: errorMessage
        });

        // Continue with next IPO (don't fail entire script)
      }
    }

    // Summary
    const duration = Date.now() - startTime;
    const durationMinutes = (duration / 1000 / 60).toFixed(2);

    logger.info('\n='.repeat(70));
    logger.info('[Backfill Anchor Investors] BACKFILL COMPLETE');
    logger.info('='.repeat(70));
    logger.info(`Total IPOs Processed:  ${result.processed}`);
    logger.info(`Created:               ${result.created}`);
    logger.info(`Updated:               ${result.updated}`);
    logger.info(`Skipped:               ${result.skipped}`);
    logger.info(`Failed:                ${result.failed}`);
    logger.info(`Duration:              ${durationMinutes} minutes`);
    logger.info('='.repeat(70));

    if (result.errors.length > 0) {
      logger.error('\n[Backfill Anchor Investors] ERRORS:');
      result.errors.forEach((err, index) => {
        logger.error(`${index + 1}. ${err.companyName} (${err.ipoId}): ${err.error}`);
      });
    }

    // Calculate success rate
    const successRate = result.processed > 0
      ? ((result.created + result.updated) / result.processed * 100).toFixed(2)
      : '0.00';

    logger.info(`\n[Backfill Anchor Investors] Success Rate: ${successRate}%`);

    // Exit with appropriate code
    if (result.failed > result.processed / 2) {
      logger.error('[Backfill Anchor Investors] FAILED: >50% of IPOs failed to process');
      process.exit(1);
    } else {
      logger.info('[Backfill Anchor Investors] SUCCESS');
      process.exit(0);
    }

  } catch (error) {
    logger.error('[Backfill Anchor Investors] Critical error:', error);
    process.exit(1);
  }
}

// Run script
main().catch((error) => {
  logger.error('[Backfill Anchor Investors] Unhandled error:', error);
  process.exit(1);
});
