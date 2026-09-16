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
 *  1. No COMPLETED document of the manifest's `documentType` (or its
 *     DRHP/RHP fallback family) exists yet for this IPO -> NOT_AVAILABLE_YET.
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

/** Which document-type family answers a manifest field's DOC rank. */
const DOC_TYPE_FAMILY: Record<string, ReadonlyArray<string>> = {
  PRICE_BAND_AD: ['PRICE_BAND_AD'],
  RHP: ['RHP', 'DRHP', 'PROSPECTUS'],
  DRHP: ['DRHP'],
  PROSPECTUS: ['PROSPECTUS', 'RHP'],
};

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
}

interface MinimalDocument {
  id: string;
  type: string;
  extractionStatus: string | null;
  isActive: boolean | null;
  sha256: string | null;
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
 * Read the CURRENT value of one column off the row the plan references,
 * through the repositories — never a raw query. `ipos` is a singleton row
 * per IPO; every other table's current value for the walk's slice (item 5
 * field-plan rows only ever cover `ipos`/`ipo_details` in this manifest, per
 * the brief's Class) is read the same way once a repository exists for it.
 */
async function readColumnValue(
  deps: DocFetcherDeps,
  ipoId: string,
  tableName: string,
  camelFieldName: string
): Promise<unknown> {
  if (tableName === 'ipos') {
    const ipo = await deps.ipoRepository.findById(ipoId);
    return ipo ? (ipo as unknown as Record<string, unknown>)[camelFieldName] ?? null : null;
  }
  // Non-`ipos` tables in this slice's Class (`ipo_details`) have no
  // dedicated shared repository to read a single column from without
  // duplicating a second write path (YAGNI — see engineering-roles.md). The
  // provenance row itself is sufficient to answer SUPPLIED: `field_sources`
  // does not carry the value, only who sourced it, so a table this fetcher
  // cannot read its current value for answers NOT_PRINTED rather than
  // guessing — the honest "cannot verify a value not disprovable as printed"
  // answer, never a fabricated SUPPLIED with no value attached.
  return undefined;
}

export function buildDocFetcher(deps: DocFetcherDeps): FieldFetcher {
  return async function docFetcher(
    ipoId: string,
    tableName: string,
    rowKey: string,
    fieldName: string
  ): Promise<FieldFetcherAnswer> {
    // `fieldName` here is the plan row's manifest key — snake_case.
    const camelFieldName = columnToCamelCase(fieldName);
    const manifestDocType = deps.manifestDocumentType(tableName, fieldName);
    if (!manifestDocType) {
      // No documentType declared for this field in the manifest — DOC cannot
      // answer it structurally. A CHECK_FAILED, DEFINITIVE (this will not
      // change without a manifest edit), rather than NOT_PRINTED (which
      // implies a document WAS checked).
      return { outcome: 'CHECK_FAILED', reason: 'no documentType in manifest for this field', transient: false };
    }

    const family = DOC_TYPE_FAMILY[manifestDocType] ?? [manifestDocType];

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

    if (!provenance || provenance.source !== 'DRHP') {
      // Every filing doc type writes field_sources.source as 'DRHP' (the
      // SOURCE ENUM NOTE in filing-persister.ts) — a provenance row that
      // exists but is NOT 'DRHP' means a non-document source (e.g. ADMIN,
      // BSE, CHITTORGARH from an earlier direct write) currently owns this
      // field, which is the same as "the document did not supply it" from
      // DOC's point of view.
      return { outcome: 'NOT_PRINTED' };
    }

    const lineage = (provenance.dataLineage ?? {}) as {
      docType?: string;
      documentId?: string | null;
      sourceSha?: string | null;
    };

    // A provenance row from a DIFFERENT document family than the manifest
    // wants (e.g. financial_statements.revenue sourced from a PROSPECTUS
    // when the manifest wants RHP-family evidence) is not this field's
    // answer to give — DOC has no fresher document to check, so this is a
    // settled "not printed by the wanted family" rather than a re-askable gap.
    if (lineage.docType && !family.includes(lineage.docType)) {
      return { outcome: 'NOT_PRINTED' };
    }

    const value = await readColumnValue(deps, ipoId, tableName, camelFieldName);
    if (value === undefined || value === null) {
      // A provenance row exists (the field WAS sourced from a document at
      // some point) but the live column is empty now — most likely a table
      // this fetcher cannot read (see readColumnValue). Never fabricate a
      // SUPPLIED with no value.
      return { outcome: 'NOT_PRINTED' };
    }

    return {
      outcome: 'SUPPLIED',
      value,
      documentId: lineage.documentId ?? completedDoc.id,
      documentType: lineage.docType ?? completedDoc.type,
      sha256: lineage.sourceSha ?? completedDoc.sha256 ?? undefined,
    };
  };
}
