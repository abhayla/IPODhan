#!/usr/bin/env node

// CRITICAL: Load environment variables FIRST before any imports that use them
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'url';
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
import { runRegistrarHealthCheck } from './scheduler/jobs/registrar-health-check-job.js';
import { shouldRunRegistrarHealthCheck } from './scheduler/registrar-health-check-cadence.js';
import { reresolveRegistrarIds } from './services/registrar-reresolve.js';
import { runDuplicateSweepJob } from './scheduler/jobs/duplicate-sweep-job.js';
import { runStageReconcilerJob } from './scheduler/jobs/stage-reconciler-job.js';
import { runPrimaryDocBackfill } from './scripts/backfill-primary-source-documents.js';
import { shouldRunOnCatchUpCadence } from './scheduler/catch-up-cadence.js';
import { db, ScraperLogRepository, getRedisClient } from '@ipodhan/shared';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { scraperLogs } from '@ipodhan/shared/db/schema';
import { lt } from 'drizzle-orm';
import logger from './utils/logger.js';
import { heartbeat, flushOwnerNotify } from './services/owner-notify.js';
import { evaluateFreshness } from './services/freshness-monitor.js';
import { checkCrossSourceDisagreements } from './services/cross-source-disagreement-monitor.js';
import { validateFeatureFlags, getFeatureStatus } from './config/feature-flags.js';

/** Days of scraper_logs history to retain. */
const SCRAPER_LOG_RETENTION_DAYS = 30;

/** Days of RESOLVED data_conflicts history to retain (T-286, mirrors scraper_logs). */
const DATA_CONFLICTS_RETENTION_DAYS = 30;

/**
 * Notifier heartbeat name for this cycle (matches `projects.ipodhan.heartbeats`
 * in Notifier's config.yaml -- see docs/monitoring/scrape-cadence-measurement.md
 * and this PR's DEPLOY-AND-RE-ARM section for the Notifier-side re-arm).
 */
const HEARTBEAT_NAME = 'watchdog';

/**
 * T-194: the `source === 'all'` cycle is the ONLY scraper process PM2 runs
 * (docs/monitoring/scrape-cadence-measurement.md measured a flat 30-minute
 * cron_restart cadence -- see pm2-scheduled-one-shot-scraper.md), never the
 * undeployed IST market-hour tiers. The heartbeat interval MUST match that
 * measured reality, not a config-file default.
 */
const HEARTBEAT_INTERVAL_MINUTES = 30;

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

    // T-283: loud, LOUD feature-flag visibility at every run start.
    // validateFeatureFlags() (console.warn) fires exactly when a boolean
    // ENABLE_* flag is on but its paired *_PERCENTAGE rollout is still 0% —
    // the dead-fallback-path shape that let CONSOLIDATION_PERCENTAGE ship
    // unset for the pipeline's entire production lifetime (T-282/T-283) with
    // zero visibility, because this function was defined but never called
    // from anywhere. Also emit the flag snapshot through the structured pino
    // logger so it is queryable in scraper-out.log JSON on every cycle, not
    // just readable as console text.
    try {
      validateFeatureFlags();
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Feature flag validation failed — refusing to start with an invalid percentage flag'
      );
      throw error;
    }
    logger.info(getFeatureStatus(), 'Feature flag status at scraper startup');

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
      await triggerRegistrarReresolve();
      await triggerRegistrarHealthCheck();
      await triggerListingPerformanceUpdate();
      await triggerDuplicateSweep();
      await triggerStageReconciler();
      await triggerPrimarySourceDiscovery();
      await pruneScraperLogs();
      await pruneDataConflicts();
      // T-195: data-quality watchdog core (freshness SLO + cross-source
      // disagreement report). Selector-degradation runs per-source inside
      // BaseScraperOrchestrator.run() itself, not here. Non-fatal, same
      // pattern as the other post-scrape side effects above.
      await triggerDataQualityWatchdog();
      // T-194: job-completion heartbeat -- proves this cron cycle reached the
      // end of the pipeline (not that every source succeeded; source-level
      // failures are reported separately via AlertingService/notifyOwner).
      // Fires regardless of combinedResult.success, matching the other
      // non-fatal post-scrape side effects above.
      triggerHeartbeat();
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

    // Exit with appropriate code. Flush any in-flight Notifier sends first --
    // process.exit() would otherwise abort the heartbeat/alert fetch mid-air
    // (fire-and-forget promises don't get to run to completion after exit).
    if (combinedResult.success) {
      logger.info('Scraper completed successfully');
      await flushOwnerNotify();
      process.exit(0);
    } else {
      logger.error('Scraper completed with errors');
      if (combinedResult.errors.length > 0) {
        logger.error({ errors: combinedResult.errors }, 'Error details');
      }
      await flushOwnerNotify();
      process.exit(1);
    }

  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scraper CLI failed with unhandled error'
    );
    await flushOwnerNotify();
    process.exit(1);
  }
}

/**
 * T-194: fire-and-forget job-completion heartbeat to the Notifier gateway
 * (see services/owner-notify.ts). Non-fatal side effect -- a Notifier outage
 * or missing env config must never fail the scrape (redis-best-effort /
 * non-fatal-side-effects discipline). The caller flushes before process.exit().
 */
function triggerHeartbeat(): void {
  try {
    heartbeat(HEARTBEAT_NAME, HEARTBEAT_INTERVAL_MINUTES);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Notifier heartbeat trigger failed (non-fatal)'
    );
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
 * Re-resolve `ipos.registrar_id` for rows left NULL by the scraper write path
 * (T-300F, fixing T-300C finding F2). `registrar_id` is never written at
 * scrape time (see `registrar-reresolve.ts` header), so new IPOs created
 * since the last pass need periodic retrying as the registrars table grows.
 *
 * The original PR piggybacked this on `runStatusUpdater()`
 * (`scheduler/jobs/update-statuses.ts`) — a job that only exists inside
 * `SchedulerService`, which production never imports (same T-179/T-176 dead
 * path as `registrar-health-check-job.ts`; see the comment on
 * `triggerListingPerformanceUpdate` below). This wires the SAME non-fatal
 * pass onto the path prod actually runs instead: right after
 * `triggerStatusUpdate()` in this one-shot `--source=all` cycle. It is a
 * cheap DB-only pass (no outbound HTTP), so it runs every cycle rather than
 * being cadence-gated like the registrar health check.
 */
export async function triggerRegistrarReresolve(): Promise<void> {
  try {
    const result = await reresolveRegistrarIds({ dryRun: false });
    if (result.written > 0) {
      logger.info({ result }, 'registrar_id re-resolve pass wrote rows');
    }
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'registrar_id re-resolve pass failed (non-fatal)'
    );
  }
}

/**
 * Run the daily registrar allotment-URL health check (T-300F, fixing T-300C
 * finding F1). `runRegistrarHealthCheck()` was only ever registered in
 * `SchedulerService.init()` (`scheduler.ts`, cron `'30 6 * * *'` IST), but
 * production runs the one-shot `--source=all` CLI on a flat 30-minute
 * `cron_restart` and never imports `SchedulerService` — the repo's own
 * T-179/T-176 comments document this exact trap
 * (`docs/monitoring/scrape-cadence-measurement.md`). Calling the job function
 * directly here (in-process, same pattern as `triggerListingPerformanceUpdate`
 * below) wires it into the path that actually runs in production, gated by
 * `shouldRunRegistrarHealthCheck()` so the ~19 sequential outbound fetches
 * fire once daily (matching the scheduler's original cron intent) instead of
 * every 30-minute cycle.
 */
// T-306 (T-300C2 advisory): persisted last-run timestamp so a missed 06:30-06:59
// IST window (a slow prior cycle, a restart, a missed cron_restart tick) is
// caught up on the next cycle instead of silently skipping the whole day —
// see shouldRunRegistrarHealthCheck's catch-up semantics. Redis is
// best-effort (redis-best-effort-fail-open.md): if the key can't be read, we
// pass `null` (treated as "no confirmed run" -> catch-up now, the safe
// default) rather than block or crash the cycle.
const REGISTRAR_HEALTH_CHECK_LAST_RUN_KEY = 'registrar-health-check:last-run';

export async function triggerRegistrarHealthCheck(): Promise<void> {
  const now = new Date();
  let lastRunAt: Date | null = null;
  try {
    const redis = getRedisClient();
    const raw = await redis.get(REGISTRAR_HEALTH_CHECK_LAST_RUN_KEY);
    lastRunAt = raw ? new Date(raw) : null;
    if (lastRunAt !== null && Number.isNaN(lastRunAt.getTime())) lastRunAt = null;
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'Registrar health check last-run lookup failed (non-fatal) - treating as catch-up eligible'
    );
  }

  if (!shouldRunRegistrarHealthCheck(now, lastRunAt)) {
    logger.debug('Registrar health check skipped (outside cadence window, no catch-up due)');
    return;
  }
  try {
    const result = await runRegistrarHealthCheck();
    logger.info({ result }, 'Registrar health check triggered from one-shot cycle');
    try {
      const redis = getRedisClient();
      // No TTL: this key MUST survive indefinitely so a long gap (outage,
      // deploy freeze) is still detected as catch-up-eligible on return.
      await redis.set(REGISTRAR_HEALTH_CHECK_LAST_RUN_KEY, now.toISOString());
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Registrar health check last-run persist failed (non-fatal)'
      );
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Registrar health check trigger failed (non-fatal)'
    );
  }
}

/**
 * P2-2b (T-293) / T-311: periodic duplicate-IPO cluster sweep. Was only ever
 * registered in `SchedulerService` (`scheduler.ts`, cron `'30 4 * * *'`
 * IST), which production never imports — the same T-179/T-176 dead-path
 * trap as the registrar health check above. Wires the SAME dry-run-only
 * sweep (report/log a duplicate-cluster plan; NEVER deletes — actual
 * merge/delete stays §GATE, `dryRun: false` is never passed here) onto the
 * path prod actually runs, gated by a last-run catch-up cadence (not a
 * wall-clock window — see `catch-up-cadence.ts`) so the full-table scan
 * fires roughly once a day, matching the original schedule's intent.
 */
const DUPLICATE_SWEEP_INTERVAL_MINUTES = 24 * 60;

export async function triggerDuplicateSweep(): Promise<void> {
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'duplicate-sweep', DUPLICATE_SWEEP_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Duplicate sweep skipped (outside catch-up cadence window)');
    return;
  }
  try {
    const result = await runDuplicateSweepJob({ dryRun: true });
    logger.info({ result }, 'Duplicate sweep triggered from one-shot cycle (dry-run — report only)');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Duplicate sweep trigger failed (non-fatal)'
    );
  }
}

/**
 * Stage F stage-transition reconciler (T-311). Was only ever registered in
 * `SchedulerService` (cron "every 3 hours" IST), gated OFF by
 * `ENABLE_STAGE_RECONCILER` (§GATE — activation is Abhay's call per
 * `owner-gated-feature-flags.md`). Wires the SAME dry-run-only reconciler
 * (computes + logs the due-but-missing fetch plan; enqueue/trigger stays a
 * documented no-op — see `stage-reconciler-job.ts`) onto the path prod
 * actually runs, so the flag has a real consumer the moment Abhay flips it,
 * gated by both the flag AND a last-run catch-up cadence matching the
 * original 3-hour schedule intent.
 */
const STAGE_RECONCILER_INTERVAL_MINUTES = 3 * 60;

export async function triggerStageReconciler(): Promise<void> {
  if (process.env.ENABLE_STAGE_RECONCILER !== 'true') {
    return;
  }
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'stage-reconciler', STAGE_RECONCILER_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Stage reconciler skipped (outside catch-up cadence window)');
    return;
  }
  try {
    const result = await runStageReconcilerJob({ dryRun: true });
    logger.info({ result }, 'Stage reconciler triggered from one-shot cycle (dry-run — report only)');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Stage reconciler trigger failed (non-fatal)'
    );
  }
}

/**
 * T-311, closing #213 / T-305 P2-2: `ENABLE_PRIMARY_SOURCE_DISCOVERY` had NO
 * consumer anywhere in the running entrypoint — only a manual backfill
 * script (`backfill-primary-source-documents.ts`) existed, never invoked
 * automatically. The owner's 2026-08-23 order to turn the flag on in prod
 * was therefore a no-op: the flag changed nothing, and the "two clean
 * cycles" hold-test the owner was told about could not have failed.
 *
 * This wires a REAL consumer: with the flag true, this one-shot cycle runs
 * the NSE primary-source document discovery pass for every open/upcoming/
 * closed IPO with an NSE symbol and upserts discovered documents via
 * `DocumentRepository.upsertDocument` (`documents` table — idempotent,
 * dedups by URL; NEVER a raw `db.insert`). With the flag false (today's
 * live prod state), nothing runs — restoring the honesty gap #213 flagged.
 * Cadence-gated to once daily (matching the script's own "backfill" nature
 * — one full NSE issue-info fetch per candidate IPO is not a per-cycle
 * operation) via the same last-run catch-up guard as the jobs above.
 */
const PRIMARY_SOURCE_DISCOVERY_INTERVAL_MINUTES = 24 * 60;

export async function triggerPrimarySourceDiscovery(): Promise<void> {
  if (process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY !== 'true') {
    return;
  }
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'primary-source-discovery', PRIMARY_SOURCE_DISCOVERY_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Primary-source discovery skipped (outside catch-up cadence window)');
    return;
  }
  try {
    await runPrimaryDocBackfill({ execute: true });
    logger.info('Primary-source discovery triggered from one-shot cycle');
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Primary-source discovery trigger failed (non-fatal)'
    );
  }
}

/**
 * T-195: data-quality watchdog core, run once per full `--source=all` cycle.
 * Evaluates the freshness SLOs (freshness-slo.ts) against `scraper_logs`
 * (the same source `/api/admin/scraper/status` reads) and reports
 * cross-source disagreements for OPEN IPOs (cross-source-disagreement-monitor.ts,
 * extending the existing data_conflicts subsystem). Both halves are
 * independently non-fatal — a failure in one must not skip the other or fail
 * the scrape (non-fatal-side-effects.md).
 */
async function triggerDataQualityWatchdog(): Promise<void> {
  try {
    const redis = getRedisClient();
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    await evaluateFreshness(scraperLogRepository);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Freshness SLO evaluation failed (non-fatal)'
    );
  }

  try {
    await checkCrossSourceDisagreements(db);
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Cross-source disagreement check failed (non-fatal)'
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

/**
 * Prune RESOLVED data_conflicts rows past the retention window (T-286, P2-3:
 * mirrors pruneScraperLogs() above -- data_conflicts had no prune at all,
 * growing unbounded because every disagreement re-inserted a fresh row and
 * resolvedAt was never set for the auto/system-detected cases). Runs each
 * full cycle; non-fatal. Never deletes an unresolved row.
 */
async function pruneDataConflicts(): Promise<void> {
  try {
    const redis = getRedisClient();
    const dataConflictsRepository = new DataConflictsRepository(db, redis);
    const deletedCount = await dataConflictsRepository.pruneResolved(DATA_CONFLICTS_RETENTION_DAYS);
    if (deletedCount > 0) {
      logger.info({ deletedCount, retentionDays: DATA_CONFLICTS_RETENTION_DAYS }, 'Pruned resolved data_conflicts');
    }
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'data_conflicts prune failed (non-fatal)'
    );
  }
}

// Run CLI (guarded so importing this module — e.g. from a test — doesn't
// trigger a live scrape; matches the pattern used by
// scrapers/listing-performance-updater.ts and the scripts/ CLIs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
