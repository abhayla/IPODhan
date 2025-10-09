import { IPORepository, ScraperLogRepository, db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { scrapeMoneycontrolIPOs } from './moneycontrol-scraper.js';
import { validateMoneycontrolIPOData, generateSlug } from '../utils/validators.js';
import { upsertIPO } from '../services/data-persister.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';

export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  errors: string[];
}

/**
 * Run Moneycontrol scraper workflow
 * Orchestrates scraping, validation, persistence, and cache invalidation
 * @returns Promise<ScraperResult> - Summary of scraper execution
 */
export async function runMoneycontrolScraper(): Promise<ScraperResult> {
  const startTime = Date.now();

  const result: ScraperResult = {
    success: false,
    iposProcessed: 0,
    iposInserted: 0,
    iposUpdated: 0,
    iposFailed: 0,
    errors: []
  };

  try {
    logger.info('Moneycontrol scraper orchestrator started');

    // Initialize repositories and services
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    const cacheInvalidator = new CacheInvalidator(redis);
    const metricsTracker = new ScraperMetricsTracker(redis);
    const alertingService = new AlertingService();

    // Track updated IPO slugs for cache invalidation
    const updatedIPOSlugs: string[] = [];

    // Step 1: Scrape Moneycontrol data
    const { ipos: scrapedIPOs, errors: scrapeErrors } = await scrapeMoneycontrolIPOs();

    logger.info({ totalIPOs: scrapedIPOs.length }, 'Scraped data received from Moneycontrol');

    // Add scrape errors to result
    result.errors.push(...scrapeErrors);

    // Step 2: Validate and process IPOs
    for (const scrapedIPO of scrapedIPOs) {
      try {
        // Validate IPO data
        const validation = validateMoneycontrolIPOData(scrapedIPO);

        if (!validation.success) {
          logger.warn(
            {
              companyName: scrapedIPO.companyName,
              errors: validation.error?.issues
            },
            'Moneycontrol IPO validation failed, skipping'
          );
          result.iposFailed++;
          result.errors.push(`Validation failed for ${scrapedIPO.companyName}`);
          continue;
        }

        const validatedIPO = validation.data!;

        // Check if IPO already exists
        const slug = generateSlug(validatedIPO.companyName);
        const existingIPO = await ipoRepository.findBySlug(slug);

        // Upsert IPO to database
        // Note: upsertIPO should be updated to handle Moneycontrol-specific fields (rating, listingGains)
        const ipoId = await upsertIPO(ipoRepository, validatedIPO, 'MONEYCONTROL');

        if (existingIPO) {
          result.iposUpdated++;
        } else {
          result.iposInserted++;
        }

        result.iposProcessed++;
        updatedIPOSlugs.push(slug);

        logger.debug(
          { companyName: validatedIPO.companyName, rating: validatedIPO.rating },
          'Processed Moneycontrol IPO'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { companyName: scrapedIPO.companyName, error: errorMsg },
          'Failed to process Moneycontrol IPO'
        );
        result.iposFailed++;
        result.errors.push(`Failed to process ${scrapedIPO.companyName}: ${errorMsg}`);
      }
    }

    // Step 3: Comprehensive cache invalidation
    if (updatedIPOSlugs.length > 0) {
      await cacheInvalidator.invalidateAfterScrape('MONEYCONTROL', updatedIPOSlugs);
    }

    const duration = Date.now() - startTime;
    result.success = result.iposFailed < result.iposProcessed;

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('MONEYCONTROL');

    // Log execution to database
    await scraperLogRepository.create({
      source: 'MONEYCONTROL',
      status: 'SUCCESS',
      recordsProcessed: result.iposProcessed,
      recordsFailed: result.iposFailed,
      durationMs: duration,
      errorMessage: null,
      errorStack: null,
    });

    // Record success metrics in Redis
    await metricsTracker.recordSuccess('MONEYCONTROL');

    logger.info(
      {
        ...result,
        duration
      },
      'Moneycontrol scraper orchestrator completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const duration = Date.now() - startTime;

    logger.error(
      { error: errorMsg, duration },
      'Moneycontrol scraper orchestrator failed'
    );

    result.success = false;
    result.errors.push(`Orchestrator error: ${errorMsg}`);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure('MONEYCONTROL', error instanceof Error ? error : new Error(errorMsg));

    // Log failure to database
    try {
      const redis = getRedisClient();
      const scraperLogRepository = new ScraperLogRepository(db, redis);
      const metricsTracker = new ScraperMetricsTracker(redis);
      const alertingService = new AlertingService();

      await scraperLogRepository.create({
        source: 'MONEYCONTROL',
        status: 'FAILURE',
        recordsProcessed: result.iposProcessed,
        recordsFailed: result.iposFailed,
        durationMs: duration,
        errorMessage: errorMsg,
        errorStack: errorStack || null,
      });

      // Record failure metrics in Redis
      await metricsTracker.recordFailure('MONEYCONTROL');

      // Check if alert should be sent
      const { sendAlert, reason } = await metricsTracker.shouldSendAlert('MONEYCONTROL');
      if (sendAlert && reason) {
        const metrics = await metricsTracker.getMetrics('MONEYCONTROL');
        const consecutiveFailures = await metricsTracker.getConsecutiveFailures('MONEYCONTROL');
        const recentLogs = await scraperLogRepository.getRecentLogs('MONEYCONTROL', 24);
        const recentErrors = alertingService.getRecentErrors(recentLogs);

        await alertingService.sendAlert({
          source: 'MONEYCONTROL',
          severity: consecutiveFailures >= 3 ? 'ERROR' : 'WARN',
          reason,
          consecutiveFailures,
          successRate: metrics.rate,
          recentErrors,
          timestamp: new Date(),
        });

        await metricsTracker.markAlertSent('MONEYCONTROL');
      }
    } catch (loggingError) {
      logger.error(
        { error: loggingError instanceof Error ? loggingError.message : String(loggingError) },
        'Failed to log Moneycontrol scraper failure'
      );
    }

    return result;
  }
}
