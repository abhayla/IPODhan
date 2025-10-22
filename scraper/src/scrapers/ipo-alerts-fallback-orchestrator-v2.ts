/**
 * IPO Alerts Fallback Orchestrator V2 - With Manual Data Protection
 *
 * API fallback scraper that activates when NSE/BSE scrapers fail.
 * Extends BaseScraperOrchestrator for automatic protection checks.
 *
 * **Special Behavior:**
 * - Does NOT overwrite existing NSE/BSE data (they are authoritative)
 * - Only creates new IPOs not found in database
 * - Rate limiting via IPO Alerts API client
 *
 * @module scraper/src/scrapers/ipo-alerts-fallback-orchestrator-v2
 */

import { BaseScraperOrchestrator, ScraperResult, ScrapedData } from '../base/BaseScraperOrchestrator.js';
import { scrapeIPOAlertsAPIWithRetry } from './ipo-alerts-fallback.js';
import { validateIPOData, type ScrapedIPO } from '../utils/validators.js';
import { ipoAlertsClient } from '../services/ipo-alerts-client.js';
import logger from '../utils/logger.js';

/**
 * Fallback trigger reasons
 */
export type FallbackTriggerReason = 'nse_failure' | 'bse_failure' | 'manual' | 'scheduled';

/**
 * Extended result with API-specific fields
 */
export interface FallbackScraperResult extends ScraperResult {
  source: 'IPO_ALERTS_API';
  rateLimitUsed: number;
  rateLimitRemaining: number;
  triggerReason: FallbackTriggerReason;
  duration: number;
}

/**
 * IPO Alerts Fallback Orchestrator V2
 *
 * **Key Differences from Other Scrapers:**
 * 1. **Non-Overwriting:** Skips IPOs that already exist (NSE/BSE is authoritative)
 * 2. **Rate Limiting:** Tracks API usage limits
 * 3. **Trigger Reason:** Logs why fallback was activated
 *
 * **Usage:**
 * ```typescript
 * const orchestrator = new IPOAlertsFallbackOrchestratorV2('nse_failure');
 * const result = await orchestrator.run();
 * ```
 *
 * @extends BaseScraperOrchestrator<ScrapedIPO, never>
 */
export class IPOAlertsFallbackOrchestratorV2 extends BaseScraperOrchestrator<ScrapedIPO, never> {

  private triggerReason: FallbackTriggerReason;
  private rateLimitBefore: { used: number; remaining: number } = { used: 0, remaining: 0 };

  constructor(reason: FallbackTriggerReason = 'manual') {
    super();
    this.triggerReason = reason;
  }

  /**
   * Get scraper name
   */
  protected getScraperName(): 'IPO_ALERTS_API' {
    return 'IPO_ALERTS_API';
  }

  /**
   * Scrape IPO data from IPO Alerts API
   */
  protected async scrapeData(): Promise<ScrapedData<ScrapedIPO, never>> {
    // Log rate limit status before starting
    this.rateLimitBefore = ipoAlertsClient.getRateLimitStatus();
    logger.info(
      {
        rateLimitUsed: this.rateLimitBefore.used,
        rateLimitRemaining: this.rateLimitBefore.remaining,
        triggerReason: this.triggerReason
      },
      'IPO Alerts API fallback - rate limit status at start'
    );

    // Scrape from API
    const scrapedIPOs = await scrapeIPOAlertsAPIWithRetry();

    logger.info(
      { iposFetched: scrapedIPOs.length, triggerReason: this.triggerReason },
      'IPOs fetched from IPO Alerts API'
    );

    return {
      ipos: scrapedIPOs,
      subscriptions: []  // API doesn't provide subscriptions
    };
  }

  /**
   * Validate IPO data
   */
  protected validateIPO(ipo: ScrapedIPO): { success: boolean; data?: any; error?: any } {
    return validateIPOData(ipo);
  }

  /**
   * No subscription validation (API doesn't provide subscriptions)
   */
  protected validateSubscription = undefined;

  /**
   * Override run() to add fallback-specific result fields
   *
   * @returns Promise<FallbackScraperResult> - Extended result with API fields
   */
  public async run(): Promise<FallbackScraperResult> {
    const startTime = Date.now();
    const baseResult = await super.run();

    // Get rate limit status after completion
    const rateLimitAfter = ipoAlertsClient.getRateLimitStatus();

    // Build fallback-specific result
    const fallbackResult: FallbackScraperResult = {
      ...baseResult,
      source: 'IPO_ALERTS_API',
      rateLimitUsed: rateLimitAfter.used - this.rateLimitBefore.used,
      rateLimitRemaining: rateLimitAfter.remaining,
      triggerReason: this.triggerReason,
      duration: Date.now() - startTime
    };

    logger.info(
      {
        rateLimitUsed: fallbackResult.rateLimitUsed,
        rateLimitRemaining: fallbackResult.rateLimitRemaining,
        triggerReason: this.triggerReason,
        iposInserted: fallbackResult.iposInserted,
        iposSkipped: fallbackResult.iposSkipped,
        duration: fallbackResult.duration
      },
      'IPO Alerts API fallback completed'
    );

    return fallbackResult;
  }

  /**
   * Special handling for existing IPOs
   *
   * **IMPORTANT:** IPO Alerts API is a FALLBACK source.
   * If an IPO already exists from NSE/BSE, we DO NOT overwrite it
   * because NSE/BSE data is more authoritative.
   *
   * This override prevents the base class from updating existing IPOs.
   */
  protected async processIPO(
    scrapedIPO: ScrapedIPO,
    subscriptions: never[],
    result: ScraperResult
  ): Promise<any> {
    // Check if IPO exists
    const slug = this.generateSlug(scrapedIPO.companyName);
    const existingIPO = await this.ipoRepository.findBySlug(slug);

    if (existingIPO) {
      // IPO exists from NSE/BSE - skip (don't overwrite authoritative data)
      logger.info(
        {
          slug,
          companyName: scrapedIPO.companyName,
          existingSource: 'NSE/BSE (authoritative)',
          fallbackSource: 'IPO_ALERTS_API (supplementary)'
        },
        'IPO exists with authoritative data - skipping fallback upsert'
      );

      // Return skipped status
      return {
        slug,
        processed: false,
        skipped: true,
        inserted: false,
        updated: false,
        failed: false,
        fieldsProtected: 0,
        subscriptionCreated: false,
        subscriptionSkipped: false
      };
    }

    // IPO doesn't exist - proceed with normal flow (will create new IPO)
    return super.processIPO(scrapedIPO, subscriptions, result);
  }

  /**
   * Generate slug helper
   */
  private generateSlug(companyName: string): string {
    return companyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 255);
  }
}

/**
 * Run IPO Alerts fallback scraper with protection checks
 *
 * @param reason - Why fallback was triggered
 * @returns Promise<FallbackScraperResult> - Extended result with API metrics
 */
export async function runIPOAlertsFallback(
  reason: FallbackTriggerReason = 'manual'
): Promise<FallbackScraperResult> {
  const orchestrator = new IPOAlertsFallbackOrchestratorV2(reason);
  return await orchestrator.run();
}
