/**
 * The ONE dependency builder for `persistFilingExtraction` (S-02).
 *
 * This used to be a private `buildDeps` inside `scraper/scripts/persist-filing.ts`,
 * which meant the only way to persist a filing was to run that CLI by hand. S-02
 * needs the same write door from inside the document cycle, and copying the
 * builder would have created a SECOND set of writers that could drift from the
 * CLI's (different protection filter, a missing risk-factor writer, a forgotten
 * `documents.filing_date` update) — the exact "two write doors" shape
 * `scraper-write-path.md` exists to prevent.
 *
 * So the builder moved here verbatim and the CLI imports it. There is one
 * builder, and both callers get the identical dependency set including the admin
 * field-protection filter.
 */

import { filterPatchUnderHold } from '@ipodhan/shared/services/field-hold';
import {
  db,
  filterProtectedFields,
  IPORepository,
  FinancialStatementsRepository,
  IpoValuationRepository,
  PromotersRepository,
  IpoIntermediariesRepository,
  BrlmTrackRecordRepository,
  FinancialDataRepository,
  FieldSourcesRepository,
  IpoRiskFactorsRepository,
  DocumentRepository,
  DataConflictsRepository,
  getRedisClient,
} from '@ipodhan/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import { FieldExtractionFailuresRepository } from '@ipodhan/shared/repositories';
import { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
import { DataConsolidationOrchestrator } from './data-consolidation-orchestrator.js';
import { FEATURE_FLAGS } from '../config/feature-flags.js';
import { LISTING_SENTENCE_ORDER } from '../../config/listing-sentence-precedence.mjs';
import { rebuildIpoPlanInTx, type PlanManifest } from '@ipodhan/shared/services/plan-invalidating-rebuild';
import { loadFieldManifest } from '../config/field-manifest-loader.js';
import type {
  DocumentFilingDateWriter,
  FilingPersisterDeps,
  IpoDetailsWriter,
} from './filing-persister.js';

/** ipo_details has no repository - this is the single write path for it. */
export function makeIpoDetailsWriter(): IpoDetailsWriter {
  return {
    async upsert(ipoId, values) {
      // §9.2 item 19: the conflict-update never replaces an admin-held ipo_details field; the hold
      // is re-read under the ipos row lock inside this transaction (field-hold.ts).
      await db.transaction(async (tx) => {
        const { patch, hold } = await filterPatchUnderHold(tx as never, ipoId, 'ipo_details', values as Record<string, unknown>);
        if (hold?.hidden) return; // §9.2 item 23 (OD-151): a hidden IPO's ipo_details row is left as stored.
        await tx
          .insert(schema.ipoDetails)
          .values({ ipoId, ...values, updatedAt: new Date() } as never)
          .onConflictDoUpdate({
            target: schema.ipoDetails.ipoId,
            set: { ...patch, updatedAt: new Date() } as never,
          });
      });
    },
    async insertIfMissing(ipoId, values) {
      const result = await db
        .insert(schema.ipoDetails)
        .values({ ipoId, ...values } as never)
        .onConflictDoNothing({ target: schema.ipoDetails.ipoId });
      return (result.rowCount ?? 0) > 0;
    },
    async fillIssueTypeIfNull(ipoId, issueType) {
      // NEVER an upsert: an upsert would overwrite a filing-sourced value with a
      // list-page one, and NOTHING ON THIS PATH would stop it.
      //
      // CORRECTED by item 1 slice s7b. The #569 wording said the table has no
      // priority mechanism at all. As of s7b that is false in general — the
      // filing persister's `ipo_details` write goes through
      // `consolidatedUpsertChildRows`, which consults `FIELD_PRIORITY_MATRIX`,
      // where `issueType` now ranks CHITTORGARH below DRHP. But this method is
      // the OTHER door: the report-82 job calls it directly, so no consolidation
      // and no rank runs for its writes. The `isNull` predicate is still the
      // whole ordering argument HERE - remove it and a DRHP value is clobbered,
      // which is exactly what this method's mutation test asserts.
      // §9.2 item 19: an admin who cleared issueType (OD-121: delete = keep empty) holds it; the
      // isNull predicate alone would refill it, so the hold is re-read under the ipos row lock.
      return db.transaction(async (tx) => {
        const { dropped } = await filterPatchUnderHold(tx as never, ipoId, 'ipo_details', { issueType });
        if (dropped.length > 0) return false;
        const result = await tx
          .update(schema.ipoDetails)
          .set({ issueType: issueType as never, updatedAt: new Date() })
          .where(
            and(eq(schema.ipoDetails.ipoId, ipoId), isNull(schema.ipoDetails.issueType))
          );
        return (result.rowCount ?? 0) > 0;
      });
    },
  };
}

/**
 * `documents.filing_date` is an UPDATE on the RHP row the discovery runner
 * already created — never an insert (see `DocumentFilingDateWriter`'s own
 * doc comment). Only RHP is wired here because that is the one doc type this
 * work package's writer scope covers; other doc types report 0 rows updated.
 */
export function makeDocumentFilingDateWriter(
  documentRepository: DocumentRepository
): DocumentFilingDateWriter {
  return {
    async setFilingDate({ ipoId, docType, filingDate }) {
      if (docType !== 'RHP') return 0;
      return documentRepository.setFilingDateForRhp(ipoId, filingDate);
    },
  };
}

/**
 * Build the full dependency set for `persistFilingExtraction`.
 *
 * `redis` is a parameter rather than resolved here so a caller that already
 * holds a client (the document cycle does) does not open a second one.
 */
export function buildFilingPersistDeps(
  redis: ReturnType<typeof getRedisClient> = getRedisClient()
): FilingPersisterDeps {
  const ipoRepository = new IPORepository(db, redis);
  const fieldSources = new FieldSourcesRepository(db, redis);

  // F-101: item 1's consolidated child-row writer was built across thirty
  // slices and NEVER reached the application, because this builder — the ONE
  // door both the CLI and the document cycle go through — never set it. The
  // interface's `?` made that type-check. Constructed HERE, from the `redis`
  // this builder already holds, so there is still exactly one write path and
  // no second Redis client.
  const childRowConsolidator = new DataConsolidationOrchestrator(
    ipoRepository,
    fieldSources,
    new DataConflictsRepository(db, redis),
    redis,
    new ListingPerformanceRepository(db, redis)
  );

  // Defence in depth, NOT the primary guard (that is the required type above).
  // Deliberately thrown here and not at scraper startup: a boot-time refusal
  // would stop the WHOLE production pipeline — subscriptions, GMP, listings —
  // over a filing-path wiring check. This fails exactly where the dependency is
  // needed, so a scraper that never persists a filing still runs.
  if (
    FEATURE_FLAGS.ENABLE_CHILD_TABLE_CONSOLIDATION &&
    typeof childRowConsolidator?.consolidatedUpsertChildRows !== 'function'
  ) {
    throw new Error(
      'buildFilingPersistDeps: ENABLE_CHILD_TABLE_CONSOLIDATION is ON but no ' +
        'childRowConsolidator.consolidatedUpsertChildRows is available — every ' +
        'child row would be written without per-field resolution or provenance ' +
        '(field_sources.row_key empty). Refusing to build a silently degraded ' +
        'dependency set.'
    );
  }

  return {
    ipoRepository,
    financialStatements: new FinancialStatementsRepository(db, redis),
    ipoValuation: new IpoValuationRepository(db, redis),
    promoters: new PromotersRepository(db, redis),
    intermediaries: new IpoIntermediariesRepository(db, redis),
    brlmTrackRecord: new BrlmTrackRecordRepository(db, redis),
    peerCompanies: new PeerCompanyRepository(db),
    // #545 (C): an attempted-but-empty promoters/peers section records its reason here (OD-62).
    fieldExtractionFailures: new FieldExtractionFailuresRepository(db, redis),
    financialData: new FinancialDataRepository(db, redis),
    fieldSources,
    ipoDetailsWriter: makeIpoDetailsWriter(),
    riskFactors: new IpoRiskFactorsRepository(db, redis),
    documentFilingDateWriter: makeDocumentFilingDateWriter(new DocumentRepository(db, redis)),
    childRowConsolidator,
    ocrPrecedence: makeOcrPrecedenceReader(),
    listingPrecedence: makeListingPrecedenceReader(),
    planRebuildInTx: makePlanRebuilder(),
    fieldManifest: loadFieldManifest(),
    protectionFilter: (
      id: string,
      table: string,
      data: Record<string, unknown>,
      scraperName: string
    ) => filterProtectedFields(id, table, data, scraperName, db, redis),
  };
}

/**
 * #1233 round 2 (section 2.8, section 9.2 item 18, OD-142): the plan rebuild for a document's board or
 * exchange claim, run INSIDE the `ipos` write transaction (`upsertIPO` option `inIposWriteTx`) through
 * THE rebuild the admin save uses. It takes the `ipos` row lock FOR NO KEY UPDATE first (the lock
 * `writeAdminFieldValue` and the plant take; re-taking it in the same transaction is a no-op) so the
 * rebuild never runs unlocked even if the write door changes. A throw rolls the board back.
 */
export function makePlanRebuilder(
  manifest: PlanManifest = loadFieldManifest() as unknown as PlanManifest,
  rebuild: typeof rebuildIpoPlanInTx = rebuildIpoPlanInTx
): NonNullable<import('./filing-persister.js').FilingPersisterDeps['planRebuildInTx']> {
  return async (txRaw, ipoId, before) => {
    const tx = txRaw as { execute: (q: unknown) => Promise<unknown> };
    await tx.execute(sql`SELECT 1 FROM ipos WHERE id = ${ipoId}::uuid FOR NO KEY UPDATE`);
    return rebuild(tx as never, ipoId, manifest, before as never);
  };
}

/**
 * #1233 round 2 (OD-129, OD-30): the documents the listing-sentence gate orders this one against.
 * Others = this IPO's active, COMPLETED documents of a listing-sentence type (the order in
 * scraper/config/listing-sentence-precedence.mjs), where a price band ad counts only when it named
 * the exchanges (a receipt for `ipos.listingExchanges` or `ipos.segment`, OD-129). `is_active IS NOT
 * FALSE` is the same filter the nightly check d_segment_document_board uses. Excludes this document.
 */
export function makeListingPrecedenceReader(
  database: Pick<typeof db, 'execute'> = db
): NonNullable<import('./filing-persister.js').FilingPersisterDeps['listingPrecedence']> {
  const rowsOf = (res: unknown) => ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as Array<Record<string, unknown>>;
  const types = Object.keys(LISTING_SENTENCE_ORDER);
  return {
    async listingDocuments(ipoId: string, documentId: string | null) {
      const self = documentId
        ? rowsOf(await database.execute(sql`SELECT filing_date::text AS filing_date FROM documents WHERE id = ${documentId}::uuid`))
        : [];
      const res = await database.execute(sql`
        SELECT d.id::text AS id, d.type::text AS doc_type, d.filing_date::text AS filing_date
          FROM documents d
         WHERE d.ipo_id = ${ipoId}::uuid
           AND d.is_active IS NOT FALSE
           AND d.extraction_status = 'COMPLETED'
           AND d.type::text IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})
           AND (${documentId}::uuid IS NULL OR d.id <> ${documentId}::uuid)
           AND (d.type::text <> 'PRICE_BAND_AD' OR EXISTS (
                 SELECT 1 FROM document_field_receipts r
                  WHERE r.document_id = d.id AND r.table_name = 'ipos' AND r.row_key = ''
                    AND r.field_name IN ('listingExchanges', 'segment') AND r.value IS NOT NULL))`);
      return {
        selfFilingDate: (self[0]?.filing_date as string | null | undefined) ?? null,
        others: rowsOf(res).map((r) => ({
          id: String(r.id),
          docType: String(r.doc_type),
          filingDate: (r.filing_date as string | null | undefined) ?? null,
        })),
      };
    },
  };
}

/**
 * OD-97: the reads the OCR-loses rule needs. A text read is a receipt one of this IPO's active
 * documents wrote with source_text 'TEXT'; it comes back WITH its document (type, filing_date,
 * sha256) so the persister ranks it against the OCR value's own document through the one
 * supersession rule. Receipts from before the mark existed (NULL) are unknown and never count.
 */
export function makeOcrPrecedenceReader(): NonNullable<import('./filing-persister.js').FilingPersisterDeps['ocrPrecedence']> {
  const rowsOf = (res: unknown) => ((res as { rows?: unknown[] }).rows ?? (res as unknown[])) as Array<Record<string, unknown>>;
  return {
    async textReceipts(ipoId: string, tableName: string, fieldName: string) {
      const res = await db.execute(sql`
        SELECT r.value, d.id::text AS id, d.type::text AS doc_type, d.filing_date::text AS filing_date, d.sha256
          FROM document_field_receipts r
          JOIN documents d ON d.id = r.document_id
         WHERE d.ipo_id = ${ipoId}::uuid
           AND d.is_active IS NOT FALSE
           AND r.table_name = ${tableName}
           AND r.row_key = ''
           AND r.field_name = ${fieldName}
           AND r.source_text = 'TEXT'
           AND r.value IS NOT NULL`);
      return rowsOf(res).map((r) => ({
        value: String(r.value),
        document: {
          id: String(r.id),
          docType: String(r.doc_type),
          filingDate: (r.filing_date as string | null) ?? null,
          sha256: (r.sha256 as string | null) ?? null,
        },
      }));
    },
    async documentRef(documentId: string) {
      const res = await db.execute(sql`
        SELECT d.id::text AS id, d.type::text AS doc_type, d.filing_date::text AS filing_date, d.sha256
          FROM documents d WHERE d.id = ${documentId}::uuid`);
      const [r] = rowsOf(res);
      return r
        ? { id: String(r.id), docType: String(r.doc_type), filingDate: (r.filing_date as string | null) ?? null, sha256: (r.sha256 as string | null) ?? null }
        : null;
    },
    async storedDetails(ipoId: string): Promise<Record<string, unknown> | null> {
      const [row] = await db.select().from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, ipoId)).limit(1);
      return (row as Record<string, unknown> | undefined) ?? null;
    },
  };
}
