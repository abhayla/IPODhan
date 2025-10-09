import { IPORepository, ScraperLogRepository, db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { scrapeChittorgarhIPOs } from './chittorgarh-scraper.js';
import { validateChittorgarhIPOData, generateSlug } from '../utils/validators.js';
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
 * Run Chittorgarh scraper workflow
 * Orchestrates scraping, validation, persistence, and cache invalidation
 * Special handling for GMP (Grey Market Premium) data
 * @returns Promise<ScraperResult> - Summary of scraper execution
 */
export async function runChittorgarhScraper(): Promise<ScraperResult> {
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
    logger.info('Chittorgarh scraper orchestrator started');

    // Initialize repositories and services
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    const cacheInvalidator = new CacheInvalidator(redis);
    const metricsTracker = new ScraperMetricsTracker(redis);
    const alertingService = new AlertingService();

    // Track updated IPO slugs for cache invalidation
    const updatedIPOSlugs: string[] = [];

    // Step 1: Scrape Chittorgarh data
    const { ipos: scrapedIPOs, errors: scrapeErrors } = await scrapeChittorgarhIPOs();

    logger.info({ totalIPOs: scrapedIPOs.length }, 'Scraped data received from Chittorgarh');

    // Add scrape errors to result
    result.errors.push(...scrapeErrors);

    // Step 2: Validate and process IPOs
    for (const scrapedIPO of scrapedIPOs) {
      try {
        // Validate IPO data
        const validation = validateChittorgarhIPOData(scrapedIPO);

        if (!validation.success) {
          logger.warn(
            {
              companyName: scrapedIPO.companyName,
              errors: validation.error?.issues
            },
            'Chittorgarh IPO validation failed, skipping'
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
        // Note: upsertIPO should be updated to handle Chittorgarh-specific fields (gmp, gmpPercentage, gmpUpdatedAt)
        const ipoId = await upsertIPO(ipoRepository, validatedIPO, 'CHITTORGARH');

        if (existingIPO) {
          result.iposUpdated++;
        } else {
          result.iposInserted++;
        }

        result.iposProcessed++;
        updatedIPOSlugs.push(slug);

        logger.debug(
          {
            companyName: validatedIPO.companyName,
            gmp: validatedIPO.gmp,
            gmpPercentage: validatedIPO.gmpPercentage
          },
          'Processed Chittorgarh IPO with GMP data'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { companyName: scrapedIPO.companyName, error: errorMsg },
          'Failed to process Chittorgarh IPO'
        );
        result.iposFailed++;
        result.errors.push(`Failed to process ${scrapedIPO.companyName}: ${errorMsg}`);
      }
    }

    // Step 3: Comprehensive cache invalidation
    if (updatedIPOSlugs.length > 0) {
      await cacheInvalidator.invalidateAfterScrape('CHITTORGARH', updatedIPOSlugs);
    }

    const duration = Date.now() - startTime;
    result.success = result.iposFailed < result.iposProcessed;

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('CHITTORGARH');

    // Log execution to database
    await scraperLogRepository.create({
      source: 'CHITTORGARH',
      status: 'SUCCESS',
      recordsProcessed: result.iposProcessed,
      recordsFailed: result.iposFailed,
      durationMs: duration,
      errorMessage: null,
      errorStack: null,
    });

    // Record success metrics in Redis
    await metricsTracker.recordSuccess('CHITTORGARH');

    logger.info(
      {
        ...result,
        duration
      },
      'Chittorgarh scraper orchestrator completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const duration = Date.now() - startTime;

    logger.error(
      { error: errorMsg, duration },
      'Chittorgarh scraper orchestrator failed'
    );

    result.success = false;
    result.errors.push(`Orchestrator error: ${errorMsg}`);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure('CHITTORGARH', error instanceof Error ? error : new Error(errorMsg));

    // Log failure to database
    try {
      const redis = getRedisClient();
      const scraperLogRepository = new ScraperLogRepository(db, redis);
      const metricsTracker = new ScraperMetricsTracker(redis);
      const alertingService = new AlertingService();

      await scraperLogRepository.create({
        source: 'CHITTORGARH',
        status: 'FAILURE',
        recordsProcessed: result.iposProcessed,
        recordsFailed: result.iposFailed,
        durationMs: duration,
        errorMessage: errorMsg,
        errorStack: errorStack || null,
      });

      // Record failure metrics in Redis
      await metricsTracker.recordFailure('CHITTORGARH');

      // Check if alert should be sent
      const { sendAlert, reason } = await metricsTracker.shouldSendAlert('CHITTORGARH');
      if (sendAlert && reason) {
        const metrics = await metricsTracker.getMetrics('CHITTORGARH');
        const consecutiveFailures = await metricsTracker.getConsecutiveFailures('CHITTORGARH');
        const recentLogs = await scraperLogRepository.getRecentLogs('CHITTORGARH', 24);
        const recentErrors = alertingService.getRecentErrors(recentLogs);

        await alertingService.sendAlert({
          source: 'CHITTORGARH',
          severity: consecutiveFailures >= 3 ? 'ERROR' : 'WARN',
          reason,
          consecutiveFailures,
          successRate: metrics.rate,
          recentErrors,
          timestamp: new Date(),
        });

        await metricsTracker.markAlertSent('CHITTORGARH');
      }
    } catch (loggingError) {
      logger.error(
        { error: loggingError instanceof Error ? loggingError.message : String(loggingError) },
        'Failed to log Chittorgarh scraper failure'
      );
    }

    return result;
  }
}
