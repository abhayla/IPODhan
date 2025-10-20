/**
 * Investorgain GMP Orchestrator
 *
 * Orchestrates GMP data scraping from investorgain.com API and persists to database
 * Matches GMPs to existing IPOs by dates, creates gmp_records entries
 *
 * Created: 2025-10-18
 */

import { IPORepository, GMPRepository, ScraperLogRepository, db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { scrapeInvestorgainGMPs } from './investorgain-gmp-scraper.js';
import { createGMPRecord } from '../services/data-persister.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';
import { scraperFailureTracker } from '../services/scraper-failure-tracker.js';
import { ScraperMetricsTracker } from '../services/scraper-metrics-tracker.js';
import { AlertingService } from '../services/alerting-service.js';

export interface InvestorgainGMPResult {
  success: boolean;
  gmpsProcessed: number;
  gmpsCreated: number;
  gmpsSkipped: number; // No matching IPO found
  gmpsFailed: number;
  errors: string[];
}

/**
 * Calculate string similarity score (0-1) using simple character matching
 * Higher score = more similar
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  // Exact match
  if (s1 === s2) return 1.0;

  // One contains the other
  if (s1.includes(s2) || s2.includes(s1)) {
    return 0.9;
  }

  // Calculate character overlap
  const set1 = new Set(s1.replace(/\s+/g, ''));
  const set2 = new Set(s2.replace(/\s+/g, ''));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

/**
 * Match Investorgain GMP to database IPO by dates + company name similarity
 * Primary: Exact match on open_date and close_date
 * Enhancement (ISS-001 fix): Use company name similarity when multiple date matches exist
 * Fallback: Match on open_date within ±1 day tolerance
 */
async function matchIPOByDates(
  ipoRepository: IPORepository,
  openDate: string,
  closeDate: string,
  companyName: string
): Promise<string | null> {
  try {
    // Try exact date match first
    const exactMatches = await ipoRepository.findByDates({ openDate, closeDate });

    if (exactMatches.length === 1) {
      logger.debug(
        { companyName, openDate, closeDate, matchedId: exactMatches[0].id },
        'Found exact date match for GMP'
      );
      return exactMatches[0].id;
    }

    if (exactMatches.length > 1) {
      // ISS-001 Fix: Multiple matches - use company name similarity
      const matchesWithSimilarity = exactMatches.map(ipo => ({
        ...ipo,
        similarity: calculateSimilarity(companyName, ipo.companyName)
      }));

      // Sort by similarity (highest first)
      matchesWithSimilarity.sort((a, b) => b.similarity - a.similarity);

      const bestMatch = matchesWithSimilarity[0];

      // Accept match if similarity > 0.6 (60%)
      if (bestMatch.similarity > 0.6) {
        logger.info(
          {
            gmpCompanyName: companyName,
            matchedCompanyName: bestMatch.companyName,
            similarity: bestMatch.similarity.toFixed(2),
            openDate,
            closeDate,
            matchedId: bestMatch.id,
            totalCandidates: exactMatches.length
          },
          'Found best match using company name similarity'
        );
        return bestMatch.id;
      }

      // Similarity too low - skip
      logger.warn(
        {
          companyName,
          openDate,
          closeDate,
          matchCount: exactMatches.length,
          bestSimilarity: bestMatch.similarity.toFixed(2),
          matches: matchesWithSimilarity.slice(0, 3).map(ipo => ({
            id: ipo.id,
            companyName: ipo.companyName,
            similarity: ipo.similarity.toFixed(2)
          }))
        },
        'Multiple IPOs found but no good similarity match - skipping GMP'
      );
      return null;
    }

    // No exact match - try fuzzy date match (±1 day tolerance)
    const openDateObj = new Date(openDate);
    const dayBefore = new Date(openDateObj);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const dayAfter = new Date(openDateObj);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const fuzzyOpenDates = [
      dayBefore.toISOString().split('T')[0],
      openDate,
      dayAfter.toISOString().split('T')[0]
    ];

    for (const fuzzyOpen of fuzzyOpenDates) {
      const fuzzyMatches = await ipoRepository.findByDates({ openDate: fuzzyOpen, closeDate });

      if (fuzzyMatches.length === 1) {
        logger.debug(
          {
            companyName,
            originalOpenDate: openDate,
            fuzzyOpenDate: fuzzyOpen,
            closeDate,
            matchedId: fuzzyMatches[0].id
          },
          'Found fuzzy date match for GMP (±1 day tolerance)'
        );
        return fuzzyMatches[0].id;
      }
    }

    // No match found
    logger.debug(
      { companyName, openDate, closeDate },
      'No matching IPO found for GMP data'
    );
    return null;

  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        companyName,
        openDate,
        closeDate
      },
      'Error matching IPO by dates'
    );
    return null;
  }
}

/**
 * Run Investorgain GMP scraper workflow
 * Orchestrates scraping, matching, persistence, and cache invalidation
 */
export async function runInvestorgainGMPScraper(): Promise<InvestorgainGMPResult> {
  const startTime = Date.now();

  const result: InvestorgainGMPResult = {
    success: false,
    gmpsProcessed: 0,
    gmpsCreated: 0,
    gmpsSkipped: 0,
    gmpsFailed: 0,
    errors: []
  };

  try {
    logger.info('Investorgain GMP scraper orchestrator started');

    // Initialize repositories and services
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const gmpRepository = new GMPRepository(db, redis);
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    const cacheInvalidator = new CacheInvalidator(redis);
    const metricsTracker = new ScraperMetricsTracker(redis);
    const alertingService = new AlertingService();

    // Track updated IPO IDs for cache invalidation
    const updatedIPOIds: string[] = [];

    // Step 1: Scrape Investorgain GMP data
    const { gmps: scrapedGMPs, errors: scrapeErrors } = await scrapeInvestorgainGMPs();

    logger.info({ totalGMPs: scrapedGMPs.length }, 'Scraped GMP data received from Investorgain');

    // Add scrape errors to result
    result.errors.push(...scrapeErrors);

    // Step 2: Match and persist GMPs
    for (const scrapedGMP of scrapedGMPs) {
      try {
        // Match IPO by dates
        const ipoId = await matchIPOByDates(
          ipoRepository,
          scrapedGMP.openDate,
          scrapedGMP.closeDate,
          scrapedGMP.companyName
        );

        if (!ipoId) {
          result.gmpsSkipped++;
          logger.debug(
            {
              companyName: scrapedGMP.companyName,
              gmp: scrapedGMP.gmp,
              openDate: scrapedGMP.openDate,
              closeDate: scrapedGMP.closeDate
            },
            'Skipping GMP - no matching IPO found'
          );
          continue;
        }

        // Create GMP record
        const gmpRecordId = await createGMPRecord(
          gmpRepository,
          ipoId,
          scrapedGMP.gmp,
          scrapedGMP.gmpUpdatedAt
        );

        result.gmpsCreated++;
        result.gmpsProcessed++;
        updatedIPOIds.push(ipoId);

        logger.debug(
          {
            companyName: scrapedGMP.companyName,
            ipoId,
            gmpRecordId,
            gmp: scrapedGMP.gmp,
            gmpPercentage: scrapedGMP.gmpPercentage
          },
          'Created GMP record for IPO'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(
          { companyName: scrapedGMP.companyName, error: errorMsg },
          'Failed to process Investorgain GMP'
        );
        result.gmpsFailed++;
        result.errors.push(`Failed to process ${scrapedGMP.companyName}: ${errorMsg}`);
      }
    }

    // Step 3: Cache invalidation for updated IPOs
    if (updatedIPOIds.length > 0) {
      logger.info(
        { ipoCount: updatedIPOIds.length },
        'Invalidating cache for IPOs with new GMP data'
      );

      // Invalidate GMP-related cache keys
      for (const ipoId of updatedIPOIds) {
        await cacheInvalidator.invalidateGMPCache(ipoId);
      }
    }

    const duration = Date.now() - startTime;
    result.success = result.gmpsFailed < result.gmpsProcessed;

    // Record success in failure tracker
    scraperFailureTracker.recordSuccess('INVESTORGAIN_GMP');

    // Log execution to database
    await scraperLogRepository.create({
      source: 'INVESTORGAIN_GMP',
      status: 'SUCCESS',
      recordsProcessed: result.gmpsProcessed,
      recordsFailed: result.gmpsFailed,
      durationMs: duration,
      errorMessage: null,
      errorStack: null,
    });

    // Record success metrics in Redis
    await metricsTracker.recordSuccess('INVESTORGAIN_GMP');

    logger.info(
      {
        ...result,
        duration
      },
      'Investorgain GMP scraper orchestrator completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const duration = Date.now() - startTime;

    logger.error(
      { error: errorMsg, duration },
      'Investorgain GMP scraper orchestrator failed'
    );

    result.success = false;
    result.errors.push(`Orchestrator error: ${errorMsg}`);

    // Record failure in failure tracker
    scraperFailureTracker.recordFailure('INVESTORGAIN_GMP', error instanceof Error ? error : new Error(errorMsg));

    // Log failure to database
    try {
      const redis = getRedisClient();
      const scraperLogRepository = new ScraperLogRepository(db, redis);
      const metricsTracker = new ScraperMetricsTracker(redis);
      const alertingService = new AlertingService();

      await scraperLogRepository.create({
        source: 'INVESTORGAIN_GMP',
        status: 'FAILURE',
        recordsProcessed: result.gmpsProcessed,
        recordsFailed: result.gmpsFailed,
        durationMs: duration,
        errorMessage: errorMsg,
        errorStack: errorStack || null,
      });

      // Record failure metrics in Redis
      await metricsTracker.recordFailure('INVESTORGAIN_GMP');

      // Check if alert should be sent
      const { sendAlert, reason } = await metricsTracker.shouldSendAlert('INVESTORGAIN_GMP');
      if (sendAlert && reason) {
        const metrics = await metricsTracker.getMetrics('INVESTORGAIN_GMP');
        const consecutiveFailures = await metricsTracker.getConsecutiveFailures('INVESTORGAIN_GMP');
        const recentLogs = await scraperLogRepository.getRecentLogs('INVESTORGAIN_GMP', 24);
        const recentErrors = alertingService.getRecentErrors(recentLogs);

        await alertingService.sendAlert({
          source: 'INVESTORGAIN_GMP',
          severity: consecutiveFailures >= 3 ? 'ERROR' : 'WARN',
          reason,
          consecutiveFailures,
          successRate: metrics.rate,
          recentErrors,
          timestamp: new Date(),
        });

        await metricsTracker.markAlertSent('INVESTORGAIN_GMP');
      }
    } catch (loggingError) {
      logger.error(
        { error: loggingError instanceof Error ? loggingError.message : String(loggingError) },
        'Failed to log Investorgain GMP scraper failure'
      );
    }

    return result;
  }
}
