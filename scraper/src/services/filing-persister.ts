/**
 * Filing persister (walk step G4) - writes one `extract_filing.py` extraction
 * into the filing tables.
 *
 * CONTRACT (the three rules this module exists to enforce):
 *  1. A field is written ONLY when its `check.passed` is true AND its value is
 *     non-null. A failed arithmetic/plausibility check means the extractor is
 *     not confident in the number - persisting it anyway would launder a wrong
 *     value into the product, which is exactly the "renders fine, is absurd"
 *     class the plausibility rules exist to stop.
 *  2. Every `ipos` scalar goes through `upsertIPO` so the field-priority matrix,
 *     `field_sources` and `data_conflicts` all apply. Nothing here writes an
 *     `ipos` column directly.
 *  3. Child tables are written through their repositories on their natural key
 *     ((ipoId, fiscalYear, basis), (ipoId, pricingEvent), full-replace per IPO),
 *     so a re-run updates in place and never duplicates rows.
 *
 * SOURCE ENUM NOTE: `scraper_source` has DRHP but no RHP and no PRICE_BAND_AD.
 * Both filing doc types therefore write as `DRHP` - the enum's "authoritative
 * offer document" slot. Adding enum members is a schema migration, which this
 * work package is explicitly not allowed to do; the documentId/sourceSha on
 * each field_sources.dataLineage records which document it actually was.
 */

import { scraperWriteBlocked, type ScraperWriteBlockFacts } from '@ipodhan/shared/services/scraper-write-block';
import type { IPORepository } from '@ipodhan/shared';
import { E1_EXCHANGE_STATED_FIELDS, DOCUMENT_PATH_SOURCES } from '@ipodhan/shared/repositories/field-sources-repository';
import { readListingSentence, toScrapedListingExchange, type DocumentListingExchange } from './listing-sentence.js';
import { listingClaimOutranked, type ListingDocumentRef } from '../../config/listing-sentence-precedence.mjs';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import type { PageTextCarrier } from './document-page-text.js';
import { isFixedPriceIssue, normalizeReceiptValue, type RuleDocumentRef } from '../../config/plan-supersession-rule.mjs';
import {
  columnMark,
  documentMark,
  fieldsMark,
  INTERMEDIARY_ROLE_FIELDS,
  ACQUISITION_PERIOD_FIELDS,
  ocrValueLoses,
  textValuesAtOrAboveRank,
  type OcrMark,
  type TextReceipt,
} from './ocr-value-mark.js';
import type {
  FinancialStatementsRepository,
  IpoValuationRepository,
  PromotersRepository,
  IpoIntermediariesRepository,
  BrlmTrackRecordRepository,
  FieldSourcesRepository,
  FinancialDataRepository,
  PromoterInsert,
  IpoIntermediaryInsert,
  IpoRiskFactorsRepository,
  IpoRiskFactorInsert,
  PromoterAcquisitionRangeInsert,
} from '@ipodhan/shared';
import type { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
import type { FieldExtractionFailuresRepository } from '@ipodhan/shared/repositories';
import { PEER_VALUE_COLUMNS } from '../repositories/peer-company-repository.js';
import { upsertIPO, recordDocumentSourceHints } from './data-persister.js';
import { normalizeCompanyUrl } from './company-host-source.js';
import { rowKeyForName } from '@ipodhan/shared/utils/company-name-normalizer';
import { headingHashForRiskFactor } from '@ipodhan/shared/utils/risk-factor-heading-key';
import {
  checkCrossDocumentAgreement,
  expandWithheldMetrics,
  CROSS_DOC_TOLERANCE,
} from './cross-document-agreement.js';
import logger from '../utils/logger.js';
import { clearRereadAnswers, type RereadClearResult, type RereadExecutor } from './reread-answer-clear.js';
import { mappedField } from './filing-clearable-columns.js';
import * as schema from '@ipodhan/shared/db/schema';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { financialStatementsRowKey, ipoDetailsRowKey, ipoValuationRowKey } from './child-row-keys.js';
import { createChildRowNoter } from './child-row-unresolved-noter.js';
import { documentMayWriteField, fieldDocumentFamily } from './document-family-gate.js';
import type { ConsolidatedChildRowsResult, ChildRowInput, ChildConsolidationTable } from './data-consolidation-orchestrator.js';
import { scaleToRupees } from '../utils/rupee-amount.js';
import { parsePrintedNumber } from './printed-number.js';
import { isStatedAbsenceReason } from '../config/stated-absence-reasons.js';

// ---------------------------------------------------------------- extraction

export interface ExtractedField {
  value: unknown;
  page?: number | null;
  check?: { name?: string; passed?: boolean; detail?: string } | null;
  /** OD-97: set by ocr_pages.annotate_fields on a value read off an OCR'd page. */
  source_text?: string | null;
  ocr_confidence?: number | null;
  /** PR #1460: every agreeing place the cover reader read this value from (OD-97 mark covers each). */
  pages?: number[] | null;
  /** A recorded, not enforced, second check (OD-166: email domain vs company website). */
  cross_check?: { name?: string; passed?: boolean } | null;
}

/**
 * OD-166: a value that is KEPT but that the admin should look at. Listed in the admin queue the
 * same way every document suggestion is (`data_conflicts`, spec §9.4), never refused.
 */
export interface AdminListingWriter {
  /** `tx`: the ipo_details write transaction the listing joins (PR #1460 round 1). */
  listForAdmin(row: {
    ipoId: string;
    documentId: string;
    /** The document's own source label (scraperSourceForDocType), filed as source1 / source2. */
    source: ReturnType<typeof scraperSourceForDocType>;
    tableName: string;
    fieldName: string;
    value: string;
    rule: string;
    detail: Record<string, unknown>;
  }, tx?: unknown): Promise<void>;
}

export interface FilingExtraction {
  doc_type: string;
  source_doc?: string;
  pages?: number;
  extraction_status?: string;
  unit?: string | null;
  fiscal_years?: number[] | null;
  /** OD-97: page indices whose text came from OCR; [] = all text layer; absent = unknown (older envelope). */
  ocr_pages?: number[] | null;
  /** #1046: per OCR'd page, the long edge its text was read at; downscaled = read only after a smaller re-render. Informational; the persister does not read it. */
  ocr_render?: Array<{ page: number; long_edge_px: number | null; full_long_edge_px: number | null; downscaled: boolean }> | null;
  fields: Record<string, ExtractedField>;
}

export type FilingDocType = 'PRICE_BAND_AD' | 'RHP' | 'DRHP' | 'PROSPECTUS';

export interface PersistFilingOptions {
  docType: FilingDocType;
  documentId?: string | null;
  sourceSha?: string | null;
  /**
   * The extractor build that produced this extraction
   * (`filing-auto-persist.EXTRACTOR_VERSION`). Recorded in every
   * `field_sources.data_lineage` this run writes, so a row's provenance names
   * WHICH build produced it — W-151 needs that for the empty `ipo_details`
   * row, whose only content is its provenance.
   */
  extractorVersion?: string | null;
  /** false (default) computes the plan and writes nothing. */
  apply?: boolean;
}

/** The one ipo_details write this module needs, narrowed so tests can mock it. */
export interface IpoDetailsWriter {
  /**
   * `afterWriteInTx` runs INSIDE the write transaction, after the row is written, with the
   * columns actually written (the hold re-read may drop some); skipped for a hidden IPO.
   */
  upsert(
    ipoId: string,
    values: Record<string, unknown>,
    opts?: { afterWriteInTx?: (tx: unknown, written: Record<string, unknown>) => Promise<void> }
  ): Promise<void>;
  /**
   * W-151 round 2: create the identity row ONLY when the IPO has none
   * (INSERT ... ON CONFLICT DO NOTHING). Returns true when a row was created.
   *
   * An `upsert` here would rewrite `data_source` + `updated_at` (and a
   * field_sources row) for every extracted IPO on every cycle - pure churn that
   * also makes `updated_at` lie about when the data last changed. Optional so a
   * caller built before this method still compiles; when it is absent the
   * identity row is simply not written.
   */
  insertIfMissing?(ipoId: string, values: Record<string, unknown>): Promise<boolean>;
  /**
   * Item 2 slice 7: fill `issue_type` ONLY when it is NULL, never overwrite.
   *
   * CORRECTED by item 1 slice s7b. The version of this comment written with
   * #569 said `ipo_details` has NO source-priority mechanism, so a
   * lower-confidence source "can only be made harmless" and the `IS NULL` guard
   * "is the whole safety argument for this write." The first half of that is now
   * FALSE: s7b routes the filing persister's `ipo_details` write through
   * `consolidatedUpsertChildRows`, and `issueType` has an explicit entry in
   * `FIELD_PRIORITY_MATRIX` ranking CHITTORGARH last — so the column DOES have a
   * consulted ranking, on that path.
   *
   * The second half survives, and it is why this method still exists. THIS
   * writer is not on that path: the Chittorgarh report-82 job calls it directly
   * (`chittorgarh-issue-type-fill.ts`), never through the consolidator, so no
   * rank is consulted for its writes. For this door the `IS NULL` predicate plus
   * the caller's `isWriteAllowed` admin check remain the entire ordering
   * mechanism — load-bearing, not redundant. Removing the guard would let the
   * list page clobber a DRHP-sourced value with nothing to stop it, which is
   * exactly what this method's mutation test asserts.
   *
   * Returns true only when a row was actually filled, so the caller writes a
   * provenance row for a real write and not for a no-op.
   */
  fillIssueTypeIfNull?(ipoId: string, issueType: string): Promise<boolean>;
}

/**
 * The one `documents` write this module needs, narrowed the same way
 * `IpoDetailsWriter` is (W-73).
 *
 * `filing_date` is an UPDATE on the row the discovery runner already created
 * for that doc type — this module never inserts a `documents` row, because a
 * row invented from an extraction would have no URL, no sha256 and no
 * provenance. `DocumentRepository` has no such method today and is outside
 * this work package's edit scope, so the capability is injected.
 */
export interface DocumentFilingDateWriter {
  /** Returns the number of rows updated (0 when no such document row exists). */
  setFilingDate(args: {
    ipoId: string;
    docType: FilingDocType;
    filingDate: string;
  }): Promise<number>;
}

export interface FilingPersisterDeps {
  /** OD-166: the admin-queue listing for a kept value the admin should look at. */
  adminListing: AdminListingWriter;
  /**
   * #1420 (OD-153, OD-158, OD-160): the database the re-read answer clear runs its ONE transaction on
   * (reread-answer-clear.ts). Absent = nothing is cleared (non-null writes only, the pre-#1420 rule).
   */
  rereadAnswerDb?: RereadExecutor;
  ipoRepository: IPORepository;
  financialStatements: FinancialStatementsRepository;
  ipoValuation: IpoValuationRepository;
  promoters: PromotersRepository;
  intermediaries: IpoIntermediariesRepository;
  brlmTrackRecord: BrlmTrackRecordRepository;
  peerCompanies: Pick<PeerCompanyRepository, 'replaceForIpo'> & Partial<Pick<PeerCompanyRepository, 'findByIPOId'>>;
  /**
   * #545 (C): where an attempted-but-empty list section records its reason (OD-62), and
   * where a later read that supplies rows resolves it. Optional: absent means no reason
   * row is written (the pre-#545 behaviour), never a thrown persist.
   */
  fieldExtractionFailures?: Pick<FieldExtractionFailuresRepository, 'recordFailure' | 'markResolved'>;
  financialData: FinancialDataRepository;
  fieldSources: FieldSourcesRepository;
  ipoDetailsWriter: IpoDetailsWriter;
  /**
   * W-73 writers. Optional ONLY because the CLI that builds these deps
   * (scraper/scripts/persist-filing.ts) is outside this work package's edit
   * scope. When one is absent the rows it would have written are reported in
   * `skipped_no_column` with the reason — never silently dropped, and never
   * counted in `written`.
   */
  riskFactors?: Pick<IpoRiskFactorsRepository, 'replaceForIpo'>;
  documentFilingDateWriter?: DocumentFilingDateWriter;
  /**
   * The same field-protection gate every orchestrator runs
   * (packages/shared admin/field-protection-checker). Injected so the write
   * path can be tested without a database. Omitting it is only legitimate in a
   * test that is not exercising protection.
   */
  protectionFilter?: (
    ipoId: string,
    tableName: string,
    data: Record<string, unknown>,
    scraperName: string
  ) => Promise<{ filtered: Record<string, unknown> }>;
  /**
   * Item 1 slice s5b: `DataConsolidationOrchestrator`, narrowed to the one
   * method this module calls. Injected rather than constructed here because
   * the orchestrator needs a repository set and a Redis handle this module has
   * no business owning, and because a test must be able to observe the call.
   *
   * REQUIRED as of F-101. It was optional, and that `?` is the ONLY reason
   * `buildFilingPersistDeps` could omit it for thirty slices while everything
   * still type-checked: every staging cycle logged `no childRowConsolidator
   * injected` and wrote child rows with no provenance. A missing wire must be a
   * COMPILE error, not a runtime fallback. The runtime fallback branches below
   * remain as defence in depth for a cast or a JS caller — they are no longer
   * the thing that is supposed to catch this.
   */
  /**
   * OD-97: reads the rule "an OCR-only value never wins a disagreement against a
   * text page" needs. Absent = the rule cannot see a text read, so it never fires.
   */
  /**
   * OD-129 (#938, review round 1 G1): may THIS document's listing sentence write
   * `listing_exchanges`? Only when no higher-ranked offer document of the IPO
   * (Prospectus > RHP > DRHP) has already completed extraction. Absent = the
   * persister cannot tell, so it claims nothing (fail closed).
   */
  /**
   * #1233 round 2 (OD-129, OD-30): the documents the listing-sentence gate orders this one
   * against: this IPO's OTHER active, COMPLETED offer documents that stated a listing sentence
   * (a price band ad counts only when it named the exchanges), plus this document's own filing
   * date. The order itself is scraper/config/listing-sentence-precedence.mjs. Absent or failing
   * = no claim (fail closed).
   */
  listingPrecedence?: {
    listingDocuments(
      ipoId: string,
      documentId: string | null
    ): Promise<{ selfFilingDate: string | null; others: ListingDocumentRef[] }>;
  };
  /**
   * #1233 round 2 (section 2.8, section 9.2 item 18, OD-142): the plan rebuild for a claimed board or
   * exchange set, run by the `ipos` write INSIDE its own transaction, after the update and under
   * the row lock (`upsertIPO` option `inIposWriteTx`). A failure rolls the whole `ipos` write
   * back, so a new board never stands with the old type's ranks. `before` is read in that
   * transaction. Absent = no rebuild (tests, dry tooling).
   */
  planRebuildInTx?: (
    tx: unknown,
    ipoId: string,
    before: { segment: string | null; listingExchanges: string[] | null; offeringType: string | null }
  ) => Promise<{ rebuilt: boolean; typeKeyBefore?: string; typeKeyAfter?: string; queued?: number }>;
  /** #1233 round 2 (section 1.11): the field manifest's per-type applicability (`na`). Default: the real manifest. */
  fieldManifest?: { fields: Record<string, { na?: string[] }> };
  ocrPrecedence?: {
    /**
     * The text-layer receipts this IPO's active documents wrote for one field, each with its
     * document (type, filing_date, sha256) so the persister can rank it against the OCR value's
     * own document (OD-97: only a same-or-better document's text read counts).
     */
    textReceipts(ipoId: string, tableName: string, fieldName: string): Promise<TextReceipt[]>;
    /** The OCR value's own document (type, filing_date, sha256), or null when it has no row. */
    documentRef(documentId: string): Promise<RuleDocumentRef | null>;
    /** The stored ipo_details row (camelCase keys), or null. */
    storedDetails(ipoId: string): Promise<Record<string, unknown> | null>;
  };
  childRowConsolidator: {
    consolidatedUpsertChildRows(
      ipoId: string,
      tableName: ChildConsolidationTable,
      rows: ChildRowInput[],
      source: ScraperSourceLiteral,
      docType?: string
    ): Promise<ConsolidatedChildRowsResult>;
  };
}

export interface PersistFilingSummary {
  written: Record<string, number>;
  /** Fields (or whole tables) the admin field-protection gate withheld. */
  skipped_protected: string[];
  /**
   * OD-96: `<table>.<column> (<docType>)` this document did not write because the column's
   * manifest document family does not contain the document's type. The stored value is kept.
   */
  skipped_out_of_family: string[];
  /** Metric series withheld because two documents disagree about them. */
  skipped_cross_document_disagreement: string[];
  skipped_failed_check: string[];
  /**
   * Item 1 slice s7a. Child rows this run wrote WITHOUT per-field resolution or
   * provenance, each NAMED by `<table> <row_key> (<reason>)` — never a tally.
   * `signal-ownership.md` R1: a count is not a reading, so the caller can act on
   * this line instead of re-querying which rows lost provenance.
   *
   * Optional so existing callers that build a summary literal keep compiling.
   */
  unresolved_child_rows?: string[];
  /**
   * #648: how many of THIS call's own `unresolved:<reason>` marker writes
   * themselves failed to reach `field_sources` (no repository injected, or the
   * write threw) — the case the row-key-coverage check cannot distinguish
   * from "the writer never ran" (see `child-row-unresolved-noter.ts`).
   * Rolled up per cycle by the caller; 0/absent when nothing failed.
   */
  marker_write_failed?: number;
  skipped_no_column: string[];
  /** Unit-dependent writes refused because the filing states no usable unit. */
  skipped_no_unit: string[];
  /**
   * W-147: headline columns a PROSPECTUS/RHP COVER wanted to write that a price
   * band advertisement already owns. Optional so existing callers that build a
   * summary literal keep compiling.
   */
  skipped_lower_priority_source?: string[];
  /**
   * #1233: the plan rebuild this document's board / exchange claim triggered: `rebuilt <before> -> <after>`,
   * or `unchanged`. A failed rebuild is never recorded here: it rolls the `ipos` write back and throws.
   * Absent when nothing plan-invalidating was claimed.
   */
  plan_rebuild?: string;
  /** Statement rows refused because a stored row is in a different unit. */
  skipped_unit_mismatch: string[];
  /**
   * F-51: this run's fresh/OFS reconciliation outcome. Carried on the summary
   * (not only in a log line) so the CALLER can name the IPOs behind any count -
   * `signal-ownership.md` R1: a number is not a reading.
   */
  fresh_ofs_reconciliation?: {
    ok: boolean;
    kind: ReconciliationKind;
    uncheckedReasons: ReconciliationUncheckedReason[];
    deltaPct: number | null;
    reason: string | null;
  };
  /** What actually went to `ipos` via upsertIPO (issueSize et al). */
  ipos_fields: string[];
  /** #1420: stored values a newer reader's REFUSED / STATED_NOT_PRINTED answer cleared (absent when not wired). */
  reread_answers?: RereadClearResult;
  /** #1420 round 3: the clear threw (classified `REREAD_CLEAR_FAILED: ...`); every stored value was kept. */
  reread_answers_error?: string;
  /** Item 6 (OD-91): every field this extraction produced (before any write filter), camelCase. */
  receipt_fields?: ReceiptField[];
  applied: boolean;
}

/** Item 6 (OD-91) receipt row, with OD-97's per-value OCR mark (null = unknown). */
export interface ReceiptField {
  tableName: string;
  rowKey: string;
  fieldName: string;
  value?: string | null;
  sourceText?: OcrMark['sourceText'] | null;
  ocrConfidence?: number | null;
}

type ScraperSourceLiteral =
  | 'ADMIN'
  | 'DRHP'
  | 'NSE'
  | 'BSE'
  | 'API_FALLBACK'
  | 'MONEYCONTROL'
  | 'CHITTORGARH';

// ------------------------------------------------------------------- helpers

/** The only accessor for an extracted field: passed-check + non-null, or null. */
export function trusted(extraction: FilingExtraction, name: string): unknown {
  const f = extraction.fields?.[name];
  if (!f) return null;
  if (f.value === null || f.value === undefined) return null;
  if (!f.check?.passed) return null;
  return f.value;
}

function num(extraction: FilingExtraction, name: string): number | null {
  const v = trusted(extraction, name);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(extraction: FilingExtraction, name: string): string | null {
  const v = trusted(extraction, name);
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function bool(extraction: FilingExtraction, name: string): boolean | null {
  const v = trusted(extraction, name);
  return typeof v === 'boolean' ? v : null;
}

/** Item 39: the cover reader's BRLM list, only as a passing VALUE of 1+ company names. */
export function coverLeadManagers(extraction: FilingExtraction): string[] | null {
  const v = trusted(extraction, 'lead_managers');
  if (!Array.isArray(v)) return null;
  const names = v.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim());
  return names.length > 0 && names.length === v.length ? names : null;
}

/**
 * Item 40 (row 27): the objects-of-the-offer table as `ipos.objectives` ({sno, description, amount in
 * crore}), only from a passing VALUE whose every row is well formed. A row whose amount is an unpriced
 * [bullet] keeps `amount: null` (not priced yet); any malformed row drops the whole list, never a
 * partial one (a half-read table would publish a wrong total).
 */
export function docObjectives(extraction: FilingExtraction): schema.IPOObjective[] | null {
  const v = trusted(extraction, mappedField('ipos', 'objectives'));
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: schema.IPOObjective[] = [];
  for (const row of v) {
    const r = row as { serial?: unknown; label?: unknown; amount_cr?: unknown } | null;
    if (!r || typeof r.label !== 'string' || r.label.trim() === '') return null;
    if (typeof r.serial !== 'number' || !Number.isInteger(r.serial)) return null;
    let amount: number | null;
    if (r.amount_cr === null) amount = null;
    else if (typeof r.amount_cr === 'number' && Number.isFinite(r.amount_cr)) amount = r.amount_cr;
    else return null;
    out.push({ sno: r.serial, description: r.label.trim(), amount });
  }
  return out;
}

/** Item 39: the cover reader's registrar name, only as a passing VALUE. */
export function coverRegistrar(extraction: FilingExtraction): string | null {
  return str(extraction, 'registrar_name');
}

function list<T>(extraction: FilingExtraction, name: string): T[] {
  const v = trusted(extraction, name);
  return Array.isArray(v) ? (v as T[]) : [];
}

function byFy(extraction: FilingExtraction, name: string): Record<string, number> {
  const v = trusted(extraction, name);
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
  }
  return out;
}

/** The only units a filing amount may be denominated in. */
export type FilingUnit = 'MILLION' | 'CRORE' | 'LAKH' | 'RUPEES';

const RUPEES_PER_UNIT: Record<FilingUnit, number> = {
  RUPEES: 1,
  LAKH: 100_000,
  MILLION: 1_000_000,
  CRORE: 10_000_000,
};

/**
 * STRICT unit parser — returns null for anything not recognised.
 *
 * This used to default an unknown or absent unit to millions, which is the
 * worst possible failure mode for money: an extraction that already reports
 * `fresh_issue_amount` in RUPEES (or omits `unit` entirely) had that figure
 * multiplied by a million on its way to `ipos.issue_size`. A null here means
 * every unit-dependent write is SKIPPED with a reason, never guessed.
 */
export function parseFilingUnit(unit: string | null | undefined): FilingUnit | null {
  switch ((unit || '').trim().toLowerCase()) {
    case 'million':
    case 'millions':
      return 'MILLION';
    case 'crore':
    case 'crores':
      return 'CRORE';
    case 'lakh':
    case 'lakhs':
      return 'LAKH';
    case 'rupee':
    case 'rupees':
      return 'RUPEES';
    default:
      return null;
  }
}

/** Published unit -> rupees. Filing money fields are amounts, never per-share. */
export function toRupees(value: number, unit: FilingUnit): number {
  return scaleToRupees(value, RUPEES_PER_UNIT[unit]);
}

/** Published unit -> INR crore (the unit financial_data is denominated in). */
export function toCrore(value: number, unit: FilingUnit): number {
  return toRupees(value, unit) / RUPEES_PER_UNIT.CRORE;
}

/**
 * Convert an amount between two filing units with EXACT integer factors, so a
 * later filing reporting crores can be merged into a row already stored in
 * millions without changing what the row means.
 */
export function convertUnit(value: number, from: FilingUnit, to: FilingUnit): number {
  return (value * RUPEES_PER_UNIT[from]) / RUPEES_PER_UNIT[to];
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ------------------------------------------------- F-51 fresh/OFS reconciliation

/**
 * F-51: the relative tolerance a fresh + OFS pair must reconcile within.
 *
 * 0.5%. Wide enough for the rounding a filing itself prints (a cover states
 * "Rs 1,055.74 crore" for a leg pair that multiplies out to 1,055.740228), far
 * narrower than any of the failures this gate exists to catch (a digit-wrong
 * fresh leg is out by tens of percent, never by half a percent).
 */
export const FRESH_OFS_TOLERANCE = 0.005;

/**
 * #545 (C): `field_extraction_failures.rule_id` for a list section the extractor attempted
 * and returned EMPTY. The extractor's `emit.null` means "this document does not print it"
 * (a PASSING not-extractable check), so the walk's own outcome name for that answer is
 * reused (`NOT_PRINTED`, field-plan-walk.ts FetchAnswer) rather than EXTRACTION_FAILED.
 */
export const EMPTY_SECTION_RULE_ID = 'NOT_PRINTED';

/**
 * #1246 (B'): the rule id when the extractor could NOT read a section it attempted
 * (OD-62 `EXTRACTION_FAILED`: "we held the document but could not read the field").
 */
export const EMPTY_SECTION_READ_FAILED_RULE_ID = 'EXTRACTION_FAILED';

/**
 * #1420 design point 3 (OD-158, F-219): an empty section is NOT_PRINTED only when the extractor's
 * reason is on the ONE shared stated-absence list (scraper/src/config/stated-absence-reasons.json),
 * the same list scraper/scripts/answer_states.py uses to emit `state: "STATED_NOT_PRINTED"`. A pattern
 * miss (`peer_comparison_table_not_in_document`, emitted on `if not peers`; the promoter cover miss)
 * is not on it, so it is EXTRACTION_FAILED: a reader miss must never read as an absence. A failed
 * check, or any reason not listed, fails closed to EXTRACTION_FAILED.
 */
export function emptySectionRuleId(check: { passed?: unknown; detail?: unknown } | null | undefined): string {
  if (!check || check.passed !== true) return EMPTY_SECTION_READ_FAILED_RULE_ID;
  return isStatedAbsenceReason(check.detail) ? EMPTY_SECTION_RULE_ID : EMPTY_SECTION_READ_FAILED_RULE_ID;
}

export type ReconciliationKind =
  /** Checked and agreed, or nothing to check against. */
  | 'ok'
  /** No comparison base existed: see `uncheckedReasons` for WHICH of them. */
  | 'unchecked'
  /** The rupee OFS figure and ofs_shares x priceCap disagree. */
  | 'ofs_form_disagreement'
  /** fresh + OFS does not equal a comparison total. */
  | 'total_mismatch';

/**
 * Why a pair could not be reconciled. Counted SEPARATELY, never as one
 * "unchecked" bucket, because they call for different actions:
 *
 *  - `stored_null` - this IPO has no issue size on file at all. Nothing is
 *    wrong; the filing is simply the first source to state one.
 *  - `stored_zero` - `ipos.issue_size` is 0 (or negative). In this project a
 *    stored zero is a known CORRUPTION MARKER, not a legitimate total (36 rows
 *    were repaired from 0 to a real value earlier this year), which is why it
 *    is no base: reconciling against known-bad data would withhold figures
 *    that are correct. A row counted here is a row worth REPAIRING.
 *  - `no_printed_total` - the document itself printed no total either, so the
 *    only other base was unavailable too.
 */
export type ReconciliationUncheckedReason = 'stored_null' | 'stored_zero' | 'no_printed_total';

export interface ReconciliationInput {
  /** extraction.fresh_issue_amount, converted to rupees. */
  freshRupees: number | null;
  /** extraction.ofs_amount_at_cap / ofs_amount, converted to rupees. */
  ofsRupeesDirect: number | null;
  /** extraction.ofs_shares - a SHARE COUNT, never unit-converted. */
  ofsSharesAtCap: number | null;
  /** ipo_valuation.priceCap, in rupees per share. */
  priceCap: number | null;
  /**
   * The STORED ipos.issue_size (rupees) AS STORED - pass 0 as 0, never
   * pre-normalised to null, so `stored_zero` can be told from `stored_null`.
   */
  storedTotalRupees: number | null;
  /** The total this document itself PRINTS (total_offer_amount_at_cap), rupees. */
  statedTotalRupees: number | null;
}

export interface ReconciliationResult {
  ok: boolean;
  kind: ReconciliationKind;
  /** The OFS rupee value that may be written, or null when withheld/absent. */
  ofsRupeesResolved: number | null;
  /** Human-readable failure (or "unchecked") explanation; null when it agreed. */
  reason: string | null;
  /** Worst relative delta observed, in PERCENT; null when nothing was compared. */
  deltaPct: number | null;
  /** Which bases were actually compared against ('stated_total', 'stored_issue_size'). */
  basesChecked: string[];
  /** Non-empty ONLY for kind 'unchecked': which base was missing, and why. */
  uncheckedReasons: ReconciliationUncheckedReason[];
}

function crore(v: number): string {
  return `Rs ${(v / 10_000_000).toFixed(2)}cr`;
}

/**
 * F-51: a fresh/OFS pair is written only when it reconciles.
 *
 * Two independent checks, both of which must hold:
 *
 *  1. THE TWO FORMS OF OFS AGREE. The rupee figure the document states and
 *     `ofs_shares x priceCap` are two independent reads of the same quantity;
 *     when they disagree the OFS table was mis-parsed and neither is trusted.
 *     When only one form is present it is used as-is.
 *  2. FRESH + OFS EQUALS THE TOTAL, against every base available: the total
 *     this document prints, AND the total already stored on `ipos.issue_size`.
 *     The stored base is the point of F-51 - it may have come from an exchange
 *     on an earlier cycle, so it is the only base that can catch a document
 *     whose own numbers are internally consistent and wrong. The derived sum
 *     `fresh + OFS` is NEVER a base: comparing the sum against itself always
 *     passes and is what the code did before this gate existed.
 *
 * A failure withholds BOTH legs, never one: a mismatched sum cannot attribute
 * the error to fresh or to OFS, and one leg written beside a withheld partner
 * is a worse published record than neither.
 *
 * `ipos.issue_size` null or zero (a brand-new IPO whose first data IS this
 * filing, or one of the known issue_size = 0 rows) is treated as NO BASE, not
 * as a zero total: the check falls back to the document's stated total, and if
 * there is none either the pair is written with `kind: 'unchecked'` and a
 * reason. Failing closed there would permanently withhold the money fields for
 * exactly the IPOs whose only source is the filing.
 */
export function reconcileFreshAndOfs(input: ReconciliationInput): ReconciliationResult {
  const { freshRupees, ofsRupeesDirect, ofsSharesAtCap, priceCap } = input;

  // ---- 1. the two forms of OFS
  const ofsFromShares =
    ofsSharesAtCap !== null && priceCap !== null && priceCap > 0 ? ofsSharesAtCap * priceCap : null;

  if (ofsRupeesDirect !== null && ofsFromShares !== null) {
    // Relative to the LARGER magnitude, so "0 vs 755cr" is a 100% disagreement
    // rather than a division by zero.
    const scale = Math.max(Math.abs(ofsRupeesDirect), Math.abs(ofsFromShares));
    const delta = scale === 0 ? 0 : Math.abs(ofsRupeesDirect - ofsFromShares) / scale;
    if (delta > FRESH_OFS_TOLERANCE) {
      return {
        ok: false,
        kind: 'ofs_form_disagreement',
        ofsRupeesResolved: null,
        reason:
          `ofs_amount_at_cap (${crore(ofsRupeesDirect)}) vs ofs_shares x priceCap ` +
          `(${crore(ofsFromShares)}): ${(delta * 100).toFixed(2)}% apart`,
        deltaPct: delta * 100,
        basesChecked: [],
        uncheckedReasons: [],
      };
    }
  }

  const ofsResolved = ofsRupeesDirect ?? ofsFromShares;

  // ---- 2. fresh + OFS against every total available
  if (freshRupees === null || ofsResolved === null) {
    return {
      ok: true,
      kind: 'ok',
      ofsRupeesResolved: ofsResolved,
      reason: null,
      deltaPct: null,
      basesChecked: [],
      uncheckedReasons: [],
    };
  }

  const sum = freshRupees + ofsResolved;
  const bases: Array<{ name: string; value: number }> = [];
  if (input.statedTotalRupees !== null && input.statedTotalRupees > 0) {
    bases.push({ name: 'stated_total', value: input.statedTotalRupees });
  }
  if (input.storedTotalRupees !== null && input.storedTotalRupees > 0) {
    bases.push({ name: 'stored_issue_size', value: input.storedTotalRupees });
  }

  if (bases.length === 0) {
    const uncheckedReasons: ReconciliationUncheckedReason[] = [
      input.storedTotalRupees === null || !Number.isFinite(input.storedTotalRupees)
        ? 'stored_null'
        : 'stored_zero',
      'no_printed_total',
    ];
    return {
      ok: true,
      kind: 'unchecked',
      ofsRupeesResolved: ofsResolved,
      reason: `fresh + OFS not reconciled: ${uncheckedReasons.join(' + ')}`,
      deltaPct: null,
      basesChecked: [],
      uncheckedReasons,
    };
  }

  let worst = 0;
  for (const base of bases) {
    const delta = Math.abs(sum - base.value) / base.value;
    if (delta > worst) worst = delta;
    if (delta > FRESH_OFS_TOLERANCE) {
      return {
        ok: false,
        kind: 'total_mismatch',
        ofsRupeesResolved: null,
        reason:
          `fresh (${crore(freshRupees)}) + OFS (${crore(ofsResolved)}) = ${crore(sum)} vs ` +
          `${base.name} (${crore(base.value)}): ${(delta * 100).toFixed(2)}% apart`,
        deltaPct: delta * 100,
        basesChecked: bases.map((b) => b.name),
        uncheckedReasons: [],
      };
    }
  }

  return {
    ok: true,
    kind: 'ok',
    ofsRupeesResolved: ofsResolved,
    reason: null,
    deltaPct: worst * 100,
    basesChecked: bases.map((b) => b.name),
    uncheckedReasons: [],
  };
}

/**
 * T-504/#402: `numeric(precision, scale)` in Postgres refuses (code 22003) an
 * integer part wider than `precision - scale` digits. Every ipo_details
 * numeric column that a filing extraction can populate (`fresh_issue`,
 * `ofs_issue`, `min_investment`, `max_retail_subscription`,
 * `max_employee_subscription`) was widened to 18,2 by the T-504 migration,
 * but this checks the column's ACTUAL declared width at runtime rather than
 * hard-coding "18,2 is enough" — a value that still doesn't fit (e.g. a
 * misparsed extraction, or a future narrower column) is refused here instead
 * of throwing the raw driver error from inside the insert.
 */
export type NumericFitResult = 'fits' | 'overflow' | 'unparseable';

/**
 * Classifies a value against a `numeric(precision, scale)` column width.
 * Round 2 fixes (PR #423 review):
 *  - `Number(...).toString()` switches to exponential notation at 1e21
 *    ("1e+21", length 5) — a value that large would have PASSED the old
 *    digit-length check and then thrown 22003 anyway. `toFixed(0)` never
 *    produces exponential notation, so the digit count is always literal.
 *  - A comma/locale-formatted string ("1,05,55,67,000") parses to NaN, which
 *    is a DIFFERENT failure than "the number is too big" — classified as
 *    'unparseable' so the caller doesn't log a misleading overflow reason.
 */
export function classifyNumericFit(
  value: string | number,
  precision: number,
  scale: number
): NumericFitResult {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'unparseable';
  const maxIntegerDigits = precision - scale;
  // Round 2 (PR #423 review, MINOR-1 retry): `toFixed(0)` ALSO falls back to
  // exponential notation for |x| >= 1e21 (the ECMA-262 spec's own carve-out
  // for Number.prototype.toFixed) — a digit-length check via ANY string
  // formatting is unreliable at that boundary. Comparing the magnitude
  // directly against `10 ** maxIntegerDigits` never touches string
  // formatting, so it is correct at every magnitude, including 1e21+.
  return Math.abs(n) < 10 ** maxIntegerDigits ? 'fits' : 'overflow';
}

/**
 * #426 (defense-in-depth without a guard on the guard): `mark()` below only
 * runs the numeric-column guard when this predicate is true. PR #423 review
 * MINOR-2 widened it from `typeof v === 'string'` to also cover `number`
 * because a numeric() column's mapped value CAN arrive as a raw number, but
 * no current call site actually passes one into a numeric-limited
 * `ipo_details` column — so the existing test suite (which asserts
 * `classifyNumericFit` directly, never `mark()`) stays green even if the
 * `|| number` clause is reverted. Exported and named so a revert is caught
 * by a fast, direct unit test instead of depending on a future caller to
 * happen to pass a number.
 */
export function isNumericGuardCandidate(v: unknown): v is string | number {
  return typeof v === 'string' || typeof v === 'number';
}

/** Boolean convenience wrapper over `classifyNumericFit` (kept for callers that only need fits/doesn't-fit). */
export function fitsNumericColumn(
  value: string | number,
  precision: number,
  scale: number
): boolean {
  return classifyNumericFit(value, precision, scale) === 'fits';
}

/**
 * The declared (precision, scale) of a numeric column on ANY drizzle table
 * this persister writes, or null when the column isn't numeric (or doesn't
 * exist). Generic on purpose (owner 2026-09-08, T-504 scope note): the
 * overflow class isn't specific to `ipo_details` — any table this module
 * writes a rupee amount into can hit the same `numeric(p,s)` ceiling, so the
 * check takes the table as a parameter rather than being hard-coded to one.
 * Currently wired at the one write path with a proven live defect
 * (`ipo_details` via `mark()`, below) — the other tables this persister
 * writes (`financial_statements`, `ipo_valuation`, `financial_data`) already
 * sit at numeric(18,2), so wiring this same call at those sites is a
 * follow-up, not blocking this fix.
 */
function numericColumnLimit(
  table: object,
  col: string
): { precision: number; scale: number } | null {
  const column = (table as Record<string, { precision?: unknown; scale?: unknown }>)[col];
  if (column && typeof column.precision === 'number' && typeof column.scale === 'number') {
    return { precision: column.precision, scale: column.scale };
  }
  return null;
}

function bump(written: Record<string, number>, table: string, n = 1): void {
  if (n <= 0) return;
  written[table] = (written[table] || 0) + n;
}

/** financial_statements.unit is NOT NULL and has no RUPEES member. */
type StatementUnit = 'MILLION' | 'LAKH' | 'CRORE';
function asStatementUnit(u: FilingUnit | null): StatementUnit | null {
  return u === 'MILLION' || u === 'LAKH' || u === 'CRORE' ? u : null;
}

/**
 * scraper_source has no RHP / PRICE_BAND_AD member; both map to DRHP, the
 * enum's authoritative-offer-document slot. See the module header.
 */
export function scraperSourceForDocType(_docType: FilingDocType): 'DRHP' {
  return 'DRHP';
}

/** A numeric column read back off a stored row (drizzle returns strings). */
function numOrNullNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asNumeric(v: unknown): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? v.toString() : null;
}

function asCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * A stored date as an ISO day string, or UNDEFINED when there is none.
 *
 * This used to fall back to `new Date()` — TODAY — so an IPO row with a null
 * open_date and a filing that carried none had today's date written into
 * ipos.open_date as source DRHP at confidence 100. A fabricated date outranks
 * every scraped source in the matrix and looks authoritative forever. The
 * column is nullable; absent means absent.
 */
function toIsoOrUndefined(d: unknown): string | undefined {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  if (typeof d === 'string' && d.trim() !== '') return d.slice(0, 10);
  return undefined;
}

/**
 * Fields the extractor produces with a PASSING check that have no column
 * anywhere in the schema. Reported, never silently dropped (W-09).
 */
const NO_COLUMN_FIELDS: Record<string, string> = {
  // W-82: every reason below was re-checked against packages/shared/src/db/
  // schema.ts. `ipo_valuation.shares_at_floor/shares_at_cap` receive the FRESH
  // issue leg (extract_filing.py reads them off the fresh-issue row), so they
  // are NOT a home for the OFS leg, the fresh+OFS total, or the post-issue
  // capital. Splitting them is W-88's schema question; no column is added here.
  // W-88 closed the three offer-side share legs: ofs_shares,
  // total_offer_shares_at_floor and total_offer_shares_at_cap now have their own
  // ipo_valuation columns (migration 0048) and are written below.
  total_offer_amount_at_floor: 'no floor-total-amount column (issue_size is the cap total)',
  post_offer_shares_at_floor:
    'no post-issue share-capital column (the ipo_valuation share columns are offer-side) — W-88',
  post_offer_shares_at_cap:
    'no post-issue share-capital column (the ipo_valuation share columns are offer-side) — W-88',
  issue_structure: 'issue_type enum is BOOK_BUILDING/FIXED_PRICE/HYBRID, not fresh/OFS',
  headline_source:
    'W-147 provenance marker, not data — it ranks the cover headline below a price band ad (see coverOutrankedByAd)',
  shares_monotonic: 'derived check, not a stored field',
  eps_weighted_average: 'no weighted-average-EPS column',
  industry_peer_pe_average:
    'no peer-average-PE column (ipo_valuation has pe_at_floor/pe_at_cap only; peer_companies.pe_ratio is per peer)',
  // acquisition_period is exactly 1Y|18M|3Y — there is no SECONDARY member, so
  // promoter_acquisition_ranges has no row a secondary-transaction WACA (or its
  // two multiples) could occupy without a schema migration.
  waca_secondary_transactions:
    'acquisition_period enum is 1Y|18M|3Y — no SECONDARY period row on promoter_acquisition_ranges',
  floor_multiple_of_waca_secondary:
    'acquisition_period enum is 1Y|18M|3Y — no SECONDARY period row on promoter_acquisition_ranges',
  cap_multiple_of_waca_secondary:
    'acquisition_period enum is 1Y|18M|3Y — no SECONDARY period row on promoter_acquisition_ranges',
  // anchor_investors.bid_date EXISTS, but it is NOT NULL on a row whose
  // total_shares_offered, total_amount_raised, anchor_investors_count,
  // lock_in_50_percent_date and lock_in_remaining_date are ALSO NOT NULL and
  // are not printed in a price-band ad or RHP — so no row can be created from a
  // bid date alone. When a row does exist its date came from the anchor
  // allocation report, which outranks a filing's stated intention; overwriting
  // it would replace an actual bid date with a planned one.
  anchor_bid_date:
    'anchor_investors.bid_date is NOT NULL on a row with 5 further NOT NULL columns no filing carries; an existing row holds the date from the anchor allocation report, which must not be overwritten',
  brlm_issues_3y_total: 'totals row; the per-BRLM rows carry the figures',
  brlm_closed_below_total: 'totals row; the per-BRLM rows carry the figures',
  promoter_name: 'covered by the promoters table',
  promoter_names: 'covered by the promoters table',
  promoter_selling_shareholders: 'no selling-shareholder table',
  financial_basis: 'mapped to financial_statements.basis, not stored separately',
  fiscal_years: 'mapped to financial_statements.fiscal_year',
  unit: 'mapped to financial_statements.unit',
  financial_plausibility_pat_not_above_revenue: 'extractor self-check, not data',
  financial_plausibility_ebitda_at_least_pat: 'extractor self-check, not data',
  financial_plausibility_yoy_ratio_within_bounds: 'extractor self-check, not data',
  financial_plausibility_eps_times_shares_matches_pat: 'extractor self-check, not data',
  financial_plausibility_unit_stated_near_table: 'extractor self-check, not data',
  eps_sign_matches_pat: 'extractor self-check, not data',
};

/**
 * F-101 — the sentinel row key the fallback paths file provenance under.
 *
 * Defined in `child-row-unresolved-noter.ts` since slice s7c (the anchor
 * persister needs the same sentinel and importing it from here would be a
 * cycle) and re-exported unchanged so this module's public surface is the same.
 */
export { UNRESOLVED_ROW_KEY_PREFIX, unresolvedRowKey } from './child-row-unresolved-noter.js';

// ------------------------------------------------------------------ the work

/**
 * #1233 round 2 (section 1.11): is `ipos.segment` not applicable for this offering type? Read
 * from the field manifest's `na` list (INVITS/REITS today), never a hand-kept list. Returns the
 * reason when the board must not be claimed, null when it may. An unknown offering type or a
 * manifest with no `ipos.segment` row cannot be resolved and fails closed.
 */
export function segmentNotApplicable(
  offeringType: string | null,
  manifest: { fields: Record<string, { na?: string[] }> }
): string | null {
  const entry = manifest.fields['ipos.segment'];
  if (!entry) return 'no ipos.segment row in the field manifest (fail closed)';
  if (!offeringType) return 'offering type unknown, so the board applicability cannot be read (fail closed)';
  if ((entry.na ?? []).includes(offeringType)) return `segment is not applicable for ${offeringType} (section 1.11, manifest na)`;
  return null;
}

export async function persistFilingExtraction(
  ipoId: string,
  extraction: FilingExtraction,
  options: PersistFilingOptions,
  deps: FilingPersisterDeps
): Promise<PersistFilingSummary> {
  const apply = options.apply === true;
  const source = scraperSourceForDocType(options.docType);
  const unit = parseFilingUnit(extraction.unit);

  const written: Record<string, number> = {};
  const skippedFailedCheck: string[] = [];
  /** See `PersistFilingSummary.unresolved_child_rows`. */
  const unresolvedChildRows: string[] = [];
  const skippedNoColumn: string[] = [];
  const skippedNoUnit: string[] = [];
  const skippedUnitMismatch: string[] = [];
  const skippedProtected: string[] = [];
  const skippedOutOfFamily: string[] = [];
  const skippedCrossDoc: string[] = [];
  const iposFields: string[] = [];
  // Item 6 (OD-91): every field THIS document's extraction produced, taken
  // BEFORE any priority / protection / outranked-by-ad drop, so the receipt
  // says what the document prints, not what won the write. Written by the
  // caller as document_field_receipts in the COMPLETED transaction.
  const receiptFields: ReceiptField[] = [];
  // OD-97 (§2.2.1): every receipt carries its mark, computed from the pages of the extractor
  // fields the value came from (`sources` when the row decides them, else the column map); the
  // document-wide mark covers a value no mapped field produced (F-241 round 2, #1515).
  const receipt = (
    tableName: string,
    fieldName: string,
    v: unknown,
    rowKey = '',
    sources?: readonly string[]
  ): ReceiptField => {
    const m =
      (sources ? fieldsMark(extraction, sources) : columnMark(extraction, tableName, fieldName)) ??
      documentMark(extraction);
    return {
      tableName,
      rowKey,
      fieldName,
      value: normalizeReceiptValue(v),
      sourceText: m?.sourceText ?? null,
      ocrConfidence: m?.confidence ?? null,
    };
  };
  /**
   * F-241 (OD-91, OD-164(a)): the record of one child row this document produced, keyed by that
   * row's OWN identity - the same row_key its keyed provenance and consolidation use - so the
   * record covers every table the persister writes, not only `ipos` and `ipo_details`. Taken
   * before any protection / replace-allowed drop, like the `ipos` receipt. A null or undefined
   * column is not a value the document produced and leaves no receipt. A keyed child table never
   * gets a '' receipt: its IPO-level plan row is answered by the section's `rows` record (item 38).
   */
  const childReceipts = (
    tableName: string,
    rowKey: string | null,
    row: Record<string, unknown>,
    fields: readonly string[],
    sources?: readonly string[]
  ): void => {
    if (rowKey === null || rowKey === '') return;
    for (const f of fields) {
      const value = row[f];
      if (value === null || value === undefined) continue;
      receiptFields.push(receipt(tableName, f, value, rowKey, sources));
    }
  };

  /**
   * Run a table's payload through the admin field-protection gate.
   *
   * Round 3 applied this to `ipo_details` only, so an admin who hand-corrected
   * financial_data.ronw (the admin editor's own screen) had it silently
   * overwritten by the next filing run. Every table this module writes now goes
   * through the gate, under the table name the admin route stores.
   *
   * Returns null when the whole write must be abandoned (see `filterOrRefuse`).
   */
  const filterFields = async (
    tableName: string,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    // OD-96: an `ipos` column outside its manifest document family is not this document's to
    // write. Scoped to `ipos` in #993 (the table whose provenance now names its document);
    // the child tables' out-of-family writes are the owner-walked W-76/W-88 behaviour and wait
    // for the owner's call (PR #1010 body).
    const data: Record<string, unknown> = {};
    for (const [col, v] of Object.entries(input)) {
      if (tableName !== 'ipos' || documentMayWriteField(tableName, col, options.docType)) data[col] = v;
      else skippedOutOfFamily.push(`${tableName}.${col} (${options.docType})`);
    }
    if (!deps.protectionFilter) return data;
    const result = await deps.protectionFilter(ipoId, tableName, data, source);
    const kept = result.filtered as Record<string, unknown>;
    for (const col of Object.keys(data)) {
      if (!(col in kept)) skippedProtected.push(`${tableName}.${col}`);
    }
    return kept;
  };

  /**
   * A whole-row REPLACE (promoters, intermediaries, peer companies) deletes the
   * existing rows before inserting. There is no way to honour a protected field
   * inside that: the protected value would be deleted with its row. So if ANY
   * field of the table is protected for this IPO, the replace is refused
   * entirely — never partially applied.
   */
  const replaceAllowed = async (tableName: string, probe: Record<string, unknown>) => {
    if (!deps.protectionFilter) return true;
    const result = await deps.protectionFilter(ipoId, tableName, probe, source);
    const kept = result.filtered as Record<string, unknown>;
    const blocked = Object.keys(probe).filter((c) => !(c in kept));
    if (blocked.length > 0) {
      skippedProtected.push(
        `${tableName} (whole-row replace refused: ${blocked.join(', ')} protected)`
      );
      return false;
    }
    return true;
  };

  /**
   * Item 1 slice s7a — route one whole-row-replace table's rows through the
   * consolidated child writer, then hand the SAME row objects to the same
   * repository method that wrote them before this slice.
   *
   * The repositories are not reimplemented here on purpose. `replacePromoters`,
   * `IpoRiskFactorsRepository.replaceForIpo` (which also mints `headingHash`,
   * drops duplicates and re-derives `seq`), `IpoIntermediariesRepository
   * .replaceForIpo` and `PeerCompanyRepository.replaceForIpo` each carry
   * delete-then-insert INSIDE one transaction, cache invalidation, and their own
   * de-duplication rule. This helper only DECIDES values and writes provenance;
   * re-deriving any of that inside the writer is how a silent data change ships.
   *
   * Three deliberate behaviours:
   *  - flag OFF (or `apply` false): returns immediately, so the repository call
   *    below is byte-identical to the pre-slice write.
   *  - no consolidator injected, or the consolidation throws: the row is still
   *    written, unresolved, and the reason is recorded. A wiring defect must
   *    cost provenance, never data.
   *  - a row the consolidator SKIPS is still written, unresolved, and named in
   *    `skipped_failed_check` — dropping it from a whole-set replace would
   *    delete a promoter/peer from the live page, which loses strictly more.
   *
   * `identity` fields are offered for provenance but never merged back: they
   * are what the row key is computed from, so accepting a resolved value for
   * one would desync the row from the key its provenance was filed under.
   */
  /**
   * F-101 — file a provenance row under the `unresolved:<reason>` sentinel so a
   * FAILED child-row writer stops looking identical to a DISABLED one.
   *
   * Best-effort by design, and in that order: the child row is already written
   * by the repository call that follows, and losing the marker must never cost
   * the row. A marker write that fails is logged as an error, because it
   * silently re-opens the hole this exists to close.
   */
  /**
   * Slice s7c: both helpers moved to `child-row-unresolved-noter.ts` so the
   * anchor persister — a separate service with its own deps interface — files
   * the identical marker instead of hand-rolling a fourth variant. Behaviour
   * here is unchanged; `lineage` is passed as a getter because its `const` is
   * declared further down this function.
   */
  const { markChildRowsUnresolved, noteConsolidationThrew, getMarkerWriteFailures } = createChildRowNoter({
    apply,
    ipoId,
    source,
    lineage: () => lineage,
    fieldSources: deps.fieldSources,
    updatedBy: 'FILING_PERSISTER',
    logPrefix: '[FilingPersister]',
  });

  const consolidateChildRows = async (
    tableName: ChildConsolidationTable,
    entries: { rowKey: string; row: Record<string, unknown> }[],
    provenanceFields: readonly string[],
    mergeableFields: readonly string[],
    duplicateWins: 'first' | 'last' = 'last'
  ): Promise<void> => {
    if (!apply) return;
    if (!FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION) return;
    if (entries.length === 0) return;
    if (!deps.childRowConsolidator) {
      for (const entry of entries) {
        unresolvedChildRows.push(`${tableName} ${entry.rowKey} (no childRowConsolidator injected)`);
      }
      logger.error(
        { ipoId, tableName, rowKeys: entries.map((e) => e.rowKey) },
        '[FilingPersister] ENABLE_CHILD_TABLE_CONSOLIDATION is on but no childRowConsolidator was injected — falling back to the unresolved write'
      );
      await markChildRowsUnresolved(tableName, 'no-consolidator-injected');
      return;
    }

    // One consolidation input per DISTINCT row key, matching the repository's
    // own de-duplication rule so provenance describes the row that survives.
    const byKey = new Map<string, Record<string, unknown>>();
    for (const entry of entries) {
      if (duplicateWins === 'last' || !byKey.has(entry.rowKey)) byKey.set(entry.rowKey, entry.row);
    }
    const inputs: ChildRowInput[] = [...byKey.entries()].map(([rowKey, row]) => ({
      rowKey,
      data: Object.fromEntries(
        provenanceFields.filter((field) => field in row).map((field) => [field, row[field]])
      ),
    }));

    let resolved: ConsolidatedChildRowsResult;
    try {
      resolved = await deps.childRowConsolidator.consolidatedUpsertChildRows(
        ipoId,
        tableName,
        inputs,
        source,
        options.docType
      );
    } catch (error) {
      const why = await noteConsolidationThrew(tableName, error, {
        rowKeys: entries.map((e) => e.rowKey),
      });
      for (const entry of entries) {
        unresolvedChildRows.push(`${tableName} ${entry.rowKey} (${why})`);
      }
      return;
    }

    const decidedByKey = new Map(resolved.rows.map((row) => [row.rowKey, row]));
    // One marker per DISTINCT skip reason: the sentinel identifies the cause,
    // not the row, and a repeated reason is one fact about the pair.
    const skipReasons = new Set<string>();
    for (const entry of entries) {
      const decided = decidedByKey.get(entry.rowKey);
      if (!decided || decided.skipped) {
        unresolvedChildRows.push(
          `${tableName} ${entry.rowKey} (consolidation skipped: ${
            decided?.skipReason ?? 'NO_RESULT'
          })`
        );
        skipReasons.add(decided?.skipReason ?? 'NO_RESULT');
        continue;
      }
      for (const field of mergeableFields) {
        if (!(field in decided.consolidatedData)) continue;
        const value = decided.consolidatedData[field];
        // `undefined` would blank a value this extraction did carry.
        if (value === undefined) continue;
        entry.row[field] = value;
      }
    }

    for (const skipReason of [...skipReasons].sort()) {
      await markChildRowsUnresolved(tableName, `consolidation-skipped: ${skipReason}`);
    }
  };

  /**
   * Guard for EVERY rupee/crore conversion. `unit === null` means the filing
   * did not state a unit this code understands, so the amount cannot be
   * converted at all — the write is skipped with a reason instead of being
   * silently multiplied by the old millions default.
   */
  const withUnit = <T>(field: string, fn: (u: FilingUnit) => T): T | null => {
    if (unit === null) {
      skippedNoUnit.push(`${field} (filing states no usable unit: ${String(extraction.unit)})`);
      return null;
    }
    return fn(unit);
  };

  // Every field the extractor emitted but could not vouch for is reported, so
  // the caller sees "null with a reason" rather than a silent omission.
  for (const [name, f] of Object.entries(extraction.fields || {})) {
    if (f && (f.value === null || f.value === undefined || !f.check?.passed)) {
      skippedFailedCheck.push(`${name}: ${f.check?.name ?? 'no_check'}=${f.check?.passed === true}`);
    }
  }

  const existing = await deps.ipoRepository.findById(ipoId);
  if (!existing) {
    throw new Error(`persistFilingExtraction: no IPO row for id ${ipoId}`);
  }

  // `ipos.scraper_locked` is an ADMIN "hands off this row" flag. upsertIPO
  // honours it, but this module also writes ipo_details and eight child tables
  // through repositories and a raw upsert that never see it — so a locked IPO
  // was only half-protected. Refuse the WHOLE run, before the first write.
  if (scraperWriteBlocked(existing as ScraperWriteBlockFacts)) {
    throw new Error(
      `persistFilingExtraction: IPO ${ipoId} (${existing.companyName}) is scraper-write-blocked (locked or hidden) — ` +
        `refusing the entire filing write. Clear the lock / unhide in admin to allow it.`
    );
  }

  // ------------------------------------------- W-147 headline source ranking
  //
  // `scraperSourceForDocType` maps BOTH the price band advertisement and the
  // prospectus/RHP to the single scraper_source member 'DRHP', so the
  // field-priority matrix cannot tell them apart — to it, the later run always
  // wins. But they are NOT equal evidence for the offering headline: the ad is
  // the FINAL priced offer (a book-built RHP cover prints the price as "[●]",
  // and even a fixed-price cover is superseded if an ad restates it), so the
  // cover ranks BELOW the ad and ABOVE nothing else.
  //
  // The discriminator is the provenance this module itself writes: every
  // field_sources row carries `dataLineage.docType`. A cover-sourced headline
  // therefore skips any headline column whose last filing write came from a
  // PRICE_BAND_AD. ADMIN edits are already handled one layer up by
  // `filterFields`; every non-headline field (financials, objects, risks, CIN)
  // is unaffected, and `ipo_valuation` needs no guard at all because its rows
  // are keyed by `pricing_event` ('PRICE_BAND_AD' vs 'PROSPECTUS') and so never
  // collide.
  const isCoverHeadline = str(extraction, 'headline_source') === 'PROSPECTUS_COVER';
  const skippedLowerPriority: string[] = [];
  const coverOutrankedByAd = async (tableName: string, column: string): Promise<boolean> => {
    if (!isCoverHeadline) return false;
    try {
      const prior = await deps.fieldSources.findByField(ipoId, tableName, column);
      // No row at all: the column has never been written by a filing — the
      // cover is the best evidence there is, so it writes.
      if (!prior) return false;
      const priorDocType = (prior.dataLineage as { docType?: string } | null | undefined)?.docType;
      // W-147 round 2 / MINOR-2: a row that exists but carries NO docType is
      // UNKNOWN provenance, not "not an ad". Round 1 read it as fail-open and
      // let a cover overwrite a value that may well have come from the ad.
      // Only a row naming a non-ad doc type permits the write.
      if (priorDocType && priorDocType !== 'PRICE_BAND_AD') return false;
      skippedLowerPriority.push(
        priorDocType === 'PRICE_BAND_AD'
          ? `${tableName}.${column} (a price band advertisement already set it; a ` +
            `${options.docType} cover ranks below the ad)`
          : `${tableName}.${column} (stored value has no doc-type provenance; kept it rather ` +
            `than overwrite a possible price band advertisement value)`
      );
      return true;
    } catch {
      // A provenance read failure must not silently DOWNGRADE the guard into a
      // write — the ad's value is the one worth keeping, so fail closed.
      skippedLowerPriority.push(`${tableName}.${column} (provenance unreadable; kept the stored value)`);
      return true;
    }
  };
  const dropOutranked = async (
    tableName: string,
    candidate: Record<string, unknown>,
    columns: readonly string[]
  ): Promise<void> => {
    if (!isCoverHeadline) return;
    for (const col of columns) {
      if (col in candidate && (await coverOutrankedByAd(tableName, col))) delete candidate[col];
    }
  };

  // OD-97: an OCR-only value loses a disagreement with a stored value that a
  // text-page read of this IPO supports — a text read from a document of the
  // SAME OR BETTER rank for the field than this (OCR) document; an older or
  // lower-ranked document's text never beats it (OD-30, §1 DOC). Runs after the
  // receipt is taken (the receipt says what the document printed) and before
  // every other gate.
  let storedDetailsRead: Promise<{ ok: boolean; row: Record<string, unknown> | null }> | null = null;
  const loadStoredDetails = () => {
    const reader = deps.ocrPrecedence;
    if (!reader) return Promise.resolve({ ok: true, row: null });
    storedDetailsRead ??= reader.storedDetails(ipoId).then(
      (row) => ({ ok: true, row }),
      () => ({ ok: false, row: null })
    );
    return storedDetailsRead;
  };
  let ocrDocumentRead: Promise<RuleDocumentRef> | null = null;
  const loadOcrDocument = (): Promise<RuleDocumentRef> => {
    const own: RuleDocumentRef = {
      id: options.documentId ?? '',
      docType: options.docType,
      filingDate: null,
      sha256: options.sourceSha ?? null,
    };
    const reader = deps.ocrPrecedence;
    if (!reader || !options.documentId) return Promise.resolve(own);
    ocrDocumentRead ??= reader.documentRef(options.documentId).then((d) => d ?? own);
    return ocrDocumentRead;
  };
  /** Item 44 / OD-164(f): identifier columns an OCR read never overwrites against a text read. */
  const OCR_IDENTIFIER_COLUMNS: ReadonlySet<string> = new Set(['ipos.cin']);
  const dropOcrOutranked = async (
    tableName: string,
    candidate: Record<string, unknown>,
    stored: Record<string, unknown> | null
  ): Promise<void> => {
    if (!deps.ocrPrecedence) return;
    for (const col of Object.keys(candidate)) {
      const mark = columnMark(extraction, tableName, col);
      if (mark?.sourceText !== 'OCR') continue;
      const storedNormalized = normalizeReceiptValue(stored?.[col]);
      const incomingNormalized = normalizeReceiptValue(candidate[col]);
      // Item 44 / OD-164(f): an identifier (the CIN) is the same in every document of the
      // issue, so ANY text read of it for this IPO outvotes a different OCR read -- whatever
      // the documents' rank and whether a value is stored yet. One misread digit
      // (NSE: OCR ...089769 vs text ...069769) is not a newer value.
      if (OCR_IDENTIFIER_COLUMNS.has(`${tableName}.${col}`) && incomingNormalized !== null) {
        let textIds: string[];
        try {
          textIds = (await deps.ocrPrecedence.textReceipts(ipoId, tableName, col))
            .map((r) => normalizeReceiptValue(r.value))
            .filter((v): v is string => v !== null);
        } catch {
          delete candidate[col];
          skippedLowerPriority.push(`${tableName}.${col} (OCR-only identifier; text reads unreadable, not written, OD-164(f))`);
          continue;
        }
        if (textIds.some((v) => v !== incomingNormalized)) {
          delete candidate[col];
          skippedLowerPriority.push(
            `${tableName}.${col} (OCR identifier '${incomingNormalized}' disagrees with the text read ` +
              `'${textIds.find((v) => v !== incomingNormalized)}', not written, OD-164(f))`
          );
          continue;
        }
      }
      if (storedNormalized === null || storedNormalized === incomingNormalized) continue;
      let textValues: string[];
      try {
        const [receipts, ocrDocument, details] = await Promise.all([
          deps.ocrPrecedence.textReceipts(ipoId, tableName, col),
          loadOcrDocument(),
          loadStoredDetails(),
        ]);
        const fixedPrice = isFixedPriceIssue(
          (details.row?.issueType as string | null | undefined) ?? null,
          existing.priceRangeMin == null ? null : Number(existing.priceRangeMin),
          existing.priceRangeMax == null ? null : Number(existing.priceRangeMax)
        );
        textValues = textValuesAtOrAboveRank(receipts, ocrDocument, {
          family: fieldDocumentFamily(tableName, col, options.docType),
          fixedPrice,
        });
      } catch {
        delete candidate[col];
        skippedLowerPriority.push(`${tableName}.${col} (OCR-only value; text reads unreadable, kept the stored value, OD-97)`);
        continue;
      }
      if (ocrValueLoses({ incomingMark: mark, incomingNormalized, storedNormalized, textValues })) {
        delete candidate[col];
        skippedLowerPriority.push(
          `${tableName}.${col} (OCR-only value '${incomingNormalized}' loses to the text-page value ` +
            `'${storedNormalized}', OD-97)`
        );
      }
    }
  };

  const lineage = {
    method: 'FILING_EXTRACTION',
    docType: options.docType,
    documentId: options.documentId ?? null,
    sourceSha: options.sourceSha ?? null,
    extractorVersion: options.extractorVersion ?? null,
    sourceDoc: extraction.source_doc ?? null,
  };

  const trackField = async (tableName: string, fieldName: string): Promise<void> => {
    if (!apply) return;
    let previousValue: string | null = null;
    let previousSource: ScraperSourceLiteral | null = null;
    try {
      const prior = await deps.fieldSources.findByField(ipoId, tableName, fieldName);
      if (prior) {
        previousValue = prior.previousValue ?? null;
        previousSource = (prior.source as ScraperSourceLiteral) ?? null;
      }
    } catch {
      // provenance is best-effort; a read failure must not lose the write
    }
    const ocrMark = columnMark(extraction, tableName, fieldName) ?? documentMark(extraction);
    await deps.fieldSources.trackFieldUpdate({
      ipoId,
      tableName,
      fieldName,
      source,
      // Tier 1a: read off the filing itself, arithmetic-checked. OD-97: an OCR-only value
      // carries its OCR page confidence (0-1 -> the column's 0-100) instead of a flat 100.
      confidence: ocrMark?.sourceText === 'OCR' && ocrMark.confidence !== null ? Math.round(ocrMark.confidence * 100) : 100,
      previousValue,
      previousSource,
      // OD-97 (a): the per-value mark rides in provenance; unknown is omitted.
      dataLineage: ocrMark ? { ...lineage, ocr: ocrMark } : lineage,
      updatedBy: 'FILING_PERSISTER',
    });
  };

  /**
   * #545 (C). A list section the extractor ATTEMPTED and returned empty (promoters, peers)
   * wrote nothing at all, so "the RHP was read and has no cover statement" left no trace
   * (staging 2026-09-27: 0 rows in field_sources, field_extraction_failures, extraction_logs
   * and document_extraction_attempts for Moneyview / Acevector). OD-62: an absence stores a
   * reason, and OD-62 names `field_extraction_failures` as the table built to carry it.
   *
   * Recorded only when (1) the extractor emitted the field (it tried: a document type whose
   * extractor never reads the section says nothing about it), and (2) the table holds NO
   * rows for this IPO (an ad re-read beside 3 promoters from the RHP is not an absence).
   * If the existing rows cannot be listed, nothing is recorded (an absence that cannot be
   * shown is not claimed). A later read that supplies rows resolves it (`resolveEmptySection`).
   * Best effort, like every provenance write here: a failure is logged with its cause.
   */
  const EMPTY_SECTIONS: Record<string, { fieldName: string; listExisting?: () => Promise<unknown[]> }> = {
    promoters: {
      fieldName: 'name',
      listExisting: deps.promoters.listPromotersByIpo
        ? () => deps.promoters.listPromotersByIpo(ipoId)
        : undefined,
    },
    peer_companies: {
      fieldName: 'companyName',
      listExisting: deps.peerCompanies.findByIPOId ? () => deps.peerCompanies.findByIPOId!(ipoId) : undefined,
    },
  };

  const recordEmptySection = async (tableName: string, extractorFields: readonly string[]): Promise<void> => {
    if (!apply || !deps.fieldExtractionFailures) return;
    const attempted = extractorFields.map((f) => extraction.fields?.[f]).find((f) => f != null);
    if (!attempted) return;
    const section = EMPTY_SECTIONS[tableName];
    const detail = attempted.check?.detail ?? attempted.check?.name ?? 'extractor returned no rows';
    try {
      if (!section.listExisting) {
        logger.warn({ ipoId, tableName }, '[FilingPersister] cannot list existing rows; empty-section reason not recorded');
        return;
      }
      if ((await section.listExisting()).length > 0) return;
      const sha = options.sourceSha && /^[0-9a-f]{64}$/i.test(options.sourceSha) ? options.sourceSha : null;
      await deps.fieldExtractionFailures.recordFailure({
        ipoId,
        tableName,
        fieldName: section.fieldName,
        rowKey: '',
        documentId: options.documentId ?? null,
        documentSha256: sha,
        ruleId: emptySectionRuleId(attempted.check),
        rankAttempted: source,
        extractedValue: null,
        cause: `${options.docType} ${extractorFields[0]}: ${detail}`,
      });
    } catch (error) {
      const inner = (error as { cause?: { message?: string; code?: string } } | undefined)?.cause;
      logger.error(
        {
          event: 'empty-section-reason-write-failed',
          ipoId,
          tableName,
          detail,
          causeMessage: inner?.message ?? (error as Error)?.message ?? 'unknown',
          causeCode: inner?.code ?? (error as { code?: string } | undefined)?.code ?? null,
        },
        '[FilingPersister] could not record why an extracted section was empty'
      );
    }
  };

  const resolveEmptySection = async (tableName: string): Promise<void> => {
    if (!apply || !deps.fieldExtractionFailures) return;
    try {
      await deps.fieldExtractionFailures.markResolved(ipoId, tableName, EMPTY_SECTIONS[tableName].fieldName, '');
    } catch (error) {
      logger.error(
        { event: 'empty-section-resolve-failed', ipoId, tableName, causeMessage: (error as Error)?.message ?? 'unknown' },
        '[FilingPersister] could not resolve an earlier empty-section reason'
      );
    }
  };

  // ---------------------------------------------------------------- 1. ipos
  //
  // issue_size is THE field this step exists for: the ad's total offer is
  // fresh issue + OFS AT THE CAP - the number the ad itself prints as the
  // offer size - not the share-count-derived figure the exchanges publish
  // (walk ledger W-11).
  const freshMn = num(extraction, mappedField('ipo_details', 'freshIssue'));
  const ofsAtCapMn = num(extraction, 'ofs_amount_at_cap') ?? num(extraction, 'ofs_amount');
  const statedTotalMn = num(extraction, 'total_offer_amount_at_cap');
  // BOTH legs, or a total the document itself prints. Round 7 required only the
  // fresh leg and treated a missing OFS as zero, so the RHP (which prints the
  // fresh issue and no OFS line) wrote issue_size = the fresh leg alone —
  // understating Deepa's offer by Rs 2,097.16 mn. That is the exact mirror of
  // the OFS-only case guarded above it, and a wrong issue_size outranks the
  // exchanges' correct one because it is written as source DRHP.
  // A genuinely pure-fresh offer is still writable: its filing states the OFS
  // leg as 0, which is a PRESENT leg (`num` returns 0, not null).
  const offerTotalMn =
    statedTotalMn !== null
      ? statedTotalMn
      : freshMn !== null && ofsAtCapMn !== null
        ? freshMn + ofsAtCapMn
        : null;
  if (offerTotalMn === null && (freshMn !== null || ofsAtCapMn !== null)) {
    skippedFailedCheck.push(
      `ipos.issueSize: only the ${freshMn !== null ? 'fresh' : 'OFS'} leg is present ` +
        '(a one-leg total would understate the offer)'
    );
  }
  const issueSizeRupees =
    offerTotalMn !== null
      ? withUnit('ipos.issueSize', (u) => Math.round(toRupees(offerTotalMn, u)))
      : null;

  // W-171: a DRHP has no price band by law - the extractor now nulls these
  // fields itself for a DRHP, but this is the write path's OWN check, in case
  // a stale/hand-edited extraction JSON still carries a band. Defence in
  // depth: never trust the doc type at only one layer.
  const isDrhp = options.docType === 'DRHP';
  const rawFloor = num(extraction, mappedField('ipos', 'priceRangeMin'));
  const rawCap = num(extraction, mappedField('ipos', 'priceRangeMax'));
  if (isDrhp && (rawFloor !== null || rawCap !== null)) {
    logger.warn(
      { ipoId, docType: options.docType, sourceDoc: extraction.source_doc ?? null,
        rawFloor, rawCap },
      '[FilingPersister] DRHP extraction carried a price band - discarding, a DRHP has no band by law'
    );
  }
  const floor = isDrhp ? null : rawFloor;
  const cap = isDrhp ? null : rawCap;
  const lotSize = num(extraction, mappedField('ipos', 'lotSize'));
  const faceValue = num(extraction, mappedField('ipos', 'faceValue'));
  const openDate = str(extraction, mappedField('ipos', 'openDate'));
  const closeDate = str(extraction, mappedField('ipos', 'closeDate'));
  const allotmentDate = str(extraction, mappedField('ipos', 'allotmentDate'));
  const listingDate = str(extraction, mappedField('ipos', 'listingDate'));
  const description = str(extraction, mappedField('ipos', 'companyDescription'));
  // W-82: `ipos.cin` exists (varchar(21), added by migration 0042/T-428 WP C-1)
  // and the extractor emits `cin` off the cover page. It rides in `iposCandidate`
  // so it goes through the SAME gates as every other ipos scalar: the
  // scraper_locked refusal above, `filterFields('ipos', ...)`, `upsertIPO`
  // (field-priority matrix + field_sources), and the `apply` dry-run switch.
  const cinRaw = str(extraction, mappedField('ipos', 'cin'));
  const cin = cinRaw === null ? null : cinRaw.replace(/\s+/g, '').toUpperCase();
  // The column is varchar(21) and a CIN is exactly 21 alphanumerics. A value of
  // any other shape is not a CIN; writing it would either overflow the column
  // or publish a mis-parsed string as source DRHP.
  const cinForWrite = cin !== null && /^[A-Z0-9]{21}$/.test(cin) ? cin : null;
  // OD-160: a persister hold-back of a cleanly read value keeps the stored value (never a refusal).
  const heldBack = new Map<string, string>();
  if (cin !== null && cinForWrite === null) {
    skippedFailedCheck.push(`ipos.cin: '${cin}' is not a 21-character CIN`);
    heldBack.set(mappedField('ipos', 'cin'), `persister hold-back: '${cin}' is not a 21-character CIN (OD-160)`);
  }

  // ------------------------------------------------- F-51 fresh/OFS gate
  //
  // Until this gate existed, `freshIssue` and `ofsIssue` were both written the
  // moment a unit was available, and `offerTotalMn` was `statedTotal ?? (fresh
  // + ofs)` - a sum that reconciles against itself by construction. Nothing
  // ever compared the pair with the total ALREADY STORED on `ipos.issue_size`,
  // which is where a digit-wrong fresh leg shows up (the stored total came from
  // an exchange on an earlier cycle; the filing's own numbers can be internally
  // consistent and still wrong).
  const ofsSharesCount = num(extraction, 'ofs_shares');
  const inRupees = (v: number | null): number | null =>
    v === null || unit === null ? null : toRupees(v, unit);
  // AS STORED, including a 0: `reconcileFreshAndOfs` needs to tell a missing
  // issue size (`stored_null`) from the corruption marker (`stored_zero`).
  const storedIssueSizeRupees = ((): number | null => {
    const raw = (existing as { issueSize?: string | number | null }).issueSize;
    const n = raw === null || raw === undefined ? Number.NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  })();
  const reconciliation = reconcileFreshAndOfs({
    freshRupees: inRupees(freshMn),
    ofsRupeesDirect: inRupees(ofsAtCapMn),
    ofsSharesAtCap: ofsSharesCount,
    priceCap: cap,
    storedTotalRupees: storedIssueSizeRupees,
    statedTotalRupees: inRupees(statedTotalMn),
  });
  const reconLog = {
    ipoId,
    docType: options.docType,
    freshIssue: inRupees(freshMn),
    ofsIssue: reconciliation.ofsRupeesResolved,
    storedIssueSize: storedIssueSizeRupees,
    reconciled: reconciliation.ok,
    kind: reconciliation.kind,
    uncheckedReasons: reconciliation.uncheckedReasons,
    deltaPct: reconciliation.deltaPct,
    reason: reconciliation.reason,
  };
  if (!reconciliation.ok) {
    heldBack.set(mappedField('ipo_details', 'freshIssue'), `persister hold-back: fresh/OFS reconciliation failed (F-51, OD-160) - ${reconciliation.reason}`);
    skippedFailedCheck.push(
      `ipo_details.freshIssue + ipo_details.ofsIssue: withheld TOGETHER (F-51) - ${reconciliation.reason}`
    );
    logger.warn(
      reconLog,
      '[FilingPersister] fresh/OFS reconciliation FAILED - both legs withheld (F-51)'
    );
  } else {
    logger.info(reconLog, '[FilingPersister] fresh/OFS reconciliation');
  }
  // The derived total IS the pair that just failed. Writing it would launder
  // the same wrong arithmetic into `ipos.issue_size` as source DRHP, over a
  // stored value that may well be right. A total the document PRINTS is an
  // independent read and is left alone.
  const withholdDerivedTotal = !reconciliation.ok && statedTotalMn === null;
  if (withholdDerivedTotal) {
    skippedFailedCheck.push(
      'ipos.issueSize: derived from the fresh+OFS pair that failed reconciliation - not written'
    );
  }

  const scraped: Record<string, unknown> = {
    companyName: existing.companyName,
    segment: existing.segment ?? undefined,
    offeringType: existing.offeringType,
    status: existing.status,
  };

  // MIN-9, same class as the dates: 'BSE' was a FABRICATED default for a row
  // with no listing exchange on file. Only a real value is sent.
  const exchanges = (existing.listingExchanges || []).filter(Boolean);
  if (exchanges.length > 1) {
    scraped.listingExchange = 'BOTH';
  } else if (exchanges.length === 1) {
    scraped.listingExchange = exchanges[0];
  }

  // Every `ipos` column this filing wants to write, gathered BEFORE the write so
  // the admin-protection gate can drop individual columns. Round 7 sent these
  // straight into `scraped`: upsertIPO applies the field-priority matrix but NOT
  // field_protection_metadata (the orchestrators filter before calling it), so a
  // hand-corrected ipos.issue_size was overwritten by the next filing run.
  const iposCandidate: Record<string, unknown> = {};
  if (issueSizeRupees !== null && !withholdDerivedTotal) iposCandidate.issueSize = issueSizeRupees;
  if (floor !== null) iposCandidate.priceRangeMin = floor;
  if (cap !== null) iposCandidate.priceRangeMax = cap;
  if (lotSize !== null) iposCandidate.lotSize = Math.round(lotSize);
  if (faceValue !== null) iposCandidate.faceValue = Math.round(faceValue);
  if (openDate) iposCandidate.openDate = openDate;
  if (closeDate) iposCandidate.closeDate = closeDate;
  if (allotmentDate) iposCandidate.allotmentDate = allotmentDate;
  if (listingDate) iposCandidate.listingDate = listingDate;
  if (description) iposCandidate.companyDescription = description;
  if (cinForWrite !== null) iposCandidate.cin = cinForWrite;
  // Item 39 / OD-162: the book running lead managers and the registrar read off THIS
  // document's own cover / Definitions / General Information blocks are the document's answer
  // (receipt below, OD-91(4) lifted for lead_managers). The reader emits a value only when every
  // place it read agrees; a miss emits nothing here, so a stored value stays (OD-158).
  // OD-96 is checked HERE as well as in filterFields, so an out-of-family document (a price band
  // advertisement) leaves no receipt claiming it answered an RHP-family field.
  const docLeadManagers = coverLeadManagers(extraction);
  if (docLeadManagers && documentMayWriteField('ipos', 'leadManagers', options.docType)) {
    iposCandidate.leadManagers = docLeadManagers;
  }
  const docRegistrar = coverRegistrar(extraction);
  if (docRegistrar && documentMayWriteField('ipos', 'registrar', options.docType)) {
    iposCandidate.registrar = docRegistrar;
  }
  // Item 40 / row 27: the objects table is this document's answer for `ipos.objectives` (receipt below,
  // OD-96 family checked here too). A pure offer for sale (STATED_NOT_PRINTED) and every miss emit no
  // value, so nothing is claimed and a stored value stays here; the re-read clear decides a stated none.
  const docObjs = docObjectives(extraction);
  if (docObjs && documentMayWriteField('ipos', 'objectives', options.docType)) {
    iposCandidate.objectives = docObjs;
  }
  // OD-129 (#938): the listing sentence on the cover pages decides the exchanges.
  // #1233 (OD-129, row 23): it decides the BOARD too — `ipos.segment` is this document's claim,
  // under the same precedence gate, the same protection gate (an admin hold drops it, §9) and
  // the matrix's DRHP rank above the feeds.
  // A price band ad that says only "the Stock Exchanges" names none -> nothing claimed.
  // G1: an older or lower-ranked filing extracted AFTER a better one must not
  // replace its set (6 of 59 staging IPOs had an older filing extracted later).
  // #1233 round 2, answer states: STATED -> claim (subject to the gate below); NO_SENTENCE -> no
  // claim; UNREADABLE (the phrase with no exchange named) -> no claim, logged with the document;
  // segment not applicable for the offering type (section 1.11, manifest `na`) -> no board claim.
  const listingRead = readListingSentence((extraction as FilingExtraction & PageTextCarrier).page_texts);
  if (listingRead.kind === 'UNREADABLE') {
    logger.info(
      { ipoId, docType: options.docType, documentId: options.documentId ?? null, page: listingRead.page, clause: listingRead.clause },
      '#1233 listing sentence names no exchange; board and exchanges not claimed'
    );
  }
  const listingSentence = listingRead.kind === 'STATED' ? listingRead.sentence : null;
  if (listingSentence) {
    let outranked = true;
    let why = 'no listing-precedence reader (fail closed)';
    if (deps.listingPrecedence) {
      try {
        const { selfFilingDate, others } = await deps.listingPrecedence.listingDocuments(ipoId, options.documentId ?? null);
        const decision = listingClaimOutranked(
          { id: options.documentId ?? null, docType: options.docType, filingDate: selfFilingDate },
          others
        );
        outranked = decision.outranked;
        why = decision.outranked ? decision.reason : '';
      } catch (e) {
        why = `listing-precedence read failed (fail closed): ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    if (outranked) {
      skippedLowerPriority.push(`ipos.listingExchanges (${options.docType}: ${why})`);
      skippedLowerPriority.push(`ipos.segment (${options.docType}: ${why})`);
      logger.info({ ipoId, docType: options.docType, documentId: options.documentId ?? null, why }, 'OD-129 listing sentence not claimed');
    } else {
      iposCandidate.listingExchanges = listingSentence.exchanges;
      const segmentNa = segmentNotApplicable(
        (existing as { offeringType?: string | null }).offeringType ?? null,
        deps.fieldManifest ?? loadFieldManifest()
      );
      if (segmentNa === null) {
        iposCandidate.segment = listingSentence.board;
      } else {
        skippedLowerPriority.push(`ipos.segment (${options.docType}: ${segmentNa})`);
        logger.info({ ipoId, docType: options.docType, documentId: options.documentId ?? null, why: segmentNa }, '#1233 board not claimed');
      }
    }
  }

  // W-147: drop any headline column a price band advertisement already owns,
  // BEFORE the admin-protection gate and the write.
  for (const [col, v] of Object.entries(iposCandidate)) receiptFields.push(receipt('ipos', col, v));
  // PR #1460 round 1 MAJOR-3 (OD-161, OD-162, OD-73, B8 one decision point): for the cover block's
  // two `ipos` columns the persister writes ONLY an empty column. The receipt above is always
  // filed; an identical stored value is credited by it with no write and no re-stamp (OD-73), and
  // a different stored value (a website's, or ADMIN's) is left for the walk's OD-161 path, which
  // decides from the receipt (text-only replace, OCR/MIXED to the admin list).
  for (const col of ['leadManagers', 'registrar', 'objectives'] as const) {
    if (!(col in iposCandidate)) continue;
    const stored = (existing as unknown as Record<string, unknown>)[col];
    const storedEmpty =
      stored === null ||
      stored === undefined ||
      (Array.isArray(stored) ? stored.length === 0 : String(stored).trim() === '');
    if (storedEmpty) continue;
    const same = normalizeReceiptValue(stored) === normalizeReceiptValue(iposCandidate[col]);
    delete iposCandidate[col];
    skippedLowerPriority.push(
      same
        ? `ipos.${col} (equal to the stored value: credited by the receipt, not re-written, OD-73)`
        : `ipos.${col} (differs from the stored value: receipt filed, the walk decides under OD-161)`
    );
  }
  await dropOcrOutranked('ipos', iposCandidate, existing as unknown as Record<string, unknown>);
  await dropOutranked('ipos', iposCandidate, [
    'issueSize',
    'priceRangeMin',
    'priceRangeMax',
    'lotSize',
    'faceValue',
  ]);

  // The row's own dates are a legitimate fallback (they stop a filing that did
  // not carry a date from nulling one that is already there); TODAY is not.
  // Read AFTER the OD-97 drop: an OCR-only date that lost to a text read must
  // not come back through this fallback (nor feed the date checks downstream).
  const openForWrite = (iposCandidate.openDate as string | undefined) ?? toIsoOrUndefined(existing.openDate);
  const closeForWrite = (iposCandidate.closeDate as string | undefined) ?? toIsoOrUndefined(existing.closeDate);

  const iposWritable =
    Object.keys(iposCandidate).length > 0 ? await filterFields('ipos', iposCandidate) : {};
  for (const [col, v] of Object.entries(iposWritable)) {
    if (col === 'listingExchanges') {
      // The write path's payload key is the singular `listingExchange`; claiming it
      // here also takes it out of the context set, so it is this document's claim.
      scraped.listingExchange = toScrapedListingExchange(v as DocumentListingExchange[]);
      iposFields.push('listingExchange');
      continue;
    }
    scraped[col] = v;
    iposFields.push(col);
  }
  // MINOR-1: the row-fallback above must ride along ONLY when a write is
  // already happening for other reasons (iposFields non-empty) — a
  // fallback-only date must never itself trigger a write — and even then the
  // fallback is probed through the SAME protection gate, unconditionally
  // (independent of whether the filing itself carried a date), because the
  // fallback exists to preserve the stored value, and the stored value IS
  // what the admin protected. Skipped when the filing's own date already won
  // the gate above (`col in scraped`).
  if (iposFields.length > 0) {
    const dateFallback: Record<string, unknown> = {};
    if (openForWrite !== undefined && !('openDate' in scraped)) {
      dateFallback.openDate = openForWrite;
    }
    if (closeForWrite !== undefined && !('closeDate' in scraped)) {
      dateFallback.closeDate = closeForWrite;
    }
    const dateFallbackWritable =
      Object.keys(dateFallback).length > 0 ? await filterFields('ipos', dateFallback) : {};
    for (const [col, v] of Object.entries(dateFallbackWritable)) {
      scraped[col] = v;
    }
  }

  let planRebuildNote: string | undefined;
  if (iposFields.length > 0) {
    if (apply) {
      // OD-66 (owner, 2026-09-21): "you should only care about the new set of
      // fields from the new document". `scraped` carries more than this
      // document claimed — the five identity fields seeded from the STORED row
      // above (companyName, segment, offeringType, status, listingExchange) and
      // the openDate/closeDate fallbacks, all present because
      // `computeIpoIdentitySlug` needs them to resolve the row at all.
      //
      // `iposFields` is already the exact list this filing SUPPLIED, so
      // everything else in `scraped` is context by construction — derived here
      // rather than re-listed, so a future field added to the seed cannot drift
      // out of sync with a hand-kept list.
      //
      // Without this, a corrigendum that never mentioned `status` re-stamped
      // its provenance as DRHP and reached `autoResolveConverged`, closing an
      // open disagreement about a field the document never read.
      const claimed = new Set(iposFields);
      const contextFields = Object.keys(scraped).filter((k) => !claimed.has(k));
      // #993: the SAME lineage every child-table and ipo_details provenance row
      // carries (documentId, sourceSha, docType, ...). Without it the `ipos`
      // field_sources rows this filing writes named no document, and the item 6
      // DOC fetcher credited whichever COMPLETED document it found first.
      // #1233 round 2 (MAJOR-3): a claimed board or exchange set changes which sources rank first
      // for this IPO's fields; the plan is rebuilt through the one path (section 2.8, OD-142) INSIDE
      // the `ipos` write transaction, under its row lock. A failed rebuild throws and rolls the
      // board back with it; nothing here catches it.
      const rebuildInTx = deps.planRebuildInTx;
      const invalidatesPlan = claimed.has('segment') || claimed.has('listingExchange');
      await upsertIPO(
        deps.ipoRepository,
        scraped as never,
        source,
        existing as never,
        contextFields,
        lineage,
        rebuildInTx && invalidatesPlan
          ? {
              inIposWriteTx: async (tx, before) => {
                const r = await rebuildInTx(tx, ipoId, before);
                planRebuildNote = r.rebuilt
                  ? `rebuilt ${r.typeKeyBefore ?? '?'} -> ${r.typeKeyAfter ?? '?'} (queued ${r.queued ?? 0})`
                  : 'unchanged';
              },
            }
          : undefined
      );
      if (planRebuildNote !== undefined) {
        logger.info({ ipoId, docType: options.docType, planRebuild: planRebuildNote }, '#1233 plan rebuilt in the board/exchange write transaction');
      }
    }
    bump(written, 'ipos', 1);
  }

  // Item 39 round 2 (spec 2.5.6 item 2; Appendix A row 30, DOC > CG, check E7): the cover reader's
  // issuer website reaches `ipos.company_website` through its ONE existing writer,
  // `recordDocumentSourceHints` (write-once: a stored value - another cover's or an admin's - is never
  // replaced; host refused unless it is a public https host, `normalizeCompanyUrl`). Only a passing
  // VALUE (every cover place agreed) and only from an RHP-family document (OD-96): a price band
  // advert's website is carried in its envelope, never written. A MISSED / REFUSED read writes
  // nothing, so a stored value stays (OD-158).
  const docWebsite = str(extraction, 'company_website');
  if (docWebsite !== null) {
    if (!documentMayWriteField('ipos', 'companyWebsite', options.docType)) {
      skippedNoColumn.push(`company_website: OD-96, ${options.docType} is outside the field's document family`);
    } else {
      const website = normalizeCompanyUrl(docWebsite);
      if (website === null) {
        skippedFailedCheck.push('company_website: E7 host refused (not a public https issuer host)');
      } else {
        // F-241 (OD-91, OD-161): the record holds the in-family, E7-passing website in the shape the
        // writer stores, whether or not the write-once rule below lets it be written.
        receiptFields.push(receipt('ipos', 'companyWebsite', website.slice(0, 255)));
        if (existing.companyWebsite) {
          skippedNoColumn.push('company_website: write-once, the column already holds a website');
        } else if (apply) {
          await recordDocumentSourceHints(
            deps.ipoRepository,
            ipoId,
            { companyWebsite: docWebsite },
            { companyWebsite: existing.companyWebsite ?? null }
          );
          iposFields.push('companyWebsite');
        }
      }
    }
  }

  // -------------------------------------------------------- 2. ipo_details
  const details: Record<string, unknown> = {};
  const mark = (col: string, v: unknown): void => {
    if (v === null || v === undefined) return;
    // Round 2 (PR #423 review, MINOR-2): a numeric() column's mapped value
    // can arrive as either a string (round2(...).toString()) or a raw
    // number — the guard must cover both, not just strings.
    if (isNumericGuardCandidate(v)) {
      const limit = numericColumnLimit(schema.ipoDetails, col);
      if (limit) {
        const fit = classifyNumericFit(v, limit.precision, limit.scale);
        if (fit !== 'fits') {
          // Persist-numeric-overflow / persist-numeric-unparseable
          // (T-504/#402): refuse the ONE bad field, classified, instead of
          // letting the whole document throw on the driver's raw 22003 (or
          // silently coercing a locale-formatted string to NaN) — the rest
          // of the extraction still persists.
          const reason = fit === 'unparseable' ? 'persist-numeric-unparseable' : 'persist-numeric-overflow';
          // #426: carry docType so failure-delta.mjs resolves this refusal to a full
          // identity (ipoId, docType, errorClass), not just an ipoId + bare "other".
          logger.warn(
            { ipoId, docType: options.docType, col, value: v, precision: limit.precision, scale: limit.scale, reason },
            `${reason}: value refused for ipo_details column`
          );
          skippedFailedCheck.push(
            fit === 'unparseable'
              ? `ipo_details.${col}: ${reason} — '${v}' is not a parseable number`
              : `ipo_details.${col}: ${reason} — '${v}' exceeds numeric(${limit.precision},${limit.scale})`
          );
          return;
        }
      }
    }
    details[col] = v;
  };

  mark('basisOfAllotmentDate', allotmentDate);
  mark('initiationOfRefundsDate', str(extraction, mappedField('ipo_details', 'initiationOfRefundsDate')));
  mark('creditOfSharesDate', str(extraction, mappedField('ipo_details', 'creditOfSharesDate')));
  mark('upiCutoffTime', str(extraction, mappedField('ipo_details', 'upiCutoffTime')));
  mark('designatedExchange', str(extraction, mappedField('ipo_details', 'designatedExchange')));
  mark('complianceOfficer', str(extraction, mappedField('ipo_details', 'complianceOfficer')));
  mark('complianceOfficerPhone', str(extraction, mappedField('ipo_details', 'complianceOfficerPhone')));
  mark('complianceOfficerEmail', str(extraction, mappedField('ipo_details', 'complianceOfficerEmail')));
  // Appendix A rows 61-66: the issuer's registered office and contact (issuer_address.py; rows 62-63
  // are the cover's issuer contact block, the same reading as the compliance officer's, supervisor
  // decision 2026-10-03). Rows 73-74: the retail and employee maximum bid amounts in rupees (OD-48).
  mark('companyAddress', str(extraction, mappedField('ipo_details', 'companyAddress')));
  mark('companyCity', str(extraction, mappedField('ipo_details', 'companyCity')));
  mark('companyState', str(extraction, mappedField('ipo_details', 'companyState')));
  mark('companyPincode', str(extraction, mappedField('ipo_details', 'companyPincode')));
  mark('companyPhone', str(extraction, mappedField('ipo_details', 'companyPhone')));
  mark('companyEmail', str(extraction, mappedField('ipo_details', 'companyEmail')));
  const maxRetail = num(extraction, mappedField('ipo_details', 'maxRetailSubscription'));
  if (maxRetail !== null) mark('maxRetailSubscription', maxRetail.toString());
  const maxEmployee = num(extraction, mappedField('ipo_details', 'maxEmployeeSubscription'));
  if (maxEmployee !== null) mark('maxEmployeeSubscription', maxEmployee.toString());
  mark('companyDescription', description);
  if (faceValue !== null) mark('faceValue', faceValue.toString());
  const lotMultiple = num(extraction, mappedField('ipo_details', 'lotMultiple'));
  if (lotMultiple !== null) mark('lotMultiple', Math.round(lotMultiple));
  const preIpo = bool(extraction, mappedField('ipo_details', 'preIpoPlacement'));
  if (preIpo !== null) mark('preIpoPlacement', preIpo);

  const qib = num(extraction, 'qib_pct');
  const nii = num(extraction, 'nii_pct');
  const retail = num(extraction, 'retail_pct');
  if (qib !== null || nii !== null || retail !== null) {
    mark('allocationPct', { qib, nii, retail });
  }

  // fresh + ofs must SUM to ipos.issue_size (both in rupees) - GitHub #8.
  // ipo_details.fresh_issue / ofs_issue are in RUPEES (they must sum to
  // ipos.issue_size, also rupees). Both are skipped when the unit is unusable.
  // F-51: both legs, or neither. `reconciliation.ofsRupeesResolved` is the
  // rupee OFS the gate accepted - the directly-extracted figure when there is
  // one, otherwise `ofs_shares x priceCap`, which is why an OFS stated only as
  // a share count now reaches `ipo_details.ofsIssue` at all.
  if (reconciliation.ok && freshMn !== null) {
    mark('freshIssue', withUnit('ipo_details.freshIssue', (u) => round2(toRupees(freshMn, u)).toString()));
  }
  if (reconciliation.ok && reconciliation.ofsRupeesResolved !== null) {
    // Unit-gated like its partner: a filing with no usable unit cannot write
    // the fresh leg, and one leg alone is exactly what this gate forbids.
    mark(
      'ofsIssue',
      withUnit('ipo_details.ofsIssue', () =>
        round2(reconciliation.ofsRupeesResolved as number).toString()
      )
    );
  }

  // The ad cites SEBI ICDR Reg 6(1)/6(2) only for a book-built offer.
  const regulation = str(extraction, mappedField('ipo_details', 'sebiRegulationCited'));
  // W-171: same defence-in-depth as priceRangeMin/Max above - a DRHP's cover
  // wording is never trusted for the issue's price-process type either.
  const coverPriceType = isDrhp ? null : str(extraction, 'issue_price_type');
  const priceTypeForWrite =
    coverPriceType === 'FIXED_PRICE' || coverPriceType === 'BOOK_BUILDING' ? coverPriceType : null;
  if (regulation && priceTypeForWrite === 'FIXED_PRICE') {
    // The two signals disagree: a book-building regulation citation next to a
    // cover reading FIXED_PRICE means one of them was misread, so neither is
    // written (W-147 round 2).
    skippedFailedCheck.push(
      `ipo_details.issueType: the cover reads FIXED_PRICE but the filing cites SEBI ICDR ` +
        `Regulation ${regulation}, which applies only to a book-built offer`
    );
  } else if (priceTypeForWrite) {
    // W-147: the cover wording is the PRIMARY signal - an SME cover names its
    // own process in words ("Fixed Price Issue" / "100% Book Built Issue").
    // It takes precedence over both the regulation citation and the W-143
    // floor==cap heuristic below (e.g. a book-built issue whose band happens
    // to collapse to one price during a revision still reads BOOK_BUILDING
    // from the cover, not FIXED_PRICE from the coincidental floor==cap).
    mark('issueType', priceTypeForWrite);
  } else if (regulation) {
    mark('issueType', 'BOOK_BUILDING');
  } else if (floor !== null && cap !== null && floor === cap && floor > 0) {
    // W-143: no cover signal and no book-building regulation cited, AND the
    // band collapses to one price - the same domain rule `data-validation.ts`
    // already documents ("a FIXED_PRICE issue may legitimately have
    // min === max"), applied to the one column (`ipo_details.issueType`) that
    // had no writer for it at all. `floor`/`cap` are the SAME
    // price_band_floor/price_band_cap fields already read above for
    // `ipos.priceRangeMin`/`priceRangeMax` - no new extraction field, just a
    // second consumer of the one already parsed.
    mark('issueType', 'FIXED_PRICE');
  }
  // W-88 (A12): the citation itself now has a column, so the offer's regulation
  // survives instead of collapsing into the issue_type enum. Stored in the
  // form the ad prints it ("Regulation 6(1)"), inside the column's 32 chars.
  if (regulation) {
    const cited = `Regulation ${regulation}`;
    if (cited.length <= 32) mark('sebiRegulationCited', cited);
  }

  // W-88 (B8): the per-investor-class bid submission windows. Written only as a
  // whole list - a partial list would read as "these are the only windows".
  const windows = list<{ activity?: string; window?: string }>(extraction, 'bid_windows')
    .filter((w) => typeof w.activity === 'string' && typeof w.window === 'string')
    .map((w) => ({ activity: w.activity as string, window: w.window as string }));
  if (windows.length > 0) mark('bidWindows', windows);

  // W-88 (D2): the AGGREGATE promoter holding. promoters.shares_held stays null
  // (it is per-promoter and the ad never prints a per-person split).
  const promoterShares = num(extraction, mappedField('ipo_details', 'promoterSharesHeld'));
  if (promoterShares !== null && Number.isFinite(promoterShares) && promoterShares >= 0) {
    mark('promoterSharesHeld', Math.round(promoterShares));
  }

  // W-88 (D7): promoter-group transactions since the DRHP. An EMPTY array is a
  // real answer ("there were none") and IS written; the extractor emits null,
  // not [], when the ad does not carry the statement at all.
  const pgTxns = extraction.fields?.[mappedField('ipo_details', 'promoterGroupTransactionsSinceDrhp')];
  if (pgTxns && pgTxns.check?.passed && Array.isArray(pgTxns.value)) {
    mark('promoterGroupTransactionsSinceDrhp', pgTxns.value);
  }

  // W-147: the ipo_details half of the headline, same rule as `ipos` above. Receipts are pushed
  // BEFORE the #1016 E-1 filter below, so a refused field still gets a receipt recording what
  // the document printed — the same treatment an OCR-losing field gets a few lines down — even
  // though it is never written or tracked.
  for (const [col, v] of Object.entries(details)) receiptFields.push(receipt('ipo_details', col, v));

  // #1016 (RCA of #862's follow-on): E-1 fields (the exchange-stated timetable/status/
  // listing-venue set — `basisOfAllotmentDate`, `initiationOfRefundsDate`,
  // `creditOfSharesDate` are the three that land in `ipo_details`) are the exchange's to
  // state, never a document's. The #862 guard in `FieldSourcesRepository.trackFieldUpdate`
  // already refuses these on the document path by THROWING — correctly, as a safety net for
  // every OTHER caller — but nothing here caught it, so one E-1 field in an otherwise-clean
  // extraction (a price-band ad, an RHP, any doc type — `source` is always DRHP for this
  // persister, see `scraperSourceForDocType`) threw AFTER the `ipos` upsert had already run,
  // failing the whole document and losing every other field's receipts.
  //
  // Filtered here, from the guard's OWN set (never a hand-list of the three), so the guard is
  // never hit: the value is never written to `ipo_details`, never tracked, and every other
  // field on this document still persists. Each refusal is a structured log line, not a
  // silent drop.
  if (DOCUMENT_PATH_SOURCES.has(source)) {
    for (const field of Object.keys(details)) {
      if (!E1_EXCHANGE_STATED_FIELDS.has(field)) continue;
      logger.warn(
        {
          ipoId,
          table: 'ipo_details',
          field,
          value: details[field],
          documentId: options.documentId ?? null,
          docType: options.docType,
          source,
          reason: 'e1-document-path-refused',
        },
        `e1-document-path-refused: '${field}' is exchange-stated (E-1); refused from the document path, not written (#862, #1016)`
      );
      skippedFailedCheck.push(
        `ipo_details.${field}: e1-document-path-refused — exchange-stated field, refused from the document path (#862, #1016)`
      );
      delete details[field];
    }
  }
  if (Object.keys(details).length > 0 && deps.ocrPrecedence) {
    const { ok: storedDetailsOk, row: storedDetails } = await loadStoredDetails();
    if (!storedDetailsOk) {
      // Fail closed, as W-147 does: an OCR-only value is withheld when the
      // stored side cannot be read, never written blind over a text value.
      for (const col of Object.keys(details)) {
        if (columnMark(extraction, 'ipo_details', col)?.sourceText === 'OCR') {
          delete details[col];
          skippedLowerPriority.push(`ipo_details.${col} (OCR-only value; stored row unreadable, kept the stored value, OD-97)`);
        }
      }
    } else {
      await dropOcrOutranked('ipo_details', details, storedDetails);
    }
  }
  await dropOutranked('ipo_details', details, [
    'freshIssue',
    'ofsIssue',
    'faceValue',
    'lotMultiple',
    'issueType',
  ]);

  // Per-field protection: an admin who hand-corrected one ipo_details column
  // must not have it overwritten by the next filing run. The raw Drizzle
  // upsert cannot see field_protection_metadata, so the payload is filtered
  // BEFORE it reaches the writer, exactly as the orchestrators do for `ipos`.
  const detailsWritable =
    Object.keys(details).length > 0 ? await filterFields('ipo_details', details) : {};

  // W-151: the row exists for every IPO whose filing was persisted, even when
  // the extraction yielded ZERO writable detail columns (which is the norm for
  // an RHP/DRHP/PROSPECTUS — see W-147). Before this, "no row" and "row with
  // unknown fields" were indistinguishable, so a whole-pipeline gap looked like
  // an empty table: 3 rows for 358 IPOs. The identity row carries `data_source`
  // (the only NOT NULL column besides `ipo_id`), and its `field_sources` row
  // carries the doc type, the source document id and the extractor version — so
  // `audit:coverage` can count "IPOs with a details row" and see the gap.
  //
  // `dataSource` is appended AFTER `filterFields`, exactly as before: it is a
  // provenance stamp the persister owns, not an admin-editable value, and it is
  // NOT NULL so an insert cannot omit it.
  if (Object.keys(detailsWritable).length > 0) {
    if (apply) {
      // Item 1 slice s7b. Flag OFF: byte-identical to the pre-s7b write —
      // `detailsPayload` is `detailsWritable` itself and nothing else runs.
      let detailsPayload: Record<string, unknown> = detailsWritable;
      if (FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION) {
        if (!deps.childRowConsolidator) {
          logger.error(
            { ipoId, table: 'ipo_details' },
            '[FilingPersister] ENABLE_CHILD_TABLE_CONSOLIDATION is on but no childRowConsolidator was injected — falling back to the unresolved write'
          );
          await markChildRowsUnresolved('ipo_details', 'no-consolidator-injected');
        } else {
          let resolved: ConsolidatedChildRowsResult | undefined;
          try {
            resolved = await deps.childRowConsolidator.consolidatedUpsertChildRows(
              ipoId,
              'ipo_details',
              [{ rowKey: ipoDetailsRowKey(), data: detailsWritable }],
              source,
              options.docType
            );
          } catch (error) {
            // `detailsPayload` is left as `detailsWritable` — exactly what the
            // no-consolidator fallback leaves it as — so the row is still
            // WRITTEN, unresolved, and the persist carries on to the next table.
            await noteConsolidationThrew('ipo_details', error, { table: 'ipo_details' });
          }
          const decided = resolved?.rows[0];
          if (resolved === undefined) {
            // The throw was handled above; nothing to resolve, keep the payload.
          } else if (decided && decided.skipped) {
            skippedFailedCheck.push(`ipo_details (consolidation skipped: ${decided.skipReason})`);
            await markChildRowsUnresolved(
              'ipo_details',
              `consolidation-skipped: ${decided.skipReason}`
            );
            detailsPayload = {};
          } else {
            // Only the columns this extraction actually offered. A resolver
            // that returns a stored value for a column we did not send would
            // otherwise be rewritten under THIS run's data_source.
            const out: Record<string, unknown> = {};
            for (const col of Object.keys(detailsWritable)) {
              const v = (decided?.consolidatedData ?? {})[col];
              if (v === undefined) continue;
              out[col] = v;
            }
            detailsPayload = out;
          }
        }
      }
      if (Object.keys(detailsPayload).length > 0) {
        // OD-166 (row 46): an email whose domain differs from the company website is KEPT and
        // listed for the admin, never refused. The listing runs INSIDE the ipo_details write
        // transaction and only when the email is actually written there (after the admin gate,
        // the consolidation and the hold re-read), so a held or dropped email is never listed
        // and a rolled-back write leaves no listing (PR #1460 round 1 MINOR).
        const coEmailKey = mappedField('ipo_details', 'complianceOfficerEmail');
        const coEmail = str(extraction, coEmailKey);
        const documentId = options.documentId ?? null;
        const listsEmail =
          coEmail !== null &&
          documentId !== null &&
          extraction.fields[coEmailKey]?.cross_check?.passed === false &&
          documentMayWriteField('ipo_details', 'complianceOfficerEmail', options.docType) &&
          detailsPayload.complianceOfficerEmail === coEmail;
        const adminListing = deps.adminListing;
        if (listsEmail && !adminListing) {
          skippedNoColumn.push('ipo_details.complianceOfficerEmail: OD-166 admin listing not wired (no adminListing dep)');
        }
        const afterWriteInTx =
          listsEmail && adminListing && coEmail !== null && documentId !== null
            ? async (tx: unknown, written: Record<string, unknown>) => {
                if (written.complianceOfficerEmail !== coEmail) return;
                await adminListing.listForAdmin(
                  {
                    ipoId,
                    documentId,
                    source,
                    tableName: 'ipo_details',
                    fieldName: 'complianceOfficerEmail',
                    value: coEmail,
                    rule: 'OD-166',
                    detail: {
                      check: 'email_domain_matches_website',
                      website: str(extraction, 'company_website'),
                      page: extraction.fields[coEmailKey]?.page ?? null,
                    },
                  },
                  tx
                );
              }
            : undefined;
        await deps.ipoDetailsWriter.upsert(
          ipoId,
          { ...detailsPayload, dataSource: source },
          afterWriteInTx ? { afterWriteInTx } : undefined
        );
        for (const col of Object.keys(detailsPayload)) await trackField('ipo_details', col);
      }
    }
    bump(written, 'ipo_details', 1);
  } else if (apply && deps.ipoDetailsWriter.insertIfMissing) {
    // Identity-only case: create the row if it is missing, and do NOTHING when
    // it already exists - a repeat cycle must not touch `data_source`,
    // `updated_at` or field_sources for a row it has no new value for.
    const inserted = await deps.ipoDetailsWriter.insertIfMissing(ipoId, { dataSource: source });
    if (inserted) {
      await trackField('ipo_details', 'dataSource');
      bump(written, 'ipo_details', 1);
    }
  }
  // Plan mode (apply: false) deliberately counts only the field write: whether
  // the identity row is missing is unknowable without reading the database, and
  // a plan that claims a write it may not make is a dishonest plan.

  // ------------------------------------------------- 3. financial_statements
  const basisRaw = str(extraction, 'financial_basis');
  // Every document this persister reads (price band ad, DRHP, RHP, prospectus)
  // publishes RESTATED financial information — SEBI ICDR requires it. Defaulting
  // an unlabelled block to STANDALONE was a real defect: the ad states its basis
  // and the RHP does not, so the SAME three years landed twice under two
  // different bases (6 rows for 3 fiscal years), the RHP's copy mislabelled.
  // Only an explicit "standalone"-without-"restated" label downgrades it.
  // Lowercase BEFORE matching: the label arrives from the document in whatever
  // case it was printed ("Standalone", "RESTATED STANDALONE"), and a
  // case-sensitive check silently classified "Standalone" as RESTATED.
  const basisLower = basisRaw?.toLowerCase() ?? null;
  const basis: 'RESTATED' | 'STANDALONE' =
    basisLower && basisLower.includes('standalone') && !basisLower.includes('restated')
      ? 'STANDALONE'
      : 'RESTATED';
  const unitEnum = asStatementUnit(unit);
  const revenue = byFy(extraction, 'revenue_by_fy');
  const totalIncome = byFy(extraction, 'total_income_by_fy');
  const ebitda = byFy(extraction, 'ebitda_by_fy');
  const pat = byFy(extraction, 'pat_by_fy');
  const netWorth = byFy(extraction, 'net_worth_by_fy');
  const epsBasic = byFy(extraction, 'eps_basic_by_fy');
  const epsDiluted = byFy(extraction, 'eps_diluted_by_fy');
  const opCashFlow = byFy(extraction, 'op_cash_flow_by_fy');
  const dscr = byFy(extraction, 'dscr_by_fy');
  const rent = byFy(extraction, 'rent_by_fy');

  // ------------------------------------------------------ MOD-6 (W-45, single doc)
  // The paired invocation runs the cross-document check before either document
  // is persisted. A SINGLE-document run had no such gate, so persisting the RHP
  // on Tuesday could silently contradict the ad persisted on Monday. When rows
  // from a DIFFERENT filing already exist, this extraction is checked against
  // them — converted into a common unit first — and every disagreeing metric is
  // withheld, exactly as in paired mode.
  const priorRowsForAgreement = await deps.financialStatements.listByIpo(ipoId);
  const withheldMetrics = new Set<string>();
  if (unit !== null && priorRowsForAgreement.length > 0) {
    // MOD-4: each stored row carries its OWN unit. Taking row[0]'s unit for the
    // whole set silently re-denominated every other year — a table holding
    // FY2024 in MILLION and FY2025 in CRORE (which the merge rule allows,
    // because the unique key is (ipo_id, fiscal_year, basis) and does NOT
    // include the unit) would have had FY2025 compared as if it were millions
    // and reported a 10x disagreement that does not exist. Each row's amounts
    // are converted from its own unit into the comparison unit instead.
    //
    // The comparison unit is this extraction's, so the incoming series needs no
    // conversion at all and only the stored side moves.
    const comparisonUnit = asStatementUnit(unit);
    if (comparisonUnit) {
      const stored: Record<string, Record<string, number>> = {};
      const incoming: Record<string, Record<string, number>> = {};
      const put = (
        bag: Record<string, Record<string, number>>,
        metric: string,
        fy: string | number,
        value: number | null
      ) => {
        if (value === null || !Number.isFinite(value)) return;
        (bag[metric] ||= {})[String(fy)] = value;
      };
      for (const r of priorRowsForAgreement) {
        const row = r as unknown as Record<string, unknown>;
        const rowUnit = asStatementUnit((row.unit as StatementUnit) ?? null);
        // A row whose unit this code cannot read is not comparable at any
        // scale; skip it rather than guess which denomination it is in.
        if (!rowUnit) continue;
        const amount = (v: unknown): number | null => {
          const n = numOrNullNum(v);
          return n === null ? null : convertUnit(n, rowUnit, comparisonUnit);
        };
        put(stored, 'revenue_by_fy', row.fiscalYear as number, amount(row.revenue));
        put(stored, 'pat_by_fy', row.fiscalYear as number, amount(row.pat));
        // EPS is per-share — never unit-converted.
        put(stored, 'eps_basic_by_fy', row.fiscalYear as number, numOrNullNum(row.epsBasic));
      }
      for (const [fy, v] of Object.entries(revenue)) put(incoming, 'revenue_by_fy', fy, v);
      for (const [fy, v] of Object.entries(pat)) put(incoming, 'pat_by_fy', fy, v);
      for (const [fy, v] of Object.entries(epsBasic)) put(incoming, 'eps_basic_by_fy', fy, v);

      const agreement = checkCrossDocumentAgreement(
        stored,
        incoming,
        CROSS_DOC_TOLERANCE,
        `stored (converted to ${comparisonUnit})`,
        `${options.docType} (${unit})`,
        // Both sides are already in comparisonUnit: the stored rows were each
        // converted from their own unit above, and the incoming series is
        // native to it. Passing the same unit twice keeps the per-share
        // exemption active without re-converting anything.
        comparisonUnit,
        comparisonUnit
      );
      if (!agreement.agree) {
        for (const m of expandWithheldMetrics(agreement.disagreeingMetrics)) {
          withheldMetrics.add(m);
        }
        skippedCrossDoc.push(...agreement.detail.split('; '));
      }
    }
  }

  // MOD-7: a disagreement on ANY compared metric withholds the WHOLE financial
  // block, not just the offending series. The compared metrics come off the
  // same restated table as total income, EBITDA, net worth and operating cash
  // flow — if one column was mis-parsed the table was mis-parsed.
  const withholdAll = withheldMetrics.size > 0;
  const keep = (m: Record<string, number>) => (withholdAll ? {} : m);
  const revenueW = keep(revenue);
  const totalIncomeW = keep(totalIncome);
  const ebitdaW = keep(ebitda);
  const patW = keep(pat);
  const netWorthW = keep(netWorth);
  const epsBasicW = keep(epsBasic);
  const epsDilutedW = keep(epsDiluted);
  const opCashFlowW = keep(opCashFlow);
  const dscrW = keep(dscr);
  const rentW = keep(rent);
  if (withholdAll) {
    skippedCrossDoc.push(
      'whole financial block withheld (revenue, total_income, ebitda, pat, net_worth, eps, op_cash_flow)'
    );
  }

  const fyKeys = new Set<string>([
    ...Object.keys(revenueW),
    ...Object.keys(totalIncomeW),
    ...Object.keys(ebitdaW),
    ...Object.keys(patW),
    ...Object.keys(netWorthW),
    ...Object.keys(epsBasicW),
    ...Object.keys(epsDilutedW),
    ...Object.keys(opCashFlowW),
  ]);

  if (!unitEnum && fyKeys.size > 0) {
    // unit is NOT NULL on the table and an unlabelled amount is a wrong number
    // waiting to render - refuse the whole block rather than guess.
    skippedNoUnit.push(
      `financial_statements (unit '${String(extraction.unit)}' is not one of MILLION/LAKH/CRORE)`
    );
  } else {
    // The repository upsert writes the WHOLE row, so a second filing that
    // carries fewer columns (the RHP has no operating-cash-flow row) would null
    // what the first filing already stored. Read the existing rows and keep any
    // value this extraction does not carry — enrich, never erase.
    // Read UNCONDITIONALLY. Reading only when applying made the dry-run plan a
    // different computation from the real one: with no priors the dry run saw
    // no unit mismatch and no carried-forward columns, so it could report rows
    // the apply would refuse. A dry run must exercise the same decisions.
    const existingStatements = await deps.financialStatements.listByIpo(ipoId);

    // financial_statements is admin-editable like the other tables, and until
    // now it was the ONE table this module wrote with no protection gate at all
    // (the gate ran for ipo_details, ipo_valuation and financial_data only).
    // The row is rewritten whole, so a protected column cannot simply be
    // omitted — it is pinned to the value already stored, i.e. the admin's.
    const STATEMENT_COLUMNS = [
      'revenue',
      'totalIncome',
      'ebitda',
      'pat',
      'netWorth',
      'epsBasic',
      'epsDiluted',
      'opCashFlow',
      'dscr',
      'rentExpense',
    ] as const;
    // MINOR-2: this probe runs once for the whole IPO, independent of any
    // specific fiscal-year row. Protection means "do not overwrite the
    // admin's stored value" — with NO stored financial_statements row at
    // all, there is nothing to protect, so a "protected" verdict here must
    // not (a) block the insert (handled per-row below via `prior`) or (b)
    // report a skip that never actually withheld anything.
    const skippedProtectedBeforeProbe = skippedProtected.length;
    const statementWritable = await filterFields(
      'financial_statements',
      Object.fromEntries(STATEMENT_COLUMNS.map((c) => [c, null]))
    );
    if (existingStatements.length === 0) {
      skippedProtected.length = skippedProtectedBeforeProbe;
    }
    const statementProtected = new Set(
      STATEMENT_COLUMNS.filter((c) => !(c in statementWritable))
    );
    let n = 0;
    for (const fy of [...fyKeys].sort()) {
      const fiscalYear = Number(fy);
      if (!Number.isInteger(fiscalYear)) continue;
      const prior = existingStatements.find(
        (r) => r.fiscalYear === fiscalYear && r.basis === basis
      );

      // The unique key is (ipo_id, fiscal_year, basis) — it does NOT include
      // the unit. Carrying prior columns forward while stamping THIS
      // extraction's unit on the row would silently re-denominate the values
      // the earlier filing stored (an ad in millions merged with an RHP in
      // crores gave a row labelled CRORE holding million-scale figures).
      // The stored row's unit wins: incoming values are converted into it with
      // exact factors. Only an unconvertible prior unit refuses the row.
      const priorUnit = prior ? asStatementUnit(prior.unit as StatementUnit) : null;
      if (prior && priorUnit === null) {
        skippedUnitMismatch.push(
          `financial_statements FY${fiscalYear}/${basis} (stored unit '${String(prior.unit)}' unrecognised)`
        );
        continue;
      }
      const rowUnit: StatementUnit = priorUnit ?? unitEnum;
      // MINOR-2: protection only applies when there is a STORED value to
      // protect — `prior` is this exact (fiscal_year, basis) row. With no
      // prior row, "protected" has nothing to preserve, so the filing's
      // value is written rather than a null.
      // s5b: the columns THIS extraction actually supplies for THIS row, in
      // the row's unit — i.e. the values that are this source's claim. A
      // carried-forward prior value is NOT in here: sending it as "incoming"
      // would let this source claim provenance for a number an earlier filing
      // supplied.
      const carried: Record<string, string> = {};
      // F-241: what THIS document printed for the row, in the row's unit, before protection.
      const printed: Record<string, string> = {};
      const perShare = (
        m: Record<string, number>,
        col: string,
        kept: string | null
      ): string | null => {
        if (m[fy] !== undefined) printed[col] = m[fy].toString();
        if (prior && statementProtected.has(col as (typeof STATEMENT_COLUMNS)[number])) {
          return kept;
        }
        if (m[fy] === undefined) return kept;
        carried[col] = m[fy].toString();
        return carried[col];
      };
      const s = (m: Record<string, number>, col: keyof typeof prior): string | null => {
        if (m[fy] !== undefined) {
          printed[col as string] =
            rowUnit === unitEnum ? m[fy].toString() : round2(convertUnit(m[fy], unitEnum, rowUnit)).toString();
        }
        if (prior && statementProtected.has(col as (typeof STATEMENT_COLUMNS)[number])) {
          return (prior[col] as string | null) ?? null;
        }
        if (m[fy] !== undefined) {
          const raw = m[fy];
          // s5b unit decision: convert BEFORE consolidation, never after. The
          // row carries ONE `unit` column and the stored row's unit wins, so
          // an incoming MILLION figure and a stored CRORE figure are not
          // comparable numbers until they are in the same denomination —
          // ranking them raw would let a 100x-smaller number look like a
          // different fact. Converting first also means the value the flag-ON
          // path writes is denominated exactly as the flag-OFF path's is.
          carried[col as string] =
            rowUnit === unitEnum
              ? raw.toString()
              : round2(convertUnit(raw, unitEnum, rowUnit)).toString();
          return carried[col as string];
        }
        const kept = prior ? (prior[col] as string | null) : null;
        return kept ?? null;
      };
      const statementRow: Record<string, unknown> = {
        ipoId,
        fiscalYear,
        basis,
        unit: rowUnit,
        revenue: s(revenueW, 'revenue'),
        totalIncome: s(totalIncomeW, 'totalIncome'),
        ebitda: s(ebitdaW, 'ebitda'),
        pat: s(patW, 'pat'),
        netWorth: s(netWorthW, 'netWorth'),
        // Per-share figures are NOT amounts — they are never unit-converted.
        epsBasic: perShare(epsBasicW, 'epsBasic', prior?.epsBasic ?? null),
        epsDiluted: perShare(epsDilutedW, 'epsDiluted', prior?.epsDiluted ?? null),
        opCashFlow: s(opCashFlowW, 'opCashFlow'),
        // A ratio, not an amount.
        dscr: perShare(dscrW, 'dscr', prior?.dscr ?? null),
        rentExpense: s(rentW, 'rentExpense'),
      };
      childReceipts(
        'financial_statements',
        financialStatementsRowKey(fiscalYear, basis),
        { fiscalYear, basis, unit: rowUnit, ...printed },
        ['fiscalYear', 'basis', 'unit', ...STATEMENT_COLUMNS]
      );
      if (apply) {
        // Flag OFF: byte-identical to the pre-s5b write — `statementRow` is the
        // same object literal this module always built, and nothing else runs.
        if (FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION) {
          if (!deps.childRowConsolidator) {
            logger.error(
              { ipoId, fiscalYear, basis },
              '[FilingPersister] ENABLE_CHILD_TABLE_CONSOLIDATION is on but no childRowConsolidator was injected — falling back to the unresolved write'
            );
            await markChildRowsUnresolved('financial_statements', 'no-consolidator-injected');
          } else {
            const rowKey = financialStatementsRowKey(fiscalYear, basis);
            if (rowKey === null) {
              // Unreachable through this loop (fiscalYear is integer-checked
              // above and basis is non-null), which is exactly why it must not
              // be assumed: a keyless row filed under '' would collide with
              // every other keyless row's provenance.
              skippedFailedCheck.push(
                `financial_statements FY${fiscalYear}/${basis} (no row key — not written)`
              );
              continue;
            }
            let resolved: ConsolidatedChildRowsResult | undefined;
            try {
              resolved = await deps.childRowConsolidator.consolidatedUpsertChildRows(
                ipoId,
                'financial_statements',
                [
                  {
                    rowKey,
                    existingRowId: (prior as { id?: string } | undefined)?.id,
                    data: carried,
                    existingData: prior
                      ? Object.fromEntries(
                          STATEMENT_COLUMNS.map((c) => [
                            c,
                            (prior as unknown as Record<string, unknown>)[c],
                          ])
                        )
                      : undefined,
                  },
                ],
                source,
                options.docType
              );
            } catch (error) {
              // `statementRow` is left as built — exactly what the
              // no-consolidator fallback leaves it as — so the row is still
              // WRITTEN, unresolved, and the remaining fiscal years still run.
              await noteConsolidationThrew('financial_statements', error, { fiscalYear, basis });
            }
            const decided = resolved?.rows[0];
            if (resolved === undefined) {
              // The throw was handled above; keep the row this extraction built.
            } else if (decided && decided.skipped) {
              skippedFailedCheck.push(
                `financial_statements FY${fiscalYear}/${basis} (consolidation skipped: ${decided.skipReason})`
              );
              await markChildRowsUnresolved(
                'financial_statements',
                `consolidation-skipped: ${decided.skipReason}`
              );
              continue;
            }
            for (const [col, value] of Object.entries(decided?.consolidatedData ?? {})) {
              // Only the columns this row actually models, and never an
              // `undefined` that would blank a carried-forward value.
              if (!STATEMENT_COLUMNS.includes(col as (typeof STATEMENT_COLUMNS)[number])) continue;
              if (value === undefined) continue;
              statementRow[col] = value;
            }
          }
        }
        // null = the admin owns the list of years and it lacks this year (#1294 item 6): nothing was
        // stored, so it is a suggestion only and is not counted as written.
        const stored = await deps.financialStatements.upsert(statementRow as never);
        if (stored === null) continue;
      }
      n += 1;
    }
    if (n > 0) {
      bump(written, 'financial_statements', n);
      await trackField('financial_statements', 'rows');
    }
  }

  // ------------------------------------------------------- 4. ipo_valuation
  const mcapFloorMn = num(extraction, 'market_cap_at_floor');
  const mcapCapMn = num(extraction, mappedField('financial_data', 'marketCap'));
  const valuation: Record<string, unknown> = {};
  const vset = (k: string, v: number | null): void => {
    if (v !== null) valuation[k] = v;
  };
  vset('priceFloor', floor);
  vset('priceCap', cap);
  // shares_at_floor/shares_at_cap are the FRESH-issue leg (extract_filing.py
  // reads them off the "Fresh Issue" row). They keep that meaning for backward
  // compatibility with readers written before W-88; fresh_shares_at_floor/at_cap
  // carry the identical value under an unambiguous name, and the OFS and total
  // legs get their own columns instead of being folded into these two.
  const freshFloor = num(extraction, 'shares_at_floor');
  const freshCap = num(extraction, 'shares_at_cap');
  vset('sharesAtFloor', freshFloor);
  vset('sharesAtCap', freshCap);
  vset('freshSharesAtFloor', freshFloor);
  vset('freshSharesAtCap', freshCap);
  // F-51: when the rupee OFS and `ofs_shares x priceCap` disagree, the share
  // count is one of the two numbers under suspicion - it is not written either.
  if (reconciliation.kind === 'ofs_form_disagreement') {
    skippedFailedCheck.push(
      `ipo_valuation.ofsShares: withheld with the OFS rupee leg - ${reconciliation.reason}`
    );
  } else {
    vset('ofsShares', ofsSharesCount);
  }
  vset('totalSharesAtFloor', num(extraction, 'total_offer_shares_at_floor'));
  vset('totalSharesAtCap', num(extraction, 'total_offer_shares_at_cap'));
  // F7 UNIT CONTRACT: ipo_valuation.mcap_at_floor / mcap_at_cap are stored in
  // RUPEES, while financial_data.market_cap (below) is stored in CRORE. Same
  // source number, two different denominations — do not copy one to the other.
  if (mcapFloorMn !== null) {
    const v = withUnit('ipo_valuation.mcapAtFloor', (u) => round2(toRupees(mcapFloorMn, u)));
    if (v !== null) valuation.mcapAtFloor = v;
  }
  if (mcapCapMn !== null) {
    const v = withUnit('ipo_valuation.mcapAtCap', (u) => round2(toRupees(mcapCapMn, u)));
    if (v !== null) valuation.mcapAtCap = v;
  }
  vset('peAtFloor', num(extraction, 'pe_at_floor'));
  vset('peAtCap', num(extraction, 'pe_at_cap'));
  vset('ronwWeighted3y', num(extraction, 'weighted_average_ronw'));
  vset('faceValueMultipleFloor', num(extraction, 'floor_multiple_of_face'));
  vset('faceValueMultipleCap', num(extraction, 'cap_multiple_of_face'));

  if (Object.keys(valuation).length > 0) {
    const pricingEvent: 'PRICE_BAND_AD' | 'PROSPECTUS' =
      options.docType === 'PRICE_BAND_AD' ? 'PRICE_BAND_AD' : 'PROSPECTUS';
    childReceipts('ipo_valuation', ipoValuationRowKey(pricingEvent), valuation, Object.keys(valuation));
    const valuationWritable = await filterFields('ipo_valuation', valuation);
    if (Object.keys(valuationWritable).length === 0) {
      skippedProtected.push('ipo_valuation (every field protected)');
    } else if (apply) {
      // The payload is built from `valuationWritable`, NEVER from `valuation`.
      // Round 7 computed the filtered set, used it only for the emptiness check,
      // and then read every column off the UNFILTERED object — so a protected
      // ipo_valuation column was written anyway. A protected column is OMITTED
      // from the payload (not sent as null, which would erase it just as surely).
      let w = valuationWritable;
      // Item 1 slice s7b. Flag OFF: `w` is `valuationWritable`, byte-identical
      // to the pre-s7b write.
      if (FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION) {
        if (!deps.childRowConsolidator) {
          logger.error(
            { ipoId, table: 'ipo_valuation', pricingEvent },
            '[FilingPersister] ENABLE_CHILD_TABLE_CONSOLIDATION is on but no childRowConsolidator was injected — falling back to the unresolved write'
          );
          await markChildRowsUnresolved('ipo_valuation', 'no-consolidator-injected');
        } else {
          const valuationRowKey = ipoValuationRowKey(pricingEvent);
          if (valuationRowKey === null) {
            // Unreachable (`pricingEvent` is one of two string literals two
            // lines up), which is exactly why it is not assumed: `ipo_valuation`
            // is NOT a singleton table, so a keyless row filed under '' would
            // merge the price-band advertisement's provenance with the
            // prospectus's.
            skippedFailedCheck.push('ipo_valuation (no row key — not written)');
            w = {};
          } else {
            let resolved: ConsolidatedChildRowsResult | undefined;
            try {
              resolved = await deps.childRowConsolidator.consolidatedUpsertChildRows(
                ipoId,
                'ipo_valuation',
                [{ rowKey: valuationRowKey, data: valuationWritable }],
                source,
                options.docType
              );
            } catch (error) {
              // `w` is left as `valuationWritable` — exactly what the
              // no-consolidator fallback leaves it as — so the row is still
              // WRITTEN, unresolved, and the persist carries on.
              await noteConsolidationThrew('ipo_valuation', error, {
                table: 'ipo_valuation',
                pricingEvent,
              });
            }
            const decided = resolved?.rows[0];
            if (resolved === undefined) {
              // The throw was handled above; keep the filtered payload.
            } else if (decided && decided.skipped) {
              skippedFailedCheck.push(
                `ipo_valuation (consolidation skipped: ${decided.skipReason})`
              );
              await markChildRowsUnresolved(
                'ipo_valuation',
                `consolidation-skipped: ${decided.skipReason}`
              );
              w = {};
            } else {
              const out: Record<string, unknown> = {};
              for (const col of Object.keys(valuationWritable)) {
                const v = (decided?.consolidatedData ?? {})[col];
                if (v === undefined) continue;
                out[col] = v;
              }
              w = out;
            }
          }
        }
      }
      const num_ = (col: string): Record<string, string | null> =>
        col in w ? { [col]: asNumeric(w[col]) } : {};
      const count_ = (col: string): Record<string, number | null> =>
        col in w ? { [col]: asCount(w[col]) } : {};
      // A consolidation skip empties `w`. Writing the row anyway would insert
      // an identity-only ipo_valuation row (ipoId + pricingEvent and nothing
      // else) that reads as "we priced this offer and every number was null" —
      // strictly worse than no row. The rest of the persister (promoters,
      // peers, ...) must still run, so this withholds the WRITE, not the run.
      if (Object.keys(w).length > 0) {
      await deps.ipoValuation.upsert({
        ipoId,
        pricingEvent,
        ...num_('priceFloor'),
        ...num_('priceCap'),
        ...count_('sharesAtFloor'),
        ...count_('sharesAtCap'),
        ...count_('freshSharesAtFloor'),
        ...count_('freshSharesAtCap'),
        ...count_('ofsShares'),
        ...count_('totalSharesAtFloor'),
        ...count_('totalSharesAtCap'),
        ...num_('mcapAtFloor'),
        ...num_('mcapAtCap'),
        ...num_('peAtFloor'),
        ...num_('peAtCap'),
        peNotAscertainableReason: null,
        ...num_('ronwWeighted3y'),
        ...num_('faceValueMultipleFloor'),
        ...num_('faceValueMultipleCap'),
      } as never);
      await trackField('ipo_valuation', pricingEvent);
      }
    }
    bump(written, 'ipo_valuation', 1);
  }

  // ----------------------------------------------------------- 5. promoters
  const sellers = list<{ name?: string; shares_offered?: number; waca?: number }>(
    extraction,
    'promoter_selling_shareholders'
  );
  const wacaByName = new Map<string, number>();
  for (const s of sellers) {
    if (s?.name && typeof s.waca === 'number') wacaByName.set(s.name, s.waca);
  }
  const soloWaca = num(extraction, 'promoter_waca');
  const promoterNames = list<string>(extraction, 'promoter_names');
  const names =
    promoterNames.length > 0
      ? promoterNames
      : ([str(extraction, 'promoter_name')].filter(Boolean) as string[]);

  const namesWithKeys = names
    .map((name) => ({ name, key: rowKeyForName(name) }))
    .filter(({ name, key }) => {
      if (key === null) {
        logger.warn(
          { ipoId, table: 'promoters', name },
          'skipping promoter row: name has no identity (empty/whitespace-only)'
        );
        return false;
      }
      return true;
    });

  if (namesWithKeys.length > 0) {
    const rows: PromoterInsert[] = namesWithKeys.map(({ name, key }) => ({
      ipoId,
      name,
      // Item 1 slice s1 (row-key prep, F-74): the future row key
      // (docs/design/build-cards/item-01-child-table-consolidated-writer.md).
      normalizedName: key as string,
      // promoter_shares_held is the AGGREGATE promoter holding; assigning it to
      // one named promoter would invent a per-person figure the ad never
      // printed. Left null; the aggregate goes to ipo_details.promoter_shares_held
      // (W-88, migration 0049).
      sharesHeld: null,
      waca:
        (wacaByName.get(name) ?? (names.length === 1 ? soloWaca : null))?.toString() ?? null,
      wacaLastYear: null,
      isPromoterGroup: false,
    }));
    // isPromoterGroup is this module's default and sharesHeld is never per-person: not printed.
    rows.forEach((row, i) =>
      childReceipts('promoters', namesWithKeys[i].key, row as unknown as Record<string, unknown>, ['name', 'waca'])
    );
    if (await replaceAllowed('promoters', { name: null, sharesHeld: null, waca: null })) {
      if (apply) {
        // Item 1 slice s7a. Row key = `rowKeyForName(name)`, matching
        // `unique_promoters_ipo_id_normalized_name` on (ipo_id, normalized_name).
        // `name` is provenanced but never merged back — it IS the key.
        await consolidateChildRows(
          'promoters',
          rows.map((row, i) => ({
            rowKey: namesWithKeys[i].key as string,
            row: row as unknown as Record<string, unknown>,
          })),
          ['name', 'sharesHeld', 'waca', 'wacaLastYear', 'isPromoterGroup'],
          ['sharesHeld', 'waca', 'wacaLastYear', 'isPromoterGroup']
        );
        await deps.promoters.replacePromoters(ipoId, rows);
        await trackField('promoters', 'rows');
        await resolveEmptySection('promoters');
      }
      bump(written, 'promoters', rows.length);
    }
  } else {
    await recordEmptySection('promoters', ['promoter_names', 'promoter_name']);
  }

  // --------------------------- 6. promoter_acquisition_ranges (1Y/18M/3Y)
  //
  // W-73: round 1 wrote the 3Y row only, and wrote it with NO field-protection
  // gate — an admin-corrected WACA was deleted by the replace. Both fixed here:
  // every period the `acquisition_period` enum defines is mapped, and the whole
  // set goes through `replaceAllowed` exactly like `promoters`.
  //
  // priceLow/priceHigh stay null: the extractor prints no per-period price
  // range today (only the aggregate band, which is an `ipos` field). The
  // columns exist; nothing in the document fills them, and inventing a range
  // from the band would publish a figure the filing never printed.
  const ACQUISITION_PERIODS: Array<{
    period: '1Y' | '18M' | '3Y';
    wacaField: string;
    capField: string;
  }> = [
    { period: '1Y', wacaField: 'waca_last_1y', capField: 'cap_multiple_last_1y' },
    { period: '18M', wacaField: 'waca_last_18m', capField: 'cap_multiple_last_18m' },
    { period: '3Y', wacaField: 'waca_last_3y', capField: 'cap_multiple_last_3y' },
  ];
  const acquisitionRows: PromoterAcquisitionRangeInsert[] = [];
  for (const spec of ACQUISITION_PERIODS) {
    const waca = num(extraction, spec.wacaField);
    const capMultiple = num(extraction, spec.capField);
    if (waca === null && capMultiple === null) continue;
    acquisitionRows.push({
      ipoId,
      period: spec.period,
      waca: waca?.toString() ?? null,
      capMultiple: capMultiple?.toString() ?? null,
      priceLow: null,
      priceHigh: null,
    });
  }
  for (const row of acquisitionRows) {
    // Row identity = the period (unique on ipo_id, period).
    childReceipts('promoter_acquisition_ranges', row.period, row as unknown as Record<string, unknown>, [
      'period',
      'waca',
      'capMultiple',
    ], ACQUISITION_PERIOD_FIELDS[row.period] ?? []);
  }
  if (acquisitionRows.length > 0) {
    if (
      await replaceAllowed('promoter_acquisition_ranges', {
        period: null,
        waca: null,
        capMultiple: null,
        priceLow: null,
        priceHigh: null,
      })
    ) {
      if (apply) {
        await deps.promoters.replaceAcquisitionRanges(ipoId, acquisitionRows);
        await trackField('promoter_acquisition_ranges', 'rows');
      }
      bump(written, 'promoter_acquisition_ranges', acquisitionRows.length);
    }
  }

  // ------------------------------------------------- 6b. ipo_risk_factors
  //
  // The numbered RISK FACTORS chapter (extractor E8, `risk_factors`). Whole-set
  // replace per IPO, like `promoters`.
  //
  // Item 1 slice s6: this path no longer decides identity. It preserves the
  // extractor's ORDER and nothing else — `IpoRiskFactorsRepository.
  // replaceForIpo` derives `headingHash` (the row key), drops duplicates and
  // re-derives `seq` from the surviving order, so there is exactly one place
  // that can mint a risk factor's identity. The extractor's own `n`/`seq` is
  // deliberately not carried through: it is a printed number that shifts
  // between the ad and the final prospectus.
  const riskItems = list<{
    n?: number;
    seq?: number;
    heading?: string;
    body?: string | null;
    kpis?: unknown;
  }>(extraction, 'risk_factors');
  const riskRows: IpoRiskFactorInsert[] = [];
  for (const item of riskItems) {
    const heading = typeof item?.heading === 'string' ? item.heading.trim() : '';
    // heading is NOT NULL in the schema; a row without one is not a risk factor.
    if (heading === '') continue;
    riskRows.push({
      ipoId,
      // KNOWN LIMITATION (item 1 slice s6, Tier A review 2026-09-10): the
      // heading is truncated to the column's 500 chars BEFORE
      // `headingHashForRiskFactor` sees it, so two risk factors whose headings
      // share their first 500 characters collapse to one row key and the second
      // is dropped as a duplicate. Real risk-factor headings are one line, so
      // this has never fired; recorded rather than changed because hashing the
      // untruncated heading would re-key every existing row - a migration, not
      // a one-line edit.
      heading: heading.slice(0, 500),
      body: typeof item?.body === 'string' && item.body.trim() !== '' ? item.body : null,
      kpis: item?.kpis ?? null,
    });
  }
  // W-82: `concentration_kpis` is a flat list of {label, value_pct}. The only
  // column in the schema that can hold it is `ipo_risk_factors.kpis` — jsonb ON
  // a risk-factor row — so a KPI is storable only when this same run is writing
  // the risk factor whose heading names it. The match is a literal
  // case-insensitive containment of the KPI's label in the heading: anything
  // looser would file a percentage under a risk it does not describe. A row that
  // already carries its own kpis is left alone (the extractor's per-risk object
  // is the better-scoped value), and every unattached label is reported.
  const concentrationKpis = list<{ label?: string; value_pct?: number }>(
    extraction,
    'concentration_kpis'
  );
  if (concentrationKpis.length > 0) {
    const unattached: string[] = [];
    for (const kpi of concentrationKpis) {
      const label = typeof kpi?.label === 'string' ? kpi.label.trim() : '';
      if (label === '') continue;
      const needle = label.toLowerCase();
      const target = riskRows.find(
        (r) => r.heading.toLowerCase().includes(needle) && (r.kpis === null || r.kpis === undefined)
      );
      if (!target) {
        unattached.push(label);
        continue;
      }
      target.kpis = [kpi];
    }
    if (unattached.length > 0) {
      skippedNoColumn.push(
        `concentration_kpis (ipo_risk_factors.kpis is per-risk-factor jsonb; no free risk-factor ` +
          `heading in this filing names: ${unattached.join(', ')})`
      );
    }
  }

  // Row key = headingHashForRiskFactor(heading), first-wins like the repository; seq is the
  // repository's display order, not a printed value.
  const riskKeysSeen = new Set<string>();
  for (const row of riskRows) {
    const key = headingHashForRiskFactor(row.heading);
    if (key === null || riskKeysSeen.has(key)) continue;
    riskKeysSeen.add(key);
    childReceipts('ipo_risk_factors', key, row as unknown as Record<string, unknown>, ['heading', 'body', 'kpis']);
  }
  if (riskRows.length > 0) {
    if (!deps.riskFactors) {
      skippedNoColumn.push(
        `risk_factors (${riskRows.length} rows: no ipo_risk_factors repository wired into this run)`
      );
    } else if (
      await replaceAllowed('ipo_risk_factors', {
        seq: null,
        heading: null,
        headingHash: null,
        body: null,
        kpis: null,
      })
    ) {
      if (apply) {
        // Item 1 slice s7a. Row key = `headingHashForRiskFactor(heading)`,
        // matching `unique_ipo_risk_factors_ipo_heading_hash` — NOT `seq`,
        // which slice s6 demoted to display order. The hash is taken over the
        // ALREADY-TRUNCATED heading, exactly as the repository takes it, so the
        // audit key and the written key cannot disagree. First-wins on a
        // duplicate key mirrors `prepareRiskFactorRows`.
        await consolidateChildRows(
          'ipo_risk_factors',
          riskRows
            .map((row) => ({
              rowKey: headingHashForRiskFactor(row.heading),
              row: row as unknown as Record<string, unknown>,
            }))
            .filter((e): e is { rowKey: string; row: Record<string, unknown> } => e.rowKey !== null),
          ['heading', 'body', 'kpis'],
          ['body', 'kpis'],
          'first'
        );
        await deps.riskFactors.replaceForIpo(ipoId, riskRows);
        await trackField('ipo_risk_factors', 'rows');
      }
      bump(written, 'ipo_risk_factors', riskRows.length);
    }
  }

  // -------------------------------------------- 6c. documents.filing_date
  //
  // `rhp_filing_date` is the date the RHP was filed with the RoC. BOTH doc
  // types print it (the price-band ad states it on its face), so the row this
  // updates is always the IPO's RHP document — never "the document currently
  // being persisted", which for an ad would stamp the ad's row with the RHP's
  // date. UPDATE only: a documents row is created by the discovery runner with
  // a URL and a sha256, neither of which an extraction carries.
  const rhpFilingDate = toIsoOrUndefined(trusted(extraction, 'rhp_filing_date'));
  if (rhpFilingDate !== undefined) {
    receiptFields.push(receipt('documents', 'filingDate', rhpFilingDate));
    const documentsWritable = await filterFields('documents', { filingDate: rhpFilingDate });
    if ('filingDate' in documentsWritable) {
      if (!deps.documentFilingDateWriter) {
        skippedNoColumn.push(
          'rhp_filing_date (no documents filing-date writer wired into this run)'
        );
      } else {
        let updatedRows = 1;
        if (apply) {
          updatedRows = await deps.documentFilingDateWriter.setFilingDate({
            ipoId,
            docType: 'RHP',
            filingDate: rhpFilingDate,
          });
          if (updatedRows > 0) await trackField('documents', 'filingDate');
        }
        if (updatedRows > 0) bump(written, 'documents', updatedRows);
        else skippedNoColumn.push('rhp_filing_date (no stored RHP documents row to update)');
      }
    }
  }

  // ------------------------------------------------- 7. ipo_intermediaries
  const trackRows = list<{ brlm?: string; issues_3y?: number; closed_below?: number }>(
    extraction,
    'brlm_track_record'
  );
  // Item 39 (row 114): the BRLM rows reconcile with ipos.lead_managers, so they are built from the
  // value the column HOLDS after this run: the one written above (iposWritable, after the admin
  // gate, OD-96 and OD-97), else the stored one (PR #1460 round 1 MAJOR-2). The document's own INM
  // number (one BRLM) and the registrar's contact lines are filed only when the document's read IS
  // that value - never pinned onto a list another source or the admin chose.
  const docBrlms = coverLeadManagers(extraction);
  const heldBrlms = (iposWritable.leadManagers as string[] | undefined) ?? existing.leadManagers ?? [];
  const brlmNames = heldBrlms.filter((n): n is string => !!n);
  const docBrlmsHeld =
    docBrlms !== null && normalizeReceiptValue(docBrlms) === normalizeReceiptValue(brlmNames);
  const soleBrlmReg = docBrlmsHeld && brlmNames.length === 1 ? str(extraction, 'lead_manager_sebi_reg') : null;
  // Item 1 slice s1 (row-key prep, F-74): built without `normalizedName`
  // here — every entry (the initial map, and each subsequent push below)
  // carries only a bare `name`; `normalizedName` is derived once, uniformly,
  // right before the write (see the map() at the replaceForIpo call site
  // below) so a future push site can never forget to set it by hand.
  const intermediaries: Omit<IpoIntermediaryInsert, 'normalizedName'>[] = brlmNames.map((name) => ({
    ipoId,
    role: 'BRLM',
    name,
    // The extractor emits SEBI registration numbers as a bare LIST with no
    // name->reg mapping. Pairing them positionally against a differently
    // sourced BRLM name list would publish a registration number against the
    // wrong firm - left null, and the list is reported as skipped. One BRLM read
    // from the document with its own INM number is unambiguous (item 39).
    sebiRegNo: soleBrlmReg,
    contactPerson: null,
    phone: null,
    email: null,
    grievanceEmail: null,
  }));
  const registrarReg = str(extraction, 'registrar_sebi_reg');
  const docRegistrarName = coverRegistrar(extraction);
  const registrarName = (iposWritable.registrar as string | undefined) ?? existing.registrar;
  if (registrarName) {
    // Item 39: the contact lines belong to the registrar the document named; they are filed
    // only when the column holds that name, never on a stored name from another source.
    const own = docRegistrarName !== null && docRegistrarName.trim() === String(registrarName).trim();
    intermediaries.push({
      ipoId,
      role: 'REGISTRAR',
      name: registrarName,
      // Exactly one registrar and exactly one registrar reg number: unambiguous.
      sebiRegNo: registrarReg,
      contactPerson: own ? str(extraction, 'registrar_contact_person') : null,
      phone: own ? str(extraction, 'registrar_phone') : null,
      email: own ? str(extraction, 'registrar_email') : null,
      grievanceEmail: null,
    });
  }
  if (list<string>(extraction, 'brlm_sebi_regs').length > 0) {
    skippedNoColumn.push('brlm_sebi_regs (no name->registration mapping in the extraction)');
  }
  // W-74/W-76: the price band advertisement names a lead Syndicate Member and
  // a sub-syndicate broker list. `intermediary_role` now carries both
  // SYNDICATE and SUB_SYNDICATE, so every named member is filed under its own
  // role.
  const syndicate = list<{ name?: string; role?: string }>(extraction, 'syndicate_members');
  for (const member of syndicate) {
    if ((member.role !== 'SYNDICATE' && member.role !== 'SUB_SYNDICATE') || !member.name) {
      continue;
    }
    intermediaries.push({
      ipoId,
      role: member.role,
      name: member.name,
      sebiRegNo: null,
      contactPerson: null,
      phone: null,
      email: null,
      grievanceEmail: null,
    });
  }
  // W-88 E6: the advertisement's sponsor / escrow-collection / public-issue
  // account banks. `intermediary_role` carries all three; the REFUND bank the
  // same line names has no enum member, so the extractor does not emit it.
  const banks = list<{ name?: string; role?: string }>(extraction, 'issue_banks');
  const BANK_ROLES = ['SPONSOR_BANK', 'ESCROW_BANK', 'PUBLIC_ISSUE_BANK'] as const;
  for (const bank of banks) {
    const role = BANK_ROLES.find((r) => r === bank.role);
    if (!role || !bank.name) continue;
    intermediaries.push({
      ipoId,
      role,
      name: bank.name,
      sebiRegNo: null,
      contactPerson: null,
      phone: null,
      email: null,
      grievanceEmail: null,
    });
  }

  const intermediariesWithKeys = intermediaries
    .map((row) => ({ row, key: rowKeyForName(row.name) }))
    .filter(({ row, key }) => {
      if (key === null) {
        logger.warn(
          { ipoId, table: 'ipo_intermediaries', role: row.role, name: row.name },
          'skipping ipo_intermediaries row: name has no identity (empty/whitespace-only)'
        );
        return false;
      }
      return true;
    });

  // A BRLM / REGISTRAR row is built from the value the column HOLDS (item 39), which can be another
  // source's; this document's record names it only when the document's own read IS that value
  // (OD-91: "the fields it produced").
  const registrarReadIsHeld =
    docRegistrarName !== null && !!registrarName && docRegistrarName.trim() === String(registrarName).trim();
  for (const { row, key } of intermediariesWithKeys) {
    if (row.role === 'BRLM' && !docBrlmsHeld) continue;
    if (row.role === 'REGISTRAR' && !registrarReadIsHeld) continue;
    childReceipts('ipo_intermediaries', `${row.role}:${key as string}`, row as unknown as Record<string, unknown>, [
      'name',
      'role',
      'sebiRegNo',
      'contactPerson',
      'phone',
      'email',
      'grievanceEmail',
    ], INTERMEDIARY_ROLE_FIELDS[row.role as string] ?? []);
  }
  if (intermediariesWithKeys.length > 0) {
    if (
      await replaceAllowed('ipo_intermediaries', { name: null, role: null, sebiRegNo: null })
    ) {
      if (apply) {
        const intermediariesWithKey: IpoIntermediaryInsert[] = intermediariesWithKeys.map(
          ({ row, key }) => ({
            ...row,
            normalizedName: key as string,
          })
        );
        // Item 1 slice s7a. Row key = `role:rowKeyForName(name)`, matching
        // `unique_ipo_intermediaries_ipo_id_role_normalized_name`. Role alone
        // collides — a mainboard issue carries several BRLMs under one role —
        // so dropping it from the key would file every BRLM's provenance on one
        // row. Both key halves are provenanced and neither is merged back.
        await consolidateChildRows(
          'ipo_intermediaries',
          intermediariesWithKey.map((row, i) => ({
            rowKey: `${row.role}:${intermediariesWithKeys[i].key as string}`,
            row: row as unknown as Record<string, unknown>,
          })),
          ['name', 'role', 'sebiRegNo', 'contactPerson', 'phone', 'email', 'grievanceEmail'],
          ['sebiRegNo', 'contactPerson', 'phone', 'email', 'grievanceEmail']
        );
        await deps.intermediaries.replaceForIpo(ipoId, intermediariesWithKey);
        await trackField('ipo_intermediaries', 'rows');
      }
      bump(written, 'ipo_intermediaries', intermediariesWithKeys.length);
    }
  }

  // -------------------------------------------------- 8. brlm_track_record
  const asOfDate = str(extraction, 'rhp_filing_date');
  const brlmAllowed = await replaceAllowed('brlm_track_record', {
    brlmName: null,
    issues3y: null,
    closedBelowIssuePrice: null,
  });
  if (asOfDate) {
    for (const row of trackRows) {
      if (!row?.brlm) continue;
      const nameKey = rowKeyForName(row.brlm);
      childReceipts(
        'brlm_track_record',
        nameKey === null ? null : `${nameKey}:${asOfDate}`,
        {
          brlmName: row.brlm,
          asOfDate,
          issues3y: typeof row.issues_3y === 'number' ? row.issues_3y : null,
          closedBelowIssuePrice: typeof row.closed_below === 'number' ? row.closed_below : null,
        },
        ['brlmName', 'asOfDate', 'issues3y', 'closedBelowIssuePrice']
      );
    }
  }
  if (asOfDate && brlmAllowed) {
    let n = 0;
    for (const row of trackRows) {
      if (!row?.brlm) continue;
      if (apply && brlmAllowed) {
        await deps.brlmTrackRecord.upsert({
          brlmName: row.brlm,
          asOfDate,
          issues3y: typeof row.issues_3y === 'number' ? row.issues_3y : null,
          closedBelowIssuePrice: typeof row.closed_below === 'number' ? row.closed_below : null,
          sourceIpoId: ipoId,
        } as never);
      }
      n += 1;
    }
    if (n > 0) bump(written, 'brlm_track_record', n);
  } else if (trackRows.length > 0) {
    skippedFailedCheck.push('brlm_track_record: no trusted as-of date (rhp_filing_date)');
  }

  // ------------------------------------------------------ 9. peer_companies
  const peers = list<Record<string, unknown>>(extraction, 'peer_companies');
  if (peers.length === 0) await recordEmptySection('peer_companies', ['peer_companies']);
  if (peers.length > 0) {
    const peerRows = peers
      .filter((p) => typeof p.name === 'string' && (p.name as string).trim() !== '')
      // Spreading a bare `Record<string, unknown>` (no named properties) drops
      // its index signature in the inferred type, leaving only the two added
      // keys visible below — a TS inference quirk, not a runtime change. The
      // cast restores the original record's fields for the final `.map`.
      .map(
        (p) =>
          ({ ...p, companyName: (p.name as string).trim(), key: rowKeyForName((p.name as string).trim()) }) as Record<
            string,
            unknown
          > & { companyName: string; key: string | null }
      )
      .filter((p) => {
        if (p.key === null) {
          logger.warn(
            { ipoId, table: 'peer_companies', name: p.companyName },
            'skipping peer_companies row: name has no identity (empty/whitespace-only)'
          );
          return false;
        }
        return true;
      })
      .map((p) => {
        // #1165: the table reader returns printed text ('1,19,694.32', '22.85%',
        // '(3.45)'); parsePrintedNumber is the one place it becomes a number. A
        // combined "EPS (basic and diluted)" column fills both EPS columns, and a
        // P/E printed as "P/E (basic)" is the peer's P/E when no bare P/E column exists.
        const fig = (col: string, ...keys: string[]): string | null => {
          for (const k of keys) {
            const parsed = parsePrintedNumber(p[k]);
            if (parsed.value !== null) return parsed.value;
            if (parsed.reason === 'unparseable') {
              skippedFailedCheck.push(`peer_companies.${col} unparseable '${String(parsed.printed)}' (${p.companyName})`);
              logger.warn(
                { ipoId, table: 'peer_companies', peer: p.companyName, column: col, printed: parsed.printed },
                '[FilingPersister] peer figure printed in a form that does not parse; stored as null'
              );
              return null;
            }
          }
          return null;
        };
        return {
        ipoId,
        companyName: p.companyName,
        // Item 1 slice s1 (row-key prep, F-74): the future row key.
        normalizedName: p.key as string,
        // #545 round 2: the row's own group when the document states it
        // (`Listed Peers` / `Unlisted Peers`); undefined when it does not (a
        // combined `Listed and unlisted Peers` divider, or the ad, which
        // carries no group). Undefined keeps the stored value, else true: the
        // ICDR basis-for-price comparison is of LISTED industry peers.
        isListed: typeof p.is_listed === 'boolean' ? p.is_listed : undefined,
        peRatio: fig('peRatio', 'pe', 'pe_basic'),
        eps: fig('eps', 'eps_basic', 'eps_basic_and_diluted'),
        dilutedEps: fig('dilutedEps', 'eps_diluted', 'eps_basic_and_diluted'),
        ronw: fig('ronw', 'ronw_pct'),
        nav: fig('nav', 'nav'),
        pbvRatio: fig('pbvRatio', 'pb'),
        dataSource: source,
        // OD-156: the real document type; data_source is 'DRHP' for every document.
        sourceDocumentType: options.docType,
        lastUpdated: new Date(),
        };
      });
    // #545 round 2: a peer set that carries NO figure at all (the prospectus
    // text path reads names only) is not a replacement for a stored set. It
    // only fills gaps: rows another source stored - Chittorgarh's, with their
    // ratios - are left exactly as they are, and only unseen peers are added.
    // A set WITH figures replaces as before (DRHP outranks CHITTORGARH for
    // peer_companies in field-priority-matrix.ts), but a null in it never
    // erases a stored non-null value for the same peer.
    const nameOnly = peerRows.every((row) =>
      PEER_VALUE_COLUMNS.every((col) => row[col] === null || row[col] === undefined)
    );
    for (const row of peerRows) {
      childReceipts('peer_companies', row.normalizedName, row as unknown as Record<string, unknown>, [
        'companyName',
        'isListed',
        'peRatio',
        'eps',
        'dilutedEps',
        'ronw',
        'nav',
        'pbvRatio',
      ]);
    }
    if (peerRows.length > 0) {
      if (
        await replaceAllowed('peer_companies', {
          companyName: null,
          peRatio: null,
          eps: null,
          ronw: null,
          nav: null,
        })
      ) {
        if (apply) {
          // Item 1 slice s7a. Row key = `rowKeyForName(companyName)`, matching
          // `unique_peer_companies_ipo_id_normalized_name`. `dataSource` and
          // `lastUpdated` are write metadata, not facts about the peer, so they
          // are neither provenanced nor resolvable. Last-wins on a duplicate key
          // mirrors `PeerCompanyRepository.replaceForIpo`.
          // Provenance is filed only for what the document PRINTED: a column
          // it left empty is not a DOC claim of null, so it is dropped from the
          // claim rather than offered to the consolidator as a value.
          // #1166 (2): a names-only set never touches a stored row (fillGapsOnly
          // below inserts unseen keys only), so filing DOC provenance for a row
          // it leaves alone would make field_sources say DOC while the row still
          // holds another source's (Chittorgarh's) value. Claim only the keys the
          // repository will actually insert.
          const storedKeys =
            nameOnly && deps.peerCompanies.findByIPOId
              ? new Set((await deps.peerCompanies.findByIPOId(ipoId)).map((r) => r.normalizedName))
              : new Set<string>();
          const claims = peerRows.filter((row) => !storedKeys.has(row.normalizedName)).map((row) => ({
            rowKey: row.normalizedName,
            row: Object.fromEntries(
              Object.entries(row).filter(([, v]) => v !== null && v !== undefined)
            ) as Record<string, unknown>,
          }));
          await consolidateChildRows(
            'peer_companies',
            claims,
            ['companyName', 'isListed', 'peRatio', 'eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio'],
            ['isListed', 'peRatio', 'eps', 'dilutedEps', 'ronw', 'nav', 'pbvRatio']
          );
          const rowByKey = new Map(peerRows.map((row) => [row.normalizedName, row as Record<string, unknown>]));
          for (const claim of claims) {
            const target = rowByKey.get(claim.rowKey);
            if (!target) continue;
            for (const col of ['isListed', ...PEER_VALUE_COLUMNS] as const) {
              const v = claim.row[col];
              if (v !== null && v !== undefined) target[col] = v;
            }
          }
          await deps.peerCompanies.replaceForIpo(ipoId, peerRows as never, {
            nullNeverOverwrites: true,
            fillGapsOnly: nameOnly,
            documentType: options.docType,
            replacedBy: `the ${options.docType} peer list (document ${options.documentId ?? 'unknown'})`,
          });
          await trackField('peer_companies', 'rows');
          await resolveEmptySection('peer_companies');
        }
        bump(written, 'peer_companies', peerRows.length);
      }
      for (const col of ['face_value', 'closing_price', 'revenue_from_operations', 'market_cap']) {
        skippedNoColumn.push(`peer_companies.${col} (no column on peer_companies)`);
      }
    }
  }

  // ----------------------------------------------------- 10. financial_data
  // The six-metric backfill's target table, folded in here so one command
  // persists a filing end to end (backfill-financials-pdf.ts remains the path
  // for IPOs with no filing extraction). financial_data is denominated in INR
  // CRORE and has FY2022/23/24 slots only - a filing reporting FY2025/FY2026
  // has nowhere to put those years (W-09 inventory gap).
  const latestFy = [...fyKeys].map(Number).filter(Number.isInteger).sort((a, b) => b - a)[0];
  const fd: Record<string, unknown> = { ipoId };
  let fdFields = 0;
  const putCrore = (col: string, m: Record<string, number>, fy: number): void => {
    const v = m[String(fy)];
    if (v === undefined) return;
    const c = withUnit(`financial_data.${col}`, (u) => round2(toCrore(v, u)));
    if (c === null) return;
    fd[col] = c.toString();
    fdFields += 1;
  };
  for (const fy of [2022, 2023, 2024]) {
    putCrore(`revenueFy${fy}`, revenueW, fy);
    putCrore(`profitFy${fy}`, patW, fy);
    putCrore(`ebitdaFy${fy}`, ebitdaW, fy);
    putCrore(`totalIncomeFy${fy}`, totalIncomeW, fy);
  }
  for (const fy of [...fyKeys].map(Number).filter((f) => f > 2024)) {
    skippedNoColumn.push(`financial_data FY${fy} (columns exist only for FY2022-FY2024)`);
  }
  if (latestFy !== undefined) {
    const lk = String(latestFy);
    if (netWorthW[lk] !== undefined) {
      const nw = withUnit('financial_data.netWorth', (u) => round2(toCrore(netWorthW[lk], u)));
      if (nw !== null) {
        fd.netWorth = nw.toString();
        fdFields += 1;
      }
    }
    if (epsBasicW[lk] !== undefined) {
      fd.eps = round2(epsBasicW[lk]).toString(); // per-share: never unit-scaled
      fdFields += 1;
    }
    const ronw = byFy(extraction, 'ronw_by_fy');
    if (ronw[lk] !== undefined) {
      fd.ronw = round2(ronw[lk]).toString();
      fdFields += 1;
    }
  }
  // Item 8 slice 3a. The three issuer ratios: two READ from the issuer's own
  // Schedule III note, one DERIVED (quick ratio - nobody prints it). They are
  // plain unitless ratios, so unlike netWorth/marketCap they need no
  // `withUnit`/`toCrore` scaling; they take the same round2().toString() shape
  // as ronw and peRatio so the numeric(5,2) columns receive what they expect.
  // #1420 round 3: the two READ ratios take their field from the one map; quick ratio is derived
  // (OD-160) and is not on it.
  for (const [field, column] of [
    [mappedField('financial_data', 'currentRatio'), 'currentRatio'],
    ['quick_ratio', 'quickRatio'],
    [mappedField('financial_data', 'inventoryTurnover'), 'inventoryTurnover'],
  ] as const) {
    const value = num(extraction, field);
    if (value !== null) {
      const rounded = round2(value);
      // financial_data.currentRatio/quickRatio/inventoryTurnover are
      // numeric(5,2) (schema.ts:567-569) - max magnitude 999.99. A printed
      // ratio at/above 1000 (or a mis-read digit) throws a Postgres numeric
      // overflow at insert and aborts the whole financial_data write for
      // this document, taking the other two ratios and every other
      // financial_data field down with it. Skip only the offending field.
      if (!Number.isFinite(rounded) || Math.abs(rounded) > 999.99) {
        skippedNoColumn.push(
          `${field} (ratio_out_of_numeric_range:${column}=${rounded})`
        );
      } else {
        (fd as Record<string, unknown>)[column] = rounded.toString();
        fdFields += 1;
      }
    }
  }

  const peCap = num(extraction, mappedField('financial_data', 'peRatio'));
  if (peCap !== null) {
    fd.peRatio = peCap.toString();
    fdFields += 1;
  }
  if (mcapCapMn !== null) {
    // F7 UNIT CONTRACT: CRORE here, rupees in ipo_valuation.mcap_at_cap.
    const mc = withUnit('financial_data.marketCap', (u) => round2(toCrore(mcapCapMn, u)));
    if (mc !== null) {
      fd.marketCap = mc.toString();
      fdFields += 1;
    }
  }
  const preHold = num(extraction, mappedField('financial_data', 'promoterHoldingPreIssue'));
  if (preHold !== null) {
    fd.promoterHoldingPreIssue = preHold.toString();
    fdFields += 1;
  }
  const postHold = num(extraction, mappedField('financial_data', 'promoterHoldingPostIssue'));
  if (postHold !== null) {
    fd.promoterHoldingPostIssue = postHold.toString();
    fdFields += 1;
  }
  if (fdFields > 0) {
    // financial_data is the table the admin editor protects field-by-field
    // (ronw, eps, marketCap ...), so an admin correction must survive a filing.
    const { ipoId: _fdIpoId, ...fdFieldsOnly } = fd as Record<string, unknown>;
    // F-241: financial_data is one row per IPO, so its record is keyed '' like ipos/ipo_details.
    for (const [col, value] of Object.entries(fdFieldsOnly)) receiptFields.push(receipt('financial_data', col, value));
    const fdWritable = await filterFields('financial_data', fdFieldsOnly);
    if (Object.keys(fdWritable).length === 0) {
      skippedProtected.push('financial_data (every field protected)');
    } else {
      if (apply) {
        await deps.financialData.upsert({ ipoId, ...fdWritable } as never);
        for (const col of Object.keys(fdWritable)) await trackField('financial_data', col);
      }
      bump(written, 'financial_data', 1);
    }
  }

  // ------------------------------------------------- unmapped-but-extracted
  for (const [field, reason] of Object.entries(NO_COLUMN_FIELDS)) {
    if (trusted(extraction, field) !== null) skippedNoColumn.push(`${field} (${reason})`);
  }

  if (unresolvedChildRows.length > 0) {
    // The rows are NAMED, not counted: a bare `unresolved: 4` is unreadable and
    // - condition 2 of the s7a review - these rows have NO `field_sources` entry
    // at all, so this line is the only place they surface until the nightly
    // q_field_sources_row_key_coverage check sees the missing keys.
    logger.warn(
      {
        ipoId,
        company: existing?.companyName ?? null,
        docType: options.docType,
        unresolvedChildRows,
      },
      '[FilingPersister] child rows written WITHOUT per-row provenance'
    );
  }
  let rereadAnswers: RereadClearResult | undefined;
  let rereadAnswersError: string | undefined;
  if (apply && deps.rereadAnswerDb) {
    // #1420 round 3: the ordinary writes above are already committed. A failed clear rolls back only
    // its own transaction (every stored value is KEPT, the safe direction); it must not turn a
    // persisted document into a persist failure, which would skip the cache invalidation of the
    // writes that did land. It is classified here and returned, never swallowed.
    try {
      rereadAnswers = await clearRereadAnswers(deps.rereadAnswerDb, {
        ipoId,
        docType: options.docType,
        documentId: options.documentId ?? null,
        sourceSha: options.sourceSha ?? null,
        extractorVersion: options.extractorVersion ?? null,
        fields: (extraction.fields ?? {}) as never,
        heldBack,
      });
    } catch (error) {
      const cause = error instanceof Error ? (error.cause as { message?: string; code?: string } | undefined) : undefined;
      const message = error instanceof Error ? error.message : String(error);
      rereadAnswersError = `REREAD_CLEAR_FAILED: ${message}${cause?.message ? ` (cause: ${cause.message})` : ''}`;
      logger.error(
        { ipoId, docType: options.docType, documentId: options.documentId ?? null, errorClass: 'REREAD_CLEAR_FAILED', error: message, cause: cause?.message, code: cause?.code ?? (error as { code?: string }).code },
        '[FilingPersister] #1420 re-read answer clear failed; stored values kept, the document stays persisted'
      );
    }
  }
  logger.info(
    { ipoId, docType: options.docType, apply, written },
    '[FilingPersister] filing extraction persisted'
  );

  return {
    written,
    skipped_failed_check: skippedFailedCheck.sort(),
    unresolved_child_rows: [...unresolvedChildRows].sort(),
    marker_write_failed: getMarkerWriteFailures(),
    skipped_no_column: [...new Set(skippedNoColumn)].sort(),
    skipped_no_unit: [...new Set(skippedNoUnit)].sort(),
    skipped_lower_priority_source: [...new Set(skippedLowerPriority)].sort(),
    skipped_unit_mismatch: [...new Set(skippedUnitMismatch)].sort(),
    skipped_protected: [...new Set(skippedProtected)].sort(),
    skipped_out_of_family: [...new Set(skippedOutOfFamily)].sort(),
    skipped_cross_document_disagreement: [...new Set(skippedCrossDoc)].sort(),
    ipos_fields: iposFields,
    ...(planRebuildNote !== undefined ? { plan_rebuild: planRebuildNote } : {}),
    receipt_fields: receiptFields,
    ...(rereadAnswers !== undefined ? { reread_answers: rereadAnswers } : {}),
    ...(rereadAnswersError !== undefined ? { reread_answers_error: rereadAnswersError } : {}),
    fresh_ofs_reconciliation: {
      ok: reconciliation.ok,
      kind: reconciliation.kind,
      uncheckedReasons: reconciliation.uncheckedReasons,
      deltaPct: reconciliation.deltaPct,
      reason: reconciliation.reason,
    },
    applied: apply,
  };
}
