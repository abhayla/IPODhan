/**
 * BSE Scraper Orchestrator V2 - With Manual Data Protection + Data Quality Pipeline
 *
 * Refactored to extend BaseScraperOrchestrator for automatic protection checks.
 * Handles both MAINBOARD and SME IPOs from BSE.
 *
 * **Phase 3 Enhancement (Data Quality):**
 * - Integrated DataValidationPipeline for comprehensive validation
 * - Rejects lot_size < 10 (SEBI compliance)
 * - Auto-detects RIGHTS issues, InvITs, REITs
 * - Prevents duplicate IPO entries (NSE/BSE symbol checking)
 * - Auto-fixes known data quality issues
 *
 * @module scraper/src/scrapers/bse-scraper-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 * @see scraper/src/pipelines/data-validation-pipeline.ts - Phase 3 Data Quality
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeBSEIPOs } from './bse-scraper.js';
import { scrapeBSEViaAPI, summarizeBSEApiResult } from './bse-api-scraper.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
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
 * Extended result interface for BSE (includes SME tracking)
 */
export interface BSEScraperResult extends ScraperResult {
  smeCount: number;
  mainboardCount: number;
  iposMerged: number;  // Dual-listed IPOs merged with NSE data
}

/**
 * BSE Scraper Orchestrator V2
 *
 * Extends BaseScraperOrchestrator with BSE-specific logic:
 * - Handles both MAINBOARD and SME IPOs
 * - Tracks SME vs MAINBOARD counts
 * - Merges dual-listed IPOs (NSE + BSE)
 * - **Phase 3:** Comprehensive data validation pipeline
 *
 * **Usage:**
 * ```typescript
 * const orchestrator = new BSEScraperOrchestratorV2();
 * const result = await orchestrator.run();
 * console.log(`SME: ${result.smeCount}, MAINBOARD: ${result.mainboardCount}`);
 * ```
 *
 * @extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription>
 */
export class BSEScraperOrchestratorV2 extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription> {

  // Additional tracking for BSE
  private smeCount: number = 0;
  private mainboardCount: number = 0;
  private validationPipeline: DataValidationPipeline;

  constructor() {
    super();
    // Initialize production-grade validation pipeline
    this.validationPipeline = PipelineFactory.createProductionPipeline(db);
  }

  /**
   * Get scraper name
   */
  protected getScraperName(): 'BSE' {
    return 'BSE';
  }

  /**
   * Scrape IPO data from BSE
   *
   * @returns Promise<ScrapedData> - IPOs, subscriptions, and segment counts
   */
  protected async scrapeData(): Promise<ScrapedData<ScrapedIPO, ScrapedSubscription>> {
    // BSE migrated to a SPA; the Puppeteer/HTML scraper is dead. When the flag is
    // on, source the list+detail from BSE's JSON API instead (the SPA's backend).
    if (FEATURE_FLAGS.ENABLE_BSE_API) {
      const apiResult = await scrapeBSEViaAPI();
      if (apiResult.errors.length > 0) {
        logger.warn(
          { errorCount: apiResult.errors.length, sample: apiResult.errors.slice(0, 3) },
          '[BSE] JSON API scrape returned per-IPO errors'
        );
      }
      const summary = summarizeBSEApiResult(apiResult);
      this.smeCount = summary.smeCount;
      this.mainboardCount = summary.mainboardCount;
      logger.info(
        { source: 'BSE_API', ipos: summary.ipos.length, mainboard: summary.mainboardCount, sme: summary.smeCount },
        '[BSE] sourced IPOs from JSON API'
      );
      return { ipos: summary.ipos, subscriptions: summary.subscriptions };
    }

    const { ipos, subscriptions, smeCount, mainboardCount } = await scrapeBSEIPOs();

    // Store counts for result
    this.smeCount = smeCount;
    this.mainboardCount = mainboardCount;

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
      'BSE'
    );

    // Reject if pipeline says not to create
    if (!pipelineResult.shouldCreate) {
      logger.warn(
        {
          companyName: ipo.companyName,
          reason: pipelineResult.reason,
          warnings: pipelineResult.warnings,
        },
        '[BSE] IPO rejected by validation pipeline'
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
        '[BSE] Auto-fixes applied to IPO data'
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
        '[BSE] IPO validation passed with warnings'
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
        '[BSE] Possible duplicate detected but allowed by confidence threshold'
      );
    }

    // Stage 2: Schema validation (existing validator)
    return validateIPOData(ipo);
  }

  /**
   * Validate subscription data
   */
  protected validateSubscription(subscription: ScrapedSubscription): { success: boolean; data?: any; error?: any } {
    return validateSubscriptionData(subscription);
  }

  /**
   * Override run() to add BSE-specific result fields
   *
   * @returns Promise<BSEScraperResult> - Extended result with SME tracking
   */
  public async run(): Promise<BSEScraperResult> {
    const baseResult = await super.run();

    // Add BSE-specific fields to result
    const bseResult: BSEScraperResult = {
      ...baseResult,
      smeCount: this.smeCount,
      mainboardCount: this.mainboardCount,
      iposMerged: 0  // TODO: Track merges in base class (dual-listed IPOs)
    };

    return bseResult;
  }
}

/**
 * Run BSE scraper with protection checks
 *
 * @returns Promise<BSEScraperResult> - Scraper execution summary with SME counts
 */
export async function runBSEScraper(
  opts: { allowedStatuses?: readonly string[] } = {}
): Promise<BSEScraperResult> {
  const orchestrator = new BSEScraperOrchestratorV2();
  if (opts.allowedStatuses) orchestrator.restrictToStatuses(opts.allowedStatuses);
  return await orchestrator.run();
}
