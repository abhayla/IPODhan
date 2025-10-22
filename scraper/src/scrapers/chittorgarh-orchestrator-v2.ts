/**
 * Chittorgarh Scraper Orchestrator V2 - With Manual Data Protection
 *
 * Scrapes GMP (Grey Market Premium) and historical IPO data from Chittorgarh.
 * Extends BaseScraperOrchestrator for automatic protection checks.
 *
 * @module scraper/src/scrapers/chittorgarh-orchestrator-v2
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeChittorgarhIPOs } from './chittorgarh-scraper.js';
import { validateChittorgarhIPOData } from '../utils/validators.js';

/**
 * Chittorgarh Scraper Orchestrator V2
 *
 * **Data Source:** Chittorgarh.com
 * **Focus:** GMP data, historical IPO performance
 * **No Subscriptions:** Chittorgarh doesn't provide subscription data
 *
 * @extends BaseScraperOrchestrator
 */
export class ChittorgarhScraperOrchestratorV2 extends BaseScraperOrchestrator<any, never> {

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

    // Log scrape-level errors
    if (errors.length > 0) {
      for (const error of errors) {
        this.logger?.warn({ error }, 'Chittorgarh scrape error');
      }
    }

    return {
      ipos,
      subscriptions: []  // Chittorgarh doesn't provide subscriptions
    };
  }

  /**
   * Validate Chittorgarh IPO data
   */
  protected validateIPO(ipo: any): { success: boolean; data?: any; error?: any } {
    return validateChittorgarhIPOData(ipo);
  }

  /**
   * No subscription validation (Chittorgarh doesn't provide subscriptions)
   */
  protected validateSubscription = undefined;

  // Access to logger for scrape errors
  private logger = require('../utils/logger.js').default;
}

/**
 * Run Chittorgarh scraper with protection checks
 */
export async function runChittorgarhScraper(): Promise<ScraperResult> {
  const orchestrator = new ChittorgarhScraperOrchestratorV2();
  return await orchestrator.run();
}
