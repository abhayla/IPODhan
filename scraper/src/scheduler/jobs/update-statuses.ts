/**
 * Status Updater Cron Job
 *
 * Automatically updates IPO statuses based on dates
 * Runs hourly to ensure statuses are always current
 *
 * Fixes Phase 5 Issue: 29 IPOs with outdated status
 * - 6 UPCOMING → should be OPEN (open_date passed)
 * - 23 OPEN → should be CLOSED (close_date passed)
 *
 * @module scraper/src/scheduler/jobs/update-statuses
 */

import logger from '../../utils/logger.js';
import { updateIPOStatuses, getOutdatedStatusCount } from '../../../../web/lib/services/status-updater-service.js';
import { getDb } from '../../../../web/lib/db/index.js';
import { scraperLogs } from '@ipodhan/shared/db/schema';
import { reresolveRegistrarIds } from '../../services/registrar-reresolve.js';

/**
 * P2-4 (T-300, round-5): piggyback the registrar_id re-resolve pass on this
 * hourly job rather than adding a new cron entry — `registrar_id` is never
 * written at scrape time (see registrar-reresolve.ts header), so new IPOs
 * created since the last pass need periodic retrying as the registrars
 * table grows. Best-effort / non-fatal per `non-fatal-side-effects.md`: its
 * own try/catch, logs `(non-fatal)`, and NEVER affects this job's own
 * success/failure or `scraper_logs` outcome.
 */
async function reresolveRegistrarIdsNonFatal(): Promise<void> {
  try {
    const result = await reresolveRegistrarIds({ dryRun: false });
    if (result.written > 0) {
      logger.info({ ...result }, '[status-updater] piggybacked registrar_id re-resolve');
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'registrar_id re-resolve piggyback failed (non-fatal)'
    );
  }
}

/**
 * Run status updater job
 *
 * This job:
 * 1. Checks for IPOs with outdated status
 * 2. Updates statuses based on dates
 * 3. Invalidates relevant caches
 * 4. Logs results to scraper_logs table
 */
export async function runStatusUpdater(): Promise<{
  success: boolean;
  updatedCount: number;
  error?: string;
}> {
  const startTime = new Date();
  logger.info('Starting status updater job');

  try {
    // Check current outdated count
    const outdatedCount = await getOutdatedStatusCount();
    logger.info({
      upcomingToOpen: outdatedCount.upcomingToOpen,
      openToClosed: outdatedCount.openToClosed,
      closedToListed: outdatedCount.closedToListed,
      total: outdatedCount.total
    }, 'Found outdated statuses');

    // Run status updates
    const result = await updateIPOStatuses();

    const duration = Date.now() - startTime.getTime();

    // Log to scraper_logs table
    const db = await getDb();
    await db.insert(scraperLogs).values({
      source: 'status-updater',
      status: 'SUCCESS',
      recordsProcessed: result.total,
      recordsFailed: 0,
      durationMs: duration,
      errorMessage: null,
      errorStack: null
    });

    logger.info({
      upcomingToOpen: result.upcomingToOpen,
      openToClosed: result.openToClosed,
      closedToListed: result.closedToListed,
      total: result.total,
      duration
    }, 'Status updater job completed successfully');

    await reresolveRegistrarIdsNonFatal();

    return {
      success: true,
      updatedCount: result.total
    };
  } catch (error) {
    const duration = Date.now() - startTime.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error({
      error: errorMessage,
      stack: errorStack,
      duration
    }, 'Status updater job failed');

    // Log failure to scraper_logs table
    try {
      const db = await getDb();
      await db.insert(scraperLogs).values({
        source: 'status-updater',
        status: 'FAILURE',
        recordsProcessed: 0,
        recordsFailed: 0,
        durationMs: duration,
        errorMessage,
        errorStack: errorStack || null
      });
    } catch (logError) {
      logger.error({
        error: logError instanceof Error ? logError.message : String(logError)
      }, 'Failed to log error to database');
    }

    return {
      success: false,
      updatedCount: 0,
      error: errorMessage
    };
  }
}
