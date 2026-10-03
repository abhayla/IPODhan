/**
 * The DOC fetcher for the field-plan walk (item 6, rank 1 in every manifest
 * entry that has one) — design §2.4, ruling OD-33.
 *
 * OD-33: a document is never re-scraped. This fetcher does not open a PDF and
 * does not run the extractor a second time — item 1's filing-persister has
 * ALREADY read the document and written whatever it found, both to the data
 * column and to `field_sources` (the provenance row). This fetcher answers
 * from that provenance, exactly like a `SELECT`, never a fresh read of the
 * bytes (OD-6: verification is a read).
 *
 * THE THREE ANSWERS, IN THE ORDER THEY ARE DECIDED:
 *
 *  1. No COMPLETED document of the manifest's `documentType` family (the
 *     preferred type plus every offer document that can stand in for it,
 *     `DOC_TYPE_FAMILY`) exists yet for this IPO -> NOT_AVAILABLE_YET.
 *     The filing has not been filed/extracted, so the walk keeps re-asking.
 *
 *  2. A COMPLETED document of that family exists, but `field_sources` has no
 *     row for (ipoId, tableName, rowKey, fieldName) with `source: 'DRHP'`
 *     (every filing doc type — DRHP, RHP, PROSPECTUS, PRICE_BAND_AD — writes
 *     as `source: 'DRHP'`; see filing-persister.ts's SOURCE ENUM NOTE and
 *     `scraperSourceForDocType`) -> NOT_PRINTED. The document was read and
 *     this field simply is not in it (or, like `ipo_details.min_investment`,
 *     is a DERIVED value the persister never calls `trackField` for — same
 *     answer, same reason: no provenance row means "not sourced from a
 *     document field_sources tracks").
 *
 *  3. A provenance row exists -> SUPPLIED, with the CURRENT column value
 *     (read through the repositories, never raw SQL) and the evidence the
 *     provenance row already carries (documentId / documentType / sha256 /
 *     page) — echoing the document persistence already did, not inventing a
 *     second copy of it.
 */

import type { DocAdminListing, FieldFetcher, FieldFetcherAnswer, FieldFetcherContext } from './field-plan-walk.js';
import type { FieldSourcesRepository } from '@ipodhan/shared';
import type { IPORepository } from '@ipodhan/shared';
import type { DocumentRepository } from '@ipodhan/shared';
// `plan.fieldName` is the manifest's raw snake_case key (field-plan-generator.ts
// takes it verbatim from `table.field_name`); `field_sources.field_name` and
// every repository column are camelCase. Same helper filing-persister's own
// provenance reads use — see its doc comment ("field_sources.field_name is
// camelCase (listingDate, bseIpoNo), not the snake_case column name").
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { getTableColumns } from 'drizzle-orm';
import { ipos as iposTable, ipoDetails as ipoDetailsTable } from '@ipodhan/shared/db/schema';
import { bestPlanDocument, decidePlanRowSupersession, isFixedPriceIssue, type PlanDocumentRef } from './document-state-machine.js';
import { logger } from '../utils/logger.js';
import { DOC_TYPE_FAMILIES, docTypeFamily as sharedDocTypeFamily, familyForField, normalizeReceiptValue } from '../../config/plan-supersession-rule.mjs';
import { isStatedAbsenceReason } from '../config/stated-absence-reasons.js';
import { mapManifestSourceToScraperSource } from '../config/field-source-codes.js';
import { rereadSinceFor, versionAtLeast } from './filing-auto-persist.js';

/**
 * Which document-type family answers a manifest field's DOC rank, in
 * preference order. Spec §1: `DOC` = "the IPO's own offer document, best
 * available type" — the manifest's `documentType` names the PREFERRED type,
 * never the only one. Order per §1: price-dependent fields
 * PRICE_BAND_AD > RHP > PROSPECTUS > DRHP; final post-issue facts
 * PROSPECTUS > PRICE_BAND_AD > RHP > DRHP. (CORRIGENDUM sits in both §1 lists
 * but is not a type the extractor reads, so it cannot complete here.)
 *
 * Item 6 / F-161: PRICE_BAND_AD used to be `['PRICE_BAND_AD']` alone. SME
 * IPOs have no price-band ad at all (§1, measured: zero on production), so
 * 980 staging plan rows on 23 IPOs with a COMPLETED RHP/PROSPECTUS/DRHP
 * answered NOT_AVAILABLE_YET forever — e.g. axiom-gas-engineering-ltd
 * ipo_details.face_value, whose RHP provenance row already existed. The
 * unit test "every manifest documentType family contains every full offer
 * document" guards the class. A price-band ad joins only the families whose
 * fields it can print (price-dependent and final terms).
 */
export const DOC_TYPE_FAMILY: Readonly<Record<string, ReadonlyArray<string>>> = DOC_TYPE_FAMILIES;

/**
 * The document types whose COMPLETED extraction can answer a field whose
 * manifest `documentType` is `documentType`. Shared with the #884 gap key
 * (`field-plan-gap-keys.ts`): a new COMPLETED document in this family is the
 * event that reopens a NO_DOCUMENT_PROVENANCE row.
 */
export function docTypeFamily(documentType: string): ReadonlyArray<string> {
  return sharedDocTypeFamily(documentType);
}

/**
 * `field_sources.table_name` uses the schema's snake_case table name
 * (`ipos`, `ipo_details`, `financial_statements`, …) — same as the plan row's
 * `tableName` — so no translation is needed between the two. The manifest key
 * is `table.field` (dot-joined); the walk's plan row already splits that into
 * `tableName`/`fieldName` before calling the fetcher, so this module only
 * needs the column reader below.
 */

export interface DocFetcherDeps {
  fieldSources: FieldSourcesRepository;
  ipoRepository: IPORepository;
  documentRepository: DocumentRepository;
  /** Manifest lookup: `${tableName}.${fieldName}` -> documentType, e.g. 'PRICE_BAND_AD'. */
  manifestDocumentType: (tableName: string, fieldName: string) => string | undefined;
  /**
   * Manifest lookup: is `${tableName}.${fieldName}` marked
   * `capability.DOC.capable`? (Review round 1, M2 — BSE and CHITTORGARH both
   * already gate on their own capability flag before touching anything;
   * DOC did not, so a field the manifest marks DOC-incapable would still
   * read `field_sources` and could answer SUPPLIED against a source the
   * manifest says DOC has no business answering for.)
   */
  isDocCapable: (tableName: string, fieldName: string) => boolean;
  /**
   * Reads the current `ipo_details` row (review round 1, m1). `ipo_details`
   * has no shared repository class — `filing-persist-deps.ts`'s own comment
   * says so ("ipo_details has no repository - this is the single write path
   * for it") — so this reads through the SAME direct-query convention that
   * write path uses, never a raw ad-hoc query invented here.
   */
  ipoDetailsReader: { findByIpoId(ipoId: string): Promise<Record<string, unknown> | null> };
  /**
   * Item 6 (OD-91): document id -> receipt keys (`table|rowKey|camelField`)
   * for this IPO's documents. Optional: absent, or empty for every document
   * (all extracted before OD-91), the fetcher keeps its pre-OD-91 choice.
   */
  receiptReader?: (ipoId: string) => Promise<Map<string, ReadonlyMap<string, string | null>>>;
  /**
   * Item 38: counts the IPO's stored rows of a DOC_CHILD_ROWS_TABLES table and those with the camelCase
   * column non-null. Absent: an IPO-level child row answers CHECK_FAILED transient (never NOT_PRINTED).
   */
  childColumnCounter?: (ipoId: string, tableName: string, camelFieldName: string) => Promise<ChildColumnCount>;
  /** Item 38: the IPO's unresolved `field_extraction_failures` rows (the stated-absence evidence). */
  openFailuresReader?: (
    ipoId: string
  ) => Promise<ReadonlyArray<{ tableName: string; documentId: string | null; cause: string | null }>>;
  /**
   * Item 41 (OD-97, OD-161(b)): the OD-97 mark of ONE receipt (`document_field_receipts.source_text`:
   * 'TEXT' | 'OCR' | 'MIXED', null = written before the mark existed). Absent, or any value other than
   * 'TEXT', means "not read from a text page" -- the document value never replaces (B4(c), fail closed).
   */
  receiptMarkReader?: (documentId: string, tableName: string, rowKey: string, camelFieldName: string) => Promise<string | null>;
  /**
   * F-240 round 2 (B8): document id -> the extractor version that last read it (`document_fetch_state`,
   * by document id, else by IPO + type -- the same read the item 45 re-read uses). Absent: an empty
   * column is never filled from a receipt (fail closed).
   */
  recordedVersionReader?: (ipoId: string) => Promise<ReadonlyMap<string, string | null>>;
}

interface MinimalDocument {
  id: string;
  type: string;
  extractionStatus: string | null;
  isActive: boolean | null;
  sha256: string | null;
  filingDate?: string | Date | null;
}

/**
 * Item 6 (spec §2.5, OD-91): among this IPO's COMPLETED family documents whose
 * OWN receipt has the field, the best one by the same comparator supersession
 * uses (`bestPlanDocument`). Undefined when no family document has a receipt
 * for the field — the caller then keeps its pre-OD-91 choice, so rows chosen
 * before receipts existed do not churn.
 */
export function bestReceiptedDocument(
  docs: MinimalDocument[],
  family: ReadonlyArray<string>,
  receipts: Map<string, ReadonlyMap<string, string | null>>,
  key: string,
  fixedPrice: boolean
): MinimalDocument | undefined {
  const receipted: Array<MinimalDocument & PlanDocumentRef> = [];
  for (const type of family) {
    for (const d of docs) {
      if (d.type !== type || d.extractionStatus !== 'COMPLETED' || d.isActive === false) continue;
      if (!receipts.get(d.id)?.has(key)) continue;
      const fd = d.filingDate == null ? null : d.filingDate instanceof Date ? d.filingDate.toISOString().slice(0, 10) : String(d.filingDate).slice(0, 10);
      receipted.push({ ...d, docType: d.type, filingDate: fd });
    }
  }
  return bestPlanDocument(receipted, { family, fixedPrice });
}

function hasCompletedDocument(
  docs: MinimalDocument[],
  family: ReadonlyArray<string>
): MinimalDocument | undefined {
  // Prefer the exact documentType family order given; within a type, the most
  // recently completed active document wins (defensive — normally exactly one).
  for (const type of family) {
    const match = docs.find(
      (d) => d.type === type && d.extractionStatus === 'COMPLETED' && d.isActive !== false
    );
    if (match) return match;
  }
  return undefined;
}

/**
 * Read the CURRENT value of one column off the row the plan references.
 * `ipos` is a singleton row per IPO, read through the repository; `ipo_details`
 * is a singleton row per IPO with no shared repository class, read through
 * `deps.ipoDetailsReader` (review round 1, m1 — previously `undefined` for
 * EVERY non-`ipos` table, which made `ipo_details.fresh_issue`/`.ofs_issue`/
 * `.min_investment` answer NOT_PRINTED from DOC even with real DRHP
 * provenance, a coverage gap dressed as a settled answer). A table with no
 * read path yet (e.g. `financial_statements`, a KEYED child table) is named
 * explicitly as `not_implemented` so the caller can tell "this table has no
 * value" apart from "this fetcher cannot read this table yet" — the first is
 * NOT_PRINTED (definitive), the second must never look definitive.
 */
/**
 * #884: the tables `readColumnValue` can read. Part of the fetcher-coverage
 * fingerprint in `fieldPlanCoverageFingerprint` — adding a table here changes the gap
 * key, which re-offers every COLUMN_READ_NOT_IMPLEMENTED row.
 */
export const DOC_READABLE_TABLES: readonly string[] = ['ipos', 'ipo_details'];

/**
 * Item 38 (spec §2.5.6 item 1, OD-164(a), OD-161(a), OD-76): the child tables whose WHOLE section the
 * filing persister records as ONE IPO-level provenance row, `field_sources (table, row_key '', field
 * 'rows')`, carrying the document lineage (filing-persister.ts `trackField(<table>, 'rows')` — exactly
 * these six). Their plan rows are IPO-level (row_key ''), so the DOC answer is read from that record and
 * the stored child rows, and the walk CREDITS it without a write: the rows are already stored, and the
 * writer refuses an IPO-level child row anyway (MISSING_ROW_KEY). Part of the coverage fingerprint
 * (#884): adding a table here re-offers the rows parked under the old key.
 *
 * F-227 (measured 2026-10-02, staging): the KEYED per-row DRHP provenance rows of these tables carry
 * NULL docType/documentId, so the family check reads ONLY the `rows` record, never the keyed rows.
 */
export const DOC_CHILD_ROWS_TABLES: readonly string[] = [
  'financial_statements',
  'ipo_intermediaries',
  'ipo_risk_factors',
  'peer_companies',
  'promoter_acquisition_ranges',
  'promoters',
];

/** The field name of the IPO-level section record the filing persister writes for a child table. */
export const DOC_CHILD_ROWS_FIELD = 'rows';

/** How many of the IPO's stored rows a child table holds, and how many carry the asked column. */
export type ChildColumnCount = { status: 'ok'; rows: number; withValue: number } | { status: 'unknown_column' };

/**
 * The extractor reason inside a `field_extraction_failures.cause` written by the filing persister's
 * empty-section path: `${docType} ${extractorField}: ${detail}` (filing-persister.ts recordEmptySection).
 */
export function emptySectionReasonOf(cause: string | null | undefined): string | null {
  if (typeof cause !== 'string') return null;
  const at = cause.indexOf(': ');
  return at < 0 ? null : cause.slice(at + 2).trim();
}

/**
 * Item 38 answer-state table (spec §2.5.6 item 1) for an IPO-level plan row of a DOC_CHILD_ROWS_TABLES
 * table, decided in this order:
 *
 * | state           | condition                                                              | outcome                                   |
 * | unreadable      | a read error                                                           | CHECK_FAILED transient, with the error    |
 * | unknown column  | the plan's column is not a column of the table (checked FIRST)         | CHECK_FAILED transient COLUMN_READ_NOT_IMPLEMENTED |
 * | stated absent   | no stored rows AND an open failure whose reason is on the #1420 list, | NOT_PRINTED (definitive)                  |
 * |                 | from a COMPLETED document of the field's family                        |                                           |
 * | row missing     | no `rows` record from a document (source DRHP)                        | CHECK_FAILED transient NO_DOCUMENT_PROVENANCE |
 * | unresolved      | the record names no docType or no documentId (B4(c), fail closed)     | CHECK_FAILED transient NO_DOCUMENT_PROVENANCE |
 * | wrong family    | the record's docType is outside the field's family                    | CHECK_FAILED transient NO_DOCUMENT_PROVENANCE |
 * | doc not usable  | the record's documentId is not a COMPLETED, active, family document   | CHECK_FAILED transient NO_DOCUMENT_PROVENANCE |
 * |                 | of THIS IPO                                                            |                                           |
 * | found           | >= 1 stored row with the column non-null                               | SUPPLIED, credited 'DOCUMENT_ROWS_STORED', |
 * |                 |                                                                        | value NULL + rowCount, NO write           |
 * | column empty    | the record exists, the column is null on every stored row (or no rows)| CHECK_FAILED transient (extractor gap)    |
 */
async function answerChildRowsField(
  deps: DocFetcherDeps,
  ipoId: string,
  tableName: string,
  camelFieldName: string,
  manifestDocType: string,
  docs: MinimalDocument[]
): Promise<FieldFetcherAnswer> {
  if (!deps.childColumnCounter || !deps.openFailuresReader) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `DOC child-row read not wired for ${tableName}`,
      transient: true,
      gap: 'COLUMN_READ_NOT_IMPLEMENTED',
    };
  }
  let record;
  let failures;
  let counted: ChildColumnCount;
  try {
    record = await deps.fieldSources.findByField(ipoId, tableName, DOC_CHILD_ROWS_FIELD, '');
    failures = await deps.openFailuresReader(ipoId);
    counted = await deps.childColumnCounter(ipoId, tableName, camelFieldName);
  } catch (error) {
    return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error), transient: true };
  }

  // Fail closed BEFORE any other branch: a column the table does not have can never be NOT_PRINTED.
  if (counted.status === 'unknown_column') {
    return {
      outcome: 'CHECK_FAILED',
      reason: `DOC child-row read has no column ${camelFieldName} on ${tableName}`,
      transient: true,
      gap: 'COLUMN_READ_NOT_IMPLEMENTED',
    };
  }

  const family = docTypeFamily(manifestDocType);
  const completedFamilyDocIds = new Set(
    docs.filter((d) => d.extractionStatus === 'COMPLETED' && d.isActive !== false && family.includes(d.type)).map((d) => d.id)
  );
  if (counted.rows === 0) {
    const stated = failures.find(
      (f) =>
        f.tableName === tableName &&
        f.documentId != null &&
        completedFamilyDocIds.has(f.documentId) &&
        isStatedAbsenceReason(emptySectionReasonOf(f.cause))
    );
    if (stated) return { outcome: 'NOT_PRINTED' };
  }

  if (!record || record.source !== 'DRHP') {
    return {
      outcome: 'CHECK_FAILED',
      reason: `no document ${DOC_CHILD_ROWS_FIELD} record for ${tableName} on ${manifestDocType} (extractor gap or section absent) — not retired`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  const lineage = (record.dataLineage ?? {}) as { docType?: string | null; documentId?: string | null; sourceSha?: string | null };
  if (!lineage.docType || !lineage.documentId) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `${tableName} ${DOC_CHILD_ROWS_FIELD} record names no document type or id — not credited`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  if (!(familyForField(manifestDocType, lineage.docType) as ReadonlyArray<string>).includes(lineage.docType)) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `${tableName} ${DOC_CHILD_ROWS_FIELD} record is from ${lineage.docType}, outside the ${manifestDocType} family — not retired`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  // The credited document must be a COMPLETED, active document of THIS IPO in the field's family.
  const doc = docs.find((d) => d.id === lineage.documentId);
  if (
    !doc ||
    doc.extractionStatus !== 'COMPLETED' ||
    doc.isActive === false ||
    !(familyForField(manifestDocType, doc.type) as ReadonlyArray<string>).includes(doc.type)
  ) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `${tableName} ${DOC_CHILD_ROWS_FIELD} record names document ${lineage.documentId}, not a completed active ${manifestDocType}-family document of this IPO — not credited`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  if (counted.withValue > 0) {
    return {
      outcome: 'SUPPLIED',
      // "The document supplied rows": the rows are already stored by the filing persister, so the walk
      // credits and never writes (OD-161(a)). The value is NULL -- a row count is never a value an admin
      // could pick (§9.2 item 9); the count rides separately as evidence.
      value: null,
      rowCount: counted.withValue,
      documentId: lineage.documentId,
      documentType: lineage.docType,
      sha256: lineage.sourceSha ?? doc.sha256 ?? undefined,
      credited: 'DOCUMENT_ROWS_STORED',
    };
  }
  return {
    outcome: 'CHECK_FAILED',
    reason:
      counted.rows === 0
        ? `${tableName} ${DOC_CHILD_ROWS_FIELD} record on ${lineage.docType} but no stored rows — a reader gap, not NOT_PRINTED`
        : `${tableName}.${camelFieldName} is empty on all ${counted.rows} stored rows from ${lineage.docType} — an extractor gap, not NOT_PRINTED`,
    transient: true,
    gap: 'NO_DOCUMENT_PROVENANCE',
  };
}

async function readColumnValue(
  deps: DocFetcherDeps,
  ipoId: string,
  tableName: string,
  camelFieldName: string
): Promise<{ status: 'ok'; value: unknown } | { status: 'not_implemented' }> {
  if (!DOC_READABLE_TABLES.includes(tableName)) return { status: 'not_implemented' };
  if (tableName === 'ipos') {
    const ipo = await deps.ipoRepository.findById(ipoId);
    return { status: 'ok', value: ipo ? (ipo as unknown as Record<string, unknown>)[camelFieldName] ?? null : null };
  }
  if (tableName === 'ipo_details') {
    const row = await deps.ipoDetailsReader.findByIpoId(ipoId);
    return { status: 'ok', value: row ? row[camelFieldName] ?? null : null };
  }
  // Every other table in this slice's Class (financial_statements, a KEYED
  // child table with no read path yet) has no implementation. This must
  // NEVER read as NOT_PRINTED -- that would retire the field's coverage
  // permanently-looking while the real reason is "nobody wrote this read
  // yet", masking a coverage gap as a settled source answer.
  return { status: 'not_implemented' };
}

/**
 * §2.5.5 Rule 3's fixed-price test reads ipo_details.issue_type for EVERY table, the same as the
 * write path (plan-supersession.loadSupersessionInputs).
 */
async function isFixedPriceFor(deps: DocFetcherDeps, ipoId: string): Promise<boolean> {
  const ipoRow = (await deps.ipoRepository.findById(ipoId)) as unknown as Record<string, unknown> | null;
  const detailsRow = await deps.ipoDetailsReader.findByIpoId(ipoId).catch(() => null);
  return isFixedPriceIssue(
    (detailsRow?.issueType as string | null | undefined) ?? null,
    ipoRow?.priceRangeMin == null ? null : Number(ipoRow.priceRangeMin),
    ipoRow?.priceRangeMax == null ? null : Number(ipoRow.priceRangeMax)
  );
}

/**
 * Item 41: the website sources that can own a stored value the document may replace (OD-161(b)). Any
 * other owner (ADMIN, a source this list does not name) is never replaced and keeps today's answer.
 */
const WEBSITE_OWNERS: ReadonlySet<string> = new Set(['NSE', 'BSE', 'CHITTORGARH', 'MONEYCONTROL', 'INVESTORGAIN_GMP', 'API_FALLBACK']);

/** The exchanges: a field that ranks one of them above DOC is exchange-first (E-1, S-05) -- OD-161(c). */
const EXCHANGE_SOURCES: ReadonlySet<string> = new Set(['NSE', 'BSE']);

/**
 * Item 41: turn a receipt's normalised text back into the stored column's own shape, so the write
 * carries a number for a number column and a list for a list column. Fail closed (null) when the shapes
 * do not round-trip -- the value is then kept, never written in a guessed shape.
 */
export function decodeReceiptForColumn(receipt: string, stored: unknown): { value: unknown } | null {
  let value: unknown;
  try {
    if (typeof stored === 'number') value = Number(receipt);
    else if (typeof stored === 'boolean') value = receipt === 'true' ? true : receipt === 'false' ? false : undefined;
    else if (stored instanceof Date || typeof stored === 'string') value = receipt;
    else if (stored !== null && typeof stored === 'object') value = JSON.parse(receipt);
    else return null;
  } catch {
    return null;
  }
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return null;
  return normalizeReceiptValue(value) === receipt ? { value } : null;
}

type OwnRecordArgs = {
  ipoId: string;
  tableName: string;
  rowKey: string;
  camelFieldName: string;
  manifestDocType: string;
  family: ReadonlyArray<string>;
  docs: MinimalDocument[];
  /** `field_sources.source` of the stored value (scraper_source enum), null when no provenance row. */
  owner: string | null;
  /** The walk's rank list for this field and IPO (manifest codes), from FieldFetcherContext. */
  ranks?: ReadonlyArray<string | null>;
};

/**
 * Item 41 answer-state table (OD-161, spec §2.5): the DOC answer for a column a non-document source owns,
 * judged by the best-ranked in-family COMPLETED active document's OWN receipt (the OD-91 comparator).
 *
 * | state                                                       | outcome                                                    |
 * | stored value ADMIN (§2.7); no provenance row; an owner this | null -> today's answer (CHECK_FAILED NO_DOCUMENT_PROVENANCE)|
 * |   table does not name (fail closed)                         |                                                            |
 * | no receipt with a value for the field                       | null -> today's answer                                     |
 * | receipts only from documents OUTSIDE the family (OD-96)     | CHECK_FAILED transient                                     |
 * | receipt equal to the stored value                           | SUPPLIED credited 'DOCUMENT_VALUE_STORED': value null, no  |
 * |                                                             |   write, no re-stamp (OD-161(a), OD-73; item 38's path)    |
 * | differs; an exchange ranks above DOC (E-1, S-05), the owner | CHECK_FAILED transient, kept, nothing listed (OD-161(c))   |
 * |   ranks above DOC, or no rank list (fail closed)            |                                                            |
 * | differs; DOC outranks the owner; mark not TEXT (OCR, MIXED, | CHECK_FAILED transient, kept; listed for the admin (OD-61) |
 * |   unknown) or the value does not decode to the column shape |                                                            |
 * | differs; DOC outranks the owner; mark TEXT                  | SUPPLIED with the document's value -> the walk's normal    |
 * |                                                             |   write (its checks may refuse it); listed for the admin   |
 * |                                                             |   only when that write is accepted (OD-161(b))             |
 * | ... and that write REFUSES it (the field's checks fail)     | stored value kept; listed for the admin under              |
 * |                                                             |   FAILED_VALIDATION with the failed check (OD-62/63/95(b)) |
 */
async function answerFromOwnRecord(deps: DocFetcherDeps, a: OwnRecordArgs): Promise<FieldFetcherAnswer | null> {
  if (!deps.receiptReader) return null;
  if (a.owner === null || a.owner === 'ADMIN' || !WEBSITE_OWNERS.has(a.owner)) return null;
  if (!DOC_READABLE_TABLES.includes(a.tableName)) return null;

  let receipts: Map<string, ReadonlyMap<string, string | null>>;
  try {
    receipts = await deps.receiptReader(a.ipoId);
  } catch (error) {
    return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error), transient: true };
  }
  const key = `${a.tableName}|${a.rowKey}|${a.camelFieldName}`;
  const printed = new Map<string, ReadonlyMap<string, string | null>>();
  for (const [docId, byKey] of receipts) {
    const v = byKey.get(key);
    if (v !== null && v !== undefined) printed.set(docId, new Map([[key, v]]));
  }
  if (printed.size === 0) return null;
  const best = bestReceiptedDocument(a.docs, a.family, printed, key, await isFixedPriceFor(deps, a.ipoId));
  if (!best) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `document receipt for ${a.camelFieldName} only from a document outside the ${a.manifestDocType} family (OD-96) — not credited`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  const receipted = printed.get(best.id)!.get(key)!;

  const read = await readColumnValue(deps, a.ipoId, a.tableName, a.camelFieldName);
  if (read.status !== 'ok' || read.value === null || read.value === undefined) return null;
  const evidence = { documentId: best.id, documentType: best.type, sha256: best.sha256 ?? undefined };

  if (normalizeReceiptValue(read.value) === receipted) {
    // OD-161(a): equal -- credit the document, write nothing, re-stamp nothing.
    return { outcome: 'SUPPLIED', value: null, ...evidence, credited: 'DOCUMENT_VALUE_STORED' };
  }

  const kept = (why: string, adminListing?: DocAdminListing): FieldFetcherAnswer => ({
    outcome: 'CHECK_FAILED',
    reason: `OD-161 kept the ${a.owner} value of ${a.camelFieldName}; the ${best.type} prints a different value (${why})`,
    transient: true,
    gap: 'NO_DOCUMENT_PROVENANCE',
    ...(adminListing ? { adminListing } : {}),
  });

  const ranks = a.ranks;
  const docIdx = ranks ? ranks.indexOf('DOC') : -1;
  if (!ranks || docIdx < 0) return kept('no rank list for this field, fail closed');
  const above = ranks.slice(0, docIdx).filter((s): s is string => typeof s === 'string');
  if (above.some((s) => EXCHANGE_SOURCES.has(s))) return kept('an exchange ranks above the document, OD-161(c)');
  if (above.some((s) => mapManifestSourceToScraperSource(s) === a.owner)) return kept('the owner ranks above the document');

  let mark: string | null = null;
  try {
    mark = deps.receiptMarkReader ? await deps.receiptMarkReader(best.id, a.tableName, a.rowKey, a.camelFieldName) : null;
  } catch (error) {
    return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error), transient: true };
  }
  const listing: DocAdminListing = {
    ipoId: a.ipoId,
    tableName: a.tableName,
    rowKey: a.rowKey,
    fieldName: a.camelFieldName,
    documentId: best.id,
    documentType: best.type,
    storedSource: a.owner,
    storedValue: normalizeReceiptValue(read.value),
    documentValue: receipted,
    mark,
    outcome: 'KEPT',
  };
  if (mark !== 'TEXT') return kept(`mark ${mark ?? 'unknown'}, not a text page, OD-97`, listing);
  const decoded = decodeReceiptForColumn(receipted, read.value);
  if (!decoded) return kept('the value does not decode to the column shape, fail closed', listing);
  return { outcome: 'SUPPLIED', value: decoded.value, ...evidence, adminListing: { ...listing, outcome: 'REPLACED' } };
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;
const PLAIN_INTEGER = /^\d+$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * F-240 round 2: the jsonb columns this path may fill, each with its element shape. Any other jsonb
 * column is refused (fail closed): its shape is not known here.
 */
const JSONB_SHAPES: Readonly<Record<string, (v: unknown) => boolean>> = {
  'ipos.objectives': (v) =>
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (o) =>
        o !== null &&
        typeof o === 'object' &&
        !Array.isArray(o) &&
        nonEmptyString((o as Record<string, unknown>).description) &&
        ((o as Record<string, unknown>).amount === null ||
          (typeof (o as Record<string, unknown>).amount === 'number' && Number.isFinite((o as Record<string, unknown>).amount) && ((o as Record<string, unknown>).amount as number) >= 0)) &&
        ((o as Record<string, unknown>).sno === undefined || (Number.isInteger((o as Record<string, unknown>).sno) && ((o as Record<string, unknown>).sno as number) > 0))
    ),
  'ipos.lead_managers': (v) => Array.isArray(v) && v.length > 0 && v.every(nonEmptyString),
  'ipos.listing_exchanges': (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x === 'NSE' || x === 'BSE'),
};

function isCalendarDay(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * F-240 round 2 (Tier A MAJOR): a receipt is validated against the column's REAL SQL type before it may
 * fill an empty column. Drizzle reports numeric and date columns as plain strings, so a shape exemplar
 * would let "1,234", "500 crore", "-5" or "03 Oct 2026" through. Every type this path cannot judge
 * (timestamp, uuid, array, an unlisted jsonb) is refused: fail closed (B4(c)).
 *
 * | SQL type (drizzle columnType)            | accepted receipt                                   | written as      |
 * | numeric, real, double precision          | plain non-negative decimal `^\d+(\.\d+)?$`         | the text / number |
 * | integer, smallint, bigint                | `^\d+$`                                            | a number        |
 * | date                                     | `^\d{4}-\d{2}-\d{2}$` and a real calendar day      | the day string  |
 * | text, varchar                            | non-empty after trim, within the varchar length    | the string      |
 * | enum                                     | a member of the enum                               | the string      |
 * | boolean                                  | `true` / `false`                                   | a boolean       |
 * | jsonb in JSONB_SHAPES                    | JSON whose value passes the column's element shape | the parsed value |
 * | anything else                            | refused                                            | -               |
 */
export function validateReceiptForEmptyColumn(
  tableName: string,
  camelFieldName: string,
  receipt: string
): { value: unknown } | { refused: string } {
  const table = tableName === 'ipos' ? iposTable : tableName === 'ipo_details' ? ipoDetailsTable : null;
  const column = table
    ? (getTableColumns(table) as Record<string, { columnType?: string; name?: string; length?: number; enumValues?: readonly string[] }>)[camelFieldName]
    : undefined;
  if (!column) return { refused: `no column ${tableName}.${camelFieldName}` };
  const text = receipt.trim();
  switch (column.columnType) {
    case 'PgNumeric':
      return PLAIN_DECIMAL.test(text) ? { value: text } : { refused: `'${receipt}' is not a plain non-negative decimal (numeric column)` };
    case 'PgReal':
    case 'PgDoublePrecision':
      return PLAIN_DECIMAL.test(text) ? { value: Number(text) } : { refused: `'${receipt}' is not a plain non-negative decimal` };
    case 'PgInteger':
    case 'PgSmallInt':
    case 'PgBigInt53':
      return PLAIN_INTEGER.test(text) && Number.isSafeInteger(Number(text))
        ? { value: Number(text) }
        : { refused: `'${receipt}' is not a non-negative integer (integer column)` };
    case 'PgDateString':
    case 'PgDate':
      return ISO_DAY.test(text) && isCalendarDay(text) ? { value: text } : { refused: `'${receipt}' is not a YYYY-MM-DD calendar day (date column)` };
    case 'PgText':
    case 'PgVarchar':
      if (text === '') return { refused: 'empty text' };
      if (typeof column.length === 'number' && text.length > column.length) return { refused: `longer than varchar(${column.length})` };
      return { value: text };
    case 'PgEnumColumn':
      return column.enumValues?.includes(text) ? { value: text } : { refused: `'${receipt}' is not a member of the enum` };
    case 'PgBoolean':
      return text === 'true' ? { value: true } : text === 'false' ? { value: false } : { refused: `'${receipt}' is not a boolean` };
    case 'PgJsonb':
    case 'PgJson': {
      const shape = JSONB_SHAPES[`${tableName}.${column.name ?? ''}`];
      if (!shape) return { refused: `jsonb column ${tableName}.${camelFieldName} has no known element shape` };
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { refused: 'not JSON' };
      }
      return shape(parsed) ? { value: parsed } : { refused: `JSON does not match the ${tableName}.${column.name} element shape` };
    }
    default:
      return { refused: `column type ${column.columnType ?? 'unknown'} is not filled from a receipt` };
  }
}

type EmptyColumnArgs = {
  ipoId: string;
  tableName: string;
  camelFieldName: string;
  manifestDocType: string;
  family: ReadonlyArray<string>;
  docs: MinimalDocument[];
};

/**
 * F-240 answer-state table (OD-161 "the DOC fetcher reads a document's answer from its own record, never
 * from who owns the stored value"; OD-96; OD-97; #684): a DOC-readable column that is EMPTY and has NO
 * `field_sources` row. Nobody owns it, so there is nothing to credit, keep or replace: the document's own
 * record is the answer, from a CURRENT read only.
 *
 * | state                                                        | outcome                                                  |
 * | column not empty, unreadable table, no receipt or version reader | null -> the caller's next path (unchanged)           |
 * | no non-empty receipt for the field                           | null -> today's answer (CHECK_FAILED NO_DOCUMENT_PROVENANCE) |
 * | receipts only from documents OUTSIDE the family (OD-96)      | CHECK_FAILED transient, ignored, never written           |
 * | family receipts only from reads BELOW the type's re-read     | CHECK_FAILED transient, not written: the re-read (item   |
 * |   floor (rereadSinceFor, the same filter the re-read uses)   |   45) replaces them and OD-171 re-offers the row         |
 * | two current family receipts with different values that the  | CHECK_FAILED transient AMBIGUOUS, nothing written        |
 * |   OD-91 comparator cannot order                              |                                                          |
 * | mark OCR, MIXED or any other text                            | CHECK_FAILED transient, column kept empty, NOT listed    |
 * |   (SPEC CHANGE, reversible: see spec §2.5 F-240 paragraph)   |   (no stored value, so no conflict row to name)          |
 * | value fails the column's SQL type (validateReceiptForEmptyColumn) | CHECK_FAILED transient with the reason, not written |
 * | mark TEXT, or null (read before the mark existed)            | SUPPLIED with the validated value and the document's     |
 * |                                                              |   evidence -> the walk's normal write, which records the |
 * |                                                              |   field_sources row (#684); its checks may refuse it     |
 */
async function answerEmptyUnownedColumn(deps: DocFetcherDeps, a: EmptyColumnArgs): Promise<FieldFetcherAnswer | null> {
  if (!deps.receiptReader || !deps.recordedVersionReader || !DOC_READABLE_TABLES.includes(a.tableName)) return null;
  const read = await readColumnValue(deps, a.ipoId, a.tableName, a.camelFieldName);
  if (read.status !== 'ok' || (read.value !== null && read.value !== undefined && read.value !== '')) return null;

  let receipts: Map<string, ReadonlyMap<string, string | null>>;
  let versions: ReadonlyMap<string, string | null>;
  try {
    receipts = await deps.receiptReader(a.ipoId);
    versions = await deps.recordedVersionReader(a.ipoId);
  } catch (error) {
    return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error), transient: true };
  }
  const key = `${a.tableName}||${a.camelFieldName}`;
  const printed = new Map<string, ReadonlyMap<string, string | null>>();
  for (const [docId, byKey] of receipts) {
    const v = byKey.get(key);
    if (v !== null && v !== undefined && v !== '') printed.set(docId, new Map([[key, v]]));
  }
  if (printed.size === 0) return null;
  const fixedPrice = await isFixedPriceFor(deps, a.ipoId);
  if (!bestReceiptedDocument(a.docs, a.family, printed, key, fixedPrice)) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `document receipt for ${a.camelFieldName} only from a document outside the ${a.manifestDocType} family (OD-96) — not written`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  // B8 structural guard: only a read at or above its type's re-read floor may fill an empty column.
  const current = new Map<string, ReadonlyMap<string, string | null>>();
  for (const d of a.docs) {
    const r = printed.get(d.id);
    if (r && versionAtLeast(versions.get(d.id) ?? null, rereadSinceFor(d.type))) current.set(d.id, r);
  }
  const best = bestReceiptedDocument(a.docs, a.family, current, key, fixedPrice);
  if (!best) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `document receipt for ${a.camelFieldName} only from a read below its type's re-read floor — not written until the re-read`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  const value = current.get(best.id)!.get(key)!;

  // B4(c): another current family document whose receipt differs and that the comparator cannot rank
  // below the chosen one -- the order between them is unknown, so no value is written.
  const asRef = (d: MinimalDocument): PlanDocumentRef => ({
    id: d.id,
    docType: d.type,
    filingDate:
      d.filingDate == null ? null : d.filingDate instanceof Date ? d.filingDate.toISOString().slice(0, 10) : String(d.filingDate).slice(0, 10),
  });
  for (const d of a.docs) {
    if (d.id === best.id || !a.family.includes(d.type) || d.extractionStatus !== 'COMPLETED' || d.isActive === false) continue;
    const other = current.get(d.id)?.get(key);
    if (other === undefined || other === value) continue;
    if (!decidePlanRowSupersession(asRef(d), asRef(best), { family: a.family, fixedPrice }).supersede) {
      return {
        outcome: 'CHECK_FAILED',
        reason: `AMBIGUOUS: ${best.type} ${best.id} and ${d.type} ${d.id} print different values for ${a.camelFieldName} and cannot be ordered — not written`,
        transient: true,
        gap: 'NO_DOCUMENT_PROVENANCE',
      };
    }
  }

  let mark: string | null = null;
  try {
    mark = deps.receiptMarkReader ? await deps.receiptMarkReader(best.id, a.tableName, '', a.camelFieldName) : null;
  } catch (error) {
    return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error), transient: true };
  }
  if (mark !== null && mark !== 'TEXT') {
    return {
      outcome: 'CHECK_FAILED',
      reason: `the ${best.type} value of empty ${a.camelFieldName} is not from a text page (mark ${mark}) — kept empty (F-240, SPEC CHANGE to OD-97 for empty columns)`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  const checked = validateReceiptForEmptyColumn(a.tableName, a.camelFieldName, value);
  if ('refused' in checked) {
    return {
      outcome: 'CHECK_FAILED',
      reason: `the ${best.type} value of empty ${a.camelFieldName} fails the column type: ${checked.refused} — not written`,
      transient: true,
      gap: 'NO_DOCUMENT_PROVENANCE',
    };
  }
  return { outcome: 'SUPPLIED', value: checked.value, documentId: best.id, documentType: best.type, sha256: best.sha256 ?? undefined };
}

export function buildDocFetcher(deps: DocFetcherDeps): FieldFetcher {
  return async function docFetcher(
    ipoId: string,
    tableName: string,
    rowKey: string,
    fieldName: string,
    context?: FieldFetcherContext
  ): Promise<FieldFetcherAnswer> {
    if (!deps.isDocCapable(tableName, fieldName)) {
      return { outcome: 'NOT_PRINTED' };
    }

    // `fieldName` here is the plan row's manifest key — snake_case.
    const camelFieldName = columnToCamelCase(fieldName);
    const manifestDocType = deps.manifestDocumentType(tableName, fieldName);
    if (!manifestDocType) {
      // No documentType declared for this field in the manifest — DOC cannot
      // answer it structurally. TRANSIENT, not definitive (review round 1,
      // m2): this is a fact about the MANIFEST's current state, which can be
      // edited at any time to add a documentType — treating it as definitive
      // would retire the field terminally over a config gap a later manifest
      // change fixes, the exact class F1 already fixed for a missing source
      // adapter. NOT_PRINTED is also wrong here: that implies a document WAS
      // checked, and none was.
      return {
        outcome: 'CHECK_FAILED',
        reason: 'no documentType in manifest for this field',
        transient: true,
        gap: 'NO_DOCUMENT_TYPE',
      };
    }

    const family = docTypeFamily(manifestDocType);

    let docs: MinimalDocument[];
    try {
      docs = (await deps.documentRepository.findByIPO(ipoId)) as unknown as MinimalDocument[];
    } catch (error) {
      return {
        outcome: 'CHECK_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      }; // transient defaults true — a read failure is this minute's fact.
    }

    const completedDoc = hasCompletedDocument(docs, family);
    if (!completedDoc) {
      return { outcome: 'NOT_AVAILABLE_YET' };
    }

    // Item 38: an IPO-level plan row of a child table whose section the filing persister records as one
    // `rows` record — answered from that record and the stored rows, credited without a write.
    if (DOC_CHILD_ROWS_TABLES.includes(tableName) && (rowKey ?? '') === '') {
      return answerChildRowsField(deps, ipoId, tableName, camelFieldName, manifestDocType, docs);
    }

    // §9.2 item 9, §2.4 clarification: on an admin-held field the column holds the ADMIN value
    // and field_sources says ADMIN, so the provenance path below can never report what a
    // document printed. The held read answers from the documents' own receipts instead: the
    // best receipted document (same comparator as OD-91) that printed a value. No such receipt
    // falls through to the unchanged path.
    if (context?.held && deps.receiptReader) {
      let receipts: Map<string, ReadonlyMap<string, string | null>>;
      try {
        receipts = await deps.receiptReader(ipoId);
      } catch (error) {
        return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
      }
      const key = `${tableName}|${rowKey || ''}|${camelFieldName}`;
      const printed = new Map<string, ReadonlyMap<string, string | null>>();
      for (const [docId, byKey] of receipts) {
        const v = byKey.get(key);
        if (v !== null && v !== undefined) printed.set(docId, new Map([[key, v]]));
      }
      const best = bestReceiptedDocument(docs, family, printed, key, await isFixedPriceFor(deps, ipoId));
      if (best) {
        return {
          outcome: 'SUPPLIED',
          value: printed.get(best.id)!.get(key),
          documentId: best.id,
          documentType: best.type,
          sha256: best.sha256 ?? undefined,
        };
      }
    }

    let provenance;
    try {
      provenance = await deps.fieldSources.findByField(ipoId, tableName, camelFieldName, rowKey || '');
    } catch (error) {
      return {
        outcome: 'CHECK_FAILED',
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    // Review round 2, RCA2 (staging wake 619660c3, 13 rows wrongly EXHAUSTED
    // on the first real walk): absence of a field_sources provenance row on
    // a COMPLETED document is an EXTRACTOR gap (item 13 -- a general DOC ->
    // field_sources backfill -- is not built), NEVER evidence the document
    // does not print the field. Every DRHP prints issue_size / fresh_issue /
    // ofs_issue / min_investment; the fetcher simply has no way to tell
    // "not printed" apart from "not yet extracted" from the ABSENCE of a
    // row. NOT_PRINTED is upstream's signal for a DEFINITIVE no (it can
    // retire the field terminally via EXHAUSTED); a coverage gap must never
    // wear that costume. The ONLY thing that may answer NOT_PRINTED here is
    // `capability.DOC.capable === false`, already checked at the top of this
    // function before provenance is ever read (review round 1, M2).
    //
    // Same reasoning covers a cross-family provenance row a few lines below
    // (RCA2 also folds that case in): a document was found from a DIFFERENT
    // family than the manifest wants, so DOC has no fresher document family
    // to check -- but that is STILL not a settled "not printed", because the
    // wanted family may simply not be extracted yet.
    if (!provenance) {
      // F-240 (OD-161): an empty column nobody owns -- the document's own record is the answer.
      const fromRecord = await answerEmptyUnownedColumn(deps, { ipoId, tableName, camelFieldName, manifestDocType, family, docs });
      if (fromRecord) return fromRecord;
    }
    if (!provenance || provenance.source !== 'DRHP') {
      // Item 41 (OD-161): a website (or nobody) owns the stored value -- the document's answer is read
      // from its OWN record (`document_field_receipts`), never from who owns the column.
      const own = await answerFromOwnRecord(deps, {
        ipoId, tableName, rowKey: rowKey || '', camelFieldName, manifestDocType, family, docs,
        owner: provenance?.source ?? null, ranks: context?.ranks,
      });
      if (own) return own;
      // Every filing doc type writes field_sources.source as 'DRHP' (the
      // SOURCE ENUM NOTE in filing-persister.ts) — a provenance row that
      // exists but is NOT 'DRHP' means a non-document source (e.g. ADMIN,
      // BSE, CHITTORGARH from an earlier direct write) currently owns this
      // field. That is still not a DOC answer, but it must never read as a
      // DEFINITIVE "not printed" either -- extraction may simply not have
      // reached this field yet.
      return {
        outcome: 'CHECK_FAILED',
        reason: `no document provenance for ${camelFieldName} on ${manifestDocType} (extractor gap or field absent) — not retired`,
        transient: true,
        gap: 'NO_DOCUMENT_PROVENANCE',
      };
    }

    const lineage = (provenance.dataLineage ?? {}) as {
      docType?: string;
      documentId?: string | null;
      sourceSha?: string | null;
    };

    // A provenance row from a DIFFERENT document family than the manifest
    // wants (e.g. financial_statements.revenue sourced from a PROSPECTUS
    // when the manifest wants RHP-family evidence) is the SAME ambiguity as
    // no provenance at all (RCA2) — CHECK_FAILED transient, never a settled
    // NOT_PRINTED.
    if (lineage.docType && !family.includes(lineage.docType)) {
      return {
        outcome: 'CHECK_FAILED',
        reason: `no document provenance for ${camelFieldName} on ${manifestDocType} (extractor gap or field absent) — not retired`,
        transient: true,
        gap: 'NO_DOCUMENT_PROVENANCE',
      };
    }

    const read = await readColumnValue(deps, ipoId, tableName, camelFieldName);
    if (read.status === 'not_implemented') {
      // A provenance row exists, but this fetcher has no read path for this
      // table yet (m1) — a coverage gap, never a settled "not here". CHECK_FAILED
      // transient keeps the field re-askable (backoff) rather than retiring it.
      return {
        outcome: 'CHECK_FAILED',
        reason: `DOC column read not implemented for ${tableName}`,
        transient: true,
        gap: 'COLUMN_READ_NOT_IMPLEMENTED',
      };
    }
    if (read.value === undefined || read.value === null) {
      // A provenance row exists (the field WAS sourced from a document at
      // some point) but the live column is empty now. Never fabricate a
      // SUPPLIED with no value.
      //
      // #1246 round 2 (finding 2): and never NOT_PRINTED either. The filing
      // persister writes non-null values only, so a document provenance row
      // over an empty column says the document DID supply a value that was
      // removed afterwards (an admin clear; a repair) -- a fact about our read, not "the document does not print
      // it". NOT_PRINTED from every rank retires the field (EXHAUSTED); this is
      // a reader gap, parked under the document key (a new document, extractor
      // version or provenance reopens it) while lower ranks answer in the same
      // pass (§5.3 rule 4).
      return {
        outcome: 'CHECK_FAILED',
        reason: `document provenance for ${camelFieldName} on ${manifestDocType} but the column is empty (value cleared) — a reader gap, not NOT_PRINTED`,
        transient: true,
        gap: 'NO_DOCUMENT_PROVENANCE',
      };
    }

    // Item 6 (OD-91): with receipts, the best receipted document wins and an
    // outranked lineage does not. Without any receipt for this field, the
    // pre-OD-91 choice below stands unchanged.
    if (deps.receiptReader) {
      let receipts: Map<string, ReadonlyMap<string, string | null>> = new Map();
      try {
        receipts = await deps.receiptReader(ipoId);
      } catch (error) {
        return { outcome: 'CHECK_FAILED', reason: error instanceof Error ? error.message : String(error) };
      }
      const fixedPrice = await isFixedPriceFor(deps, ipoId);
      const key = `${tableName}|${rowKey || ''}|${camelFieldName}`;
      const best = bestReceiptedDocument(docs, family, receipts, key, fixedPrice);
      if (best) {
        const receipted = receipts.get(best.id)?.get(key) ?? null;
        const current = normalizeReceiptValue(read.value);
        if (receipted !== null && receipted === current) {
          if (lineage.documentId && lineage.documentId !== best.id) {
            logger.info(
              { ipoId, tableName, fieldName, lineageDocumentId: lineage.documentId, chosenDocumentId: best.id, chosenType: best.type },
              '[doc-fetcher] lineage document outranked by a receipted document with the identical value — plan row credits the receipted one (OD-91, OD-73)'
            );
          }
          return { outcome: 'SUPPLIED', value: read.value, documentId: best.id, documentType: best.type, sha256: best.sha256 ?? undefined };
        }
        // The best document's own extraction produced a DIFFERENT value (e.g. dropped because
        // the price band ad owns the headline) — it did not supply what the page shows, so the
        // current choice stands.
        logger.info(
          { ipoId, tableName, fieldName, receiptedDocumentId: best.id, receiptedType: best.type, receiptedValue: receipted, currentValue: current, keptDocumentId: lineage.documentId ?? completedDoc.id },
          '[doc-fetcher] best receipted document printed a different value than the column holds — current choice kept (OD-91)'
        );
      }
    }

    return {
      outcome: 'SUPPLIED',
      value: read.value,
      documentId: lineage.documentId ?? completedDoc.id,
      documentType: lineage.docType ?? completedDoc.type,
      sha256: lineage.sourceSha ?? completedDoc.sha256 ?? undefined,
    };
  };
}
