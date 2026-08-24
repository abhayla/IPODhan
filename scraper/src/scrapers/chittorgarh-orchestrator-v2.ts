/**
 * Chittorgarh Scraper Orchestrator V2 - With Manual Data Protection + Data Quality Pipeline
 *
 * Scrapes GMP (Grey Market Premium) and historical IPO data from Chittorgarh.
 * Extends BaseScraperOrchestrator for automatic protection checks.
 *
 * **Phase 3 Enhancement (Data Quality):**
 * - Integrated DataValidationPipeline for comprehensive validation
 * - Rejects lot_size < 10 (SEBI compliance)
 * - Auto-detects RIGHTS issues, InvITs, REITs
 * - Prevents duplicate IPO entries (NSE/BSE symbol checking)
 * - Auto-fixes known data quality issues
 *
 * @module scraper/src/scrapers/chittorgarh-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 * @see scraper/src/pipelines/data-validation-pipeline.ts - Phase 3 Data Quality
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeChittorgarhIPOs } from './chittorgarh-scraper.js';
import { validateChittorgarhIPOData } from '../utils/validators.js';
import { DataValidationPipeline, PipelineFactory } from '../pipelines/data-validation-pipeline.js';
import { db } from '@ipodhan/shared';
import logger from '../utils/logger.js';

/**
 * Chittorgarh Scraper Orchestrator V2
 *
 * **Data Source:** Chittorgarh.com
 * **Focus:** GMP data, historical IPO performance
 * **No Subscriptions:** Chittorgarh doesn't provide subscription data
 *
 * **Key Features:**
 * - IPO-level lock support (scraper_locked flag)
 * - Field-level protection (filters protected fields before update)
 * - **Phase 3:** Comprehensive data validation pipeline
 *
 * **Validation Flow:**
 * 1. Scrape Chittorgarh data
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
export interface ChittorgarhScraperResult extends ScraperResult {
  smeCount: number;
  mainboardCount: number;
}

export class ChittorgarhScraperOrchestratorV2 extends BaseScraperOrchestrator<any, never> {

  // T-309: segment tallies so index.ts's run-summary log can aggregate across
  // ALL sources, not just BSE (the only orchestrator that carried these before).
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
  protected getScraperName(): 'CHITTORGARH' {
    return 'CHITTORGARH';
  }

  /**
   * Scrape IPO data from Chittorgarh
   */
  protected async scrapeData(): Promise<ScrapedData<any, never>> {
    const { ipos, errors } = await scrapeChittorgarhIPOs();

    // T-309: tally segment counts (each scraped IPO already carries `segment`).
    this.smeCount = ipos.filter((ipo: any) => ipo.segment === 'SME').length;
    this.mainboardCount = ipos.filter((ipo: any) => ipo.segment === 'MAINBOARD').length;

    // Log scrape-level errors
    if (errors.length > 0) {
      for (const error of errors) {
        logger.warn({ error }, 'Chittorgarh scrape error');
      }
    }

    return {
      ipos,
      subscriptions: []  // Chittorgarh doesn't provide subscriptions
    };
  }

  /**
   * Validate Chittorgarh IPO data with Phase 3 Data Quality Pipeline
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
      'CHITTORGARH'
    );

    // Reject if pipeline says not to create
    if (!pipelineResult.shouldCreate) {
      logger.warn(
        {
          companyName: ipo.companyName,
          reason: pipelineResult.reason,
          warnings: pipelineResult.warnings,
        },
        '[CHITTORGARH] IPO rejected by validation pipeline'
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
        '[CHITTORGARH] Auto-fixes applied to IPO data'
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
        '[CHITTORGARH] IPO validation passed with warnings'
      );
    }

    // Log duplicate check results
    if (pipelineResult.duplicateCheck?.isDuplicate) {
      logger.info(
        {
          companyName: ipo.companyName,
          duplicateCheck: pipelineResult.duplicateCheck,
        },
        '[CHITTORGARH] Duplicate check results'
      );
    }

    // Stage 2: Schema validation (existing Zod validator)
    const schemaValidation = validateChittorgarhIPOData(ipo);

    if (!schemaValidation.success) {
      logger.warn(
        {
          companyName: ipo.companyName,
          errors: schemaValidation.error?.issues,
        },
        '[CHITTORGARH] Schema validation failed'
      );

      return schemaValidation;
    }

    // Return validated data
    return schemaValidation;
  }

  /**
   * No subscription validation (Chittorgarh doesn't provide subscriptions)
   */
  protected validateSubscription = undefined;

  /** T-309: segment counts, read by runChittorgarhScraper() after run() completes. */
  public getSmeCount(): number {
    return this.smeCount;
  }

  public getMainboardCount(): number {
    return this.mainboardCount;
  }
}

/**
 * Run Chittorgarh scraper with protection checks
 */
export async function runChittorgarhScraper(): Promise<ChittorgarhScraperResult> {
  const orchestrator = new ChittorgarhScraperOrchestratorV2();
  const baseResult = await orchestrator.run();
  return {
    ...baseResult,
    smeCount: orchestrator.getSmeCount(),
    mainboardCount: orchestrator.getMainboardCount(),
  };
}
