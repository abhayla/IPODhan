/**
 * NSE DRHP d88fad44 yield fields (owner offer-document test session 2026-10-04): the values the
 * extractor now reads off the real document (scraper/scripts/test_issuer_balance_rows.py,
 * test_extract_filing_offering_headline.py) reach their columns.
 *
 *  - fields 4-5: a stated-nil fresh leg is 0 (spec row 35); the OFS count is the total at the floor.
 *  - fields 8-10, 13: roe, reserves_and_surplus, total_assets (crore), pre_ipo_eps (C6 sign rule).
 *  - D4: the cover name is always recorded and written only to an empty column.
 *  - D5: the printed bidding hours, varchar(50) refused not cut.
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

const IPO_ID = 'b7c1d2e3-0f2e-4b9a-9f0c-1d2e3f4a5b6e';
const NAME = 'National Stock Exchange of India Limited';

function nseDrhp(over: Record<string, unknown> = {}): FilingExtraction {
  const values: Record<string, unknown> = {
    issue_price_type: 'BOOK_BUILDING',
    face_value: 1,
    shares_at_floor: 0,
    shares_at_cap: 0,
    ofs_shares: 148905525,
    total_offer_shares_at_cap: 148905525,
    total_offer_shares_at_floor: 148905525,
    issue_structure: 'OFS_ONLY',
    fresh_issue_amount: 0,
    company_name: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED',
    ipo_market_timings: '10.00 a.m. to 5.00 p.m.',
    bid_windows: [{ activity: 'Submission and Revision in Bids', window: 'Only between 10.00 a.m. and 5.00 p.m. IST' }],
    pat_by_fy: { '2026': 103020.61, '2025': 121876.89, '2024': 83057.41 },
    eps_basic_by_fy: { '2026': 41.62, '2025': 49.24, '2024': 33.56 },
    total_assets_by_fy: { '2026': 879374.42, '2025': 694666.38, '2024': 654639.78 },
    reserves_by_fy: { '2026': 318660.41, '2025': 301058.26, '2024': 239249.05 },
    roe_by_fy: { '2026': 32.98, '2025': 44.87, '2024': 37.37 },
    ...over,
  };
  const fields: FilingExtraction['fields'] = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
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

function makeDeps(storedName: string | null = NAME) {
  const detailsUpsert = vi.fn(async () => undefined);
  const valuationUpsert = vi.fn(async (r: unknown) => r);
  const fdUpsert = vi.fn(async (r: unknown) => r);
  const deps = {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: storedName,
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
    financialData: { upsert: fdUpsert },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: detailsUpsert },
    documentFilingDateWriter: { setFilingDate: vi.fn(async () => 1) },
  } as unknown as FilingPersisterDeps;
  return { deps, detailsUpsert, valuationUpsert, fdUpsert };
}

const persist = (deps: FilingPersisterDeps, over: Record<string, unknown> = {}) =>
  persistFilingExtraction(IPO_ID, nseDrhp(over), { docType: 'DRHP', apply: true, documentId: 'd88fad44' }, deps);

const details = (s: ReturnType<typeof makeDeps>) =>
  (s.detailsUpsert.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
const fd = (s: ReturnType<typeof makeDeps>) => (s.fdUpsert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;

describe('NSE DRHP yield fields reach their columns', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it('fields 4-5: fresh issue 0 (stated not applicable) and total shares at floor = the OFS count', async () => {
    const s = makeDeps();
    await persist(s.deps);
    expect(details(s).freshIssue).toBe('0');
    expect((s.valuationUpsert.mock.calls[0] as unknown[])[0]).toMatchObject({ totalSharesAtFloor: 148905525 });
  });

  it('fields 8-10, 13: roe %, reserves and total assets in crore, pre-IPO EPS = latest FY basic EPS', async () => {
    const s = makeDeps();
    await persist(s.deps);
    expect(fd(s)).toMatchObject({
      roe: '32.98',
      totalAssets: '87937.44',
      reservesAndSurplus: '31866.04',
      preIpoEps: '41.62',
      eps: '41.62',
    });
  });

  it('C6: a pre-IPO EPS whose sign differs from PAT is not written; an absent series writes nothing', async () => {
    const s = makeDeps();
    await persist(s.deps, { pat_by_fy: { '2026': -5, '2025': 1, '2024': 1 } });
    expect(fd(s).preIpoEps).toBeUndefined();
    const t = makeDeps();
    await persist(t.deps, { roe_by_fy: undefined, total_assets_by_fy: undefined, reserves_by_fy: undefined });
    expect(fd(t).roe).toBeUndefined();
    expect(fd(t).totalAssets).toBeUndefined();
    expect(fd(t).reservesAndSurplus).toBeUndefined();
  });

  it('roe outside numeric(5,2) is skipped alone, never aborting the financial_data write', async () => {
    const s = makeDeps();
    const summary = await persist(s.deps, { roe_by_fy: { '2026': -1200, '2025': 1, '2024': 1 } });
    expect(fd(s).roe).toBeUndefined();
    expect(fd(s).totalAssets).toBe('87937.44');
    expect(summary.skipped_no_column.join(' ')).toContain('ratio_out_of_numeric_range:roe');
  });

  it('D4: the cover name is recorded but a stored name is never replaced', async () => {
    const s = makeDeps(NAME);
    const summary = await persist(s.deps);
    const rec = (summary.receipt_fields ?? []).filter((r) => r.tableName === 'ipos' && r.fieldName === 'companyName');
    expect(rec.map((r) => r.value)).toEqual(['NATIONAL STOCK EXCHANGE OF INDIA LIMITED']);
    expect((upsertIPOMock.mock.calls[0] as unknown[])[1]).toMatchObject({ companyName: NAME });
  });

  it('D4: an empty stored name is filled from the cover', async () => {
    const s = makeDeps('  ');
    await persist(s.deps);
    expect((upsertIPOMock.mock.calls[0] as unknown[])[1]).toMatchObject({
      companyName: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED',
    });
  });

  it('D5: bidding hours and bid windows are written; text over 50 chars is refused, not cut', async () => {
    const s = makeDeps();
    await persist(s.deps);
    expect(details(s)).toMatchObject({
      ipoMarketTimings: '10.00 a.m. to 5.00 p.m.',
      bidWindows: [{ activity: 'Submission and Revision in Bids', window: 'Only between 10.00 a.m. and 5.00 p.m. IST' }],
    });
    const t = makeDeps();
    const summary = await persist(t.deps, { ipo_market_timings: 'x'.repeat(51) });
    expect(details(t).ipoMarketTimings).toBeUndefined();
    expect(summary.skipped_failed_check.join(' ')).toContain('ipoMarketTimings: 51 chars');
  });

  // Step-0 round 3 (fields 1-7): values the offer-document readers read off the real NSE DRHP
  // (scraper/scripts/test_offer_doc_statements.py) reach their columns.
  it('rows 69/66 (D10): nil total borrowing writes 0 crore and debt-to-equity 0', async () => {
    const s = makeDeps();
    await persist(s.deps, { total_borrowing: 0, debt_to_equity: 0 });
    expect(fd(s)).toMatchObject({ totalBorrowing: '0', debtToEquity: '0' });
  });

  it('row 69: a printed total borrowing is converted from the document unit to crore', async () => {
    const s = makeDeps();
    await persist(s.deps, { total_borrowing: 11345.0, debt_to_equity: 0.63 });
    expect(fd(s)).toMatchObject({ totalBorrowing: '1134.5', debtToEquity: '0.63' });
  });

  it('rows 69/66: no answer writes nothing (a walk value is left alone)', async () => {
    const s = makeDeps();
    await persist(s.deps);
    expect(fd(s).totalBorrowing).toBeUndefined();
    expect(fd(s).debtToEquity).toBeUndefined();
  });

  it('step-3a A5: a debt-to-equity whose total borrowing is not written is not written either', async () => {
    const s = makeDeps();
    await persist(s.deps, { total_borrowing: undefined, debt_to_equity: 0.63 });
    expect(fd(s).totalBorrowing).toBeUndefined();
    expect(fd(s).debtToEquity).toBeUndefined();
  });

  it('row 75: financial_data.ronw is the latest full fiscal year of the RoNW rows', async () => {
    const s = makeDeps();
    await persist(s.deps, { ronw_by_fy: { '2026': 33.21, '2025': 45.14, '2024': 37.6 } });
    expect(fd(s).ronw).toBe('33.21');
  });

  it('row 102: ipo_valuation.ronw_weighted_3y is the printed weighted average', async () => {
    const s = makeDeps();
    await persist(s.deps, { weighted_average_ronw: 37.92 });
    expect((s.valuationUpsert.mock.calls[0] as unknown[])[0]).toMatchObject({ ronwWeighted3y: '37.92' });
  });

  it('rows 92 + rent: op cash flow and rent expense land on each fiscal-year statement row', async () => {
    const s = makeDeps();
    await persist(s.deps, {
      revenue_by_fy: { '2026': 166013.09, '2025': 171406.78, '2024': 147800.11 },
      op_cash_flow_by_fy: { '2026': 238361.75, '2025': 40914.87, '2024': 297442.79 },
      rent_by_fy: { '2026': 50.72, '2025': 43.08, '2024': 55.65 },
    });
    const rows = (s.deps.financialStatements.upsert as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as Record<string, unknown>
    );
    const fy2026 = rows.find((r) => r.fiscalYear === 2026)!;
    expect(fy2026).toMatchObject({ opCashFlow: '238361.75', rentExpense: '50.72', unit: 'MILLION' });
  });

  it('row 176: the peer row basis cell reaches peer_companies.financial_statement_type', async () => {
    const s = makeDeps();
    const peers = [
      { name: 'BSE Limited', financial_statement_type: 'Consolidated', pe: '66.67', eps_basic: '60.61', nav: '163.60', is_listed: true },
      { name: 'Other Peer Limited', financial_statement_type: 'Consolidat ed', pe: '10.00', eps_basic: '1.00', is_listed: true },
    ];
    await persist(s.deps, { peer_companies: peers });
    const written = (s.deps.peerCompanies.replaceForIpo as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>[];
    expect(written.map((r) => r.financialStatementType)).toEqual(['CONSOLIDATED', undefined]);
  });
});
