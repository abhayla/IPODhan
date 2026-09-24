/**
 * #993 — the filing path's `ipos` provenance write carries the document it came from.
 *
 * `persistFilingExtraction` built one `lineage` object (method, docType, documentId, sourceSha,
 * extractorVersion, sourceDoc) and passed it to every child-table and ipo_details provenance row,
 * but called `upsertIPO` without it. Every `ipos` field_sources row the filing path wrote therefore
 * had no `data_lineage.documentId` (staging 2026-09-25: 331 of 331 DRHP-source `ipos` rows), and the
 * item 6 DOC fetcher credited whichever COMPLETED document it found first instead of the one that
 * actually wrote the value.
 *
 * The fix threads the SAME lineage object into `upsertIPO` (6th argument), which hands it to the
 * one provenance writer (`DataConsolidationService.trackFieldSource` ->
 * `FieldSourcesRepository.trackFieldUpdate`). This test pins the persister half; the consolidation
 * half is `tests/integration/ipos-lineage-document-id.integration.test.ts` on ipodhan_test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock } = vi.hoisted(() => ({ upsertIPOMock: vi.fn(async () => 'ipo-id') }));
vi.mock('../../../src/services/data-persister.js', () => ({ upsertIPO: upsertIPOMock }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
} from '../../../src/services/filing-persister';

const IPO_ID = 'b3b0f3c6-0f2e-4b9a-9f0c-1d2e3f4a5b6d';
const DOCUMENT_ID = '124f3a6d-bb70-449e-87cb-e09b47f3f041';
const SHA = 'a'.repeat(64);

function cover(): FilingExtraction {
  const values: Record<string, unknown> = {
    headline_source: 'PROSPECTUS_COVER',
    issue_price_type: 'FIXED_PRICE',
    price_band_floor: 41,
    price_band_cap: 41,
    face_value: 10,
    lot_size: 3000,
    fresh_issue_amount: 1460.01,
    total_offer_amount_at_cap: 1460.01,
    ofs_amount: 0,
    ofs_amount_at_cap: 0,
    ofs_shares: 0,
    shares_at_floor: 3561000,
    shares_at_cap: 3561000,
    total_offer_shares_at_cap: 3561000,
    issue_structure: 'FRESH_ONLY',
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'PROSPECTUS',
    source_doc: 'prospectus_annu.pdf',
    pages: 3,
    extraction_status: 'OK',
    unit: 'lakhs',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(trackFieldUpdate = vi.fn(async () => ({}))): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'Annu Projects Limited',
        slug: 'annu-projects-ltd',
        segment: 'SME',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['BSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined) },
  } as unknown as FilingPersisterDeps;
}

describe('#993: the ipos provenance write carries the filing lineage', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('passes the document id, sha and doc type to upsertIPO', async () => {
    await persistFilingExtraction(
      IPO_ID,
      cover(),
      { docType: 'PROSPECTUS', apply: true, documentId: DOCUMENT_ID, sourceSha: SHA, extractorVersion: 'v-test' },
      makeDeps()
    );
    expect(upsertIPOMock).toHaveBeenCalledTimes(1);
    const lineage = (upsertIPOMock.mock.calls[0] as unknown[])[5] as Record<string, unknown> | undefined;
    expect(lineage).toMatchObject({
      method: 'FILING_EXTRACTION',
      docType: 'PROSPECTUS',
      documentId: DOCUMENT_ID,
      sourceSha: SHA,
      extractorVersion: 'v-test',
    });
  });

  it('is the SAME lineage the child-table provenance rows carry (one object, not a second shape)', async () => {
    const trackFieldUpdate = vi.fn(async () => ({}));
    await persistFilingExtraction(
      IPO_ID,
      cover(),
      { docType: 'PROSPECTUS', apply: true, documentId: DOCUMENT_ID, sourceSha: SHA, extractorVersion: 'v-test' },
      makeDeps(trackFieldUpdate)
    );
    const iposLineage = (upsertIPOMock.mock.calls[0] as unknown[])[5];
    const childLineages = trackFieldUpdate.mock.calls.map((c) => (c as unknown as [{ dataLineage: unknown }])[0].dataLineage);
    expect(childLineages.length).toBeGreaterThan(0);
    for (const l of childLineages) expect(l).toEqual(iposLineage);
  });
});
