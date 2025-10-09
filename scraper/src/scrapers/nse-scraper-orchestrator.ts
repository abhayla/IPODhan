import { IPORepository, SubscriptionRepository, ScraperLogRepository, db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { scrapeNSEIPOs } from './nse-scraper.js';
import { validateIPOData, validateSubscriptionData, generateSlug } from '../utils/validators.js';
import { upsertIPO, createSubscriptionSnapshot } from '../services/data-persister.js';
import { invalidateIPOCaches, invalidateSubscriptionCache } from '../services/cache-invalidator.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { runIPOAlertsFallback } from './ipo-alerts-fallback-orchestrator.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';

export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  subscriptionsCreated: number;
  errors: string[];
}

/**
 * Run NSE scraper workflow
 * Orchestrates the full scraping, validation, persistence, and cache invalidation process
 * @returns Promise<ScraperResult> - Summary of scraper execution
 */
export async function runNSEScraper(): Promise<ScraperResult> {
  const startTime = Date.now();

  const result: ScraperResult = {
    success: false,
    iposProcessed: 0,
    iposInserted: 0,
    iposUpdated: 0,
    iposFailed: 0,
    subscriptionsCreated: 0,
    errors: []
  };

  try {
    logger.info('NSE scraper orchestrator started');

    // Initialize repositories and services
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const subscriptionRepository = new SubscriptionRepository(db, redis);
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    const cacheInvalidator = new CacheInvalidator(redis);
    const metricsTracker = new ScraperMetricsTracker(redis);
    const alertingService = new AlertingService();

    // Track all updated IPO slugs for comprehensive cache invalidation
    const updatedIPOSlugs: string[] = [];

    // Step 1: Scrape NSE data
    const { ipos: scrapedIPOs, subscriptions: scrapedSubscriptions } = await scrapeNSEIPOs();

    logger.info({ totalIPOs: scrapedIPOs.length }, 'Scraped data received from NSE');

    // Step 2: Validate and process IPOs
    for (const scrapedIPO of scrapedIPOs) {
      try {
        // Validate IPO data
        const validation = validateIPOData(scrapedIPO);

        if (!validation.success) {
          logger.warn(
            {
              companyName: scrapedIPO.companyName,
              errors: validation.error?.issues
            },
            'IPO validation failed, skipping'
          );
          result.iposFailed++;
          result.errors.push(`Validation failed for ${scrapedIPO.companyName}`);
          continue;
        }

        const validatedIPO = validation.data!;

        // Check if IPO already exists (to track insert vs update)
        const slug = generateSlug(validatedIPO.companyName);
        const existingIPO = await ipoRepository.findBySlug(slug);

        // Upsert IPO to database
        const ipoId = await upsertIPO(ipoRepository, validatedIPO, 'NSE');

        if (existingIPO) {
          result.iposUpdated++;
        } else {
          result.iposInserted++;
        }

        result.iposProcessed++;

        // Track updated IPO slug for comprehensive cache invalidation
        updatedIPOSlugs.push(slug);

        // Step 3: Process subscription data for LIVE (active/open) IPOs
        if (validatedIPO.status === 'LIVE') {
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

              // Note: Subscription cache invalidation will be handled by comprehensive invalidation
            } else {
              logger.warn(
                {
                  companyName: validatedIPO.companyName,
                  errors: subscriptionValidation.error?.issues
                },
                'Subscription validation failed, skipping'
              );
            }
          }
        }

        // Note: Individual cache invalidation removed - will use comprehensive invalidation

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

    // Step 4: Comprehensive cache invalidation after successful scraper run
    if (updatedIPOSlugs.length > 0) {
      await cacheInvalidator.invalidateAfterScrape('NSE', updatedIPOSlugs);
    }

    const duration = Date.now() - startTime;
    result.success = result.iposFailed < result.iposProcessed; // Success if majority processed

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('NSE');

    // Log execution to database (Story 7.5)
    await scraperLogRepository.create({
      source: 'NSE',
      status: 'SUCCESS',
      recordsProcessed: result.iposProcessed,
      recordsFailed: result.iposFailed,
      durationMs: duration,
      errorMessage: null,
      errorStack: null,
    });

    // Record success metrics in Redis (Story 7.5)
    await metricsTracker.recordSuccess('NSE');

    logger.info(
      {
        ...result,
        duration
      },
      'NSE scraper orchestrator completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const duration = Date.now() - startTime;

    logger.error(
      { error: errorMsg, duration },
      'NSE scraper orchestrator failed'
    );

    result.success = false;
    result.errors.push(`Orchestrator error: ${errorMsg}`);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure('NSE', error instanceof Error ? error : new Error(errorMsg));

    // Log failure to database (Story 7.5)
    try {
      const redis = getRedisClient();
      const scraperLogRepository = new ScraperLogRepository(db, redis);
      const metricsTracker = new ScraperMetricsTracker(redis);
      const alertingService = new AlertingService();

      await scraperLogRepository.create({
        source: 'NSE',
        status: 'FAILURE',
        recordsProcessed: result.iposProcessed,
        recordsFailed: result.iposFailed,
        durationMs: duration,
        errorMessage: errorMsg,
        errorStack: errorStack || null,
      });

      // Record failure metrics in Redis (Story 7.5)
      await metricsTracker.recordFailure('NSE');

      // Check if alert should be sent (Story 7.5)
      const { sendAlert, reason } = await metricsTracker.shouldSendAlert('NSE');
      if (sendAlert && reason) {
        const metrics = await metricsTracker.getMetrics('NSE');
        const consecutiveFailures = await metricsTracker.getConsecutiveFailures('NSE');
        const recentLogs = await scraperLogRepository.getRecentLogs('NSE', 24);
        const recentErrors = alertingService.getRecentErrors(recentLogs);

        await alertingService.sendAlert({
          source: 'NSE',
          severity: consecutiveFailures >= 3 ? 'ERROR' : 'WARN',
          reason,
          consecutiveFailures,
          successRate: metrics.rate,
          recentErrors,
          timestamp: new Date(),
        });

        // Mark alert as sent to prevent spam
        await metricsTracker.markAlertSent('NSE');
      }
    } catch (loggingError) {
      logger.error(
        { error: loggingError instanceof Error ? loggingError.message : String(loggingError) },
        'Failed to log scraper failure'
      );
    }

    // Check if fallback should be triggered
    if (scraperFailureTracker.shouldTriggerFallback('NSE')) {
      logger.warn('NSE scraper failed 3 consecutive times, triggering API fallback');

      try {
        // Initialize repositories for fallback
        const redis = getRedisClient();
        const ipoRepository = new IPORepository(db, redis);

        // Trigger API fallback
        const fallbackResult = await runIPOAlertsFallback(ipoRepository, 'nse_failure');

        if (fallbackResult.success) {
          logger.info(
            {
              iposInserted: fallbackResult.iposInserted,
              iposSkipped: fallbackResult.iposSkipped,
              rateLimitRemaining: fallbackResult.rateLimitRemaining
            },
            'API fallback completed successfully after NSE failure'
          );
        } else {
          logger.error(
            { errors: fallbackResult.errors },
            'API fallback also failed after NSE failure'
          );
        }
      } catch (fallbackError) {
        const fallbackErrorMsg = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        logger.error(
          { error: fallbackErrorMsg },
          'Failed to trigger API fallback after NSE failure'
        );
      }
    }

    return result;
  }
}
