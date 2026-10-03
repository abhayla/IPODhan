/**
 * Spec rows 158 and 164-165 (offer documents): the BRLM investor grievance e-mail and the WACA
 * period table's "lowest - highest" acquisition price reach `ipo_intermediaries.grievance_email`
 * and `promoter_acquisition_ranges.price_low / price_high`.
 *
 * Values are the National Stock Exchange DRHP's own (d88fad44, pdf p90 and p107): Kotak's and JM's
 * grievance addresses (the text layer prints JM's on Kotak's line; the extractor reads them by word
 * position), and the selling-shareholder WACA table "Last one year 1,909.02 [*] 1,350.00 to 2,260.00".
 * Before this change both were dropped: price_low/price_high were always null and every BRLM row was
 * written with grievance_email null.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { upsertIPOMock, hintsMock } = vi.hoisted(() => ({
  upsertIPOMock: vi.fn(async () => 'ipo-id'),
  hintsMock: vi.fn(async () => undefined),
}));
vi.mock('../../../src/services/data-persister.js', () => ({
  upsertIPO: upsertIPOMock,
  recordDocumentSourceHints: hintsMock,
}));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  persistFilingExtraction,
  type FilingExtraction,
  type FilingPersisterDeps,
  type ReceiptField,
} from '../../../src/services/filing-persister';
import { headingHashForRiskFactor } from '@ipodhan/shared/utils/risk-factor-heading-key';


const IPO_ID = 'd88fad44-0000-4000-8000-000000000158';
type Field = FilingExtraction['fields'][string];
const v = (value: unknown): Field =>
  ({ value, page: 1, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;

const KOTAK = 'Kotak Mahindra Capital Company Limited';
const JM = 'JM Financial Limited';

function nseDrhp(fields: Record<string, Field> = {}): FilingExtraction {
  return {
    doc_type: 'DRHP',
    source_doc: 'DRHP-d88fad44-75ce-4d90-aec7-2bb9f97aa734.pdf',
    pages: 614,
    extraction_status: 'OK',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields: {
      rhp_filing_date: v('2026-06-17'),
      lead_managers: v([KOTAK, JM]),
      brlm_grievance_emails: v({ [KOTAK]: 'kmccredressal@kotak.com', [JM]: 'grievance.ibd@jmfl.com' }),
      waca_last_1y: v(1909.02),
      acquisition_price_range_1y: v({ low: 1350, high: 2260 }),
      waca_last_3y: v(229.23),
      ...fields,
    },
  } as unknown as FilingExtraction;
}

function makeDeps(): FilingPersisterDeps {
  return {
    ipoRepository: {
      findById: vi.fn(async () => ({
        id: IPO_ID,
        companyName: 'National Stock Exchange of India Limited',
        slug: 'national-stock-exchange-of-india-ltd',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
        listingExchanges: [],
      })),
    },
    financialStatements: { upsert: vi.fn(async (r: unknown) => r), listByIpo: vi.fn(async () => []) },
    ipoValuation: { upsert: vi.fn(async (r: unknown) => r) },
    promoters: { replacePromoters: vi.fn(async () => []), replaceAcquisitionRanges: vi.fn(async () => []) },
    intermediaries: { replaceForIpo: vi.fn(async () => []) },
    brlmTrackRecord: { upsert: vi.fn(async (r: unknown) => r) },
    peerCompanies: { replaceForIpo: vi.fn(async () => []) },
    riskFactors: { replaceForIpo: vi.fn(async () => []) },
    financialData: { upsert: vi.fn(async (r: unknown) => r) },
    documentFilingDateWriter: { setFilingDate: vi.fn(async () => 1) },
    fieldSources: { findByField: vi.fn(async () => null), trackFieldUpdate: vi.fn(async () => ({})) },
    ipoDetailsWriter: { upsert: vi.fn(async () => undefined), insertIfMissing: vi.fn(async () => false) },
  } as unknown as FilingPersisterDeps;
}


describe('filing-persister - offer-document grievance e-mail and WACA price range (rows 158, 164-165)', () => {
  beforeEach(() => upsertIPOMock.mockClear());

  it("files each BRLM grievance e-mail on that firm's own row", async () => {
    const deps = makeDeps();
    await persistFilingExtraction(IPO_ID, nseDrhp(), { docType: 'DRHP', apply: true }, deps);
    const rows = (deps.intermediaries.replaceForIpo as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<{
      role: string;
      name: string;
      grievanceEmail: string | null;
    }>;
    expect(rows.filter((r) => r.role === 'BRLM').map((r) => [r.name, r.grievanceEmail])).toEqual([
      [KOTAK, 'kmccredressal@kotak.com'],
      [JM, 'grievance.ibd@jmfl.com'],
    ]);
  });

  it("files no grievance e-mail when the held BRLM list is not the document's", async () => {
    const deps = makeDeps();
    await persistFilingExtraction(IPO_ID, nseDrhp({ lead_managers: v(null) }), { docType: 'DRHP', apply: true }, deps);
    const calls = (deps.intermediaries.replaceForIpo as ReturnType<typeof vi.fn>).mock.calls;
    const rows = (calls[0]?.[1] ?? []) as Array<{ grievanceEmail: string | null }>;
    expect(rows.every((r) => r.grievanceEmail === null)).toBe(true);
  });

  it('writes the printed lowest and highest acquisition price per period, null where not read', async () => {
    const deps = makeDeps();
    await persistFilingExtraction(IPO_ID, nseDrhp(), { docType: 'DRHP', apply: true }, deps);
    const rows = (deps.promoters.replaceAcquisitionRanges as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(rows.map((r) => [r.period, r.waca, r.priceLow, r.priceHigh])).toEqual([
      ['1Y', '1909.02', '1350', '2260'],
      ['3Y', '229.23', null, null],
    ]);
  });

  it('refuses a range whose low is above its high', async () => {
    const deps = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      nseDrhp({ acquisition_price_range_1y: v({ low: 2260, high: 1350 }) }),
      { docType: 'DRHP', apply: true },
      deps
    );
    const rows = (deps.promoters.replaceAcquisitionRanges as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(rows[0]).toMatchObject({ period: '1Y', priceLow: null, priceHigh: null });
  });
  it('step-3b B5: a period the document left empty keeps the row another source wrote', async () => {
    const deps = makeDeps();
    // The advertisement wrote an 18M row; the NSE DRHP's 18M row is read empty here.
    (deps.promoters as unknown as Record<string, unknown>).listAcquisitionRangesByIpo = vi.fn(async () => [
      { id: 'x', ipoId: IPO_ID, period: '18M', waca: '1747.54', capMultiple: null, priceLow: '800.00', priceHigh: '2260.00' },
      { id: 'y', ipoId: IPO_ID, period: '1Y', waca: '1.00', capMultiple: null, priceLow: null, priceHigh: null },
    ]);
    await persistFilingExtraction(IPO_ID, nseDrhp(), { docType: 'DRHP', apply: true }, deps);
    const rows = (deps.promoters.replaceAcquisitionRanges as ReturnType<typeof vi.fn>).mock.calls[0][1] as Array<
      Record<string, unknown>
    >;
    expect(rows.map((r) => [r.period, r.waca, r.priceLow, r.priceHigh])).toEqual([
      ['1Y', '1909.02', '1350', '2260'],
      ['3Y', '229.23', null, null],
      ['18M', '1747.54', '800.00', '2260.00'],
    ]);
  });

  it('step-3b B6 (D14): a null closed-below from the document never reaches the upsert', async () => {
    const deps = makeDeps();
    await persistFilingExtraction(
      IPO_ID,
      nseDrhp({ brlm_track_record: v([{ brlm: KOTAK, issues_3y: 37, closed_below: null }]) }),
      { docType: 'DRHP', apply: true },
      deps
    );
    const row = (deps.brlmTrackRecord.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({ brlmName: KOTAK, issues3y: 37 });
    expect('closedBelowIssuePrice' in row).toBe(false);
  });
});

