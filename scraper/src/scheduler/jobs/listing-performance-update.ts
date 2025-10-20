/**
 * Scheduler Job: Listing Performance Update
 *
 * ISS-001 Fix: Periodically updates current prices for all LISTED IPOs
 *
 * Schedule:
 * - Market Hours (9 AM - 5 PM Mon-Fri): Every 30 minutes
 * - After Hours (5 PM - 9 AM Mon-Fri): Every 2 hours
 * - Weekends: Every 4 hours
 *
 * This ensures:
 * 1. Real-time price updates during trading hours
 * 2. Reduced API calls during off-hours
 * 3. Complete coverage of all 388 LISTED IPOs
 */

import cron from 'node-cron';
import logger from '../../utils/logger.js';
import { updateListingPerformance } from '../../scrapers/listing-performance-updater.js';
import { acquireJobLock, releaseJobLock } from '../job-lock.js';
import { schedulerConfig, LOCK_TTL } from '../config.js';

const JOB_NAME = 'listing-performance-update';

/**
 * Execute listing performance update with lock
 */
async function executeUpdate(): Promise<void> {
  const lockAcquired = await acquireJobLock(JOB_NAME, LOCK_TTL.scraper);

  if (!lockAcquired) {
    logger.warn({ job: JOB_NAME }, 'Job already running, skipping execution (lock held)');
    return;
  }

  try {
    logger.info({ job: JOB_NAME }, 'Starting scheduled listing performance update');

    const result = await updateListingPerformance();

    logger.info({
      job: JOB_NAME,
      result,
    }, 'Scheduled listing performance update completed');

    // Alert if high failure rate (>10%)
    if (result.failures > 0 && result.failures / result.totalListedIPOs > 0.1) {
      logger.error({
        job: JOB_NAME,
        totalIPOs: result.totalListedIPOs,
        failures: result.failures,
        failureRate: Math.round((result.failures / result.totalListedIPOs) * 100),
      }, '⚠️ High failure rate in listing performance update (>10%)');
    }

  } catch (error) {
    logger.error({
      job: JOB_NAME,
      error: error instanceof Error ? error.message : String(error),
    }, 'Scheduled listing performance update failed');
  } finally {
    await releaseJobLock(JOB_NAME);
  }
}

/**
 * Schedule listing performance update job
 */
export function scheduleListingPerformanceUpdate(): void {
  const jobConfig = schedulerConfig.jobs.listingPerformanceUpdate;

  if (!jobConfig || !jobConfig.enabled) {
    logger.info({ job: JOB_NAME }, 'Job is disabled in configuration');
    return;
  }

  // Market hours schedule
  if (jobConfig.marketHours) {
    cron.schedule(
      jobConfig.marketHours,
      () => {
        logger.debug({ job: JOB_NAME, schedule: 'market-hours' }, 'Market hours trigger');
        executeUpdate();
      },
      {
        timezone: jobConfig.timezone,
      }
    );

    logger.info({
      job: JOB_NAME,
      schedule: jobConfig.marketHours,
      timezone: jobConfig.timezone,
      period: 'market-hours',
    }, 'Market hours schedule registered');
  }

  // After hours schedule
  if (jobConfig.afterHours) {
    cron.schedule(
      jobConfig.afterHours,
      () => {
        logger.debug({ job: JOB_NAME, schedule: 'after-hours' }, 'After hours trigger');
        executeUpdate();
      },
      {
        timezone: jobConfig.timezone,
      }
    );

    logger.info({
      job: JOB_NAME,
      schedule: jobConfig.afterHours,
      timezone: jobConfig.timezone,
      period: 'after-hours',
    }, 'After hours schedule registered');
  }

  // Weekend schedule
  if (jobConfig.weekends) {
    cron.schedule(
      jobConfig.weekends,
      () => {
        logger.debug({ job: JOB_NAME, schedule: 'weekends' }, 'Weekend trigger');
        executeUpdate();
      },
      {
        timezone: jobConfig.timezone,
      }
    );

    logger.info({
      job: JOB_NAME,
      schedule: jobConfig.weekends,
      timezone: jobConfig.timezone,
      period: 'weekends',
    }, 'Weekend schedule registered');
  }

  logger.info({ job: JOB_NAME }, 'Listing performance update job scheduled successfully');
}
