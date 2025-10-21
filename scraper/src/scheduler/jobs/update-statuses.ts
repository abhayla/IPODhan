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
