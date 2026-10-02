// implements: item 43 round 2 (OD-164(e), OD-167, F-230, spec Appendix A rows 56-81) -- the Chittorgarh
// IPO detail page's financial table, KPI / valuation / shareholding tables, timetable and anchor bid
// date, served to the field-plan walk. Pages captured LIVE (fixtures + .meta.json provenance):
// Runwal Enterprises (mainboard, listed, 2026-10-02), Vishal Nirmiti (mainboard, open, 2026-10-03),
// Dove Soft (SME, 2026-10-03). Each value asserted here was checked against the page's printed cell.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
} from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';
import { readChittorgarhFinancialData, readChittorgarhIsin } from '../../../src/scrapers/chittorgarh-detail-financials.js';
import { isinCheckDigitValid } from '../../../src/scrapers/isin-check-digit.js';

const FIX = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../fixtures/chittorgarh');
const read = (f: string) => readFileSync(nodePath.join(FIX, f), 'utf8');
const IPO_ID = '00000000-0000-4000-8000-000000004343';
const repo = (companyName: string) => ({ findById: vi.fn().mockResolvedValue({ companyName }) }) as any;

const report82 = read('chittorgarh-report82-2026-10-02.json');
const RUNWAL = read('chittorgarh-runwal-enterprises-detail-2026-10-02.html');
const VISHAL = read('chittorgarh-vishal-nirmiti-detail-2026-10-03.html');
const DOVE = read('chittorgarh-dove-soft-detail-2026-10-03.html');
// Live pages with TWO KPI period columns (captured 2026-09-23, #916): Paluck prints a stub "Feb 28, 2026"
// before "Mar 31, 2025"; Kwick prints "Mar 31, 2026" | "Mar 31, 2025".
const PALUCK = read('chittorgarh-paluck-technologies-detail.html');
const KWICK = read('chittorgarh-kwick-forensic-solutions-detail.html');

const COMPANY: Record<string, string> = {
  runwal: 'Runwal Enterprises Limited',
  vishal: 'Vishal Nirmiti Limited',
  dove: 'Dove Soft Limited',
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(report82, { status: 200, headers: { 'content-type': 'application/json' } }))
  );
});
afterEach(() => vi.unstubAllGlobals());

const ask = (ipo: keyof typeof COMPANY, table: string, field: string, html: string) =>
  buildChittorgarhFetcher(
    { ipoRepository: repo(COMPANY[ipo]), isChittorgarhCapable: () => true, fetchDetailHtml: vi.fn().mockResolvedValue(html) },
    new ChittorgarhFieldFetcherState()
  )(IPO_ID, table, '', field);

const supplied = (value: unknown) => ({ outcome: 'SUPPLIED', value });
const ABSENT = { outcome: 'NOT_AVAILABLE_YET' };

describe('financial_data from the live detail pages (crore table, stored as printed)', () => {
  // [field, Runwal, Vishal Nirmiti, Dove Soft] -- every value is the printed cell.
  it.each([
    ['total_income_fy2024', 2436.68, 247.93, 119.79],
    ['profit_fy2024', 93.7, 3.45, 10.27],
    ['ebitda_fy2024', 201.73, 23.14, 14.77],
    ['net_worth', 768.2, 86.34, 70.69],
    ['reserves_and_surplus', 819.81, 66.98, 70.18],
    ['total_assets', 10254.5, 334.92, 164.4],
    ['total_borrowing', 2909.13, 87.42, 6.29],
    ['debt_to_equity', 3.29, 1.01, 0.13],
    ['pre_ipo_eps', 14.14, 12.61, 12.28],
    ['post_ipo_eps', 12.57, 9.46, 9.6],
    ['market_cap', 4507.61, 580.6, 270.69],
    ['promoter_holding_pre_issue', 95.16, 73.42, 74.32],
    ['promoter_holding_post_issue', 84.6, 49.4, 53.73],
  ])('financial_data.%s -> Runwal %s / Vishal %s / Dove %s', async (field, runwal, vishal, dove) => {
    expect(await ask('runwal', 'financial_data', field, RUNWAL)).toEqual(supplied(runwal));
    expect(await ask('vishal', 'financial_data', field, VISHAL)).toEqual(supplied(vishal));
    expect(await ask('dove', 'financial_data', field, DOVE)).toEqual(supplied(dove));
  });

  it('roe: the ROE row when printed (Vishal 33.67, not its RoNW 33.87); RoNW when no ROE row (OD-167, Runwal, cause says so)', async () => {
    expect(await ask('vishal', 'financial_data', 'roe', VISHAL)).toEqual(supplied(33.67));
    expect(await ask('vishal', 'financial_data', 'ronw', VISHAL)).toEqual(supplied(33.87));
    expect(await ask('runwal', 'financial_data', 'roe', RUNWAL)).toEqual({
      outcome: 'SUPPLIED',
      value: 27.24,
      cause: 'RoNW used for ROE (OD-167), FY2026',
    });
    expect(await ask('dove', 'financial_data', 'roe', DOVE)).toEqual(supplied(33.12));
  });

  it('ronw not printed (Dove Soft KPI has ROE only) -> absent, never the ROE value', async () => {
    expect(await ask('dove', 'financial_data', 'ronw', DOVE)).toEqual(ABSENT);
  });

  it('a fiscal year the table does not print (FY2022, FY2023 on these pages) -> absent, never 0', async () => {
    for (const f of ['total_income_fy2022', 'total_income_fy2023', 'profit_fy2023', 'ebitda_fy2022']) {
      expect(await ask('runwal', 'financial_data', f, RUNWAL)).toEqual(ABSENT);
    }
  });

  it('F-230: revenue is never read from "Total Income"; eps (restated basic) is not mapped -> NO_MAPPING gap', async () => {
    expect(await ask('runwal', 'financial_data', 'revenue_fy2024', RUNWAL)).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_MAPPING' });
    expect(await ask('runwal', 'financial_data', 'eps', RUNWAL)).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_MAPPING' });
  });

  it('market cap is the POST IPO column (spec row 72), not the Pre IPO 4007.44', async () => {
    expect(await ask('runwal', 'financial_data', 'market_cap', RUNWAL)).not.toEqual(supplied(4007.44));
  });
});

describe('fiscal years by the printed label, never by column position', () => {
  it('relabelling the first column "31 Mar 2026" -> "31 Mar 2023" makes its cell the FY2023 value', async () => {
    const html = RUNWAL.replace(/(<table[^>]*id='financialTable'[\s\S]*?)31 Mar 2026/, '$131 Mar 2023');
    expect(html).not.toBe(RUNWAL);
    expect(await ask('runwal', 'financial_data', 'total_income_fy2023', html)).toEqual(supplied(1850.79));
    expect(await ask('runwal', 'financial_data', 'total_income_fy2024', html)).toEqual(supplied(2436.68));
  });

  it('two columns for one fiscal year -> refused, never the first one', async () => {
    const html = RUNWAL.replace(/(<table[^>]*id='financialTable'[\s\S]*?)31 Mar 2025/, '$131 Mar 2024');
    expect(await ask('runwal', 'financial_data', 'total_income_fy2024', html)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: two columns for FY2024',
    });
  });

  it('balance-sheet snapshot takes the LATEST printed period, wherever it sits', async () => {
    // Swap the 2026 and 2024 header labels: the third column is now the latest period.
    const html = RUNWAL.replace(/(<table[^>]*id='financialTable'[\s\S]*?)31 Mar 2026([\s\S]*?)31 Mar 2024/, '$131 Mar 2024$231 Mar 2026');
    expect(await ask('runwal', 'financial_data', 'net_worth', html)).toEqual(supplied(372.65));
  });
});

describe('the table unit line is read, converted once, or refused', () => {
  const withUnit = (unit: string) => RUNWAL.split('Amount in &#8377; Crore').join(`Amount in &#8377; ${unit}`);

  it('a lakh table is converted to crore once (2,436.68 lakh -> 24.37 crore)', async () => {
    expect(await ask('runwal', 'financial_data', 'total_income_fy2024', withUnit('Lakh'))).toEqual(supplied(24.37));
  });

  it('a million table is converted to crore once (2,436.68 million -> 243.67 crore)', async () => {
    expect(await ask('runwal', 'financial_data', 'total_income_fy2024', withUnit('Million'))).toEqual(supplied(243.67));
  });

  it('an unknown unit is refused with the reason', async () => {
    expect(await ask('runwal', 'financial_data', 'net_worth', withUnit('Billion'))).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: financial table unit "billion" is not crore, lakh or million',
    });
  });

  it('a missing unit line is refused for money fields; KPI ratios are unaffected', async () => {
    const html = RUNWAL.split('Amount in &#8377; Crore').join('');
    expect(await ask('runwal', 'financial_data', 'total_assets', html)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: financial table unit line not found',
    });
    expect(await ask('runwal', 'financial_data', 'debt_to_equity', html)).toEqual(supplied(3.29));
  });

  it('a market cap cell without "Cr" is refused', async () => {
    const html = RUNWAL.replace('<td>₹4,507.61 Cr</td></tr>', '<td>₹4,507.61</td></tr>');
    expect(html).not.toBe(RUNWAL);
    expect(await ask('runwal', 'financial_data', 'market_cap', html)).toMatchObject({ outcome: 'CHECK_FAILED' });
  });
});

describe('fail closed on ambiguous rows and implausible values', () => {
  it('two different rows for one label -> refused', async () => {
    const html = RUNWAL.replace('Debt/Equity</a></span></td><td>3.29</td></tr>', 'Debt/Equity</a></span></td><td>3.29</td></tr><tr><td>Debt/Equity</td><td>9.99</td></tr>');
    expect(html).not.toBe(RUNWAL);
    expect(await ask('runwal', 'financial_data', 'debt_to_equity', html)).toMatchObject({ outcome: 'CHECK_FAILED' });
  });

  it('two promoter rows in the shareholding table -> refused', async () => {
    const html = RUNWAL.replace(/(<td>Public<\/td>)/, '<td>Promoters</td><td>50%</td><td>40%</td></tr><tr>$1');
    expect(html).not.toBe(RUNWAL);
    expect(await ask('runwal', 'financial_data', 'promoter_holding_pre_issue', html)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: two promoter rows in the shareholding table',
    });
  });

  it('a value outside the domain bounds is refused, never clamped', async () => {
    const html = RUNWAL.replace('Debt/Equity</a></span></td><td>3.29</td>', 'Debt/Equity</a></span></td><td>5000</td>');
    expect(html).not.toBe(RUNWAL);
    expect(await ask('runwal', 'financial_data', 'debt_to_equity', html)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: debtToEquity 5000 outside [0, 1000]',
    });
  });

  it('a page with no financial tables -> absent', async () => {
    expect(await ask('runwal', 'financial_data', 'net_worth', '<html><body>none</body></html>')).toEqual(ABSENT);
  });
});

describe('ipo_details timetable, face value, ISIN and the anchor bid date', () => {
  it.each([
    ['basis_of_allotment_date', '2026-09-30', '2026-10-06'],
    ['initiation_of_refunds_date', '2026-10-01', '2026-10-07'],
    ['credit_of_shares_date', '2026-10-01', '2026-10-07'],
  ])('ipo_details.%s -> Runwal %s / Dove Soft %s', async (field, runwal, dove) => {
    expect(await ask('runwal', 'ipo_details', field, RUNWAL)).toEqual(supplied(runwal));
    expect(await ask('dove', 'ipo_details', field, DOVE)).toEqual(supplied(dove));
  });

  it('ipo_details.face_value and isin from the same cells as ipos.*', async () => {
    expect(await ask('runwal', 'ipo_details', 'face_value', RUNWAL)).toEqual(supplied(2));
    expect(await ask('runwal', 'ipo_details', 'isin', RUNWAL)).toEqual(supplied('INE804W01029'));
  });

  it('anchor_investors.bid_date: Runwal "Thu, Sep 24, 2026"; not printed on an open IPO without anchors yet', async () => {
    expect(await ask('runwal', 'anchor_investors', 'bid_date', RUNWAL)).toEqual(supplied('2026-09-24'));
    expect(await ask('vishal', 'anchor_investors', 'bid_date', VISHAL)).toEqual(ABSENT);
  });

  it('two different printed dates for one timetable row -> refused', async () => {
    const extra = '<a title="Initiation of Refunds Description" href="#">Refund</a></span><span class="text-end">Fri, Oct 2, 2026</span>';
    expect(await ask('runwal', 'ipo_details', 'initiation_of_refunds_date', RUNWAL + extra)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'FAILED_VALIDATION: two different dates printed: Thu, Oct 1, 2026 / Fri, Oct 2, 2026',
    });
  });

  it('detail fetch failure -> CHECK_FAILED transient (page not read, not "not printed")', async () => {
    const r = await buildChittorgarhFetcher(
      {
        ipoRepository: repo(COMPANY.runwal),
        isChittorgarhCapable: () => true,
        fetchDetailHtml: vi.fn().mockRejectedValue(new Error('Chittorgarh detail HTTP 503')),
      },
      new ChittorgarhFieldFetcherState()
    )(IPO_ID, 'financial_data', '', 'net_worth');
    expect(r).toEqual({ outcome: 'CHECK_FAILED', reason: 'Chittorgarh detail HTTP 503', transient: true });
  });
});

describe('KPI table: the latest FULL fiscal year-end column by its printed label (review round 1, MAJOR)', () => {
  const kpi = (html: string) => {
    const r = readChittorgarhFinancialData(html);
    return { roe: r.get('roe'), ronw: r.get('ronw'), debtToEquity: r.get('debtToEquity') };
  };

  it('Paluck: "Feb 28, 2026" stub | "Mar 31, 2025" -> the FY2025 column (ROE 38.31, never the stub 30.31)', () => {
    expect(kpi(PALUCK)).toEqual({ roe: { value: 38.31 }, ronw: { value: 30.28 }, debtToEquity: { value: 0.55 } });
  });

  it('Kwick: "Mar 31, 2026" | "Mar 31, 2025" -> FY2026; its blank Debt/Equity cell stays absent, never FY2025', () => {
    expect(kpi(KWICK)).toEqual({ roe: { value: 38.98 }, ronw: { value: 32.62 }, debtToEquity: { absent: true } });
  });

  it('a stub-only KPI header is refused with the reason', () => {
    const html = PALUCK.replace('Mar 31, 2025</th>', 'Sep 30, 2025</th>');
    expect(html).not.toBe(PALUCK);
    expect(kpi(html).roe).toEqual({ refused: 'KPI header has no 31 March fiscal year-end column: ["Feb 28, 2026","Sep 30, 2025"]' });
  });

  it('an unreadable KPI period is refused', () => {
    const html = KWICK.replace('Mar 31, 2026</th>', 'FY26</th>');
    expect(html).not.toBe(KWICK);
    expect(kpi(html).ronw).toMatchObject({ refused: expect.stringContaining('unreadable period') });
  });

  it('a percentage KPI printed without "%" is refused; Debt/Equity needs none', () => {
    const html = RUNWAL.replace('<td>27.24%</td>', '<td>27.24</td>');
    expect(html).not.toBe(RUNWAL);
    expect(kpi(html).ronw).toEqual({ refused: 'ronw "27.24" is not printed as a percentage' });
    expect(kpi(html).debtToEquity).toEqual({ value: 3.29 });
  });
});

describe('unit and identifier guards (review round 1, MINORs)', () => {
  it('"Amount Invested" near the table is not a unit line (word boundary)', () => {
    const html = RUNWAL.split('Amount in &#8377; Crore').join('Amount Invested');
    expect(readChittorgarhFinancialData(html).get('netWorth')).toEqual({ refused: 'financial table unit line not found' });
  });

  it.each([
    ['₹4,507.61 Crore', { value: 4507.61 }],
    ['₹4,50,761 Lakh', { value: 4507.61 }],
    ['₹4,507.61', { refused: 'market cap "₹4,507.61" carries no crore or lakh unit' }],
    ['₹4,507.61 Bn', { refused: 'market cap "₹4,507.61 Bn" is unreadable' }],
  ])('market cap "%s" -> %j (converted or refused, never silently absent)', (cell, expected) => {
    const html = RUNWAL.replace('<td>₹4,507.61 Cr</td></tr>', `<td>${cell}</td></tr>`);
    expect(html).not.toBe(RUNWAL);
    expect(readChittorgarhFinancialData(html).get('marketCap')).toEqual(expected);
  });

  it('ISIN check digit: real INE804W01029 passes, a one-digit change fails', () => {
    expect(isinCheckDigitValid('INE804W01029')).toBe(true);
    expect(isinCheckDigitValid('INE804W01028')).toBe(false);
  });

  it.each([
    ['INE804W01028', 'ISIN "INE804W01028" fails the ISIN check digit'],
    ['US0378331005', 'ISIN "US0378331005" is not an INE + 9 character ISIN'],
  ])('ISIN cell "%s" is refused: %s', async (isin, reason) => {
    const html = RUNWAL.split('INE804W01029').join(isin);
    expect(readChittorgarhIsin(html)).toEqual({ refused: reason });
    expect(await ask('runwal', 'ipos', 'isin', html)).toEqual({ outcome: 'CHECK_FAILED', reason: `FAILED_VALIDATION: ${reason}` });
  });
});
