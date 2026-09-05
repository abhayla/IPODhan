/**
 * The per-cycle document step — T-403 WP B wiring.
 *
 * This is what `scraper/src/index.ts`'s `primarySourceDiscovery` step calls when
 * `ENABLE_DOCUMENT_STATE_MACHINE` is on. It is a separate module rather than
 * inline in `index.ts` so the query -> plan -> run -> log flow is unit-testable
 * without booting the whole one-shot cycle.
 *
 * Cadence: EVERY cycle (30 min), not once a day. That is the point. The old step
 * was daily because it re-fetched NSE for every candidate IPO unconditionally,
 * so running it per cycle would have been 48x the traffic for no new data. With
 * the state machine deciding what is outstanding, a cycle where nothing has
 * changed costs zero requests, so there is no reason to wait a day to notice
 * that a Prospectus has been filed.
 *
 * Logging contract (decision-matrix §7.4): the attempt json goes on each state
 * row, the step ledger row is written by `index.ts`'s `runStep` wrapper with the
 * counts this function returns in `reason`, and one `scraper_logs` row per cycle
 * with `source='DOCUMENTS'` is written here so the existing metrics tracker and
 * alert thresholds cover documents like any other source.
 */

import { sql } from 'drizzle-orm';
import { db, getRedisClient } from '@ipodhan/shared';
import { DocumentRepository, DocumentFetchStateRepository, IPORepository, IpoPipelineStepsRepository } from '@ipodhan/shared';
import { recordBseDiscoveryMetadata, recordDocumentSourceHints } from './data-persister.js';
import { scraperLogs } from '@ipodhan/shared/db/schema';
import logger from '../utils/logger.js';
import {
  DocumentDiscoveryRunner,
  defaultFetcher,
  toStateRow,
  type DiscoveryIpo,
  type IpoRunResult,
} from './document-discovery-runner.js';
import { NetworkCounter } from '../utils/network-counter.js';
import { isVerifierUrl } from './company-host-source.js';
import { deriveLifecycleStage } from '../scheduler/stage-reconciler.js';
import { isInLiveWindow, CYCLE_BUDGET, planIpoCycle, type IssueShape } from './document-state-machine.js';
import type { DocumentFetchStateRow } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import {
  decidePurge,
  purgeIpoDocuments,
  getRetentionDays,
  getMaxRetentionDays,
  hasStoredFile,
  getStoreDir,
} from './document-store.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { initStepLedger } from './step-ledger.js';
import { recordDocumentRunSteps } from './step-ledger-recorders.js';
import {
  processPendingFilings,
  buildAutoPersistDeps,
  DEFAULT_MAX_SPAWNS_PER_CYCLE,
  anchorMaxSpawnsPerCycle,
  type AutoPersistDeps,
  type SpawnBudget,
  FILING_EXTRACTION_LOCK_TTL_MS,
} from './filing-auto-persist.js';
import { DistributedLock } from '../utils/distributed-lock.js';

/** MAJOR-1: key + TTL for the cycle-level extraction lock (document-cycle.ts). */
const FILING_EXTRACTION_LOCK_KEY = 'filing-auto-persist:cycle';
/**
 * W-168 round 2: moved to `filing-auto-persist.ts` (re-exported here
 * unchanged for existing importers) so `anchorMaxSpawnsPerCycle()` can clamp
 * against it without a circular import between the two modules. Still the
 * SAME constant the F3 static test checks: `DEFAULT_MAX_SPAWNS_PER_CYCLE *
 * EXTRACT_TIMEOUT_MS` (worst case, every spawn takes the full extractor
 * timeout) plus the anchor pass's own worst case plus slack MUST stay under
 * this TTL, or a future cap raise could let extraction keep running after
 * the lock protecting it from a second overlapping cycle has already expired.
 */
export { FILING_EXTRACTION_LOCK_TTL_MS };

/**
 * W-140: registry of Redis locks currently held by an in-flight document
 * cycle, so a signal handler in `index.ts` (SIGTERM/SIGINT, which calls
 * `process.exit` and therefore skips this file's `finally` block below) can
 * still release them before the process dies. Without this, a deploy that
 * signals a running cycle leaves `FILING_EXTRACTION_LOCK_KEY` held for the
 * full 45-minute TTL, starving the next two cycles' extraction step.
 *
 * `registerHeldLock`/`unregisterHeldLock` are called right around the same
 * acquire/finally-release pair that already manages the lock's lifecycle —
 * this registry never changes when or whether the lock is released on the
 * normal path, it only gives the signal path a way to do the same release.
 */
const heldLocks: Array<{ key: string; token: string }> = [];

export function registerHeldLock(key: string, token: string): void {
  heldLocks.push({ key, token });
}

export function unregisterHeldLock(key: string, token: string): void {
  const index = heldLocks.findIndex((entry) => entry.key === key && entry.token === token);
  if (index !== -1) {
    heldLocks.splice(index, 1);
  }
}

/**
 * Release every lock currently in the registry — token-checked (so it can
 * only ever release a lock this process actually acquired), swallows errors
 * (the TTL is the fallback), and logs one line per lock released. Idempotent:
 * calling it with an empty registry (nothing held, or already released) is a
 * no-op.
 */
export async function releaseHeldLocks(): Promise<void> {
  if (heldLocks.length === 0) return;
  const toRelease = heldLocks.splice(0, heldLocks.length);
  const redis = getRedisClient();
  const lock = new DistributedLock(redis as never);
  for (const { key, token } of toRelease) {
    try {
      const released = await lock.release(key, token);
      logger.warn({ key, released }, 'Signal path: released held lock before exit');
    } catch (error) {
      logger.warn(
        { key, error: error instanceof Error ? error.message : String(error) },
        'Signal path: failed to release held lock (non-fatal — it will expire via TTL)'
      );
    }
  }
}

/**
 * W-102: whole-extraction-pass (PASS 2) wall-clock ceiling across all
 * candidate IPOs, checked BETWEEN IPOs (never interrupting a
 * `processPendingFilings` call already in flight) — python extraction runs
 * (minutes, not milliseconds) must never be charged against
 * `CYCLE_BUDGET.DISCOVERY_MS`, but they still need a ceiling so pass 2 cannot
 * run unbounded inside a 30-minute cron cycle. Local to this file (not
 * `CYCLE_BUDGET` in document-state-machine.ts) — this round's touch-scope
 * kept that file untouched.
 */
const DEFAULT_EXTRACTION_BUDGET_MS = 25 * 60 * 1000;

export interface DocumentCycleSummary {
  ipos: number;
  skipped: number;
  found: number;
  notYetFiled: number;
  blocked: number;
  networkCalls: number;
  durationMs: number;
  budgetExhausted: boolean;
  /** S-02 round 4 item 7: documents in MANUAL_REVIEW among this cycle's candidate IPOs. */
  extractionBlocked: number;
  /** S-02 round 4 item 7: documents currently FAILED among this cycle's candidate IPOs. */
  extractionFailed: number;
  /**
   * W-122: the per-cycle LISTED-backfill cap in effect this cycle
   * (`DOCUMENT_CYCLE_LISTED_CAP`, default 2 — see `getListedCap()`). Never
   * caps OPEN/CLOSED/UPCOMING/WITHDRAWN/POSTPONED candidates.
   */
  listedCap: number;
  /**
   * W-122: LISTED candidates present this cycle but deferred past the cap —
   * they are simply not offered to `runIpo` this cycle; the state table
   * remembers where each one is, so they are picked up (in the same
   * most-recent-first order) on a later cycle once OPEN/CLOSED/UPCOMING work
   * is caught up.
   */
  listedDeferred: number;
  /**
   * W-124 round 2 (MAJOR-1): LISTED candidates whose documents are already
   * FOUND/NOT_APPLICABLE/SUPERSEDED (or every open row still in backoff) this
   * cycle — `alreadyComplete === true`. These never enter `candidates` at all
   * (they need no work), so PASS 1/2 and the F4 tally never see them and they
   * never spend a cap slot.
   */
  listedComplete: number;
  /**
   * W-124 round 2 (MAJOR-2) / W-135: LISTED candidates `enrichListedCandidates`
   * actually visited this cycle. Visiting continues until either `listedCap *
   * 4` INCOMPLETE rows have been found (complete rows are visited/enriched
   * but do not consume this bound — W-135) or the absolute
   * `LISTED_ENRICH_VISIT_CEILING` (200) total visits is hit, whichever comes
   * first.
   */
  listedEnriched: number;
  /**
   * W-124 round 2 (MAJOR-2) / W-135: LISTED candidates present this cycle but
   * never visited by `enrichListedCandidates` — i.e. past whichever bound
   * (`listedCap * 4` incomplete rows found, or the `LISTED_ENRICH_VISIT_CEILING`
   * total-visit ceiling) was hit first. Their rotation/completeness is
   * unknown, so they are deferred whole, same as a capped-out row, until an
   * earlier LISTED row rotates out of the way.
   */
  listedSkippedUnenriched: number;
}

/** `ipos=4 skipped=2 found=3 not_yet=1 blocked=0 calls=5 extraction_blocked=0 extraction_failed=0` — the ledger `reason`. */
export function formatCycleReason(s: DocumentCycleSummary): string {
  return (
    `ipos=${s.ipos} skipped=${s.skipped} found=${s.found} not_yet=${s.notYetFiled} ` +
    `blocked=${s.blocked} calls=${s.networkCalls} extraction_blocked=${s.extractionBlocked} ` +
    `extraction_failed=${s.extractionFailed}${s.budgetExhausted ? ' budget=exhausted' : ''}`
  );
}

/** Aggregate per-IPO results into the one line the ledger and audit read. */
export function summarize(
  results: IpoRunResult[],
  durationMs: number,
  budgetExhausted = false,
  extraction: { blocked: number; failed: number } = { blocked: 0, failed: 0 },
  listedInfo: {
    cap: number;
    deferred: number;
    complete?: number;
    enriched?: number;
    skippedUnenriched?: number;
  } = { cap: 0, deferred: 0 }
): DocumentCycleSummary {
  return {
    ipos: results.length,
    skipped: results.filter((r) => r.skipped).length,
    found: results.reduce((n, r) => n + r.found.length, 0),
    notYetFiled: results.reduce((n, r) => n + r.notYetFiled.length, 0),
    blocked: results.reduce((n, r) => n + r.blocked.length, 0),
    networkCalls: results.reduce((n, r) => n + r.networkCalls, 0),
    durationMs,
    budgetExhausted,
    extractionBlocked: extraction.blocked,
    extractionFailed: extraction.failed,
    listedCap: listedInfo.cap,
    listedDeferred: listedInfo.deferred,
    listedComplete: listedInfo.complete ?? 0,
    listedEnriched: listedInfo.enriched ?? 0,
    listedSkippedUnenriched: listedInfo.skippedUnenriched ?? 0,
  };
}

/**
 * What we know about the issue that makes some document types impossible (R9/F15).
 *
 * The first cut never populated this, so `notApplicableTypes` could never fire:
 * a fixed-price issue would be asked for a PRICE_BAND_AD and an anchor report
 * every 30 minutes forever, find neither, and eventually drift into BLOCKED_ALL
 * — a self-inflicted alert that would drown the real ones.
 *
 * `isFixedPrice` is derived from the band we already store: a fixed-price issue
 * has one price, so min === max (and a book-built issue never does). The BSE
 * board's `IR_FLAG_FULL` refines this inside the runner when it is fetched, but
 * that arrives after the plan is computed, so the DB-derived value is what makes
 * the FIRST cycle correct.
 */
export function deriveIssueShape(row: Record<string, unknown>): IssueShape {
  const status = String(row.status ?? '').toUpperCase();
  const min = row.price_range_min === null || row.price_range_min === undefined ? null : Number(row.price_range_min);
  const max = row.price_range_max === null || row.price_range_max === undefined ? null : Number(row.price_range_max);
  const isFixedPrice =
    min !== null && max !== null && Number.isFinite(min) && Number.isFinite(max) && min > 0 && min === max;
  return {
    isFixedPrice,
    withdrawn: status === 'WITHDRAWN' || status === 'POSTPONED',
  };
}

/**
 * W-122: default LISTED-backfill cap per cycle, when
 * `DOCUMENT_CYCLE_LISTED_CAP` is unset/blank/invalid.
 */
export const DEFAULT_LISTED_CAP = 2;

/**
 * W-122: parse `DOCUMENT_CYCLE_LISTED_CAP` safely — a non-negative integer,
 * `0` meaning "no LISTED backfill at all this cycle". Any missing/blank/
 * non-numeric/negative value falls back to `DEFAULT_LISTED_CAP` rather than
 * producing `NaN` or a silently-unbounded cap.
 */
export function getListedCap(): number {
  const raw = process.env.DOCUMENT_CYCLE_LISTED_CAP;
  if (raw === undefined || raw.trim() === '') return DEFAULT_LISTED_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LISTED_CAP;
  return Math.trunc(n);
}

/**
 * W-135: absolute safety ceiling on how many LISTED rows
 * `enrichListedCandidates` will VISIT in one cycle, independent of the
 * `maxToEnrich` (incomplete-row) bound. Without it, a cycle where every
 * LISTED row in the backlog happens to be complete would keep visiting rows
 * forever looking for `maxToEnrich` incomplete ones, re-introducing the
 * unbounded N+1 (`store.listForIpo` per row) MAJOR-2 was meant to prevent.
 */
export const LISTED_ENRICH_VISIT_CEILING = 200;

/**
 * W-122: lifecycle urgency rank. Lower sorts first.
 *
 * OPEN and CLOSED are time-critical (an OPEN issue's PRICE_BAND_AD/anchor
 * report is only available while it is live; a CLOSED issue's Prospectus
 * becomes due the moment it leaves the board). UPCOMING is next — nothing is
 * overdue yet, ordered by how soon it opens. LISTED is backfill: real, but
 * never urgent, so it must never crowd out a live issue's budget slot again
 * (the Deepa Jewellers incident this fixes). WITHDRAWN/POSTPONED only need one
 * visit to close their rows as NOT_APPLICABLE (F15/M3) — last, always.
 */
function lifecycleRank(ipo: Pick<DiscoveryIpo, 'stage' | 'issue'>): number {
  if (ipo.issue?.withdrawn) return 4;
  switch (ipo.stage) {
    case 'OPEN':
      return 0;
    case 'CLOSED':
      return 1;
    case 'LISTED':
      return 3;
    case 'UPCOMING':
    case 'PRE_OPEN':
    default:
      return 2;
  }
}

/**
 * Sortable "YYYY-MM-DD" key for a `date`-column value that may arrive here as
 * either a `Date` instance or a date-only string, depending on the pg
 * driver's parser config — WITHOUT ever running a raw string through
 * `new Date(...)` (T-327: that parses at LOCAL midnight, then a later
 * `.toISOString()`/`.getTime()` read shifts the calendar date a day on any
 * host whose process TZ isn't UTC, e.g. prod PM2 on Asia/Kolkata — see
 * `.claude/rules/utc-naive-timestamp-normalization.md`).
 *
 * A `Date` instance is read with its UTC getters (safe: formatting an
 * already-constructed Date, not parsing a string). A string is matched for
 * its leading `YYYY-MM-DD` and returned as-is — lexical comparison on that
 * prefix is chronological order, so no numeric conversion is needed at all.
 */
function dateSortKey(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const match = String(value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Present dates sort before null/unparsable ones, in either direction (nulls always last). */
function compareByDate(aDate: unknown, bDate: unknown, direction: 'asc' | 'desc'): number {
  const aKey = dateSortKey(aDate);
  const bKey = dateSortKey(bDate);
  if (aKey === null || bKey === null) {
    if (aKey === bKey) return 0;
    return aKey === null ? 1 : -1;
  }
  if (aKey === bKey) return 0;
  const cmp = aKey < bKey ? -1 : 1;
  return direction === 'asc' ? cmp : -cmp;
}

/**
 * Sortable millisecond epoch for a `lastActivityAt`-shaped value, or `null`
 * when there is nothing to compare (never touched).
 */
function activityTimeKey(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(String(value)).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * W-124: LISTED-tier rotation comparator — least-recently-touched first.
 *
 * `null` (never attempted this IPO's documents at all) sorts before every
 * timestamp, so a LISTED row that has NEVER been offered to `runIpo` always
 * gets first crack at the cap. Two non-null timestamps sort ascending (the
 * longer-ago one first), so a row processed this cycle — which bumps its
 * `last_attempt_at` — sinks to the back of the LISTED queue next cycle.
 */
function compareByActivity(aVal: unknown, bVal: unknown): number {
  const aTime = activityTimeKey(aVal);
  const bTime = activityTimeKey(bVal);
  if (aTime === null && bTime === null) return 0;
  if (aTime === null) return -1;
  if (bTime === null) return 1;
  return aTime - bTime;
}

/**
 * W-122/W-124: order candidates by lifecycle urgency and cap how many LISTED
 * (backfill) candidates pass 1/pass 2 get to see this cycle.
 *
 * This is the SOURCE OF TRUTH for the order (unit-tested here without a
 * database); `loadCandidateIpos`'s SQL `ORDER BY` is written to already
 * produce the same order so a slow/degraded DB round-trip is never the
 * reason a live IPO's row sits behind stale LISTED backfill, but this
 * function is what actually decides — and is what the tests exercise.
 *
 * Guarantees this function makes (W-124, replacing the W-122 comment that
 * overstated fairness — the LISTED order used to be listing-date-desc ONLY,
 * so the same most-recent rows won the cap every cycle and rows below them
 * never got a turn while they stayed incomplete):
 *
 *   1. Within OPEN/CLOSED, urgency rank always wins (unchanged from W-122).
 *   2. Within LISTED, rows ROTATE: least-recently-touched first
 *      (`lastActivityAt` ascending, `null` = never touched sorts first),
 *      tie-broken by `listingDate` descending. A LISTED row `runIpo` actually
 *      processes this cycle sinks to the back of the LISTED queue next cycle,
 *      so every LISTED row eventually gets a turn instead of the newest
 *      listings permanently starving the older ones.
 *   3. The per-cycle LISTED cap (`cap`) is charged ONLY against LISTED rows
 *      that are NOT already complete (`alreadyComplete !== true` — i.e.
 *      `planIpoCycle(...).skipIpo` is false, so `runIpo` would actually make
 *      network calls for it). A LISTED row whose documents are already
 *      FOUND/NOT_APPLICABLE/SUPERSEDED (or still in retry backoff) costs zero
 *      network calls either way, so it is never charged against the cap —
 *      and (W-124 round 2, MAJOR-1) it never enters `candidates` at all; it
 *      is counted in the returned `listedComplete` instead, so PASS 1/2 and
 *      the F4 extraction tally never spend a DB round trip on it.
 *   4. The cap NEVER removes OPEN/CLOSED/UPCOMING/WITHDRAWN/POSTPONED
 *      candidates — only an incomplete LISTED candidate is ever deferred.
 *   5. Reserving a slot for the WITHDRAWN/POSTPONED purge path against the
 *      wall-clock discovery budget is `runDocumentCycle`'s job (this
 *      function has no budget concept) — see the purge-reservation comment
 *      there.
 */
export function orderAndCapCandidates(
  candidates: DiscoveryIpo[],
  cap: number
): { candidates: DiscoveryIpo[]; listedDeferred: number; listedComplete: number } {
  const safeCap = Number.isFinite(cap) && cap >= 0 ? Math.trunc(cap) : DEFAULT_LISTED_CAP;

  const ordered = candidates
    .map((c, idx) => ({ c, idx }))
    .sort((a, b) => {
      const ra = lifecycleRank(a.c);
      const rb = lifecycleRank(b.c);
      if (ra !== rb) return ra - rb;
      if (ra === 2) {
        const byOpenDate = compareByDate(a.c.openDate, b.c.openDate, 'asc');
        if (byOpenDate !== 0) return byOpenDate;
      } else if (ra === 3) {
        const byActivity = compareByActivity(a.c.lastActivityAt, b.c.lastActivityAt);
        if (byActivity !== 0) return byActivity;
        const byListingDate = compareByDate(a.c.listingDate, b.c.listingDate, 'desc');
        if (byListingDate !== 0) return byListingDate;
      }
      // Stable tie-break so the order never reshuffles cycle to cycle for
      // candidates with the same rank and date.
      const byId = a.c.id.localeCompare(b.c.id);
      return byId !== 0 ? byId : a.idx - b.idx;
    })
    .map((x) => x.c);

  let listedSeen = 0;
  let listedDeferred = 0;
  let listedComplete = 0;
  const capped: DiscoveryIpo[] = [];
  for (const c of ordered) {
    if (lifecycleRank(c) === 3) {
      // W-124 round 2 (MAJOR-1): a LISTED row with nothing due this cycle
      // costs zero network calls, and (unlike the round-1 fix) it does not
      // even enter `candidates` any more — there is no work for PASS 1, PASS
      // 2, or the F4 tally to do for it, so counting it here (never charging
      // it against the cap) is a CONSEQUENCE of skipping it, not a reason to
      // pass it through.
      if (c.alreadyComplete === true) {
        listedComplete++;
        continue;
      }
      if (listedSeen < safeCap) {
        capped.push(c);
        listedSeen++;
      } else {
        listedDeferred++;
      }
    } else {
      capped.push(c);
    }
  }
  return { candidates: capped, listedDeferred, listedComplete };
}

/**
 * W-124: enrich each LISTED candidate with the two facts `orderAndCapCandidates`
 * needs that no plain `ipos` row carries — its rotation timestamp and whether
 * it is already complete — then decide `alreadyComplete` (no `runIpo` call for
 * it can cost a network request either way, so it must never spend a cap slot).
 *
 * `lastActivityAt` is the newest `document_fetch_state.last_attempt_at` across
 * the IPO's doc-type rows (the persisted per-IPO fetch state the cycle already
 * keeps). When the IPO has no fetch-state rows with an attempt yet at all
 * (`store.listForIpo` returns none, or every row's `last_attempt_at` is null —
 * e.g. a LISTED row whose doc-type rows were only ever created, never
 * attempted), that is NOT "never touched": it falls back to the newest
 * `documents.updated_at` for the IPO as a proxy (`lastActivityIsProxy: true`)
 * so a row this cycle actually fetched something for still rotates behind one
 * that genuinely has nothing on file. Only `null` (no fetch-state attempts AND
 * no documents at all) means "never touched".
 *
 * Runs ONLY over LISTED candidates (bounded by the live window already
 * applied above) — OPEN/CLOSED/UPCOMING/WITHDRAWN/POSTPONED never rotate or
 * cap, so enriching them would be pure waste.
 *
 * W-124 round 2 (MAJOR-2): also bounded to at most `maxToEnrich` LISTED
 * candidates (`listedCap * 4` — see `loadCandidateIpos`) rather than every
 * LISTED row in the live window. Each LISTED row costs 1-2 remote DB round
 * trips here (`store.listForIpo` + a `documents.findByIPO` fallback), run
 * BEFORE the discovery budget clock even starts; the per-cycle cap only ever
 * admits `cap` incomplete LISTED rows anyway, so scanning far more than
 * `cap` gives the rotation enough margin to find `cap` eligible rows without
 * paying an unbounded N+1 for a backlog the cap could never use in one
 * cycle.
 *
 * W-135: `maxToEnrich` counts only INCOMPLETE rows (`plan.skipIpo === false`)
 * — a row this function finds already complete is still enriched (so
 * `listedComplete` stays accurate) but does NOT consume the bound. Round-2's
 * original "stop at maxToEnrich visited" let the newest LISTED rows fill the
 * whole bound forever once THEY became complete, starving every older LISTED
 * row behind them of enrichment (and therefore of a cap slot) for as long as
 * they stayed in the live window — seen live on the 2026-09-04 staging soak
 * (`listedEnriched 8, listedComplete 0` every cycle, 9 older rows stuck at
 * `listedSkippedUnenriched`). An absolute `LISTED_ENRICH_VISIT_CEILING` still
 * bounds total rows VISITED, so a backlog that happens to be entirely
 * complete cannot re-introduce an unbounded N+1 while searching for
 * incomplete rows that do not exist. `candidates` is already ordered
 * lifecycle-rank-first then (within LISTED) listing-date-desc — the SQL's own
 * order — so iterating in place enriches that "listing_date desc then id"
 * prefix up to whichever bound is hit first. LISTED rows never visited are
 * left un-enriched; the caller drops them from `candidates` entirely (counted
 * as `listedSkippedUnenriched`) since their rotation/completeness is unknown.
 *
 * Also stores the computed `CyclePlan` on `c.precomputedPlan` (MAJOR-2) so
 * `runIpo` does not run `planIpoCycle` a second time for the same rows.
 */
async function enrichListedCandidates(
  candidates: DiscoveryIpo[],
  deps: {
    store: Pick<DocumentFetchStateRepository, 'listForIpo'>;
    documents: Pick<DocumentRepository, 'findByIPO'>;
  },
  maxToEnrich: number
): Promise<{ enriched: number }> {
  let enriched = 0; // total rows VISITED (complete + incomplete) — the return value
  let incompleteSeen = 0; // rows that actually consume the maxToEnrich bound
  const visitCeiling = Math.max(maxToEnrich, LISTED_ENRICH_VISIT_CEILING);
  for (const c of candidates) {
    if (c.stage !== 'LISTED') continue;
    if (incompleteSeen >= maxToEnrich) break;
    if (enriched >= visitCeiling) break;

    const persisted = await deps.store.listForIpo(c.id);
    const rows = persisted.map(toStateRow);

    let lastAttemptAt: Date | null = null;
    for (const row of rows) {
      const at = row.lastAttemptAt;
      if (at && (!lastAttemptAt || at.getTime() > lastAttemptAt.getTime())) {
        lastAttemptAt = at;
      }
    }

    if (lastAttemptAt) {
      c.lastActivityAt = lastAttemptAt;
      c.lastActivityIsProxy = false;
    } else {
      let proxy: Date | null = null;
      try {
        for (const d of await deps.documents.findByIPO(c.id)) {
          const at = (d as { updatedAt?: Date | null }).updatedAt ?? null;
          if (at && (!proxy || at.getTime() > proxy.getTime())) proxy = at;
        }
      } catch (error) {
        // Non-fatal: without the proxy this row is simply treated as "never
        // touched" (sorts first), which is the safe default, not a crash.
        logger.warn(
          { ipoId: c.id, error: error instanceof Error ? error.message : String(error) },
          'W-124: could not load documents.updated_at proxy for LISTED rotation (non-fatal)'
        );
      }
      c.lastActivityAt = proxy;
      c.lastActivityIsProxy = proxy !== null;
    }

    const plan = planIpoCycle({ stage: c.stage, rows, issue: c.issue });
    c.alreadyComplete = plan.skipIpo;
    c.precomputedPlan = plan;
    enriched++;
    if (!plan.skipIpo) incompleteSeen++;
  }
  return { enriched };
}

/**
 * W-153: candidate IPOs query, with the LISTED-tier order now rotation-aware.
 *
 * Root cause (W-144): `enrichListedCandidates` bounds its scan to
 * `listedCap * 4` INCOMPLETE LISTED rows (W-135) — a hard requirement, kept
 * exactly as-is here. Before this fix, the rows it scanned were whichever
 * ones this query's `ORDER BY` happened to put first — `listing_date DESC`,
 * a fixed, never-changing order. When more than `listedCap * 4` LISTED rows
 * are simultaneously incomplete, that scan visits the SAME newest-by-listing-
 * date rows every cycle forever; anything past the bound is silently dropped
 * as `listedSkippedUnenriched` and never gets a turn.
 *
 * Fix: a LEFT JOIN aggregates each ipo's most recent
 * `document_fetch_state.last_attempt_at`, and the LISTED tier now orders by
 * that value ASCENDING with NULLS FIRST — a LISTED row that has never been
 * attempted (no fetch-state rows at all) sorts first, exactly the same
 * "never touched wins the turn" rule `orderAndCapCandidates`'s comparator
 * already applies once a row IS scanned (W-124). `listing_date DESC` is now
 * only the tie-break for two rows with the same last-activity value (both
 * never touched, or touched in the same cycle) — it no longer decides which
 * rows are even reachable. The JOIN is a single aggregate over
 * `document_fetch_state`, computed once per cycle by Postgres, not an N+1 —
 * it costs nothing extra over the previous single-table query.
 *
 * `enrichListedCandidates` itself is UNCHANGED: it still scans the incoming
 * array in order up to the same `listedCap * 4` bound. What changed is which
 * rows arrive in that first `listedCap * 4` slice.
 */
export const CANDIDATE_IPOS_SQL = `
    SELECT i.id, i.company_name, i.slug, i.symbol, i.segment, i.status, i.price_range_min,
           i.price_range_max, i.open_date, i.listing_date, i.bse_ipo_no,
           i.company_website, i.verifier_url
      FROM ipos i
      LEFT JOIN (
        SELECT ipo_id, MAX(last_attempt_at) AS last_activity
          FROM document_fetch_state
         GROUP BY ipo_id
      ) dfs ON dfs.ipo_id = i.id
     WHERE i.offering_type = 'IPO'
       AND i.status IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED', 'WITHDRAWN', 'POSTPONED')
     ORDER BY
       CASE
         WHEN upper(i.status::text) IN ('WITHDRAWN', 'POSTPONED') THEN 4
         WHEN upper(i.status::text) = 'OPEN' THEN 0
         WHEN upper(i.status::text) = 'CLOSED' THEN 1
         WHEN upper(i.status::text) = 'LISTED' THEN 3
         ELSE 2
       END,
       -- W-153: LISTED rotation order -- least-recently-touched first (NULL =
       -- never touched sorts first), listing_date DESC only breaks ties.
       -- The app layer (enrichListedCandidates/orderAndCapCandidates)
       -- remains the source of truth once a row's real fetch-state rows are
       -- read; this ordering only decides which rows are reachable within
       -- the W-135 enrichment bound.
       CASE WHEN upper(i.status::text) = 'LISTED' THEN dfs.last_activity END ASC NULLS FIRST,
       CASE WHEN upper(i.status::text) = 'LISTED' THEN i.listing_date END DESC NULLS LAST,
       CASE WHEN upper(i.status::text) NOT IN ('LISTED', 'OPEN', 'CLOSED', 'WITHDRAWN', 'POSTPONED')
            THEN i.open_date END ASC NULLS LAST,
       i.id
`;

/** Candidate IPOs: live-window only (R10 — history is WP F's job, not the cycle's). */
export async function loadCandidateIpos(deps: {
  store: Pick<DocumentFetchStateRepository, 'listForIpo'>;
  documents: Pick<DocumentRepository, 'findByIPO'>;
}): Promise<{
  candidates: DiscoveryIpo[];
  listedCap: number;
  listedDeferred: number;
  listedComplete: number;
  listedEnriched: number;
  listedSkippedUnenriched: number;
}> {
  const result = await db.execute(sql.raw(CANDIDATE_IPOS_SQL));
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  const candidates: DiscoveryIpo[] = rows
    .filter((r) => {
      // A WITHDRAWN/POSTPONED issue is outside the live window but must still be
      // visited once, to close its open rows as NOT_APPLICABLE (F15/M3).
      const status = String(r.status ?? '').toUpperCase();
      if (status === 'WITHDRAWN' || status === 'POSTPONED') return true;
      return isInLiveWindow({
        status: r.status as string | null,
        listingDate: (r.listing_date as Date | null) ?? null,
      });
    })
    .map((r) => ({
      id: String(r.id),
      companyName: String(r.company_name ?? ''),
      slug: (r.slug as string | null) ?? null,
      symbol: (r.symbol as string | null) ?? null,
      segment: (r.segment as string | null) ?? null,
      stage: deriveLifecycleStage({
        status: r.status as string | null,
        priceRangeMin: (r.price_range_min as string | null) ?? null,
      }),
      bseIpoNo: r.bse_ipo_no === null || r.bse_ipo_no === undefined ? null : Number(r.bse_ipo_no),
      companyWebsite: (r.company_website as string | null) ?? null,
      // T-403 r5 (3): validated on the READ, not only on the write. The column
      // is reachable by a backfill, an admin edit or a future scraper, and the
      // verifier rung fetches whatever is in it.
      verifierUrl: isVerifierUrl(r.verifier_url as string | null)
        ? String(r.verifier_url).trim()
        : null,
      issue: deriveIssueShape(r),
      // W-122: carried only to drive the urgency ordering below; the runner
      // itself never reads these two fields.
      openDate: (r.open_date as Date | string | null) ?? null,
      listingDate: (r.listing_date as Date | string | null) ?? null,
    }));

  // W-124: LISTED-only enrichment (rotation timestamp + already-complete),
  // BEFORE ordering/capping — see `enrichListedCandidates`. W-124 round 2
  // (MAJOR-2): bounded to `listedCap * 4` LISTED rows so the N+1 enrichment
  // loop cannot outgrow the backlog before the discovery budget even starts.
  const listedCap = getListedCap();
  const { enriched: listedEnriched } = await enrichListedCandidates(candidates, deps, listedCap * 4);

  // MAJOR-2: a LISTED row past the enrichment bound has no rotation
  // timestamp and no `alreadyComplete`/`precomputedPlan` decision — offering
  // it to `orderAndCapCandidates` un-enriched would either wrongly consume a
  // cap slot or wrongly skip it, so it is dropped from `candidates` entirely
  // (deferred whole, same as a capped-out row) and counted separately.
  let listedSkippedUnenriched = 0;
  const boundedCandidates = candidates.filter((c) => {
    if (c.stage !== 'LISTED') return true;
    if (c.alreadyComplete !== undefined) return true;
    listedSkippedUnenriched++;
    return false;
  });

  const {
    candidates: ordered,
    listedDeferred,
    listedComplete,
  } = orderAndCapCandidates(boundedCandidates, listedCap);
  return { candidates: ordered, listedCap, listedDeferred, listedComplete, listedEnriched, listedSkippedUnenriched };
}

/**
 * Demote any FOUND row whose file is no longer on disk back to WANTED (M7).
 *
 * Purged too early, disk wiped, a failed rename — whatever the cause, without
 * this the state says FOUND forever and the document is silently absent: the
 * worst of both outcomes, because nothing re-fetches it and nothing reports it.
 *
 * Mutates `rows` in place as well as writing, so the caller's plan sees the
 * demoted state in the SAME cycle rather than a cycle later.
 */
export async function demoteMissingFiles(
  store: Pick<DocumentFetchStateRepository, 'update'>,
  ipoId: string,
  rows: DocumentFetchStateRow[],
  storeDir: string = getStoreDir(),
  /**
   * documentId -> persisted sha256 (W-1). With it, a FOUND row is checked
   * against the exact file its document row names; without it, the older
   * "any file of this type" check still applies, so a row stored before the
   * column existed is not demoted for lacking a hash.
   */
  sha256ByDocumentId: Map<string, string | null> = new Map()
): Promise<number> {
  let demoted = 0;
  for (const row of rows) {
    if (row.state !== 'FOUND') continue;
    const sha = row.documentId ? sha256ByDocumentId.get(row.documentId) ?? null : null;
    if (hasStoredFile(ipoId, row.docType, storeDir, sha)) continue;
    logger.warn(
      { ipoId, docType: row.docType },
      'FOUND document has no file on disk — demoting to WANTED so it is re-fetched'
    );
    await store.update(row.id, { state: 'WANTED', nextRetryAt: null, documentId: null });
    row.state = 'WANTED';
    row.documentId = null;
    demoted++;
  }
  return demoted;
}

/**
 * Run one document-discovery cycle.
 *
 * The wall-clock budget (R12) is checked between IPOs: discovery must never
 * starve the 30-minute scrape it shares a process with. Remaining IPOs are not
 * lost, they are simply next cycle's work — which is safe precisely because the
 * state table remembers where we stopped.
 */
export async function runDocumentCycle(
  options: { budgetMs?: number; extractionBudgetMs?: number; now?: () => number } = {}
): Promise<DocumentCycleSummary> {
  const budgetMs = options.budgetMs ?? CYCLE_BUDGET.DISCOVERY_MS;
  const extractionBudgetMs = options.extractionBudgetMs ?? DEFAULT_EXTRACTION_BUDGET_MS;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const redis = getRedisClient();
  const store = new DocumentFetchStateRepository(db as never, redis as never);
  const documents = new DocumentRepository(db as never, redis as never);
  const ipoRepository = new IPORepository(db as never, redis as never);
  const stepsRepository = new IpoPipelineStepsRepository(db as never, redis as never);
  const counter = new NetworkCounter();

  // Built lazily and reused across IPOs: the dependency set opens repositories
  // and a cache invalidator, and rebuilding it per IPO would be pure waste.
  // Stays undefined entirely when the flag is off.
  let autoPersistDeps: AutoPersistDeps | undefined;

  // MAJOR-1: ONE budget object for the WHOLE cycle (every IPO shares it — not
  // reset per IPO), and one Redis lock so a second, overlapping cycle cannot
  // start extracting the same IN_PROGRESS rows while this one is still
  // running. `lockToken` is undefined when the flag is off (no lock needed)
  // or when the lock could not be acquired (extraction skipped this cycle).
  const distributedLock = new DistributedLock(redis as never);
  let lockToken: string | undefined;
  const spawnBudget: SpawnBudget = { remaining: DEFAULT_MAX_SPAWNS_PER_CYCLE };
  // W-168: the anchor allocation report's OWN cycle-wide budget, separate from
  // `spawnBudget` above — see `filing-auto-persist.ts`'s `anchorSpawnBudget`
  // doc comment for why (three failing SME anchors used to eat the whole
  // filing budget for the cycle).
  const anchorSpawnBudget: SpawnBudget = { remaining: anchorMaxSpawnsPerCycle() };
  if (FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST) {
    const lock = await distributedLock.acquire(FILING_EXTRACTION_LOCK_KEY, { ttl: FILING_EXTRACTION_LOCK_TTL_MS });
    if (lock.acquired) {
      lockToken = lock.token;
      if (lockToken) {
        registerHeldLock(FILING_EXTRACTION_LOCK_KEY, lockToken);
      }
    } else {
      logger.warn(
        { key: FILING_EXTRACTION_LOCK_KEY },
        'Filing auto-persist lock already held by another cycle — skipping extraction this cycle (non-fatal)'
      );
    }
  }

  // MINOR-C: everything that can run while the extraction lock is held is
  // wrapped in try/finally so a throw ANYWHERE in the cycle body — not just
  // inside the per-IPO try/catch below — still releases the lock. Before this,
  // a throw between acquire() (above) and release() (previously at the very
  // end of the function) leaked the lock for its full 45-minute TTL, since
  // nothing between those two points ran under a finally.
  try {
    const runner = new DocumentDiscoveryRunner({
      fetcher: defaultFetcher,
      store,
      documents,
      counter,
    });

    const { candidates, listedCap, listedDeferred, listedComplete, listedEnriched, listedSkippedUnenriched } =
      await loadCandidateIpos({ store, documents });
    const results: IpoRunResult[] = [];
    let budgetExhausted = false;
    // Item 7 / F4: tallied AFTER pass 2 (below), across every candidate — see
    // the loop right before `summarize()`.
    let extractionBlocked = 0;
    let extractionFailed = 0;

    // PASS 1 — discovery, exactly as before (ledger hooks, hints, demotion),
    // under the discovery budget. W-102: this pass no longer runs extraction
    // (see PASS 2 below) — python extraction time must never be charged
    // against the discovery budget.
    const processCandidate = async (ipo: DiscoveryIpo): Promise<void> => {
    try {
      const persisted = await store.listForIpo(ipo.id);

      // W-1: hand demotion the persisted hashes so a FOUND row is checked
      // against the exact file its document row names.
      // F4 (S-02 round 6): extraction_blocked/extraction_failed are NOT
      // tallied here any more — this snapshot is taken BEFORE pass 2 (below)
      // has written anything, and only for the IPOs pass 1 reaches before its
      // own discovery budget runs out. The real tally runs after pass 2, over
      // every candidate.
      const shaByDocId = new Map<string, string | null>();
      try {
        for (const d of await documents.findByIPO(ipo.id)) {
          shaByDocId.set(d.id, (d as { sha256?: string | null }).sha256 ?? null);
        }
      } catch (error) {
        // Non-fatal: without the map, demotion falls back to the older
        // any-file-of-this-type check rather than skipping the pass.
        logger.warn(
          { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
          'Could not load document hashes for demotion (non-fatal)'
        );
      }
      const demoted = await demoteMissingFiles(store, ipo.id, persisted, getStoreDir(), shaByDocId);

      // MAJOR-2: a demotion (FOUND -> WANTED) opens up a doc type the
      // enrichment-time plan did not see as due, so a precomputed plan is
      // only safe to reuse when nothing was demoted for this IPO this cycle.
      if (demoted > 0) ipo.precomputedPlan = undefined;

      const rows = persisted.map(toStateRow);
      const result = await runner.runIpo(ipo, rows);
      results.push(result);

      // S-02 hook 1 — defensive ledger init. An IPO whose row was created before
      // the ledger existed (or by a path that somehow bypassed upsertIPO) has no
      // step rows at all, and every recordStep below would then be the only row
      // it ever gets. Idempotent (`onConflictDoNothing`), so this costs one
      // no-op insert per IPO per cycle and guarantees the grid is never ragged.
      await initStepLedger(ipo.id);

      // S-02 hook 2 — C1..C5, D1..D5, I3, I4 from the run that just happened.
      // The existing rows are read first so a rung that failed THIS cycle cannot
      // overwrite a DONE an earlier cycle earned (see planDocumentRunSteps).
      // Cached by the repository, so this is not a per-IPO round trip every time.
      let existingSteps: Record<string, { status: string }> | undefined;
      try {
        existingSteps = {};
        for (const row of await stepsRepository.findByIpo(ipo.id)) {
          existingSteps[row.stepId] = { status: row.status };
        }
      } catch (error) {
        // Without the map the recorder falls back to "write everything", which is
        // the pre-existing behaviour — never a reason to skip recording.
        existingSteps = undefined;
        logger.warn(
          { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
          'Could not read the step ledger for the no-downgrade check (non-fatal)'
        );
      }
      await recordDocumentRunSteps(result, {
        withdrawn: ipo.issue?.withdrawn === true,
        existing: existingSteps,
      });

      // Remember the IPO_NO while the IPO is still on the board (it leaves once
      // closed, exactly when the Prospectus becomes due) and how many lead
      // managers BSE listed (so the nightly audit can catch the co-BRLM class).
      //
      // Routed through data-persister, NOT written here: `scraper-write-path.md`
      // and the R0 write ratchet require every `ipos` write to go through the
      // shared write path. Non-fatal — bookkeeping must never fail a cycle.
      // T-403 M-6: persist the issuer website read off a filing cover, so rung
      // 4 (the investor page) becomes reachable for the NEXT document this IPO
      // needs. Non-fatal, and routed through data-persister.
      if (result.learnedCompanyWebsite) {
        try {
          await recordDocumentSourceHints(
            ipoRepository,
            ipo.id,
            { companyWebsite: result.learnedCompanyWebsite },
            { companyWebsite: ipo.companyWebsite }
          );
        } catch (error) {
          logger.warn(
            { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
            'Failed to record company website (non-fatal)'
          );
        }
      }

      if (result.resolvedBseIpoNo || result.leadManagers.length > 0) {
        try {
          await recordBseDiscoveryMetadata(ipoRepository, ipo.id, {
            bseIpoNo: result.resolvedBseIpoNo ?? null,
            // F-2: the column counts what the BSE PAYLOAD listed, and that is
            // what the nightly co-BRLM check compares against. A count NSE
            // supplied is not a BSE payload count, so it is deliberately not
            // written here — the lead managers themselves are still carried on
            // the result and consumed by the caller.
            bsePayloadLeadManagerCount:
              result.leadManagerSource === 'BSE' && result.leadManagers.length > 0
                ? result.leadManagers.length
                : null,
          });
        } catch (error) {
          logger.warn(
            { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
            'Failed to record BSE discovery metadata (non-fatal)'
          );
        }
      }
    } catch (error) {
      logger.error(
        {
          ipoId: ipo.id,
          company: ipo.companyName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Document discovery failed for one IPO (non-fatal) — continuing'
      );
    }
    };

    // W-124: reserve one slot per cycle for the WITHDRAWN/POSTPONED purge path
    // (rank 4 — `deriveIssueShape(...).withdrawn`), regardless of the discovery
    // budget. Before this, a full live backlog (OPEN/CLOSED/UPCOMING/LISTED)
    // could burn the whole `budgetMs` and the loop would `break` before ever
    // reaching rank 4 at the tail of `candidates` — a WITHDRAWN/POSTPONED
    // issue's still-open rows (F15/M3) would then never close, starving the
    // purge path indefinitely under sustained load. When the budget trips, and
    // a purge candidate has not yet been processed this cycle, one — the next
    // one in walk order — is processed anyway before the pass stops; every
    // other exhausted-budget candidate still resumes next cycle as before.
    const purgeReserved = candidates.some((c) => c.issue?.withdrawn === true);
    let purgeProcessed = false;

    for (let i = 0; i < candidates.length; i++) {
      const ipo = candidates[i];
      const isPurgeCandidate = ipo.issue?.withdrawn === true;

      if (now() - startedAt >= budgetMs) {
        if (purgeReserved && !purgeProcessed) {
          const purgeIdx = candidates.findIndex(
            (c, idx) => idx >= i && c.issue?.withdrawn === true
          );
          if (purgeIdx !== -1) {
            await processCandidate(candidates[purgeIdx]);
            purgeProcessed = true;
          }
        }
        budgetExhausted = true;
        logger.warn(
          {
            processed: results.length,
            remaining: candidates.length - results.length,
            budgetMs,
            purgeReserved,
            purgeProcessed,
          },
          'Document discovery budget exhausted — remaining IPOs resume next cycle (state is persisted); a purge slot is reserved regardless of budget'
        );
        break;
      }

      await processCandidate(ipo);
      if (isPurgeCandidate) purgeProcessed = true;
    }

    // PASS 2 — extraction. W-102: over EVERY candidate (not only the ones pass
    // 1 reached before its own budget ran out), so a slow discovery pass never
    // starves extraction. Runs only when the flag is on AND the cycle lock was
    // acquired above; gated the same way the old per-IPO hook was, just moved
    // out from under the discovery budget. Non-fatal per candidate — one IPO's
    // extraction failure must not stop the rest.
    if (FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST) {
      if (!lockToken) {
        // Logged once above when the lock failed.
      } else {
        const extractionStartedAt = now();
        // W-168: one summary line per cycle — accumulated across every
        // candidate IPO's `processPendingFilings` call, logged once after
        // this loop (not per IPO, which would bury the cycle-wide picture
        // the live evidence needed: three failing anchors in a row was only
        // visible by reading every per-IPO log line by hand).
        const anchorCycleTotals = { considered: 0, spawned: 0, persisted: 0, manualReview: 0, failed: 0 };
        for (const ipo of candidates) {
          if (now() - extractionStartedAt >= extractionBudgetMs) {
            logger.warn(
              { extractionBudgetMs },
              'Document extraction budget exhausted — remaining candidates resume next cycle (spawn budget/state persisted)'
            );
            break;
          }
          try {
            if (!autoPersistDeps) {
              autoPersistDeps = buildAutoPersistDeps();
              autoPersistDeps.spawnBudget = spawnBudget;
              autoPersistDeps.anchorSpawnBudget = anchorSpawnBudget;
            }
            // F3: same absolute deadline + clock on every call this cycle, so
            // the per-document deadline check inside `processPendingFilings`
            // reads consistently with this loop's own extraction-budget check.
            autoPersistDeps.deadlineMs = extractionStartedAt + extractionBudgetMs;
            autoPersistDeps.now = now;
            const autoPersist = await processPendingFilings(
              {
                id: ipo.id,
                companyName: ipo.companyName,
                slug: ipo.slug ?? null,
                segment: ipo.segment ?? null,
              },
              autoPersistDeps
            );
            if (autoPersist.spawned > 0 || autoPersist.failed > 0 || autoPersist.skippedBudget > 0) {
              logger.info(
                { ipoId: ipo.id, company: ipo.companyName, ...autoPersist },
                'Filing auto-persist complete for one IPO'
              );
            }
            anchorCycleTotals.considered += autoPersist.anchorsConsidered;
            anchorCycleTotals.spawned += autoPersist.anchorsSpawned;
            anchorCycleTotals.persisted += autoPersist.anchorsPersisted;
            anchorCycleTotals.manualReview += autoPersist.anchorsManualReview;
            anchorCycleTotals.failed += autoPersist.anchorsFailed;
          } catch (error) {
            logger.error(
              { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
              'Filing auto-persist threw (non-fatal) — continuing the cycle'
            );
          }
        }
        // W-168: log even when everything was zero — a silent cycle IS the
        // evidence that nothing starved anything, and its absence would be
        // exactly the gap the live-evidence incident exposed (no single line
        // said how the cycle's spawn budget was actually spent on anchors).
        logger.info(
          { ...anchorCycleTotals, anchorSpawnBudgetRemaining: anchorSpawnBudget.remaining },
          'Anchor auto-persist summary for this cycle (W-168)'
        );
      }
    }

    // F4 (S-02 round 6): tally extraction_blocked/extraction_failed AFTER
    // pass 2 has run, across EVERY candidate IPO — not only the ones pass 1
    // reached before its own budget ran out, and reading state AFTER pass 2
    // had a chance to write it. A document pass 2 just pushed into
    // MANUAL_REVIEW or FAILED shows up in THIS cycle's summary, not a cycle
    // late. Non-fatal per IPO — a read failure here must not fail the cycle.
    for (const ipo of candidates) {
      try {
        for (const d of await documents.findByIPO(ipo.id)) {
          const extractionStatus = (d as { extractionStatus?: string | null }).extractionStatus;
          if (extractionStatus === 'MANUAL_REVIEW') extractionBlocked++;
          else if (extractionStatus === 'FAILED') extractionFailed++;
        }
      } catch (error) {
        logger.warn(
          { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
          'Could not load document extraction status for the cycle summary (non-fatal)'
        );
      }
    }

    const summary = summarize(
      results,
      now() - startedAt,
      budgetExhausted,
      { blocked: extractionBlocked, failed: extractionFailed },
      {
        cap: listedCap,
        deferred: listedDeferred,
        complete: listedComplete,
        enriched: listedEnriched,
        skippedUnenriched: listedSkippedUnenriched,
      }
    );

    // One scraper_logs row per cycle for source=DOCUMENTS, so the existing metrics
    // tracker and alert thresholds cover documents like any other source (§7.4).
    // Item 7: extractionBlocked > 0 also forces PARTIAL and carries
    // `extraction_blocked=<n>` in error_message, so MANUAL_REVIEW documents are
    // visible to the SAME alert path as a discovery block — no new machinery.
    // Non-fatal: a logging failure must never fail the cycle.
    try {
      await db.insert(scraperLogs).values({
        source: 'DOCUMENTS',
        status: summary.blocked > 0 || summary.extractionBlocked > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: summary.found,
        recordsFailed: summary.blocked,
        durationMs: summary.durationMs,
        errorMessage: summary.extractionBlocked > 0 ? `extraction_blocked=${summary.extractionBlocked}` : null,
      } as never);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Failed to write DOCUMENTS scraper_logs row (non-fatal)'
      );
    }

    logger.info({ ...summary, byHost: counter.byHost() }, 'Document discovery cycle complete');
    return summary;
  } finally {
    // MAJOR-1 + MINOR-C: release the extraction lock so the NEXT cycle can
    // acquire it — non-fatal, skipped entirely when this cycle never held it
    // (flag off, or another cycle already had it), and now guaranteed to run
    // on EVERY exit path (return above, or a throw anywhere in the try block)
    // rather than only the successful-fallthrough path.
    if (lockToken) {
      unregisterHeldLock(FILING_EXTRACTION_LOCK_KEY, lockToken);
      try {
        await distributedLock.release(FILING_EXTRACTION_LOCK_KEY, lockToken);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to release filing auto-persist lock (non-fatal — it will expire via TTL)'
        );
      }
    }
  }
}

export interface PurgeSummary {
  candidates: number;
  purged: number;
  filesDeleted: number;
  bytesFreed: number;
}

/**
 * W-101: bounded to IPOs that can possibly be due — a close date exists and is
 * already past the soft window (the first cut scanned every IPO row with a
 * close date, which grows without limit as the table does — N4).
 *
 * `{{RETENTION_DAYS}}` is substituted with a validated, `Math.trunc`-ed
 * integer (see `getRetentionDays()`) before execution — never user input, so
 * this is not a SQL-injection surface — which keeps this string a plain,
 * test-inspectable constant (see `stage-reconciler-job.ts`'s
 * `RECONCILER_PRESENCE_SQL` for the same pattern) instead of a parameter-bound
 * template that a regex test cannot read without a live database.
 *
 * Found live 2026-09-03: `upper(i.status)` failed with Postgres 42883
 * ("function upper(ipo_status) does not exist") on EVERY run — `ipos.status`
 * is the `ipo_status` enum, not text, and `upper()` has no enum overload.
 * `upper(i.status::text)` fixes it.
 */
export const PURGE_CANDIDATES_SQL = `
    SELECT i.id,
           i.close_date,
           i.status,
           count(s.id) FILTER (
             WHERE s.state NOT IN ('EXTRACTED', 'NOT_APPLICABLE')
           )::int AS unread_count
      FROM ipos i
      LEFT JOIN document_fetch_state s ON s.ipo_id = i.id
     WHERE i.offering_type = 'IPO'
       AND i.close_date IS NOT NULL
       AND (
         i.close_date < now() - make_interval(days => {{RETENTION_DAYS}})
         OR upper(i.status::text) IN ('WITHDRAWN', 'POSTPONED')
       )
     GROUP BY i.id, i.close_date, i.status
`;

/**
 * PURGE_PDFS (D4). Deletes local PDFs for IPOs past
 * `close_date + PROSPECTUS_RETENTION_DAYS`, or withdrawn. FILES ONLY — the
 * `documents` and `document_fetch_state` rows and everything extracted from the
 * PDFs are retained, so nothing we learned is lost with the bytes.
 */
export async function runDocumentPurge(): Promise<PurgeSummary> {
  const retentionDays = getRetentionDays();
  const maxRetentionDays = getMaxRetentionDays();

  // W-101: retentionDays is validated finite/>=0 by getRetentionDays(); Math.trunc
  // guards against a non-integer env value producing invalid SQL syntax.
  const result = await db.execute(
    sql.raw(PURGE_CANDIDATES_SQL.replace('{{RETENTION_DAYS}}', String(Math.trunc(retentionDays))))
  );
  const rows = ((result as unknown as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<
    string,
    unknown
  >[];

  const summary: PurgeSummary = { candidates: 0, purged: 0, filesDeleted: 0, bytesFreed: 0 };
  for (const row of rows) {
    const status = String(row.status ?? '').toUpperCase();
    const decision = decidePurge({
      closeDate: row.close_date as Date | null,
      withdrawn: status === 'WITHDRAWN' || status === 'POSTPONED',
      allDocumentsRead: Number(row.unread_count ?? 0) === 0,
      retentionDays,
      maxRetentionDays,
    });
    if (!decision.purge) continue;

    summary.candidates++;
    const purge = await purgeIpoDocuments(String(row.id));
    if (!purge.purged) continue;
    summary.purged++;
    summary.filesDeleted += purge.filesDeleted;
    summary.bytesFreed += purge.bytesFreed;
    logger.info({ ipoId: String(row.id), reason: decision.reason }, 'Purged IPO document PDFs');
  }
  return summary;
}
