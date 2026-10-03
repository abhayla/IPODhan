/**
 * F-244 / F-245 (owner offer-document test session 2026-10-03, NSE DRHP d88fad44).
 *
 * F-245: a DRHP's cover date ("DRAFT RED HERRING PROSPECTUS Dated: June 17, 2026") is that
 * DRHP's own filing date. It is written to the DRHP's documents row by id, never to the IPO's
 * RHP row. F-244: the price-independent facts a DRHP now reads (issue type, share counts) are
 * written only where no better document wrote the column (a DRHP is last in both OD-154 orders).
 * The values are the NSE DRHP cover's (scraper/scripts/fixtures/drhp-covers/drhp-covers.json).
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
import { makeDocumentFilingDateWriter } from '../../../src/services/filing-persist-deps';

const IPO_ID = 'b7c1d2e3-0f2e-4b9a-9f0c-1d2e3f4a5b6e';
const DRHP_DOC_ID = 'd88fad44-75ce-4d90-aec7-2bb9f97aa734';

/** The NSE DRHP cover as the F-244 extractor emits it. */
function nseDrhp(): FilingExtraction {
  const values: Record<string, unknown> = {
    rhp_filing_date: '2026-06-17',
    issue_price_type: 'BOOK_BUILDING',
    face_value: 1,
    shares_at_floor: 0,
    shares_at_cap: 0,
    ofs_shares: 148905525,
    total_offer_shares_at_cap: 148905525,
    issue_structure: 'OFS_ONLY',
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    fields[k] = { value: v, page: 0, check: { name: `${k}_check`, passed: true } };
  }
  return {
    doc_type: 'DRHP',
    source_doc: 'DRHP-d88fad44.pdf',
    pages: 614,
    extraction_status: 'OK',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields,
  };
}

function makeDeps(priorDocType: string | null = null) {
  const detailsUpsert = vi.fn(async () => undefined);
  const valuationUpsert = vi.fn(async (r: unknown) => r);
  const setFilingDate = vi.fn(async () => 1);
  const findByField = vi.fn(async () => {
    if (priorDocType === 'THROW') throw new Error('read failed');
    return priorDocType === null ? null : { dataLineage: { docType: priorDocType } };
  });
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'National Stock Exchange of India Limited',
        slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: ['BSE'],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: valuationUpsert },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    fieldSources: { findByField, trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: detailsUpsert },
    documentFilingDateWriter: { setFilingDate },
  } as unknown as FilingPersisterDeps;
  return { deps, detailsUpsert, valuationUpsert, setFilingDate };
}

const persist = (
  deps: FilingPersisterDeps,
  docType: 'DRHP' | 'RHP' | 'PRICE_BAND_AD',
  documentId?: string
) => persistFilingExtraction(IPO_ID, nseDrhp(), { docType, apply: true, documentId }, deps);

describe('F-245: a document cover date lands on that document row, by id', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('a DRHP writes 2026-06-17 to its own row and never to the RHP row', async () => {
    const s = makeDeps();
    const summary = await persist(s.deps, 'DRHP', DRHP_DOC_ID);
    expect(s.setFilingDate).toHaveBeenCalledTimes(1);
    expect(s.setFilingDate).toHaveBeenCalledWith({
      ipoId: IPO_ID,
      docType: 'DRHP',
      filingDate: '2026-06-17',
      documentId: DRHP_DOC_ID,
    });
    const types = s.setFilingDate.mock.calls.map((c) => (c as unknown as [{ docType: string }])[0].docType);
    expect(types).not.toContain('RHP');
    expect(summary.written.documents).toBe(1);
  });

  it('a DRHP with no document id writes no filing date at all (fail closed)', async () => {
    const s = makeDeps();
    const summary = await persist(s.deps, 'DRHP');
    expect(s.setFilingDate).not.toHaveBeenCalled();
    expect(summary.skipped_no_column.join(' ')).toContain('DRHP cover date with no document id');
  });

  it('an RHP with an id writes its own row by id; a price band ad still writes the RHP row by type', async () => {
    const r = makeDeps();
    await persist(r.deps, 'RHP', 'rhp-doc-id');
    expect(r.setFilingDate).toHaveBeenCalledWith({
      ipoId: IPO_ID,
      docType: 'RHP',
      filingDate: '2026-06-17',
      documentId: 'rhp-doc-id',
    });
    const a = makeDeps();
    await persist(a.deps, 'PRICE_BAND_AD', 'the-ad-document-id');
    expect(a.setFilingDate).toHaveBeenCalledWith({ ipoId: IPO_ID, docType: 'RHP', filingDate: '2026-06-17' });
  });

  it('the writer updates by id when given one, and never the RHP rows for a DRHP', async () => {
    const repo = {
      setFilingDateById: vi.fn(async () => 1),
      setFilingDateForRhp: vi.fn(async () => 1),
    };
    const w = makeDocumentFilingDateWriter(repo as never);
    expect(
      await w.setFilingDate({ ipoId: IPO_ID, docType: 'DRHP', filingDate: '2026-06-17', documentId: DRHP_DOC_ID })
    ).toBe(1);
    expect(repo.setFilingDateById).toHaveBeenCalledWith(IPO_ID, DRHP_DOC_ID, 'DRHP', '2026-06-17');
    expect(await w.setFilingDate({ ipoId: IPO_ID, docType: 'DRHP', filingDate: '2026-06-17' })).toBe(0);
    expect(repo.setFilingDateForRhp).not.toHaveBeenCalled();
  });
});

describe('F-244: a DRHP writes its price-independent facts only below every other document', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('no prior writer: issue type and the NSE share counts are written', async () => {
    const s = makeDeps(null);
    await persist(s.deps, 'DRHP', DRHP_DOC_ID);
    expect((s.detailsUpsert.mock.calls[0] as unknown[])[1]).toMatchObject({ issueType: 'BOOK_BUILDING' });
    expect((s.valuationUpsert.mock.calls[0] as unknown[])[0]).toMatchObject({
      pricingEvent: 'PROSPECTUS',
      ofsShares: 148905525,
      totalSharesAtCap: 148905525,
      sharesAtFloor: 0,
      sharesAtCap: 0,
      freshSharesAtFloor: 0,
      freshSharesAtCap: 0,
    });
  });

  it.each([['RHP'], ['PRICE_BAND_AD'], ['THROW']])(
    'a value from %s is kept: no DRHP issue type or share count',
    async (prior) => {
      const s = makeDeps(prior);
      const summary = await persist(s.deps, 'DRHP', DRHP_DOC_ID);
      const details = (s.detailsUpsert.mock.calls[0] as unknown[] | undefined)?.[1] as
        | Record<string, unknown>
        | undefined;
      expect(details?.issueType).toBeUndefined();
      const row = (s.valuationUpsert.mock.calls[0] as unknown[] | undefined)?.[0] as
        | Record<string, unknown>
        | undefined;
      expect(row?.ofsShares).toBeUndefined();
      expect(row?.totalSharesAtCap).toBeUndefined();
      expect(summary.skipped_lower_priority_source.join(' ')).toMatch(/ipo_details\.issueType/);
    }
  );

  it('a value an earlier DRHP wrote is replaced by the newer DRHP read', async () => {
    const s = makeDeps('DRHP');
    await persist(s.deps, 'DRHP', DRHP_DOC_ID);
    expect((s.detailsUpsert.mock.calls[0] as unknown[])[1]).toMatchObject({ issueType: 'BOOK_BUILDING' });
  });

  it('an RHP is not subject to the DRHP guard (no regression)', async () => {
    const s = makeDeps('PRICE_BAND_AD');
    await persist(s.deps, 'RHP', 'rhp-doc-id');
    expect((s.valuationUpsert.mock.calls[0] as unknown[])[0]).toMatchObject({ ofsShares: 148905525 });
  });
});
