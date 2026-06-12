/**
 * Objectives Job
 *
 * Scheduled job that scrapes IPO objectives (use of funds) from DRHP PDFs for all IPOs.
 *
 * Schedule: Daily at 6 AM IST (after anchor investors scraper)
 * Lock TTL: 30 minutes (PDF processing)
 *
 * Features:
 * - Processes IPOs with DRHP documents
 * - Extracts "Objects of the Offer" section
 * - Parses objectives with amounts
 * - Updates ipos.objectives field (JSONB)
 * - Rate limiting between IPOs (3 seconds)
 *
 * @module jobs/objectives-job
 */

import { db, getRedisClient } from '@ipodhan/shared';
import { logger } from '../utils/logger.js';
import { scrapeIPOObjectives, batchScrapeObjectives } from '../scrapers/objectives-scraper.js';
import { updateIPOObjectives } from '../services/data-persister.js';
import { IPORepository, DocumentRepository } from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, and, isNotNull, inArray } from 'drizzle-orm';

/**
 * Job configuration
 */
const JOB_CONFIG = {
  name: 'objectives-job',
  lockTTL: 30 * 60, // 30 minutes (PDF processing)
  rateLimit: 3000,   // 3 seconds between IPOs
  batchSize: 50,      // Process max 50 IPOs per run
  retryAttempts: 2
};

/**
 * Objectives Job Entry Point
 *
 * Processes all IPOs with DRHP documents to extract objectives data.
 *
 * @returns Job result with statistics
 */
export async function runObjectivesJob(): Promise<{
  success: boolean;
  processed: number;
  updated: number;
  failed: number;
  skipped: number;
  duration: number;
  errors: Array<{ ipoId: string; error: string }>;
}> {
  const startTime = Date.now();

  logger.info('[Objectives Job] Starting scheduled job');

  const result = {
    success: true,
    processed: 0,
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

    const ipoRepository = new IPORepository(db, redis);
    const documentRepository = new DocumentRepository(db);

    // Step 1: Get all IPOs with DRHP documents that don't have objectives yet
    const iposWithDRHP = await db
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
          isNotNull(schema.documents.documentUrl),
          inArray(schema.ipos.status, ['OPEN', 'CLOSED', 'LISTED'])
        )
      )
      .groupBy(
        schema.documents.ipoId,
        schema.ipos.companyName,
        schema.ipos.slug,
        schema.ipos.status,
        schema.ipos.objectives
      )
      .limit(JOB_CONFIG.batchSize);

    if (iposWithDRHP.length === 0) {
      logger.warn('[Objectives Job] No IPOs with DRHP documents found');
      result.duration = Date.now() - startTime;
      return result;
    }

    logger.info(`[Objectives Job] Found ${iposWithDRHP.length} IPOs with DRHP documents`);

    // Step 2: Process each IPO
    for (const ipo of iposWithDRHP) {
      try {
        result.processed++;

        logger.info(`[Objectives Job] Processing ${ipo.companyName} (${result.processed}/${iposWithDRHP.length})`);

        // Skip if objectives already exist and IPO is LISTED (data won't change)
        if (ipo.objectives && Array.isArray(ipo.objectives) && ipo.objectives.length > 0 && ipo.status === 'LISTED') {
          logger.info(`[Objectives Job] Skipping ${ipo.companyName} - already has objectives and is LISTED`);
          result.skipped++;
          continue;
        }

        // Scrape objectives data
        const scrapedData = await scrapeIPOObjectives(documentRepository, ipo.ipoId, ipo.companyName);

        if (!scrapedData || scrapedData.objectives.length === 0) {
          logger.warn(`[Objectives Job] No objectives found for ${ipo.companyName}`);
          result.skipped++;
          continue;
        }

        // Update database
        await updateIPOObjectives(ipoRepository, ipo.ipoId, scrapedData.objectives);

        result.updated++;
        logger.info(`[Objectives Job] ✓ Updated objectives for ${ipo.companyName} (${scrapedData.objectives.length} items)`);

        // Rate limiting: 3 seconds between IPOs
        if (result.processed < iposWithDRHP.length) {
          logger.debug(`[Objectives Job] Rate limiting: waiting ${JOB_CONFIG.rateLimit}ms`);
          await new Promise(resolve => setTimeout(resolve, JOB_CONFIG.rateLimit));
        }

      } catch (error) {
        result.failed++;
        const errorMessage = error instanceof Error ? error.message : String(error);

        logger.error(`[Objectives Job] Failed to process ${ipo.companyName}:`, error);

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
    }, '[Objectives Job] Job completed');

    // Mark as failed if more than 50% of IPOs failed
    if (result.failed > result.processed / 2) {
      result.success = false;
      logger.error('[Objectives Job] Job failed: >50% of IPOs failed to process');
    }

    return result;

  } catch (error) {
    result.success = false;
    result.duration = Date.now() - startTime;

    logger.error('[Objectives Job] Job failed with critical error:', error);

    throw error;
  }
}

/**
 * Backfill objectives for specific IPO
 *
 * @param ipoId - IPO ID to process
 * @returns Success status
 */
export async function backfillObjectivesForIPO(ipoId: string): Promise<boolean> {
  try {
    logger.info(`[Objectives Job] Backfilling objectives for IPO ${ipoId}`);

    // db is already imported from @ipodhan/shared
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const documentRepository = new DocumentRepository(db);

    // Get IPO details
    const ipo = await db.query.ipos.findFirst({
      where: eq(schema.ipos.id, ipoId)
    });

    if (!ipo) {
      logger.error(`[Objectives Job] IPO not found: ${ipoId}`);
      return false;
    }

    // Scrape objectives
    const scrapedData = await scrapeIPOObjectives(documentRepository, ipoId, ipo.companyName);

    if (!scrapedData || scrapedData.objectives.length === 0) {
      logger.warn(`[Objectives Job] No objectives found for ${ipo.companyName}`);
      return false;
    }

    // Update database
    await updateIPOObjectives(ipoRepository, ipoId, scrapedData.objectives);

    logger.info(`[Objectives Job] ✓ Successfully backfilled objectives for ${ipo.companyName} (${scrapedData.objectives.length} items)`);
    return true;

  } catch (error) {
    logger.error(`[Objectives Job] Backfill failed for IPO ${ipoId}:`, error);
    return false;
  }
}
