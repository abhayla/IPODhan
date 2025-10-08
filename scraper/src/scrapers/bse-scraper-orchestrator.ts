import { IPORepository } from '@web/lib/repositories/ipo-repository';
import { SubscriptionRepository } from '@web/lib/repositories/subscription-repository';
import { db } from '@web/lib/db/index';
import { getRedisClient } from '@web/lib/cache/redis-client';
import logger from '../utils/logger.js';
import { scrapeBSEIPOs } from './bse-scraper.js';
import { validateIPOData, validateSubscriptionData, generateSlug } from '../utils/validators.js';
import { upsertIPO, createSubscriptionSnapshot } from '../services/data-persister.js';
import { invalidateIPOCaches, invalidateSubscriptionCache } from '../services/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { runIPOAlertsFallback } from './ipo-alerts-fallback-orchestrator.js';

export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposMerged: number;
  iposFailed: number;
  smeCount: number;
  mainboardCount: number;
  subscriptionsCreated: number;
  errors: string[];
}

/**
 * Run BSE scraper workflow
 * Orchestrates the full scraping, validation, persistence, and cache invalidation process
 * Handles dual-listed IPO merge logic
 * @returns Promise<ScraperResult> - Summary of scraper execution
 */
export async function runBSEScraper(): Promise<ScraperResult> {
  const startTime = Date.now();

  const result: ScraperResult = {
    success: false,
    iposProcessed: 0,
    iposInserted: 0,
    iposUpdated: 0,
    iposMerged: 0,
    iposFailed: 0,
    smeCount: 0,
    mainboardCount: 0,
    subscriptionsCreated: 0,
    errors: []
  };

  try {
    logger.info('BSE scraper orchestrator started');

    // Initialize repositories
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const subscriptionRepository = new SubscriptionRepository(db, redis);

    // Step 1: Scrape BSE data
    const { ipos: scrapedIPOs, subscriptions: scrapedSubscriptions, smeCount, mainboardCount } = await scrapeBSEIPOs();

    logger.info(
      { totalIPOs: scrapedIPOs.length, smeCount, mainboardCount },
      'Scraped data received from BSE'
    );

    result.smeCount = smeCount;
    result.mainboardCount = mainboardCount;

    // Step 2: Validate and process IPOs
    for (const scrapedIPO of scrapedIPOs) {
      try {
        // Validate IPO data
        const validation = validateIPOData(scrapedIPO);

        if (!validation.success) {
          logger.warn(
            {
              companyName: scrapedIPO.companyName,
              errors: validation.error?.errors
            },
            'IPO validation failed, skipping'
          );
          result.iposFailed++;
          result.errors.push(`Validation failed for ${scrapedIPO.companyName}`);
          continue;
        }

        const validatedIPO = validation.data!;

        // Check if IPO already exists (to track insert vs update vs merge)
        const slug = generateSlug(validatedIPO.companyName);
        const existingIPO = await ipoRepository.findBySlug(slug);

        // Track if this is a merge operation (dual-listed IPO)
        const isMerge = existingIPO && !(existingIPO.listingExchanges as string[]).includes('BSE');

        // Upsert IPO to database with BSE source (handles merge logic)
        const ipoId = await upsertIPO(ipoRepository, validatedIPO, 'BSE');

        if (isMerge) {
          result.iposMerged++;
          result.iposUpdated++;
        } else if (existingIPO) {
          result.iposUpdated++;
        } else {
          result.iposInserted++;
        }

        result.iposProcessed++;

        // Step 3: Process subscription data for OPEN IPOs
        if (validatedIPO.status === 'OPEN') {
          const relatedSubscription = scrapedSubscriptions.find(
            sub => sub.ipoCompanyName === validatedIPO.companyName
          );

          if (relatedSubscription) {
            const subscriptionValidation = validateSubscriptionData(relatedSubscription);

            if (subscriptionValidation.success) {
              await createSubscriptionSnapshot(
                subscriptionRepository,
                ipoId,
                subscriptionValidation.data!
              );
              result.subscriptionsCreated++;

              // Invalidate subscription cache
              await invalidateSubscriptionCache(redis, ipoId);
            } else {
              logger.warn(
                {
                  companyName: validatedIPO.companyName,
                  errors: subscriptionValidation.error?.errors
                },
                'Subscription validation failed, skipping'
              );
            }
          }
        }

        // Step 4: Invalidate IPO caches
        await invalidateIPOCaches(redis, slug);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { companyName: scrapedIPO.companyName, error: errorMsg },
          'Failed to process IPO'
        );
        result.iposFailed++;
        result.errors.push(`Failed to process ${scrapedIPO.companyName}: ${errorMsg}`);
      }
    }

    const duration = Date.now() - startTime;
    result.success = result.iposFailed < result.iposProcessed; // Success if majority processed

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('BSE');

    logger.info(
      {
        ...result,
        duration
      },
      'BSE scraper orchestrator completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const duration = Date.now() - startTime;

    logger.error(
      { error: errorMsg, duration },
      'BSE scraper orchestrator failed'
    );

    result.success = false;
    result.errors.push(`Orchestrator error: ${errorMsg}`);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure('BSE', error instanceof Error ? error : new Error(errorMsg));

    // Check if fallback should be triggered
    if (scraperFailureTracker.shouldTriggerFallback('BSE')) {
      logger.warn('BSE scraper failed 3 consecutive times, triggering API fallback');

      try {
        // Initialize repositories for fallback
        const redis = getRedisClient();
        const ipoRepository = new IPORepository(db, redis);

        // Trigger API fallback
        const fallbackResult = await runIPOAlertsFallback(ipoRepository, 'bse_failure');

        if (fallbackResult.success) {
          logger.info(
            {
              iposInserted: fallbackResult.iposInserted,
              iposSkipped: fallbackResult.iposSkipped,
              rateLimitRemaining: fallbackResult.rateLimitRemaining
            },
            'API fallback completed successfully after BSE failure'
          );
        } else {
          logger.error(
            { errors: fallbackResult.errors },
            'API fallback also failed after BSE failure'
          );
        }
      } catch (fallbackError) {
        const fallbackErrorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.error(
          { error: fallbackErrorMsg },
          'Failed to trigger API fallback after BSE failure'
        );
      }
    }

    return result;
  }
}
