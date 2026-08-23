/**
 * NSE Scraper Orchestrator V2 - With Manual Data Protection + Data Quality Pipeline
 *
 * Refactored to extend BaseScraperOrchestrator for automatic protection checks.
 * This version enforces field-level and IPO-level protection flags.
 *
 * **Phase 3 Enhancement (Data Quality):**
 * - Integrated DataValidationPipeline for comprehensive validation
 * - Rejects lot_size < 10 (SEBI compliance)
 * - Auto-detects RIGHTS issues, InvITs, REITs
 * - Prevents duplicate IPO entries (NSE/BSE symbol checking)
 * - Auto-fixes known data quality issues
 *
 * @module scraper/src/scrapers/nse-scraper-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 * @see docs/00-admin/MANUAL_DATA_MANAGEMENT_PLAN.md - Phase 2
 * @see scraper/src/pipelines/data-validation-pipeline.ts - Phase 3 Data Quality
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeNSEIPOs } from './nse-scraper.js';
import {
  validateIPOData,
  validateSubscriptionData,
  type ScrapedIPO,
  type ScrapedSubscription
} from '../utils/validators.js';
import { DataValidationPipeline, PipelineFactory } from '../pipelines/data-validation-pipeline.js';
import { db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';

/**
 * NSE Scraper Orchestrator V2
 *
 * Extends BaseScraperOrchestrator to automatically apply manual data protection.
 *
 * **Key Features:**
 * - IPO-level lock support (scraper_locked flag)
 * - Field-level protection (filters protected fields before update)
 * - Blocked update notifications (logs to Redis)
 * - Automatic fallback on consecutive failures
 * - **Phase 3:** Comprehensive data validation pipeline
 *
 * **Usage:**
 * ```typescript
 * const orchestrator = new NSEScraperOrchestratorV2();
 * const result = await orchestrator.run();
 * ```
 *
 * **Protection Flow:**
 * 1. Scrape NSE data
 * 2. **Phase 3:** Run through DataValidationPipeline
 *    - Validate lot_size, price band, dates
 *    - Detect offering type (RIGHTS, InvIT, REIT)
 *    - Check for duplicates (NSE/BSE symbols)
 *    - Apply auto-fixes
 * 3. Validate schema (existing validators)
 * 4. Check IPO-level lock → Skip if locked
 * 5. Filter protected fields → Remove from update data
 * 6. Upsert filtered data
 * 7. Process subscriptions (if not protected)
 * 8. Invalidate caches
 *
 * @extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription>
 */
export class NSEScraperOrchestratorV2 extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription> {

  private validationPipeline: DataValidationPipeline;

  constructor() {
    super();
    // Initialize production-grade validation pipeline
    this.validationPipeline = PipelineFactory.createProductionPipeline(db);
  }

  /**
   * Get scraper name (used for logging and metrics)
   */
  protected getScraperName(): 'NSE' {
    return 'NSE';
  }

  /**
   * Scrape IPO data from NSE
   *
   * @returns Promise<ScrapedData> - IPOs and subscriptions
   */
  protected async scrapeData(): Promise<ScrapedData<ScrapedIPO, ScrapedSubscription>> {
    const { ipos, subscriptions } = await scrapeNSEIPOs();

    return {
      ipos,
      subscriptions
    };
  }

  /**
   * Validate scraped IPO data with Phase 3 Data Quality Pipeline
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
  protected async validateIPO(ipo: ScrapedIPO): Promise<{ success: boolean; data?: any; error?: any }> {
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
        symbol: ipo.symbol,  // Stock symbol
        isin: ipo.isin,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
      },
      'NSE'
    );

    // Reject if pipeline says not to create
    if (!pipelineResult.shouldCreate) {
      logger.warn(
        {
          companyName: ipo.companyName,
          reason: pipelineResult.reason,
          warnings: pipelineResult.warnings,
        },
        '[NSE] IPO rejected by validation pipeline'
      );

      return {
        success: false,
        error: {
          message: pipelineResult.reason,
          issues: pipelineResult.validationResult.errors,
          expected: pipelineResult.expectedRejection,
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
        '[NSE] Auto-fixes applied to IPO data'
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
        '[NSE] IPO validation passed with warnings'
      );
    }

    // Log duplicate check results
    if (pipelineResult.duplicateCheck?.isDuplicate) {
      logger.info(
        {
          companyName: ipo.companyName,
          duplicateInfo: {
            confidence: pipelineResult.duplicateCheck.confidence,
            matchReason: pipelineResult.duplicateCheck.matchReason,
            existingIPO: pipelineResult.duplicateCheck.existingIPO?.companyName,
          },
        },
        '[NSE] Possible duplicate detected but allowed by confidence threshold'
      );
    }

    // Stage 2: Schema validation (existing validator)
    return validateIPOData(ipo);
  }

  /**
   * Validate subscription data
   *
   * @param subscription - Raw scraped subscription
   * @returns Validation result
   */
  protected validateSubscription(subscription: ScrapedSubscription): { success: boolean; data?: any; error?: any } {
    return validateSubscriptionData(subscription);
  }
}

/**
 * Run NSE scraper with protection checks
 *
 * @returns Promise<ScraperResult> - Scraper execution summary
 */
export async function runNSEScraper(): Promise<ScraperResult> {
  const orchestrator = new NSEScraperOrchestratorV2();
  return await orchestrator.run();
}
