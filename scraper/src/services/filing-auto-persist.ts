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
 * Before this fix, `selectPendingFilings` read ONE ledger row (E1, keyed by
 * ipoId only — the step ledger has no document dimension) and used its
 * `attempts`/`next_due_at` to decide whether THIS CYCLE could spawn python
 * for the WHOLE IPO. A scanned price-band ad that never parses therefore
 * blocked every other document belonging to the same IPO — including the RHP
 * — forever, because the shared gate never advanced past that one document's
 * failures.
 *
 * The gate now lives on the `documents` row itself, one gate per document,
 * using the columns that already exist for exactly this purpose:
 * `retry_count`, `extraction_status`, `extraction_error`, `extracted_at`,
 * `updated_at`. A document is a candidate when its file is stored, its
 * `extraction_status` is not COMPLETED-at-the-current-`EXTRACTOR_VERSION` and
 * not MANUAL_REVIEW, and — if it is FAILED — `now >= updated_at +
 * backoff(retry_count)`, where `backoff` is the SAME exponential function
 * `step-ledger-recorders.ts` already exports as `backoffNextDueAt` (2^n x 15
 * min, capped at 6 hours; `n` is the attempt count BEFORE the failure that set
 * `updated_at`, i.e. `retry_count - 1`). After 10 failed attempts the document
 * is marked MANUAL_REVIEW with error `blocked_after_10_attempts` and stays
 * blocked until `EXTRACTOR_VERSION` changes (a version bump does not reset
 * `retry_count` — it changes the "already extracted" check upstream of this
 * gate, so a blocked document becomes eligible again under the new version
 * exactly the way an ordinary un-extracted document is).
 *
 * The E1..E10 ledger rows are still WRITTEN on every extraction attempt (with
 * `attemptsBefore` taken from the document's own `retry_count`, not a shared
 * ledger counter) — they remain the audit trail of what happened — but they
 * are no longer READ to decide whether this cycle may spawn python. That
 * decision is now per-document, so it can never starve a sibling document.
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
 * The per-document gate. Pure, so the backoff arithmetic is testable without a
 * database. `doc` is the subset of `documents` columns the gate reads.
 */
export interface DocumentGate {
  extractionStatus: string | null;
  retryCount: number;
  updatedAt: Date | null;
}

/**
 * True when this cycle must not spawn the extractor for THIS document.
 *
 * Two independent reasons, both scoped to the one document — never to the
 * whole IPO (MAJOR-A):
 *  - permanently blocked: `extractionStatus === 'MANUAL_REVIEW'` (set once
 *    `retryCount` reaches `MAX_EXTRACTION_ATTEMPTS`). A version bump does not
 *    clear this directly — it is `selectPendingFilings`' "already extracted by
 *    the CURRENT version" check that makes a document eligible again, exactly
 *    like any other un-extracted document; this gate does not need to know
 *    about `EXTRACTOR_VERSION` at all.
 *  - backing off: the document's last attempt FAILED and the exponential
 *    backoff window (`backoffNextDueAt`, reused verbatim from
 *    `step-ledger-recorders.ts`) measured from `updatedAt` has not elapsed.
 *    `retryCount` is the count AFTER that failure, so the attempt count the
 *    backoff formula wants (the count BEFORE the failure) is `retryCount - 1`.
 */
export function documentExtractionBlocked(
  doc: DocumentGate,
  now: Date = new Date()
): { blocked: boolean; reason?: string } {
  if (doc.extractionStatus === 'MANUAL_REVIEW') {
    return {
      blocked: true,
      reason: `extraction blocked after ${doc.retryCount} failed attempts (${EXTRACTION_BLOCKED_ERROR})`,
    };
  }
  if (doc.extractionStatus === 'FAILED' && doc.retryCount > 0) {
    const nextDueAt = backoffNextDueAt(doc.retryCount - 1, doc.updatedAt ?? now);
    if (nextDueAt.getTime() > now.getTime()) {
      return { blocked: true, reason: `extraction backing off until ${nextDueAt.toISOString()}` };
    }
  }
  return { blocked: false };
}

export interface AutoPersistIpo {
  id: string;
  companyName: string;
  slug?: string | null;
  segment?: string | null;
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
    // MAJOR-A: per-document gate — MANUAL_REVIEW or still within this
    // document's own backoff window. Never reads any other document's state,
    // so one permanently-unparseable file can no longer block its siblings.
    const gate = documentExtractionBlocked(
      { extractionStatus: doc.extractionStatus, retryCount: doc.retryCount ?? 0, updatedAt: doc.updatedAt },
      options.now
    );
    if (gate.blocked) {
      skipped.push(`${type}: ${gate.reason}`);
      continue;
    }
    if (doc.extractionStatus === 'IN_PROGRESS') {
      // A row left IN_PROGRESS means a previous cycle died mid-extract. Retry it
      // rather than leaving it stuck forever — the extractor is deterministic
      // and the persist door is idempotent, so a duplicate run costs time, not
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
export type ExtractorFailure = { ok: false; error: string };
export type ExtractorSuccess = { ok: true; extraction: FilingExtraction };
export type ExtractorResult = ExtractorSuccess | ExtractorFailure;

export function isExtractorFailure(result: ExtractorResult): result is ExtractorFailure {
  return result.ok === false;
}

export interface ExtractorRunner {
  (args: { pdfPath: string; docType: string; sme: boolean }): ExtractorResult;
}

/** The one `spawnSync` call, factored so the ENOENT-retry can call it twice with a different binary. */
function spawnExtractor(bin: string, script: string, pdfPath: string, docType: string, sme: boolean) {
  const args = [script, pdfPath, '--doc-type', docType];
  if (sme) args.push('--sme');
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
 */
export const defaultExtractorRunner: ExtractorRunner = ({ pdfPath, docType, sme }) => {
  const script = extractorScriptPath();
  const primaryBin = process.env.PYTHON_BIN ?? 'python';

  let result = spawnExtractor(primaryBin, script, pdfPath, docType, sme);
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT' && primaryBin !== 'python3') {
    logger.warn({ triedBin: primaryBin }, 'python binary not found — retrying once with python3');
    result = spawnExtractor('python3', script, pdfPath, docType, sme);
    if (!result.error) logger.info({ usedBin: 'python3' }, 'extractor spawned with python3 fallback');
  }

  if (result.error) return { ok: false, error: `spawn failed: ${result.error.message}` };
  if (result.status !== 0) {
    return {
      ok: false,
      error: `extractor exited ${result.status}: ${(result.stderr || '').slice(-800)}`,
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
}

/** The real dependency set, wired to the database and the filesystem. */
export function buildAutoPersistDeps(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): AutoPersistDeps {
  const documentRepository = new DocumentRepository(db as never, redis as never);
  const invalidator = new CacheInvalidator(redis as never);

  return {
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
      }));
    },
    async loadStates(ipoId) {
      const { DocumentFetchStateRepository } = await import('@ipodhan/shared');
      const store = new DocumentFetchStateRepository(db as never, redis as never);
      return store.listForIpo(ipoId);
    },
    runExtractor: defaultExtractorRunner,
    persistFiling: persistFilingExtraction,
    persisterDeps: buildFilingPersistDeps(redis),
    async setDocumentExtractionState({ documentId, status, error, retryCount }) {
      // `extracted_at` is stamped ONLY on COMPLETED and never cleared: it records
      // when this document last yielded a usable extraction, and a subsequent
      // IN_PROGRESS/PENDING must not erase that history. `extraction_error` is
      // cleared on success so a stale failure never outlives its fix — the same
      // rule the ledger applies to `error` on DONE. `retry_count` is written
      // verbatim when the caller supplies it (MAJOR-A) — see the AutoPersistDeps
      // doc comment for why the increment lives at the call site, not here.
      const patch: Record<string, unknown> = {
        extractionStatus: status,
        extractionError: error ?? null,
      };
      if (status === 'COMPLETED') patch.extractedAt = new Date();
      if (retryCount !== undefined) patch.retryCount = retryCount;
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

  // ---------------------------------------------------------------- extract
  for (const doc of pendingForThisCall) {
    const docType = doc.type as FilingDocType;
    const pdfPath = documentPath(ipo.id, docType, doc.sha256 as string, deps.storeDir ?? getStoreDir());

    try {
      await deps.setDocumentExtractionState({ documentId: doc.id, status: 'IN_PROGRESS' });
    } catch (error) {
      logger.warn(
        { ipoId: ipo.id, docType, error: error instanceof Error ? error.message : String(error) },
        'Could not mark document IN_PROGRESS (non-fatal) — extracting anyway'
      );
    }

    result.spawned++;
    if (deps.spawnBudget) deps.spawnBudget.remaining--;
    const run = deps.runExtractor({ pdfPath, docType, sme });

    if (isExtractorFailure(run)) {
      const failure = run.error;
      result.failed++;
      // MAJOR-A: attemptsBefore is THIS document's own retry_count, never a
      // shared ledger counter — so one document's failures cannot inflate
      // another document's backoff or cap. This write is the one that pushes
      // it from (attemptsBefore) to (attemptsBefore + 1). Once that reaches
      // MAX_EXTRACTION_ATTEMPTS, record the block explicitly so the row
      // self-documents WHY the next cycle will not retry it, rather than
      // leaving that fact implicit in a number nobody reads.
      const attemptsBefore = doc.retryCount ?? 0;
      const newRetryCount = attemptsBefore + 1;
      const willReachAttemptCap = newRetryCount >= MAX_EXTRACTION_ATTEMPTS;
      const recordedError = willReachAttemptCap ? EXTRACTION_BLOCKED_ERROR : failure;
      logger.error(
        { ipoId: ipo.id, docType, error: failure, attemptsBefore, blocked: willReachAttemptCap },
        willReachAttemptCap
          ? 'Filing extraction failed for the 10th time — blocked until EXTRACTOR_VERSION changes'
          : 'Filing extraction failed (non-fatal) — recorded as FAILED with a backoff'
      );
      await writeSteps(
        ipo.id,
        planExtractionFailureSteps(recordedError, {
          docType,
          documentId: doc.id,
          sourceSha: doc.sha256,
          version,
          attemptsBefore,
        })
      );
      // MAJOR-A: the document's own extraction_status becomes FAILED (not
      // PENDING) — `documentExtractionBlocked` reads FAILED + retry_count +
      // updated_at to compute this document's backoff window, so the status
      // must say FAILED for the gate to hold it until that window elapses.
      // MANUAL_REVIEW once it hits the attempt cap, so it stops silently
      // cycling PENDING->IN_PROGRESS->FAILED forever with nobody told.
      try {
        await deps.setDocumentExtractionState({
          documentId: doc.id,
          status: willReachAttemptCap ? 'MANUAL_REVIEW' : 'FAILED',
          error: recordedError.slice(0, 1000),
          retryCount: newRetryCount,
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
    for (const { doc } of extractions) {
      await deps
        .setDocumentExtractionState({
          documentId: doc.id,
          status: 'MANUAL_REVIEW',
          error: `W-45 refused: ${refusedReason}`,
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
      await writeSteps(ipo.id, [
        {
          stepId: 'G3',
          status: 'FAILED',
          source: docType,
          inputRef: doc.sha256 ?? doc.id,
          version,
          error: message.slice(0, 1000),
        },
      ]);
      await deps
        .setDocumentExtractionState({ documentId: doc.id, status: 'PENDING', error: message.slice(0, 1000) })
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
