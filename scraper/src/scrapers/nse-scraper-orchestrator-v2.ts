/**
 * NSE Scraper Orchestrator V2 - With Manual Data Protection
 *
 * Refactored to extend BaseScraperOrchestrator for automatic protection checks.
 * This version enforces field-level and IPO-level protection flags.
 *
 * @module scraper/src/scrapers/nse-scraper-orchestrator-v2
 * @see scraper/src/base/BaseScraperOrchestrator.ts
 * @see docs/00-admin/MANUAL_DATA_MANAGEMENT_PLAN.md - Phase 2
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeNSEIPOs } from './nse-scraper.js';
import {
  validateIPOData,
  validateSubscriptionData,
  type ScrapedIPO,
  type ScrapedSubscription
} from '../utils/validators.js';

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
 *
 * **Usage:**
 * ```typescript
 * const orchestrator = new NSEScraperOrchestratorV2();
 * const result = await orchestrator.run();
 * ```
 *
 * **Protection Flow:**
 * 1. Scrape NSE data
 * 2. Validate each IPO
 * 3. Check IPO-level lock → Skip if locked
 * 4. Filter protected fields → Remove from update data
 * 5. Upsert filtered data
 * 6. Process subscriptions (if not protected)
 * 7. Invalidate caches
 *
 * @extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription>
 */
export class NSEScraperOrchestratorV2 extends BaseScraperOrchestrator<ScrapedIPO, ScrapedSubscription> {

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
   * Validate scraped IPO data
   *
   * @param ipo - Raw scraped IPO
   * @returns Validation result
   */
  protected validateIPO(ipo: ScrapedIPO): { success: boolean; data?: any; error?: any } {
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
