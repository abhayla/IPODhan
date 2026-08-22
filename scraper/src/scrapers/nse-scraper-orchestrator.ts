import {
  IPORepository,
  SubscriptionRepository,
  ScraperLogRepository,
  FieldSourcesRepository,
  DataConflictsRepository,
  db,
  getRedisClient,
} from '@ipodhan/shared';
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
import { DataConsolidationOrchestrator } from '../services/data-consolidation-orchestrator.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { DRHPOrchestratorService } from '../services/drhp-orchestrator.js';
import { DRHPDownloaderService } from '../services/drhp-downloader.js';
import { DRHPExtractorService } from '../services/drhp-extractor.js';
import { ManualReviewQueueService } from '../services/manual-review-queue.js';
import { DataConsolidationService } from '../services/data-consolidation-service.js';

export interface ScraperResult {
  success: boolean;
  iposProcessed: number;
  iposInserted: number;
  iposUpdated: number;
  iposFailed: number;
  subscriptionsCreated: number;
  errors: string[];
  // Phase 1 consolidation metrics
  consolidationEnabled?: boolean;
  conflictsDetected?: number;
  fieldsConsolidated?: number;
  avgConsolidationTimeMs?: number;
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
    errors: [],
    consolidationEnabled: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    conflictsDetected: 0,
    fieldsConsolidated: 0,
    avgConsolidationTimeMs: 0,
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

    // Phase 1: Initialize consolidation infrastructure
    const fieldSourcesRepository = new FieldSourcesRepository(db, redis);
    const dataConflictsRepository = new DataConflictsRepository(db, redis);
    const consolidationOrchestrator = new DataConsolidationOrchestrator(
      ipoRepository,
      fieldSourcesRepository,
      dataConflictsRepository,
      redis
    );

    // Phase 2: Initialize DRHP extraction pipeline (if enabled)
    let drhpOrchestrator: DRHPOrchestratorService | null = null;
    if (FEATURE_FLAGS.ENABLE_DRHP_EXTRACTION) {
      const documentRepository = db; // Placeholder - needs actual DocumentRepository
      const manualReviewQueue = new ManualReviewQueueService();
      const drhpDownloader = new DRHPDownloaderService(documentRepository);
      const drhpExtractor = new DRHPExtractorService(manualReviewQueue);
      const consolidationService = new DataConsolidationService(
        fieldSourcesRepository,
        dataConflictsRepository
      );

      drhpOrchestrator = new DRHPOrchestratorService(
        drhpDownloader,
        drhpExtractor,
        consolidationService,
        documentRepository,
        manualReviewQueue
      );

      logger.info('[Phase 2] DRHP extraction pipeline initialized');
    }

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
        const slug = generateSlug(validatedIPO.companyName);

        // Phase 1: Use consolidation orchestrator if enabled
        let ipoId: string;
        if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
          const consolidationResult = await consolidationOrchestrator.consolidatedUpsertIPO(
            validatedIPO,
            'NSE',
            95 // NSE confidence score
          );

          if (consolidationResult.skipped) {
            logger.warn(
              { slug, reason: consolidationResult.skipReason },
              '[Phase 1] IPO consolidation skipped'
            );
            // Fallback to traditional upsert
            const existingIPO = await ipoRepository.findBySlug(slug);
            ipoId = await upsertIPO(ipoRepository, validatedIPO, 'NSE');
            if (existingIPO) {
              result.iposUpdated++;
            } else {
              result.iposInserted++;
            }
          } else {
            ipoId = consolidationResult.ipoId;

            // Track consolidation metrics
            if (consolidationResult.consolidation) {
              result.conflictsDetected = (result.conflictsDetected || 0) +
                consolidationResult.consolidation.conflictsDetected;
              result.fieldsConsolidated = (result.fieldsConsolidated || 0) +
                consolidationResult.consolidation.fieldsUpdated;

              // Update average consolidation time
              const totalTime = (result.avgConsolidationTimeMs || 0) * result.iposProcessed;
              result.avgConsolidationTimeMs =
                (totalTime + consolidationResult.consolidation.performanceMs) / (result.iposProcessed + 1);
            }

            if (consolidationResult.isNew) {
              result.iposInserted++;

              // Phase 2: Trigger DRHP extraction pipeline for new IPOs (async, non-blocking)
              if (drhpOrchestrator && validatedIPO.companyName) {
                drhpOrchestrator.processIPO({
                  ipoId,
                  companyName: validatedIPO.companyName,
                  isin: validatedIPO.isin,
                }).catch((error) => {
                  logger.warn(
                    {
                      companyName: validatedIPO.companyName,
                      error: error instanceof Error ? error.message : String(error)
                    },
                    '[Phase 2] DRHP pipeline failed, continuing scraper'
                  );
                });

                logger.info(
                  { companyName: validatedIPO.companyName },
                  '[Phase 2] DRHP extraction pipeline triggered (async)'
                );
              }
            } else {
              result.iposUpdated++;
            }

            if (FEATURE_FLAGS.DEBUG_DATA_FLOW) {
              logger.debug({
                slug,
                ipoId,
                isNew: consolidationResult.isNew,
                conflictsDetected: consolidationResult.consolidation?.conflictsDetected,
                fieldsUpdated: consolidationResult.consolidation?.fieldsUpdated,
              }, '[Phase 1] IPO consolidated successfully');
            }
          }
        } else {
          // Traditional upsert (no consolidation)
          const existingIPO = await ipoRepository.findBySlug(slug);
          ipoId = await upsertIPO(ipoRepository, validatedIPO, 'NSE');
          if (existingIPO) {
            result.iposUpdated++;
          } else {
            result.iposInserted++;
          }
        }

        result.iposProcessed++;

        // Track updated IPO slug for comprehensive cache invalidation
        updatedIPOSlugs.push(slug);

        // Step 3: Process subscription data for OPEN (active) IPOs
        if (validatedIPO.status === 'OPEN') {
          const relatedSubscription = scrapedSubscriptions.find(
            sub => sub.ipoCompanyName === validatedIPO.companyName
          );

          if (relatedSubscription) {
            const subscriptionValidation = validateSubscriptionData(relatedSubscription);

            if (subscriptionValidation.success) {
              const snapshotId = await createSubscriptionSnapshot(
                subscriptionRepository,
                ipoId,
                subscriptionValidation.data!,
                { source: 'NSE' }
              );
              if (snapshotId !== null) result.subscriptionsCreated++;

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

    // Log completion with Phase 1 metrics
    const logData: any = {
      ...result,
      duration,
    };

    if (FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION) {
      logData.phase1Metrics = {
        consolidationEnabled: result.consolidationEnabled,
        conflictsDetected: result.conflictsDetected,
        fieldsConsolidated: result.fieldsConsolidated,
        avgConsolidationTimeMs: result.avgConsolidationTimeMs?.toFixed(2),
      };
    }

    logger.info(logData, 'NSE scraper orchestrator completed (Phase 1 integrated)');

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
