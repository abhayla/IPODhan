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
  getRedisClient,
} from '@ipodhan/shared';
import * as schema from '@ipodhan/shared/db/schema';
import { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
import type {
  DocumentFilingDateWriter,
  FilingPersisterDeps,
  IpoDetailsWriter,
} from './filing-persister.js';

/** ipo_details has no repository - this is the single write path for it. */
export function makeIpoDetailsWriter(): IpoDetailsWriter {
  return {
    async upsert(ipoId, values) {
      await db
        .insert(schema.ipoDetails)
        .values({ ipoId, ...values, updatedAt: new Date() } as never)
        .onConflictDoUpdate({
          target: schema.ipoDetails.ipoId,
          set: { ...values, updatedAt: new Date() } as never,
        });
    },
    async insertIfMissing(ipoId, values) {
      const result = await db
        .insert(schema.ipoDetails)
        .values({ ipoId, ...values } as never)
        .onConflictDoNothing({ target: schema.ipoDetails.ipoId });
      return (result.rowCount ?? 0) > 0;
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
  return {
    ipoRepository: new IPORepository(db, redis),
    financialStatements: new FinancialStatementsRepository(db, redis),
    ipoValuation: new IpoValuationRepository(db, redis),
    promoters: new PromotersRepository(db, redis),
    intermediaries: new IpoIntermediariesRepository(db, redis),
    brlmTrackRecord: new BrlmTrackRecordRepository(db, redis),
    peerCompanies: new PeerCompanyRepository(db),
    financialData: new FinancialDataRepository(db, redis),
    fieldSources: new FieldSourcesRepository(db, redis),
    ipoDetailsWriter: makeIpoDetailsWriter(),
    riskFactors: new IpoRiskFactorsRepository(db, redis),
    documentFilingDateWriter: makeDocumentFilingDateWriter(new DocumentRepository(db, redis)),
    protectionFilter: (
      id: string,
      table: string,
      data: Record<string, unknown>,
      scraperName: string
    ) => filterProtectedFields(id, table, data, scraperName, db, redis),
  };
}
