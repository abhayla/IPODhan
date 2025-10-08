import cron, { type ScheduledTask } from 'node-cron';
import { getRedisClient } from '../../web/lib/cache/redis-client.js';
import logger from '../utils/logger.js';
import { schedulerConfig, LOCK_TTL } from './config.js';
import { JobLockManager } from './job-lock.js';
import { runHealthCheck } from './jobs/health-check.js';
import { runDailySummary } from './jobs/daily-summary.js';
import { runLogCleanup } from './jobs/log-cleanup.js';
import { runNSEScraper } from '../scrapers/nse-scraper-orchestrator.js';
import { runBSEScraper } from '../scrapers/bse-scraper-orchestrator.js';

/**
 * Job handler function type
 */
type JobHandler = () => Promise<any>;

/**
 * Scheduled task wrapper
 */
interface ScheduledTaskWrapper {
  name: string;
  cronTask: ScheduledTask | null;
  isRunning: boolean;
  lastRun: Date | null;
  lastResult: 'success' | 'failure' | null;
}

/**
 * Scheduler Service
 * Orchestrates all scheduled jobs for IPODhan scraper system
 * Manages job execution, locking, error handling, and graceful shutdown
 */
export class SchedulerService {
  private jobs: Map<string, ScheduledTaskWrapper> = new Map();
  private lockManager: JobLockManager;
  private isShuttingDown: boolean = false;
  private redis;

  constructor() {
    this.redis = getRedisClient();
    this.lockManager = new JobLockManager(this.redis, 'scheduler-main');
  }

  /**
   * Initialize scheduler and register all jobs
   */
  async init(): Promise<void> {
    logger.info('Initializing IPODhan Scheduler');

    // Check if scheduler is enabled
    if (!schedulerConfig.enabled) {
      logger.warn('Scheduler is disabled (SCRAPER_ENABLED=false)');
      return;
    }

    logger.info({
      intervalMode: schedulerConfig.intervalMode,
      jobsEnabled: {
        nse: schedulerConfig.jobs.nse.enabled,
        bse: schedulerConfig.jobs.bse.enabled,
        healthCheck: schedulerConfig.jobs.healthCheck.enabled,
        dailySummary: schedulerConfig.jobs.dailySummary.enabled,
        logCleanup: schedulerConfig.jobs.logCleanup.enabled
      }
    }, 'Scheduler configuration loaded');

    // Register signal handlers for graceful shutdown
    this.setupSignalHandlers();

    logger.info('Scheduler initialized successfully');
  }

  /**
   * Start all enabled jobs
   */
  async start(): Promise<void> {
    if (!schedulerConfig.enabled) {
      logger.info('Scheduler not started (disabled)');
      return;
    }

    logger.info('Starting scheduler jobs');

    // Register NSE scraper jobs (market hours, after hours, weekends)
    if (schedulerConfig.jobs.nse.enabled) {
      this.registerJob(
        'nse-market-hours',
        schedulerConfig.jobs.nse.marketHours!,
        () => runNSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.nse.timezone
      );

      this.registerJob(
        'nse-after-hours',
        schedulerConfig.jobs.nse.afterHours!,
        () => runNSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.nse.timezone
      );

      this.registerJob(
        'nse-weekends',
        schedulerConfig.jobs.nse.weekends!,
        () => runNSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.nse.timezone
      );
    }

    // Register BSE scraper jobs (market hours, after hours, weekends)
    if (schedulerConfig.jobs.bse.enabled) {
      this.registerJob(
        'bse-market-hours',
        schedulerConfig.jobs.bse.marketHours!,
        () => runBSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.bse.timezone
      );

      this.registerJob(
        'bse-after-hours',
        schedulerConfig.jobs.bse.afterHours!,
        () => runBSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.bse.timezone
      );

      this.registerJob(
        'bse-weekends',
        schedulerConfig.jobs.bse.weekends!,
        () => runBSEScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.bse.timezone
      );
    }

    // Register health check job (runs 24/7)
    if (schedulerConfig.jobs.healthCheck.enabled) {
      this.registerJob(
        'health-check',
        schedulerConfig.jobs.healthCheck.schedule!,
        () => runHealthCheck(this.redis),
        LOCK_TTL.healthCheck,
        schedulerConfig.jobs.healthCheck.timezone
      );
    }

    // Register daily summary job (runs at 8 AM daily)
    if (schedulerConfig.jobs.dailySummary.enabled) {
      this.registerJob(
        'daily-summary',
        schedulerConfig.jobs.dailySummary.schedule!,
        () => runDailySummary(this.redis),
        LOCK_TTL.dailySummary,
        schedulerConfig.jobs.dailySummary.timezone
      );
    }

    // Register log cleanup job (runs at 2 AM daily - Story 7.5)
    if (schedulerConfig.jobs.logCleanup.enabled) {
      this.registerJob(
        'log-cleanup',
        schedulerConfig.jobs.logCleanup.schedule!,
        () => runLogCleanup(),
        LOCK_TTL.logCleanup,
        schedulerConfig.jobs.logCleanup.timezone
      );
    }

    logger.info({
      totalJobs: this.jobs.size,
      intervalMode: schedulerConfig.intervalMode
    }, 'All scheduler jobs started successfully');
  }

  /**
   * Stop all jobs gracefully
   */
  async stop(): Promise<void> {
    logger.info('Stopping scheduler');
    this.isShuttingDown = true;

    // Stop all cron jobs
    this.jobs.forEach((task, name) => {
      if (task.cronTask) {
        task.cronTask.stop();
        logger.debug({ jobName: name }, 'Stopped cron task');
      }
    });

    // Wait for running jobs to complete (with timeout)
    await this.waitForRunningJobs(30000); // 30 second timeout

    // Release all job locks
    await this.lockManager.releaseAllLocks();

    logger.info('Scheduler stopped gracefully');
  }

  /**
   * Register individual job with cron schedule
   */
  private registerJob(
    name: string,
    schedule: string,
    handler: JobHandler,
    lockTTL: number,
    timezone: string = 'Asia/Kolkata'
  ): void {
    try {
      // Validate cron expression
      if (!cron.validate(schedule)) {
        logger.error({ jobName: name, schedule }, 'Invalid cron expression');
        return;
      }

      // Create cron task
      const cronTask = cron.schedule(
        schedule,
        () => this.executeJob(name, handler, lockTTL),
        {
          timezone
        }
      );

      // Store task metadata
      this.jobs.set(name, {
        name,
        cronTask,
        isRunning: false,
        lastRun: null,
        lastResult: null
      });

      logger.info({
        jobName: name,
        schedule,
        timezone,
        lockTTL
      }, 'Job registered successfully');
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        jobName: name,
        schedule
      }, 'Failed to register job');
    }
  }

  /**
   * Job execution wrapper (handles locking, logging, error handling)
   */
  private async executeJob(
    jobName: string,
    handler: JobHandler,
    lockTTL: number
  ): Promise<void> {
    // Skip if shutting down
    if (this.isShuttingDown) {
      logger.warn({ jobName }, 'Job skipped: scheduler is shutting down');
      return;
    }

    const task = this.jobs.get(jobName);
    if (!task) {
      logger.error({ jobName }, 'Job not found in registry');
      return;
    }

    // Skip if job is already running
    if (task.isRunning) {
      logger.warn({ jobName }, 'Job skipped: already running');
      return;
    }

    const startTime = Date.now();
    logger.info({ jobName }, 'Job started');

    try {
      // Mark job as running
      task.isRunning = true;

      // Acquire lock (skip job if lock already held)
      const lockAcquired = await this.lockManager.acquireLock(jobName, lockTTL);
      if (!lockAcquired) {
        logger.warn({ jobName }, 'Job skipped: lock already held by another process');
        task.isRunning = false;
        return;
      }

      // Execute job handler
      const result = await handler();

      // Release lock
      await this.lockManager.releaseLock(jobName);

      const duration = Date.now() - startTime;
      task.lastRun = new Date();
      task.lastResult = 'success';
      task.isRunning = false;

      logger.info({
        jobName,
        status: 'success',
        duration,
        result: result ? { success: result.success } : undefined
      }, 'Job completed successfully');

    } catch (error) {
      const duration = Date.now() - startTime;
      task.lastRun = new Date();
      task.lastResult = 'failure';
      task.isRunning = false;

      logger.error({
        jobName,
        status: 'failure',
        duration,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }, 'Job failed');

      // Release lock on error
      await this.lockManager.releaseLock(jobName);
    }
  }

  /**
   * Wait for running jobs to complete (with timeout)
   */
  private async waitForRunningJobs(timeout: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const runningJobs = Array.from(this.jobs.values()).filter(task => task.isRunning);

      if (runningJobs.length === 0) {
        logger.info('All running jobs completed');
        return;
      }

      logger.debug({
        runningJobs: runningJobs.map(task => task.name),
        elapsed: Date.now() - startTime,
        timeout
      }, 'Waiting for running jobs to complete');

      // Wait 1 second before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    logger.warn({
      timeout,
      runningJobs: Array.from(this.jobs.values())
        .filter(task => task.isRunning)
        .map(task => task.name)
    }, 'Timeout waiting for running jobs - forcing shutdown');
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal');

      try {
        await this.stop();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error)
        }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }

  /**
   * Get scheduler status (for monitoring)
   */
  getStatus(): {
    enabled: boolean;
    isShuttingDown: boolean;
    jobs: { name: string; isRunning: boolean; lastRun: Date | null; lastResult: string | null }[];
  } {
    return {
      enabled: schedulerConfig.enabled,
      isShuttingDown: this.isShuttingDown,
      jobs: Array.from(this.jobs.values()).map(task => ({
        name: task.name,
        isRunning: task.isRunning,
        lastRun: task.lastRun,
        lastResult: task.lastResult
      }))
    };
  }
}
