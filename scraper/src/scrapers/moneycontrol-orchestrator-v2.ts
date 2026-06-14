/**
 * Moneycontrol Scraper Orchestrator V2 - With Manual Data Protection + Data Quality Pipeline
 *
 * Scrapes IPO ratings and enrichment data from Moneycontrol.
 * Extends BaseScraperOrchestrator for automatic protection checks.
 *
 * **Phase 3 Enhancement (Data Quality):**
 * - Integrated DataValidationPipeline for comprehensive validation
 * - Rejects lot_size < 10 (SEBI compliance)
 * - Auto-detects RIGHTS issues, InvITs, REITs
 * - Prevents duplicate IPO entries (NSE/BSE symbol checking)
 * - Auto-fixes known data quality issues
 *
 * @module scraper/src/scrapers/moneycontrol-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 * @see scraper/src/pipelines/data-validation-pipeline.ts - Phase 3 Data Quality
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeMoneycontrolIPOs } from './moneycontrol-scraper.js';
import { validateMoneycontrolIPOData, validateSubscriptionData, type ScrapedSubscription } from '../utils/validators.js';
import { DataValidationPipeline, PipelineFactory } from '../pipelines/data-validation-pipeline.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { db } from '@ipodhan/shared';
import logger from '../utils/logger.js';

/**
 * Moneycontrol Scraper Orchestrator V2
 *
 * **Data Source:** Moneycontrol.com
 * **Focus:** IPO ratings, enrichment data
 * **Subscriptions:** opt-in via ENABLE_MONEYCONTROL_SUBSCRIPTION — provides
 *   name-addressable subscription %s for symbol-less SME IPOs (persisted for
 *   OPEN IPOs by the base orchestrator)
 *
 * **Key Features:**
 * - IPO-level lock support (scraper_locked flag)
 * - Field-level protection (filters protected fields before update)
 * - **Phase 3:** Comprehensive data validation pipeline
 *
 * **Validation Flow:**
 * 1. Scrape Moneycontrol data
 * 2. **Phase 3:** Run through DataValidationPipeline
 *    - Validate lot_size, price band, dates
 *    - Detect offering type (RIGHTS, InvIT, REIT)
 *    - Check for duplicates (NSE/BSE symbols)
 *    - Apply auto-fixes
 * 3. Validate schema (existing validators)
 * 4. Check IPO-level lock → Skip if locked
 * 5. Filter protected fields → Remove from update data
 * 6. Upsert filtered data
 *
 * @extends BaseScraperOrchestrator<any, never>
 */
export class MoneycontrolScraperOrchestratorV2 extends BaseScraperOrchestrator<any, ScrapedSubscription> {

  private validationPipeline: DataValidationPipeline;

  constructor() {
    super();
    // Initialize production-grade validation pipeline
    this.validationPipeline = PipelineFactory.createProductionPipeline(db);
  }

  /**
   * Get scraper name
   */
  protected getScraperName(): 'MONEYCONTROL' {
    return 'MONEYCONTROL';
  }

  /**
   * Scrape IPO data from Moneycontrol
   */
  protected async scrapeData(): Promise<ScrapedData<any, ScrapedSubscription>> {
    const { ipos, errors } = await scrapeMoneycontrolIPOs();

    // Log scrape-level errors
    if (errors.length > 0) {
      for (const error of errors) {
        logger.warn({ error }, 'Moneycontrol scrape error');
      }
    }

    // Build subscription snapshots from the scraped %s (name-addressable; covers
    // symbol-less SME IPOs). The base orchestrator persists these for OPEN IPOs
    // via createSubscriptionSnapshot, matched by company name. Gated, default OFF.
    const subscriptions: ScrapedSubscription[] = FEATURE_FLAGS.ENABLE_MONEYCONTROL_SUBSCRIPTION
      ? ipos
          .filter((i: any) => (i.totalSubscription ?? 0) > 0)
          .map((i: any) => ({
            ipoCompanyName: i.companyName,
            qibSubscription: i.qibSubscription ?? 0,
            niiSubscription: i.niiSubscription ?? 0,
            retailSubscription: i.retailSubscription ?? 0,
            totalSubscription: i.totalSubscription ?? 0,
            timestamp: new Date().toISOString(),
          }))
      : [];

    if (subscriptions.length > 0) {
      logger.info({ count: subscriptions.length }, '[MONEYCONTROL] Built subscription snapshots for persistence');
    }

    return { ipos, subscriptions };
  }

  /**
   * Validate Moneycontrol IPO data with Phase 3 Data Quality Pipeline
   *
   * **Two-Stage Validation:**
   * 1. **Data Quality Pipeline:** Comprehensive business logic validation
   *    - Lot size compliance (reject < 10)
   *    - Offering type detection (RIGHTS, InvIT, REIT)
   *    - Duplicate detection (NSE/BSE symbols)
   *    - Auto-fixes for known issues
   * 2. **Schema Validation:** Ensure data structure matches DB schema
   *
   * @param ipo - Raw scraped IPO
   * @returns Validation result
   */
  protected async validateIPO(ipo: any): Promise<{ success: boolean; data?: any; error?: any }> {
    // Stage 1: Run through Data Quality Pipeline
    const pipelineResult = await this.validationPipeline.validateAndProcess(
      {
        companyName: ipo.companyName,
        lotSize: ipo.lotSize,
        segment: ipo.segment,
        offeringType: ipo.offeringType,
        priceRangeMin: ipo.priceRangeMin,
        priceRangeMax: ipo.priceRangeMax,
        issueSize: ipo.issueSize,
        symbol: ipo.symbol,
        isin: ipo.isin,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
      },
      'MONEYCONTROL'
    );

    // Reject if pipeline says not to create
    if (!pipelineResult.shouldCreate) {
      logger.warn(
        {
          companyName: ipo.companyName,
          reason: pipelineResult.reason,
          warnings: pipelineResult.warnings,
        },
        '[MONEYCONTROL] IPO rejected by validation pipeline'
      );

      return {
        success: false,
        error: {
          message: pipelineResult.reason,
          issues: pipelineResult.validationResult.errors,
        },
      };
    }

    // Apply auto-fixes if available
    if (Object.keys(pipelineResult.autoFixesApplied).length > 0) {
      logger.info(
        {
          companyName: ipo.companyName,
          autoFixes: pipelineResult.autoFixesApplied,
        },
        '[MONEYCONTROL] Auto-fixes applied to IPO data'
      );

      // Apply fixes to original IPO object
      Object.assign(ipo, pipelineResult.autoFixesApplied);
    }

    // Log warnings if any
    if (pipelineResult.warnings.length > 0) {
      logger.warn(
        {
          companyName: ipo.companyName,
          warnings: pipelineResult.warnings,
        },
        '[MONEYCONTROL] IPO validation passed with warnings'
      );
    }

    // Log duplicate check results
    if (pipelineResult.duplicateCheck?.isDuplicate) {
      logger.info(
        {
          companyName: ipo.companyName,
          duplicateCheck: pipelineResult.duplicateCheck,
        },
        '[MONEYCONTROL] Duplicate check results'
      );
    }

    // Stage 2: Schema validation (existing Zod validator)
    const schemaValidation = validateMoneycontrolIPOData(ipo);

    if (!schemaValidation.success) {
      logger.warn(
        {
          companyName: ipo.companyName,
          errors: schemaValidation.error?.issues,
        },
        '[MONEYCONTROL] Schema validation failed'
      );

      return schemaValidation;
    }

    // Return validated data
    return schemaValidation;
  }

  /**
   * Validate a Moneycontrol-derived subscription snapshot (reuses the shared
   * Zod validator). Presence of this method enables the base orchestrator's
   * subscription-persistence path for OPEN IPOs.
   */
  protected validateSubscription(
    subscription: ScrapedSubscription
  ): { success: boolean; data?: any; error?: any } {
    return validateSubscriptionData(subscription);
  }
}

/**
 * Run Moneycontrol scraper with protection checks
 */
export async function runMoneycontrolScraper(): Promise<ScraperResult> {
  const orchestrator = new MoneycontrolScraperOrchestratorV2();
  return await orchestrator.run();
}
