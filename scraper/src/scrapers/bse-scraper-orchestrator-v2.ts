/**
 * BSE Scraper Orchestrator V2 - With Manual Data Protection
 *
 * Refactored to extend BaseScraperOrchestrator for automatic protection checks.
 * Handles both MAINBOARD and SME IPOs from BSE.
 *
 * @module scraper/src/scrapers/bse-scraper-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeBSEIPOs } from './bse-scraper.js';
import {
  validateIPOData,
  validateSubscriptionData,
  type ScrapedIPO,
  type ScrapedSubscription
} from '../utils/validators.js';

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
   * Validate scraped IPO data
   */
  protected validateIPO(ipo: ScrapedIPO): { success: boolean; data?: any; error?: any } {
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
export async function runBSEScraper(): Promise<BSEScraperResult> {
  const orchestrator = new BSEScraperOrchestratorV2();
  return await orchestrator.run();
}
