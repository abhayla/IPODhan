/**
 * F-241 (OD-91, OD-164(a), §2.5.6 item 1): the per-document record (`document_field_receipts`)
 * covers EVERY table and side writer the filing persister writes from a document, not only
 * `ipos` and `ipo_details`.
 *
 * Before the fix the record was built only from `iposCandidate` and `details`: the NSE DRHP
 * (D:/Abhay/Ventures/IPODhan-doc-cache/national-stock-exchange-of-india-ltd/DRHP-d88fad44-...)
 * wrote financial_statements FY2024-26, 78 risk factors, a peer row and the company website, and
 * its record held 6 rows.
 *
 * Key shape: a child row's receipt carries that row's own identity as `row_key` - the SAME key
 * the persister files its keyed provenance and child-row consolidation under
 * (`financialStatementsRowKey`, `ipoValuationRowKey`, `rowKeyForName`, `headingHashForRiskFactor`,
 * `role:name`, the acquisition period). Singleton tables (`financial_data`, `ipos`, `documents`)
 * use ''. The IPO-level plan rows of the six child tables (row_key '') stay answered by the
 * section's `rows` provenance record (OD-164(a), item 38): no '' receipt is written for them.
 *
 * Values are the NSE DRHP's own extraction (fiscal years, revenue/PAT/net worth, the first two
 * risk factors, the BSE peer row, the website); promoters, acquisition ranges, valuation,
 * intermediaries and the BRLM track record are absent from that document (it states no
 * identifiable promoter), so those sections carry small labelled values to reach every writer.
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

const IPO_ID = 'd88fad44-0000-4000-8000-000000000241';
type Field = FilingExtraction['fields'][string];
const v = (value: unknown): Field =>
  ({ value, page: 1, check: { name: 'c', passed: true }, state: 'VALUE', source_text: 'TEXT' }) as unknown as Field;

const RISK_1 =
  'Any significant decrease in the volume and value of transactions executed on our stock exchange could significantly reduce demand for our products, constrain our growth, and adversely affect our business, financial condition, results of operations, cash flows, and prospects.';
const RISK_2 = 'We operate in a highly regulated industry, primarily overseen by SEBI.';

function nseDrhp(): FilingExtraction {
  return {
    doc_type: 'DRHP',
    source_doc: 'DRHP-d88fad44-75ce-4d90-aec7-2bb9f97aa734.pdf',
    pages: 500,
    extraction_status: 'OK',
    unit: 'millions',
    fiscal_years: [2026, 2025, 2024],
    fields: {
      // ---- the NSE DRHP's own values
      fiscal_years: v([2026, 2025, 2024]),
      unit: v('millions'),
      revenue_by_fy: v({ 2024: 147800.11, 2025: 171406.78, 2026: 166013.09 }),
      pat_by_fy: v({ 2024: 83057.41, 2025: 121876.89, 2026: 103020.61 }),
      net_worth_by_fy: v({ 2024: 238330.98, 2025: 301650.48, 2026: 318697.2 }),
      risk_factors: v([
        { n: 1, heading: RISK_1, body: 'We earn revenue based on trades executed on our stock exchange.' },
        { n: 2, heading: RISK_2, body: 'We are also subject to periodic inspections by SEBI.' },
      ]),
      peer_companies: v([
        { name: 'BSE Limited', pe: '66.67', eps_basic: '60.61', eps_diluted: '60.61', ronw_pct: '45.00%', nav: '163.60', is_listed: true },
      ]),
      company_website: v('www.nseindia.com'),
      rhp_filing_date: v('2026-06-17'),
      // ---- labelled values for sections the NSE DRHP does not print
      promoter_names: v(['Asha Promoter']),
      promoter_waca: v(12.5),
      waca_last_1y: v(10),
      cap_multiple_last_1y: v(2),
      weighted_average_ronw: v(18.4),
      lead_managers: v(['Kotak Mahindra Capital Company Limited']),
      brlm_track_record: v([{ brlm: 'Kotak Mahindra Capital Company Limited', issues_3y: 5, closed_below: 1 }]),
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

/** `table` -> sorted `rowKey|field=value` lines (the exact record, never a count above zero). */
function byTable(receipts: ReceiptField[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of receipts ?? []) (out[r.tableName] ??= []).push(`${r.rowKey}|${r.fieldName}=${r.value}`);
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

const H1 = headingHashForRiskFactor(RISK_1.slice(0, 500)) as string;
const H2 = headingHashForRiskFactor(RISK_2) as string;

describe('filing-persister - the record covers every table it writes (F-241, OD-91)', () => {
  beforeEach(() => {
    upsertIPOMock.mockClear();
    hintsMock.mockClear();
  });

  for (const apply of [true, false]) {
    it(`child tables and side writers are in the record, keyed by the child row (apply=${apply})`, async () => {
      const summary = await persistFilingExtraction(IPO_ID, nseDrhp(), { docType: 'DRHP', apply }, makeDeps());
      const t = byTable(summary.receipt_fields);

      expect(t.financial_statements).toEqual(
        [2024, 2025, 2026].flatMap((fy) => {
          const rev = { 2024: '147800.11', 2025: '171406.78', 2026: '166013.09' }[fy];
          const pat = { 2024: '83057.41', 2025: '121876.89', 2026: '103020.61' }[fy];
          const nw = { 2024: '238330.98', 2025: '301650.48', 2026: '318697.2' }[fy];
          const k = `${fy}:RESTATED`;
          return [`${k}|basis=RESTATED`, `${k}|fiscalYear=${fy}`, `${k}|netWorth=${nw}`, `${k}|pat=${pat}`, `${k}|revenue=${rev}`, `${k}|unit=MILLION`];
        }).sort()
      );
      expect(t.financial_data).toEqual(
        [
          '|netWorth=31869.72',
          '|profitFy2024=8305.74',
          '|revenueFy2024=14780.01',
        ].sort()
      );
      expect(t.ipo_risk_factors).toEqual(
        [
          `${H1}|body=We earn revenue based on trades executed on our stock exchange.`,
          `${H1}|heading=${RISK_1}`,
          `${H2}|body=We are also subject to periodic inspections by SEBI.`,
          `${H2}|heading=${RISK_2}`,
        ].sort()
      );
      expect(t.peer_companies).toEqual(
        [
          'bse|companyName=BSE Limited',
          'bse|dilutedEps=60.61',
          'bse|eps=60.61',
          'bse|isListed=true',
          'bse|nav=163.6',
          'bse|peRatio=66.67',
          'bse|ronw=45',
        ].sort()
      );
      expect(t.promoters).toEqual(['asha promoter|name=Asha Promoter', 'asha promoter|waca=12.5']);
      expect(t.promoter_acquisition_ranges).toEqual(['1Y|capMultiple=2', '1Y|period=1Y', '1Y|waca=10']);
      expect(t.ipo_valuation).toEqual(['PROSPECTUS|ronwWeighted3y=18.4']);
      expect(t.ipo_intermediaries).toEqual([
        'BRLM:kotak mahindra capital|name=Kotak Mahindra Capital Company Limited',
        'BRLM:kotak mahindra capital|role=BRLM',
      ]);
      expect(t.brlm_track_record).toEqual(
        [
          'kotak mahindra capital:2026-06-17|asOfDate=2026-06-17',
          'kotak mahindra capital:2026-06-17|brlmName=Kotak Mahindra Capital Company Limited',
          'kotak mahindra capital:2026-06-17|closedBelowIssuePrice=1',
          'kotak mahindra capital:2026-06-17|issues3y=5',
        ].sort()
      );
      expect(t.documents).toEqual(['|filingDate=2026-06-17']);
      // NSE's own cover website is an exchange host: E7 refuses it, so it is neither written nor
      // recorded. The only `ipos` receipt is the cover's lead managers.
      expect(t.ipos).toEqual(['|leadManagers=["Kotak Mahindra Capital Company Limited"]']);
      expect(hintsMock).not.toHaveBeenCalled();
      // A record is not provenance (OD-91): no '' receipt for a keyed child table's IPO-level row.
      for (const table of ['financial_statements', 'ipo_risk_factors', 'peer_companies', 'promoters', 'promoter_acquisition_ranges', 'ipo_intermediaries', 'ipo_valuation', 'brlm_track_record']) {
        expect(t[table].every((line) => !line.startsWith('|'))).toBe(true);
      }
    });
  }

  // Nityas Gems and Jewellery DRHP cover (scraper/tests/fixtures/cover-block/nityas-mainboard-drhp.json).
  const withWebsite = (): FilingExtraction => {
    const x = nseDrhp();
    return { ...x, fields: { ...x.fields, company_website: v('www.citygirljewellery.co.in') } } as FilingExtraction;
  };
  const websiteReceipts = (s: Awaited<ReturnType<typeof persistFilingExtraction>>) =>
    (s.receipt_fields ?? []).filter((r) => r.fieldName === 'companyWebsite').map((r) => `${r.tableName}|${r.rowKey}|${r.value}`);

  it('an issuer website is recorded in the stored shape, written to an empty column, and recorded when write-once keeps a stored one', async () => {
    const empty = await persistFilingExtraction(IPO_ID, withWebsite(), { docType: 'DRHP', apply: true }, makeDeps());
    expect(websiteReceipts(empty)).toEqual(['ipos||https://www.citygirljewellery.co.in']);
    expect(hintsMock).toHaveBeenCalledTimes(1);

    hintsMock.mockClear();
    const deps = makeDeps();
    (deps.ipoRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: IPO_ID, companyName: 'Nityas', slug: 'nityas-gems-and-jewellery-ltd', segment: 'MAINBOARD', offeringType: 'IPO',
      status: 'UPCOMING', listingExchanges: [], companyWebsite: 'https://www.other.example.in',
    });
    const stored = await persistFilingExtraction(IPO_ID, withWebsite(), { docType: 'DRHP', apply: true }, deps);
    expect(websiteReceipts(stored)).toEqual(['ipos||https://www.citygirljewellery.co.in']);
    expect(hintsMock).not.toHaveBeenCalled();
  });

  it('BRLM and REGISTRAR rows held from another source are written but never recorded as this document\'s (OD-91)', async () => {
    const x = nseDrhp();
    const noCoverRead = { ...x, fields: { ...x.fields, lead_managers: v(null) } } as FilingExtraction;
    const deps = makeDeps();
    (deps.ipoRepository.findById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: IPO_ID, companyName: 'National Stock Exchange of India Limited', slug: 'national-stock-exchange-of-india-ltd',
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', listingExchanges: [],
      leadManagers: ['Other Source Capital Limited'], registrar: 'Other Source Registrar Private Limited',
    });
    const summary = await persistFilingExtraction(IPO_ID, noCoverRead, { docType: 'DRHP', apply: true }, deps);
    const written = (deps.intermediaries.replaceForIpo as ReturnType<typeof vi.fn>).mock.calls.flat(2) as Array<{ role?: string; name?: string }>;
    expect(written.some((r) => r?.role === 'BRLM' && r?.name === 'Other Source Capital Limited')).toBe(true);
    const intermediaryReceipts = (summary.receipt_fields ?? []).filter((r) => r.tableName === 'ipo_intermediaries');
    expect(intermediaryReceipts.filter((r) => r.rowKey.startsWith('BRLM:') || r.rowKey.startsWith('REGISTRAR:'))).toEqual([]);
  });

  it('a price band advert outside the website family leaves no website receipt (OD-96)', async () => {
    const x = withWebsite();
    const summary = await persistFilingExtraction(IPO_ID, { ...x, doc_type: 'PRICE_BAND_AD' } as FilingExtraction, { docType: 'PRICE_BAND_AD', apply: false }, makeDeps());
    expect(websiteReceipts(summary)).toEqual([]);
  });
});

/**
 * OD-97 (§2.2.1 "Image-only pages go to OCR, marked"): every receipt the persister writes carries
 * its mark - TEXT / OCR / MIXED - computed from the pages of the extractor fields the value came
 * from, the same mechanism as the `ipos` / `ipo_details` receipts. A null mark on a child receipt
 * made an OCR-only value indistinguishable from a text read (PR #1515 CI, the SteamHouse OCR ad).
 */
describe('filing-persister - every receipt carries its OD-97 mark (F-241 round 2)', () => {
  const marks = (receipts: ReceiptField[] | undefined) =>
    (receipts ?? []).map((r) => `${r.tableName}.${r.fieldName}=${r.sourceText}`).sort();

  it('the real SteamHouse price band ad (every page OCR) marks every receipt OCR with its page confidence', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const envelope = JSON.parse(
      readFileSync(resolve(__dirname, '../../fixtures/ocr/steamhouse-price-band-ad.envelope.json'), 'utf-8')
    ) as FilingExtraction;
    const summary = await persistFilingExtraction(IPO_ID, envelope, { docType: 'PRICE_BAND_AD', apply: true }, makeDeps());
    const receipts = summary.receipt_fields ?? [];
    expect(receipts.filter((r) => r.sourceText === null).map((r) => `${r.tableName}.${r.fieldName}`)).toEqual([]);
    expect(receipts.every((r) => r.sourceText === 'OCR')).toBe(true);
    const child = receipts
      .filter((r) => r.tableName !== 'ipos' && r.tableName !== 'ipo_details')
      .map((r) => `${r.tableName}|${r.rowKey}|${r.fieldName}=${r.value}|${r.sourceText}|${r.ocrConfidence}`)
      .sort();
    expect(child).toEqual(STEAMHOUSE_CHILD_RECEIPTS);
  });

  it('a document with no value on an OCR page marks every receipt, child tables included, TEXT', async () => {
    const x = { ...nseDrhp(), ocr_pages: [400] } as FilingExtraction;
    const summary = await persistFilingExtraction(IPO_ID, x, { docType: 'DRHP', apply: true }, makeDeps());
    const all = marks(summary.receipt_fields);
    expect(all.length).toBeGreaterThan(30);
    expect(all.filter((m) => !m.endsWith('=TEXT'))).toEqual([]);
  });

  it('a value read off an OCR page is marked OCR on its own child receipts only', async () => {
    const base = nseDrhp();
    const x = {
      ...base,
      ocr_pages: [40],
      fields: { ...base.fields, risk_factors: { ...base.fields.risk_factors, page: 40, ocr_confidence: 0.81 } },
    } as FilingExtraction;
    const summary = await persistFilingExtraction(IPO_ID, x, { docType: 'DRHP', apply: true }, makeDeps());
    const receipts = summary.receipt_fields ?? [];
    expect(receipts.filter((r) => r.sourceText === 'OCR').map((r) => `${r.tableName}.${r.fieldName}|${r.ocrConfidence}`).sort()).toEqual(
      ['ipo_risk_factors.body|0.81', 'ipo_risk_factors.body|0.81', 'ipo_risk_factors.heading|0.81', 'ipo_risk_factors.heading|0.81']
    );
    expect(receipts.filter((r) => r.sourceText !== 'OCR').every((r) => r.sourceText === 'TEXT')).toBe(true);
  });
});

/** The real SteamHouse ad's child receipts: values on OCR page 0 (0.7456), 1 (0.7497) and 3 (0.761). */
const STEAMHOUSE_CHILD_RECEIPTS: string[] = [
  "financial_data||revenueFy2024=3.77|OCR|0.7497",
  "financial_statements|2024:RESTATED|basis=RESTATED|OCR|0.7497",
  "financial_statements|2024:RESTATED|fiscalYear=2024|OCR|0.7497",
  "financial_statements|2024:RESTATED|revenue=37.74|OCR|0.7497",
  "financial_statements|2024:RESTATED|unit=MILLION|OCR|0.7497",
  "financial_statements|2025:RESTATED|basis=RESTATED|OCR|0.7497",
  "financial_statements|2025:RESTATED|fiscalYear=2025|OCR|0.7497",
  "financial_statements|2025:RESTATED|revenue=70.79|OCR|0.7497",
  "financial_statements|2025:RESTATED|unit=MILLION|OCR|0.7497",
  "financial_statements|2026:RESTATED|basis=RESTATED|OCR|0.7497",
  "financial_statements|2026:RESTATED|fiscalYear=2026|OCR|0.7497",
  "financial_statements|2026:RESTATED|revenue=74.29|OCR|0.7497",
  "financial_statements|2026:RESTATED|unit=MILLION|OCR|0.7497",
  "ipo_intermediaries|SUB_SYNDICATE:axis capital|name=Axis Capital Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:axis capital|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:hdfc securities|name=HDFC Securities Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:hdfc securities|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:iifl capital services|name=IIFL Capital Services Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:iifl capital services|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:jm financial serviceslimited|name=JM Financial ServicesLimited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:jm financial serviceslimited|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:kotak securities|name=Kotak Securities Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:kotak securities|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:lkp securities|name=LKP Securities Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:lkp securities|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:motilal oswal financial services|name=Motilal Oswal Financial Services Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:motilal oswal financial services|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:sbicap secunities|name=SBICAP Secunities Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:sbicap secunities|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:sharekhan|name=Sharekhan Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:sharekhan|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:smc global securities|name=SMC Global Securities Limited|OCR|0.761",
  "ipo_intermediaries|SUB_SYNDICATE:smc global securities|role=SUB_SYNDICATE|OCR|0.761",
  "ipo_valuation|PRICE_BAND_AD|faceValueMultipleCap=40.5|OCR|0.7456",
  "ipo_valuation|PRICE_BAND_AD|faceValueMultipleFloor=38.5|OCR|0.7456",
  "ipo_valuation|PRICE_BAND_AD|priceCap=81|OCR|0.7456",
  "ipo_valuation|PRICE_BAND_AD|priceFloor=77|OCR|0.7456",
  "ipo_valuation|PRICE_BAND_AD|ronwWeighted3y=24.14|OCR|0.7456",
];
