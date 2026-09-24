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

import type { FieldFetcher, FieldFetcherAnswer } from './field-plan-walk.js';
import type { FieldSourcesRepository } from '@ipodhan/shared';
import type { IPORepository } from '@ipodhan/shared';
import type { DocumentRepository } from '@ipodhan/shared';
// `plan.fieldName` is the manifest's raw snake_case key (field-plan-generator.ts
// takes it verbatim from `table.field_name`); `field_sources.field_name` and
// every repository column are camelCase. Same helper filing-persister's own
// provenance reads use — see its doc comment ("field_sources.field_name is
// camelCase (listingDate, bseIpoNo), not the snake_case column name").
import { columnToCamelCase } from '@ipodhan/shared/utils/duplicate-ipo-merge';
import { bestPlanDocument, isFixedPriceIssue, type PlanDocumentRef } from './document-state-machine.js';
import { logger } from '../utils/logger.js';
import { DOC_TYPE_FAMILIES, docTypeFamily as sharedDocTypeFamily, normalizeReceiptValue } from '../../config/plan-supersession-rule.mjs';

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

export function buildDocFetcher(deps: DocFetcherDeps): FieldFetcher {
  return async function docFetcher(
    ipoId: string,
    tableName: string,
    rowKey: string,
    fieldName: string
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
    if (!provenance || provenance.source !== 'DRHP') {
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
      return { outcome: 'NOT_PRINTED' };
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
      // §2.5.5 Rule 3's fixed-price test reads ipo_details.issue_type for EVERY table, the same as
      // the write path (plan-supersession.loadSupersessionInputs).
      const ipoRow = (await deps.ipoRepository.findById(ipoId)) as unknown as Record<string, unknown> | null;
      const detailsRow = await deps.ipoDetailsReader.findByIpoId(ipoId).catch(() => null);
      const fixedPrice = isFixedPriceIssue(
        (detailsRow?.issueType as string | null | undefined) ?? null,
        ipoRow?.priceRangeMin == null ? null : Number(ipoRow.priceRangeMin),
        ipoRow?.priceRangeMax == null ? null : Number(ipoRow.priceRangeMax)
      );
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
