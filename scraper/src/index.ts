#!/usr/bin/env node

import { runNSEScraper } from './scrapers/nse-scraper-orchestrator.js';
import { runBSEScraper } from './scrapers/bse-scraper-orchestrator.js';
import { runIPOAlertsFallback } from './scrapers/ipo-alerts-fallback-orchestrator.js';
import { IPORepository } from '../../web/lib/repositories/ipo-repository.js';
import { db } from '../../web/lib/db/index.js';
import { getRedisClient } from '../../web/lib/cache/redis-client.js';
import logger from './utils/logger.js';

/**
 * CLI entry point for IPO scrapers
 * Supports NSE, BSE, API fallback, and combined scraping via --source flag
 * Usage:
 *   npm start                    (defaults to NSE)
 *   npm run start:bse            (BSE only)
 *   npm run start:fallback       (IPO Alerts API fallback)
 *   npm run start:api            (alias for fallback)
 *   npm run start:all            (NSE + BSE + API fallback sequentially)
 */
async function main() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    const source = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'nse';

    logger.info({ source }, 'IPO Scraper CLI started');

    // Validate source
    if (!['nse', 'bse', 'fallback', 'api', 'all'].includes(source)) {
      logger.error({ source }, 'Invalid source. Must be: nse, bse, fallback, api, or all');
      process.exit(1);
    }

    let combinedResult = {
      success: true,
      iposProcessed: 0,
      iposInserted: 0,
      iposUpdated: 0,
      iposMerged: 0,
      iposFailed: 0,
      smeCount: 0,
      mainboardCount: 0,
      subscriptionsCreated: 0,
      errors: [] as string[]
    };

    // Run NSE scraper
    if (source === 'nse' || source === 'all') {
      logger.info('Running NSE scraper');
      const nseResult = await runNSEScraper();

      combinedResult.success = combinedResult.success && nseResult.success;
      combinedResult.iposProcessed += nseResult.iposProcessed;
      combinedResult.iposInserted += nseResult.iposInserted;
      combinedResult.iposUpdated += nseResult.iposUpdated;
      combinedResult.iposFailed += nseResult.iposFailed;
      combinedResult.subscriptionsCreated += nseResult.subscriptionsCreated;
      combinedResult.errors.push(...nseResult.errors);

      logger.info(
        {
          success: nseResult.success,
          iposProcessed: nseResult.iposProcessed,
          iposInserted: nseResult.iposInserted,
          iposUpdated: nseResult.iposUpdated,
          iposFailed: nseResult.iposFailed
        },
        'NSE scraper completed'
      );
    }

    // Run BSE scraper
    if (source === 'bse' || source === 'all') {
      logger.info('Running BSE scraper');
      const bseResult = await runBSEScraper();

      combinedResult.success = combinedResult.success && bseResult.success;
      combinedResult.iposProcessed += bseResult.iposProcessed;
      combinedResult.iposInserted += bseResult.iposInserted;
      combinedResult.iposUpdated += bseResult.iposUpdated;
      combinedResult.iposMerged += bseResult.iposMerged;
      combinedResult.iposFailed += bseResult.iposFailed;
      combinedResult.smeCount += bseResult.smeCount;
      combinedResult.mainboardCount += bseResult.mainboardCount;
      combinedResult.subscriptionsCreated += bseResult.subscriptionsCreated;
      combinedResult.errors.push(...bseResult.errors);

      logger.info(
        {
          success: bseResult.success,
          iposProcessed: bseResult.iposProcessed,
          iposInserted: bseResult.iposInserted,
          iposUpdated: bseResult.iposUpdated,
          iposMerged: bseResult.iposMerged,
          smeCount: bseResult.smeCount,
          mainboardCount: bseResult.mainboardCount,
          iposFailed: bseResult.iposFailed
        },
        'BSE scraper completed'
      );
    }

    // Run IPO Alerts API fallback scraper
    if (source === 'fallback' || source === 'api' || source === 'all') {
      logger.info('Running IPO Alerts API fallback scraper (manual execution)');

      const redis = getRedisClient();
      const ipoRepository = new IPORepository(db, redis);

      const fallbackResult = await runIPOAlertsFallback(ipoRepository, 'manual');

      combinedResult.success = combinedResult.success && fallbackResult.success;
      combinedResult.iposProcessed += fallbackResult.iposProcessed;
      combinedResult.iposInserted += fallbackResult.iposInserted;
      combinedResult.iposUpdated += fallbackResult.iposUpdated;
      combinedResult.iposFailed += fallbackResult.iposFailed;
      combinedResult.errors.push(...fallbackResult.errors);

      logger.info(
        {
          success: fallbackResult.success,
          iposFetched: fallbackResult.iposFetched,
          iposInserted: fallbackResult.iposInserted,
          iposSkipped: fallbackResult.iposSkipped,
          iposFailed: fallbackResult.iposFailed,
          rateLimitUsed: fallbackResult.rateLimitUsed,
          rateLimitRemaining: fallbackResult.rateLimitRemaining
        },
        'IPO Alerts API fallback scraper completed'
      );
    }

    // Log final combined result
    logger.info(
      {
        source,
        success: combinedResult.success,
        iposProcessed: combinedResult.iposProcessed,
        iposInserted: combinedResult.iposInserted,
        iposUpdated: combinedResult.iposUpdated,
        iposMerged: combinedResult.iposMerged,
        smeCount: combinedResult.smeCount,
        mainboardCount: combinedResult.mainboardCount,
        iposFailed: combinedResult.iposFailed,
        subscriptionsCreated: combinedResult.subscriptionsCreated,
        errorCount: combinedResult.errors.length
      },
      'Scraper execution completed'
    );

    // Exit with appropriate code
    if (combinedResult.success) {
      logger.info('Scraper completed successfully');
      process.exit(0);
    } else {
      logger.error('Scraper completed with errors');
      if (combinedResult.errors.length > 0) {
        logger.error({ errors: combinedResult.errors }, 'Error details');
      }
      process.exit(1);
    }

  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scraper CLI failed with unhandled error'
    );
    process.exit(1);
  }
}

// Run CLI
main();
