/**
 * Moneycontrol Scraper Orchestrator V2 - With Manual Data Protection
 *
 * Scrapes IPO ratings and enrichment data from Moneycontrol.
 * Extends BaseScraperOrchestrator for automatic protection checks.
 *
 * @module scraper/src/scrapers/moneycontrol-orchestrator-v2
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeMoneycontrolIPOs } from './moneycontrol-scraper.js';
import { validateMoneycontrolIPOData } from '../utils/validators.js';

/**
 * Moneycontrol Scraper Orchestrator V2
 *
 * **Data Source:** Moneycontrol.com
 * **Focus:** IPO ratings, enrichment data
 * **No Subscriptions:** Moneycontrol doesn't provide subscription data
 *
 * @extends BaseScraperOrchestrator
 */
export class MoneycontrolScraperOrchestratorV2 extends BaseScraperOrchestrator<any, never> {

  /**
   * Get scraper name
   */
  protected getScraperName(): 'MONEYCONTROL' {
    return 'MONEYCONTROL';
  }

  /**
   * Scrape IPO data from Moneycontrol
   */
  protected async scrapeData(): Promise<ScrapedData<any, never>> {
    const { ipos, errors } = await scrapeMoneycontrolIPOs();

    // Log scrape-level errors
    if (errors.length > 0) {
      for (const error of errors) {
        this.logger?.warn({ error }, 'Moneycontrol scrape error');
      }
    }

    return {
      ipos,
      subscriptions: []  // Moneycontrol doesn't provide subscriptions
    };
  }

  /**
   * Validate Moneycontrol IPO data
   */
  protected validateIPO(ipo: any): { success: boolean; data?: any; error?: any } {
    return validateMoneycontrolIPOData(ipo);
  }

  /**
   * No subscription validation (Moneycontrol doesn't provide subscriptions)
   */
  protected validateSubscription = undefined;

  // Access to logger for scrape errors
  private logger = require('../utils/logger.js').default;
}

/**
 * Run Moneycontrol scraper with protection checks
 */
export async function runMoneycontrolScraper(): Promise<ScraperResult> {
  const orchestrator = new MoneycontrolScraperOrchestratorV2();
  return await orchestrator.run();
}
