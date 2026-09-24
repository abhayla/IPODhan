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
import { runChittorgarhScraper } from './scrapers/chittorgarh-orchestrator-v2.js';
import {
  runIssueTypeFillJob,
  makeIssueTypeJobDeps,
} from './services/chittorgarh-issue-type-job.js';
import { HUNG_PROCESS_CEILING_MS, EXTRACTOR_VERSION } from './services/filing-auto-persist.js';
import { makeIpoDetailsWriter } from './services/filing-persist-deps.js';
import { FieldSourcesRepository, filterProtectedFields } from '@ipodhan/shared';
import { runInvestorgainGMPScraper } from './scrapers/investorgain-gmp-orchestrator-v2.js';
import { updateListingPerformance } from './scrapers/listing-performance-updater.js';
import { shouldRunListingPerformanceUpdate } from './scheduler/listing-performance-cadence.js';
import { runRegistrarHealthCheck } from './scheduler/jobs/registrar-health-check-job.js';
import { shouldRunRegistrarHealthCheck } from './scheduler/registrar-health-check-cadence.js';
import { reresolveRegistrarIds } from './services/registrar-reresolve.js';
import { runDuplicateSweepJob } from './scheduler/jobs/duplicate-sweep-job.js';
import { runStageReconcilerJob } from './scheduler/jobs/stage-reconciler-job.js';
import { runPrimaryDocBackfill, withTimeout } from './scripts/backfill-primary-source-documents.js';
import { triggerPageRevalidation } from './services/page-revalidation-trigger.js';
import { CLI_SOURCE_ARGS } from './config/runnable-sources.js';
import {
  runDocumentCycle,
  runDocumentPurge,
  formatCycleReason,
  releaseHeldLocks,
  getWakeBudgetMs,
} from './services/document-cycle.js';
import { raceWithTimeout, DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS } from './utils/race-with-timeout.js';
import { shouldRunOnCatchUpCadence, isCatchUpCadenceDue, markCatchUpCadenceRan } from './scheduler/catch-up-cadence.js';
import { isDiscoveryDue, isBiddingHoursIST, mostRecentDiscoverySlotLabel } from './scheduler/due-step-cycle.js';
import { mostRecentDataJobSlotBoundary } from '@ipodhan/shared/scheduler/data-job-slots';
import { runDemandBackfill } from './scripts/backfill-demand-graph.js';
import { DistributedLock } from './utils/distributed-lock.js';
import {
  runClosedIpoJob,
  isClosedIpoJobDue,
  resourceClosedIpo,
  closedIpoResourcingVersion,
  CLOSED_IPO_JOB_SLOT_IST_MINUTES,
} from './scheduler/closed-ipo-job.js';
import { writeFieldSourcesSnapshot } from './scheduler/closed-ipo-snapshot.js';
import { iposOpeningToday, OPENING_DAY_CHECK_TIME_IST_MINUTES } from './scheduler/opening-day-check.js';
import { runOpeningDayDiscovery, createOpeningDayWriter } from './scheduler/opening-day-discovery.js';
import { fetchCurrentIssueList } from './scrapers/nse-api-client.js';
import { fetchBSEBoard } from './scrapers/bse-api-scraper.js';
import {
  createFieldProtectionService,
  resolveIpoRow,
  inferBoundVia,
  SOURCE_KEY_NO_WRITE_ERROR_NAMES,
} from '@ipodhan/shared';
import { withSourceKeyLineage } from '@ipodhan/shared/repositories';
import { ListingPerformanceRepository as OpeningDayListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { DataConsolidationOrchestrator } from './services/data-consolidation-orchestrator.js';
import { normalizeCompanyNameForMatching, computeIpoIdentitySlug } from './services/data-persister.js';
import type { ClosedIpoResourceResult } from './scheduler/closed-ipo-job.js';
import { readPlanSettlement } from './scheduler/closed-ipo-plan-settlement.js';
import { plantFieldPlanForIpo } from './services/field-plan-planting.js';
import { walkFieldPlanForIPO } from './services/field-plan-walk.js';
import { fieldManifestFingerprint } from '@ipodhan/shared/utils/field-manifest-fingerprint';
import {
  buildFieldPlanWalkOrchestrator,
  buildFieldPlanWalkFetchers,
  buildFieldPlanGapKeySource,
  buildFieldPlanWalkWitnessVerdictWriter,
} from './services/field-plan-walk-deps.js';
import { createFieldSourceOverridesReader } from './config/field-source-overrides-reader.js';
import { IPORepository, IpoFieldPlanRepository } from '@ipodhan/shared';
import { FieldSourceOverridesRepository } from '@ipodhan/shared/repositories/field-source-overrides-repository';
import { randomUUID, createHash } from 'crypto';
import { db, ScraperLogRepository, getRedisClient } from '@ipodhan/shared';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { scraperLogs, scraperSteps, ipos, ipoFieldPlan } from '@ipodhan/shared/db/schema';
import { lt, inArray, count, eq } from 'drizzle-orm';
import logger from './utils/logger.js';
import { heartbeat, flushOwnerNotify } from './services/owner-notify.js';
import { evaluateFreshness } from './services/freshness-monitor.js';
import { checkDeployDrift, getMainShaFromOrigin, getServedShaForSlot } from './services/deploy-drift-monitor.js';
import { checkCrossSourceDisagreements } from './services/cross-source-disagreement-monitor.js';
import { getKeylessCoverage } from './services/keyless-coverage-monitor.js';
import { FEATURE_FLAGS, validateFeatureFlags, getFeatureStatus } from './config/feature-flags.js';
import { loadFieldManifest, DEFAULT_MANIFEST_PATH } from './config/field-manifest-loader.js';
import { loadSwitchover, DEFAULT_SWITCHOVER_PATH } from './config/switchover.js';
import { readFileSync as readManifestFileSync, realpathSync } from 'fs';
import { loadValidationRules } from './config/validation-rules-loader.js';

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
 *
 * Item 7 S3: `closedIpoJob` is REMOVED from this list. It is no longer a
 * post-step of the data cycle — it now runs as its own `--job=closed`
 * process under the `scraper:cycle` lock (`runClosedIpoWake`, above), so a
 * data wake at 22:00 does not also run it (item 2 of the S3 build).
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
  'pageRevalidation',
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
 * S-02 §5 (`ENABLE_DUE_STEP_SCHEDULER`): resource id for the whole-cycle Redis
 * lock. PM2's `cron_restart` (every 30 minutes) FORCE-RESTARTS the process --
 * it does not wait for the current cycle to finish -- so a cycle
 * that runs long (discovery + live + aggregators can all fire on the same
 * invocation) can overlap with the next one unless something refuses to start
 * a second cycle while the first is still in flight.
 *
 * Round-3 M1 (Tier-A review of round 1): the TTL used to be 55 minutes —
 * LONGER than the 30-minute PM2 restart interval — so a cycle killed by the
 * restart left a lock nobody would release for up to 25 minutes, and the NEXT
 * cycle exited 0 doing nothing. That is the opposite of self-healing. The TTL
 * is now 25 minutes (shorter than the restart interval, so a killed cycle's
 * lock is always gone before the next cycle starts) and a live cycle EXTENDS
 * it every 5 minutes, so a legitimately long cycle keeps its lock while a dead
 * one loses it. A SIGTERM/SIGINT handler releases it immediately — PM2 sends
 * SIGTERM before SIGKILL, so the normal restart path frees the lock at once.
 */
const CYCLE_LOCK_RESOURCE = 'scraper:cycle';
/**
 * Cadence D-13 / cycle-overrun RCA: the document cycle's discovery+extraction
 * work now shares ONE wake budget (`getWakeBudgetMs()`,
 * `DOCUMENT_CYCLE_WAKE_BUDGET_MS`, default 20 min — `document-cycle.ts`), so
 * the lock TTL is derived from that SAME budget plus 5 minutes of slack,
 * rather than a separately-hardcoded number that could silently drift out of
 * sync with it. This keeps the round-3 M1 invariant (TTL shorter than PM2's
 * 30-minute restart, so a killed cycle's lock is always gone before the next
 * cycle starts) while guaranteeing the TTL is always >= the longest a
 * legitimate cycle can now run.
 */
/**
 * Item 7 slice 1 (Tier A review CRITICAL 4): this TTL used to be
 * `getWakeBudgetMs() + 5 min` (= 25 min), and the comment above says plainly
 * WHY: "deliberately SHORTER than PM2's 30-minute restart". That restart is
 * exactly what this slice deletes - the scraper is no longer force-killed at
 * 30 minutes, it is bounded by the wake wrapper's 2-hour hung-process ceiling
 * (OD-55). A TTL sized against a restart that no longer exists is a broken
 * invariant: during the very hang the ceiling is meant to bound, the lock
 * would expire at 25 minutes and a second cycle could start on top of the
 * first.
 *
 * It is less severe than "any 2-hour job loses its lock", because a live cycle
 * extends the lock every CYCLE_LOCK_EXTEND_INTERVAL_MS (5 min), so a healthy
 * long job keeps it. The TTL only lapses when the extender STOPS - which is
 * precisely the hung case. That is the window being closed here.
 *
 * So the TTL is now the ceiling plus slack, and the invariant is restated:
 * the lock outlives any run the ceiling permits, and the CEILING (not a lock
 * expiry) is what ends a hung cycle. The slack covers the gap between the
 * ceiling's SIGTERM and the wrapper's SIGKILL backstop (60s) plus the
 * signal-handler lock release (W-140).
 *
 * Keep this >= the wrapper's SCRAPER_CEILING_SECONDS in scripts/scraper-wake.sh.
 */
/**
 * EXPORTED so tests assert the RELATIONSHIP against the one definition
 * instead of re-typing the number. The 25-minute value used to live as a
 * literal in three separate files; two were updated when the TTL was raised
 * and the third (index-due-step-scheduler-wiring.test.ts) was missed, turning
 * CI red. A literal copied into a test is a second source of truth that goes
 * stale silently. The TTL is defined once HERE; the CEILING it derives from is
 * defined once in filing-auto-persist.ts and imported above - this file does
 * NOT redeclare it. (An earlier version of this comment claimed "exactly one
 * here and every other reader imports it", which was true WITHIN this file and
 * false ACROSS the two - the ceiling existed three times, counting the shell
 * wrapper. scripts/tests/scraper-wake.test.sh case 15 guards the shell copy,
 * which cannot import a TS constant across the language boundary.)
 */
// Re-exported, NOT redeclared. OD-55 defines the 2-hour ceiling ONCE and its
// honest home is filing-auto-persist.ts, where the document-extraction
// semantics live. This file imports it so a future revision of OD-55 (two
// hours is a fresh decision that could move) changes ONE number. The
// re-export keeps existing importers of CYCLE_LOCK_CEILING_MS working.
export const CYCLE_LOCK_CEILING_MS = HUNG_PROCESS_CEILING_MS;
export const CYCLE_LOCK_TTL_MS = CYCLE_LOCK_CEILING_MS + 5 * 60 * 1000;
const CYCLE_LOCK_EXTEND_INTERVAL_MS = 5 * 60 * 1000;

/** Redis key tracking the last discovery (NSE+BSE) run, for the data job's 3-slot/day catch-up cadence (OD-19). */
const DISCOVERY_LAST_RUN_KEY = 'due-step:last-discovery';

/** Aggregator refresh (Chittorgarh) cadence: at most once per day. */
const AGGREGATOR_INTERVAL_MINUTES = 24 * 60;

/**
 * Round-3 C3: the IPO Alerts API fallback source. Under the due-step scheduler
 * the legacy per-source blocks are skipped for 'all', and round 1 forgot to
 * re-home this one — with the flag on it never ran at all. It is a
 * low-frequency, rate-limited backstop, so it belongs on a once-a-day cadence
 * inside the cycle, stamped only AFTER a successful run (M2).
 */
const API_FALLBACK_CADENCE_KEY = 'due-step-api-fallback';
const API_FALLBACK_INTERVAL_MINUTES = 24 * 60;
const AGGREGATOR_CADENCE_KEY = 'due-step-aggregators';

/**
 * Item 2 slice 7 gets its OWN cadence key, deliberately.
 *
 * It shares the aggregator's 24-hour interval but NOT its key. Round 2 of the
 * Tier A review caught the reason: I had gated the shared aggregator stamp on
 * `cgOk && fillOk`, so ONE failed row out of 231 - a single transient deadlock -
 * left the whole branch un-stamped and re-ran the Chittorgarh SCRAPE and the
 * report fetch on every 30-minute wake, roughly 48 times a day against a
 * third-party source. Worse, it was dated: on 1 Jan 2027 CURRENT_YEAR flips, the
 * new financial year's report drops below the row floor, and the hammering would
 * have run for weeks. Fixing a one-day retry suppression by inventing a
 * permanent retry storm is a bad trade.
 *
 * Separate keys give each step the retry discipline it actually needs: the
 * scrape stamps on its own result, the fill stamps on its own.
 */
const ISSUE_TYPE_FILL_CADENCE_KEY = 'due-step-issue-type-fill';

/**
 * Round-3 H2: what a due-step cycle reports back to `main()`. Round 1 swallowed
 * every failure inside the cycle (each step had its own `catch` that only
 * logged) and returned void, so a cycle in which NSE threw still exited 0 —
 * invisible to PM2, to the exit-code-based alerting, and to anyone reading
 * `scraper_logs`. The cycle still does not ABORT on one step's failure (the
 * other steps are independent and should still run), but every failure is now
 * accumulated and the cycle reports `success: false`, exactly like the legacy
 * path's `combinedResult`.
 */
interface DueStepCycleResult {
  success: boolean;
  errors: string[];
}

async function countIposByStatus(statuses: readonly ('UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED')[]): Promise<number> {
  // NOTE (bug found + fixed during the S-02 §5 live proof run, 2026-09-03):
  // the first version of this helper used `sql\`status = ANY(${statuses})\``
  // (a raw drizzle sql tagged template) — drizzle renders an array parameter
  // as a row-value tuple `($1, $2)`, and `ANY(($1, $2))` is invalid Postgres
  // syntax for the ANY() array form, so the query threw on every call and
  // silently fell back to "treat as non-zero" (fail-open-on-freshness). The
  // query builder's `inArray()` renders a proper `IN ($1, $2)` and is the
  // correct tool for a fixed status list — never hand-roll `ANY($1)` here.
  const [row] = await db.select({ c: count() }).from(ipos).where(inArray(ipos.status, statuses));
  return row ? Number(row.c) : 0;
}

/**
 * Item 7 S1 (spec docs/design/data-sourcing-pull-model.md §2.1 "The two locks",
 * OD-27): the live-figures job's OWN lock. The owner's rule: "The live figures
 * job should have its own lock ... The data job must never block the live
 * figures." A data job may legitimately hold `scraper:cycle` for up to the
 * 2-hour hung-process ceiling (OD-55) reading one large document; under one
 * lock the subscription figure on a closing day would stand still for all of
 * it. The live job therefore never reads, takes or waits on `scraper:cycle`.
 *
 * TTL 4 minutes: the spec's number for the `live` lock (§2.1 table). A live run
 * is a handful of HTTP reads, so 4 minutes is well past a healthy run and far
 * inside the 30-minute cadence.
 *
 * NO renewal (item 7 S1 round 1, Tier A finding): renewing every minute kept
 * `scraper:live` held for as long as a HUNG process lived — up to the wake
 * wrapper's ceiling — so every live wake in between skipped and the figure on a
 * closing day stood still, the exact failure OD-27 exists to prevent. Instead
 * the job carries a hard in-process deadline INSIDE the 4-minute TTL: at
 * LIVE_JOB_DEADLINE_MS it starts no new fetch, abandons whatever is in flight,
 * releases the lock and exits 1. The lock therefore can never outlive the §2.1
 * bound: either the run finishes, or the deadline releases it, or (process
 * killed outright) the TTL expires it 4 minutes after it was taken. The wake
 * wrapper gives live wakes their own short ceiling as a backstop.
 */
export const LIVE_LOCK_RESOURCE = 'scraper:live';
export const LIVE_LOCK_TTL_MS = 4 * 60 * 1000;
/** 3.5 minutes: inside the 4-minute TTL, leaving 30 s to release and exit. */
export const LIVE_JOB_DEADLINE_MS = 3.5 * 60 * 1000;

/**
 * Item 7 S1/S3/S4: the jobs `--job=` selects. `data` is the default so a cron
 * line without the flag behaves as before. `closed` (S3) is its own process
 * with its own wake under the heavy `scraper:cycle` lock (spec §2.1 job
 * table, §6.1) — it no longer runs as a post-step inside the data cycle.
 * `opening` (S4, OD-31) is the discovery-only opening-day check — same heavy
 * lock, skip-if-held, never fetches or extracts a document (§2.1).
 */
export const SCRAPER_JOBS = ['data', 'live', 'closed', 'opening'] as const;
export type ScraperJob = (typeof SCRAPER_JOBS)[number];

/**
 * Item 7 S1 (spec §2.1 job table rows "Live-figures job" and "Grey-market
 * premium", OD-28): the live figures, moved OUT of the data cycle into their own
 * job so they run on their own schedule under their own lock.
 *
 *   - subscription (the OPEN-restricted NSE + BSE reads) and the demand graph:
 *     only in bidding hours (10:00–18:30 IST, any day) AND only when at least one
 *     IPO is OPEN;
 *   - the grey-market premium: whenever any IPO is UPCOMING or OPEN — any hour,
 *     any day, evenings, weekends and holidays included (OD-28, F-41).
 *
 * It never touches a document, a field plan row, the closed-IPO job or any of
 * the data cycle's post-steps. Returns the process exit code.
 */
async function runLiveFiguresJob(): Promise<number> {
  if (!FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER) {
    // Rollback path: with the scheduler flag off, the legacy `--source=all`
    // cycle still fetches every source (GMP included) on every wake. A second
    // job doing the same would double every live fetch, so this one stands down.
    logger.info('Live-figures job: ENABLE_DUE_STEP_SCHEDULER is off — the legacy data cycle owns every source; nothing to do');
    return 0;
  }

  const lock = new DistributedLock(getRedisClient());
  const lockResult = await lock.acquire(LIVE_LOCK_RESOURCE, { ttl: LIVE_LOCK_TTL_MS });
  if (!lockResult.acquired) {
    logger.warn(
      { lockResource: LIVE_LOCK_RESOURCE },
      'Live-figures job: previous live run still holds scraper:live (a live run is a few HTTP reads, so it is stuck) — skipping this occurrence, exit 0'
    );
    return 0;
  }
  logger.info(
    { lockResource: LIVE_LOCK_RESOURCE, ttlMs: LIVE_LOCK_TTL_MS },
    'Live-figures job: took scraper:live (independent of scraper:cycle, OD-27)'
  );

  const token = lockResult.token;
  // Set when the deadline fires: no further step starts (runLiveStep checks it).
  let deadlineHit = false;
  let released = false;
  const releaseLiveLock = async (): Promise<void> => {
    if (released) return;
    released = true;
    try {
      await lock.release(LIVE_LOCK_RESOURCE, token);
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Live-figures job: lock release failed (non-fatal — the 4-minute TTL will expire it)'
      );
    }
  };

  const errors: string[] = [];
  const onSignal = (signal: NodeJS.Signals) => {
    logger.warn({ signal }, 'Live-figures job: signal received — releasing scraper:live before exit');
    const exitCode = errors.length > 0 ? 1 : 130;
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    void raceWithTimeout(() => releaseLiveLock(), { timeoutMs: releaseTimeoutMs, label: 'live lock release' })
      .finally(() => process.exit(exitCode));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  const runLiveStep = async (label: string, fn: () => Promise<{ success?: boolean; errors?: string[] } | void>): Promise<void> => {
    if (deadlineHit) {
      errors.push(`${label}: skipped — live job deadline (${LIVE_JOB_DEADLINE_MS} ms) reached`);
      return;
    }
    try {
      const stepResult = await fn();
      if (stepResult && stepResult.success === false) {
        const stepErrors = stepResult.errors ?? [];
        errors.push(...(stepErrors.length > 0 ? stepErrors.map((e) => `${label}: ${e}`) : [`${label}: completed with errors`]));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${label}: ${message}`);
      logger.error({ step: label, error: message }, 'Live-figures job: step failed (job continues, exit code will be non-zero)');
    }
  };

  // A count that cannot be read is treated as non-zero: a missed live figure is
  // the costlier mistake than one extra read (same fail-open rule the data
  // cycle's counts use).
  const countOrFailOpen = async (statuses: readonly ('UPCOMING' | 'OPEN')[]): Promise<number> => {
    try {
      return await countIposByStatus(statuses);
    } catch (error) {
      logger.warn(
        { statuses, error: error instanceof Error ? error.message : String(error) },
        'Live-figures job: IPO count query failed — treating as non-zero to fail open on freshness'
      );
      return 1;
    }
  };

  const work = async (): Promise<void> => {
    const now = new Date();

    // Subscription + demand graph: bidding hours only, OPEN IPOs only (OD-28).
    if (!isBiddingHoursIST(now)) {
      logger.info('Live-figures job: outside bidding hours (10:00-18:30 IST) — subscription and demand graph make ZERO network calls');
    } else {
      const openCount = await countOrFailOpen(['OPEN']);
      if (openCount === 0) {
        logger.info('Live-figures job: bidding hours, but zero OPEN IPOs — subscription and demand graph make ZERO network calls');
      } else {
        logger.info({ openCount }, 'Live-figures job: bidding hours + OPEN IPOs — running subscription (NSE/BSE, OPEN only) and the demand graph');
        await runLiveStep('live:NSE', () => runNSEScraper({ allowedStatuses: ['OPEN'], liveFiguresOnly: true }));
        await runLiveStep('live:BSE', () => runBSEScraper({ allowedStatuses: ['OPEN'], liveFiguresOnly: true }));
        await runLiveStep('live:demandGraph', () => runDemandBackfill({ execute: true }));
      }
    }

    // Grey-market premium: whenever any IPO is UPCOMING or OPEN — never gated
    // on bidding hours (OD-28, F-41).
    const gmpCandidates = await countOrFailOpen(['UPCOMING', 'OPEN']);
    if (gmpCandidates === 0) {
      logger.info('Live-figures job: no UPCOMING or OPEN IPO — grey-market premium makes ZERO network calls');
    } else {
      logger.info({ gmpCandidates }, 'Live-figures job: UPCOMING/OPEN IPOs present — running the grey-market premium fetch');
      await runLiveStep('live:GMP', () => runInvestorgainGMPScraper());
    }
  };

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'deadline'>((resolve) => {
    deadlineTimer = setTimeout(() => resolve('deadline'), LIVE_JOB_DEADLINE_MS);
  });
  try {
    const outcome = await Promise.race([work().then(() => 'done' as const), deadline]);
    if (outcome === 'deadline') {
      deadlineHit = true;
      errors.push(`live job: deadline ${LIVE_JOB_DEADLINE_MS} ms reached — in-flight fetch abandoned`);
      logger.error(
        { lockResource: LIVE_LOCK_RESOURCE, deadlineMs: LIVE_JOB_DEADLINE_MS, ttlMs: LIVE_LOCK_TTL_MS },
        'Live-figures job: hard deadline reached (spec §2.1 live lock bound) — starting nothing new, releasing scraper:live and exiting 1'
      );
    }
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    await raceWithTimeout(() => releaseLiveLock(), { timeoutMs: releaseTimeoutMs, label: 'live lock release' });
  }

  if (errors.length > 0) {
    logger.error({ errors }, 'Live-figures job completed with errors');
    return 1;
  }
  logger.info('Live-figures job completed successfully');
  return 0;
}

/**
 * Item 7 S3 (spec §2.1 job table row "Closed-IPO job", §6.1, OD-19/OD-22):
 * `--job=closed` is now its own process, no longer a post-step inside the
 * data cycle. It takes the SAME heavy lock the data job takes
 * (`CYCLE_LOCK_RESOURCE = 'scraper:cycle'`) — the two jobs are mutually
 * exclusive by design (§2.1 "never start while the heavy lock is held"): a
 * second walker on the rows the data job is mid-cycle on is how two writers
 * race.
 *
 * §2.1's rule is "no job ever kills a running cycle" — this function only
 * ever ATTEMPTS the lock (`acquire`, which fails closed if already held) and
 * never calls `forceRelease` or signals another process. A held lock is
 * logged and this wake exits 0 having done nothing, exactly like a data wake
 * that finds `scraper:cycle` held (see scripts/scraper-wake.sh's own
 * lock-skip, which is the OUTER guard; this is the INNER one for the case
 * where a --job=closed process starts anyway, e.g. a manual run).
 *
 * The lock stores only a token (see distributed-lock.ts — `SET key token PX
 * ttl NX`), never a start timestamp, so "the holder's start time" cannot be
 * read directly. `getLockTTL` gives the remaining TTL, from which the
 * elapsed time since acquisition is `CYCLE_LOCK_TTL_MS - remainingTtlMs`,
 * logged as an approximate start (ISO timestamp, derived from `now`). A
 * negative or unreadable TTL (Redis unavailable, or `-1` "no expiry") means
 * the elapsed time cannot be derived either — logged as 'unknown' rather
 * than a fabricated number.
 *
 * Once the lock is acquired, `runClosedIpoJob`'s own `isCycleLockHeld` guard
 * is trivially satisfied — this function IS the process holding the lock, so
 * asking Redis again would just confirm what is already true. It is passed
 * `async () => false` for the same reason the old in-cycle post-step
 * (`triggerClosedIpoJob`, removed in this change) did: a literal re-check
 * here would either always read true (this process's own lock) or, worse,
 * be a lie in the shape of a guard. The exclusion is structural: this
 * function will not even start the work below unless `lock.acquire` just
 * succeeded.
 */
async function runClosedIpoWake(): Promise<number> {
  // Round 1, Tier A finding 4: check the flag BEFORE taking the heavy lock.
  // Taking `scraper:cycle` and then discovering the job is disabled still
  // costs the lock for however long that check + release takes — on the
  // shared 2-vCPU box that is exactly the W-178 shape this whole slice exists
  // to avoid, except self-inflicted by a disabled job instead of a real one.
  // A disabled closed wake must never make a data wake skip.
  if (!FEATURE_FLAGS.ENABLE_CLOSED_IPO_JOB) {
    logger.info('closed-IPO job disabled (ENABLE_CLOSED_IPO_JOB=false)');
    return 0;
  }

  const redis = getRedisClient();
  const lock = new DistributedLock(redis);
  const lockResult = await lock.acquire(CYCLE_LOCK_RESOURCE, { ttl: CYCLE_LOCK_TTL_MS });

  if (!lockResult.acquired) {
    let holderStartedAt = 'unknown';
    try {
      const remainingTtlMs = await lock.getLockTTL(CYCLE_LOCK_RESOURCE);
      if (remainingTtlMs > 0) {
        const elapsedMs = CYCLE_LOCK_TTL_MS - remainingTtlMs;
        holderStartedAt = new Date(Date.now() - elapsedMs).toISOString();
      }
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Closed-IPO job: could not read scraper:cycle TTL to estimate the holder start time'
      );
    }
    logger.warn(
      { lockResource: CYCLE_LOCK_RESOURCE, holderStartedAt },
      `closed-IPO job skipped: heavy lock held since ${holderStartedAt}`
    );
    return 0;
  }

  const token = lockResult.token;
  let released = false;
  const releaseCycleLockForClosedJob = async (): Promise<void> => {
    if (released) return;
    released = true;
    try {
      await lock.release(CYCLE_LOCK_RESOURCE, token);
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Closed-IPO job: lock release failed (non-fatal — the TTL will expire it)'
      );
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    logger.warn({ signal }, 'Closed-IPO job: signal received — releasing scraper:cycle before exit');
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    void raceWithTimeout(() => releaseCycleLockForClosedJob(), { timeoutMs: releaseTimeoutMs, label: 'closed-IPO cycle lock release' })
      .finally(() => process.exit(130));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  let exitCode = 0;
  try {
    const now = new Date();
    let lastRunAt: Date | null = null;
    try {
      const raw = await redis.get(`catch-up-cadence:${CLOSED_IPO_JOB_CADENCE_KEY}`);
      const ms = Number(raw);
      if (raw && Number.isFinite(ms) && ms > 0) lastRunAt = new Date(ms);
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'closed-IPO job: cadence read failed — treating as never run (fail open)'
      );
    }

    if (!isClosedIpoJobDue(now, lastRunAt)) {
      // Round 1 fix (Tier A finding 1): the closed cron now fires twice a
      // night (22:xx + a 23:xx retry, see install_scraper_cron in
      // deploy-linux.sh) so the ONE night the first wake loses the
      // scraper:cycle race still gets its run. Every OTHER wake that finds
      // the boundary already served — including the routine retry, and any
      // repeat if the box wakes it more than twice — logs this exact phrase
      // and exits 0 without touching the lock, so the log stays greppable
      // proof that "once per night" held.
      logger.info(
        { lastRunAt: lastRunAt?.toISOString() ?? 'never' },
        'closed-IPO job already ran tonight — 22:00 IST boundary already served'
      );
      return 0;
    }

    try {
      const summary = await runClosedIpoJob({
        db,
        // This function is the process holding scraper:cycle (see the
        // acquire above); a second Redis read here would only confirm what
        // acquiring the lock already proved. See the doc comment above.
        isCycleLockHeld: async () => false,
        resourceIpo: resourceClosedIpoLive,
        resourcedAtVersion: currentClosedIpoResourcingVersion(),
        snapshotFieldSources: (ipoIds) => writeFieldSourcesSnapshot(db as never, ipoIds, { now }),
        now,
      });

      await markCatchUpCadenceRan(redis, CLOSED_IPO_JOB_CADENCE_KEY, CLOSED_IPO_JOB_CADENCE_TTL_MINUTES, now);

      // signal-ownership R1: a count is not a reading.
      logger.info(
        {
          slot: CLOSED_IPO_JOB_SLOT_IST_MINUTES,
          considered: summary.candidatesConsidered,
          attempted: summary.attempted,
          done: summary.outcomes.DONE,
          partial: summary.outcomes.PARTIAL,
          failed: summary.outcomes.FAILED,
          snapshot: summary.snapshot ? `${summary.snapshot.path} (${summary.snapshot.rows} rows)` : 'none',
        },
        'closed-IPO job: run complete'
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Closed-IPO job failed (non-fatal)'
      );
      exitCode = 1;
    }
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    await raceWithTimeout(() => releaseCycleLockForClosedJob(), { timeoutMs: releaseTimeoutMs, label: 'closed-IPO cycle lock release' });
  }

  return exitCode;
}

/**
 * Item 7 S4 (spec §2.1 job table row "Opening-day check", OD-31): the
 * discovery-only check placed about 09:45 IST, only on a day an IPO is due
 * to open. Its own process, its own wake, under the SAME heavy lock the
 * data job and closed-IPO job take (`scraper:cycle`) — §2.1's "heavy" lock
 * row lists all three; a second walker mid-cycle is how two writers race.
 *
 * What it does, and no more (§2.1 as amended by OD-87): the two exchange
 * LIST calls (NSE current issues, BSE board — §7.4 "2 calls a day"), the rows
 * whose listed open date is today (IST), and for each an identity + status +
 * open/close-date write through the shared identity resolution and the
 * consolidated upsert (`scheduler/opening-day-discovery.ts`). No per-IPO
 * detail or subscription call, no subscription snapshot, no verifier hint, no
 * document or extraction, no aggregator/fallback/field-plan step. The lock is
 * taken first (skip-if-held); the lists are always fetched — a stored-row
 * gate would miss a brand-new, NULL-dated or postponed IPO (review finding 1).
 */
async function runOpeningDayCheckWake(): Promise<number> {
  const now = new Date();
  const redis = getRedisClient();
  const lock = new DistributedLock(redis);
  const lockResult = await lock.acquire(CYCLE_LOCK_RESOURCE, { ttl: CYCLE_LOCK_TTL_MS });

  if (!lockResult.acquired) {
    // Finding 5 (review): the lock (scraper/src/utils/distributed-lock.ts)
    // stores only a random token, never a start time, and the data job
    // renews the TTL every 5 minutes — so "TTL_MS - remainingTtlMs" is the
    // time since the LAST renewal, not since the holder acquired the lock,
    // and prints a plausible but WRONG time on every renewal boundary. There
    // is no genuine start time to read; say so rather than compute one.
    logger.warn(
      { lockResource: CYCLE_LOCK_RESOURCE },
      'opening-day check skipped: heavy lock held (start time unknown)'
    );
    return 0;
  }

  const token = lockResult.token;
  let released = false;
  const releaseCycleLockForOpeningCheck = async (): Promise<void> => {
    if (released) return;
    released = true;
    try {
      await lock.release(CYCLE_LOCK_RESOURCE, token);
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Opening-day check: lock release failed (non-fatal — the TTL will expire it)'
      );
    }
  };

  const onSignal = (signal: NodeJS.Signals) => {
    logger.warn({ signal }, 'Opening-day check: signal received — releasing scraper:cycle before exit');
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    void raceWithTimeout(() => releaseCycleLockForOpeningCheck(), { timeoutMs: releaseTimeoutMs, label: 'opening-day check cycle lock release' })
      .finally(() => process.exit(130));
  };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);

  let exitCode = 0;
  try {
    // OD-87: the two exchange LIST calls only; today's rows get identity,
    // status and the two dates through the identity + consolidated write.
    logger.info(
      { lockResource: CYCLE_LOCK_RESOURCE, scheduledAtIstMinutes: OPENING_DAY_CHECK_TIME_IST_MINUTES },
      'Opening-day check: fetching the two exchange lists (identity, status and dates only — no document, no extraction)'
    );
    const ipoRepository = new IPORepository(db, redis);
    const consolidation = new DataConsolidationOrchestrator(
      ipoRepository,
      new FieldSourcesRepository(db, redis),
      new DataConflictsRepository(db, redis),
      redis,
      new OpeningDayListingPerformanceRepository(db, redis)
    );
    const fieldProtection = createFieldProtectionService(db, redis);
    const summary = await runOpeningDayDiscovery(
      {
        fetchNseList: fetchCurrentIssueList,
        fetchBseList: fetchBSEBoard,
        storedOpeningOn: () => iposOpeningToday(db, now),
        writeRow: createOpeningDayWriter({
          ipoRepository: ipoRepository as any,
          resolveIpoRow: resolveIpoRow as any,
          inferBoundVia: inferBoundVia as any,
          withSourceKeyLineage,
          noWriteErrorNames: SOURCE_KEY_NO_WRITE_ERROR_NAMES,
          fieldProtection: fieldProtection as any,
          consolidatedUpsertIPO: (claim, source, confidence, existing, onlyFields) =>
            consolidation.consolidatedUpsertIPO(claim, source, confidence, existing, onlyFields),
          normalizeName: normalizeCompanyNameForMatching,
          identitySlug: computeIpoIdentitySlug as any,
        }),
      },
      now
    );
    const failures = summary.failures;
    const nseRowsChecked = summary.nseRowsChecked;
    const bseRowsChecked = summary.bseRowsChecked;
    const opensToday = summary.written.length > 0 || summary.storedOpeningToday.length > 0;

    if (!opensToday && failures.length === 0) {
      logger.info(
        { nseRowsChecked, bseRowsChecked },
        `opening-day check: no IPO opens today (NSE ${nseRowsChecked} rows, BSE ${bseRowsChecked} rows checked)`
      );
    } else {
      // signal-ownership R1 ("a number is not a reading"): name the rows.
      logger.info(
        {
          todayIst: summary.todayIso,
          nseRowsChecked,
          bseRowsChecked,
          written: summary.written,
          openingToday: summary.storedOpeningToday.map((row) => ({ id: row.id, companyName: row.companyName, status: row.status })),
          failures,
        },
        'Opening-day check: run complete'
      );
    }
    if (failures.length > 0) exitCode = 1;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Opening-day check failed (non-fatal)'
    );
    exitCode = 1;
  } finally {
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
    const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS) || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
    await raceWithTimeout(() => releaseCycleLockForOpeningCheck(), { timeoutMs: releaseTimeoutMs, label: 'opening-day check cycle lock release' });
  }

  return exitCode;
}

/**
 * S-02 §5: the due-step cycle. Replaces the flat "every source, every
 * 30-minute cycle, regardless of IPO status or time of day" shape with a
 * schedule-aware one:
 *   (a) discovery (NSE+BSE) only at 4 fixed IST slots/day, with catch-up
 *   (b) reconcile every cycle -- already covered by the existing
 *       `stageReconciler` post-step below (runs unconditionally on 'all'),
 *       so it is NOT duplicated here
 *   (c) live data — no longer here: `--job=live` owns it (item 7 S1,
 *       runLiveFiguresJob, OD-27/OD-28)
 *   (d) aggregator refresh (Chittorgarh) only for
 *       UPCOMING/OPEN IPOs, at most once/day — and, like (e) the API fallback,
 *       only on a wake inside an open data-job slot (item 7 S2b, OD-19): a
 *       wake outside the slots returns before any IPO-data fetch
 * Only called when `source === 'all' && FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER`.
 * The caller (`main()`) owns the whole-cycle lock (`CYCLE_LOCK_RESOURCE`) and
 * still runs the post-steps (statusUpdate, stageReconciler, etc.) exactly as
 * the legacy 'all' path does, right after this returns.
 */
async function runDueStepCycle(
  // Round-4 LOW: checked before every step so a cycle that has lost its
  // distributed lock (keep-alive `extendLock` returned false — see `main()`)
  // stops issuing further writes instead of continuing under a lock another
  // process may already hold.
  isLockLost: () => boolean = () => false
): Promise<DueStepCycleResult> {
  const redis = getRedisClient();
  const now = new Date();
  const cycleResult: DueStepCycleResult = { success: true, errors: [] };

  /**
   * Round-3 H2: run one step, log its failure AND record it. A thrown step no
   * longer disappears; a step that returns `success: false` (a scraper that
   * completed with errors) is recorded too.
   */
  const runCycleStep = async (
    label: string,
    fn: () => Promise<{ success?: boolean; errors?: string[] } | void>
  ): Promise<boolean> => {
    if (isLockLost()) {
      cycleResult.success = false;
      cycleResult.errors.push(`${label}: skipped — cycle lock lost`);
      logger.error({ step: label }, 'Due-step cycle: skipping step — cycle lock was lost');
      return false;
    }
    try {
      const stepResult = await fn();
      if (stepResult && stepResult.success === false) {
        cycleResult.success = false;
        const stepErrors = stepResult.errors ?? [];
        cycleResult.errors.push(
          ...(stepErrors.length > 0 ? stepErrors.map((e) => `${label}: ${e}`) : [`${label}: completed with errors`])
        );
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cycleResult.success = false;
      cycleResult.errors.push(`${label}: ${message}`);
      logger.error({ step: label, error: message }, 'Due-step cycle: step failed (cycle continues, exit code will be non-zero)');
      return false;
    }
  };

  // (a) discovery — the data job's 3 IST slots/day (OD-19), catch-up safe.
  let lastDiscoveryRun: Date | null = null;
  try {
    const raw = await redis.get(DISCOVERY_LAST_RUN_KEY);
    lastDiscoveryRun = raw ? new Date(raw) : null;
    if (lastDiscoveryRun !== null && Number.isNaN(lastDiscoveryRun.getTime())) lastDiscoveryRun = null;
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      'Due-step cycle: discovery last-run lookup failed (non-fatal) — treating as due (fail open)'
    );
  }

  // Item 7 S2b (F-142, spec §2.1, OD-19): ONE slot decision per wake, and it
  // gates EVERY IPO-data fetch in this function — discovery (NSE+BSE), the
  // Chittorgarh list and its issue-type fill, and the API fallback. #935 gated
  // discovery only; Chittorgarh and the fallback kept a bare 24h catch-up
  // cadence, which is due on ANY wake, so staging's 22:15 IST wake fetched the
  // Chittorgarh list and created 8 IPOs. The decision reads the discovery
  // stamp, which is set only when NSE+BSE both succeeded, so a failed or
  // missed slot stays open and the next wake catches it up.
  //
  // Two stamps, not one: the document cycle (triggerPrimarySourceDiscovery)
  // keeps its own DOCUMENT_CYCLE_LAST_RUN_KEY because one document slot may
  // legitimately span several wakes (OD-55), and the list scrapers must not
  // re-fetch on each of them. Both stamps are keyed to the SAME slot boundary
  // (isDataJobDue), each set only when its own part completed, so neither part
  // can run for a slot outside the 00:00/08:00/14:00 IST boundaries.
  const dataSlotOpen = isDiscoveryDue(now, lastDiscoveryRun);
  if (!dataSlotOpen) {
    logger.info(
      { slot: mostRecentDiscoverySlotLabel(now) },
      'Due-step cycle: data job not due at this wake — discovery skipped, website scrapers skipped (OD-19 slots 00:00/08:00/14:00 IST)'
    );
    return cycleResult;
  }
  // The 24h cadences below are stamped at the slot BOUNDARY, not at `now`:
  // stamped at 08:00:42 today, tomorrow's 08:00:05 wake would be 37s short of
  // 24h and the source would slip to the 14:00 slot, then drift further.
  const slotStartedAt = mostRecentDataJobSlotBoundary(now);

  logger.info({ slot: mostRecentDiscoverySlotLabel(now) }, 'Due-step cycle: discovery is due — running NSE + BSE');
  // T-478 (issue #225): the OFS category lives ONLY on this unrestricted,
  // 3x/day (OD-19) discovery step (never the OPEN-only "live" step below) — OFS
  // rows can be UPCOMING/CLOSED/LISTED, not just OPEN, and discovery is
  // where new offering_type rows are meant to first appear. One extra NSE
  // API call per discovery run, inside the existing wake budget.
  // Round 2 (MAJOR): the live OFS payload shape is unverified — gated
  // behind ENABLE_NSE_OFS (default false; prod stays off until a real OFS
  // book is observed on staging and its fixture captured).
  const nseOk = await runCycleStep('discovery:NSE', () => runNSEScraper({ includeOFS: FEATURE_FLAGS.ENABLE_NSE_OFS }));
  const bseOk = await runCycleStep('discovery:BSE', () => runBSEScraper());
  // Round-4 MEDIUM: only stamp the cadence key when BOTH steps actually
  // succeeded — matching the aggregator block's pattern below. Stamping
  // unconditionally meant a thrown NSE at the 17:30 slot still marked
  // discovery "done", so the next `isDiscoveryDue` check stayed silent
  // until 08:30 even though NSE never ran.
  if (nseOk && bseOk) {
    try {
      await redis.set(DISCOVERY_LAST_RUN_KEY, now.toISOString());
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Due-step cycle: discovery last-run persist failed (non-fatal)'
      );
    }
  } else {
    logger.warn(
      { nseOk, bseOk, slot: mostRecentDiscoverySlotLabel(now) },
      'Due-step cycle: discovery step(s) failed — leaving the cadence key unstamped so the next cycle retries'
    );
  }

  // (c) live data — MOVED OUT (item 7 S1, spec §2.1, OD-27/OD-28). Subscription,
  // the demand graph and the grey-market premium now run in their own
  // `--job=live` wake under their own `scraper:live` lock (runLiveFiguresJob),
  // so a data job holding `scraper:cycle` for hours can never stand them still.
  // The data job must not fetch them as well, or every live figure is read twice.

  // (d) aggregators — UPCOMING/OPEN only, at most once/day.
  // Round-3 M2: read-only due check here, explicit stamp AFTER the work
  // succeeds (below) — the old combined check-and-stamp call meant a kill or a
  // throw between the two skipped aggregators for the next 24 hours.
  const aggregatorsDue = await isCatchUpCadenceDue(redis, AGGREGATOR_CADENCE_KEY, AGGREGATOR_INTERVAL_MINUTES, now);
  if (!aggregatorsDue) {
    logger.info('Due-step cycle: aggregator refresh (Chittorgarh) not due yet (< 24h since last run) — skipped');
  } else {
    let candidateCount = 0;
    try {
      candidateCount = await countIposByStatus(['UPCOMING', 'OPEN']);
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Due-step cycle: UPCOMING/OPEN-IPO count query failed — treating as non-zero to fail open on freshness'
      );
      candidateCount = 1;
    }
    if (candidateCount === 0) {
      logger.info('Due-step cycle: aggregator cadence due, but zero UPCOMING/OPEN IPOs — skipped (zero network calls)');
    } else {
      // Item 16: Moneycontrol is retired. The aggregator branch itself stays —
      // it still runs Chittorgarh on the same cadence; only the Moneycontrol
      // call inside it goes. This is the call site that actually fires in
      // production, because prod runs the due-step scheduler.
      logger.info({ candidateCount }, 'Due-step cycle: aggregator cadence due — running Chittorgarh for UPCOMING/OPEN IPOs');
      const cgOk = await runCycleStep('aggregator:CHITTORGARH', () => runChittorgarhScraper({ allowedStatuses: ['UPCOMING', 'OPEN'] }));

      // Item 2 slice 7. Report 82 publishes Pricing Method as a first-class
      // field; this fills `ipo_details.issue_type` where it is NULL and never
      // overwrites. A SEPARATE step from the scrape above because it writes a
      // different table under a different safety argument (a NULL guard, not a
      // priority engine), and it runs regardless of `cgOk`: the scrape writing
      // `ipos` and the report publishing an issue type are independent, so a
      // partial scrape is no reason to drop a field the same response carried.
      const fillDue = await isCatchUpCadenceDue(
        redis,
        ISSUE_TYPE_FILL_CADENCE_KEY,
        AGGREGATOR_INTERVAL_MINUTES,
        now
      );
      const fillOk = !fillDue ? true : await runCycleStep('aggregator:CHITTORGARH_ISSUE_TYPE', async () => {
        const result = await runIssueTypeFillJob(
          makeIssueTypeJobDeps(
            db,
            makeIpoDetailsWriter(),
            new FieldSourcesRepository(db, redis),
            (id, table, data, scraperName) =>
              filterProtectedFields(id, table, data, scraperName, db, redis),
            logger
          )
        );
        // THE STEP VERDICT MUST BE ABLE TO FAIL FOR THE CLAIM IT SUPPORTS.
        //
        // I originally failed the step only on `abortedReason`, which meant a
        // cycle where EVERY write threw - say ipodhan_app lacking UPDATE on
        // ipo_details - returned failed=231, filled=0 and success:true. A cycle
        // that wrote nothing and a cycle that wrote 180 rows produced the same
        // verdict, so the staging proof this step exists to support could not
        // have failed. Caught in Tier A review.
        //
        // Counts are resolved to a reason, never reported bare (signal-ownership R1).
        const reasons: string[] = [];
        if (result.abortedReason) reasons.push(`aborted: ${result.abortedReason}`);
        if (result.failed > 0) reasons.push(`${result.failed} row(s) threw during the write`);
        // Nothing matching at all means the source's name format moved or the
        // fold changed - never a legitimate quiet day for a whole-year report.
        if (!result.abortedReason && result.candidates > 0 && result.matched === 0) {
          reasons.push(`0 of ${result.candidates} report rows matched any stored IPO`);
        }
        // MATCHED BUT WROTE NOTHING is the blind spot round 2 found. If every
        // match is refused - all dateMismatch because the two open-date
        // populations diverge, or all blockedByAdmin from a protection-cache
        // anomaly - the step would otherwise report clean while zero rows were
        // touched, and the staging proof could not fail for the write claim.
        if (!result.abortedReason && result.matched > 0 && result.filled === 0 && result.alreadySet === 0) {
          reasons.push(
            `${result.matched} row(s) matched but NONE were written or already set ` +
            `(dateMismatch=${result.dateMismatch}, blockedByAdmin=${result.blockedByAdmin})`
          );
        }
        if (reasons.length === 0) return { success: true };
        logger.warn({ ...result }, 'Due-step cycle: issue-type fill did not fully succeed');
        return { success: false, errors: reasons.map((r) => `issue-type fill: ${r}`) };
      });

      // Each step stamps its OWN key on its OWN result. A failed fill must not
      // suppress its own retry (the original bug), and must not un-stamp the
      // scrape either (the retry storm that fix created).
      if (fillDue && fillOk) {
        await markCatchUpCadenceRan(redis, ISSUE_TYPE_FILL_CADENCE_KEY, AGGREGATOR_INTERVAL_MINUTES, slotStartedAt);
      }
      if (cgOk) {
        await markCatchUpCadenceRan(redis, AGGREGATOR_CADENCE_KEY, AGGREGATOR_INTERVAL_MINUTES, slotStartedAt);
      } else {
        logger.warn('Due-step cycle: aggregator refresh did not fully succeed — cadence key NOT stamped, it will retry next cycle');
      }
    }
  }

  // (e) API fallback — once/day (round-3 C3). Same isDue/markRan discipline as
  // the aggregators: a failed or killed run leaves the key unstamped so the
  // next cycle retries instead of skipping the source for a whole day.
  const apiFallbackDue = await isCatchUpCadenceDue(redis, API_FALLBACK_CADENCE_KEY, API_FALLBACK_INTERVAL_MINUTES, now);
  if (!apiFallbackDue) {
    logger.info('Due-step cycle: IPO Alerts API fallback not due yet (< 24h since last run) — skipped');
  } else {
    logger.info('Due-step cycle: IPO Alerts API fallback cadence due — running');
    const fallbackOk = await runCycleStep('apiFallback', () => runIPOAlertsFallback('scheduled'));
    if (fallbackOk) {
      await markCatchUpCadenceRan(redis, API_FALLBACK_CADENCE_KEY, API_FALLBACK_INTERVAL_MINUTES, slotStartedAt);
    } else {
      logger.warn('Due-step cycle: API fallback did not succeed — cadence key NOT stamped, it will retry next cycle');
    }
  }

  return cycleResult;
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
 * Item 2 slice 4 — validate `scraper/config/field-manifest.json` at process
 * start, BEFORE `main()` runs (see the CLI guard at the bottom of this file).
 *
 * Class this closes: configuration that is read at runtime but never
 * validated, so a malformed file is discovered by a wrong result rather than
 * a loud failure. Nothing consumes the manifest yet (item 3 wires the field
 * priority matrix to it), so with `ENABLE_FIELD_MANIFEST` at its default of
 * `false` this is a pure no-op — `loadFieldManifest()` is never even called.
 * Once the flag is on, `loadFieldManifest()` throws SYNCHRONOUSLY on a
 * malformed manifest; the CLI guard has no try/catch, so that throw reaches
 * Node's default uncaught-exception handler (process exits non-zero) before
 * the `main();` statement that follows it ever runs — before ANY cycle-start
 * log line is emitted, not just before the process eventually exits.
 *
 * `manifestPath` is an optional override so unit tests can point at a
 * temp-file fixture without touching the real
 * `scraper/config/field-manifest.json` — same pattern `loadFieldManifest`
 * itself already uses. `enabled` defaults to the real `FEATURE_FLAGS` value
 * (what production reads) but can be passed explicitly by tests — the same
 * explicit-override-with-a-real-default shape `assertRequiredEnvForCycle`
 * above already uses for `env`, so a test can flip the flag without
 * `vi.resetModules()` + re-importing this whole module (which FEATURE_FLAGS
 * bakes to a boolean once, at first import, per module instance).
 */
export function validateFieldManifestAtStartup(
  manifestPath?: string,
  enabled: boolean = FEATURE_FLAGS.ENABLE_FIELD_MANIFEST
): void {
  if (!enabled) return;
  const manifest = loadFieldManifest(manifestPath);
  // Item 3 slice S0b: name the exact config every cycle ran with — version, field count, and a
  // content hash (first 12 hex chars of sha256) so a staging/prod log can be diffed against the
  // committed file's own hash without shipping the whole 190-row JSON into the log stream.
  const resolvedManifestPath = manifestPath ?? DEFAULT_MANIFEST_PATH;
  const raw = readManifestFileSync(resolvedManifestPath, 'utf8');
  const sha256 = createHash('sha256').update(raw).digest('hex').slice(0, 12);
  // Item 3 slice S5: name the config-only deploy this cycle ran with. `configSha` is read from a
  // `CONFIG_SHA` file that sits next to the REAL manifest file — fs.realpathSync resolves a
  // symlinked release manifest (scripts/deploy-linux.sh's link step) to its target,
  // shared/config/<slot>/field-manifest.json, so CONFIG_SHA is looked up next to the shared file,
  // not the release-local symlink path. Absent/unreadable CONFIG_SHA (no config deploy has run
  // yet, or a plain non-symlinked path in a test) means the literal 'release'.
  let configSha = 'release';
  try {
    const realManifestDir = dirname(realpathSync(resolvedManifestPath));
    configSha = readManifestFileSync(join(realManifestDir, 'CONFIG_SHA'), 'utf8').trim();
  } catch {
    configSha = 'release';
  }
  logger.info(
    { version: manifest.version, fields: Object.keys(manifest.fields).length, sha256, configSha },
    `field-manifest: version=${manifest.version} fields=${Object.keys(manifest.fields).length} sha256=${sha256} config_sha=${configSha}`
  );
}

/**
 * Item 3 slice S1b — validate `scraper/config/switchover.json` at process start, beside the
 * field-manifest check and for exactly the same reason: a malformed switchover file (a group
 * naming an unknown field, a field in two groups, a `flipped` entry naming no group) must be a
 * loud startup failure, never a wrong write-time decision three fields into a cycle. Gated on
 * `ENABLE_POLICY_WRITER` (default off in prod/local) so a `false` value is a pure no-op —
 * `loadSwitchover()` is never even called.
 */
export function validateSwitchoverAtStartup(
  switchoverPath?: string,
  enabled: boolean = FEATURE_FLAGS.ENABLE_POLICY_WRITER
): void {
  if (!enabled) return;
  const sw = loadSwitchover(switchoverPath);
  const resolvedPath = switchoverPath ?? DEFAULT_SWITCHOVER_PATH;
  logger.info(
    { version: sw.version, groups: Object.keys(sw.groups).length, flipped: sw.flipped.join(',') || '(none)' },
    `switchover: version=${sw.version} groups=${Object.keys(sw.groups).length} flipped=${sw.flipped.join(',') || '(none)'} path=${resolvedPath}`
  );
}

/**
 * Item 4 slice 1 — validate `scraper/config/validation-rules.json` at process
 * start, immediately after item 2's manifest check and for exactly the same
 * reason: a malformed rule file must be a loud startup failure, never a wrong
 * write-time verdict. Same shape as `validateFieldManifestAtStartup` above
 * (explicit path + explicit enabled override so a unit test can point at a
 * temp fixture without `vi.resetModules()`).
 *
 * With `ENABLE_FIELD_EXTRACTION_VALIDATION` at its default `false` this is a
 * pure no-op — `loadValidationRules()` is never even called.
 */
export function validateValidationRulesAtStartup(
  rulesPath?: string,
  enabled: boolean = FEATURE_FLAGS.ENABLE_FIELD_EXTRACTION_VALIDATION
): void {
  if (!enabled) {
    logger.info(
      { flag: 'ENABLE_FIELD_EXTRACTION_VALIDATION', enabled: false, rulesLoaded: null },
      'field-extraction validation flag state'
    );
    return;
  }
  const rules = loadValidationRules(rulesPath);
  logger.info(
    { flag: 'ENABLE_FIELD_EXTRACTION_VALIDATION', enabled: true, rulesLoaded: rules.length },
    'field-extraction validation flag state'
  );
}

/**
 * CLI entry point for IPO scrapers
 * Supports NSE, BSE, Chittorgarh, GMP, API fallback, and combined scraping via --source flag
 * Usage:
 *   npm start                         (defaults to NSE)
 *   npm run start:bse                 (BSE only)
 *   npm run start:chittorgarh         (Chittorgarh only)
 *   npm run start:gmp                 (Investorgain GMP only)
 *   npm run start:fallback            (IPO Alerts API fallback)
 *   npm run start:api                 (alias for fallback)
 *   npm run start:all                 (NSE + BSE + Chittorgarh + API fallback + GMP sequentially)
 */
export async function main() {
  // S-02 §5: declared OUTSIDE the try block so the outer catch (unhandled
  // error) can still release the lock — a `let`/`const` declared inside
  // `try { }` is not visible to its own `catch { }` block.
  let cycleLock: { lock: DistributedLock; token?: string } | null = null;
  let cycleLockKeepAlive: ReturnType<typeof setInterval> | null = null;
  // Round-4 LOW: flipped when a keep-alive `extendLock` call resolves `false`
  // (another writer holds — or has expired — this token's lock). The current
  // cycle no longer owns the lock past that point; `lockLost` is checked
  // before the next due-step, so the run stops instead of continuing to
  // write under a lock it has actually lost.
  let lockLost = false;
  const releaseCycleLock = async (): Promise<void> => {
    if (cycleLockKeepAlive) {
      clearInterval(cycleLockKeepAlive);
      cycleLockKeepAlive = null;
    }
    if (!cycleLock) return;
    try {
      await cycleLock.lock.release(CYCLE_LOCK_RESOURCE, cycleLock.token);
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        'Due-step cycle: lock release failed (non-fatal — TTL will expire it)'
      );
    }
  };

  try {
    // Parse CLI arguments
    const args = process.argv.slice(2);

    // --smoke-import: prove the ENTIRE production import graph loads under the
    // real ESM runtime, then exit before any DB, network or scrape work.
    // Reaching this line means every module reachable from this entry point
    // evaluated its top level successfully. This is the only check that can
    // catch a CommonJS global (__dirname/__filename/require) left at module
    // scope: vitest transforms modules to CJS and shims those globals, and
    // `tsx -e` shims them too, so both report green on code that crashes the
    // moment pm2 runs `tsx src/index.ts` (2026-09-10, download-allowlist-loader).
    if (args.includes('--smoke-import')) {
      console.log('smoke-import: OK - production import graph loaded under ESM');
      return;
    }

    const source = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'nse';
    // Item 7 S1: which scheduled job this wake is (spec §2.1). Default `data`,
    // so a cron line or a manual run without the flag behaves exactly as before.
    const jobArg = args.find(arg => arg.startsWith('--job='))?.split('=')[1] ?? 'data';

    logger.info({ source, job: jobArg }, 'IPO Scraper CLI started');

    if (!(SCRAPER_JOBS as readonly string[]).includes(jobArg)) {
      logger.error({ job: jobArg }, `Invalid --job. Must be: ${SCRAPER_JOBS.join(', ')}`);
      process.exit(1);
      return;
    }
    const job = jobArg as ScraperJob;

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
    // Item 16: 'moneycontrol' is no longer a valid source. Left OUT of the
    // allow-list rather than special-cased, so it fails through the same
    // unrecognised-value path as any other bad string.
    //
    // Item 16 slice 2: the allow-list now lives in config/runnable-sources.ts
    // instead of inline here. It was already the list that decides which
    // sources can run; being inline meant nothing else could read it, so when
    // this array lost 'moneycontrol' its freshness SLO stayed armed and the
    // monitor would have paged the owner about a retired source.
    if (!CLI_SOURCE_ARGS.includes(source)) {
      logger.error({ source }, `Invalid source. Must be: ${CLI_SOURCE_ARGS.join(', ')}`);
      process.exit(1);
    }

    // Item 7 S1: the live-figures job is its own process with its own lock. It
    // returns here and never reaches the data cycle's lock, steps or post-steps.
    if (job === 'live') {
      const liveExitCode = await runLiveFiguresJob();
      await flushOwnerNotify();
      process.exit(liveExitCode);
      return;
    }

    // Item 7 S3: the closed-IPO job is its own process, under the SAME heavy
    // lock the data job takes (scraper:cycle) — §2.1's rule is that the two
    // never run concurrently, not that they have separate locks like the
    // live job does. It returns here and never reaches the data cycle's
    // steps or post-steps (the closedIpoJob post-step below is gone, item 2).
    if (job === 'closed') {
      const closedExitCode = await runClosedIpoWake();
      await flushOwnerNotify();
      process.exit(closedExitCode);
      return;
    }

    // Item 7 S4 (OD-31): the opening-day check is its own process, under the
    // SAME heavy lock (scraper:cycle) — discovery-only, never a document or
    // extraction step. It returns here and never reaches the data cycle's
    // steps or post-steps.
    if (job === 'opening') {
      const openingExitCode = await runOpeningDayCheckWake();
      await flushOwnerNotify();
      process.exit(openingExitCode);
      return;
    }

    // S-02 §5 (`ENABLE_DUE_STEP_SCHEDULER`): whole-cycle Redis lock so PM2's
    // force-restarting `cron_restart */30 * * * *` never overlaps two
    // due-step cycles (see CYCLE_LOCK_RESOURCE's doc comment above). Held for
    // the ENTIRE `source === 'all'` cycle, including the post-steps below —
    // released right before every exit point in this function (`cycleLock` /
    // `releaseCycleLock` declared above the try block). Flag OFF, or
    // `source !== 'all'`: no-op (legacy behavior, unchanged).
    if (source === 'all' && FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER) {
      const lock = new DistributedLock(getRedisClient());
      const lockResult = await lock.acquire(CYCLE_LOCK_RESOURCE, { ttl: CYCLE_LOCK_TTL_MS });
      if (!lockResult.acquired) {
        logger.warn('Due-step cycle: previous cycle still running (scraper:cycle Redis lock held) — exiting 0 without doing anything');
        process.exit(0);
      }
      cycleLock = { lock, token: lockResult.token };

      // Round-3 M1: a 25-minute TTL is deliberately SHORTER than PM2's
      // 30-minute restart, so a killed cycle can never block the next one. A
      // cycle that is still alive proves it by extending the lock every 5
      // minutes (token-checked inside `extendLock`, so it can only ever extend
      // its OWN lock). `unref()` keeps this timer from holding the process open.
      if (lockResult.token) {
        const keepAliveToken = lockResult.token;
        cycleLockKeepAlive = setInterval(() => {
          lock.extendLock(CYCLE_LOCK_RESOURCE, keepAliveToken, CYCLE_LOCK_TTL_MS)
            .then((extended) => {
              if (!extended) {
                // Round-4 LOW: a `false` return means the token no longer owns
                // the lock (lost/expired) — this was previously ignored (only
                // the rejection path was handled), so the cycle kept writing
                // as if it still held the lock it had actually lost.
                lockLost = true;
                logger.error(
                  { resource: CYCLE_LOCK_RESOURCE },
                  'Due-step cycle: lock extend returned false — this cycle no longer holds the lock; stopping before the next step'
                );
              }
            })
            .catch((error: unknown) => {
              logger.debug(
                { error: error instanceof Error ? error.message : String(error) },
                'Due-step cycle: lock extend failed (non-fatal — TTL still covers the next interval)'
              );
            });
        }, CYCLE_LOCK_EXTEND_INTERVAL_MS);
        cycleLockKeepAlive.unref?.();
      }

      // Round-3 M1: PM2 sends SIGTERM before SIGKILL on `cron_restart`. Release
      // the lock on the way out so the next cycle starts immediately instead of
      // waiting for the TTL.
      // Round-4 LOW: the exit code used to be a hardcoded 0 regardless of
      // whether a step had already failed — a SIGTERM landing mid-cycle after
      // a recorded error reported "success" to PM2/the process supervisor.
      // Exit 1 when an error was already recorded; otherwise 130 (128 + SIGTERM's
      // signal number 2), the conventional "terminated by signal" exit code —
      // never a bare 0 for a signal-interrupted run.
      const onSignal = (signal: NodeJS.Signals) => {
        logger.warn({ signal }, 'Due-step cycle: signal received — releasing the cycle lock before exit');
        // `combinedResult` is declared just below this registration with no
        // `await` in between (synchronous code only) — a signal handler can
        // only ever fire on a later event-loop tick, after it is initialized.
        const hadError = combinedResult.errors.length > 0;
        const exitCode = hadError ? 1 : 130;
        // W-140: release document-cycle's extraction lock (registered via
        // registerHeldLock, held for up to FILING_EXTRACTION_LOCK_TTL_MS —
        // 45 minutes before OD-55, now the 2-hour hung-process ceiling plus
        // the anchor reserve plus slack) BEFORE the cycle lock and process.exit — process.exit
        // skips document-cycle.ts's own `finally` release, which used to
        // leave this lock held for its full TTL after any signal mid-cycle.
        // W-140 round 2 (W-152): both releases now go through a Redis call
        // each — a hung Redis would otherwise block process.exit forever.
        // Bounded via raceWithTimeout: exit proceeds with the SAME exit code
        // either way, since any lock left held still expires by its own TTL.
        const releaseTimeoutMs = Number(process.env.SIGNAL_LOCK_RELEASE_TIMEOUT_MS)
          || DEFAULT_SIGNAL_LOCK_RELEASE_TIMEOUT_MS;
        void raceWithTimeout(
          () => releaseHeldLocks().then(() => releaseCycleLock()),
          { timeoutMs: releaseTimeoutMs, label: 'lock release' }
        ).finally(() => process.exit(exitCode));
      };
      process.once('SIGTERM', onSignal);
      process.once('SIGINT', onSignal);
    }

    // S-02 §5 (ENABLE_DUE_STEP_SCHEDULER): when the flag is ON, the top-level
    // per-source blocks below are skipped for 'all' -- runDueStepCycle() owns
    // discovery/live/aggregator gating instead. With the flag OFF this is
    // exactly the legacy 'all' behavior (the rollback path).
    const runsLegacyAllPath = source === 'all' && !FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER;

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
    if (source === 'nse' || runsLegacyAllPath) {
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
    if (source === 'bse' || runsLegacyAllPath) {
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

    // Run Chittorgarh scraper
    if (source === 'chittorgarh' || runsLegacyAllPath) {
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
    if (source === 'fallback' || source === 'api' || runsLegacyAllPath) {
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
    if (source === 'gmp' || runsLegacyAllPath) {
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

    // S-02 §5: the due-step cycle runs INSTEAD of the flat per-source blocks
    // above (which are already gated off for 'all' when this flag is on —
    // see `runsLegacyAllPath`). It owns discovery/live/aggregator gating;
    // the post-steps block right below (unchanged) still runs unconditionally,
    // and already includes `stageReconciler` — design point (b) "reconcile
    // every cycle" needs no separate call here.
    if (source === 'all' && FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER) {
      // Round-3 H2: the cycle's step failures land in `combinedResult` exactly
      // like the legacy path's per-source results, so a cycle in which a source
      // threw exits non-zero instead of silently exiting 0.
      const dueStepResult = await runDueStepCycle(() => lockLost);
      combinedResult.success = combinedResult.success && dueStepResult.success;
      combinedResult.errors.push(...dueStepResult.errors);
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
      // Item 7 S3: closedIpoJob is no longer a post-step here — it runs as
      // its own `--job=closed` process (see runClosedIpoWake / main()).
      await runStep(cycleId, 'deployDriftMonitor', triggerDeployDriftMonitor);
      await runStep(cycleId, 'pruneScraperLogs', pruneScraperLogs);
      await runStep(cycleId, 'pruneDataConflicts', pruneDataConflicts);
      // T-195: data-quality watchdog core (freshness SLO + cross-source
      // disagreement report). Selector-degradation runs per-source inside
      // BaseScraperOrchestrator.run() itself, not here. Non-fatal, same
      // pattern as the other post-scrape side effects above.
      await runStep(cycleId, 'dataQualityWatchdog', triggerDataQualityWatchdog);
      // Item 21 slice 3 (OD-40). Placed after every step that can still WRITE
      // to an IPO, and before the heartbeat, which only reports. This step
      // DRAINS the touched-slug set, so running it earlier would refresh the
      // pages of a cycle that had not finished writing and leave the later
      // writes to wait out their timer - the exact delay it exists to remove.
      // (First draft put it second in the chain while its own comment claimed
      // it was last; the comment was right and the placement was wrong.)
      await runStep(cycleId, 'pageRevalidation', triggerPageRevalidation);

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
      await releaseCycleLock();
      process.exit(0);
    } else {
      logger.error('Scraper completed with errors');
      if (combinedResult.errors.length > 0) {
        logger.error({ errors: combinedResult.errors }, 'Error details');
      }
      await flushOwnerNotify();
      await releaseCycleLock();
      process.exit(1);
    }

  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Scraper CLI failed with unhandled error'
    );
    await flushOwnerNotify();
    await releaseCycleLock();
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

/**
 * Item 7 S2 (spec §2.1, OD-19): the Redis key stamped when a data-job slot's
 * document cycle (download + extraction + the pull walk, PASS 3) has
 * FINISHED. Stamped only when the cycle returned without exhausting its wake
 * budget, so an unfinished slot keeps going on the following wakes
 * (catch-up), and a finished slot does nothing until the next slot.
 */
export const DOCUMENT_CYCLE_LAST_RUN_KEY = 'due-step:last-document-cycle';

/**
 * Item 7 S2 review finding (LOW): the slot-stamp read already fails open
 * (slot treated as due) on a Redis ERROR, but a Redis that hangs instead of
 * erroring would block this wake indefinitely with no such warning. Bounds
 * the read so a hung Redis degrades to "treat as due" within one wake, same
 * as an explicit failure.
 */
const DOCUMENT_CYCLE_LAST_RUN_READ_TIMEOUT_MS = 2000;

interface DataJobRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
}

export interface PrimarySourceDiscoveryOptions {
  /** Test seam; production reads the clock. */
  now?: Date;
  /** Test seam; production reads FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER. */
  dueStepScheduler?: boolean;
  /** Test seam; production uses the shared client. */
  redis?: DataJobRedis;
}

export async function triggerPrimarySourceDiscovery(options: PrimarySourceDiscoveryOptions = {}): Promise<StepResult> {
  if (process.env.ENABLE_PRIMARY_SOURCE_DISCOVERY !== 'true') {
    return { status: 'skipped', reason: 'ENABLE_PRIMARY_SOURCE_DISCOVERY not true (§GATE)' };
  }

  // T-403 WP B. Two implementations behind one step, selected by a second flag,
  // so switching between them is one reversible env change and the state rows
  // survive the flip in either direction (matrix R13).
  //
  // The flag selects the IMPLEMENTATION, not every T-403 change: the classifier
  // fix is shared by both paths (see ENABLE_DOCUMENT_STATE_MACHINE's note), and
  // migration 0035 must be applied before the flag is turned on.
  if (process.env.ENABLE_DOCUMENT_STATE_MACHINE === 'true') {
    // Item 7 S2 (spec §2.1, OD-19): under the due-step scheduler this is part
    // of the DATA JOB, which runs at 00:00, 08:00 and 14:00 IST only — not on
    // every wake ("never re-read a document because time passed"). The flag-off
    // legacy path keeps its old per-wake behaviour, as the rollback path.
    const gated = options.dueStepScheduler ?? FEATURE_FLAGS.ENABLE_DUE_STEP_SCHEDULER;
    const now = options.now ?? new Date();
    const redis: DataJobRedis | null = gated ? (options.redis ?? (getRedisClient() as unknown as DataJobRedis)) : null;
    if (redis) {
      let lastRun: Date | null = null;
      try {
        const raw = await withTimeout(
          redis.get(DOCUMENT_CYCLE_LAST_RUN_KEY),
          DOCUMENT_CYCLE_LAST_RUN_READ_TIMEOUT_MS,
          'document-cycle last-run lookup'
        );
        lastRun = raw ? new Date(raw) : null;
        if (lastRun !== null && Number.isNaN(lastRun.getTime())) lastRun = null;
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Data job: document-cycle last-run lookup failed — treating the slot as due (fail open)'
        );
      }
      if (!isDiscoveryDue(now, lastRun)) {
        const slot = mostRecentDiscoverySlotLabel(now);
        logger.info(
          { slot, lastRun: lastRun?.toISOString() ?? null },
          'Data job not due at this wake — document cycle skipped (OD-19 slots 00:00/08:00/14:00 IST)'
        );
        return { status: 'skipped', reason: `data job not due: slot ${slot} already finished` };
      }
    }
    try {
      const summary = await runDocumentCycle();
      logger.info(summary, 'Document discovery cycle (state machine) complete');
      if (redis) {
        // Item 7 S2 (spec §2.1, OD-19/OD-33/OD-55, independent-review HIGH
        // finding): the slot is stamped finished ONLY when EVERY pass of this
        // cycle completed — `summary.slotComplete` — never on
        // `summary.budgetExhausted` alone, which reflects PASS 1 (discovery)
        // only. Extraction, field-plan generation and the field-plan walk can
        // each stop early on their own budget slice while `budgetExhausted`
        // stays false; stamping on that alone closed the slot on a wake that
        // had not actually finished the document cycle.
        if (!summary.slotComplete) {
          const slot = mostRecentDiscoverySlotLabel(now);
          logger.info(
            { slot, incompletePasses: summary.incompletePasses },
            `data job slot ${slot} incomplete: pass=${summary.incompletePasses.join(',') || 'unknown'} — continuing next wake`
          );
        } else {
          const slot = mostRecentDiscoverySlotLabel(now);
          try {
            await redis.set(DOCUMENT_CYCLE_LAST_RUN_KEY, now.toISOString());
            logger.info({ slot }, `data job slot ${slot} complete`);
          } catch (error) {
            logger.warn(
              { error: error instanceof Error ? error.message : String(error) },
              'Data job: document-cycle last-run stamp failed — the next wake will run it again'
            );
          }
        }
      }
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
 * Stamped onto every `closed_ipo_resourcing` row (§6.2, OD-78): the source-
 * RANKINGS fingerprint (rank lists + capable flags only) + EXTRACTOR version the
 * IPO was resourced under, derived at run time -- a ranking change or an
 * EXTRACTOR_VERSION bump re-opens every PARTIAL/FAILED IPO; any other manifest
 * edit re-opens none (review round 2 NEW-1).
 */
function currentClosedIpoResourcingVersion(): string {
  const manifest = loadFieldManifest();
  return closedIpoResourcingVersion({
    ranksHash: fieldManifestFingerprint(manifest.fields), // OD-82: the one shared fingerprint (ranks, capable, documentType)
    extractorVersion: EXTRACTOR_VERSION,
  });
}

/** Wall-clock budget for ONE closed IPO's walk. Ten of these fit in a cycle. */
const CLOSED_IPO_WALK_BUDGET_MS = 60_000;

/**
 * The real work behind one closed-IPO row -- OD-76 "plan, then walk". The
 * decision logic (plant if unplanned, then walk, never DONE without a walk)
 * lives in `resourceClosedIpo` (scheduler/closed-ipo-job.ts) where it is unit-
 * tested; this binds it to the REAL generator, repository and walk -- the same
 * three the document cycle uses for a live IPO. Not a stub: a stubbed writer
 * here would hide exactly the contract bugs this wiring can have (2026-09-16).
 */
async function resourceClosedIpoLive(ipoId: string): Promise<ClosedIpoResourceResult> {
  const redis = getRedisClient();
  const fieldPlanRepository = new IpoFieldPlanRepository(db as never, redis as never);
  const overrides = createFieldSourceOverridesReader(new FieldSourceOverridesRepository({ db: db as never }));

  const result = await resourceClosedIpo(ipoId, {
    countPlanRows: async (id) => {
      const [row] = await db.select({ n: count() }).from(ipoFieldPlan).where(eq(ipoFieldPlan.ipoId, id));
      return Number(row?.n ?? 0);
    },
    plantPlan: async (id) => {
      const [ipo] = await db
        .select({ id: ipos.id, segment: ipos.segment, listingExchanges: ipos.listingExchanges })
        .from(ipos)
        .where(eq(ipos.id, id));
      if (!ipo) throw new Error(`IPO ${id} not found`);
      return plantFieldPlanForIpo(
        {
          id: ipo.id,
          segment: (ipo.segment as 'MAINBOARD' | 'SME' | null) ?? null,
          listingExchanges: (ipo.listingExchanges as ('NSE' | 'BSE')[] | null) ?? null,
        },
        { overrides, fieldPlanRepository: fieldPlanRepository as never }
      );
    },
    // Round 4 M-2: the ONE settlement query (stored + unsettled, state NOT IN the
    // exported terminal list), shared with the integration test and the repair tool.
    readPlanSettlement: (id) => readPlanSettlement(db as never, id),
    walk: async (id) => {
      const startedAt = Date.now();
      const sourceFetchers = buildFieldPlanWalkFetchers();
      return walkFieldPlanForIPO(
        id,
        {
          fieldPlanRepository: fieldPlanRepository as never,
          orchestrator: buildFieldPlanWalkOrchestrator(),
          sourceFetchers,
          // #884 / OD-78: a gap row is not re-asked under the same key (same cause, same outcome).
          gapKeys: buildFieldPlanGapKeySource({ fetchers: sourceFetchers, extractorVersion: EXTRACTOR_VERSION }),
          ipoRepository: new IPORepository(db as never, redis as never) as never,
          overrides,
          trackWitnessVerdict: buildFieldPlanWalkWitnessVerdictWriter(),
        },
        { deadlineMs: startedAt + CLOSED_IPO_WALK_BUDGET_MS, now: () => Date.now() }
      );
    },
  });

  logger.info({ ipoId, ...result }, 'closed-IPO job: plan-then-walk complete for one IPO');
  return result;
}

/**
 * Item 17 (OD-22) / item 7 S3: the closed-IPO job's cadence key.
 *
 * WHY THE JOB EXISTS, measured on staging 2026-09-20 rather than assumed: 74
 * PROSPECTUS documents sit `extraction_status = PENDING`, one each on 74
 * distinct LISTED IPOs, the oldest filed 2026-06-15. Ten documents of the SAME
 * type on the SAME status are COMPLETED and PROSPECTUS is in
 * `EXTRACTABLE_DOC_TYPES`, so the extractor is not the gap. LISTED IPOs DO
 * enter the document cycle's candidate set, but behind `getListedCap()`
 * (default 2 per cycle) and behind every live-lifecycle row — so a prospectus
 * filed after the DRHP/RHP-era pass waits behind a queue that never empties.
 * This job is the second visit nothing else makes. (#717)
 *
 * S3 moved the call site OUT of the data cycle's post-steps and into its own
 * process (`runClosedIpoWake`, above, called from `main()` on `--job=closed`)
 * — see that function's doc comment for where the cycle-lock exclusion now
 * lives. These two constants stay module-level because both the old in-cycle
 * caller and the new standalone one read/stamp the SAME Redis cadence key —
 * two closed-IPO runs on the same 22:00 boundary would double-attempt the
 * cap.
 *
 * SCHEDULE: one 22:00-IST boundary per day (`isClosedIpoJobDue`), catch-up-safe.
 */
const CLOSED_IPO_JOB_CADENCE_KEY = 'closed-ipo-job';
/** TTL only — the boundary check, not this number, decides whether to run. */
const CLOSED_IPO_JOB_CADENCE_TTL_MINUTES = 24 * 60;

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
  // Item 2 slice 4: MUST run before main() — see validateFieldManifestAtStartup's
  // doc comment. A malformed manifest (flag ON) throws synchronously here and
  // main() never runs, so no cycle-start log line is ever emitted.
  validateFieldManifestAtStartup();
  // Item 3 slice S1b: same contract, same reason — a malformed switchover.json fails loudly here.
  validateSwitchoverAtStartup();
  // Item 4 slice 1: same contract, same reason — malformed rules fail loudly here.
  validateValidationRulesAtStartup();
  main();
}
