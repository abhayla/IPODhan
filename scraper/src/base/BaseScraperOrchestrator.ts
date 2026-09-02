/**
 * Base Scraper Orchestrator - Phase 1 + Phase 2: Data Consolidation + Manual Protection
 *
 * Abstract base class that enforces:
 * - Phase 1: Intelligent multi-source data consolidation with conflict detection
 * - Phase 2: Manual data protection checks for scrapers
 *
 * Uses Template Method pattern to ensure neither protection nor consolidation can be bypassed.
 *
 * @module scraper/src/base/BaseScraperOrchestrator
 * @see docs/08-scraping/PHASE_1_COMPLETION_FINAL.md - Phase 1
 * @see docs/00-admin/MANUAL_DATA_MANAGEMENT_PLAN.md - Phase 2
 * @see web/lib/admin/field-protection-checker.ts - Protection logic
 */

import type {
  IPORepository,
  SubscriptionRepository,
  ScraperLogRepository,
  IPOInsert,
  IPO,
  FieldSourcesRepository,
  DataConflictsRepository
} from '@ipodhan/shared';
import {
  db,
  getRedisClient,
  IPORepository as IPORepositoryClass,
  SubscriptionRepository as SubscriptionRepositoryClass,
  ScraperLogRepository as ScraperLogRepositoryClass,
  FieldSourcesRepository as FieldSourcesRepositoryClass,
  DataConflictsRepository as DataConflictsRepositoryClass,
  createFieldProtectionService,
  resolveIpoRow,
  type FieldProtectionService
} from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { generateSlug } from '../utils/validators.js';
import { upsertIPO, createSubscriptionSnapshot, normalizeCompanyNameForMatching } from '../services/data-persister.js';
import { recordDocumentSourceHints } from '../services/data-persister.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';
import type { ScraperSource } from '../services/types.js';
import { DataConsolidationOrchestrator } from '../services/data-consolidation-orchestrator.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { computeBlankFieldStats, evaluateAndRecordDegradation } from '../services/selector-degradation-monitor.js';
import type Redis from 'ioredis';

/**
 * Result interface for scraper execution
 */
export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  iposSkipped: number;          // Phase 2: IPOs skipped due to IPO-level lock
  subscriptionsCreated: number;
  subscriptionsSkipped: number;  // Phase 2: Subscriptions skipped
  fieldsProtected: number;       // Phase 2: Individual fields protected
  errors: string[];
  // Phase 1: Data consolidation metrics
  consolidationEnabled?: boolean;
  conflictsDetected?: number;
  fieldsConsolidated?: number;
  avgConsolidationTimeMs?: number;
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
  protected fieldProtectionService!: FieldProtectionService;

  // Phase 1: Data consolidation services
  protected fieldSourcesRepository!: FieldSourcesRepository;
  protected dataConflictsRepository!: DataConflictsRepository;
  protected consolidationOrchestrator!: DataConsolidationOrchestrator;

  // T-195: selector-degradation detection
  protected redis!: Redis;

  // Scraper name (e.g., 'NSE', 'BSE', 'MONEYCONTROL')
  protected abstract getScraperName(): ScraperSource;

  // Scraper-specific data fetching logic
  protected abstract scrapeData(): Promise<ScrapedData<TIPO, TSubscription>>;

  // Scraper-specific validation logic (can be sync or async for backward compatibility)
  protected abstract validateIPO(ipo: TIPO): { success: boolean; data?: any; error?: any } | Promise<{ success: boolean; data?: any; error?: any }>;

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
      errors: [],
      // Phase 1: Consolidation metrics
      consolidationEnabled: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
      conflictsDetected: 0,
      fieldsConsolidated: 0,
      avgConsolidationTimeMs: 0,
    };

    try {
      logger.info(`${scraperName} scraper orchestrator started (Phase 1 consolidation + Phase 2 protection)`);

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

      // T-195: selector-degradation detection — compute this scrape's
      // row-count + blank-field-rate sample from the RAW scraped records
      // (before consolidation/protection filtering, so a source that starts
      // returning mostly-blank rows is caught even when field protection
      // would otherwise mask it downstream) and compare against the 7-day
      // rolling baseline. Best-effort, non-fatal — never allowed to fail the
      // scrape itself (non-fatal-side-effects.md).
      try {
        const sample = computeBlankFieldStats(scrapedData.ipos as unknown as Array<Record<string, unknown>>);
        await evaluateAndRecordDegradation(this.redis, scraperName, sample);
      } catch (error) {
        logger.warn(
          { scraperName, error: error instanceof Error ? error.message : String(error) },
          'Selector-degradation check failed (non-fatal)'
        );
      }

      const duration = Date.now() - startTime;
      // Honest success semantics (T-228). The old rule was
      // `iposFailed < iposProcessed`, which reported a source that scraped a
      // legitimately EMPTY list (0 processed, 0 failed, no errors) as a
      // FAILURE - the whole cycle then exited 1 with errorCount=0 and an empty
      // errors[], i.e. a failure nobody could diagnose. A run is successful
      // when nothing actually failed: no per-IPO failures and no recorded
      // errors. A partial failure (some IPOs failed) is now honestly a
      // failure rather than being masked by the majority succeeding.
      result.success = result.iposFailed === 0 && result.errors.length === 0;

      // Record success
      await this.logSuccess(result, duration);

      // Log completion with Phase 1 + Phase 2 metrics
      const logData: any = {
        ...result,
        duration,
      };

      if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
        logData.phase1Metrics = {
          consolidationEnabled: result.consolidationEnabled,
          conflictsDetected: result.conflictsDetected,
          fieldsConsolidated: result.fieldsConsolidated,
          avgConsolidationTimeMs: result.avgConsolidationTimeMs?.toFixed(2),
        };
      }

      logger.info(logData, `${scraperName} scraper orchestrator completed (Phase 1 + Phase 2 integrated)`);

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
  /**
   * The single writer of the document-discovery source hints, called from EVERY
   * exit of `processIPO` that resolves an IPO id.
   *
   * Non-fatal by discipline (non-fatal-side-effects.md): bookkeeping must never
   * fail a scrape. Routed through data-persister, which validates the host —
   * nothing is written to `ipos` from here.
   */
  private async recordVerifierHint(
    ipoId: string | undefined | null,
    validatedIPO: unknown
  ): Promise<void> {
    const verifierUrl = (validatedIPO as { verifierUrl?: string } | null)?.verifierUrl;
    if (!ipoId || !verifierUrl) return;
    try {
      await recordDocumentSourceHints(this.ipoRepository, ipoId, { verifierUrl });
    } catch (error) {
      logger.warn(
        { ipoId, error: error instanceof Error ? error.message : String(error) },
        'Failed to record verifier URL (non-fatal)'
      );
    }
  }

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

    // Step 1: Validate IPO data (support both sync and async validators)
    const validationResult = this.validateIPO(scrapedIPO);
    const validation = validationResult instanceof Promise ? await validationResult : validationResult;

    if (!validation.success) {
      // P2-2 (T-287): an "expected" rejection (the Non-IPO Shape Guard doing
      // its job on a known InvIT/REIT/scrip-code row) is a skip, not a
      // failure — it must not flip `result.success` false or inflate
      // `result.errors`, which is what made every cycle's health signal
      // useless despite nothing actually being broken.
      const expected = (validation.error as any)?.expected === true;
      logger.warn(
        {
          scraperName,
          companyName: (scrapedIPO as any).companyName,
          errors: validation.error?.issues,
          expected,
        },
        expected ? 'IPO rejected by expected guard, skipping' : 'IPO validation failed, skipping'
      );
      if (expected) {
        processResult.skipped = true;
      } else {
        result.errors.push(`Validation failed for ${(scrapedIPO as any).companyName}`);
        processResult.failed = true;
      }
      return processResult;
    }

    const validatedIPO = validation.data!;
    const slug = generateSlug(validatedIPO.companyName);
    processResult.slug = slug;

    // Step 2: Resolve identity ONCE per request (T-307, write-path hardening
    // Phase 1). `resolveIpoRow` is the single source of truth for "which row
    // is this?" — key-first (isin -> symbol), then normalized-name -> slug ->
    // fuzzy (T-318, IDENT). The row resolved here is passed straight down to
    // the write (Step 5) so the guard and the write can no longer disagree
    // (docs/architecture/write-path-hardening.md §1.4, §2(a) step 1 — closes
    // the T-287F3 divergence that T-293 reopened by adding a fuzzy tier to
    // the write path only). T-318: this is the LIVE scraper write path (the
    // guard every real-time NSE/BSE/Chittorgarh scrape goes through) — it
    // MUST thread isin/symbol so the key-first tiers actually fire here, not
    // only in the secondary backfill scripts.
    const normalizedName = normalizeCompanyNameForMatching(validatedIPO.companyName);
    const existingIPO = await resolveIpoRow(this.ipoRepository, {
      companyName: validatedIPO.companyName,
      normalizedName,
      slug,
      isin: validatedIPO.isin,
      symbol: validatedIPO.symbol,
    }) as IPO | null;
    const ipoId = existingIPO?.id;

    // Step 3: PROTECTION CHECK - IPO-level lock
    if (ipoId && await this.fieldProtectionService.isIPOLocked(ipoId)) {
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

      // FIX: Access .filtered property from the result
      const filterResult = await this.fieldProtectionService.filterProtectedFields(
        ipoId,
        'ipos',
        validatedIPO,
        scraperName
      );
      filteredIPOData = filterResult.filtered as typeof validatedIPO;

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
        // T-403 r5: this exit returns BEFORE the upsert, and the hint is not
        // part of the protected payload — it records WHERE this IPO's documents
        // live. Protecting the IPO's fields must not also suppress the only
        // writer of `ipos.verifier_url`.
        await this.recordVerifierHint(ipoId, validatedIPO);
        processResult.skipped = true;
        return processResult;
      }
    }

    // Step 5: Upsert filtered IPO data with Phase 1 consolidation (if enabled)
    let upsertedIPOId: string;

    if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
      // Phase 1: Use consolidation orchestrator
      const confidenceScore = this.getConfidenceScore(scraperName);
      const consolidationResult = await this.consolidationOrchestrator.consolidatedUpsertIPO(
        filteredIPOData,
        scraperName,
        confidenceScore,
        // T-307: pass the row already resolved at Step 2 — guard and write
        // now share ONE resolution instead of resolving independently.
        existingIPO
      );

      if (consolidationResult.skipped) {
        logger.warn(
          { slug, reason: consolidationResult.skipReason },
          '[Phase 1] IPO consolidation skipped'
        );
        // Fallback to traditional upsert — pass the same pre-resolved row.
        upsertedIPOId = await upsertIPO(this.ipoRepository, filteredIPOData, scraperName, existingIPO);
        if (existingIPO) {
          processResult.updated = true;
        } else {
          processResult.inserted = true;
        }
      } else {
        upsertedIPOId = consolidationResult.ipoId;

        // Track consolidation metrics in parent result
        if (consolidationResult.consolidation) {
          result.conflictsDetected = (result.conflictsDetected || 0) +
            consolidationResult.consolidation.conflictsDetected;
          result.fieldsConsolidated = (result.fieldsConsolidated || 0) +
            consolidationResult.consolidation.fieldsUpdated;

          // Update average consolidation time
          const totalTime = (result.avgConsolidationTimeMs || 0) * result.iposProcessed;
          result.avgConsolidationTimeMs =
            (totalTime + consolidationResult.consolidation.performanceMs) / (result.iposProcessed + 1);
        }

        if (consolidationResult.isNew) {
          processResult.inserted = true;
        } else {
          processResult.updated = true;
        }

        if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
          logger.debug({
            slug,
            ipoId: upsertedIPOId,
            isNew: consolidationResult.isNew,
            conflictsDetected: consolidationResult.consolidation?.conflictsDetected,
            fieldsUpdated: consolidationResult.consolidation?.fieldsUpdated,
          }, '[Phase 1] IPO consolidated successfully');
        }
      }
    } else {
      // Traditional upsert (no consolidation) — pass the row already
      // resolved at Step 2 (T-307).
      upsertedIPOId = await upsertIPO(this.ipoRepository, filteredIPOData, scraperName, existingIPO);

      if (existingIPO) {
        processResult.updated = true;
      } else {
        processResult.inserted = true;
      }
    }

    // T-403 M-6, hoisted in r5: record the source's own IPO page as a link
    // VERIFIER for document discovery. This sat inside the `else` branch of the
    // consolidation flag above, under a comment claiming "one choke point" —
    // with the flag ON in production, `ipos.verifier_url` stayed NULL for every
    // IPO and the verifier rung logged `skipped:no_verifier_url` forever. A
    // choke point that lives in one branch of an if/else is not a choke point.
    await this.recordVerifierHint(upsertedIPOId, validatedIPO);

    processResult.processed = true;

    // Step 6: Process subscription data for OPEN (live) and CLOSED (final) IPOs.
    // NSE/BSE only supply subscriptions for OPEN IPOs, so they are unaffected;
    // this lets name-addressable sources (Moneycontrol) persist final subscription
    // multiples for CLOSED IPOs too (#8 — "subscribed X times" on closed IPOs).
    if (
      (validatedIPO.status === 'OPEN' || validatedIPO.status === 'CLOSED') &&
      this.validateSubscription
    ) {
      // Match by normalized company name (keystone) so source name-variants
      // (case/suffix/junk tokens) still resolve to the right IPO — not just exact equality.
      const targetName = normalizeCompanyNameForMatching(validatedIPO.companyName);
      const relatedSubscription = subscriptions.find(
        (sub: any) =>
          sub.ipoCompanyName === validatedIPO.companyName ||
          normalizeCompanyNameForMatching(sub.ipoCompanyName) === targetName
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
            const snapshotId = await createSubscriptionSnapshot(
              this.subscriptionRepository,
              upsertedIPOId,
              subscriptionValidation.data!,
              { source: scraperName, redis: this.redis }
            );
            // null = suppressed because a consolidated snapshot already landed
            // this run (T-266); that is a correct outcome, not a failure.
            processResult.subscriptionCreated = snapshotId !== null;
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
   * Get confidence score for a scraper source
   * Used by Phase 1 consolidation to weight data from different sources
   *
   * @param source - Scraper source name
   * @returns Confidence score (0-100)
   */
  private getConfidenceScore(source: ScraperSource): number {
    // Confidence scores based on source reliability
    const confidenceScores: Record<ScraperSource, number> = {
      'ADMIN': 100,           // Manual admin overrides are always trusted (highest)
      'DRHP': 100,            // Official regulatory document (when implemented)
      'NSE': 95,              // Official exchange, most reliable
      'BSE': 90,              // Official exchange, slightly less complete than NSE
      'CHITTORGARH': 80,      // Specialized for GMP data
      'MONEYCONTROL': 75,     // Reliable third-party aggregator
      'INVESTORGAIN_GMP': 75, // InvestorGain GMP data
      'API_FALLBACK': 70,     // Fallback API, less reliable
    };

    return confidenceScores[source] || 50; // Default to medium confidence
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
      const protected_ = await this.fieldProtectionService.isFieldProtected(ipoId, 'subscriptions', field);
      // FIX: Check isProtected property (not protected)
      if (protected_.isProtected) {
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
    this.redis = redis;

    // Phase 2: Manual protection services
    this.ipoRepository = new IPORepositoryClass(db, redis);
    this.subscriptionRepository = new SubscriptionRepositoryClass(db, redis);
    this.scraperLogRepository = new ScraperLogRepositoryClass(db, redis);
    this.cacheInvalidator = new CacheInvalidator(redis);
    this.metricsTracker = new ScraperMetricsTracker(redis);
    this.alertingService = new AlertingService();
    this.fieldProtectionService = createFieldProtectionService(db, redis);

    // Phase 1: Data consolidation services
    this.fieldSourcesRepository = new FieldSourcesRepositoryClass(db, redis);
    this.dataConflictsRepository = new DataConflictsRepositoryClass(db, redis);
    this.consolidationOrchestrator = new DataConsolidationOrchestrator(
      this.ipoRepository,
      this.fieldSourcesRepository,
      this.dataConflictsRepository,
      redis
    );
  }

  /**
   * Log successful scraper execution
   */
  private async logSuccess(result: ScraperResult, duration: number): Promise<void> {
    const scraperName = this.getScraperName();

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess(scraperName);

    // T-309 (T-305 round-6 P3): a run that throws nothing but yields 0 rows for
    // several consecutive cycles (e.g. API_FALLBACK) is logged 'SUCCESS' below
    // by default — invisible to the freshness/health monitors, which only look
    // for FAILURE. Track the zero-yield streak and downgrade the logged status
    // to 'DEGRADED' once it crosses the threshold, WITHOUT touching the actual
    // scrape outcome (result/errors are unchanged — this only affects observability).
    // Non-fatal per non-fatal-side-effects.md: this is pure observability: a
    // failure here (e.g. a Redis hiccup inside the metrics tracker) MUST NOT
    // crash an otherwise-successful scrape run or corrupt its recorded status.
    let isZeroYieldDegraded = false;
    try {
      const zeroYieldStreak = await this.metricsTracker.recordZeroYieldCycle(scraperName, result.iposProcessed);
      isZeroYieldDegraded = this.metricsTracker.isZeroYieldDegraded(zeroYieldStreak);
      if (isZeroYieldDegraded) {
        logger.warn(
          { scraperName, iposProcessed: result.iposProcessed, zeroYieldStreak },
          `Scraper ${scraperName} returned 0 IPOs for ${zeroYieldStreak} consecutive cycles — logging DEGRADED, not SUCCESS`
        );
      }
    } catch (error) {
      logger.warn(
        { scraperName, error: error instanceof Error ? error.message : String(error) },
        'Zero-yield streak tracking failed (non-fatal) - logging SUCCESS as usual'
      );
    }

    // Log to database
    await this.scraperLogRepository.create({
      source: scraperName,
      status: isZeroYieldDegraded ? 'DEGRADED' : 'SUCCESS',
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
