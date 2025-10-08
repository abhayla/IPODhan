import logger from '../utils/logger.js';
import { scrapeIPOAlertsAPIWithRetry } from './ipo-alerts-fallback.js';
import { upsertIPO } from '../services/data-persister.js';
import { invalidateIPOCaches } from '../services/cache-invalidator.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { ipoAlertsClient } from '../services/ipo-alerts-client.js';
import { getRedisClient } from '@web/lib/cache/redis-client';
import type { IPORepository } from '@web/lib/repositories/ipo-repository';
import type { ScrapedIPO } from '../utils/validators.js';

// ==================== TYPES ====================

export type FallbackTriggerReason = 'nse_failure' | 'bse_failure' | 'manual' | 'scheduled';

export interface FallbackScraperResult {
  success: boolean;
  iposProcessed: number;
  iposFetched: number;
  iposInserted: number;
  iposUpdated: number;
  iposSkipped: number;
  iposFailed: number;
  source: 'IPO_ALERTS_API';
  rateLimitUsed: number;
  rateLimitRemaining: number;
  errors: string[];
  duration: number;
  triggerReason: FallbackTriggerReason;
}

// ==================== ORCHESTRATOR ====================

/**
 * Run IPO Alerts API fallback scraper
 * @param ipoRepository - IPO repository instance
 * @param reason - Reason for triggering fallback
 * @returns Scraper result with statistics
 */
export async function runIPOAlertsFallback(
  ipoRepository: IPORepository,
  reason: FallbackTriggerReason = 'manual'
): Promise<FallbackScraperResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let iposFetched = 0;
  let iposInserted = 0;
  let iposUpdated = 0;
  let iposSkipped = 0;
  let iposFailed = 0;

  // Initialize Redis client and cache invalidator
  const redis = getRedisClient();
  const cacheInvalidator = new CacheInvalidator(redis);

  // Track all updated IPO slugs for comprehensive cache invalidation
  const updatedIPOSlugs: string[] = [];

  try {
    logger.info(
      { triggerReason: reason, timestamp: new Date().toISOString() },
      'Starting IPO Alerts API fallback scraper'
    );

    // Get rate limit status before starting
    const rateLimitBefore = ipoAlertsClient.getRateLimitStatus();
    logger.info(
      {
        rateLimitUsed: rateLimitBefore.used,
        rateLimitRemaining: rateLimitBefore.remaining
      },
      'Rate limit status at start'
    );

    // Scrape IPO data from API
    logger.debug('Fetching IPOs from IPO Alerts API');
    const scrapedIPOs: ScrapedIPO[] = await scrapeIPOAlertsAPIWithRetry();
    iposFetched = scrapedIPOs.length;

    logger.info(
      { iposFetched: scrapedIPOs.length },
      'IPOs fetched from API, starting database upserts'
    );

    // Process each scraped IPO
    for (const scrapedIPO of scrapedIPOs) {
      try {
        // Check if IPO already exists
        const slug = scrapedIPO.companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 255);

        const existingIPO = await ipoRepository.findBySlug(slug);

        if (existingIPO) {
          // IPO exists (likely from NSE/BSE) - do NOT overwrite with API data
          // NSE/BSE data is authoritative, API fallback is supplementary
          logger.info(
            {
              slug,
              companyName: scrapedIPO.companyName,
              existingSource: 'NSE/BSE (authoritative)',
              apiSource: 'IPO_ALERTS_API (fallback)'
            },
            'IPO already exists with NSE/BSE data, skipping API fallback upsert (NSE/BSE data is authoritative)'
          );
          iposSkipped++;

          // Log data discrepancies for monitoring
          if (existingIPO.issueSize !== scrapedIPO.issueSize.toString()) {
            logger.warn(
              {
                slug,
                companyName: scrapedIPO.companyName,
                apiIssueSize: scrapedIPO.issueSize,
                existingIssueSize: existingIPO.issueSize
              },
              'Data discrepancy: API issue size differs from existing NSE/BSE data (NSE/BSE data retained)'
            );
          }

        } else {
          // IPO does not exist - create new from API fallback data
          logger.debug(
            { slug, companyName: scrapedIPO.companyName },
            'Creating new IPO from API fallback'
          );

          const ipoId = await upsertIPO(ipoRepository, scrapedIPO, 'NSE'); // Use NSE as default source
          iposInserted++;

          // Track updated IPO slug for comprehensive cache invalidation
          updatedIPOSlugs.push(slug);

          logger.info(
            {
              slug,
              companyName: scrapedIPO.companyName,
              ipoId,
              source: 'IPO_ALERTS_API'
            },
            'New IPO created from API fallback'
          );

          // Note: Individual cache invalidation removed - will use comprehensive invalidation
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to process ${scrapedIPO.companyName}: ${errorMessage}`);
        iposFailed++;

        logger.error(
          {
            companyName: scrapedIPO.companyName,
            error: errorMessage
          },
          'Failed to upsert IPO from API fallback'
        );
      }
    }

    // Comprehensive cache invalidation after successful scraper run
    if (updatedIPOSlugs.length > 0) {
      await cacheInvalidator.invalidateAfterScrape('API_FALLBACK', updatedIPOSlugs);
    }

    // Get rate limit status after completion
    const rateLimitAfter = ipoAlertsClient.getRateLimitStatus();

    const duration = Date.now() - startTime;
    logger.info(
      {
        triggerReason: reason,
        iposFetched,
        iposInserted,
        iposUpdated,
        iposSkipped,
        iposFailed,
        errors: errors.length,
        rateLimitUsed: rateLimitAfter.used,
        rateLimitRemaining: rateLimitAfter.remaining,
        duration
      },
      'IPO Alerts API fallback scrape completed successfully'
    );

    return {
      success: true,
      iposProcessed: iposFetched,
      iposFetched,
      iposInserted,
      iposUpdated,
      iposSkipped,
      iposFailed,
      source: 'IPO_ALERTS_API',
      rateLimitUsed: rateLimitAfter.used,
      rateLimitRemaining: rateLimitAfter.remaining,
      errors,
      duration,
      triggerReason: reason
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;

    logger.error(
      {
        triggerReason: reason,
        error: errorMessage,
        duration,
        iposFetched,
        iposInserted,
        iposSkipped,
        iposFailed
      },
      'IPO Alerts API fallback scrape failed'
    );

    const rateLimitAfter = ipoAlertsClient.getRateLimitStatus();

    return {
      success: false,
      iposProcessed: 0,
      iposFetched,
      iposInserted,
      iposUpdated,
      iposSkipped,
      iposFailed,
      source: 'IPO_ALERTS_API',
      rateLimitUsed: rateLimitAfter.used,
      rateLimitRemaining: rateLimitAfter.remaining,
      errors: [errorMessage, ...errors],
      duration,
      triggerReason: reason
    };
  }
}
