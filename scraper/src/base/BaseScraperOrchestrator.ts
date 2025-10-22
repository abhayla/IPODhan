/**
 * Base Scraper Orchestrator - Phase 2: Scraper Integration
 *
 * Abstract base class that enforces manual data protection checks for all scrapers.
 * Uses Template Method pattern to ensure protection logic cannot be bypassed.
 *
 * @module scraper/src/base/BaseScraperOrchestrator
 * @see docs/00-admin/MANUAL_DATA_MANAGEMENT_PLAN.md - Phase 2
 * @see web/lib/admin/field-protection-checker.ts - Protection logic
 */

import type {
  IPORepository,
  SubscriptionRepository,
  ScraperLogRepository,
  IPOInsert
} from '@ipodhan/shared';
import {
  db,
  getRedisClient,
  IPORepository as IPORepositoryClass,
  SubscriptionRepository as SubscriptionRepositoryClass,
  ScraperLogRepository as ScraperLogRepositoryClass
} from '@ipodhan/shared';
import logger from '../utils/logger.js';
import {
  isIPOLocked,
  isFieldProtected,
  filterProtectedFields
} from '@web/lib/admin/field-protection-checker';
import { generateSlug } from '../utils/validators.js';
import { upsertIPO, createSubscriptionSnapshot } from '../services/data-persister.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';
import type { ScraperSource } from '../services/types.js';

/**
 * Result interface for scraper execution
 */
export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  iposSkipped: number;          // NEW: IPOs skipped due to IPO-level lock
  subscriptionsCreated: number;
  subscriptionsSkipped: number;  // NEW: Subscriptions skipped
  fieldsProtected: number;       // NEW: Individual fields protected
  errors: string[];
}

/**
 * Scraped data structure (generic)
 * Subclasses define their own scraped data shape
 */
export interface ScrapedData<TIPO, TSubscription = any> {
  ipos: TIPO[];
  subscriptions: TSubscription[];
}

/**
 * Abstract Base Scraper Orchestrator
 *
 * **Template Method Pattern:**
 * - `run()` is the template method (orchestrates entire flow)
 * - Subclasses implement abstract methods for scraper-specific logic
 * - Protection checks are final methods (cannot be overridden)
 *
 * **Protection Architecture:**
 * 1. Check IPO-level lock first → Skip entire IPO if locked
 * 2. Check field-level protection → Filter protected fields from update data
 * 3. Log all blocked updates to Redis (7-day retention)
 * 4. Continue with non-protected fields
 *
 * **Usage:**
 * ```typescript
 * class NSEScraperOrchestrator extends BaseScraperOrchestrator<ScrapedIPO> {
 *   getScraperName() { return 'NSE'; }
 *   async scrapeData() { return await scrapeNSEIPOs(); }
 *   validateIPO(ipo) { return validateIPOData(ipo); }
 * }
 *
 * const orchestrator = new NSEScraperOrchestrator();
 * const result = await orchestrator.run();
 * ```
 */
export abstract class BaseScraperOrchestrator<TIPO, TSubscription = any> {

  // Repositories and services (initialized in run())
  protected ipoRepository!: IPORepository;
  protected subscriptionRepository!: SubscriptionRepository;
  protected scraperLogRepository!: ScraperLogRepository;
  protected cacheInvalidator!: CacheInvalidator;
  protected metricsTracker!: ScraperMetricsTracker;
  protected alertingService!: AlertingService;

  // Scraper name (e.g., 'NSE', 'BSE', 'MONEYCONTROL')
  protected abstract getScraperName(): ScraperSource;

  // Scraper-specific data fetching logic
  protected abstract scrapeData(): Promise<ScrapedData<TIPO, TSubscription>>;

  // Scraper-specific validation logic
  protected abstract validateIPO(ipo: TIPO): { success: boolean; data?: any; error?: any };

  // Optional: Subscription validation (not all scrapers have subscriptions)
  protected validateSubscription?(sub: TSubscription): { success: boolean; data?: any; error?: any };

  /**
   * Main orchestration flow (Template Method)
   *
   * **CRITICAL:** This method is NOT overridable. All protection checks
   * are enforced here to prevent bypassing.
   *
   * @returns Promise<ScraperResult> - Execution summary
   */
  public async run(): Promise<ScraperResult> {
    const startTime = Date.now();
    const scraperName = this.getScraperName();

    const result: ScraperResult = {
      success: false,
      iposProcessed: 0,
      iposInserted: 0,
      iposUpdated: 0,
      iposFailed: 0,
      iposSkipped: 0,
      subscriptionsCreated: 0,
      subscriptionsSkipped: 0,
      fieldsProtected: 0,
      errors: []
    };

    try {
      logger.info(`${scraperName} scraper orchestrator started (with protection checks)`);

      // Initialize repositories and services
      this.initializeServices();

      // Track updated IPO slugs for cache invalidation
      const updatedIPOSlugs: string[] = [];

      // Step 1: Scrape data (subclass-specific)
      const scrapedData = await this.scrapeData();

      logger.info({
        totalIPOs: scrapedData.ipos.length,
        totalSubscriptions: scrapedData.subscriptions.length
      }, `Scraped data received from ${scraperName}`);

      // Step 2: Process each IPO with protection checks
      for (const scrapedIPO of scrapedData.ipos) {
        try {
          const processResult = await this.processIPO(
            scrapedIPO,
            scrapedData.subscriptions,
            result
          );

          if (processResult.slug) {
            updatedIPOSlugs.push(processResult.slug);
          }

          // Update result counters
          result.iposProcessed += processResult.processed ? 1 : 0;
          result.iposSkipped += processResult.skipped ? 1 : 0;
          result.iposInserted += processResult.inserted ? 1 : 0;
          result.iposUpdated += processResult.updated ? 1 : 0;
          result.iposFailed += processResult.failed ? 1 : 0;
          result.fieldsProtected += processResult.fieldsProtected;
          result.subscriptionsCreated += processResult.subscriptionCreated ? 1 : 0;
          result.subscriptionsSkipped += processResult.subscriptionSkipped ? 1 : 0;

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            { scraperName, error: errorMsg },
            'Failed to process IPO'
          );
          result.iposFailed++;
          result.errors.push(`Processing error: ${errorMsg}`);
        }
      }

      // Step 3: Comprehensive cache invalidation
      if (updatedIPOSlugs.length > 0) {
        await this.cacheInvalidator.invalidateAfterScrape(scraperName, updatedIPOSlugs);
      }

      const duration = Date.now() - startTime;
      result.success = result.iposFailed < result.iposProcessed;

      // Record success
      await this.logSuccess(result, duration);

      logger.info(
        { ...result, duration },
        `${scraperName} scraper orchestrator completed`
      );

      return result;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const duration = Date.now() - startTime;

      logger.error({ error: errorMsg, duration }, `${scraperName} scraper orchestrator failed`);

      result.success = false;
      result.errors.push(`Orchestrator error: ${errorMsg}`);

      // Record failure and handle fallback
      await this.logFailure(error, result, duration, errorStack);

      return result;
    }
  }

  /**
   * Process a single IPO with protection checks
   *
   * **Protection Flow:**
   * 1. Validate IPO data
   * 2. Check IPO-level lock (scraper_locked)
   * 3. Filter protected fields
   * 4. Upsert filtered data
   * 5. Process subscription if applicable
   *
   * @param scrapedIPO - Raw scraped IPO data
   * @param subscriptions - All scraped subscriptions
   * @param result - Result object to update
   * @returns Processing result with counters
   */
  private async processIPO(
    scrapedIPO: TIPO,
    subscriptions: TSubscription[],
    result: ScraperResult
  ): Promise<{
    slug: string | null;
    processed: boolean;
    skipped: boolean;
    inserted: boolean;
    updated: boolean;
    failed: boolean;
    fieldsProtected: number;
    subscriptionCreated: boolean;
    subscriptionSkipped: boolean;
  }> {
    const scraperName = this.getScraperName();
    const processResult = {
      slug: null as string | null,
      processed: false,
      skipped: false,
      inserted: false,
      updated: false,
      failed: false,
      fieldsProtected: 0,
      subscriptionCreated: false,
      subscriptionSkipped: false,
    };

    // Step 1: Validate IPO data
    const validation = this.validateIPO(scrapedIPO);

    if (!validation.success) {
      logger.warn(
        {
          scraperName,
          companyName: (scrapedIPO as any).companyName,
          errors: validation.error?.issues
        },
        'IPO validation failed, skipping'
      );
      result.errors.push(`Validation failed for ${(scrapedIPO as any).companyName}`);
      processResult.failed = true;
      return processResult;
    }

    const validatedIPO = validation.data!;
    const slug = generateSlug(validatedIPO.companyName);
    processResult.slug = slug;

    // Step 2: Check if IPO already exists (for insert vs update tracking)
    const existingIPO = await this.ipoRepository.findBySlug(slug);
    const ipoId = existingIPO?.id;

    // Step 3: PROTECTION CHECK - IPO-level lock
    if (ipoId && await isIPOLocked(ipoId)) {
      logger.warn(
        { scraperName, companyName: validatedIPO.companyName, ipoId },
        'IPO is locked - skipping entire IPO update'
      );
      processResult.skipped = true;
      return processResult;
    }

    // Step 4: PROTECTION CHECK - Field-level filtering
    let filteredIPOData = validatedIPO;

    if (ipoId) {
      // Filter protected fields from the update data
      const originalFieldCount = Object.keys(validatedIPO).length;

      filteredIPOData = await filterProtectedFields(
        ipoId,
        'ipos',
        validatedIPO,
        scraperName
      ) as typeof validatedIPO;

      const filteredFieldCount = Object.keys(filteredIPOData).length;
      const protectedCount = originalFieldCount - filteredFieldCount;

      if (protectedCount > 0) {
        logger.info(
          {
            scraperName,
            companyName: validatedIPO.companyName,
            ipoId,
            protectedCount,
            originalCount: originalFieldCount,
            filteredCount: filteredFieldCount
          },
          `Filtered ${protectedCount} protected fields from IPO update`
        );
        processResult.fieldsProtected += protectedCount;
      }

      // If all fields are protected, skip the update
      if (Object.keys(filteredIPOData).length === 0) {
        logger.warn(
          { scraperName, companyName: validatedIPO.companyName, ipoId },
          'All fields are protected - skipping IPO update'
        );
        processResult.skipped = true;
        return processResult;
      }
    }

    // Step 5: Upsert filtered IPO data
    const upsertedIPOId = await upsertIPO(this.ipoRepository, filteredIPOData, scraperName);

    if (existingIPO) {
      processResult.updated = true;
    } else {
      processResult.inserted = true;
    }

    processResult.processed = true;

    // Step 6: Process subscription data for OPEN IPOs
    if (validatedIPO.status === 'OPEN' && this.validateSubscription) {
      const relatedSubscription = subscriptions.find(
        (sub: any) => sub.ipoCompanyName === validatedIPO.companyName
      );

      if (relatedSubscription) {
        // Check if subscription data is protected
        const subscriptionProtected = ipoId && await this.isSubscriptionProtected(ipoId);

        if (subscriptionProtected) {
          logger.info(
            { scraperName, companyName: validatedIPO.companyName, ipoId },
            'Subscription data is protected - skipping subscription update'
          );
          processResult.subscriptionSkipped = true;
        } else {
          const subscriptionValidation = this.validateSubscription(relatedSubscription);

          if (subscriptionValidation.success) {
            await createSubscriptionSnapshot(
              this.subscriptionRepository,
              upsertedIPOId,
              subscriptionValidation.data!
            );
            processResult.subscriptionCreated = true;
          } else {
            logger.warn(
              {
                scraperName,
                companyName: validatedIPO.companyName,
                errors: subscriptionValidation.error?.issues
              },
              'Subscription validation failed, skipping'
            );
          }
        }
      }
    }

    return processResult;
  }

  /**
   * Check if subscription data is protected
   * Helper method to check key subscription fields
   *
   * @param ipoId - IPO ID
   * @returns True if any critical subscription field is protected
   */
  private async isSubscriptionProtected(ipoId: string): Promise<boolean> {
    const criticalFields = [
      'totalSubscription',
      'qibSubscription',
      'niiSubscription',
      'retailSubscription'
    ];

    for (const field of criticalFields) {
      const protected_ = await isFieldProtected(ipoId, 'subscriptions', field);
      if (protected_.protected) {
        return true;
      }
    }

    return false;
  }

  /**
   * Initialize repositories and services
   * Called at the start of run()
   */
  private initializeServices(): void {
    const redis = getRedisClient();

    this.ipoRepository = new IPORepositoryClass(db, redis);
    this.subscriptionRepository = new SubscriptionRepositoryClass(db, redis);
    this.scraperLogRepository = new ScraperLogRepositoryClass(db, redis);
    this.cacheInvalidator = new CacheInvalidator(redis);
    this.metricsTracker = new ScraperMetricsTracker(redis);
    this.alertingService = new AlertingService();
  }

  /**
   * Log successful scraper execution
   */
  private async logSuccess(result: ScraperResult, duration: number): Promise<void> {
    const scraperName = this.getScraperName();

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess(scraperName);

    // Log to database
    await this.scraperLogRepository.create({
      source: scraperName,
      status: 'SUCCESS',
      recordsProcessed: result.iposProcessed,
      recordsFailed: result.iposFailed,
      durationMs: duration,
      errorMessage: null,
      errorStack: null,
    });

    // Record metrics
    await this.metricsTracker.recordSuccess(scraperName);
  }

  /**
   * Log scraper failure and handle fallback
   */
  private async logFailure(
    error: unknown,
    result: ScraperResult,
    duration: number,
    errorStack?: string
  ): Promise<void> {
    const scraperName = this.getScraperName();
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure(scraperName, error instanceof Error ? error : new Error(errorMsg));

    // Log to database
    await this.scraperLogRepository.create({
      source: scraperName,
      status: 'FAILURE',
      recordsProcessed: result.iposProcessed,
      recordsFailed: result.iposFailed,
      durationMs: duration,
      errorMessage: errorMsg,
      errorStack: errorStack || null,
    });

    // Record metrics
    await this.metricsTracker.recordFailure(scraperName);

    // Check if alert should be sent
    const { sendAlert, reason } = await this.metricsTracker.shouldSendAlert(scraperName);
    if (sendAlert && reason) {
      const metrics = await this.metricsTracker.getMetrics(scraperName);
      const consecutiveFailures = await this.metricsTracker.getConsecutiveFailures(scraperName);
      const recentLogs = await this.scraperLogRepository.getRecentLogs(scraperName, 24);
      const recentErrors = this.alertingService.getRecentErrors(recentLogs);

      await this.alertingService.sendAlert({
        source: scraperName,
        severity: consecutiveFailures >= 3 ? 'ERROR' : 'WARN',
        reason,
        consecutiveFailures,
        successRate: metrics.rate,
        recentErrors,
        timestamp: new Date(),
      });

      // Mark alert as sent
      await this.metricsTracker.markAlertSent(scraperName);
    }
  }
}
