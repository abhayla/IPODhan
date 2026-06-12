/**
 * Anchor Investors Job
 *
 * Scheduled job that scrapes anchor investor data from DRHP PDFs for all IPOs.
 *
 * Schedule: Daily at 5 AM IST (after financial data and peer companies scrapers)
 * Lock TTL: 45 minutes (long-running PDF processing)
 *
 * Features:
 * - Processes IPOs with DRHP documents
 * - Extracts anchor investor allocation data
 * - Calculates lock-in dates (30 days, 90 days)
 * - Upserts data (creates or updates existing records)
 * - Rate limiting between IPOs (5 seconds)
 *
 * @module jobs/anchor-investors-job
 */

import { db, getRedisClient } from '@ipodhan/shared';
import { logger } from '../utils/logger.js';
import { scrapeAnchorInvestors, batchScrapeAnchorInvestors } from '../scrapers/anchor-investors-scraper.js';
import { AnchorInvestorRepository } from '../repositories/anchor-investor-repository.js';
import { createAnchorInvestors } from '../services/data-persister.js';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';

/**
 * Job configuration
 */
const JOB_CONFIG = {
  name: 'anchor-investors-job',
  lockTTL: 45 * 60, // 45 minutes (long-running PDF processing)
  rateLimit: 5000,   // 5 seconds between IPOs
  batchSize: 50,      // Process max 50 IPOs per run
  retryAttempts: 2
};

/**
 * Anchor Investors Job Entry Point
 *
 * Processes all IPOs with DRHP documents to extract anchor investor data.
 *
 * @returns Job result with statistics
 */
export async function runAnchorInvestorsJob(): Promise<{
  success: boolean;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
  duration: number;
  errors: Array<{ ipoId: string; error: string }>;
}> {
  const startTime = Date.now();

  logger.info('[Anchor Investors Job] Starting scheduled job');

  const result = {
    success: true,
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    skipped: 0,
    duration: 0,
    errors: [] as Array<{ ipoId: string; error: string }>
  };

  try {
    // Get database and Redis connections
    // db is already imported from @ipodhan/shared
    const redis = getRedisClient();

    const anchorInvestorRepository = new AnchorInvestorRepository(db);

    // Step 1: Get all IPOs with DRHP documents
    const iposWithDRHP = await db
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
          isNotNull(schema.documents.documentUrl),
          inArray(schema.ipos.status, ['OPEN', 'CLOSED', 'LISTED'])
        )
      )
      .groupBy(schema.documents.ipoId, schema.ipos.companyName, schema.ipos.slug, schema.ipos.status)
      .limit(JOB_CONFIG.batchSize);

    if (iposWithDRHP.length === 0) {
      logger.warn('[Anchor Investors Job] No IPOs with DRHP documents found');
      result.duration = Date.now() - startTime;
      return result;
    }

    logger.info(`[Anchor Investors Job] Found ${iposWithDRHP.length} IPOs with DRHP documents`);

    // Step 2: Process each IPO
    for (const ipo of iposWithDRHP) {
      try {
        result.processed++;

        logger.info(`[Anchor Investors Job] Processing ${ipo.companyName} (${result.processed}/${iposWithDRHP.length})`);

        // Check if anchor data already exists
        const existing = await anchorInvestorRepository.findByIPOId(ipo.ipoId);

        // Skip if data exists and IPO is LISTED (data won't change)
        if (existing && ipo.status === 'LISTED') {
          logger.info(`[Anchor Investors Job] Skipping ${ipo.companyName} - already has anchor data and is LISTED`);
          result.skipped++;
          continue;
        }

        // Scrape anchor investor data
        const anchorData = await scrapeAnchorInvestors(db, ipo.ipoId, ipo.companyName);

        if (!anchorData) {
          logger.warn(`[Anchor Investors Job] No anchor data found for ${ipo.companyName}`);
          result.skipped++;
          continue;
        }

        // Persist to database
        await createAnchorInvestors(anchorInvestorRepository, ipo.ipoId, anchorData);

        if (existing) {
          result.updated++;
          logger.info(`[Anchor Investors Job] ✓ Updated anchor data for ${ipo.companyName}`);
        } else {
          result.created++;
          logger.info(`[Anchor Investors Job] ✓ Created anchor data for ${ipo.companyName}`);
        }

        // Rate limiting: 5 seconds between IPOs
        if (result.processed < iposWithDRHP.length) {
          logger.debug(`[Anchor Investors Job] Rate limiting: waiting ${JOB_CONFIG.rateLimit}ms`);
          await new Promise(resolve => setTimeout(resolve, JOB_CONFIG.rateLimit));
        }

      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Anchor Investors Job] Failed to process ${ipo.companyName}:`, error);

        result.errors.push({
          ipoId: ipo.ipoId,
          error: errorMessage
        });

        // Continue with next IPO (don't fail entire job)
      }
    }

    result.duration = Date.now() - startTime;

    // Log summary
    logger.info({
      ...result,
      durationMinutes: (result.duration / 1000 / 60).toFixed(2)
    }, '[Anchor Investors Job] Job completed');

    // Mark as failed if more than 50% of IPOs failed
    if (result.failed > result.processed / 2) {
      result.success = false;
      logger.error('[Anchor Investors Job] Job failed: >50% of IPOs failed to process');
    }

    return result;

  } catch (error) {
    result.success = false;
    result.duration = Date.now() - startTime;

    logger.error('[Anchor Investors Job] Job failed with critical error:', error);

    throw error;
  }
}

/**
 * Backfill anchor investor data for specific IPO
 *
 * @param ipoId - IPO ID to process
 * @returns Success status
 */
export async function backfillAnchorInvestorForIPO(ipoId: string): Promise<boolean> {
  try {
    logger.info(`[Anchor Investors Job] Backfilling anchor data for IPO ${ipoId}`);

    // db is already imported from @ipodhan/shared
    const anchorInvestorRepository = new AnchorInvestorRepository(db);

    // Get IPO details
    const ipo = await db.query.ipos.findFirst({
      where: eq(schema.ipos.id, ipoId)
    });

    if (!ipo) {
      logger.error(`[Anchor Investors Job] IPO not found: ${ipoId}`);
      return false;
    }

    // Scrape anchor data
    const anchorData = await scrapeAnchorInvestors(db, ipoId, ipo.companyName);

    if (!anchorData) {
      logger.warn(`[Anchor Investors Job] No anchor data found for ${ipo.companyName}`);
      return false;
    }

    // Persist to database
    await createAnchorInvestors(anchorInvestorRepository, ipoId, anchorData);

    logger.info(`[Anchor Investors Job] ✓ Successfully backfilled anchor data for ${ipo.companyName}`);
    return true;

  } catch (error) {
    logger.error(`[Anchor Investors Job] Backfill failed for IPO ${ipoId}:`, error);
    return false;
  }
}
