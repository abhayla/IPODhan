import {
  IPORepository,
  SubscriptionRepository,
  FieldSourcesRepository,
  DataConflictsRepository,
  db,
  getRedisClient,
} from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { scrapeBSEIPOs } from './bse-scraper.js';
import { validateIPOData, validateSubscriptionData, generateSlug } from '../utils/validators.js';
import { upsertIPO, createSubscriptionSnapshot } from '../services/data-persister.js';
import { invalidateIPOCaches, invalidateSubscriptionCache } from '../services/cache-invalidator.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { runIPOAlertsFallback } from './ipo-alerts-fallback-orchestrator.js';
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
  iposMerged: number;
  iposFailed: number;
  smeCount: number;
  mainboardCount: number;
  subscriptionsCreated: number;
  errors: string[];
  // Phase 1 consolidation metrics
  consolidationEnabled?: boolean;
  conflictsDetected?: number;
  fieldsConsolidated?: number;
  avgConsolidationTimeMs?: number;
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
    errors: [],
    consolidationEnabled: FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION,
    conflictsDetected: 0,
    fieldsConsolidated: 0,
    avgConsolidationTimeMs: 0,
  };

  try {
    logger.info('BSE scraper orchestrator started');

    // Initialize repositories
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const subscriptionRepository = new SubscriptionRepository(db, redis);
    const cacheInvalidator = new CacheInvalidator(redis);

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

      logger.info('[Phase 2] DRHP extraction pipeline initialized (BSE)');
    }

    // Track all updated IPO slugs for comprehensive cache invalidation
    const updatedIPOSlugs: string[] = [];

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
            'BSE',
            90 // BSE confidence score (slightly lower than NSE's 95)
          );

          if (consolidationResult.skipped) {
            logger.warn(
              { slug, reason: consolidationResult.skipReason },
              '[Phase 1] IPO consolidation skipped'
            );
            // Fallback to traditional upsert
            const existingIPO = await ipoRepository.findBySlug(slug);
            const isMerge = existingIPO && !(existingIPO.listingExchanges as string[]).includes('BSE');
            ipoId = await upsertIPO(ipoRepository, validatedIPO, 'BSE');

            if (isMerge) {
              result.iposMerged++;
              result.iposUpdated++;
            } else if (existingIPO) {
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

            // Track if this is a merge operation
            if (consolidationResult.isMerged) {
              result.iposMerged++;
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
                    '[Phase 2] DRHP pipeline failed (BSE), continuing scraper'
                  );
                });

                logger.info(
                  { companyName: validatedIPO.companyName },
                  '[Phase 2] DRHP extraction pipeline triggered (BSE, async)'
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
                isMerged: consolidationResult.isMerged,
                conflictsDetected: consolidationResult.consolidation?.conflictsDetected,
                fieldsUpdated: consolidationResult.consolidation?.fieldsUpdated,
              }, '[Phase 1] IPO consolidated successfully');
            }
          }
        } else {
          // Traditional upsert (no consolidation)
          const existingIPO = await ipoRepository.findBySlug(slug);
          const isMerge = existingIPO && !(existingIPO.listingExchanges as string[]).includes('BSE');
          ipoId = await upsertIPO(ipoRepository, validatedIPO, 'BSE');

          if (isMerge) {
            result.iposMerged++;
            result.iposUpdated++;
          } else if (existingIPO) {
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
                { source: 'BSE', redis: getRedisClient() }
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
      await cacheInvalidator.invalidateAfterScrape('BSE', updatedIPOSlugs);
    }

    const duration = Date.now() - startTime;
    result.success = result.iposFailed < result.iposProcessed; // Success if majority processed

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('BSE');

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

    logger.info(logData, 'BSE scraper orchestrator completed (Phase 1 integrated)');

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
