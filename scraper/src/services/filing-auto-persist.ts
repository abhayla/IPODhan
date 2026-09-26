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
 * The E1..E10 ledger rows are WRITTEN on every extraction attempt (with
 * `attemptsBefore` taken from the document's own `retry_count`), but
 * `ipo_pipeline_steps` holds ONE row per (ipo, step), so each attempt
 * OVERWRITES the last: the ledger is a last-attempt snapshot, not an attempt
 * history (#634). They are not READ to decide whether this cycle may spawn
 * python. The attempt history is `document_extraction_attempts`: every
 * FAILED / MANUAL_REVIEW write appends one row (attempt number, cause, time)
 * in the same transaction as the status write, so a document at the retry
 * ceiling can answer "the same fault ten times, or ten different faults?".
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { pageRowsFromExtraction, type DocumentPageRow } from './document-page-text.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { db, getRedisClient, DocumentRepository } from '@ipodhan/shared';
import {
  documents as documentsTable,
  documentPages as documentPagesTable,
  documentExtractionAttempts as documentExtractionAttemptsTable,
} from '@ipodhan/shared/db/schema';
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
import { runAnchorAutoPersist, type AnchorAutoOutcome } from './anchor-auto-persist.js';
import {
  CORRIGENDUM_DOC_TYPE,
  buildCorrigendumSuggestionRunner,
  type CorrigendumSuggestionRunner,
} from './corrigendum-reader.js';
import { SIDECAR_TIMEOUT_MS } from '../scrapers/anchor-investors-scraper.js';
import type { ExtractionStatus, ExtractionStatePatchContext } from './extraction-state-patch.js';
import { buildExtractionStatePatch, buildExtractionAttemptRow } from './extraction-state-patch.js';

/**
 * The extractor build that produced a stored extraction.
 *
 * ONE constant, written to `document_fetch_state.extractor_version` and to every
 * E/G ledger row's `version`. Bumping it is what makes every already-extracted
 * document eligible again — which is the only re-extraction trigger, so a bump
 * is a deliberate act, not a side effect of an unrelated change.
 */
export const EXTRACTOR_VERSION = 'extract_filing.py@2026-09-26';

/** Doc types `scripts/extract_filing.py` understands. Anything else is skipped. */
import {
  AUTO_PERSIST_DOC_TYPES,
  isExtractableDocType,
  NOT_EXTRACTABLE_STATUS,
  resolveAdmissionExtractionStatus,
} from '../config/document-admission-status.js';

export const EXTRACTABLE_DOC_TYPES: readonly FilingDocType[] = [
  'PRICE_BAND_AD',
  'RHP',
  'DRHP',
  'PROSPECTUS',
];

/**
 * W-142. The anchor allocation report is auto-persistable but is NOT an
 * `extract_filing.py` doc type — it has its own extractor
 * (`scripts/anchor_report_text.py`) and its own write door
 * (`anchor-persister.ts`). Keeping it out of `EXTRACTABLE_DOC_TYPES` and out
 * of `FilingDocType` is deliberate: those two say "the python filing extractor
 * parses this", and teaching them otherwise would make `runExtractor` spawn a
 * script that answers `unknown doc type ANCHOR_ALLOCATION_REPORT`.
 */
export const ANCHOR_DOC_TYPE = 'ANCHOR_ALLOCATION_REPORT';

/**
 * Every doc type the automatic door will CONSIDER — the filing extractor's
 * four plus the anchor report. This, not `EXTRACTABLE_DOC_TYPES`, is the
 * selection gate; the branch inside `processPendingFilings` decides which
 * extractor each one goes to.
 */
// Imported AND re-exported from ../config/document-admission-status.js, which OWNS this
// list so the DISCOVERY layer can read it too (§7.6: discovery is the bottom layer and may
// not import this module). One list, so the admission stamp and this module's dispatch can
// never disagree about which types have an extractor — the mechanism of #869's fix.
//
// `export ... from` alone would NOT work: it re-exports without binding the name in this
// module's scope, and this file calls isExtractableDocType internally. Caught by the type
// checker ("Cannot find name 'isExtractableDocType'") and by 74 red tests.
export { AUTO_PERSIST_DOC_TYPES, isExtractableDocType, NOT_EXTRACTABLE_STATUS, resolveAdmissionExtractionStatus };

/**
 * NOT_APPLICABLE reporting (lane B item, 2026-09-16). Whether a document type
 * has any extractor at all — the single source of truth `selectPendingFilings`
 * uses to skip a row, and the same predicate the audit's not-applicable
 * reporter (`scripts/lib/not-applicable-documents.mjs`) mirrors so a document
 * type outside this list is never read as "stuck", only as "not applicable".
 */
// (isExtractableDocType is re-exported above, from the config module that owns the list.)

/**
 * The skip/registry reason for a PENDING document whose type has no
 * extractor by design (see `isExtractableDocType`). Distinct from a genuine
 * extraction failure — this document was never a candidate to extract.
 */
export const NOT_APPLICABLE_EXTRACTION_REASON = 'no_extractor_for_doc_type';

/**
 * #869 — re-exported from `../config/document-admission-status.js`, which is where
 * these live so the DISCOVERY layer can read them too. Discovery is the bottom of
 * the §7.6 layer order and may not import this module (consolidation); defining
 * them here made `document-discovery-runner -> filing-auto-persist` an upward edge
 * that `scripts/ci/check-module-boundaries.mjs` correctly refused.
 *
 * Re-exported rather than moved outright so existing importers of this module keep
 * working, and `resolveAdmissionExtractionStatus` is wrapped to supply this module's
 * own `isExtractableDocType` — the predicate the consumer dispatches on — so the
 * admission stamp cannot drift from what actually gets processed.
 */


/**
 * OD-55 (owner, 2026-09-11): there is NO per-document extraction budget.
 * `EXTRACT_TIMEOUT_MS` (10 minutes) was removed, not raised — the owner
 * rejected the timed cap outright, not its size: *"Let the scraper take
 * whatever time it needs to scrape each of the documents ... Who set up that
 * ten-minute limit? I never approved that."* A prospectus whose financials are
 * drawn pages (ESDS: 555 pages, ~60 needing OCR at ~46 s/page, 3028 s measured
 * end to end) has to be read completely in the first pass.
 *
 * What remains is a HUNG-PROCESS CEILING — a crash guard, not a budget. It
 * exists to catch a genuinely stuck process (a hung PDF library, a corrupt
 * file that never returns), never to cap a slow but progressing OCR pass.
 *
 * THE CEILING IS EXTERNAL TO THIS PROCESS, and this constant is only its
 * CHILD HALF. Extraction is a blocking `spawnSync`: while it runs, this
 * process cannot execute a timer, a signal handler, or a lock release. So a
 * ceiling implemented ONLY as the spawn's own timeout cannot catch the case
 * the ceiling exists for — a parent wedged around its child. The authoritative
 * ceiling is a supervisor OUTSIDE the document-job process (the wake wrapper's
 * timer / a pm2-level max runtime); `CHILD_HUNG_CEILING_MS` is the inner half
 * that stops a hung child while the parent is still healthy enough to record
 * what happened.
 *
 * The child half is deliberately set slightly BELOW the external ceiling, so
 * that on a genuinely hung child the inner timeout fires FIRST and the parent
 * still gets to write the PARTIAL_OCR envelope. If the outer one wins the race
 * there is no envelope at all — only the supervisor's own record.
 */
export const HUNG_PROCESS_CEILING_MS = 2 * 60 * 60 * 1000;

/**
 * The inner (child) half of the 2-hour ceiling, below it by
 * `CEILING_RECORD_MARGIN_MS` so the parent survives the child's death by long
 * enough to write the envelope naming every unread page.
 */
export const CEILING_RECORD_MARGIN_MS = 5 * 60 * 1000;
export const CHILD_HUNG_CEILING_MS = HUNG_PROCESS_CEILING_MS - CEILING_RECORD_MARGIN_MS;

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

/**
 * W-137 memory-abort stderr detection. The definitions moved to
 * `memory-abort-stderr.ts` (see that file for why) and are re-exported here
 * unchanged — every existing importer of `MEMORY_ABORT_STDERR_RE`,
 * `MEMORY_ABORT_KILLED_RE` and `isMemoryAbortStderr` keeps working.
 */
import { isMemoryAbortStderr } from './memory-abort-stderr.js';
import { withLowPriority, EXTRACTOR_BUSY_EXIT_CODE } from '../utils/low-priority-spawn.js';
export {
  MEMORY_ABORT_STDERR_RE,
  MEMORY_ABORT_KILLED_RE,
  isMemoryAbortStderr,
} from './memory-abort-stderr.js';

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
  if (match) return match[1];
  // Round-2 MINOR-1: a MANUAL_REVIEW written for a REASON other than
  // "10 attempts" (the anchor door's scan-quality refusals) still has to say
  // which extractor build parked it, or `documentExtractionBlocked` reads it
  // as an operator-set/legacy row and blocks it FOREVER — even after an
  // extractor bump that would fix it. Such rows end with ` @<version>`.
  const suffix = / @(\S+)$/.exec(error);
  return suffix ? suffix[1] : null;
}

/**
 * Stamp an extractor version onto a MANUAL_REVIEW reason (round-2 MINOR-1).
 *
 * The reason is truncated FIRST so the version suffix always survives the
 * 1000-char `extraction_error` cap — a truncated-off version is exactly the
 * permanent block this fixes.
 */
export function withBlockedVersion(reason: string, version: string, max = 1000): string {
  const suffix = ` @${version}`;
  return `${reason.slice(0, Math.max(0, max - suffix.length))}${suffix}`;
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

/**
 * W-168: a deterministic parser refusal (`AnchorScrapeFailureKind ===
 * 'parse_failed'` — "no bid price could be derived", "no amount consistent
 * with the derived bid price", "N investor rows could be read") will refuse
 * the SAME way on every retry: the scan/table shape does not change between
 * cycles, so the ordinary 10-attempt exponential backoff just burns a spawn
 * every cycle for up to 10 cycles before finally parking it. This classifies
 * such a refusal to MANUAL_REVIEW after the SECOND identical failure on the
 * SAME source file, stamped with the extractor version exactly like the
 * `blocked_after_10_attempts` floor refusal — so a later extractor version
 * bump revives it via the existing `parseBlockedVersion` mechanism.
 *
 * W-168 round 2 (HOLE 3): "identical" is keyed on the STRUCTURAL identity
 * `(kind, sha256)`, both encoded in the previous `extraction_error` as
 * `<reason> @id:<kind>:<sha16>` — never on the reason TEXT. `reason` is kept
 * only for the human-readable message; comparing it would let a cosmetic OCR
 * variation between two runs (different whitespace, a re-rounded number) read
 * as "a different failure" and defeat the 2-strike rule even though the
 * underlying refusal (same kind, same file) is identical. A DIFFERENT sha
 * (the document row was re-fetched with new bytes) is treated as a fresh
 * first occurrence — a new file may not fail the same way — never a match.
 */
export function classifyDeterministicAnchorParseFailure(
  kind: string,
  reason: string,
  sha256: string | null | undefined,
  previousError: string | null | undefined,
  version: string
): { status: 'FAILED' | 'MANUAL_REVIEW'; error: string } {
  const shaTag = sha256 ? sha256.slice(0, 16) : 'unknown';
  const prevMatch = /@id:([a-z0-9_]+):([0-9a-f]+|unknown)\s*$/i.exec(previousError ?? '');
  if (prevMatch && prevMatch[1] === kind && prevMatch[2] === shaTag) {
    return { status: 'MANUAL_REVIEW', error: withBlockedVersion(reason, version) };
  }
  return { status: 'FAILED', error: `${reason} @id:${kind}:${shaTag}` };
}

/**
 * `ExtractionStatus`, `ExtractionStatePatchContext` and `buildExtractionStatePatch` now live in
 * `./extraction-state-patch.js` (build-hygiene split, PR #1017 follow-up) — that module has zero
 * imports of its own, so a script that needs only the pure patch function doesn't drag this
 * file's whole import graph into `tsconfig.scripts.json`'s stricter program. Re-exported here so
 * every existing import site (this file's own callers below, and `filing-auto-persist.js`
 * importers elsewhere) is unaffected.
 */
export type { ExtractionStatus, ExtractionStatePatchContext };
export { buildExtractionStatePatch };

/**
 * #634: a failed extraction attempt's status write AND its append to
 * `document_extraction_attempts`, in one transaction, so the status can never say FAILED without
 * the cause being on record (and vice versa). The attempt number is the row's own `retry_count`
 * after the write, read back with RETURNING (the attempt was counted at its IN_PROGRESS stamp).
 * Exported so the integration test drives this exact code on ipodhan_test.
 */
export async function writeStatusWithAttempt(
  dbx: typeof db,
  documentId: string,
  status: ExtractionStatus,
  error: string | null | undefined,
  patch: Record<string, unknown>,
  now: Date = new Date()
): Promise<Array<{ ipoId: string; retryCount: number }>> {
  const updated = await dbx.transaction(async (tx) => {
    const updated = await tx
      .update(documentsTable)
      .set(patch as never)
      .where(eq(documentsTable.id, documentId))
      .returning({ ipoId: documentsTable.ipoId, retryCount: documentsTable.retryCount });
    const attempt = updated[0]
      ? buildExtractionAttemptRow(documentId, status, error, Number(updated[0].retryCount ?? 0), now)
      : null;
    if (attempt) await tx.insert(documentExtractionAttemptsTable).values(attempt);
    return updated;
  });
  // #676: invalidate `documents:<ipoId>` AFTER commit, never inside the tx — a
  // rollback leaving a cleared cache is harmless (re-caches on next read), but
  // a commit must always be followed by one, or `findByIPO`'s 1h cache-aside
  // keeps serving the pre-write row (same class as `setDocumentExtractionState`
  // above). Fail-open on a Redis error, matching that handler.
  const ipoId = updated[0]?.ipoId;
  if (ipoId) {
    try {
      const repo = new DocumentRepository(dbx as never, getRedisClient() as never);
      await repo.invalidateForIpo(ipoId);
    } catch (cacheError) {
      logger.warn(
        { documentId, ipoId, error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
        'Could not invalidate documents cache after a transactional status write (non-fatal)'
      );
    }
  }
  return updated;
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
  /**
   * W-168: anchor allocation report counts for this call, kept separate from
   * the filing-doc-type counters above (`extracted`/`persisted`/`failed`
   * still include anchors too, for backward compatibility with existing
   * callers) so `document-cycle.ts` can log ONE
   * "anchors considered/spawned/persisted/manual_review/failed" line per cycle.
   */
  anchorsConsidered: number;
  anchorsSpawned: number;
  anchorsPersisted: number;
  anchorsManualReview: number;
  anchorsFailed: number;
  /** Item 9 (OD-90): corrigenda read this call, and the suggestion rows they added. */
  corrigendaRead: number;
  corrigendumSuggestions: number;
}

/**
 * MAJOR-1 fix. Before this, one document cycle could spawn UNBOUNDED python
 * processes: 20 IPOs x 2 filings x up to the per-document extraction budget
 * (then `EXTRACT_TIMEOUT_MS`, 10 min; removed by OD-55 — see
 * `HUNG_PROCESS_CEILING_MS`) each
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
 * W-168. Before this, the anchor allocation report shared the SAME cycle-wide
 * `spawnBudget` as the four `extract_filing.py` doc types. Live evidence
 * (2026-09-06, two staging cycles): every SME anchor letter tried failed
 * deterministically in the parser, and each failing anchor consumed one of
 * the cycle's `DEFAULT_MAX_SPAWNS_PER_CYCLE` (3) slots, retried across BOTH
 * cycles by the ordinary exponential backoff — three failing anchors can eat
 * the WHOLE extraction budget and starve real filings (RHP/ads) for cycles.
 *
 * Anchors now get their OWN per-cycle spawn budget (`anchorSpawnBudget`,
 * separate `SpawnBudget` instance), attempted in their OWN pass AFTER every
 * filing document this call — never drawn from the filing budget, and never
 * blocking a filing document behind it.
 */
export const DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE = 1;

/**
 * W-168 round 2 (HOLE 1). The lock-TTL static test only ever asserted the
 * DEFAULT anchor budget against the TTL — an operator setting
 * `ANCHOR_MAX_SPAWNS_PER_CYCLE` high enough (8, at the sidecar's 120s each)
 * pushes the combined worst case (filing pass + anchor pass + slack) PAST
 * `FILING_EXTRACTION_LOCK_TTL_MS` without the code (or the static test,
 * which only checked the const) ever noticing. `anchorMaxSpawnsPerCycle()`
 * now clamps its own return value to the largest count that still keeps
 * `filingWorstMs + n * SIDECAR_TIMEOUT_MS + LOCK_SLACK_MS < FILING_EXTRACTION_LOCK_TTL_MS`,
 * derived from the same constants the static test checks — never hard-coded
 * — and warns once per call when it had to clamp.
 */
/**
 * OD-55 leaves the ANCHOR sidecar's own 120s cap untouched — it removed the
 * per-document budget for FILINGS (prospectuses that legitimately take an
 * hour), not for a small anchor-allocation letter. The lock TTL therefore has
 * to cover the filing ceiling PLUS the anchor pass that runs after it, or
 * `maxAnchorSpawnsWithinLockTtl` computes a NEGATIVE budget and silently
 * clamps every anchor spawn to zero — extraction that looks healthy while no
 * anchor row is ever written again.
 *
 * Sized at `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE` sidecars; an operator raising
 * `ANCHOR_MAX_SPAWNS_PER_CYCLE` past what this reserve covers is still clamped
 * by `maxAnchorSpawnsWithinLockTtl`, exactly as before.
 */
export const ANCHOR_PASS_RESERVE_MS = 10 * 60 * 1000;

/** Same 60s slack the F3 static test already reserves for the filing side. */
export const LOCK_SLACK_MS = 60_000;

/**
 * OD-55: sized to the hung-process ceiling PLUS slack, never to
 * `spawns x per-document timeout` — that product no longer exists, because
 * there is no per-document timeout to multiply. The document job reads ONE
 * document at a time, so the worst case a lock must cover is one document
 * running to the ceiling, not `DEFAULT_MAX_SPAWNS_PER_CYCLE` of them.
 *
 * The old value (45 min) was derived from 3 spawns x 10 min + slack. Keeping
 * it while removing the budget would be the actual danger: extraction could
 * run for two hours while the lock protecting it from a second overlapping
 * cycle expired at 45 minutes.
 */
export const FILING_EXTRACTION_LOCK_TTL_MS =
  HUNG_PROCESS_CEILING_MS + ANCHOR_PASS_RESERVE_MS + LOCK_SLACK_MS;

/**
 * The largest anchor spawn count that still leaves the filing worst case +
 * that many anchor sidecars + slack under the lock TTL. Exported so the
 * static test can assert against THIS derivation instead of a re-typed copy.
 */
export function maxAnchorSpawnsWithinLockTtl(sidecarTimeoutMs: number): number {
  // OD-55: one document at the ceiling, not `spawns x a per-document budget`.
  // The document job is sequential and the ceiling bounds ONE document's read.
  const filingWorstMs = HUNG_PROCESS_CEILING_MS;
  const budgetForAnchors = FILING_EXTRACTION_LOCK_TTL_MS - filingWorstMs - LOCK_SLACK_MS;
  // Strict "<", not "<=": a count whose worst case lands EXACTLY on the
  // budget still leaves zero margin against the TTL, so floor() alone (which
  // can land exactly on it when the division is even) is one spawn too many.
  let n = Math.max(0, Math.floor(budgetForAnchors / sidecarTimeoutMs));
  while (n > 0 && n * sidecarTimeoutMs >= budgetForAnchors) n--;
  return n;
}

/**
 * `ANCHOR_MAX_SPAWNS_PER_CYCLE` env override, read at call time (not module
 * load) so tests can flip it without re-importing the module — same pattern
 * as the other numeric env knobs in `config/feature-flags.ts`. Falls back to
 * `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE` on anything non-finite or <= 0, and
 * is then CLAMPED (HOLE 1) to whatever `maxAnchorSpawnsWithinLockTtl` allows
 * for the anchor sidecar's own timeout — a raw env value is never trusted
 * past the point where it would let the anchor pass outlive the cycle lock.
 */
export function anchorMaxSpawnsPerCycle(): number {
  const raw = Number(process.env.ANCHOR_MAX_SPAWNS_PER_CYCLE);
  const requested = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE;
  const sidecarTimeoutMs = SIDECAR_TIMEOUT_MS;
  const cap = maxAnchorSpawnsWithinLockTtl(sidecarTimeoutMs);
  if (requested > cap) {
    logger.warn(
      { requested, cap, sidecarTimeoutMs, FILING_EXTRACTION_LOCK_TTL_MS },
      'ANCHOR_MAX_SPAWNS_PER_CYCLE clamped — the requested value would let the anchor pass outlive the extraction lock TTL (W-168 round 2)'
    );
    return cap;
  }
  return requested;
}

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
    if (!isExtractableDocType(type)) {
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
    // Item 9 (OD-33, OD-90): a corrigendum is read ONCE per document — its reader records
    // suggestions and keeps no document_fetch_state version, so COMPLETED alone means done.
    const alreadyDone =
      doc.extractionStatus === 'COMPLETED' &&
      doc.extractedAt &&
      (recordedVersion === version || type === CORRIGENDUM_DOC_TYPE);
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
  /** W-178c: true when the box lock could not be acquired within the wait
   * window (another extractor — prod or staging — holds it). NOT a failure
   * of this document: no backoff, no retry-count increment, no FAILED row —
   * the caller reverts the IN_PROGRESS stamp and retries next cycle
   * unchanged. Mutually exclusive with `hardFailure`. */
  busy?: boolean;
  /** OD-36 (item 22 slice 22-5): true when the python extractor's envelope
   * carried `extraction_status: "PDF_PASSWORD_PROTECTED"` — the one blank-
   * password attempt failed. TERMINAL, never `hardFailure`: no clock-driven
   * backoff will ever open this document, so the caller writes MANUAL_REVIEW
   * immediately instead of counting it toward the 10-attempt floor. */
  passwordProtected?: boolean;
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

/**
 * A GNU-coreutils `nice` that cannot exec its target prints
 * `nice: 'python': No such file or directory` (or the BusyBox/POSIX
 * equivalent) to stderr and exits 127 — the shell "command not found"
 * convention. `spawnSync`'s own `result.error` only reports an ENOENT for
 * the DIRECTLY-spawned binary, which under `withLowPriority` is `nice`
 * itself (already PATH-checked, so effectively never ENOENT) — a missing
 * `python`/`PYTHON_BIN` inside the wrapper would otherwise look like an
 * ordinary nonzero exit and silently break `defaultExtractorRunner`'s
 * ENOENT-retry (W-111) and its "PYTHON_BIN explicitly set but missing"
 * hard-fail (W-111 round 2). This re-synthesizes the same
 * `NodeJS.ErrnoException`-shaped `result.error` those callers already
 * check, so the retry logic below needs no awareness that `nice` is
 * involved at all.
 */
function remapNiceExecFailure(
  result: SpawnSyncReturns<string>,
  originalBin: string
): SpawnSyncReturns<string> {
  if (result.error || result.status !== 127) return result;
  const stderr = String(result.stderr ?? '');
  // W-178 round 2 MINOR-1: also require the GNU-coreutils `nice: ` line
  // prefix (anchored to the start of a line, since stderr can carry other
  // output before it). Without this, a python traceback that happens to
  // mention "No such file or directory" (a plain FileNotFoundError, nothing
  // to do with the `nice` wrapper failing to exec) and coincidentally
  // contains the bin name would be misclassified as a missing-binary ENOENT
  // and wrongly trigger the python3 retry.
  const looksLikeMissingExec =
    stderr.includes(originalBin) &&
    /no such file or directory|not found/i.test(stderr) &&
    /^\s*nice:/m.test(stderr);
  if (!looksLikeMissingExec) return result;
  const enoent = new Error(`spawnSync ${originalBin} ENOENT`) as NodeJS.ErrnoException;
  enoent.code = 'ENOENT';
  enoent.path = originalBin;
  return { ...result, error: enoent };
}

/**
 * The one `spawnSync` call, factored so the ENOENT-retry can call it twice
 * with a different binary.
 *
 * W-178: wrapped through `withLowPriority` so the extractor never contends
 * for CPU at nice-0 against nginx/Next on the VPS. This wraps the OUTSIDE
 * of the call (which binary + argv `spawnSync` execs) — `memory_guard.py`'s
 * `RLIMIT_AS` ceiling still applies INSIDE the python process exactly as
 * before; the two are independent and compose in either order (see
 * `low-priority-spawn.ts`'s module comment). `remapNiceExecFailure` keeps
 * a missing `python`/`PYTHON_BIN` detectable as ENOENT the same way it was
 * before `nice` sat in front of it, so the ENOENT-retry/hard-fail logic in
 * `defaultExtractorRunner` below is unchanged and still re-wraps correctly
 * on the python3 retry (each retry calls this function again, which wraps
 * the NEW bin the same way).
 */
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
  // W-178c round 2: the box lock now lives INSIDE `extract_filing.py`
  // (`box_lock.acquire`, `fcntl.flock`) — no outer `flock` wrapper anymore.
  // See `low-priority-spawn.ts`'s `EXTRACTOR_BUSY_EXIT_CODE` doc comment and
  // `scripts/box_lock.py`'s module comment for the round-1 gaps this closes
  // (orphan lock holder on a killed extractor, a second wait-timeout clock,
  // an opaque exit code).
  const wrapped = withLowPriority(bin, args);
  const result = spawnSync(wrapped.bin, wrapped.args, {
    encoding: 'utf8',
    timeout: CHILD_HUNG_CEILING_MS,
    maxBuffer: 64 * 1024 * 1024,
    cwd: path.dirname(script),
  });
  // The ENOENT remap only ever concerns `nice` failing to exec its target.
  return wrapped.bin === 'nice' ? remapNiceExecFailure(result, bin) : result;
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

  // W-178c: the box lock (outside `nice`, outside the ENOENT retry above —
  // both bins get the same lock) timed out. `flock -E` makes this exit code
  // unambiguous versus an ordinary python failure; classify it BEFORE the
  // generic non-zero-exit handling below so it never earns a backoff.
  if (!result.error && result.status === EXTRACTOR_BUSY_EXIT_CODE) {
    logger.warn('extractor skipped this cycle: another extractor holds the box lock (W-178c)');
    return {
      ok: false,
      error: 'extractor skipped this cycle: another extractor holds the box lock (W-178c)',
      busy: true,
    };
  }

  if (result.error) {
    // Staging incident (2026-09-06, ESDS Software RHP, 21.9 MB): a
    // `spawnSync` timeout (then `EXTRACT_TIMEOUT_MS`, 10 min; now
    // `CHILD_HUNG_CEILING_MS` per OD-55) does NOT always fall
    // through to the `result.status === null` branch below the way the
    // comment there used to claim — Node reports it as a top-level
    // `result.error` with `code === 'ETIMEDOUT'`, caught by THIS branch
    // instead. Missing `hardFailure` here meant a document that reliably
    // times out was retried on the ordinary (6h-capped) exponential curve
    // forever, never reaching the 24h hard-failure floor a 2nd consecutive
    // timeout is supposed to trigger — exactly as unsafe to retry hourly as
    // an OOM kill (see the `result.status === null` comment below).
    const isTimeout = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    return { ok: false, error: `spawn failed: ${result.error.message}`, hardFailure: isTimeout };
  }
  if (result.status !== 0) {
    // W-137: `result.status === null` means the process was terminated by a
    // signal (`result.signal`, e.g. SIGKILL from the OOM killer) rather than
    // exiting normally — the "exited null" this incident is named for. Exit
    // code 3 is the extractor's OWN memory-ceiling report (memory_guard.py).
    // Both are HARD failures: retrying the same document hourly is exactly
    // what took the pm2 daemon down repeatedly.
    //
    // MINOR-1 (corrected 2026-09-06): a `spawnSync` timeout (then
    // `EXTRACT_TIMEOUT_MS`, 10 min; now `CHILD_HUNG_CEILING_MS` per OD-55)
    // does NOT reliably land here — Node
    // reports it as a top-level `result.error` (code `ETIMEDOUT`), handled by
    // the `if (result.error)` branch ABOVE, which now sets `hardFailure` for
    // that code directly. Accepted: two slow-network documents in a row earn
    // the 24h floor the same as two OOM kills — a document that reliably
    // times out is exactly as unsafe to retry hourly as one that is killed
    // for memory.
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
  // OD-36: the extractor's own terminal outcome for a password-protected
  // PDF. Checked before the generic success return so a document that could
  // not be opened never reads as a clean (empty) extraction.
  const status = (parsed as unknown as { extraction_status?: string }).extraction_status;
  if (status === 'PDF_PASSWORD_PROTECTED') {
    const cause = (parsed as unknown as { extraction_status_cause?: string }).extraction_status_cause;
    return {
      ok: false,
      error: `PDF_PASSWORD_PROTECTED${cause ? `: ${cause}` : ''}`,
      passwordProtected: true,
    };
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
  /**
   * W-142: the anchor route. Optional so every existing caller and test is
   * unaffected; when a candidate anchor document is selected and this is not
   * supplied, the document is reported as skipped rather than silently
   * dropped or run through the wrong extractor.
   */
  runAnchorPersist?: (args: {
    ipoId: string;
    companyName: string;
    /** The SELECTED row and its already-verified store path (round-2 MAJOR-1). */
    document: { documentId: string; pdfPath: string };
  }) => Promise<AnchorAutoOutcome>;
  /**
   * Item 9 (OD-90): the corrigendum's suggestion step. Optional like the anchor route: absent,
   * a selected corrigendum is reported as skipped, never run through the filing extractor.
   */
  runCorrigendumSuggestions?: CorrigendumSuggestionRunner;
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
    status: ExtractionStatus;
    error?: string | null;
    retryCount?: number;
    /** Round 3 (MAJOR-1): busy-revert-only override, see `ExtractionStatePatchContext.updatedAt`. */
    updatedAt?: Date;
    /**
     * Item 18 slice 1b. The per-page text to store BEFORE this document is
     * marked COMPLETED. Written first and deliberately: the later purge keys on
     * pages-STORED, so the rows must exist before the status that will make the
     * PDF eligible for deletion. Empty or absent is normal - a scanned document
     * has no text - and simply means nothing is stored, which is exactly what
     * tells the purge to leave that PDF alone.
     */
    pageRows?: DocumentPageRow[];
    /**
     * Item 6 (OD-91): every field this document's extraction produced. On
     * COMPLETED it is written as document_field_receipts, and the plan rows
     * this document supersedes for those fields are reopened (spec §2.5) —
     * all in the SAME transaction as the status write.
     */
    receiptFields?: Array<{ tableName: string; rowKey: string; fieldName: string; value?: string | null }>;
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
  /**
   * MAJOR-1: shared across the whole document cycle. `undefined` = unbounded
   * (existing callers/tests). W-168: this budget is for the four
   * `extract_filing.py` doc types ONLY — the anchor allocation report never
   * draws from it (see `anchorSpawnBudget`).
   */
  spawnBudget?: SpawnBudget;
  /**
   * W-168: the anchor allocation report's OWN cycle-wide spawn budget,
   * separate from `spawnBudget` — a `SpawnBudget` instance
   * `document-cycle.ts` creates once per cycle
   * (`{ remaining: anchorMaxSpawnsPerCycle() }`, default 1) and threads
   * through every `processPendingFilings` call for that cycle, exactly like
   * `spawnBudget`. `undefined` = unbounded (existing callers/tests).
   */
  anchorSpawnBudget?: SpawnBudget;
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

/**
 * Item 6 (OD-91): write this document's receipt, then reopen the plan rows it
 * supersedes for the fields in that receipt. Runs inside the COMPLETED
 * transaction (`tx`). A receipt is not provenance: nothing here touches
 * field_sources, so OD-73's identical-value rule is unchanged.
 */
export async function writeReceiptAndReopen(
  tx: { execute: (q: any) => Promise<any> },
  doc: { id: string; ipoId: string; type: string; filingDate: string | Date | null; sha256: string | null },
  receiptFields: ReadonlyArray<{
    tableName: string;
    rowKey: string;
    fieldName: string;
    value?: string | null;
    sourceText?: string | null;
    ocrConfidence?: number | null;
  }>
): Promise<{ reopenedIds: string[] }> {
  const { sql } = await import('drizzle-orm');
  for (const f of receiptFields) {
    // OD-97: source_text / ocr_confidence say where this document read the value.
    const conf = f.ocrConfidence == null ? null : String(f.ocrConfidence);
    await tx.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value, source_text, ocr_confidence)
      VALUES (${doc.id}::uuid, ${f.tableName}, ${f.rowKey ?? ''}, ${f.fieldName}, ${f.value ?? null},
              ${f.sourceText ?? null}, ${conf}::numeric)
      ON CONFLICT (document_id, table_name, row_key, field_name) DO UPDATE
        SET value = EXCLUDED.value, source_text = EXCLUDED.source_text, ocr_confidence = EXCLUDED.ocr_confidence
    `);
  }
  const { reopenPlanRowsForCompletedDocument } = await import('./plan-supersession.js');
  const filing =
    doc.filingDate == null ? null : doc.filingDate instanceof Date ? doc.filingDate.toISOString().slice(0, 10) : String(doc.filingDate).slice(0, 10);
  return reopenPlanRowsForCompletedDocument(
    tx,
    { id: doc.id, ipoId: doc.ipoId, docType: doc.type, filingDate: filing, sha256: doc.sha256 },
    receiptFields
  );
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
    // W-142: the anchor document's own extractor + write door, wired with the
    // SAME persister deps (one IPORepository, one protection filter) the
    // filing door uses — the shape `scripts/persist-filing.ts` already has.
    runAnchorPersist: (args) => runAnchorAutoPersist(args, persisterDeps, redis),
    runCorrigendumSuggestions: buildCorrigendumSuggestionRunner(),
    persistFiling: persistFilingExtraction,
    persisterDeps,
    async setDocumentExtractionState({ documentId, status, error, retryCount, updatedAt, pageRows, receiptFields }) {
      // Round 4: the REAL writer. It does not compute the patch itself — it
      // hands `buildExtractionStatePatch` (the ONE pure function every status
      // write goes through) the same args the caller already decided, and
      // applies whatever comes back unchanged. `error` is passed through as
      // given (including `undefined`, which leaves `extraction_error`
      // untouched — see `ExtractionStatePatchContext`); `retry_count` is
      // written verbatim when the caller supplies it (MAJOR-A) — the
      // increment/reset arithmetic lives at the call site (`processPendingFilings`),
      // never here. `updatedAt`, when given, overrides the real "now" —
      // round 3 (MAJOR-1) busy-revert only.
      // Item 18 slice 1b: the text lands BEFORE the status that will one day
      // make this PDF deletable. Order is the whole guarantee - if the insert
      // fails, COMPLETED is never written, so a later purge keyed on
      // pages-stored can never find a document it thinks is safe to delete.
      // onConflictDoNothing because a re-extraction of the same document must
      // not abort on the (document_id, page_number) unique constraint.
      if (status === 'COMPLETED' && pageRows && pageRows.length > 0) {
        await db.insert(documentPagesTable).values(pageRows as never).onConflictDoNothing();
      }
      const patch = buildExtractionStatePatch(status as ExtractionStatus, { error, retryCount, updatedAt }, new Date());
      // Staging incident (2026-09-06): this is a RAW `db.update`, so it never
      // goes through `DocumentRepository`'s own write methods and never hit
      // their `deleteCache(getDocumentsKey(ipoId))` calls — `findByIPO`'s
      // cache-aside listing (1h TTL) kept serving the PRE-write row on the
      // very next cycle, so the gate re-evaluated a stale retryCount/status
      // and re-stamped/re-spawned instead of backing off. EVERY status write
      // (IN_PROGRESS/FAILED/COMPLETED/MANUAL_REVIEW all funnel through this
      // one function) must invalidate that key. Fail-open on a Redis error —
      // a missed invalidation costs one stale read, not the cycle.
      // Item 6 (spec §2.5, OD-91): with a receipt, the status, the receipt and
      // the plan-row reopen commit together (one transaction); every other
      // status write keeps the single UPDATE below.
      const withReceipt = status === 'COMPLETED' && receiptFields && receiptFields.length > 0;
      // #634: a failed attempt (FAILED / MANUAL_REVIEW with a cause) also APPENDS its cause to
      // document_extraction_attempts in the same transaction, so the next attempt's overwrite of
      // `extraction_error` no longer erases it. The attempt number is the row's own retry_count
      // after the write (counted at the IN_PROGRESS stamp), read back with RETURNING.
      const recordsAttempt = buildExtractionAttemptRow(documentId, status as ExtractionStatus, error, 0) !== null;
      const rows = recordsAttempt
        ? await writeStatusWithAttempt(db as never, documentId, status as ExtractionStatus, error, patch)
        : withReceipt
        ? await db.transaction(async (tx) => {
            const updated = await tx.update(documentsTable).set(patch as never).where(eq(documentsTable.id, documentId))
              .returning({ ipoId: documentsTable.ipoId, type: documentsTable.type, filingDate: documentsTable.filingDate, sha256: documentsTable.sha256 });
            if (updated[0]) await writeReceiptAndReopen(tx as never, { id: documentId, ...updated[0] }, receiptFields);
            return updated;
          })
        : await db
            .update(documentsTable)
            .set(patch as never)
            .where(eq(documentsTable.id, documentId))
            .returning({ ipoId: documentsTable.ipoId });
      const ipoId = rows[0]?.ipoId;
      if (ipoId) {
        try {
          await documentRepository.invalidateForIpo(ipoId);
        } catch (cacheError) {
          logger.warn(
            { documentId, ipoId, error: cacheError instanceof Error ? cacheError.message : String(cacheError) },
            'Could not invalidate documents cache after a status write (non-fatal)'
          );
        }
      }
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
 * One anchor document, from extraction to an honest `extraction_status` (W-142).
 *
 * THE OUTCOME MAP — the whole point of this function. Before it, the only two
 * outcomes an anchor document could have were "a human ran the CLI" and
 * "PENDING forever", so nothing had to be classified. Automatically, every
 * outcome must land somewhere a later cycle (and a human reading the row) can
 * act on:
 *
 *   persisted            -> COMPLETED, retry counter reset, fetch state stamped
 *   garbled-name floor   -> MANUAL_REVIEW **with the persister's own reason**
 *   all-blank names      -> MANUAL_REVIEW (same class: the name column failed)
 *   empty pages (W-139)  -> MANUAL_REVIEW, "no text and OCR heuristic did not fire"
 *   memory ceiling / OOM -> FAILED via the W-137 hard-failure marker (>=24h
 *                           backoff from the second such failure)
 *   anything else        -> FAILED with the ordinary 2^n x 15 min backoff
 *
 * H3 (the anchor step) is recorded at the same sites the other doc types
 * record theirs: the success row is written by `anchor-persister.ts` itself on
 * the applied path, and every refusal writes an H3 with the reason here, so a
 * blocked anchor is visible in the ledger instead of being invisible.
 */
async function runAnchorDocument(
  ipo: AutoPersistIpo,
  doc: CandidateDocument,
  deps: AutoPersistDeps,
  ctx: {
    /** The store path `selectPendingFilings` already proved exists for THIS row. */
    pdfPath: string;
    version: string;
    result: AutoPersistResult;
    retryCountAtStamp: number;
    previousRetryCount: number;
    /** W-178c round 2: the row's status BEFORE this attempt's IN_PROGRESS
     * stamp — restored verbatim on a busy-box revert. */
    previousStatus: ExtractionStatus;
    /** Round 3 (MAJOR-1): the row's `updatedAt` BEFORE this attempt's
     * IN_PROGRESS stamp — restored verbatim on a busy-box revert so the
     * backoff clock (`documentExtractionBlocked`) does not advance on a skip. */
    previousUpdatedAt?: Date | null;
    stateId?: string;
  }
): Promise<{ persisted: boolean; busy?: boolean }> {
  const { version, result, retryCountAtStamp } = ctx;

  if (!deps.runAnchorPersist) {
    result.skipped.push(`${ANCHOR_DOC_TYPE}: no anchor runner wired into these deps`);
    return { persisted: false };
  }

  let outcome: AnchorAutoOutcome;
  try {
    outcome = await deps.runAnchorPersist({
      ipoId: ipo.id,
      companyName: ipo.companyName ?? '',
      // MAJOR-1: pin the SELECTED row + its verified file. The scrape must not
      // re-select the newest anchor row (a second active row would be stamped
      // COMPLETED without having been extracted) and must not download.
      document: { documentId: doc.id, pdfPath: ctx.pdfPath },
    });
  } catch (error) {
    outcome = {
      kind: 'failed',
      reason: `anchor: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (outcome.kind === 'persisted') {
    result.extracted++;
    result.persisted++;
    result.anchorsPersisted++;
    await deps
      .setDocumentExtractionState({ documentId: doc.id, status: 'COMPLETED', error: null, retryCount: 0 })
      .catch(() => undefined);
    if (ctx.stateId) {
      await deps
        .setFetchStateExtracted({
          stateId: ctx.stateId,
          extractedAt: new Date(),
          extractorVersion: version,
        })
        .catch(() => undefined);
    }
    // MINOR-2: a blank-name row is DROPPED from the write, not a refusal — the
    // rest of the letter is real, checked data and publishing it is right. But
    // a silent COMPLETED hid the fact that some allocation rows were omitted,
    // so the count is logged here and is already carried in the H3 evidence
    // `anchor-persister.ts` writes on the applied path.
    if (outcome.summary.skippedBlankNames > 0) {
      logger.warn(
        {
          ipoId: ipo.id,
          company: ipo.companyName,
          skippedBlankNames: outcome.summary.skippedBlankNames,
          investorsWritten: outcome.summary.investorsWritten,
        },
        'Anchor report persisted with investor rows omitted for a blank name — see the H3 evidence (W-142)'
      );
    }
    logger.info(
      {
        ipoId: ipo.id,
        company: ipo.companyName,
        investors: outcome.summary.investorsWritten,
        skippedBlankNames: outcome.summary.skippedBlankNames,
      },
      'Anchor allocation report extracted and persisted automatically (W-142)'
    );
    return { persisted: true };
  }

  // W-178c round 2: box busy is NOT a failure — revert to the row's EXACT
  // pre-attempt state (status, retryCount, error, AND updatedAt untouched —
  // round 3 MAJOR-1 added updatedAt to the restore, since the backoff gate
  // anchors on it), same shape as the filing-loop busy branch above, and
  // refund both the shared and anchor-specific spawn budgets this attempt
  // consumed.
  if (outcome.kind === 'busy') {
    result.skipped.push(`${ANCHOR_DOC_TYPE}: another extractor holds the box lock (W-178c)`);
    logger.warn({ ipoId: ipo.id }, 'extractor skipped this cycle: another extractor holds the box lock (W-178c)');
    result.spawned--;
    result.anchorsSpawned--;
    if (deps.anchorSpawnBudget) deps.anchorSpawnBudget.remaining++;
    await deps
      .setDocumentExtractionState({
        documentId: doc.id,
        status: ctx.previousStatus,
        retryCount: ctx.previousRetryCount,
        ...(ctx.previousUpdatedAt ? { updatedAt: ctx.previousUpdatedAt } : {}),
      })
      .catch(() => undefined);
    // Round 3 (MINOR-4): the filing-loop busy branch restores `doc.retryCount`
    // in-place so a later re-read of this same object in the SAME cycle sees
    // the pre-attempt value, not the in-flight IN_PROGRESS stamp — the anchor
    // branch must do the same.
    doc.retryCount = ctx.previousRetryCount;
    return { persisted: false, busy: true };
  }

  result.failed++;

  // MANUAL_REVIEW: a scan-quality problem no retry fixes. Written with the
  // REASON, and with the retry count, so the row says why a human is needed.
  if (outcome.kind === 'manual_review') {
    // MINOR-1: the version goes ON the row. Without it
    // `documentExtractionBlocked` treats this as an operator-parked row and
    // never revives it, not even after an extractor bump.
    const parked = withBlockedVersion(outcome.reason, version);
    logger.warn(
      { ipoId: ipo.id, reason: outcome.reason, version },
      'Anchor allocation report needs a human — recorded MANUAL_REVIEW with the reason (W-142)'
    );
    result.anchorsManualReview++;
    await deps
      .setDocumentExtractionState({
        documentId: doc.id,
        status: 'MANUAL_REVIEW',
        error: parked,
        retryCount: retryCountAtStamp,
      })
      .catch(() => undefined);
    await recordLiveStep(ipo.id, 'H3', {
      status: 'BLOCKED',
      source: ANCHOR_DOC_TYPE,
      error: parked,
    }).catch(() => undefined);
    return { persisted: false };
  }

  // W-137: an OOM-killed / memory-ceiling sidecar carries the incrementing
  // hard-failure marker, so the SECOND such failure on this document widens
  // its backoff to >= 24h instead of retrying it every cycle.
  //
  // W-168: a DETERMINISTIC parser refusal (`outcome.deterministic`, i.e.
  // `AnchorScrapeFailureKind === 'parse_failed'`) takes a SEPARATE path —
  // MANUAL_REVIEW after the 2nd identical failure on the same file, never
  // the ordinary 10-attempt backoff (which would just retry the same
  // unparseable letter for up to 10 cycles first). Timeout/OOM/network
  // failures are NOT `outcome.deterministic` and keep their existing paths.
  let classified: { status: 'FAILED' | 'MANUAL_REVIEW'; error: string };
  if (outcome.kind === 'hard_failure') {
    const rawError = markHardFailure(doc.extractionError, outcome.reason);
    classified = classifyFailure(retryCountAtStamp, version, rawError);
  } else if (outcome.deterministic) {
    classified = classifyDeterministicAnchorParseFailure(
      outcome.sourceKind ?? 'parse_failed',
      outcome.reason,
      doc.sha256,
      doc.extractionError,
      version
    );
  } else {
    classified = classifyFailure(retryCountAtStamp, version, outcome.reason);
  }
  if (classified.status === 'MANUAL_REVIEW') result.anchorsManualReview++;
  else result.anchorsFailed++;
  logger.error(
    {
      ipoId: ipo.id,
      reason: outcome.reason,
      hardFailure: outcome.kind === 'hard_failure',
      deterministic: outcome.kind === 'failed' && outcome.deterministic === true,
      status: classified.status,
    },
    classified.status === 'MANUAL_REVIEW'
      ? 'Anchor allocation report failed the same deterministic way twice — recorded MANUAL_REVIEW (W-168)'
      : 'Anchor allocation report failed (non-fatal) — recorded with a backoff (W-142)'
  );
  await deps
    .setDocumentExtractionState({
      documentId: doc.id,
      status: classified.status,
      error: classified.error.slice(0, 1000),
      ...(classified.status === 'MANUAL_REVIEW' ? { retryCount: retryCountAtStamp } : {}),
    })
    .catch(() => undefined);
  await recordLiveStep(ipo.id, 'H3', {
    status: classified.status === 'MANUAL_REVIEW' ? 'BLOCKED' : 'FAILED',
    source: ANCHOR_DOC_TYPE,
    error: classified.error.slice(0, 1000),
  }).catch(() => undefined);
  return { persisted: false };
}

/**
 * Item 9 (OD-90): read each selected CORRIGENDUM once and record its suggestions for admin
 * review. Draws on no spawn budget (a corrigendum is a few pages, and exists because a published
 * number is wrong, section 2.5.5) and writes NO field. Runs for SME and MAINBOARD alike: the
 * SME extraction gate (D-15) is about an extractor writing values, and this step writes none.
 */
async function runCorrigendumPass(
  ipo: AutoPersistIpo,
  corrigendumPending: CandidateDocument[],
  deps: AutoPersistDeps,
  result: AutoPersistResult
): Promise<void> {
  for (const doc of corrigendumPending) {
    if (!deps.runCorrigendumSuggestions) {
      result.skipped.push(`${CORRIGENDUM_DOC_TYPE}: no corrigendum reader wired into these deps`);
      continue;
    }
    const pdfPath = documentPath(ipo.id, doc.type, doc.sha256 as string, deps.storeDir ?? getStoreDir());
    try {
      const rec = await deps.runCorrigendumSuggestions({ ipoId: ipo.id, documentId: doc.id, pdfPath });
      result.corrigendaRead++;
      result.corrigendumSuggestions += rec.inserted;
      await deps.setDocumentExtractionState({ documentId: doc.id, status: 'COMPLETED', error: null, retryCount: 0 });
      logger.info(
        { ipoId: ipo.id, documentId: doc.id, parsed: rec.parsed, inserted: rec.inserted, duplicates: rec.duplicates },
        '[OD-90] corrigendum read: suggestions recorded for admin review'
      );
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      result.failed++;
      try {
        await deps.setDocumentExtractionState({
          documentId: doc.id,
          status: 'FAILED',
          error: `corrigendum_read_failed: ${cause}`.slice(0, 1000),
          retryCount: (doc.retryCount ?? 0) + 1,
        });
      } catch (stampError) {
        logger.warn(
          { ipoId: ipo.id, documentId: doc.id, error: stampError instanceof Error ? stampError.message : String(stampError) },
          'Could not stamp corrigendum FAILED (non-fatal)'
        );
      }
      logger.warn({ ipoId: ipo.id, documentId: doc.id, cause }, '[OD-90] corrigendum read failed');
    }
  }
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
    anchorsConsidered: 0,
    anchorsSpawned: 0,
    anchorsPersisted: 0,
    anchorsManualReview: 0,
    anchorsFailed: 0,
    corrigendaRead: 0,
    corrigendumSuggestions: 0,
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
    // Item 9 (OD-90): corrigenda are still read for an SME — suggestions only, no write.
    // Only when a reader is wired: without one this branch still loads nothing (D-15).
    if (deps.runCorrigendumSuggestions) try {
      const smeDocs = await deps.loadDocuments(ipo.id);
      const smeStates = await deps.loadStates(ipo.id);
      const { pending: smePending } = selectPendingFilings(ipo.id, smeDocs, smeStates, {
        storeDir: deps.storeDir,
        version,
        fileExists: deps.fileExists,
      });
      await runCorrigendumPass(ipo, smePending.filter((d) => d.type === CORRIGENDUM_DOC_TYPE), deps, result);
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, error: error instanceof Error ? error.message : String(error) },
        'Could not run the corrigendum pass for an SME IPO (non-fatal)'
      );
    }
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
  // W-168: the filing budget alone being spent no longer skips this IPO's
  // load — the anchor report has its OWN budget now and must still get a
  // chance to run. Only skip the load when EVERY budget that is actually
  // configured for this call is exhausted; an unconfigured (`undefined`)
  // budget is unbounded and never counts as "exhausted" here.
  const filingBudgetExhausted = deps.spawnBudget !== undefined && deps.spawnBudget.remaining <= 0;
  const anchorBudgetAvailable = deps.anchorSpawnBudget === undefined || deps.anchorSpawnBudget.remaining > 0;
  if (filingBudgetExhausted && !anchorBudgetAvailable) {
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

  // W-168: the anchor allocation report is split OUT of the filing pending
  // list here, before either budget is applied — it never draws from the
  // filing spawn budget, and a filing document never waits behind an anchor.
  const corrigendumPending = pending.filter((d) => d.type === CORRIGENDUM_DOC_TYPE);
  const filingPending = pending.filter((d) => d.type !== ANCHOR_DOC_TYPE && d.type !== CORRIGENDUM_DOC_TYPE);
  const anchorPending = pending.filter((d) => d.type === ANCHOR_DOC_TYPE);
  result.anchorsConsidered = anchorPending.length;

  // Item 9 (OD-90): the corrigendum pass. Runs first and draws on no spawn budget.
  await runCorrigendumPass(ipo, corrigendumPending, deps, result);

  // MAJOR-1: apply the cross-cycle spawn budget BEFORE extracting anything.
  // Docs beyond the remaining budget are left PENDING (untouched) and reported
  // as skipped_budget — they are simply next cycle's (or a later IPO's, since
  // the same counter is shared) work, exactly like the wall-clock budget in
  // `runDocumentCycle` already treats unprocessed IPOs.
  let filingBudgeted = filingPending;
  if (deps.spawnBudget) {
    const allowed = Math.max(0, deps.spawnBudget.remaining);
    if (filingPending.length > allowed) {
      filingBudgeted = filingPending.slice(0, allowed);
      result.skippedBudget = filingPending.length - allowed;
      result.skipped = [
        ...result.skipped,
        `${result.skippedBudget} document(s) left PENDING — spawn budget exhausted this cycle`,
      ];
    }
  }

  // W-168: the anchor report's OWN budget, never the filing one above.
  let anchorBudgeted = anchorPending;
  if (deps.anchorSpawnBudget) {
    const allowed = Math.max(0, deps.anchorSpawnBudget.remaining);
    if (anchorPending.length > allowed) {
      anchorBudgeted = anchorPending.slice(0, allowed);
      const anchorSkippedBudget = anchorPending.length - allowed;
      result.skipped = [
        ...result.skipped,
        `${anchorSkippedBudget} anchor document(s) left PENDING — anchor spawn budget exhausted this cycle`,
      ];
    }
  }

  if (filingBudgeted.length === 0 && anchorBudgeted.length === 0) return result;
  const pendingForThisCall = filingBudgeted;

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

  // J1 runs whenever ANYTHING was written this call — including an anchor
  // report, which persists inside the extract loop below rather than in the
  // filing persist loop. Hoisted (and the J1 block factored into `finish`)
  // so an anchor-only run still invalidates the IPO's caches (W-142).
  let anyPersisted = false;

  const finish = async (): Promise<AutoPersistResult> => {
    if (!anyPersisted) return result;
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
    return result;
  };

  // W-168: the anchor pass — a SEPARATE, later pass over `anchorBudgeted`,
  // run AFTER the filing extract+persist flow below (at every exit point of
  // this function, via the `await runAnchorPass()` calls), using its OWN
  // `anchorSpawnBudget` rather than `deps.spawnBudget`. Extracted to a
  // closure (not inlined into the filing loop, as it was before W-168) so it
  // still runs even on the "no filing extractions this call" and "W-45
  // refused" early exits — an anchor-only IPO must not be starved just
  // because it had no RHP/ad this cycle.
  const runAnchorPass = async (): Promise<void> => {
    for (let i = 0; i < anchorBudgeted.length; i++) {
      const doc = anchorBudgeted[i];

      // F3: same per-document deadline check as the filing loop. W-168 round
      // 2 (HOLE 2): anchors run AFTER the filing pass within one IPO call, so
      // a deadline that already elapsed during filing extraction must not
      // silently no-op the anchor pass — it has to show up the SAME way a
      // filing-side deadline skip does: `skippedBudget` incremented and a
      // skip reason recorded, both of which the cycle-summary log reads.
      if (deps.deadlineMs !== undefined && (deps.now ?? Date.now)() >= deps.deadlineMs) {
        const remaining = anchorBudgeted.length - i;
        result.skippedBudget += remaining;
        result.skipped = [
          ...result.skipped,
          `${remaining} anchor document(s) left PENDING — extraction deadline reached`,
        ];
        break;
      }

      const pdfPath = documentPath(ipo.id, doc.type, doc.sha256 as string, deps.storeDir ?? getStoreDir());
      const previousRetryCount = doc.retryCount ?? 0;
      const revivingAfterManualReview = doc.extractionStatus === 'MANUAL_REVIEW';
      // W-178c round 2: same "pre-attempt status" capture as the filing loop
      // above — `doc.extractionStatus` is never mutated here either.
      const previousStatus = (doc.extractionStatus as ExtractionStatus | null) ?? 'PENDING';
      // Round 3 (MAJOR-1): same "pre-attempt updatedAt" capture, restored
      // verbatim on a busy revert so the backoff clock does not advance.
      const previousUpdatedAt = doc.updatedAt ?? null;
      const newRetryCount = revivingAfterManualReview ? 1 : previousRetryCount + 1;
      doc.retryCount = newRetryCount;

      try {
        await deps.setDocumentExtractionState({ documentId: doc.id, status: 'IN_PROGRESS', retryCount: newRetryCount });
      } catch (error) {
        logger.warn(
          { ipoId: ipo.id, docType: doc.type, error: error instanceof Error ? error.message : String(error) },
          'Could not mark anchor document IN_PROGRESS (non-fatal) — extracting anyway'
        );
      }

      result.spawned++;
      result.anchorsSpawned++;
      if (deps.anchorSpawnBudget) deps.anchorSpawnBudget.remaining--;

      const outcome = await runAnchorDocument(ipo, doc, deps, {
        pdfPath,
        version,
        result,
        retryCountAtStamp: newRetryCount,
        previousRetryCount,
        previousStatus,
        previousUpdatedAt,
        stateId: stateIdByDocType.get(ANCHOR_DOC_TYPE),
      });
      if (outcome.persisted) anyPersisted = true;
      // Round 3 (MAJOR-2): a busy box is a signal about the WHOLE box, not
      // this one document — every remaining candidate would just wait
      // `ANCHOR_LOCK_WAIT_S` and hit the same busy lock. End this cycle's
      // anchor pass on the FIRST busy instead of burning the wait on each.
      if (outcome.busy) {
        logger.warn(
          { ipoId: ipo.id },
          'box busy: ending the extraction pass for this cycle (W-178c)'
        );
        break;
      }
    }
  };

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
    // W-178c round 2: the document's own status BEFORE this attempt's
    // IN_PROGRESS stamp — `doc.extractionStatus` is never mutated in this
    // loop (only `doc.retryCount` is), so it still holds the pre-attempt
    // value when the busy-revert branch below reads it. A row revived from
    // MANUAL_REVIEW must go back to MANUAL_REVIEW on a busy box, not PENDING.
    const previousStatus = (doc.extractionStatus as ExtractionStatus | null) ?? 'PENDING';
    // Round 3 (MAJOR-1): the document's own `updatedAt` BEFORE this attempt's
    // IN_PROGRESS stamp — restored verbatim on a busy revert (below) so the
    // backoff gate (`documentExtractionBlocked`, anchored on `updatedAt`)
    // does not treat a busy skip as a real attempt and push the row's next
    // eligible retry forward.
    const previousUpdatedAt = doc.updatedAt ?? null;
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
      // W-178c round 2 (round 3 MAJOR-1 corrected the false claim below —
      // `updatedAt` was NOT restored until now, so the backoff gate anchored
      // on it treated every busy skip as a real attempt): box busy is NOT a
      // failure of this document — revert the IN_PROGRESS stamp taken above
      // to EXACTLY the row's pre-attempt state, so the next cycle sees a
      // genuinely unchanged document:
      //  - status: `previousStatus` (never a hardcoded 'PENDING') — a row
      //    revived from MANUAL_REVIEW (`revivingAfterManualReview`) goes
      //    back to MANUAL_REVIEW, not PENDING, since a busy box told us
      //    nothing about whether the row still needs a human;
      //  - error: omitted (not `null`) — `buildExtractionStatePatch` only
      //    writes `extractionError` when the key is present at all, so
      //    omitting it (rather than passing `null`) leaves whatever error
      //    string the row already carried (e.g. a `HARD_FAILURE:N` marker on
      //    a FAILED row) untouched instead of clobbering it with NULL;
      //  - retryCount: `previousRetryCount`, as before;
      //  - updatedAt: `previousUpdatedAt` (round 3 MAJOR-1) — WITHOUT this,
      //    `setDocumentExtractionState` stamps `new Date()` on the revert
      //    write itself, which pushes `documentExtractionBlocked`'s backoff
      //    window (and the 24h HARD_FAILURE floor) forward on every busy
      //    skip, exactly as if the row had genuinely been retried.
      // Also refunds the per-cycle spawn budget this attempt consumed above
      // — a contended cycle must not burn a spawn slot on an attempt that
      // never actually ran.
      if (run.busy) {
        result.skipped = [
          ...result.skipped,
          `${docType}: another extractor holds the box lock (W-178c)`,
        ];
        result.spawned--;
        if (deps.spawnBudget) deps.spawnBudget.remaining++;
        try {
          await deps.setDocumentExtractionState({
            documentId: doc.id,
            status: previousStatus,
            retryCount: previousRetryCount,
            ...(previousUpdatedAt ? { updatedAt: previousUpdatedAt } : {}),
          });
        } catch {
          /* already logged by the writer; a stuck IN_PROGRESS status must not fail the cycle */
        }
        doc.retryCount = previousRetryCount;
        // Round 3 (MAJOR-2): a busy box is a signal about the WHOLE box, not
        // this one document — every remaining candidate in `pendingForThisCall`
        // would just wait `EXTRACTOR_LOCK_WAIT_S` (90s) each and hit the same
        // busy lock, burning up to ~16 waits inside the 25-minute cycle
        // budget. End the filing pass for this cycle on the FIRST busy
        // instead (the anchor pass below has its own, matching break).
        logger.warn(
          { ipoId: ipo.id },
          'box busy: ending the extraction pass for this cycle (W-178c)'
        );
        break;
      }
      result.failed++;
      // OD-36 (item 22 slice 22-5): a password-protected PDF is TERMINAL on
      // the FIRST occurrence — straight to MANUAL_REVIEW, never through
      // classifyFailure's 10-attempt floor (that floor exists for failures a
      // retry COULD fix; a retry never supplies the password). #959 (the
      // extraction-failure backoff timer) is explicitly out of scope here —
      // this document simply never re-enters that timer.
      const classified = run.passwordProtected
        ? { status: 'MANUAL_REVIEW' as const, error: withBlockedVersion(`extractor: ${run.error}`, version) }
        : classifyFailure(
            newRetryCount,
            version,
            run.hardFailure
              ? // W-137: a killed/memory-ceiling extractor is a HARD failure —
                // embed the (incrementing) hard-failure marker so the NEXT
                // cycle's `documentExtractionBlocked` widens the backoff to
                // >= 24h once this has happened twice on the SAME document,
                // instead of retrying hourly.
                markHardFailure(doc.extractionError, `extractor: ${run.error}`)
              : `extractor: ${run.error}`
          );
      const blocked = classified.status === 'MANUAL_REVIEW';
      logger.error(
        {
          ipoId: ipo.id,
          docType,
          error: run.error,
          retryCount: newRetryCount,
          blocked,
          hardFailure: run.hardFailure === true,
          passwordProtected: run.passwordProtected === true,
        },
        run.passwordProtected
          ? 'Filing PDF is password-protected — the blank attempt failed, recorded MANUAL_REVIEW (OD-36), never retried on a clock'
          : blocked
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

  if (extractions.length === 0) {
    await runAnchorPass();
    return finish();
  }

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
    await runAnchorPass();
    return finish();
  }

  // ---------------------------------------------------------------- persist
  for (const { doc, extraction } of extractions) {
    const docType = doc.type as FilingDocType;
    let summary: PersistFilingSummary;
    try {
      summary = await deps.persistFiling(
        ipo.id,
        extraction,
        {
          docType,
          documentId: doc.id,
          sourceSha: doc.sha256,
          extractorVersion: EXTRACTOR_VERSION,
          apply: true,
        },
        deps.persisterDeps
      );
    } catch (error) {
      result.failed++;
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? (error.cause as { message?: string; code?: string } | undefined) : undefined;
      const code = cause?.code ?? (error as { code?: string } | undefined)?.code;
      logger.error(
        { ipoId: ipo.id, docType, error: message, cause: cause?.message, code },
        'Filing persist failed (non-fatal)'
      );
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
    // OD-55 (Tier B review of #652): a read that was STOPPED before every page
    // was read must NOT be stamped COMPLETED, because `selectPendingFilings`'s
    // `alreadyDone` gate skips a COMPLETED document at the same
    // EXTRACTOR_VERSION forever — and bumping EXTRACTOR_VERSION is not an
    // option (it revives all 24 blocked documents). Without this branch the
    // extractor named the missing pages and the gate then guaranteed they were
    // never read again: a signal with no consumer, which is worse than no
    // signal, because the ledger row asserts the pages are re-readable while
    // the gate ensures they are not.
    //
    // The rows that WERE read are already persisted above (`result.persisted++`
    // has run) — the partial read is kept, exactly as the extractor swallowing
    // its interrupt intends. Only the "nothing left to do" stamp is withheld.
    //
    // FAILED (or MANUAL_REVIEW once attempts run out) rather than a sixth
    // status value, and the attempt count LEFT as stamped rather than reset:
    // that reuses the existing exponential backoff
    // (`documentExtractionBlocked`, 15 min doubling to a 6 h cap) and the
    // MAX_EXTRACTION_ATTEMPTS(10) -> MANUAL_REVIEW parking that already work.
    // Resetting the count to 0 while leaving the document eligible would
    // re-run a two-hour extraction every single cycle, forever, with no
    // backoff — far worse than the defect it replaces.
    const unreadRaw: unknown = (extraction as unknown as Record<string, unknown>).unread_pages;
    const unreadPages: Array<Record<string, unknown>> = Array.isArray(unreadRaw)
      ? unreadRaw.filter((p): p is Record<string, unknown> => typeof p === 'object' && p !== null)
      : [];
    if (unreadPages.length > 0) {
      // The identities, never a count (signal-ownership.md R1): this string is
      // what a human and the next cycle read, and "40 pages unread" would tell
      // neither of them which pages to re-read.
      const pages = unreadPages
        .map((p) => p.page)
        .filter((p): p is number => typeof p === 'number');
      const reasons = [
        ...new Set(
          unreadPages
            .map((p) => p.reason)
            .filter((r): r is string => typeof r === 'string' && r.length > 0)
        ),
      ];
      // Through `classifyFailure`, exactly like the other three failure sites
      // in this function, for two reasons the Tier B review of the first
      // version of this fix proved by running the test rather than reading it:
      //
      //  1. `doc.retryCount` is ALREADY the count stamped at IN_PROGRESS
      //     (`doc.retryCount = newRetryCount` above), so adding 1 here counted
      //     the same attempt twice — a fresh document reported retryCount 2 on
      //     its FIRST ceiling trip and burned the 10-attempt budget in 5
      //     cycles. `retryCount` is therefore passed only when parking, which
      //     is what every other site here does.
      //  2. Writing `status: 'FAILED'` unconditionally meant a document that
      //     can NEVER read a page (a corrupt page, not a slow one) would back
      //     off on the capped 6h/24h cadence forever and never park:
      //     `documentExtractionBlocked` has no attempt cap of its own for a
      //     FAILED row — the cap lives in `classifyFailure`.
      const incompleteError = `INCOMPLETE_PAGES: ${pages.length} page(s) never read [${pages.join(',')}] (${reasons.join(',')})`;
      const classifiedIncomplete = classifyFailure(doc.retryCount ?? 0, version, incompleteError);
      logger.warn(
        {
          ipoId: ipo.id,
          docType,
          unreadPages: pages,
          reasons,
          retryCount: doc.retryCount ?? 0,
          status: classifiedIncomplete.status,
        },
        'Filing read was stopped before every page was read — rows persisted, document left re-readable (OD-55)'
      );
      await deps
        .setDocumentExtractionState({
          documentId: doc.id,
          status: classifiedIncomplete.status,
          error: classifiedIncomplete.error.slice(0, 1000),
          ...(classifiedIncomplete.status === 'MANUAL_REVIEW' ? { retryCount: doc.retryCount } : {}),
          pageRows: pageRowsFromExtraction(doc.id, extraction as never),
        })
        .catch(() => undefined);
      continue;
    }

    // MAJOR-A: a successful extraction resets this document's own retry
    // counter to 0 — a document that failed nine times and then succeeded
    // must not carry that history into its next unrelated extraction attempt
    // (e.g. after a future EXTRACTOR_VERSION bump).
    await deps
      .setDocumentExtractionState({
        documentId: doc.id,
        status: 'COMPLETED',
        error: null,
        retryCount: 0,
        receiptFields: summary.receipt_fields ?? [],
        // Item 18 slice 1b. An empty list here is normal and meaningful: a
        // scanned filing yields no text, nothing is stored, and the purge must
        // therefore never delete its PDF.
        pageRows: pageRowsFromExtraction(doc.id, extraction as never),
      })
      .catch(() => undefined);
    const stateId = stateIdByDocType.get(docType);
    if (stateId) {
      await deps
        .setFetchStateExtracted({ stateId, extractedAt: now, extractorVersion: version })
        .catch(() => undefined);
    }

    logger.info(
      {
        ipoId: ipo.id,
        company: ipo.companyName,
        docType,
        written: summary.written,
        // F-51 / signal-ownership R1: the reconciliation outcome rides on the
        // line that already NAMES the IPO, so a cycle's "N unchecked" is
        // always resolvable to WHICH IPOs and WHY (stored_null vs the
        // stored_zero corruption marker) - never a bare tally.
        freshOfsReconciliation: summary.fresh_ofs_reconciliation,
      },
      'Filing extracted and persisted automatically (S-02)'
    );
  }

  // ---------------------------------------------------------------------- J1
  await runAnchorPass();
  return finish();
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
