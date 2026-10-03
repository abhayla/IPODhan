/**
 * Item 43 (OD-164(e), spec §1.2 NSE row, §2.5.6 item 5 "printed -> mapped"): the NSE walk fetcher
 * maps the `/api/ipo-detail` `issueInfo` rows Appendix A ranks NSE for -- registrar, lead managers,
 * face value, issue type, sponsor banks, tick size, market timings, UPI cut-off, employee discount,
 * maximum retail / employee subscription, categories, UPI sub-categories -- from the SAME per-IPO,
 * per-cycle ipo-detail read #1486 added (identity proven by symbol AND company name).
 *
 * Fixtures are REAL NSE replies (scraper/tests/fixtures/nse/ipo-detail-*.live-2026-10-03.json,
 * provenance in the .meta.json siblings): RUNWALENTR (closed mainboard), MONEYVIEW (listed
 * mainboard), EVENTIONS (open SME), GREENASIA (listed SME, "Revised" rows).
 *
 * Answer states (OD-60 empty = abstention; OD-145 unknown != absence):
 *   detail states the value               -> SUPPLIED (the parsed value, in the column's shape)
 *   detail prints NA / "-" / no such row  -> NOT_AVAILABLE_YET (abstention)
 *   detail request failed                 -> CHECK_FAILED with the cause
 *   two rows with the label / unparseable / out of the column's range -> CHECK_FAILED (fail closed)
 *   identity unproven (another symbol, no company name -- every SME reply) -> CHECK_FAILED
 *   no ACTIVE NSE key                     -> NOT_AVAILABLE_YET, no request
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNseFetcher, NseFieldFetcherState, NSE_DETAIL_ONLY_FIELDS } from '../../../src/services/field-plan-walk-nse-fetcher.js';
import { readNseDetailRowFields, type DataRow } from '../../../src/scrapers/nse-detail-fields.js';

vi.mock('../../../src/scrapers/nse-scraper.js', () => ({
  scrapeNSEIPOs: vi.fn(async () => ({ ipos: [], subscriptions: [] })),
}));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/nse');
const rawFixture = (sym: string) => readFileSync(join(FIXTURES, `ipo-detail-${sym}.live-2026-10-03.json`), 'utf8');
const fixture = (sym: string) => JSON.parse(rawFixture(sym));
const rowsOf = (sym: string) => fixture(sym).issueInfo.dataList as DataRow[];

const IPO_ID = '33333333-3333-3333-3333-333333333333';
type StoredIpo = { symbol: string; companyName: string; series: 'EQ' | 'SME'; openDate: string | null; closeDate: string | null };
const IPOS: Record<string, StoredIpo> = {
  RUNWALENTR: { symbol: 'RUNWALENTR', companyName: 'Runwal Enterprises Ltd.', series: 'EQ', openDate: '2026-09-25', closeDate: '2026-09-29' },
  MONEYVIEW: { symbol: 'MONEYVIEW', companyName: 'Moneyview Ltd.', series: 'EQ', openDate: '2026-09-24', closeDate: '2026-09-28' },
  // Stored dates as the replies print them (EVENTIONS "30-Sep-2026 to 05-Oct-2026"; GREENASIA's
  // "Revised/Extended Issue Period" "24-Sep-2026 to 01-Oct-2026 (The Issue is further extended ...)").
  EVENTIONS: { symbol: 'EVENTIONS', companyName: 'Eventions Ltd.', series: 'SME', openDate: '2026-09-30', closeDate: '2026-10-05' },
  GREENASIA: { symbol: 'GREENASIA', companyName: 'Green Asia Impex Ltd.', series: 'SME', openDate: '2026-09-24', closeDate: '2026-10-01' },
};

async function boardMock() {
  const nse = await import('../../../src/scrapers/nse-scraper.js');
  return nse.scrapeNSEIPOs as unknown as ReturnType<typeof vi.fn>;
}

function setup(sym: string, opts: { detail?: () => Promise<unknown>; keys?: string[]; ipo?: Partial<StoredIpo> } = {}) {
  const ipo = { ...IPOS[sym], ...opts.ipo };
  const fetchNseDetail = vi.fn(opts.detail ?? (async () => fixture(sym)));
  const deps = {
    ipoRepository: { findById: vi.fn(async () => ({ id: IPO_ID, symbol: ipo.symbol, companyName: ipo.companyName, isin: null, openDate: ipo.openDate, closeDate: ipo.closeDate })) } as never,
    isNseCapable: () => true,
    nseIssueKeys: vi.fn(async () => opts.keys ?? [`${ipo.symbol}|${ipo.series}`]),
    fetchNseDetail,
  };
  return { fetchNseDetail, fetcher: buildNseFetcher(deps, new NseFieldFetcherState()) };
}

/** [table, snake field, the printed row title, a fragment of the printed text, expected value] */
type Row = [string, string, string, string, unknown];

const RUNWAL: Row[] = [
  ['ipos', 'registrar', 'Name of the Registrar', 'MUFG Intime India Private Limited', 'MUFG Intime India Private Limited'],
  ['ipos', 'lead_managers', 'Book Running Lead Managers', 'ICICI Securities and Jefferies', ['ICICI Securities', 'Jefferies India Private Limited']],
  ['ipos', 'face_value', 'Face Value', 'Re. 2 per Equity Share', 2],
  ['ipo_details', 'issue_type', 'Issue Type', 'Book Building', 'BOOK_BUILDING'],
  ['ipo_details', 'sponsor_banks', 'Sponsor Bank', 'HDFC Bank Limited and ICICI Bank Limited', ['HDFC Bank Limited', 'ICICI Bank Limited']],
  ['ipo_details', 'tick_size', 'Tick Size', 'Re. 1', 1],
  ['ipo_details', 'ipo_market_timings', 'IPO Market Timings', '10.00 a.m. to 5.00 p.m.', '10.00 a.m. to 5.00 p.m.'],
  ['ipo_details', 'upi_cutoff_time', 'Cut-off time for UPI Mandate Confirmation', '(upto 5:00 PM)', '17:00'],
  ['ipo_details', 'employee_discount', 'Discount', 'Discount of Rs. 14 per equity share', 14],
  ['ipo_details', 'max_retail_subscription', 'Maximum Subscription Amount for Retail Investor', 'Rs. 2,00,000', 200000],
  ['ipo_details', 'max_employee_subscription', 'Maximum Subscription Amount for Employee Investor', 'Rs. 5,00,000', 500000],
  [
    'ipo_details',
    'category_details',
    'Categories',
    'FI, IC, MF, FII, OTH, CO, IND, NOH and EMP',
    { codes: ['FI', 'IC', 'MF', 'FII', 'OTH', 'CO', 'IND', 'NOH', 'EMP'], original: 'FI, IC, MF, FII, OTH, CO, IND, NOH and EMP' },
  ],
  ['ipo_details', 'sub_categories_upi', 'Sub-Categories applicable for UPI', 'IND and EMP (upto 5 Lakhs)', ['IND', 'EMP (upto 5 Lakhs)']],
];

const MONEYVIEW: Row[] = [
  ['ipos', 'registrar', 'Name of the Registrar', 'MUFG Intime India Private Limited ', 'MUFG Intime India Private Limited'],
  [
    'ipos',
    'lead_managers',
    'Book Running Lead Managers',
    'Axis Capital Limited, BofA Securities India Limited, IIFL Capital Services Limited and Kotak Mahindra Capital Company Limited',
    ['Axis Capital Limited', 'BofA Securities India Limited', 'IIFL Capital Services Limited', 'Kotak Mahindra Capital Company Limited'],
  ],
  ['ipos', 'face_value', 'Face Value', 'Re. 1 per Equity Share', 1],
  ['ipo_details', 'issue_type', 'Issue Type', 'Book Building', 'BOOK_BUILDING'],
  ['ipo_details', 'sponsor_banks', 'Sponsor Bank', 'ICICI Bank Limited and Axis Bank Limited', ['ICICI Bank Limited', 'Axis Bank Limited']],
  ['ipo_details', 'tick_size', 'Tick Size', 'Re. 1', 1],
  ['ipo_details', 'ipo_market_timings', 'IPO Market Timings', '10.00 a.m. to 5.00 p.m.', '10.00 a.m. to 5.00 p.m.'],
  ['ipo_details', 'upi_cutoff_time', 'Cut-off time for UPI Mandate Confirmation', '(upto 5:00 PM)', '17:00'],
  ['ipo_details', 'max_retail_subscription', 'Maximum Subscription Amount for Retail Investor', 'Rs. 2,00,000', 200000],
  [
    'ipo_details',
    'category_details',
    'Categories',
    'FI, IC, MF, FII, OTH, CO, IND, and NOH',
    { codes: ['FI', 'IC', 'MF', 'FII', 'OTH', 'CO', 'IND', 'NOH'], original: 'FI, IC, MF, FII, OTH, CO, IND, and NOH' },
  ],
  ['ipo_details', 'sub_categories_upi', 'Sub-Categories applicable for UPI', 'IND (upto 5 Lakhs)', ['IND (upto 5 Lakhs)']],
];

describe('NSE ipo-detail mappings (item 43): real replies, value = printed text', () => {
  beforeEach(async () => {
    (await boardMock()).mockReset();
    (await boardMock()).mockResolvedValue({ ipos: [{ symbol: 'OTHER', companyName: 'Other Ltd' }], subscriptions: [], source: 'api' });
  });

  for (const [sym, table] of [['RUNWALENTR', RUNWAL], ['MONEYVIEW', MONEYVIEW]] as const) {
    for (const [tableName, field, title, printedText, expected] of table) {
      it(`${sym} ${tableName}.${field} <- "${title}"`, async () => {
        const row = rowsOf(sym).find((r) => r.title?.trim() === title);
        expect(row?.value, 'the printed row the mapping reads').toContain(printedText);
        const { fetcher, fetchNseDetail } = setup(sym);
        await expect(fetcher(IPO_ID, tableName, '', field)).resolves.toEqual({ outcome: 'SUPPLIED', value: expected });
        expect(fetchNseDetail).toHaveBeenCalledWith(sym, 'EQ');
      });
    }
  }

  it('MONEYVIEW prints "Discount" as NA and no employee-subscription row: both abstain', async () => {
    expect(rowsOf('MONEYVIEW').find((r) => r.title === 'Discount')?.value).toBe('NA');
    const { fetcher } = setup('MONEYVIEW');
    await expect(fetcher(IPO_ID, 'ipo_details', '', 'employee_discount')).resolves.toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    await expect(fetcher(IPO_ID, 'ipo_details', '', 'max_employee_subscription')).resolves.toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('every detail-only field of one IPO in one cycle shares ONE ipo-detail request, and never reads the board', async () => {
    const { fetcher, fetchNseDetail } = setup('RUNWALENTR');
    for (const key of NSE_DETAIL_ONLY_FIELDS.keys()) {
      const [table, camel] = key.split('.');
      const snake = camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      const a = await fetcher(IPO_ID, table, '', snake);
      expect(a.outcome, key).toBe('SUPPLIED');
    }
    expect(fetchNseDetail).toHaveBeenCalledTimes(1);
    expect(await boardMock()).not.toHaveBeenCalled();
  });

  it('an IPO ON the board still reads these fields from ipo-detail (the board carries none of them)', async () => {
    (await boardMock()).mockResolvedValue({ ipos: [{ symbol: 'RUNWALENTR', companyName: 'Runwal Enterprises Limited' }], subscriptions: [], source: 'api' });
    const { fetcher } = setup('RUNWALENTR');
    await expect(fetcher(IPO_ID, 'ipos', '', 'registrar')).resolves.toEqual({ outcome: 'SUPPLIED', value: 'MUFG Intime India Private Limited' });
  });
});

describe('NSE ipo-detail mappings: answer states', () => {
  beforeEach(async () => {
    (await boardMock()).mockReset();
    (await boardMock()).mockResolvedValue({ ipos: [{ symbol: 'OTHER', companyName: 'Other Ltd' }], subscriptions: [], source: 'api' });
  });

  // D3 (F-236): an SME reply prints no company name; identity = SME key + no-name shape + stated
  // open AND close dates equal to the stored ones.
  it('SME reply without a name, ACTIVE SME key, dates equal stored -> SUPPLIED (EVENTIONS)', async () => {
    expect(rowsOf('EVENTIONS')[0].title).toBeNull();
    expect(fixture('EVENTIONS').companyName).toBe('EVENTIONS');
    const { fetcher, fetchNseDetail } = setup('EVENTIONS');
    await expect(fetcher(IPO_ID, 'ipos', '', 'registrar')).resolves.toEqual({ outcome: 'SUPPLIED', value: 'Mudra RTA Ventures Private Limited' });
    await expect(fetcher(IPO_ID, 'ipos', '', 'face_value')).resolves.toEqual({ outcome: 'SUPPLIED', value: 10 });
    expect(fetchNseDetail).toHaveBeenCalledWith('EVENTIONS', 'SME');
  });

  it('SME extended issue: the "Revised/Extended Issue Period" row is what the stored dates are compared with (GREENASIA)', async () => {
    expect(rowsOf('GREENASIA').some((r) => r.title === 'Issue Period')).toBe(false);
    const { fetcher } = setup('GREENASIA');
    await expect(fetcher(IPO_ID, 'ipo_details', '', 'upi_cutoff_time')).resolves.toEqual({ outcome: 'SUPPLIED', value: '17:00' });
    const old = setup('GREENASIA', { ipo: { closeDate: '2026-09-26' } });
    const a = await old.fetcher(IPO_ID, 'ipo_details', '', 'upi_cutoff_time');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', reason: expect.stringMatching(/identity unproven: SME reply period 2026-09-24\.\.2026-10-01, stored 2026-09-24\.\.2026-09-26/) });
  });

  it('SME identity refusals: mismatched dates, a missing stored date, an EQ key, a named reply, companyName not the symbol', async () => {
    const base = fixture('EVENTIONS');
    const cases: Array<[string, Parameters<typeof setup>[1]]> = [
      ['open date differs', { ipo: { openDate: '2026-09-29' } }],
      ['close date differs', { ipo: { closeDate: '2026-10-06' } }],
      ['no stored close date', { ipo: { closeDate: null } }],
      ['EQ key', { keys: ['EVENTIONS|EQ'] }],
      ['reply names another company', { detail: async () => ({ ...base, issueInfo: { ...base.issueInfo, dataList: [{ title: 'Other Events Limited', value: '' }, ...base.issueInfo.dataList] } }) }],
      ['companyName is not the symbol', { detail: async () => ({ ...base, companyName: 'Other Events Limited' }) }],
    ];
    for (const [name, opts] of cases) {
      const { fetcher } = setup('EVENTIONS', opts);
      const a = await fetcher(IPO_ID, 'ipos', '', 'registrar');
      expect(a, name).toMatchObject({ outcome: 'CHECK_FAILED' });
      expect((a as { reason: string }).reason, name).toMatch(/identity unproven|different company/);
    }
    const noDate = await setup('EVENTIONS', { ipo: { openDate: null } }).fetcher(IPO_ID, 'ipos', '', 'registrar');
    expect((noDate as { reason: string }).reason).toMatch(/no stored open\/close dates to compare/);
  });

  it('request failed -> CHECK_FAILED with the cause', async () => {
    const { fetcher } = setup('RUNWALENTR', { detail: async () => { throw new Error('HTTP 403'); } });
    const a = await fetcher(IPO_ID, 'ipo_details', '', 'tick_size');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED' });
    expect((a as { reason: string }).reason).toContain('HTTP 403');
  });

  it('empty issueInfo -> NOT_AVAILABLE_YET (abstention)', async () => {
    const { fetcher } = setup('RUNWALENTR', { detail: async () => ({ issueInfo: {} }) });
    await expect(fetcher(IPO_ID, 'ipos', '', 'lead_managers')).resolves.toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('no ACTIVE NSE key -> NOT_AVAILABLE_YET and no request', async () => {
    const { fetcher, fetchNseDetail } = setup('RUNWALENTR', { keys: [] });
    await expect(fetcher(IPO_ID, 'ipos', '', 'registrar')).resolves.toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    expect(fetchNseDetail).not.toHaveBeenCalled();
  });

  it('two "Name of the Registrar" rows -> CHECK_FAILED, never one picked', async () => {
    const base = fixture('RUNWALENTR');
    const dataList = [...base.issueInfo.dataList, { title: 'Name of the Registrar', value: 'Bigshare Services Private Limited' }];
    const { fetcher } = setup('RUNWALENTR', { detail: async () => ({ ...base, issueInfo: { ...base.issueInfo, dataList } }) });
    const a = await fetcher(IPO_ID, 'ipos', '', 'registrar');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED' });
    expect((a as { reason: string }).reason).toMatch(/2 "Name of the Registrar" rows/);
  });
});

/** Swap one row's value in a real dataList and read every field. */
function readWith(sym: string, title: string, value: string) {
  return readNseDetailRowFields(rowsOf(sym).map((r) => (r.title?.trim() === title ? { ...r, value } : r)));
}

describe('NSE ipo-detail readers on real SME rows and per-guard cases', () => {
  it('EVENTIONS (SME) rows read correctly once identity is set aside; 73-char market timings are refused, never cut', () => {
    const f = readNseDetailRowFields(rowsOf('EVENTIONS'));
    expect(f.registrar).toEqual({ value: 'Mudra RTA Ventures Private Limited' });
    expect(f.faceValue).toEqual({ value: 10 });
    expect(f.tickSize).toEqual({ value: 1 });
    expect(f.upiCutoffTime).toEqual({ value: '17:00' });
    expect(f.subCategoriesUPI).toEqual({ value: ['IND (Up to Rs. 5,00,000)'] });
    expect(f.ipoMarketTimings).toMatchObject({ error: expect.stringMatching(/73 chars \(column holds 50\)/) });
  });

  it('GREENASIA prints only a "Revised" UPI cut-off row: it is read', () => {
    const f = readNseDetailRowFields(rowsOf('GREENASIA'));
    expect(f.upiCutoffTime).toEqual({ value: '17:00' });
    expect(f.registrar).toEqual({ value: 'Bigshare Services Private Limited' });
  });

  it('a "Revised" cut-off supersedes the original row when both are printed', () => {
    const rows = [
      ...rowsOf('RUNWALENTR'),
      { title: 'Revised Cut-off time for UPI Mandate Confirmation', value: '01-Oct-2026 (upto 4:00 PM)' },
    ];
    expect(readNseDetailRowFields(rows).upiCutoffTime).toEqual({ value: '16:00' });
  });

  it('sponsor banks: "&" never splits a name; an "and" split must leave whole names, else refuse', () => {
    expect(readWith('RUNWALENTR', 'Sponsor Bank', 'Bank of Baroda and Punjab & Sind Bank').sponsorBanks).toEqual({
      error: expect.stringMatching(/cannot be split into whole names/),
    });
    expect(readWith('RUNWALENTR', 'Sponsor Bank', 'Jammu & Kashmir Bank').sponsorBanks).toEqual({ value: ['Jammu & Kashmir Bank'] });
    expect(readWith('RUNWALENTR', 'Sponsor Bank', 'The Jammu & Kashmir Bank Limited and Axis Bank Limited').sponsorBanks).toEqual({
      value: ['The Jammu & Kashmir Bank Limited', 'Axis Bank Limited'],
    });
    expect(readWith('RUNWALENTR', 'Sponsor Bank', 'ICICI Bank Ltd., HDFC Bank Ltd; Axis Bank').sponsorBanks).toEqual({
      value: ['ICICI Bank Ltd.', 'HDFC Bank Ltd', 'Axis Bank'],
    });
  });

  it('guards: each refuses rather than guesses', () => {
    expect(readWith('RUNWALENTR', 'Face Value', 'Rs. 7 per Equity Share').faceValue).toMatchObject({ error: expect.stringMatching(/FAILED_VALIDATION/) });
    expect(readWith('RUNWALENTR', 'Face Value', 'Rs. 2.50 per Equity Share').faceValue).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Face Value', 'Two rupees').faceValue).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Issue Type', 'Book Built Issue').issueType).toEqual({ error: expect.stringMatching(/not a known issue type/) });
    expect(readWith('RUNWALENTR', 'Issue Type', 'Fixed Price').issueType).toEqual({ value: 'FIXED_PRICE' });
    expect(readWith('RUNWALENTR', 'Tick Size', 'Re. 0').tickSize).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Cut-off time for UPI Mandate Confirmation', 'upto 5:00 PM, or upto 4:00 PM on T').upiCutoffTime).toMatchObject({
      error: expect.stringMatching(/2 times/),
    });
    expect(readWith('RUNWALENTR', 'Cut-off time for UPI Mandate Confirmation', 'as per circular').upiCutoffTime).toMatchObject({
      error: expect.stringMatching(/0 times/),
    });
    expect(readWith('RUNWALENTR', 'Discount', 'Rs. 14 per equity share for A, Rs. 20 per equity share for B').employeeDiscount).toMatchObject({
      error: expect.any(String),
    });
    expect(readWith('RUNWALENTR', 'Maximum Subscription Amount for Retail Investor', 'Rs. 2 lakh').maxRetailSubscription).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Categories', 'All categories as per RHP').categoryDetails).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Sub-Categories applicable for UPI', 'individuals up to 5 lakh').subCategoriesUPI).toMatchObject({ error: expect.any(String) });
    expect(readWith('RUNWALENTR', 'Name of the Registrar', 'X'.repeat(256)).registrar).toMatchObject({ error: expect.stringMatching(/256 chars/) });
  });

  it('abstention words abstain on every new field', () => {
    for (const [title, field] of [
      ['Name of the Registrar', 'registrar'],
      ['Tick Size', 'tickSize'],
      ['Sponsor Bank', 'sponsorBanks'],
      ['Maximum Subscription Amount for Retail Investor', 'maxRetailSubscription'],
    ] as const) {
      for (const word of ['NA', '-', 'To be announced', '"NA"']) {
        expect(readWith('RUNWALENTR', title, word)[field], `${title}=${word}`).toEqual({ absent: true });
      }
    }
  });
});
