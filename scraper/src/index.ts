#!/usr/bin/env node

// CRITICAL: Load environment variables FIRST before any imports that use them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import { runNSEScraper } from './scrapers/nse-scraper-orchestrator.js';
import { runBSEScraper } from './scrapers/bse-scraper-orchestrator.js';
import { runIPOAlertsFallback } from './scrapers/ipo-alerts-fallback-orchestrator.js';
import { runMoneycontrolScraper } from './scrapers/moneycontrol-orchestrator.js';
import { runChittorgarhScraper } from './scrapers/chittorgarh-orchestrator.js';
import { IPORepository, db, getRedisClient } from '@ipodhan/shared';
import logger from './utils/logger.js';

/**
 * CLI entry point for IPO scrapers
 * Supports NSE, BSE, Moneycontrol, Chittorgarh, API fallback, and combined scraping via --source flag
 * Usage:
 *   npm start                         (defaults to NSE)
 *   npm run start:bse                 (BSE only)
 *   npm run start:moneycontrol        (Moneycontrol only)
 *   npm run start:chittorgarh         (Chittorgarh only)
 *   npm run start:fallback            (IPO Alerts API fallback)
 *   npm run start:api                 (alias for fallback)
 *   npm run start:all                 (NSE + BSE + Moneycontrol + Chittorgarh + API fallback sequentially)
 */
async function main() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    const source = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'nse';

    logger.info({ source }, 'IPO Scraper CLI started');

    // Validate source
    if (!['nse', 'bse', 'moneycontrol', 'chittorgarh', 'fallback', 'api', 'all'].includes(source)) {
      logger.error({ source }, 'Invalid source. Must be: nse, bse, moneycontrol, chittorgarh, fallback, api, or all');
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

    // Run Moneycontrol scraper
    if (source === 'moneycontrol' || source === 'all') {
      logger.info('Running Moneycontrol scraper');
      const moneycontrolResult = await runMoneycontrolScraper();

      combinedResult.success = combinedResult.success && moneycontrolResult.success;
      combinedResult.iposProcessed += moneycontrolResult.iposProcessed;
      combinedResult.iposInserted += moneycontrolResult.iposInserted;
      combinedResult.iposUpdated += moneycontrolResult.iposUpdated;
      combinedResult.iposFailed += moneycontrolResult.iposFailed;
      combinedResult.errors.push(...moneycontrolResult.errors);

      logger.info(
        {
          success: moneycontrolResult.success,
          iposProcessed: moneycontrolResult.iposProcessed,
          iposInserted: moneycontrolResult.iposInserted,
          iposUpdated: moneycontrolResult.iposUpdated,
          iposFailed: moneycontrolResult.iposFailed
        },
        'Moneycontrol scraper completed'
      );
    }

    // Run Chittorgarh scraper
    if (source === 'chittorgarh' || source === 'all') {
      logger.info('Running Chittorgarh scraper');
      const chittorgarhResult = await runChittorgarhScraper();

      combinedResult.success = combinedResult.success && chittorgarhResult.success;
      combinedResult.iposProcessed += chittorgarhResult.iposProcessed;
      combinedResult.iposInserted += chittorgarhResult.iposInserted;
      combinedResult.iposUpdated += chittorgarhResult.iposUpdated;
      combinedResult.iposFailed += chittorgarhResult.iposFailed;
      combinedResult.errors.push(...chittorgarhResult.errors);

      logger.info(
        {
          success: chittorgarhResult.success,
          iposProcessed: chittorgarhResult.iposProcessed,
          iposInserted: chittorgarhResult.iposInserted,
          iposUpdated: chittorgarhResult.iposUpdated,
          iposFailed: chittorgarhResult.iposFailed
        },
        'Chittorgarh scraper completed'
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
