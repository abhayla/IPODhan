/**
 * Backfill Objectives Script
 *
 * Backfills IPO objectives (use of funds) for IPOs with DRHP documents.
 *
 * Usage:
 *   npx tsx scripts/backfill-objectives.ts                    # Process all IPOs
 *   npx tsx scripts/backfill-objectives.ts --limit 10         # Process first 10 IPOs
 *   npx tsx scripts/backfill-objectives.ts --force            # Force reprocess existing data
 *   npx tsx scripts/backfill-objectives.ts --status=OPEN      # Process only OPEN IPOs
 *   npx tsx scripts/backfill-objectives.ts --ipo-id=<uuid>    # Process specific IPO
 *
 * @module scripts/backfill-objectives
 */

import { db, getRedisClient, IPORepository, DocumentRepository } from '@ipodhan/shared';
import { logger } from '../src/utils/logger.js';
import { scrapeIPOObjectives } from '../src/scrapers/objectives-scraper.js';
import { updateIPOObjectives } from '../src/services/data-persister.js';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, and, isNotNull, inArray, sql, isNull } from 'drizzle-orm';

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

  logger.info('[Backfill Objectives] Starting backfill script', args);

  const startTime = Date.now();
  const result = {
    processed: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [] as Array<{ ipoId: string; companyName: string; error: string }>
  };

  try {
    // db and getRedisClient are already imported from @ipodhan/shared
    const redis = getRedisClient();

    const ipoRepository = new IPORepository(db, redis);
    const documentRepository = new DocumentRepository(db);

    // Step 1: Get IPOs with DRHP documents
    let iposQuery = db
      .select({
        ipoId: schema.documents.ipoId,
        companyName: schema.ipos.companyName,
        slug: schema.ipos.slug,
        status: schema.ipos.status,
        objectives: schema.ipos.objectives
      })
      .from(schema.documents)
      .innerJoin(schema.ipos, eq(schema.documents.ipoId, schema.ipos.id))
      .where(
        and(
          inArray(schema.documents.documentType, ['DRHP', 'RHP', 'PROSPECTUS']),
          isNotNull(schema.documents.documentUrl)
        )
      )
      .groupBy(
        schema.documents.ipoId,
        schema.ipos.companyName,
        schema.ipos.slug,
        schema.ipos.status,
        schema.ipos.objectives
      )
      .$dynamic();

    // Apply filters
    if (args.status) {
      iposQuery = iposQuery.where(
        and(
          eq(schema.ipos.status, args.status as any),
          inArray(schema.documents.documentType, ['DRHP', 'RHP', 'PROSPECTUS']),
          isNotNull(schema.documents.documentUrl)
        )
      );
    }

    if (args.ipoId) {
      iposQuery = iposQuery.where(
        and(
          eq(schema.ipos.id, args.ipoId),
          inArray(schema.documents.documentType, ['DRHP', 'RHP', 'PROSPECTUS']),
          isNotNull(schema.documents.documentUrl)
        )
      );
    }

    if (args.limit) {
      iposQuery = iposQuery.limit(args.limit);
    }

    const ipos = await iposQuery;

    if (ipos.length === 0) {
      logger.warn('[Backfill Objectives] No IPOs found matching criteria');
      return;
    }

    logger.info(`[Backfill Objectives] Found ${ipos.length} IPOs to process`);

    // Step 2: Process each IPO
    for (const ipo of ipos) {
      try {
        result.processed++;

        logger.info(
          `[Backfill Objectives] Processing ${ipo.companyName} (${result.processed}/${ipos.length})`
        );

        // Skip if objectives already exist and not forcing
        if (
          !args.force &&
          ipo.objectives &&
          Array.isArray(ipo.objectives) &&
          ipo.objectives.length > 0
        ) {
          logger.info(
            `[Backfill Objectives] Skipping ${ipo.companyName} - already has objectives (use --force to override)`
          );
          result.skipped++;
          continue;
        }

        // Scrape objectives
        const scrapedData = await scrapeIPOObjectives(
          documentRepository,
          ipo.ipoId,
          ipo.companyName
        );

        if (!scrapedData || scrapedData.objectives.length === 0) {
          logger.warn(`[Backfill Objectives] No objectives found for ${ipo.companyName}`);
          result.skipped++;
          continue;
        }

        // Update database
        await updateIPOObjectives(ipoRepository, ipo.ipoId, scrapedData.objectives);

        result.updated++;
        logger.info(
          `[Backfill Objectives] ✓ Updated objectives for ${ipo.companyName} (${scrapedData.objectives.length} items)`
        );

        // Rate limiting: 3 seconds between IPOs
        if (result.processed < ipos.length) {
          logger.debug('[Backfill Objectives] Rate limiting: waiting 3 seconds');
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Backfill Objectives] Failed to process ${ipo.companyName}:`, error);

        result.errors.push({
          ipoId: ipo.ipoId,
          companyName: ipo.companyName,
          error: errorMessage
        });
      }
    }

    const duration = Date.now() - startTime;

    // Print summary
    logger.info({
      ...result,
      durationMinutes: (duration / 1000 / 60).toFixed(2),
      successRate: `${((result.updated / result.processed) * 100).toFixed(1)}%`
    }, '[Backfill Objectives] Backfill completed');

    console.log('\n========================================');
    console.log('BACKFILL OBJECTIVES - SUMMARY');
    console.log('========================================');
    console.log(`Total Processed:  ${result.processed}`);
    console.log(`Updated:          ${result.updated}`);
    console.log(`Skipped:          ${result.skipped}`);
    console.log(`Failed:           ${result.failed}`);
    console.log(`Duration:         ${(duration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`Success Rate:     ${((result.updated / result.processed) * 100).toFixed(1)}%`);
    console.log('========================================\n');

    if (result.errors.length > 0) {
      console.log('ERRORS:');
      result.errors.forEach((err, i) => {
        console.log(`${i + 1}. ${err.companyName} (${err.ipoId})`);
        console.log(`   Error: ${err.error}`);
      });
      console.log('');
    }

    // Exit with error code if failures
    if (result.failed > 0) {
      process.exit(1);
    }
  } catch (error) {
    logger.error('[Backfill Objectives] Critical error:', error);
    console.error('Critical error:', error);
    process.exit(1);
  }
}

// Run the backfill
main()
  .then(() => {
    logger.info('[Backfill Objectives] Script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('[Backfill Objectives] Script failed:', error);
    process.exit(1);
  });
