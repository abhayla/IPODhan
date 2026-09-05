/**
 * Automatic filing extraction + persistence (S-02).
 *
 * THE GAP THIS CLOSES. Before S-02 the document cycle downloaded a Red Herring
 * Prospectus, verified it, stored the bytes and wrote a `documents` row — and
 * then stopped. Turning those bytes into `ipos.issue_size`, financials,
 * promoters, peers and risk factors required a human to run
 * `scripts/persist-filing.ts` by hand, per document, per IPO. So for a new IPO
 * nobody had personally attended to, every filing-sourced field stayed empty
 * however many times the cron ran.
 *
 * WHAT IT DOES, per IPO, once the `ENABLE_FILING_AUTO_PERSIST` flag is on:
 *   1. Find documents that have stored bytes and have not been extracted by the
 *      CURRENT extractor version.
 *   2. Mark each IN_PROGRESS, spawn the deterministic python extractor
 *      (`scripts/extract_filing.py`), parse its JSON.
 *   3. Record E1..E10 (and D6 when the OCR route ran) from the extraction.
 *   4. Persist through `persistFilingExtraction` — the SAME door the CLI uses,
 *      with the admin field-protection filter and, when both a price-band ad and
 *      an RHP were extracted this run, the W-45 cross-document agreement gate.
 *   5. Record G1..G5 from the persist summary, stamp the document COMPLETED,
 *      and invalidate the IPO's caches (J1).
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - It never writes `ipos` itself. Every field goes through
 *     `persistFilingExtraction` -> `upsertIPO` -> consolidation, so the field-
 *     priority matrix and the admin locks still decide the outcome.
 *   - It never fails the cycle. An extractor crash, a malformed JSON, a missing
 *     python — each becomes FAILED ledger rows with the error and a backoff
 *     (`2^attempts x 15 min`, capped at 6 hours), and the document returns to
 *     PENDING so a LATER cycle retries it once that backoff has elapsed.
 *   - It never re-extracts a document that the current extractor version has
 *     already extracted, so a steady-state cycle spawns no python at all.
 *   - It never spawns more than `maxSpawnsPerCycle` python processes across
 *     the WHOLE document cycle (all IPOs, not per IPO), and never runs two
 *     overlapping cycles' extractions at once — see `document-cycle.ts` and
 *     the `filing-auto-persist:cycle` Redis lock (MAJOR-1).
 *
 * RETRY GATE IS PER DOCUMENT, NOT PER IPO (MAJOR-A, round 3).
 *
 * The gate lives on the `documents` row itself, one gate per document, using
 * the columns that already exist for exactly this purpose: `retry_count`,
 * `extraction_status`, `extraction_error`, `extracted_at`, `updated_at`.
 *
 * THE COMPLETE STATE MACHINE (round 4). Every status write goes through the
 * ONE pure function `buildExtractionStatePatch(transition, ctx, now)`, which
 * returns the exact `documents` column patch, and `setDocumentExtractionState`
 * applies it with `db.update(documents).set(patch)`. The patch ALWAYS
 * includes `updatedAt: now` (round-3 review MAJOR-1: `documents.updated_at`
 * has no `$onUpdate` and no trigger — without this write the backoff clock
 * never advances).
 *
 *  1. select -> IN_PROGRESS: `{status IN_PROGRESS, retryCount: prev+1,
 *     updatedAt}`. The attempt is counted HERE, at the stamp — a process
 *     killed mid-extraction (row left IN_PROGRESS) still consumes an attempt
 *     (round-3 MINOR-6). An IN_PROGRESS row is eligible for selection again
 *     on the NEXT cycle (crash recovery), subject to the same retry/backoff
 *     rule as FAILED, reading its own `retry_count`/`updated_at`.
 *  2. extractor ok + persist ok -> COMPLETED: `{status COMPLETED, retryCount:
 *     0, extractionError: null, extractedAt: now, updatedAt}`.
 *  3. extractor failure OR persist throw OR a W-45 cross-document
 *     disagreement -> FAILED: `{status FAILED, extractionError: <reason>,
 *     updatedAt}`; `retryCount` is left UNCHANGED — it was already counted at
 *     the IN_PROGRESS stamp (1). Round-3 MAJOR-4/MINOR-5: neither a W-45
 *     refusal nor a persist throw is MANUAL_REVIEW or PENDING any more — both
 *     are retried with backoff exactly like an extractor failure.
 *  4. Selection gate: skip when FAILED or IN_PROGRESS and
 *     `now < backoffNextDueAt(retryCount - 1, updatedAt)` (2^n x 15 min,
 *     capped at 6 h). Skip when COMPLETED at the current `EXTRACTOR_VERSION`.
 *  5. When the retryCount the IN_PROGRESS stamp (1) already wrote has reached
 *     `MAX_EXTRACTION_ATTEMPTS` (10), a subsequent failure (3) writes
 *     MANUAL_REVIEW instead of FAILED, with `extractionError:
 *     "blocked_after_10_attempts@<EXTRACTOR_VERSION>"` — the version lives
 *     INSIDE the error string, no schema change.
 *  6. MANUAL_REVIEW gate: blocked ONLY while the version encoded in
 *     `extraction_error` equals the CURRENT `EXTRACTOR_VERSION` (round-3
 *     MAJOR-2: a permanent block was a lie the comment told). On a version
 *     bump the document is eligible again, and its NEXT IN_PROGRESS stamp
 *     resets `retryCount` to 1 rather than incrementing from 10.
 *
 * The E1..E10 ledger rows are still WRITTEN on every extraction attempt (with
 * `attemptsBefore` taken from the document's own `retry_count`, not a shared
 * ledger counter) — they remain the audit trail of what happened — but they
 * are no longer READ to decide whether this cycle may spawn python.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, getRedisClient, DocumentRepository } from '@ipodhan/shared';
import { documents as documentsTable } from '@ipodhan/shared/db/schema';
import type { DocumentFetchStateRow } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import logger from '../utils/logger.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { getStoreDir, documentPath } from './document-store.js';
import {
  persistFilingExtraction,
  parseFilingUnit,
  type FilingDocType,
  type FilingExtraction,
  type FilingPersisterDeps,
  type PersistFilingSummary,
} from './filing-persister.js';
import { buildFilingPersistDeps } from './filing-persist-deps.js';
import {
  checkCrossDocumentAgreement,
  comparableSeries,
  decidePairedPersist,
  withholdDisagreeingMetrics,
} from './cross-document-agreement.js';
import {
  planExtractionSteps,
  planExtractionFailureSteps,
  planPersistSteps,
  recordLiveStep,
  writeSteps,
  backoffNextDueAt,
} from './step-ledger-recorders.js';
import { CacheInvalidator } from '../scheduler/cache-invalidator.js';

/**
 * The extractor build that produced a stored extraction.
 *
 * ONE constant, written to `document_fetch_state.extractor_version` and to every
 * E/G ledger row's `version`. Bumping it is what makes every already-extracted
 * document eligible again — which is the only re-extraction trigger, so a bump
 * is a deliberate act, not a side effect of an unrelated change.
 */
export const EXTRACTOR_VERSION = 'extract_filing.py@2026-09-03';

/** Doc types the python extractor understands. Anything else is skipped. */
export const EXTRACTABLE_DOC_TYPES: readonly FilingDocType[] = [
  'PRICE_BAND_AD',
  'RHP',
  'DRHP',
  'PROSPECTUS',
];

/** 10 minutes: an OCR pass over a 600-page RHP is slow, but not unbounded. */
export const EXTRACT_TIMEOUT_MS = 10 * 60 * 1000;

export const MAX_EXTRACTION_ATTEMPTS = 10;
export const EXTRACTION_BLOCKED_ERROR = 'blocked_after_10_attempts';

/**
 * W-137: the python extractor's own "the memory ceiling tripped" exit code
 * (`memory_guard.EXIT_MEMORY_CEILING`) — a HARD failure, same bucket as a
 * signal-killed process (`result.status === null`, logged as "extractor
 * exited null"). A 400-page prospectus PDF held pdfplumber's per-page cache
 * alive for the whole document, growing the process to 3.9-4.7 GB RSS on the
 * VPS; the kernel OOM-killer then killed the extractor AND the pm2 daemon
 * supervising it, restarting every app on the box. The fix streams pages
 * (scripts side) and caps RLIMIT_AS so a runaway trips this exit code
 * instead — but the node side must still stop retrying that SAME document
 * hourly, since streaming does not guarantee every prospectus fits.
 */
export const EXTRACTOR_MEMORY_CEILING_EXIT = 3;

/** Round 4: stderr signatures of a memory failure that killed the extractor
 * at the C level, before Python (or even `memory_guard`) could run any
 * handler — so exit code and stdout carry NO information at all. Matched
 * case-insensitively against the captured stderr tail regardless of exit
 * code: `OpenBLAS error` / `Memory allocation still failed` (numpy's BLAS
 * backend under RLIMIT_AS, seen live on the VPS at EXTRACTOR_MAX_RSS_MB=200),
 * `MemoryError` / `memory ceiling exceeded` / `Cannot allocate memory` (the
 * ordinary Python-catchable shapes, matched here too as a backstop in case a
 * future change to the CLI's own handler regresses), `std::bad_alloc` (a C++
 * dependency's own OOM exception), and `Killed` (the shell's own message
 * when the kernel OOM-killer — not RLIMIT_AS — still gets there first).
 *
 * Round 5 (MINOR-1): `Killed` was unanchored and case-insensitive, so it also
 * matched unrelated stderr text containing "skilled" or "killed by user"
 * (e.g. a worker-pool log line). Anchored to the whole word with `\b` and
 * pulled out of the case-insensitive flag via a separate case-sensitive
 * alternation, since the shell's own message is always capitalized `Killed`.
 * `MemoryError` is similarly narrowed to only match an actual Python
 * exception line (`MemoryError` at the start of a traceback line, or
 * followed by `:` as in `MemoryError: ...`), not any incidental mention of
 * the word (e.g. inside a comment or an unrelated log string). */
export const MEMORY_ABORT_STDERR_RE =
  /Memory allocation still failed|OpenBLAS error|(^|\n)MemoryError(:|\n|$)|memory ceiling exceeded|Cannot allocate memory|std::bad_alloc/i;
/** Round 5 (MINOR-1): kept case-sensitive and word-boundary-anchored, and
 * OUTSIDE `MEMORY_ABORT_STDERR_RE`'s `i` flag on purpose — a JS regex literal
 * cannot mix case sensitivity per-alternative, and the shell's OOM-killer
 * message is always capitalized `Killed`. Folding it in case-insensitively
 * (the previous shape) also matched "skilled"-style substrings and lowercase
 * "killed" inside unrelated prose. Combined with `MEMORY_ABORT_STDERR_RE` via
 * `isMemoryAbortStderr()` below — always use that, not this regex alone. */
export const MEMORY_ABORT_KILLED_RE = /\bKilled\b/;

/** The single check callers use: true when the captured stderr tail carries
 * ANY known C-level memory-abort or OOM-kill signature — see the two
 * constants above for what each half matches and why they cannot be one
 * regex literal. */
export function isMemoryAbortStderr(stderr: string): boolean {
  return MEMORY_ABORT_STDERR_RE.test(stderr) || MEMORY_ABORT_KILLED_RE.test(stderr);
}

/** Marks a FAILED row's `extraction_error` as a HARD failure (killed/OOM),
 * with the count of consecutive hard failures embedded — read back by
 * `documentExtractionBlocked` to widen the backoff past the normal
 * exponential curve. Format: `HARD_FAILURE:<n>:<original error>`. */
export const HARD_FAILURE_MARKER = 'HARD_FAILURE';

/** W-137: after the 2nd consecutive hard failure (killed/memory-ceiling) for
 * the SAME document, back off at least a day rather than retrying hourly —
 * a document that kills the box does not become safe to retry an hour later. */
export const HARD_FAILURE_MIN_BACKOFF_MS = 24 * 60 * 60 * 1000;

/** Reads the consecutive-hard-failure count off a `HARD_FAILURE:<n>:...`
 * marked error string. Returns 0 for anything else (including null/undefined
 * or an ordinary error) — never throws on malformed input. */
export function parseHardFailureCount(error: string | null | undefined): number {
  if (!error) return 0;
  const match = new RegExp(`^${HARD_FAILURE_MARKER}:(\\d+):`).exec(error);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Wraps a hard-failure's raw error with the marker + incremented count, read
 * back by `parseHardFailureCount` on the NEXT cycle's gate check. */
export function markHardFailure(previousError: string | null | undefined, rawError: string): string {
  return `${HARD_FAILURE_MARKER}:${parseHardFailureCount(previousError) + 1}:${rawError}`;
}

/**
 * The per-document gate. Pure, so the backoff arithmetic is testable without a
 * database. `doc` is the subset of `documents` columns the gate reads.
 */
export interface DocumentGate {
  extractionStatus: string | null;
  extractionError?: string | null;
  retryCount: number;
  updatedAt: Date | null;
}

/**
 * `"blocked_after_10_attempts@<version>"` -> `"<version>"`, or `null` when the
 * string does not match (round-3 MAJOR-2: the version lives IN the error
 * string, not a column, so this is the only place that reads it back out).
 */
export function parseBlockedVersion(error: string | null | undefined): string | null {
  if (!error) return null;
  const match = new RegExp(`^${EXTRACTION_BLOCKED_ERROR}@(.+)$`).exec(error);
  return match ? match[1] : null;
}

/**
 * True when this cycle must not spawn the extractor for THIS document.
 *
 * Two independent reasons, both scoped to the one document — never to the
 * whole IPO (MAJOR-A):
 *  - blocked-at-this-version: `extractionStatus === 'MANUAL_REVIEW'` AND the
 *    version encoded in `extractionError` equals `version` (round-4 MAJOR-2:
 *    a bare MANUAL_REVIEW check made the block permanent even across an
 *    `EXTRACTOR_VERSION` bump). A different/missing encoded version means the
 *    document is eligible again — exactly like an ordinary un-extracted one.
 *  - backing off: the document's last stamp was FAILED, or is still
 *    IN_PROGRESS from a run that died mid-extraction (round-4 MINOR-6), and
 *    the exponential backoff window (`backoffNextDueAt`, reused verbatim from
 *    `step-ledger-recorders.ts`) measured from `updatedAt` has not elapsed.
 *    `retryCount` already includes the attempt that set `updatedAt`, so the
 *    attempt count the backoff formula wants (the count BEFORE that attempt)
 *    is `retryCount - 1`.
 *
 * Round 5 (MINOR-2): the hard-failure 24h floor is NOT a one-time wait —
 * `hardFailureCount` (parsed off `extractionError`) is only ever reset by a
 * COMPLETED run. A document stuck at `HARD_FAILURE:2` (or higher) is blocked
 * on this same 24h cadence every cycle, indefinitely, until either a run of
 * the extractor actually completes for it or an operator manually clears
 * `extraction_error`.
 */
export function documentExtractionBlocked(
  doc: DocumentGate,
  version: string,
  now: Date = new Date()
): { blocked: boolean; reason?: string } {
  if (doc.extractionStatus === 'MANUAL_REVIEW') {
    const blockedVersion = parseBlockedVersion(doc.extractionError);
    if (blockedVersion === version) {
      return {
        blocked: true,
        reason: `extraction blocked after ${doc.retryCount} failed attempts (${EXTRACTION_BLOCKED_ERROR}@${version})`,
      };
    }
    // F6 (S-02 round 6): a MANUAL_REVIEW row whose extraction_error carries NO
    // `@<version>` at all (an operator set MANUAL_REVIEW by hand, or a legacy
    // row predating this encoding) is NOT the same as "blocked at an older
    // build" — there is no version to compare against, so treating it as
    // revivable silently un-blocks a row a human deliberately parked. Only a
    // DIFFERENT, encoded version is grounds for revival.
    if (blockedVersion === null) {
      return {
        blocked: true,
        reason: 'extraction blocked — MANUAL_REVIEW with no encoded extractor version in extraction_error (operator-set or legacy row)',
      };
    }
    return { blocked: false };
  }
  if ((doc.extractionStatus === 'FAILED' || doc.extractionStatus === 'IN_PROGRESS') && doc.retryCount > 0) {
    const anchor = doc.updatedAt ?? now;
    let nextDueAt = backoffNextDueAt(doc.retryCount - 1, anchor);
    // W-137: 2+ consecutive killed/memory-ceiling failures on this SAME
    // document override the normal (6h-capped) exponential backoff with a
    // floor of 24h — the document is what kills the box, not the timing.
    // Round 5 (MINOR-2): only a COMPLETED run resets the retry/error state —
    // a document stuck at HARD_FAILURE:2 (or higher) stays on this 24h
    // cadence FOREVER, cycle after cycle, until either a run completes or an
    // operator manually clears `extraction_error`. This is stated explicitly
    // in the blocked reason below so an operator reading the skip log does
    // not mistake it for a one-time wait.
    const hardFailureCount = parseHardFailureCount(doc.extractionError);
    const hardFloorApplies = hardFailureCount >= 2;
    if (hardFloorApplies) {
      const hardFloor = new Date(anchor.getTime() + HARD_FAILURE_MIN_BACKOFF_MS);
      if (hardFloor.getTime() > nextDueAt.getTime()) nextDueAt = hardFloor;
    }
    if (nextDueAt.getTime() > now.getTime()) {
      // MAJOR-3: a hard-failure floor is never silent — the 24h wait is not
      // "try again soon", it is "this document has killed the extractor
      // twice; look at it". The ordinary exponential backoff keeps its
      // terser message since it is expected, routine retry timing.
      return {
        blocked: true,
        reason: hardFloorApplies
          ? `extraction backing off until ${nextDueAt.toISOString()} — ${hardFailureCount} consecutive hard failures (killed/OOM), needs manual extraction if this recurs (repeats every 24h until a run completes or an operator clears extraction_error)`
          : `extraction backing off until ${nextDueAt.toISOString()}`,
      };
    }
  }
  return { blocked: false };
}

/** The status values `buildExtractionStatePatch` (and the `documents` column) accept. */
export type ExtractionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'MANUAL_REVIEW';

export interface ExtractionStatePatchContext {
  /** Explicit `undefined` leaves `extraction_error` untouched; pass `null` to clear it. */
  error?: string | null;
  retryCount?: number;
}

/**
 * THE single function every extraction-status write goes through. Pure, so
 * every transition in the module doc comment's state table is a plain
 * input/output test with no database. Always stamps `updatedAt: now` — the
 * ONE thing every transition in the table has in common (round-3 MAJOR-1).
 */
export function buildExtractionStatePatch(
  transition: ExtractionStatus,
  ctx: ExtractionStatePatchContext = {},
  now: Date = new Date()
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    extractionStatus: transition,
    updatedAt: now,
  };
  if (ctx.error !== undefined) patch.extractionError = ctx.error;
  if (transition === 'COMPLETED') patch.extractedAt = now;
  if (ctx.retryCount !== undefined) patch.retryCount = ctx.retryCount;
  return patch;
}

export interface AutoPersistIpo {
  id: string;
  companyName: string;
  slug?: string | null;
  segment?: string | null;
  /**
   * W-129 review: `ipos.issue_size` (rupees), when the caller already has it
   * on hand. `processPendingFilings` uses this directly when present and
   * falls back to `deps.loadIssueSizeRupees` otherwise — the document-cycle
   * candidate query does not currently select this column.
   */
  issueSize?: number | null;
}

/** One document as this service needs to see it. */
export interface CandidateDocument {
  id: string;
  type: string;
  sha256: string | null;
  extractionStatus: string | null;
  extractedAt: Date | null;
  /** MAJOR-A: attempts so far — the per-document retry counter the gate reads. */
  retryCount: number;
  /** MAJOR-A: when this document's extraction state was last written — the backoff anchor. */
  updatedAt: Date | null;
  /** Round 4: read by the gate to decode a `MANUAL_REVIEW` block's `EXTRACTOR_VERSION`. */
  extractionError?: string | null;
}

export interface AutoPersistResult {
  ipoId: string;
  considered: number;
  extracted: number;
  persisted: number;
  failed: number;
  skipped: string[];
  spawned: number;
  /** MAJOR-1: pending docs left unextracted this cycle because the spawn budget ran out. */
  skippedBudget: number;
}

/**
 * MAJOR-1 fix. Before this, one document cycle could spawn UNBOUNDED python
 * processes: 20 IPOs x 2 filings x up to `EXTRACT_TIMEOUT_MS` (10 min) each
 * could run for hours, and nothing stopped a SECOND cycle from starting
 * extraction on the same IN_PROGRESS rows while the first was still running.
 *
 * `SpawnBudget` is a single mutable counter object created ONCE per document
 * cycle in `document-cycle.ts` (never per IPO) and threaded through every
 * `processPendingFilings` call for that cycle, so the cap is enforced ACROSS
 * the whole cycle, not per IPO.
 */
export interface SpawnBudget {
  remaining: number;
}

/** Default cap on python spawns per document cycle, across every IPO. */
export const DEFAULT_MAX_SPAWNS_PER_CYCLE = 3;

/**
 * Which stored documents still need extracting.
 *
 * PURE, so the "a second cycle spawns no python" guarantee is testable without a
 * database, a store directory or a python interpreter.
 *
 * A document is a candidate when ALL of:
 *   - its type is one the extractor understands;
 *   - it has a sha256 (no hash means we cannot name the file on disk, and an
 *     un-hashed row predates the store — re-fetching it is the runner's job);
 *   - a file for that hash exists in the store;
 *   - it has not already been extracted BY THIS EXTRACTOR VERSION;
 *   - its OWN per-document gate (`documentExtractionBlocked`) does not block it
 *     (MAJOR-A) — MANUAL_REVIEW, or FAILED and still within its backoff window.
 *
 * The "already extracted" clause reads BOTH tables on purpose.
 * `documents.extraction_status` says whether we have tried; `document_fetch_
 * state.extractor_version` says which build produced the result. Either alone
 * is insufficient: status alone would never re-extract after a version bump,
 * version alone would re-extract a document that failed for a reason a new
 * build does not fix.
 */
export function selectPendingFilings(
  ipoId: string,
  docs: CandidateDocument[],
  states: Pick<DocumentFetchStateRow, 'docType' | 'documentId' | 'extractedAt' | 'extractorVersion'>[],
  options: {
    storeDir?: string;
    version?: string;
    fileExists?: (p: string) => boolean;
    now?: Date;
  } = {}
): { pending: CandidateDocument[]; skipped: string[] } {
  const storeDir = options.storeDir ?? getStoreDir();
  const version = options.version ?? EXTRACTOR_VERSION;
  const fileExists = options.fileExists ?? existsSync;

  const versionByDocumentId = new Map<string, string | null>();
  const versionByDocType = new Map<string, string | null>();
  for (const s of states) {
    if (s.documentId) versionByDocumentId.set(s.documentId, s.extractorVersion ?? null);
    versionByDocType.set(s.docType, s.extractorVersion ?? null);
  }

  const pending: CandidateDocument[] = [];
  const skipped: string[] = [];

  for (const doc of docs) {
    const type = String(doc.type ?? '').toUpperCase();
    if (!EXTRACTABLE_DOC_TYPES.includes(type as FilingDocType)) {
      skipped.push(`${type}: not an extractable doc type`);
      continue;
    }
    if (!doc.sha256) {
      skipped.push(`${type}: no sha256 on the document row`);
      continue;
    }
    if (!fileExists(documentPath(ipoId, type, doc.sha256, storeDir))) {
      skipped.push(`${type}: no stored file for ${doc.sha256.slice(0, 8)}`);
      continue;
    }
    const recordedVersion =
      versionByDocumentId.get(doc.id) ?? versionByDocType.get(type) ?? null;
    const alreadyDone =
      doc.extractionStatus === 'COMPLETED' && doc.extractedAt && recordedVersion === version;
    if (alreadyDone) {
      skipped.push(`${type}: already extracted by ${version}`);
      continue;
    }
    // MAJOR-A: per-document gate — MANUAL_REVIEW at this version, or still
    // within this document's own backoff window (FAILED or crash-recovered
    // IN_PROGRESS). Never reads any other document's state, so one
    // permanently-unparseable file can no longer block its siblings.
    const gate = documentExtractionBlocked(
      {
        extractionStatus: doc.extractionStatus,
        extractionError: doc.extractionError,
        retryCount: doc.retryCount ?? 0,
        updatedAt: doc.updatedAt,
      },
      version,
      options.now
    );
    if (gate.blocked) {
      skipped.push(`${type}: ${gate.reason}`);
      continue;
    }
    if (doc.extractionStatus === 'IN_PROGRESS') {
      // A row left IN_PROGRESS means a previous cycle died mid-extract, and its
      // own backoff window (checked above) has elapsed. Retry it rather than
      // leaving it stuck forever — the extractor is deterministic and the
      // persist door is idempotent, so a duplicate run costs time, not
      // correctness.
      logger.warn({ ipoId, docType: type }, 'Document left IN_PROGRESS by an earlier run — retrying');
    }
    pending.push({ ...doc, type });
  }

  return { pending, skipped };
}

/** Where `extract_filing.py` lives, resolved from this module rather than cwd. */
export function extractorScriptPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // src/services -> scraper/scripts
  return path.join(here, '..', '..', 'scripts', 'extract_filing.py');
}

/**
 * `ok: false` carries the error; `ok: true` carries the extraction.
 *
 * Declared as two named types with a `isExtractorFailure` guard rather than
 * relying on `if (!run.ok)` to narrow: this workspace compiles with
 * `strict: false` (shared-package-build.md — the asymmetry is deliberate), and
 * without `strictNullChecks` a boolean discriminant does NOT narrow a union.
 * The same trap already bit `document-discovery-runner.ts`; a type-predicate
 * function narrows in both modes.
 */
export type ExtractorFailure = {
  ok: false;
  error: string;
  /** W-137: true when the extractor was killed by a signal (OOM) or exited
   * with `EXTRACTOR_MEMORY_CEILING_EXIT` — a HARD failure the caller must
   * back off much longer than an ordinary parse/validation failure. */
  hardFailure?: boolean;
};
export type ExtractorSuccess = { ok: true; extraction: FilingExtraction };
export type ExtractorResult = ExtractorSuccess | ExtractorFailure;

export function isExtractorFailure(result: ExtractorResult): result is ExtractorFailure {
  return result.ok === false;
}

export interface ExtractorRunner {
  (args: {
    pdfPath: string;
    docType: string;
    sme: boolean;
    /**
     * W-129 review: the python extractor's net_worth_vs_issue_size /
     * unit_matches_magnitude plausibility checks report `passed: None` (not
     * evaluated) unless this is supplied — without it they are dead in
     * production. `null`/`undefined`/non-finite/non-positive all mean "no
     * known issue size"; the flag is simply omitted.
     */
    issueSizeRupees?: number | null;
  }): ExtractorResult;
}

/** The one `spawnSync` call, factored so the ENOENT-retry can call it twice with a different binary. */
function spawnExtractor(
  bin: string,
  script: string,
  pdfPath: string,
  docType: string,
  sme: boolean,
  issueSizeRupees?: number | null
) {
  const args = [script, pdfPath, '--doc-type', docType];
  if (sme) args.push('--sme');
  if (typeof issueSizeRupees === 'number' && Number.isFinite(issueSizeRupees) && issueSizeRupees > 0) {
    args.push('--issue-size', String(Math.round(issueSizeRupees)));
  }
  return spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: EXTRACT_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    cwd: path.dirname(script),
  });
}

/**
 * Spawn the python extractor and parse its stdout.
 *
 * `spawnSync` matches the existing python-spawn idiom in
 * `scrapers/anchor-investors-scraper.ts`; the cycle is already sequential per
 * IPO, so there is nothing to gain from making this concurrent and a real cost
 * (several hundred MB of pdfplumber/OCR per parallel process) to pay for it.
 *
 * MINOR-1: the binary name is `PYTHON_BIN` when set (some hosts, notably
 * several Linux distros, ship no `python` symlink — only `python3`), else
 * `'python'`. If that first spawn returns ENOENT (`result.error.code`), retry
 * ONCE with `'python3'` before giving up — one extra spawn on a
 * misconfigured host beats a permanently FAILED document.
 *
 * W-111 round 2: the python3 retry is ONLY for the default-bin path (no
 * `PYTHON_BIN` set). When `PYTHON_BIN` IS explicitly set — the deploy sets
 * it to the deploy-managed venv's own python (deploy-linux.sh) — an ENOENT
 * there means that venv is missing or broken, and silently falling back to
 * whatever `python3` resolves to on the box is exactly the un-pinned,
 * drift-prone system install this venv exists to replace (W-112). Fail
 * loudly instead: no retry, error propagates as a normal extraction failure.
 *
 * W-111 round 3: `??` only falls back on null/undefined, not on an empty
 * string — `PYTHON_BIN=""` (set but empty) would compute `primaryBin = ''`
 * and spawn an invalid empty binary name before ever reaching the python3
 * retry. Trim and treat an empty/whitespace-only PYTHON_BIN the same as
 * unset, so both the primary-bin choice and the "explicitly set" branch
 * below see it consistently.
 */
export const defaultExtractorRunner: ExtractorRunner = ({ pdfPath, docType, sme, issueSizeRupees }) => {
  const script = extractorScriptPath();
  const pythonBinExplicitRaw = process.env.PYTHON_BIN?.trim();
  const pythonBinExplicit = pythonBinExplicitRaw ? pythonBinExplicitRaw : undefined;
  const primaryBin = pythonBinExplicit ?? 'python';

  let result = spawnExtractor(primaryBin, script, pdfPath, docType, sme, issueSizeRupees);
  const isEnoent = result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT';
  if (isEnoent && pythonBinExplicit) {
    logger.error(
      { triedBin: primaryBin },
      'PYTHON_BIN explicitly set but not found (ENOENT) — this is the deploy-managed venv; not falling back to system python'
    );
  } else if (isEnoent && primaryBin !== 'python3') {
    logger.warn({ triedBin: primaryBin }, 'python binary not found — retrying once with python3');
    result = spawnExtractor('python3', script, pdfPath, docType, sme, issueSizeRupees);
    if (!result.error) logger.info({ usedBin: 'python3' }, 'extractor spawned with python3 fallback');
  }

  if (result.error) return { ok: false, error: `spawn failed: ${result.error.message}` };
  if (result.status !== 0) {
    // W-137: `result.status === null` means the process was terminated by a
    // signal (`result.signal`, e.g. SIGKILL from the OOM killer) rather than
    // exiting normally — the "exited null" this incident is named for. Exit
    // code 3 is the extractor's OWN memory-ceiling report (memory_guard.py).
    // Both are HARD failures: retrying the same document hourly is exactly
    // what took the pm2 daemon down repeatedly.
    //
    // MINOR-1: a `spawnSync` timeout (`EXTRACT_TIMEOUT_MS`, 10 min) also
    // terminates the process by signal (SIGTERM), so it lands in this SAME
    // `result.status === null` branch and is treated as a hard failure too.
    // Accepted: two slow-network documents in a row earn the 24h floor the
    // same as two OOM kills — a document that reliably times out is exactly
    // as unsafe to retry hourly as one that is killed for memory.
    // Round 4: OpenBLAS (loaded by numpy on the OCR route) can call abort()
    // at the C level under RLIMIT_AS — "OpenBLAS error: Memory allocation
    // still failed after 10 retries, giving up." — which no Python exception
    // handler can run. That leaves EMPTY stdout and an ORDINARY-looking
    // non-zero exit (1), indistinguishable from a real bug by exit code
    // alone. The node side is the only place left that can still tell:
    // scan the captured stderr tail for the known C-level abort/OOM
    // signatures, regardless of exit code.
    const stderrLooksLikeMemoryAbort = isMemoryAbortStderr(result.stderr || '');
    const hardFailure =
      result.status === null || result.status === EXTRACTOR_MEMORY_CEILING_EXIT || stderrLooksLikeMemoryAbort;
    return {
      ok: false,
      error: `extractor exited ${result.status}${result.signal ? ` (signal ${result.signal})` : ''}: ${(result.stderr || '').slice(-800)}`,
      hardFailure,
    };
  }
  let parsed: FilingExtraction;
  try {
    parsed = JSON.parse(result.stdout) as FilingExtraction;
  } catch (error) {
    return {
      ok: false,
      error: `extractor stdout was not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if ((parsed as unknown as { error?: string }).error) {
    return { ok: false, error: String((parsed as unknown as { error: string }).error) };
  }
  return { ok: true, extraction: parsed };
};

export interface AutoPersistDeps {
  /** Documents for the IPO. Injected so the whole flow is testable without a DB. */
  loadDocuments: (ipoId: string) => Promise<CandidateDocument[]>;
  loadStates: (
    ipoId: string
  ) => Promise<
    Pick<DocumentFetchStateRow, 'id' | 'docType' | 'documentId' | 'extractedAt' | 'extractorVersion'>[]
  >;
  runExtractor: ExtractorRunner;
  persistFiling: typeof persistFilingExtraction;
  persisterDeps: FilingPersisterDeps;
  /**
   * W-129 review: fallback source for `ipos.issue_size` (rupees) when the
   * `AutoPersistIpo` passed in does not already carry it. Optional — existing
   * callers/tests that omit it simply get no `--issue-size` flag (the
   * python extractor's net_worth_vs_issue_size / unit_matches_magnitude
   * checks then report `passed: None`, never a false pass or fail).
   */
  loadIssueSizeRupees?: (ipoId: string) => Promise<number | null>;
  /**
   * Stamp `documents.extraction_status` + friends. `retryCount`, when given,
   * is written verbatim (MAJOR-A) — the caller has already computed the new
   * value (0 on success, `previous + 1` on failure); this deps function never
   * increments/decrements on its own, so the arithmetic stays in one place
   * (`processPendingFilings`) and is unit-testable without a database.
   */
  setDocumentExtractionState: (args: {
    documentId: string;
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'MANUAL_REVIEW';
    error?: string | null;
    retryCount?: number;
  }) => Promise<void>;
  /** Stamp `document_fetch_state.extracted_at` + `extractor_version`. */
  setFetchStateExtracted: (args: {
    stateId: string;
    extractedAt: Date | null;
    extractorVersion: string | null;
  }) => Promise<void>;
  /** J1. */
  invalidateCaches: (slug: string) => Promise<void>;
  /**
   * "Is this document's file actually on disk?" — injected rather than calling
   * `existsSync` inline so the whole service is drivable in a test without a
   * store directory (and without monkeypatching `node:fs`, which the module
   * registry refuses to redefine).
   */
  fileExists?: (path: string) => boolean;
  storeDir?: string;
  version?: string;
  /** MAJOR-1: shared across the whole document cycle. `undefined` = unbounded (existing callers/tests). */
  spawnBudget?: SpawnBudget;
  /**
   * F3 (S-02 round 6): absolute epoch ms (per `now()`) after which no NEW
   * spawn may start. Checked BEFORE each spawn inside the extract loop —
   * never mid-extraction — so `document-cycle.ts`'s 25-minute extraction cap
   * is honoured PER DOCUMENT within an IPO, not only between IPOs.
   * `undefined` = no deadline (existing callers/tests are unaffected).
   */
  deadlineMs?: number;
  /** Clock used against `deadlineMs`. Defaults to `Date.now`. */
  now?: () => number;
}

/** The real dependency set, wired to the database and the filesystem. */
export function buildAutoPersistDeps(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): AutoPersistDeps {
  const documentRepository = new DocumentRepository(db as never, redis as never);
  const invalidator = new CacheInvalidator(redis as never);
  // ONE filing write door (s02-step-ledger-wiring.test.ts): this service must
  // never instantiate its own `IPORepository` — it reuses the one the shared
  // `buildFilingPersistDeps` builder already constructs.
  const persisterDeps = buildFilingPersistDeps(redis);

  return {
    // W-129 review: the smallest read that fits the existing pattern — no new
    // repository, no new DB client — the document-cycle candidate query does
    // not select `ipos.issue_size`, so it is fetched here, once per IPO per call.
    async loadIssueSizeRupees(ipoId) {
      const row = await persisterDeps.ipoRepository.findById(ipoId);
      const raw = (row as { issueSize?: string | number | null } | null)?.issueSize;
      if (raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    },
    async loadDocuments(ipoId) {
      const rows = await documentRepository.findByIPO(ipoId);
      return rows.map((r) => ({
        id: (r as { id: string }).id,
        type: (r as { type: string }).type,
        sha256: (r as { sha256?: string | null }).sha256 ?? null,
        extractionStatus: (r as { extractionStatus?: string | null }).extractionStatus ?? null,
        extractedAt: (r as { extractedAt?: Date | null }).extractedAt ?? null,
        retryCount: (r as { retryCount?: number | null }).retryCount ?? 0,
        updatedAt: (r as { updatedAt?: Date | null }).updatedAt ?? null,
        extractionError: (r as { extractionError?: string | null }).extractionError ?? null,
      }));
    },
    async loadStates(ipoId) {
      const { DocumentFetchStateRepository } = await import('@ipodhan/shared');
      const store = new DocumentFetchStateRepository(db as never, redis as never);
      return store.listForIpo(ipoId);
    },
    runExtractor: defaultExtractorRunner,
    persistFiling: persistFilingExtraction,
    persisterDeps,
    async setDocumentExtractionState({ documentId, status, error, retryCount }) {
      // Round 4: the REAL writer. It does not compute the patch itself — it
      // hands `buildExtractionStatePatch` (the ONE pure function every status
      // write goes through) the same args the caller already decided, and
      // applies whatever comes back unchanged. `error` is passed through as
      // given (including `undefined`, which leaves `extraction_error`
      // untouched — see `ExtractionStatePatchContext`); `retry_count` is
      // written verbatim when the caller supplies it (MAJOR-A) — the
      // increment/reset arithmetic lives at the call site (`processPendingFilings`),
      // never here.
      const patch = buildExtractionStatePatch(status as ExtractionStatus, { error, retryCount }, new Date());
      await db.update(documentsTable).set(patch as never).where(eq(documentsTable.id, documentId));
    },
    async setFetchStateExtracted({ stateId, extractedAt, extractorVersion }) {
      const { DocumentFetchStateRepository } = await import('@ipodhan/shared');
      const store = new DocumentFetchStateRepository(db as never, redis as never);
      await store.update(stateId, { extractedAt, extractorVersion });
    },
    async invalidateCaches(slug) {
      await invalidator.invalidateAfterScrape('ALL', slug ? [slug] : []);
    },
  };
}

/**
 * Transition 3 vs 5: a FAILED write (extractor / persist / W-45 disagreement)
 * becomes MANUAL_REVIEW instead when the retryCount already stamped at
 * IN_PROGRESS (transition 1) has reached `MAX_EXTRACTION_ATTEMPTS`. One
 * function so all three failure sites in `processPendingFilings` decide the
 * same way.
 */
function classifyFailure(
  retryCountAtStamp: number,
  version: string,
  rawError: string
): { status: 'FAILED' | 'MANUAL_REVIEW'; error: string } {
  if (retryCountAtStamp >= MAX_EXTRACTION_ATTEMPTS) {
    return { status: 'MANUAL_REVIEW', error: `${EXTRACTION_BLOCKED_ERROR}@${version}` };
  }
  return { status: 'FAILED', error: rawError };
}

/**
 * Extract and persist every outstanding filing for ONE IPO.
 *
 * Returns a summary; never throws. The caller (the document cycle) treats this
 * as a best-effort post-write side effect (`non-fatal-side-effects.md`).
 */
export async function processPendingFilings(
  ipo: AutoPersistIpo,
  deps: AutoPersistDeps
): Promise<AutoPersistResult> {
  const version = deps.version ?? EXTRACTOR_VERSION;
  const result: AutoPersistResult = {
    ipoId: ipo.id,
    considered: 0,
    extracted: 0,
    persisted: 0,
    failed: 0,
    skipped: [],
    spawned: 0,
    skippedBudget: 0,
  };

  // D-15: automatic extract+persist ran ONLY for MAINBOARD IPOs until the SME
  // walk passed in production (W-128 financials exact, W-129 plausibility with
  // issue-size wiring, W-130 subscription, W-132 anchors — Qualiance
  // International, 2026-09-04). The lift is flag-controlled
  // (`ENABLE_SME_FILING_AUTO_PERSIST`, default OFF): with the flag off, an SME
  // candidate still spawns no python, persists nothing, and gets one E1
  // ledger row explaining why, instead of silently being treated like a
  // MAINBOARD row. With the flag on, it falls through to the same code below
  // that already handles it (the `sme` bool + `issueSizeRupees` resolution
  // just past the budget gate) — same write door, same W-45/W-129 gates, no
  // second path. Checked before the spawn-budget gate (below) so an
  // SME IPO never consumes cycle-wide spawn budget either, while the flag is off.
  if (String(ipo.segment ?? '').toUpperCase() === 'SME' && !smeAutoPersistEnabled()) {
    try {
      await writeSteps(ipo.id, [
        {
          stepId: 'E1',
          status: 'NOT_AVAILABLE_YET',
          evidence: { reason: 'sme_not_validated' },
        },
      ]);
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
        'Could not record sme_not_validated E1 ledger row (non-fatal)'
      );
    }
    return result;
  }

  // F5 (S-02 round 6): the budget is a CYCLE-wide counter (MAJOR-1) — once it
  // is spent, every remaining candidate IPO is guaranteed to be all-skipped-
  // budget regardless of what documents it has. Loading documents + fetch
  // states for it first was pure waste (two DB round trips per candidate,
  // every cycle, for data that gets thrown away unread). Check BEFORE any
  // read.
  if (deps.spawnBudget && deps.spawnBudget.remaining <= 0) {
    logger.info(
      { ipoId: ipo.id },
      'Spawn budget already exhausted this cycle — skipping document load for this IPO (non-fatal)'
    );
    return result;
  }

  let docs: CandidateDocument[];
  let states: Awaited<ReturnType<AutoPersistDeps['loadStates']>>;
  try {
    docs = await deps.loadDocuments(ipo.id);
    states = await deps.loadStates(ipo.id);
  } catch (error) {
    logger.error(
      { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
      'Could not load documents for auto-persist (non-fatal)'
    );
    return result;
  }

  const { pending, skipped } = selectPendingFilings(ipo.id, docs, states, {
    storeDir: deps.storeDir,
    version,
    fileExists: deps.fileExists,
  });
  result.considered = docs.length;
  result.skipped = skipped;

  // MAJOR-1: apply the cross-cycle spawn budget BEFORE extracting anything.
  // Docs beyond the remaining budget are left PENDING (untouched) and reported
  // as skipped_budget — they are simply next cycle's (or a later IPO's, since
  // the same counter is shared) work, exactly like the wall-clock budget in
  // `runDocumentCycle` already treats unprocessed IPOs.
  let budgeted = pending;
  if (deps.spawnBudget) {
    const allowed = Math.max(0, deps.spawnBudget.remaining);
    if (pending.length > allowed) {
      budgeted = pending.slice(0, allowed);
      result.skippedBudget = pending.length - allowed;
      result.skipped = [
        ...result.skipped,
        `${result.skippedBudget} document(s) left PENDING — spawn budget exhausted this cycle`,
      ];
    }
  }
  if (budgeted.length === 0) return result;
  const pendingForThisCall = budgeted;

  const stateIdByDocType = new Map(states.map((s) => [s.docType, s.id]));
  const sme = String(ipo.segment ?? '').toUpperCase() === 'SME';
  const extractions: Array<{ doc: CandidateDocument; extraction: FilingExtraction }> = [];

  // W-129 review: the same issue size backs every document extracted for this
  // IPO this call, so it is resolved ONCE here rather than per document. The
  // candidate object wins when it already carries `issueSize` (cheapest —
  // zero extra reads); otherwise fall back to the injected repository read.
  // Any failure here is non-fatal — extraction proceeds with no issue size,
  // which the extractor treats as "not evaluated", never a false pass/fail.
  let issueSizeRupees: number | null = ipo.issueSize ?? null;
  if (issueSizeRupees == null && deps.loadIssueSizeRupees) {
    try {
      issueSizeRupees = await deps.loadIssueSizeRupees(ipo.id);
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
        'Could not load issue size for plausibility checks (non-fatal) — extracting without it'
      );
    }
  }

  // ---------------------------------------------------------------- extract
  for (let pendingIdx = 0; pendingIdx < pendingForThisCall.length; pendingIdx++) {
    const doc = pendingForThisCall[pendingIdx];

    // F3: the deadline is checked BEFORE starting a new spawn, never inside
    // one already running — an extraction in flight always finishes. Once
    // past the deadline, every remaining document in THIS call is left
    // PENDING and reported the same way the spawn-budget cutoff already is.
    if (deps.deadlineMs !== undefined && (deps.now ?? Date.now)() >= deps.deadlineMs) {
      const remaining = pendingForThisCall.length - pendingIdx;
      result.skippedBudget += remaining;
      result.skipped = [
        ...result.skipped,
        `${remaining} document(s) left PENDING — extraction deadline reached`,
      ];
      break;
    }

    const docType = doc.type as FilingDocType;
    const pdfPath = documentPath(ipo.id, docType, doc.sha256 as string, deps.storeDir ?? getStoreDir());

    // Transition 1 (select -> IN_PROGRESS). The attempt is counted HERE, at
    // the stamp — round-4 MINOR-6: a process killed mid-extraction leaves the
    // row IN_PROGRESS with this attempt already consumed, not free. Reviving a
    // document blocked at an OLD EXTRACTOR_VERSION (transition 6) resets to 1
    // rather than incrementing from MAX_EXTRACTION_ATTEMPTS — `documentExtractionBlocked`
    // only admits such a document once the encoded version no longer matches.
    const previousRetryCount = doc.retryCount ?? 0;
    const revivingAfterManualReview = doc.extractionStatus === 'MANUAL_REVIEW';
    const newRetryCount = revivingAfterManualReview ? 1 : previousRetryCount + 1;
    // Mutate the shared reference: the W-45 and persist failure paths below
    // read `doc.retryCount` for the SAME "already counted at the stamp" value
    // — one increment, read wherever this document is handled again this run.
    doc.retryCount = newRetryCount;

    try {
      await deps.setDocumentExtractionState({ documentId: doc.id, status: 'IN_PROGRESS', retryCount: newRetryCount });
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, docType, error: error instanceof Error ? error.message : String(error) },
        'Could not mark document IN_PROGRESS (non-fatal) — extracting anyway'
      );
    }

    result.spawned++;
    if (deps.spawnBudget) deps.spawnBudget.remaining--;
    const run = deps.runExtractor({ pdfPath, docType, sme, issueSizeRupees });

    if (isExtractorFailure(run)) {
      result.failed++;
      // W-137: a killed/memory-ceiling extractor is a HARD failure — embed
      // the (incrementing) hard-failure marker so the NEXT cycle's
      // `documentExtractionBlocked` widens the backoff to >= 24h once this
      // has happened twice on the SAME document, instead of retrying hourly.
      const rawError = run.hardFailure
        ? markHardFailure(doc.extractionError, `extractor: ${run.error}`)
        : `extractor: ${run.error}`;
      // Transition 3 / 5: retryCount is NOT re-incremented here — it was
      // already counted at the IN_PROGRESS stamp above. Once that count has
      // reached MAX_EXTRACTION_ATTEMPTS, classifyFailure writes MANUAL_REVIEW
      // (with EXTRACTOR_VERSION embedded in the error) instead of FAILED, so
      // the row self-documents WHY the next cycle will not retry it.
      const classified = classifyFailure(newRetryCount, version, rawError);
      const blocked = classified.status === 'MANUAL_REVIEW';
      logger.error(
        { ipoId: ipo.id, docType, error: run.error, retryCount: newRetryCount, blocked, hardFailure: run.hardFailure === true },
        blocked
          ? 'Filing extraction failed for the 10th time — blocked until EXTRACTOR_VERSION changes'
          : run.hardFailure
            ? 'Filing extractor was killed (OOM/memory ceiling) — recorded as FAILED with a hard backoff (>=24h after the 2nd such failure)'
            : 'Filing extraction failed (non-fatal) — recorded as FAILED with a backoff'
      );
      await writeSteps(
        ipo.id,
        planExtractionFailureSteps(classified.error, {
          docType,
          documentId: doc.id,
          sourceSha: doc.sha256,
          version,
          attemptsBefore: previousRetryCount,
        })
      );
      // MAJOR-A: the document's own extraction_status becomes FAILED (not
      // PENDING) — `documentExtractionBlocked` reads FAILED + retry_count +
      // updated_at to compute this document's backoff window, so the status
      // must say FAILED for the gate to hold it until that window elapses.
      // retryCount is omitted here — it is unchanged from the IN_PROGRESS
      // stamp above, except for MANUAL_REVIEW where it is written again for
      // an auditable row (same value, no arithmetic).
      try {
        await deps.setDocumentExtractionState({
          documentId: doc.id,
          status: classified.status,
          error: classified.error.slice(0, 1000),
          ...(blocked ? { retryCount: newRetryCount } : {}),
        });
      } catch {
        /* already logged by the writer; a stuck status must not fail the cycle */
      }
      continue;
    }

    const extraction = (run as ExtractorSuccess).extraction;
    result.extracted++;
    extractions.push({ doc, extraction });
    await writeSteps(
      ipo.id,
      planExtractionSteps(extraction, {
        docType,
        documentId: doc.id,
        sourceSha: doc.sha256,
        version,
      })
    );
  }

  if (extractions.length === 0) return result;

  // ------------------------------------------------------- W-45 paired gate
  // When this run produced BOTH a price-band ad and an RHP, the same
  // cross-document agreement gate the CLI runs must run here: two documents from
  // the same issuer on the same day that disagree about a restated figure mean
  // one was mis-parsed, and there is no way to tell which — so neither series is
  // written. Skipping the gate here would make the automatic path LESS careful
  // than the manual one.
  const ad = extractions.find((e) => e.doc.type === 'PRICE_BAND_AD');
  const rhp = extractions.find((e) => e.doc.type === 'RHP');
  let refusedReason: string | null = null;

  if (ad && rhp) {
    const agreement = checkCrossDocumentAgreement(
      comparableSeries(ad.extraction),
      comparableSeries(rhp.extraction),
      undefined,
      'PRICE_BAND_AD',
      'RHP',
      parseFilingUnit(ad.extraction.unit),
      parseFilingUnit(rhp.extraction.unit)
    );
    const decision = decidePairedPersist(agreement);
    if (!decision.proceed) {
      refusedReason = decision.reason;
      logger.error(
        { ipoId: ipo.id, reason: decision.reason },
        'W-45 cross-document agreement refused the paired persist — nothing written'
      );
    } else if (decision.withhold.length > 0) {
      ad.extraction = withholdDisagreeingMetrics(ad.extraction, decision.withhold);
      rhp.extraction = withholdDisagreeingMetrics(rhp.extraction, decision.withhold);
      logger.warn(
        { ipoId: ipo.id, withheld: decision.withhold },
        'W-45: disagreeing metric series withheld from both documents'
      );
    }
  }

  if (refusedReason) {
    result.failed += extractions.length;
    // Transition 3: a W-45 refusal is FAILED-with-backoff, never MANUAL_REVIEW
    // or PENDING (round-3 MAJOR-4) — it is retried like any other extraction
    // failure. `doc.retryCount` already holds the value the IN_PROGRESS stamp
    // wrote for THIS document earlier in this run.
    for (const { doc } of extractions) {
      const classified = classifyFailure(doc.retryCount ?? 0, version, `w45_disagreement: ${refusedReason}`);
      await deps
        .setDocumentExtractionState({
          documentId: doc.id,
          status: classified.status,
          error: classified.error.slice(0, 1000),
          ...(classified.status === 'MANUAL_REVIEW' ? { retryCount: doc.retryCount } : {}),
        })
        .catch(() => undefined);
    }
    await writeSteps(ipo.id, [
      {
        stepId: 'G1',
        status: 'BLOCKED',
        source: 'W-45',
        error: `cross-document agreement refused: ${refusedReason}`.slice(0, 1000),
        version,
      },
    ]);
    return result;
  }

  // ---------------------------------------------------------------- persist
  let anyPersisted = false;
  for (const { doc, extraction } of extractions) {
    const docType = doc.type as FilingDocType;
    let summary: PersistFilingSummary;
    try {
      summary = await deps.persistFiling(
        ipo.id,
        extraction,
        { docType, documentId: doc.id, sourceSha: doc.sha256, apply: true },
        deps.persisterDeps
      );
    } catch (error) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ ipoId: ipo.id, docType, error: message }, 'Filing persist failed (non-fatal)');
      // Transition 3: a persist throw is FAILED-with-backoff, never PENDING
      // (round-3 MINOR-5 — PENDING would drop the document straight back to
      // the front of the queue with no backoff at all). `doc.retryCount`
      // already holds the value the IN_PROGRESS stamp wrote earlier this run.
      const classified = classifyFailure(doc.retryCount ?? 0, version, `persist: ${message}`);
      await writeSteps(ipo.id, [
        {
          stepId: 'G3',
          status: 'FAILED',
          source: docType,
          inputRef: doc.sha256 ?? doc.id,
          version,
          error: classified.error.slice(0, 1000),
        },
      ]);
      await deps
        .setDocumentExtractionState({
          documentId: doc.id,
          status: classified.status,
          error: classified.error.slice(0, 1000),
          ...(classified.status === 'MANUAL_REVIEW' ? { retryCount: doc.retryCount } : {}),
        })
        .catch(() => undefined);
      continue;
    }

    result.persisted++;
    anyPersisted = true;
    await writeSteps(
      ipo.id,
      planPersistSteps(summary, { docType, documentId: doc.id, sourceSha: doc.sha256, version })
    );

    const now = new Date();
    // MAJOR-A: a successful extraction resets this document's own retry
    // counter to 0 — a document that failed nine times and then succeeded
    // must not carry that history into its next unrelated extraction attempt
    // (e.g. after a future EXTRACTOR_VERSION bump).
    await deps
      .setDocumentExtractionState({ documentId: doc.id, status: 'COMPLETED', error: null, retryCount: 0 })
      .catch(() => undefined);
    const stateId = stateIdByDocType.get(docType);
    if (stateId) {
      await deps
        .setFetchStateExtracted({ stateId, extractedAt: now, extractorVersion: version })
        .catch(() => undefined);
    }

    logger.info(
      { ipoId: ipo.id, company: ipo.companyName, docType, written: summary.written },
      'Filing extracted and persisted automatically (S-02)'
    );
  }

  // ---------------------------------------------------------------------- J1
  if (anyPersisted) {
    try {
      await deps.invalidateCaches(ipo.slug ?? '');
      await recordLiveStep(ipo.id, 'J1', {
        source: 'FILING_AUTO_PERSIST',
        evidence: { slug: ipo.slug ?? null, documents: result.persisted },
      });
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
        'Cache invalidation after auto-persist failed (non-fatal)'
      );
    }
  }

  return result;
}

/** True when the automatic path is switched on. Read through the flag object. */
export function autoPersistEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_FILING_AUTO_PERSIST === true;
}

/**
 * D-15 lift: true when SME candidates are allowed through the same
 * auto-persist door as MAINBOARD. Read through the flag object. Independent
 * of `autoPersistEnabled()` — this only narrows/widens which segment the
 * already-on auto-persist path covers.
 */
export function smeAutoPersistEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_SME_FILING_AUTO_PERSIST === true;
}
