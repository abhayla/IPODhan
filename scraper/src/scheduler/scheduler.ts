import cron, { type ScheduledTask } from 'node-cron';
import { getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { schedulerConfig, LOCK_TTL } from './config.js';
import { JobLockManager } from './job-lock.js';
import { runHealthCheck } from './jobs/health-check.js';
import { runDailySummary } from './jobs/daily-summary.js';
import { runLogCleanup } from './jobs/log-cleanup.js';
import { runStatusUpdater } from './jobs/update-statuses.js';
import { runNSEScraper } from '../scrapers/nse-scraper-orchestrator.js';
import { runBSEScraper } from '../scrapers/bse-scraper-orchestrator.js';
import { runMoneycontrolScraper } from '../scrapers/moneycontrol-orchestrator.js';
import { runChittorgarhScraper } from '../scrapers/chittorgarh-orchestrator.js';
import { runInvestorgainGMPScraper } from '../scrapers/investorgain-gmp-orchestrator-v2.js';
import { updateListingPerformance } from '../scrapers/listing-performance-updater.js';
import { runFinancialDataJob } from '../jobs/financial-data-job.js';
import { runPeerCompaniesJob } from '../jobs/peer-companies-job.js';
import { runAnchorInvestorsJob } from '../jobs/anchor-investors-job.js';
import { runIPOReviewsJob } from '../jobs/ipo-reviews-job.js';
import { runObjectivesJob } from '../jobs/objectives-job.js';

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
        moneycontrol: schedulerConfig.jobs.moneycontrol.enabled,
        chittorgarh: schedulerConfig.jobs.chittorgarh.enabled,
        listingPerformanceUpdate: schedulerConfig.jobs.listingPerformanceUpdate.enabled,
        statusUpdater: schedulerConfig.jobs.statusUpdater.enabled,
        financialData: schedulerConfig.jobs.financialData.enabled,
        peerCompanies: schedulerConfig.jobs.peerCompanies.enabled,
        anchorInvestors: schedulerConfig.jobs.anchorInvestors.enabled,
        ipoReviews: schedulerConfig.jobs.ipoReviews.enabled,
        objectives: schedulerConfig.jobs.objectives.enabled,
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

    // Register Moneycontrol scraper job (runs 24/7 every 30 min - Story 7.6b)
    if (schedulerConfig.jobs.moneycontrol.enabled) {
      this.registerJob(
        'moneycontrol',
        schedulerConfig.jobs.moneycontrol.schedule!,
        () => runMoneycontrolScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.moneycontrol.timezone
      );
    }

    // Register Chittorgarh scraper job (runs 24/7 every 45 min - Story 7.6b - includes GMP)
    if (schedulerConfig.jobs.chittorgarh.enabled) {
      this.registerJob(
        'chittorgarh',
        schedulerConfig.jobs.chittorgarh.schedule!,
        () => runChittorgarhScraper(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.chittorgarh.timezone
      );
    }

    // Register InvestorGain GMP job (every 6h) — the root-cause fix for frozen
    // GMP coverage: the gmp_records writer was never scheduled. GATED OFF via
    // ENABLE_GMP_SCHEDULED_JOB; registerJob's job-level Redis lock prevents the
    // job racing itself. (#6/#8 — GMP coverage revival)
    if (schedulerConfig.jobs.gmpInvestorgain.enabled) {
      this.registerJob(
        'gmpInvestorgain',
        schedulerConfig.jobs.gmpInvestorgain.schedule!,
        () => runInvestorgainGMPScraper(),
        LOCK_TTL.gmpInvestorgain,
        schedulerConfig.jobs.gmpInvestorgain.timezone
      );
    }

    // Register Listing Performance Update job (ISS-001 Fix - market hours, after hours, weekends)
    if (schedulerConfig.jobs.listingPerformanceUpdate.enabled) {
      this.registerJob(
        'listing-performance-market-hours',
        schedulerConfig.jobs.listingPerformanceUpdate.marketHours!,
        () => updateListingPerformance(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.listingPerformanceUpdate.timezone
      );

      this.registerJob(
        'listing-performance-after-hours',
        schedulerConfig.jobs.listingPerformanceUpdate.afterHours!,
        () => updateListingPerformance(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.listingPerformanceUpdate.timezone
      );

      this.registerJob(
        'listing-performance-weekends',
        schedulerConfig.jobs.listingPerformanceUpdate.weekends!,
        () => updateListingPerformance(),
        LOCK_TTL.scraper,
        schedulerConfig.jobs.listingPerformanceUpdate.timezone
      );
    }

    // Register Status Updater job (Phase 5 Fix - runs 24/7)
    if (schedulerConfig.jobs.statusUpdater.enabled) {
      this.registerJob(
        'status-updater',
        schedulerConfig.jobs.statusUpdater.schedule!,
        () => runStatusUpdater(),
        LOCK_TTL.statusUpdater,
        schedulerConfig.jobs.statusUpdater.timezone
      );
    }

    // Register Financial Data Scraper job (Daily at 3 AM)
    if (schedulerConfig.jobs.financialData.enabled) {
      this.registerJob(
        'financial-data-scraper',
        schedulerConfig.jobs.financialData.schedule!,
        () => runFinancialDataJob(),
        LOCK_TTL.financialData,
        schedulerConfig.jobs.financialData.timezone
      );
    }

    // Register Peer Companies Scraper job (Daily at 4 AM)
    if (schedulerConfig.jobs.peerCompanies.enabled) {
      this.registerJob(
        'peer-companies-scraper',
        schedulerConfig.jobs.peerCompanies.schedule!,
        () => runPeerCompaniesJob(),
        LOCK_TTL.peerCompanies,
        schedulerConfig.jobs.peerCompanies.timezone
      );
    }

    // Register Anchor Investors Scraper job (Daily at 5 AM)
    if (schedulerConfig.jobs.anchorInvestors.enabled) {
      this.registerJob(
        'anchor-investors-scraper',
        schedulerConfig.jobs.anchorInvestors.schedule!,
        () => runAnchorInvestorsJob(),
        LOCK_TTL.anchorInvestors,
        schedulerConfig.jobs.anchorInvestors.timezone
      );
    }

    // Register IPO Reviews Aggregator job (Every 6 hours)
    if (schedulerConfig.jobs.ipoReviews.enabled) {
      this.registerJob(
        'ipo-reviews-aggregator',
        schedulerConfig.jobs.ipoReviews.schedule!,
        () => runIPOReviewsJob(),
        LOCK_TTL.ipoReviews,
        schedulerConfig.jobs.ipoReviews.timezone
      );
    }

    // Register objectives scraper job (daily at 6 AM)
    if (schedulerConfig.jobs.objectives.enabled) {
      this.registerJob(
        'objectives',
        schedulerConfig.jobs.objectives.schedule!,
        () => runObjectivesJob(),
        LOCK_TTL.objectives,
        schedulerConfig.jobs.objectives.timezone
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
