/**
 * Step-ledger RECORDERS (S-02) — the translation layer between what a run
 * actually did and the `ipo_pipeline_steps` rows that say so.
 *
 * S-01 shipped the writer (`step-ledger.ts`) and the catalogue with ZERO
 * callers: the only way a row ever appeared was `scripts/backfill-step-ledger.ts`,
 * run by hand. So "where is this IPO in the pipeline?" was answerable for
 * exactly the one IPO somebody had backfilled, and a brand-new IPO had no
 * ledger at all. This module is what closes that: every hook site imports ONE
 * function from here and calls it with the result object it already has.
 *
 * Two deliberate shapes:
 *
 * 1. **Pure planner + thin writer.** Each concern has a `plan*` function that is
 *    a pure map from a run result to `StepWrite[]`, and a `record*` wrapper that
 *    writes them. The mapping is the part that can be wrong, so it is the part
 *    that is unit-tested without a database.
 * 2. **Never fatal, never expensive.** `recordStep` already swallows its own
 *    errors; `writeSteps` swallows anything the planners could throw. One upsert
 *    per step per IPO per run — no per-row queries in a loop.
 *
 * Spec: docs/specs/per-ipo-due-step-pipeline.md sections 3, 4.1 and 5.
 */

import type { IpoStepStatus, UpsertStepInput } from '@ipodhan/shared';
import { recordStep } from './step-ledger.js';
import logger from '../utils/logger.js';
import type { IpoRunResult } from './document-discovery-runner.js';
import type { FetchAttempt } from '@ipodhan/shared/repositories/document-fetch-state-repository';
import type { FilingExtraction, PersistFilingSummary } from './filing-persister.js';

/** One planned ledger row. `ipoId` is supplied by the writer, not the planner. */
export type StepWrite = Omit<UpsertStepInput, 'ipoId'>;

/**
 * Spec section 5 backoff: a FAILED step is re-due at `now + 2^attempts x 15 min`,
 * capped at 6 hours. `attempts` is the count BEFORE this failure, so a first
 * failure waits 15 minutes rather than half an hour.
 */
export const BACKOFF_BASE_MS = 15 * 60 * 1000;
export const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

export function backoffNextDueAt(attemptsBeforeThisFailure: number, now: Date = new Date()): Date {
  const exponent = Math.max(0, Math.min(attemptsBeforeThisFailure, 30));
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, exponent), BACKOFF_CAP_MS);
  return new Date(now.getTime() + delay);
}

/**
 * Write a planned batch. Never throws: a ledger failure is bookkeeping about a
 * scrape, not part of it (`non-fatal-side-effects.md`).
 */
export async function writeSteps(ipoId: string, writes: StepWrite[]): Promise<number> {
  let written = 0;
  for (const w of writes) {
    try {
      if (await recordStep({ ...w, ipoId })) written++;
    } catch (error) {
      logger.warn(
        { ipoId, stepId: w.stepId, error: error instanceof Error ? error.message : String(error) },
        '[step-ledger] recorder failed for one step (non-fatal)'
      );
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// B + F — discovery and cross-verification, from one upsertIPO call
// ---------------------------------------------------------------------------

/** Which board fetch a source represents (B1/B2), and which aggregator (F1/F2). */
const BOARD_STEP_BY_SOURCE: Record<string, string> = { BSE: 'B1', NSE: 'B2' };
const AGGREGATOR_STEP_BY_SOURCE: Record<string, string> = {
  CHITTORGARH: 'F1',
  MONEYCONTROL: 'F2',
  INVESTORGAIN_GMP: 'F3',
};

export interface DiscoveryStepInput {
  /** The `ScraperSource` this write came from. */
  source: string;
  /** true when this call created the `ipos` row rather than updating it. */
  created: boolean;
  /** Field names this scrape actually supplied (B3's evidence). */
  fields: string[];
  /** The offering type the classifier settled on (B4). */
  offeringType?: string | null;
  /** Whether the write went through the consolidation door (F4/F5 apply). */
  consolidated: boolean;
  /** Conflicts the consolidation service detected this write (F5). */
  conflictsDetected?: number | null;
  /** Conflicts by severity, when consolidation reported them. */
  conflictsBySeverity?: Record<string, number> | null;
  /** true when this write wrote `field_sources` provenance rows (F6). */
  fieldSourcesWritten: boolean;
  companyName?: string;
}

/**
 * B1..B7 + F1/F2/F4/F5/F6 for one IPO from one `upsertIPO` call.
 *
 * These are grouped at a single site on purpose. Every one of them is a fact
 * about "this scrape, for this IPO, from this source", and `upsertIPO` is the
 * only place that knows all of them at once — it is also the only write door
 * for `ipos`, so a source that reaches the database at all reaches this hook.
 * Scattering the same nine facts across six orchestrators would guarantee that
 * a seventh orchestrator, added later, silently writes no ledger rows.
 */
export function planDiscoverySteps(input: DiscoveryStepInput): StepWrite[] {
  const source = (input.source || '').toUpperCase();
  const writes: StepWrite[] = [];

  const boardStep = BOARD_STEP_BY_SOURCE[source];
  if (boardStep) {
    writes.push({
      stepId: boardStep,
      status: 'DONE',
      source,
      evidence: { via: 'upsertIPO', company: input.companyName ?? null },
    });
  }

  // B3 — the exchange row was parsed into a candidate we could write.
  writes.push({
    stepId: 'B3',
    status: 'DONE',
    source,
    evidence: { fieldsSupplied: input.fields.length, fields: input.fields.slice(0, 40) },
  });

  // B4 — offering-type classification. Absent means the scrape carried no
  // classification, which is NOT the same as a classification that failed.
  writes.push(
    input.offeringType
      ? { stepId: 'B4', status: 'DONE', source, evidence: { offeringType: input.offeringType } }
      : {
          stepId: 'B4',
          status: 'NOT_AVAILABLE_YET',
          source,
          evidence: { reason: 'source_supplied_no_offering_type' },
        }
  );

  // B5 — validation. Reaching the write means the record survived the
  // validation pipeline and the merged-record rules inside upsertIPO.
  writes.push({ stepId: 'B5', status: 'DONE', source, evidence: { via: 'upsertIPO validation' } });

  // B6 — identity match. The distinction is the whole point of the step.
  writes.push({
    stepId: 'B6',
    status: 'DONE',
    source,
    evidence: { matched: input.created ? 'new' : 'existing' },
  });

  // B7 — the write itself.
  writes.push({
    stepId: 'B7',
    status: 'DONE',
    source,
    evidence: { path: input.created ? 'insert' : 'update' },
  });

  const aggregatorStep = AGGREGATOR_STEP_BY_SOURCE[source];
  if (aggregatorStep) {
    writes.push({
      stepId: aggregatorStep,
      status: 'DONE',
      source,
      evidence: { fieldsCompared: input.fields.length },
    });
  }

  if (input.consolidated) {
    // F4 — the cross-tier comparison ran (that IS consolidation's per-field pick).
    writes.push({
      stepId: 'F4',
      status: 'DONE',
      source,
      evidence: { fieldsCompared: input.fields.length },
    });
    // F5 — conflict rows. Zero conflicts is a DONE with count 0, not a miss:
    // the comparison ran and found nothing to write.
    writes.push({
      stepId: 'F5',
      status: 'DONE',
      source,
      evidence: {
        conflictsDetected: input.conflictsDetected ?? 0,
        bySeverity: input.conflictsBySeverity ?? {},
      },
    });
  }

  if (input.fieldSourcesWritten) {
    writes.push({
      stepId: 'F6',
      status: 'DONE',
      source,
      evidence: { fields: input.fields.length, path: input.created ? 'create' : 'consolidation' },
    });
  }

  return writes;
}

export function recordDiscoverySteps(ipoId: string, input: DiscoveryStepInput): Promise<number> {
  return writeSteps(ipoId, planDiscoverySteps(input));
}

// ---------------------------------------------------------------------------
// C + D + I3/I4 — one document-discovery run for one IPO
// ---------------------------------------------------------------------------

/**
 * Which rung a `FetchAttempt.source` belongs to. `CHAIN` is the internal
 * board/link-walk bookkeeping source, so it is folded into the exchange rung
 * that produced it rather than being counted as its own C-step.
 */
const RUNG_STEP_BY_ATTEMPT_SOURCE: Record<string, string> = {
  BSE: 'C1',
  NSE: 'C2',
  SEBI: 'C3',
  COMPANY: 'C4',
  VERIFIER: 'C4',
};

/** Verify rejections that mean "the bytes were not a PDF" (D2). */
const NON_PDF_REJECTIONS = [
  'html_body',
  'wrong_content_type',
  'not_a_pdf',
  'zip_without_pdf',
  'unreadable_pdf',
];

function isDownloadAttempt(a: FetchAttempt): boolean {
  return a.outcome.startsWith('downloaded');
}
function isNonPdfRejection(a: FetchAttempt): boolean {
  return NON_PDF_REJECTIONS.some((r) => a.outcome === `rejected:${r}`);
}
function isDedupAttempt(a: FetchAttempt): boolean {
  return a.outcome.startsWith('deduped_by_sha256_to:');
}

/**
 * C1..C5, D1..D5 and I3/I4 from one `IpoRunResult`.
 *
 * The runner already records every rung it tried, with the HTTP status and the
 * verdict, in `attempts`. That is exactly the evidence the C/D steps want, so
 * the mapping is a read of the attempt log rather than new instrumentation
 * threaded through the runner — which is why it cannot go stale against what the
 * runner actually did.
 *
 * A rung that was never tried this cycle stays untouched (no write at all), so
 * a DONE recorded by an earlier cycle is never downgraded by a later cycle that
 * short-circuited to zero calls.
 */
export function planDocumentRunSteps(
  result: IpoRunResult,
  options: {
    withdrawn?: boolean;
    /**
     * The ledger as it stands, stepId -> current status.
     *
     * Used for ONE rule: a non-DONE outcome never overwrites a DONE. "Find the
     * RHP link on the BSE detail page" is a step that, once satisfied, stays
     * satisfied — the document is stored. If a later cycle cannot reach BSE, that
     * is today's network weather, not evidence the link was never found; letting
     * it write FAILED would make every C row oscillate with the internet and
     * destroy the run history the ledger exists to keep. A genuine loss of the
     * file is caught by `demoteMissingFiles`, which re-opens the fetch state
     * properly instead of rewriting history.
     */
    existing?: Record<string, { status: string }>;
  } = {}
): StepWrite[] {
  const writes: StepWrite[] = [];
  const attempts = result.attempts ?? [];

  // ---- C1..C4: one row per rung that was actually exercised this cycle.
  const byRung = new Map<string, FetchAttempt[]>();
  for (const a of attempts) {
    const step = RUNG_STEP_BY_ATTEMPT_SOURCE[(a.source || '').toUpperCase()];
    if (!step) continue;
    const list = byRung.get(step) ?? [];
    list.push(a);
    byRung.set(step, list);
  }

  for (const [stepId, rungAttempts] of byRung) {
    const answered = rungAttempts.some((a) => a.http === 200 || isDownloadAttempt(a));
    const linksFound = rungAttempts.some(
      (a) => a.outcome.startsWith('links:') && a.outcome !== 'links:0'
    );
    const producedDocument = rungAttempts.some((a) => isDownloadAttempt(a) || isDedupAttempt(a));

    let status: IpoStepStatus;
    if (producedDocument || linksFound) status = 'DONE';
    else if (answered) status = 'NOT_AVAILABLE_YET';
    else status = 'FAILED';

    writes.push({
      stepId,
      status,
      source: rungAttempts[0]?.source ?? null,
      evidence: {
        attempts: rungAttempts.length,
        outcomes: rungAttempts.map((a) => a.outcome).slice(0, 10),
        httpStatuses: [...new Set(rungAttempts.map((a) => a.http))],
      },
      ...(status === 'FAILED'
        ? { error: rungAttempts.map((a) => a.outcome).join('; ').slice(0, 500) }
        : {}),
    });
  }

  // ---- C5: the classifier. A found/superseded type IS a classification.
  const classified = [...result.found, ...result.superseded];
  if (classified.length > 0) {
    writes.push({
      stepId: 'C5',
      status: 'DONE',
      evidence: { classifiedAs: classified },
    });
  }

  // ---- D1..D5.
  const downloads = attempts.filter(isDownloadAttempt);
  const rejections = attempts.filter(isNonPdfRejection);
  const dedups = attempts.filter(isDedupAttempt);

  if (downloads.length > 0) {
    writes.push({
      stepId: 'D1',
      status: 'DONE',
      evidence: { downloaded: downloads.length, bytesFrom: downloads.map((a) => a.url).slice(0, 5) },
    });
  }
  if (rejections.length > 0) {
    // A rejection is the step WORKING — the guard caught a non-PDF payload.
    writes.push({
      stepId: 'D2',
      status: 'DONE',
      evidence: { rejected: rejections.length, reasons: rejections.map((a) => a.outcome).slice(0, 10) },
    });
  }
  if (dedups.length > 0) {
    writes.push({
      stepId: 'D3',
      status: 'DONE',
      evidence: { deduped: dedups.length, to: dedups.map((a) => a.outcome).slice(0, 10) },
    });
  }
  if (result.found.length > 0) {
    writes.push({
      stepId: 'D4',
      status: 'DONE',
      inputRef: downloads.find((a) => a.sha256)?.sha256 ?? null,
      evidence: { stored: result.found },
    });
  }
  // D5 — the zero-call short circuit. Only claimable when the run genuinely made
  // no network calls; a run that fetched and found nothing is not a short circuit.
  if (result.networkCalls === 0) {
    writes.push({
      stepId: 'D5',
      status: 'DONE',
      evidence: { networkCalls: 0, skipped: result.skipped, reason: result.skipReason || 'nothing outstanding' },
    });
  }

  // ---- I3: a filing superseded by a later one.
  if (result.superseded.length > 0) {
    writes.push({
      stepId: 'I3',
      status: 'DONE',
      evidence: { superseded: result.superseded },
    });
  }

  // ---- I4: withdrawn / deferred detection.
  if (options.withdrawn) {
    writes.push({
      stepId: 'I4',
      status: 'DONE',
      evidence: { detected: 'withdrawn_or_postponed', stage: result.stage },
    });
  }

  // The no-downgrade rule (see `existing` above). DONE writes always land — they
  // are upgrades; anything else is dropped for a step already DONE.
  const existing = options.existing;
  if (!existing) return writes;
  return writes.filter((w) => w.status === 'DONE' || existing[w.stepId]?.status !== 'DONE');
}

export function recordDocumentRunSteps(
  result: IpoRunResult,
  options: { withdrawn?: boolean; existing?: Record<string, { status: string }> } = {}
): Promise<number> {
  return writeSteps(result.ipoId, planDocumentRunSteps(result, options));
}

// ---------------------------------------------------------------------------
// E — one extraction of one document
// ---------------------------------------------------------------------------

/**
 * Which extracted field names belong to which E-step.
 *
 * An explicit table rather than a prefix guess: the extractor's field names are
 * not systematically prefixed, so a prefix rule would silently mis-file
 * `promoter_waca` (a KPI) as a promoter field. Financial series are the one
 * genuine pattern (`*_by_fy`) and are matched by suffix.
 */
export const E_STEP_FIELDS: Record<string, string[]> = {
  E1: [
    'issue_price', 'price_band_floor', 'price_band_cap', 'lot_size', 'lot_multiple',
    'face_value', 'bid_windows', 'upi_cutoff_time', 'rhp_filing_date', 'issue_structure',
    'total_offer_amount_at_floor', 'total_offer_shares_at_cap', 'total_offer_shares_at_floor',
    'ofs_shares', 'ofs_amount', 'ofs_amount_at_cap', 'shares_at_cap', 'shares_at_floor',
    'post_offer_shares_at_cap', 'post_offer_shares_at_floor', 'pre_ipo_placement',
    'designated_stock_exchange', 'book_building_regulation', 'cin',
  ],
  E2: ['qib_pct', 'nii_pct', 'retail_pct'],
  E3: ['financial_basis', 'fiscal_years', 'ronw_by_fy', 'weighted_average_ronw', 'eps_weighted_average'],
  E4: [
    'concentration_kpis', 'pe_at_cap', 'pe_at_floor', 'market_cap_at_cap', 'market_cap_at_floor',
    'industry_peer_pe_average', 'cap_multiple_of_face', 'floor_multiple_of_face',
    'cap_multiple_last_3y', 'waca_last_1y', 'waca_last_3y', 'waca_secondary_transactions',
    'cap_multiple_of_waca_secondary', 'floor_multiple_of_waca_secondary', 'promoter_waca',
  ],
  E5: ['objects_of_offer', 'business_description'],
  E6: ['peer_companies'],
  E7: [
    'promoter_name', 'promoter_names', 'promoter_holding_pre_pct', 'promoter_holding_post_pct_at_cap',
    'promoter_shares_held', 'promoter_selling_shareholders', 'promoter_group_transactions_since_drhp',
    'syndicate_members', 'issue_banks', 'registrar_sebi_reg', 'compliance_officer',
    'compliance_officer_email', 'compliance_officer_phone', 'brlm_track_record', 'brlm_sebi_regs',
    'brlm_issues_3y_total', 'brlm_closed_below_total',
  ],
  E8: ['risk_factors', 'risk_factor_count', 'litigation_notices'],
};

/** The `[•]` placeholder marker the extractor emits for an unpriced cell (E10). */
export const PLACEHOLDER_REASON = 'not_priced_yet';

/** OCR statuses the extractor reports when the OCR route was taken (D6). */
const OCR_STATUSES = new Set(['OK_OCR', 'PARTIAL_OCR']);

function fieldsForEStep(stepId: string, extraction: FilingExtraction): string[] {
  const names = Object.keys(extraction.fields ?? {});
  if (stepId === 'E3') {
    return names.filter((n) => n.endsWith('_by_fy') || E_STEP_FIELDS.E3.includes(n));
  }
  const listed = E_STEP_FIELDS[stepId] ?? [];
  return names.filter((n) => listed.includes(n));
}

/**
 * E1..E10 (+ D6 when the OCR route ran) from one successful extraction.
 *
 * The three statuses mean three different things, and conflating them is what
 * made "extraction failed" invisible before:
 *   DONE               — the section is in the document and produced a value.
 *   NOT_AVAILABLE_YET  — the section exists but every value is null (an unpriced
 *                        RHP), or this doc type does not carry the section at all.
 *   FAILED             — reserved for `planExtractionFailureSteps`; the extractor
 *                        itself did not run or did not return usable JSON.
 */
export function planExtractionSteps(
  extraction: FilingExtraction,
  options: { docType: string; documentId?: string | null; sourceSha?: string | null; version: string }
): StepWrite[] {
  const writes: StepWrite[] = [];
  const common = {
    source: options.docType,
    inputRef: options.sourceSha ?? options.documentId ?? null,
    version: options.version,
  };
  const fields = extraction.fields ?? {};

  for (const stepId of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']) {
    const names = fieldsForEStep(stepId, extraction);
    if (names.length === 0) {
      writes.push({
        ...common,
        stepId,
        status: 'NOT_AVAILABLE_YET',
        evidence: { reason: `${options.docType}_does_not_carry_this_section` },
      });
      continue;
    }
    const withValue = names.filter((n) => fields[n]?.value !== null && fields[n]?.value !== undefined);
    if (withValue.length === 0) {
      writes.push({
        ...common,
        stepId,
        status: 'NOT_AVAILABLE_YET',
        evidence: {
          fieldsPresent: names.length,
          fieldsWithValue: 0,
          reasons: [...new Set(names.map((n) => fields[n]?.check?.detail ?? 'null'))].slice(0, 8),
        },
      });
      continue;
    }
    writes.push({
      ...common,
      stepId,
      status: 'DONE',
      evidence: {
        fieldsPresent: names.length,
        fieldsWithValue: withValue.length,
        sample: withValue.slice(0, 8),
      },
    });
  }

  // E9 — the arithmetic checks. The extractor runs a named check per field and
  // reports pass/fail; this step is the report, so it is DONE whenever the
  // extraction ran, with the failures as its evidence.
  const checked = Object.entries(fields).filter(([, f]) => f?.check?.name);
  const failed = checked.filter(([, f]) => f.check?.passed === false);
  writes.push({
    ...common,
    stepId: 'E9',
    status: 'DONE',
    evidence: {
      checksRun: checked.length,
      checksFailed: failed.length,
      failedFields: failed.map(([n]) => n).slice(0, 20),
    },
  });

  // E10 — unresolved `[•]` placeholders.
  const placeholders = Object.entries(fields)
    .filter(([, f]) => f?.check?.detail === PLACEHOLDER_REASON)
    .map(([n]) => n);
  writes.push({
    ...common,
    stepId: 'E10',
    status: 'DONE',
    evidence: { placeholderFields: placeholders.length, fields: placeholders.slice(0, 20) },
  });

  // D6 — the OCR route. Recorded here rather than in the runner because the
  // extractor is the only thing that knows whether a stored PDF actually needed
  // OCR; the download step cannot tell a scanned PDF from a digital one.
  const status = String(extraction.extraction_status ?? '');
  if (OCR_STATUSES.has(status)) {
    writes.push({
      stepId: 'D6',
      status: 'DONE',
      source: options.docType,
      inputRef: common.inputRef,
      version: options.version,
      evidence: { extractionStatus: status },
    });
  } else if (status === 'NEEDS_OCR') {
    writes.push({
      stepId: 'D6',
      status: 'FAILED',
      source: options.docType,
      inputRef: common.inputRef,
      version: options.version,
      error: 'document has no text layer and the OCR backend was unavailable',
      evidence: { extractionStatus: status },
    });
  }

  return writes;
}

/**
 * Every E-step FAILED, with the error and a backoff, when the extractor could
 * not be run or did not return usable JSON. Silence here is exactly the failure
 * mode the ledger exists to remove.
 */
export function planExtractionFailureSteps(
  error: string,
  options: {
    docType: string;
    documentId?: string | null;
    sourceSha?: string | null;
    version: string;
    attemptsBefore?: number;
    now?: Date;
  }
): StepWrite[] {
  const nextDueAt = backoffNextDueAt(options.attemptsBefore ?? 0, options.now);
  return ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9', 'E10'].map((stepId) => ({
    stepId,
    status: 'FAILED' as IpoStepStatus,
    source: options.docType,
    inputRef: options.sourceSha ?? options.documentId ?? null,
    version: options.version,
    error: error.slice(0, 1000),
    nextDueAt,
  }));
}

// ---------------------------------------------------------------------------
// G + J1 — one persist of one extraction
// ---------------------------------------------------------------------------

/**
 * G1..G5 from the persister's own summary.
 *
 * `persistFilingExtraction` already reports exactly what it wrote, what the
 * admin protection gate withheld and what had no column — so the G steps are a
 * projection of that summary, not a second accounting of the same writes.
 */
export function planPersistSteps(
  summary: PersistFilingSummary,
  options: { docType: string; documentId?: string | null; sourceSha?: string | null; version: string }
): StepWrite[] {
  const common = {
    source: options.docType,
    inputRef: options.sourceSha ?? options.documentId ?? null,
    version: options.version,
  };
  const childTables = Object.entries(summary.written ?? {}).filter(([, n]) => (n as number) > 0);

  return [
    {
      ...common,
      stepId: 'G1',
      status: 'DONE' as IpoStepStatus,
      evidence: { iposFields: summary.ipos_fields, applied: summary.applied },
    },
    {
      ...common,
      stepId: 'G2',
      status: 'DONE' as IpoStepStatus,
      evidence: { withheldByAdminLock: summary.skipped_protected },
    },
    {
      ...common,
      stepId: 'G3',
      status: (summary.ipos_fields.length > 0 ? 'DONE' : 'NOT_AVAILABLE_YET') as IpoStepStatus,
      evidence: { fields: summary.ipos_fields },
    },
    {
      ...common,
      stepId: 'G4',
      status: (childTables.length > 0 ? 'DONE' : 'NOT_AVAILABLE_YET') as IpoStepStatus,
      evidence: { written: summary.written },
    },
    {
      ...common,
      stepId: 'G5',
      status: 'DONE' as IpoStepStatus,
      evidence: {
        skippedNoColumn: summary.skipped_no_column,
        skippedNoUnit: summary.skipped_no_unit,
        skippedUnitMismatch: summary.skipped_unit_mismatch,
        skippedFailedCheck: summary.skipped_failed_check.slice(0, 20),
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// H — the live-number writes
// ---------------------------------------------------------------------------

/** H1 subscription, H2 GMP, H3 anchor, H4 demand — one write, one row. */
export function recordLiveStep(
  ipoId: string,
  stepId: 'H1' | 'H2' | 'H3' | 'H4' | 'F3' | 'J1',
  args: { status?: IpoStepStatus; source?: string | null; evidence?: unknown; error?: string | null } = {}
): Promise<number> {
  return writeSteps(ipoId, [
    {
      stepId,
      status: args.status ?? 'DONE',
      source: args.source ?? null,
      evidence: args.evidence,
      ...(args.error !== undefined ? { error: args.error } : {}),
    },
  ]);
}

// ---------------------------------------------------------------------------
// I1 / I2 — the reconciler
// ---------------------------------------------------------------------------

/**
 * I1 (stage derived) and I2 (due list computed), plus a DUE row for every step
 * whose window is open (spec section 5).
 *
 * This is the one place the reconciler stops being a pure dry run: it may write
 * ledger rows. It still enqueues nothing and fetches nothing — the §GATE on
 * enqueue is untouched. Writing DUE is what makes "which steps are outstanding
 * for this IPO?" answerable without re-deriving the plan.
 */
export function planLifecycleSteps(input: {
  stage: string;
  dueStepIds: string[];
  dueFetchKinds?: string[];
  /**
   * The ledger as it stands, stepId -> current status + backoff. Required so
   * marking a step DUE can never DOWNGRADE one that is already DONE — an
   * unconditional DUE write would erase the run history the ledger exists to
   * keep, every single cycle.
   */
  existing?: Record<string, { status: string; nextDueAt?: Date | null }>;
  now?: Date;
}): StepWrite[] {
  const now = input.now ?? new Date();
  const existing = input.existing ?? {};

  const eligibleForDue = (stepId: string): boolean => {
    const row = existing[stepId];
    // No row yet: initStepLedger has not run, so DUE is the correct first state.
    if (!row) return true;
    if (row.status === 'NOT_DUE' || row.status === 'NOT_AVAILABLE_YET') return true;
    // A FAILED step becomes due again only once its backoff has expired.
    if (row.status === 'FAILED') {
      return !row.nextDueAt || row.nextDueAt.getTime() <= now.getTime();
    }
    // DONE / RUNNING / DUE / BLOCKED / SKIPPED are left exactly as they are.
    return false;
  };

  const dueNow = input.dueStepIds.filter(eligibleForDue);
  const writes: StepWrite[] = [
    { stepId: 'I1', status: 'DONE', evidence: { stage: input.stage } },
    {
      stepId: 'I2',
      status: 'DONE',
      evidence: {
        stage: input.stage,
        dueSteps: input.dueStepIds,
        markedDue: dueNow,
        dueFetchKinds: input.dueFetchKinds ?? [],
      },
    },
  ];
  for (const stepId of dueNow) {
    writes.push({ stepId, status: 'DUE', evidence: { dueAtStage: input.stage } });
  }
  return writes;
}
