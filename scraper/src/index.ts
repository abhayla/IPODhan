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
import { runDocumentCycle, runDocumentPurge, formatCycleReason } from './services/document-cycle.js';
import { shouldRunOnCatchUpCadence } from './scheduler/catch-up-cadence.js';
import { randomUUID } from 'crypto';
import { db, ScraperLogRepository, getRedisClient } from '@ipodhan/shared';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { scraperLogs, scraperSteps } from '@ipodhan/shared/db/schema';
import { lt } from 'drizzle-orm';
import logger from './utils/logger.js';
import { heartbeat, flushOwnerNotify } from './services/owner-notify.js';
import { evaluateFreshness } from './services/freshness-monitor.js';
import { checkDeployDrift, getMainShaFromOrigin, getServedShaForSlot } from './services/deploy-drift-monitor.js';
import { checkCrossSourceDisagreements } from './services/cross-source-disagreement-monitor.js';
import { getKeylessCoverage } from './services/keyless-coverage-monitor.js';
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
 * T-340: the ordered list of post-scrape steps run by the `--source=all`
 * cycle (main(), the `if (source === 'all')` block below). This is the
 * SSOT the step-ledger writer and the nightly audit's expected-step list
 * both derive from — never hand-typed a second time (docs/reviews/
 * detection-checks.json's `i_wire_or_retire` class is exactly what a
 * hand-typed duplicate list risks: a step added here and forgotten there).
 */
export const STEP_NAMES = [
  'statusUpdate',
  'registrarReresolve',
  'registrarHealthCheck',
  'listingPerformanceUpdate',
  'duplicateSweep',
  'stageReconciler',
  'primarySourceDiscovery',
  'documentPurge',
  'deployDriftMonitor',
  'pruneScraperLogs',
  'pruneDataConflicts',
  'dataQualityWatchdog',
  'heartbeat',
] as const;
export type StepName = typeof STEP_NAMES[number];

export type StepStatus = 'ok' | 'skipped' | 'failed';
// T-340 checker round-1 F1: a plain `{ status: StepStatus; reason?: string }`
// interface let a reasonless `{ status: 'skipped' }` type-check and pass all
// tests — the contract's "a skipped step MUST carry a reason" was a
// convention, not a guarantee. The discriminated union makes it a compile
// error instead: 'ok' may omit reason, 'skipped'/'failed' must not.
export type StepResult =
  | { status: 'ok'; reason?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * T-340: the runtime twin of the design-time "wire or retire" check
 * (docs/reviews/detection-checks.json `i_wire_or_retire`). Every post-scrape
 * step used to be a non-fatal try/catch that logged and returned void — a
 * cycle could exit 0 with a step silently skipped (e.g. ADMIN_API_TOKEN
 * unset) or silently failing every cycle, with nothing but a log line nobody
 * reads. This wrapper writes ONE row per step per cycle to `scraper_steps`
 * so the nightly audit can FAIL on silence (zero ok rows in 24h, or >=3
 * consecutive failures) instead of a human having to notice.
 *
 * The ledger write itself is non-fatal (redis-best-effort-fail-open.md /
 * non-fatal-side-effects.md discipline) — a DB hiccup while writing the
 * ledger must never fail the cycle or mask the step's own result from the
 * logger.
 */
async function runStep(cycleId: string, step: StepName, fn: () => Promise<StepResult>): Promise<void> {
  const start = Date.now();
  let result: StepResult;
  try {
    result = await fn();
  } catch (error) {
    result = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
  const durationMs = Date.now() - start;
  try {
    await db.insert(scraperSteps).values({
      cycleId,
      step,
      status: result.status,
      reason: result.reason ?? null,
      durationMs,
    });
  } catch (logError) {
    logger.error(
      { step, error: logError instanceof Error ? logError.message : String(logError) },
      'Failed to write step ledger row (non-fatal)'
    );
  }
}

/**
 * T-340 DoD item 3: the scraper refuses to START a `--source=all` cycle
 * (never runs any post-scrape step, exits non-zero, names the missing key)
 * when a required env var for that cycle is absent. Previously
 * `triggerStatusUpdate()` alone decided this at the point of use — a missing
 * `ADMIN_API_TOKEN` produced a silent per-step skip, not a startup failure,
 * so a cycle exited 0 with stale statuses and no alert (this task's data_source
 * note). Scoped to `source === 'all'` because that is the only path that runs
 * any post-scrape step; `--source=nse`/`bse`/etc. need none of these keys.
 */
// Exported so the drift guard in tests/unit/index-env-assert.test.ts can bind
// this runtime list to scripts/assert-env-keys.sh's deploy-time list — two
// hand-maintained lists in two languages is the exact drift class T-340 exists
// to kill.
//
// WEB_INTERNAL_URL is deliberately NOT here: it has a fallback
// ('http://localhost:3001') that is CORRECT on the prod box (the web app is
// pm2-served on 3001 there), so requiring it would break local `--source=all`
// runs for zero safety gain. It stays a deploy-time required key only.
export const REQUIRED_ENV_FOR_ALL_CYCLE: readonly string[] = ['ADMIN_API_TOKEN'];

export function assertRequiredEnvForCycle(source: string, env: NodeJS.ProcessEnv = process.env): void {
  if (source !== 'all') return;
  const missing = REQUIRED_ENV_FOR_ALL_CYCLE.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env var(s) for --source=all cycle: ${missing.join(', ')} — refusing to start ` +
      `(T-340: a missing ADMIN_API_TOKEN previously caused a silent per-step skip, not a startup failure)`
    );
  }
}

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

    // T-340: refuse to start a --source=all cycle without the env the
    // post-scrape steps need — see assertRequiredEnvForCycle's doc comment.
    assertRequiredEnvForCycle(source);

    // T-327 P2-7: make the process TZ observable at every run — this is what
    // let NSE dates land a day early for months (local-TZ new Date() parsing
    // combined with an unset/non-UTC process TZ on the Linux pm2 path, which
    // never reads ecosystem.config.js's TZ:'UTC'). The date-parse fix (see
    // scraper/src/utils/date-string-parsing.ts) no longer depends on this
    // value, but logging it turns a future TZ drift into a visible signal
    // instead of a silent one-day skew.
    logger.info(
      { processTz: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone },
      'Scraper process timezone at startup'
    );

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
      // T-309: NSE now reports segment counts too — was previously BSE-only.
      combinedResult.smeCount += nseResult.smeCount;
      combinedResult.mainboardCount += nseResult.mainboardCount;
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
      // T-309: Moneycontrol now reports segment counts too — was previously BSE-only.
      combinedResult.smeCount += moneycontrolResult.smeCount;
      combinedResult.mainboardCount += moneycontrolResult.mainboardCount;
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
      // T-309: Chittorgarh now reports segment counts too — was previously BSE-only.
      combinedResult.smeCount += chittorgarhResult.smeCount;
      combinedResult.mainboardCount += chittorgarhResult.mainboardCount;
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
      // T-340: cycleId links every step-ledger row this run writes so the
      // audit and any operator can see the whole cycle's shape together.
      const cycleId = randomUUID();
      await runStep(cycleId, 'statusUpdate', triggerStatusUpdate);
      await runStep(cycleId, 'registrarReresolve', triggerRegistrarReresolve);
      await runStep(cycleId, 'registrarHealthCheck', triggerRegistrarHealthCheck);
      await runStep(cycleId, 'listingPerformanceUpdate', triggerListingPerformanceUpdate);
      await runStep(cycleId, 'duplicateSweep', triggerDuplicateSweep);
      await runStep(cycleId, 'stageReconciler', triggerStageReconciler);
      await runStep(cycleId, 'primarySourceDiscovery', triggerPrimarySourceDiscovery);
      await runStep(cycleId, 'documentPurge', triggerDocumentPurge);
      await runStep(cycleId, 'deployDriftMonitor', triggerDeployDriftMonitor);
      await runStep(cycleId, 'pruneScraperLogs', pruneScraperLogs);
      await runStep(cycleId, 'pruneDataConflicts', pruneDataConflicts);
      // T-195: data-quality watchdog core (freshness SLO + cross-source
      // disagreement report). Selector-degradation runs per-source inside
      // BaseScraperOrchestrator.run() itself, not here. Non-fatal, same
      // pattern as the other post-scrape side effects above.
      await runStep(cycleId, 'dataQualityWatchdog', triggerDataQualityWatchdog);
      // T-194: job-completion heartbeat -- proves this cron cycle reached the
      // end of the pipeline (not that every source succeeded; source-level
      // failures are reported separately via AlertingService/notifyOwner).
      // Fires regardless of combinedResult.success, matching the other
      // non-fatal post-scrape side effects above.
      await runStep(cycleId, 'heartbeat', async () => { triggerHeartbeat(); return { status: 'ok' }; });
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
async function triggerStatusUpdate(): Promise<StepResult> {
  const baseUrl = process.env.WEB_INTERNAL_URL || 'http://localhost:3001';
  const token = process.env.ADMIN_API_TOKEN;
  if (!token) {
    // Unreachable in practice under --source=all: assertRequiredEnvForCycle
    // already refused to start the cycle without ADMIN_API_TOKEN (T-340).
    // Kept as a defensive skip (not a throw) for direct-call/test paths.
    logger.warn('ADMIN_API_TOKEN not set — skipping IPO status update');
    return { status: 'skipped', reason: 'ADMIN_API_TOKEN not set' };
  }
  try {
    const res = await fetch(`${baseUrl}/api/admin/status/update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'IPO status update returned non-OK');
      return { status: 'failed', reason: `status update endpoint returned HTTP ${res.status}` };
    }
    const body = await res.json() as { data?: unknown };
    logger.info({ result: body.data }, 'IPO status transitions applied');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'IPO status update trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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
export async function triggerListingPerformanceUpdate(): Promise<StepResult> {
  if (!shouldRunListingPerformanceUpdate(new Date())) {
    logger.debug('Listing performance update skipped (outside cadence window)');
    return { status: 'skipped', reason: 'outside cadence window' };
  }
  try {
    const result = await updateListingPerformance();
    logger.info({ result }, 'Listing performance update triggered from one-shot cycle');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Listing performance update trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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
export async function triggerRegistrarReresolve(): Promise<StepResult> {
  try {
    const result = await reresolveRegistrarIds({ dryRun: false });
    if (result.written > 0) {
      logger.info({ result }, 'registrar_id re-resolve pass wrote rows');
    }
    return { status: 'ok' };
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'registrar_id re-resolve pass failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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

export async function triggerRegistrarHealthCheck(): Promise<StepResult> {
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
    return { status: 'skipped', reason: 'outside cadence window, no catch-up due' };
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
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Registrar health check trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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

export async function triggerDuplicateSweep(): Promise<StepResult> {
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'duplicate-sweep', DUPLICATE_SWEEP_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Duplicate sweep skipped (outside catch-up cadence window)');
    return { status: 'skipped', reason: 'outside catch-up cadence window' };
  }
  try {
    const result = await runDuplicateSweepJob({ dryRun: true });
    logger.info({ result }, 'Duplicate sweep triggered from one-shot cycle (dry-run — report only)');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Duplicate sweep trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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

export async function triggerStageReconciler(): Promise<StepResult> {
  if (process.env.ENABLE_STAGE_RECONCILER !== 'true') {
    return { status: 'skipped', reason: 'ENABLE_STAGE_RECONCILER not true (§GATE)' };
  }
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'stage-reconciler', STAGE_RECONCILER_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Stage reconciler skipped (outside catch-up cadence window)');
    return { status: 'skipped', reason: 'outside catch-up cadence window' };
  }
  try {
    const result = await runStageReconcilerJob({ dryRun: true });
    logger.info({ result }, 'Stage reconciler triggered from one-shot cycle (dry-run — report only)');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Stage reconciler trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
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

export async function triggerPrimarySourceDiscovery(): Promise<StepResult> {
  if (process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY !== 'true') {
    return { status: 'skipped', reason: 'ENABLE_PRIMARY_SOURCE_DISCOVERY not true (§GATE)' };
  }

  // T-403 WP B. Two implementations behind one step, selected by a second flag,
  // so switching between them is one reversible env change and the state rows
  // survive the flip in either direction (matrix R13).
  if (process.env.ENABLE_DOCUMENT_STATE_MACHINE === 'true') {
    // PER-CYCLE, not daily. The daily cadence below exists only because the old
    // pass re-fetched NSE for every candidate IPO unconditionally; the state
    // machine makes a no-change cycle cost zero requests, so there is no reason
    // to wait a day to notice that a Prospectus has been filed.
    try {
      const summary = await runDocumentCycle();
      logger.info(summary, 'Document discovery cycle (state machine) complete');
      return { status: 'ok', reason: formatCycleReason(summary) };
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Document discovery cycle failed (non-fatal)'
      );
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'primary-source-discovery', PRIMARY_SOURCE_DISCOVERY_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Primary-source discovery skipped (outside catch-up cadence window)');
    return { status: 'skipped', reason: 'outside catch-up cadence window' };
  }
  try {
    await runPrimaryDocBackfill({ execute: true });
    logger.info('Primary-source discovery triggered from one-shot cycle');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Primary-source discovery trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * T-403 D4: delete local filing PDFs once `close_date +
 * PROSPECTUS_RETENTION_DAYS` (7) has passed, or on withdrawal. FILES ONLY —
 * every `documents` / `document_fetch_state` row and everything extracted from
 * the PDFs is retained. RHPs are 15-25 MB each and this project has already lost
 * prod's database, SSH and runner to a full disk once (2026-06-13), so the purge
 * runs in the same cycle as discovery rather than on a separate schedule that
 * could silently stop.
 */
export async function triggerDocumentPurge(): Promise<StepResult> {
  if (process.env.ENABLE_DOCUMENT_STATE_MACHINE !== 'true') {
    return { status: 'skipped', reason: 'ENABLE_DOCUMENT_STATE_MACHINE not true (§GATE)' };
  }
  try {
    const summary = await runDocumentPurge();
    return {
      status: 'ok',
      reason: `candidates=${summary.candidates} purged=${summary.purged} files=${summary.filesDeleted} bytes=${summary.bytesFreed}`,
    };
  } catch (error) {
    // Non-fatal: a purge failure must never fail the cycle.
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Document purge failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * T-324 ITEM 2 (MECHANISM-DUE 'automated-deploy-failing-unnoticed'): served-
 * SHA drift monitor. Same T-311 wire-or-retire pattern as the triggers
 * above -- `SchedulerService` is dead code in production, so this hooks
 * the one-shot cycle directly, cadence-gated to once an hour (the DoD's
 * own comparison window) via the SAME `catch-up-cadence.ts` guard the
 * other jobs use -- no second scheduler/cron is registered.
 */
const DEPLOY_DRIFT_INTERVAL_MINUTES = 60;

export async function triggerDeployDriftMonitor(): Promise<StepResult> {
  const redis = getRedisClient();
  const shouldRun = await shouldRunOnCatchUpCadence(redis, 'deploy-drift-monitor', DEPLOY_DRIFT_INTERVAL_MINUTES);
  if (!shouldRun) {
    logger.debug('Deploy drift monitor skipped (outside catch-up cadence window)');
    return { status: 'skipped', reason: 'outside catch-up cadence window' };
  }
  try {
    const results = await checkDeployDrift({
      getMainSha: getMainShaFromOrigin,
      getServedSha: getServedShaForSlot,
      redis,
    });
    logger.info({ results }, 'Deploy drift monitor triggered from one-shot cycle');
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Deploy drift monitor trigger failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * T-195: data-quality watchdog core, run once per full `--source=all` cycle.
 * Evaluates the freshness SLOs (freshness-slo.ts) against `scraper_logs`
 * (the same source `/api/admin/scraper/status` reads), reports cross-source
 * disagreements for OPEN IPOs (cross-source-disagreement-monitor.ts,
 * extending the existing data_conflicts subsystem), and (T-318) reports the
 * keyless-coverage metric (keyless-coverage-monitor.ts — rows with neither
 * symbol nor isin, relying on name-based identity matching). All three
 * checks are independently non-fatal — a failure in one must not skip the
 * others or fail the scrape (non-fatal-side-effects.md).
 */
async function triggerDataQualityWatchdog(): Promise<StepResult> {
  const failures: string[] = [];

  try {
    const redis = getRedisClient();
    const scraperLogRepository = new ScraperLogRepository(db, redis);
    await evaluateFreshness(scraperLogRepository);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error({ error: reason }, 'Freshness SLO evaluation failed (non-fatal)');
    failures.push(`freshness: ${reason}`);
  }

  try {
    await checkCrossSourceDisagreements(db);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error({ error: reason }, 'Cross-source disagreement check failed (non-fatal)');
    failures.push(`cross-source: ${reason}`);
  }

  // T-318 (ITEM 2): keyless-coverage metric — how many `ipos` rows have
  // neither a symbol nor an isin, i.e. rely on name-based identity matching
  // as the fallback tail of resolveIpoRow's priority chain. Reporting only;
  // does not change resolution behavior. Non-fatal, same pattern as the two
  // checks above.
  try {
    const report = await getKeylessCoverage(db);
    logger.info(
      {
        totalCount: report.totalCount,
        keylessCount: report.keylessCount,
        keylessPct: report.keylessPct,
      },
      'Keyless IPO coverage (rows with neither symbol nor isin)'
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error({ error: reason }, 'Keyless-coverage metric failed (non-fatal)');
    failures.push(`keyless-coverage: ${reason}`);
  }

  return failures.length === 0 ? { status: 'ok' } : { status: 'failed', reason: failures.join('; ') };
}

/**
 * Prune scraper_logs to the retention window so the table can't regrow to the
 * 515k-row / 115 MB bloat the crash-loop produced (GitHub #15 follow-up).
 * Runs each full cycle; non-fatal.
 */
async function pruneScraperLogs(): Promise<StepResult> {
  try {
    const cutoff = new Date(Date.now() - SCRAPER_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await db.delete(scraperLogs).where(lt(scraperLogs.createdAt, cutoff)).returning({ id: scraperLogs.id });
    if (deleted.length > 0) {
      logger.info({ deleted: deleted.length, retentionDays: SCRAPER_LOG_RETENTION_DAYS }, 'Pruned old scraper_logs');
    }
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'scraper_logs prune failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Prune RESOLVED data_conflicts rows past the retention window (T-286, P2-3:
 * mirrors pruneScraperLogs() above -- data_conflicts had no prune at all,
 * growing unbounded because every disagreement re-inserted a fresh row and
 * resolvedAt was never set for the auto/system-detected cases). Runs each
 * full cycle; non-fatal. Never deletes an unresolved row.
 */
async function pruneDataConflicts(): Promise<StepResult> {
  try {
    const redis = getRedisClient();
    const dataConflictsRepository = new DataConflictsRepository(db, redis);
    const deletedCount = await dataConflictsRepository.pruneResolved(DATA_CONFLICTS_RETENTION_DAYS);
    if (deletedCount > 0) {
      logger.info({ deletedCount, retentionDays: DATA_CONFLICTS_RETENTION_DAYS }, 'Pruned resolved data_conflicts');
    }
    return { status: 'ok' };
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'data_conflicts prune failed (non-fatal)'
    );
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

// Run CLI (guarded so importing this module — e.g. from a test — doesn't
// trigger a live scrape; matches the pattern used by
// scrapers/listing-performance-updater.ts and the scripts/ CLIs).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
