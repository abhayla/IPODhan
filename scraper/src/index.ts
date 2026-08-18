#!/usr/bin/env node

// CRITICAL: Load environment variables FIRST before any imports that use them
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

import { runNSEScraper } from './scrapers/nse-scraper-orchestrator-v2.js';
import { runBSEScraper } from './scrapers/bse-scraper-orchestrator-v2.js';
import { runIPOAlertsFallback } from './scrapers/ipo-alerts-fallback-orchestrator-v2.js';
import { runMoneycontrolScraper } from './scrapers/moneycontrol-orchestrator-v2.js';
import { runChittorgarhScraper } from './scrapers/chittorgarh-orchestrator-v2.js';
import { runInvestorgainGMPScraper } from './scrapers/investorgain-gmp-orchestrator-v2.js';
import { updateListingPerformance } from './scrapers/listing-performance-updater.js';
import { shouldRunListingPerformanceUpdate } from './scheduler/listing-performance-cadence.js';
import { db } from '@ipodhan/shared';
import { scraperLogs } from '@ipodhan/shared/db/schema';
import { lt } from 'drizzle-orm';
import logger from './utils/logger.js';

/** Days of scraper_logs history to retain. */
const SCRAPER_LOG_RETENTION_DAYS = 30;

/**
 * CLI entry point for IPO scrapers
 * Supports NSE, BSE, Moneycontrol, Chittorgarh, GMP, API fallback, and combined scraping via --source flag
 * Usage:
 *   npm start                         (defaults to NSE)
 *   npm run start:bse                 (BSE only)
 *   npm run start:moneycontrol        (Moneycontrol only)
 *   npm run start:chittorgarh         (Chittorgarh only)
 *   npm run start:gmp                 (Investorgain GMP only)
 *   npm run start:fallback            (IPO Alerts API fallback)
 *   npm run start:api                 (alias for fallback)
 *   npm run start:all                 (NSE + BSE + Moneycontrol + Chittorgarh + API fallback + GMP sequentially)
 */
export async function main() {
  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);
    const source = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'nse';

    logger.info({ source }, 'IPO Scraper CLI started');

    // Validate source
    if (!['nse', 'bse', 'moneycontrol', 'chittorgarh', 'gmp', 'fallback', 'api', 'all'].includes(source)) {
      logger.error({ source }, 'Invalid source. Must be: nse, bse, moneycontrol, chittorgarh, gmp, fallback, api, or all');
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

      const fallbackResult = await runIPOAlertsFallback('manual');

      combinedResult.success = combinedResult.success && fallbackResult.success;
      combinedResult.iposProcessed += fallbackResult.iposProcessed;
      combinedResult.iposInserted += fallbackResult.iposInserted;
      combinedResult.iposUpdated += fallbackResult.iposUpdated;
      combinedResult.iposFailed += fallbackResult.iposFailed;
      combinedResult.errors.push(...fallbackResult.errors);

      logger.info(
        {
          success: fallbackResult.success,
          iposProcessed: fallbackResult.iposProcessed,
          iposInserted: fallbackResult.iposInserted,
          iposSkipped: fallbackResult.iposSkipped,
          iposFailed: fallbackResult.iposFailed,
          rateLimitUsed: fallbackResult.rateLimitUsed,
          rateLimitRemaining: fallbackResult.rateLimitRemaining,
          triggerReason: fallbackResult.triggerReason
        },
        'IPO Alerts API fallback scraper completed'
      );
    }

    // Run Investorgain GMP scraper (populates gmp_records table)
    if (source === 'gmp' || source === 'all') {
      logger.info('Running Investorgain GMP scraper');
      const gmpResult = await runInvestorgainGMPScraper();

      combinedResult.success = combinedResult.success && gmpResult.success;
      combinedResult.errors.push(...gmpResult.errors);

      logger.info(
        {
          success: gmpResult.success,
          gmpsProcessed: gmpResult.gmpsProcessed,
          gmpsCreated: gmpResult.gmpsCreated,
          gmpsSkipped: gmpResult.gmpsSkipped,
          gmpsFailed: gmpResult.gmpsFailed
        },
        'Investorgain GMP scraper completed'
      );
    }

    // After scraping, apply time-based IPO status transitions (GitHub #4) and
    // refresh listed-company current prices (T-179). Only for the full 'all'
    // run (the scheduled production path). Both are non-fatal: a failure here
    // must not fail the scrape.
    if (source === 'all') {
      await triggerStatusUpdate();
      await triggerListingPerformanceUpdate();
      await pruneScraperLogs();
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

/**
 * Trigger time-based IPO status transitions via the web admin API after a
 * scrape run (GitHub #4). Kept as an HTTP call (not a direct import) so the
 * status logic stays in the web app — its DB schema, cache keys, and the `@/`
 * path alias all resolve there, and the scraper avoids a web/ boundary import.
 */
async function triggerStatusUpdate(): Promise<void> {
  const baseUrl = process.env.WEB_INTERNAL_URL || 'http://localhost:3001';
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    logger.warn('ADMIN_API_TOKEN not set — skipping IPO status update');
    return;
  }
  try {
    const res = await fetch(`${baseUrl}/api/admin/status/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'IPO status update returned non-OK');
      return;
    }
    const body = await res.json() as { data?: unknown };
    logger.info({ result: body.data }, 'IPO status transitions applied');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'IPO status update trigger failed (non-fatal)'
    );
  }
}

/**
 * Trigger listed-company current-price updates (T-179). The dedicated
 * `listingPerformanceUpdate` scheduler job (`scheduler/jobs/listing-performance-update.ts`)
 * is defined but never deployed — `scraper/src/scheduler/index.ts` is not run
 * by PM2 (confirmed by T-176's 30-day scraper_logs measurement:
 * docs/monitoring/scrape-cadence-measurement.md). Calling the scraper
 * function directly here (same in-process call, not an HTTP round-trip like
 * triggerStatusUpdate — updateListingPerformance already lives in this
 * workspace) wires it into the path that actually runs in production, on the
 * same flat 30-min cadence as the other sources, gated by
 * `shouldRunListingPerformanceUpdate()` so it only fires as often as the
 * job's original market-hours/after-hours/weekends tiers intended.
 */
export async function triggerListingPerformanceUpdate(): Promise<void> {
  if (!shouldRunListingPerformanceUpdate(new Date())) {
    logger.debug('Listing performance update skipped (outside cadence window)');
    return;
  }
  try {
    const result = await updateListingPerformance();
    logger.info({ result }, 'Listing performance update triggered from one-shot cycle');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Listing performance update trigger failed (non-fatal)'
    );
  }
}

/**
 * Prune scraper_logs to the retention window so the table can't regrow to the
 * 515k-row / 115 MB bloat the crash-loop produced (GitHub #15 follow-up).
 * Runs each full cycle; non-fatal.
 */
async function pruneScraperLogs(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - SCRAPER_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await db.delete(scraperLogs).where(lt(scraperLogs.createdAt, cutoff)).returning({ id: scraperLogs.id });
    if (deleted.length > 0) {
      logger.info({ deleted: deleted.length, retentionDays: SCRAPER_LOG_RETENTION_DAYS }, 'Pruned old scraper_logs');
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'scraper_logs prune failed (non-fatal)'
    );
  }
}

// Run CLI (guarded so importing this module — e.g. from a test — doesn't
// trigger a live scrape; matches the pattern used by
// scrapers/listing-performance-updater.ts and the scripts/ CLIs).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
