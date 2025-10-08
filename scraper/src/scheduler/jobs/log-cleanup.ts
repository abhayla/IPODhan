/**
 * Log Cleanup Job
 *
 * Deletes scraper logs older than specified retention period (default: 30 days).
 * Story 7.5: Error Handling & Monitoring
 */

import { db } from '@web/lib/db';
import { getRedisClient } from '@web/lib/cache/redis-client';
import { ScraperLogRepository } from '@web/lib/repositories/scraper-log-repository';
import { logger } from '../../utils/logger';

/**
 * Run log cleanup job
 * Removes scraper logs older than retention period
 */
export async function runLogCleanup(): Promise<{ deletedCount: number }> {
  const startTime = Date.now();

  try {
    // Get retention period from environment (default: 30 days)
    const retentionDays = parseInt(process.env.LOG_RETENTION_DAYS || '30', 10);

    logger.info(
      { retentionDays },
      'Starting log cleanup job'
    );

    // Initialize repository
    const redis = getRedisClient();
    const scraperLogRepository = new ScraperLogRepository(db, redis);

    // Delete old logs
    const deletedCount = await scraperLogRepository.cleanupOldLogs(retentionDays);

    const duration = Date.now() - startTime;

    logger.info(
      {
        job: 'log-cleanup',
        retentionDays,
        deletedCount,
        duration,
        timestamp: new Date(),
      },
      `Log cleanup completed: ${deletedCount} logs deleted in ${duration}ms`
    );

    return { deletedCount };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        duration,
      },
      'Log cleanup job failed'
    );

    throw error;
  }
}
