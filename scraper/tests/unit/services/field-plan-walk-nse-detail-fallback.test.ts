/**
 * #1486: the NSE walk fetcher reads `/api/ipo-detail` for an IPO that has left NSE's
 * current/upcoming boards.
 *
 * RCA: the fetcher read only the two boards. Once an IPO left them, every re-ask answered
 * "not on the board" (NOT_AVAILABLE_YET) or, when the board scrape itself failed, "NSE board
 * empty" (CHECK_FAILED) -- so a band NSE corrected after close was never re-read, and the stale
 * rank-2 NSE value (Runwal Enterprises: 290-302 stored, NSE now states 290-305) kept outranking
 * the correct answer.
 *
 * Fixtures are REAL NSE payloads captured 2026-10-03 01:28 IST in one session
 * (scraper/tests/fixtures/nse/*.live-2026-10-03.json, provenance in the .meta.json siblings):
 * RUNWALENTR is absent from both boards and present in ipo-detail.
 *
 * Answer states pinned here (spec OD-60 empty = abstention; OD-145 unknown != absence):
 *   on board                                  -> as before (board value)
 *   off board, detail states the value        -> SUPPLIED
 *   off board, detail empty / field absent    -> NOT_AVAILABLE_YET (abstention)
 *   off board, detail fetch failed            -> CHECK_FAILED with the cause
 *   off board, detail ambiguous / unparseable -> CHECK_FAILED with the reason (fail closed)
 *   off board, detail for another symbol      -> CHECK_FAILED (identity mismatch)
 *   off board, two ACTIVE NSE keys            -> CHECK_FAILED (never guess)
 *   off board, no ACTIVE NSE key, board read  -> NOT_AVAILABLE_YET, no detail request, no name search
 *   board failed, no ACTIVE NSE key           -> CHECK_FAILED (as before)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNseFetcher, NseFieldFetcherState } from '../../../src/services/field-plan-walk-nse-fetcher.js';

vi.mock('../../../src/scrapers/nse-scraper.js', () => ({
  scrapeNSEIPOs: vi.fn(async () => ({ ipos: [], subscriptions: [] })),
}));

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/nse');
const readFixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
const DETAIL = readFixture('ipo-detail-RUNWALENTR.live-2026-10-03.json');
const CURRENT = readFixture('ipo-current-issue.live-2026-10-03.json') as Array<Record<string, string>>;
const UPCOMING = readFixture('all-upcoming-issues.live-2026-10-03.json') as Array<Record<string, string>>;

const IPO_ID = '22222222-2222-2222-2222-222222222222';
const RUNWAL = { id: IPO_ID, symbol: 'RUNWALENTR', companyName: 'Runwal Enterprises Ltd', isin: null };

/** The real boards, reduced to the identity keys the resolver matches on. */
function realBoard() {
  return [...CURRENT, ...UPCOMING].map((r) => ({ symbol: r.symbol, companyName: r.companyName, isin: undefined }));
}

async function boardMock() {
  const nse = await import('../../../src/scrapers/nse-scraper.js');
  return nse.scrapeNSEIPOs as unknown as ReturnType<typeof vi.fn>;
}

function deps(opts: { keys?: string[]; detail?: () => Promise<unknown>; ipo?: unknown } = {}) {
  const fetchNseDetail = vi.fn(opts.detail ?? (async () => DETAIL));
  return {
    fetchNseDetail,
    deps: {
      ipoRepository: { findById: vi.fn(async () => (opts.ipo === undefined ? RUNWAL : opts.ipo)) } as never,
      isNseCapable: () => true,
      nseIssueKeys: vi.fn(async () => opts.keys ?? ['RUNWALENTR|EQ']),
      fetchNseDetail,
    },
  };
}

function withDataList(dataList: Array<{ title: string | null; value: string }>, symbol = 'RUNWALENTR') {
  return { ...DETAIL, issueInfo: { dataList, symbol } };
}

describe('NSE fetcher, ipo-detail fallback for IPOs off the boards (#1486)', () => {
  beforeEach(async () => {
    (await boardMock()).mockReset();
    (await boardMock()).mockResolvedValue({ ipos: realBoard(), subscriptions: [], source: 'api' });
  });

  it('the real boards do not carry RUNWALENTR (the precondition of the defect)', () => {
    expect(realBoard().some((r) => r.symbol === 'RUNWALENTR')).toBe(false);
  });

  it('SUPPLIES the band NSE states in ipo-detail (290 / 305) when the IPO is off the boards', async () => {
    const { deps: d, fetchNseDetail } = deps();
    const fetcher = buildNseFetcher(d, new NseFieldFetcherState());
    expect(await fetcher(IPO_ID, 'ipos', '', 'price_range_min')).toEqual({ outcome: 'SUPPLIED', value: 290 });
    expect(await fetcher(IPO_ID, 'ipos', '', 'price_range_max')).toEqual({ outcome: 'SUPPLIED', value: 305 });
    expect(await fetcher(IPO_ID, 'ipos', '', 'lot_size')).toEqual({ outcome: 'SUPPLIED', value: 49 });
    expect(await fetcher(IPO_ID, 'ipos', '', 'open_date')).toEqual({ outcome: 'SUPPLIED', value: '2026-09-25' });
    expect(await fetcher(IPO_ID, 'ipos', '', 'close_date')).toEqual({ outcome: 'SUPPLIED', value: '2026-09-29' });
    expect(await fetcher(IPO_ID, 'ipos', '', 'symbol')).toEqual({ outcome: 'SUPPLIED', value: 'RUNWALENTR' });
    // B4(a): one detail request per IPO per cycle, by the stored key's symbol and series.
    expect(fetchNseDetail).toHaveBeenCalledTimes(1);
    expect(fetchNseDetail).toHaveBeenCalledWith('RUNWALENTR', 'EQ');
  });

  it('fields ipo-detail does not carry (company name, ISIN) abstain: NOT_AVAILABLE_YET', async () => {
    const { deps: d } = deps();
    const fetcher = buildNseFetcher(d, new NseFieldFetcherState());
    expect((await fetcher(IPO_ID, 'ipos', '', 'company_name')).outcome).toBe('NOT_AVAILABLE_YET');
    expect((await fetcher(IPO_ID, 'ipos', '', 'isin')).outcome).toBe('NOT_AVAILABLE_YET');
  });

  it('reads ipo-detail when the board scrape itself failed ("NSE board empty")', async () => {
    (await boardMock()).mockResolvedValue({ ipos: [], subscriptions: [], source: 'browser' });
    const { deps: d } = deps();
    const fetcher = buildNseFetcher(d, new NseFieldFetcherState());
    expect(await fetcher(IPO_ID, 'ipos', '', 'price_range_max')).toEqual({ outcome: 'SUPPLIED', value: 305 });
  });

  it('a failed detail request is CHECK_FAILED with its cause, never an abstention', async () => {
    const { deps: d } = deps({ detail: async () => { throw new Error('NSE API 403 after 3 retries'); } });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/ipo-detail RUNWALENTR\|EQ failed: NSE API 403 after 3 retries/);
    expect((answer as { transient?: boolean }).transient).not.toBe(false);
  });

  it('board failed AND detail failed: CHECK_FAILED naming both causes', async () => {
    (await boardMock()).mockResolvedValue({ ipos: [], subscriptions: [], source: 'browser' });
    const { deps: d } = deps({ detail: async () => { throw new Error('timeout'); } });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/NSE board empty/);
    expect((answer as { reason: string }).reason).toMatch(/timeout/);
  });

  it('an empty issueInfo (NSE serves no detail) is an abstention: NOT_AVAILABLE_YET', async () => {
    const { deps: d } = deps({ detail: async () => ({ ...DETAIL, issueInfo: {} }) });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('NOT_AVAILABLE_YET');
  });

  it('fails closed on two "Price Range" rows: CHECK_FAILED, never the first one', async () => {
    const list = DETAIL.issueInfo.dataList.concat([{ title: 'Price Range', value: 'Rs. 280 to Rs. 300 per Equity Share' }]);
    const { deps: d } = deps({ detail: async () => withDataList(list) });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/2 "Price Range" rows/);
  });

  it('fails closed on an unparseable band: CHECK_FAILED with the raw text', async () => {
    const list = DETAIL.issueInfo.dataList.map((r: { title: string | null; value: string }) =>
      r.title === 'Price Range' ? { title: 'Price Range', value: 'To be announced' } : r
    );
    const { deps: d } = deps({ detail: async () => withDataList(list) });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_min');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/To be announced/);
  });

  it('a single price is not a band (T-308): abstains like the board path, never min = max', async () => {
    const list = DETAIL.issueInfo.dataList.map((r: { title: string | null; value: string }) =>
      r.title === 'Price Range' ? { title: 'Price Range', value: 'Rs. 100 per Equity Share' } : r
    );
    const { deps: d } = deps({ detail: async () => withDataList(list) });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('NOT_AVAILABLE_YET');
  });

  it('detail for a different symbol is CHECK_FAILED (identity), never SUPPLIED', async () => {
    const { deps: d } = deps({ detail: async () => withDataList(DETAIL.issueInfo.dataList, 'OTHERSYM') });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/OTHERSYM/);
  });

  it('two ACTIVE NSE keys: CHECK_FAILED, no detail request', async () => {
    const { deps: d, fetchNseDetail } = deps({ keys: ['RUNWALENTR|EQ', 'RUNWAL|EQ'] });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect(fetchNseDetail).not.toHaveBeenCalled();
  });

  it('no ACTIVE NSE key and a readable board: NOT_AVAILABLE_YET as before, no detail request (never a name search)', async () => {
    const { deps: d, fetchNseDetail } = deps({ keys: [] });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('NOT_AVAILABLE_YET');
    expect(fetchNseDetail).not.toHaveBeenCalled();
  });

  it('no ACTIVE NSE key and a failed board: CHECK_FAILED as before', async () => {
    (await boardMock()).mockResolvedValue({ ipos: [], subscriptions: [], source: 'browser' });
    const { deps: d, fetchNseDetail } = deps({ keys: [] });
    const answer = await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { reason: string }).reason).toMatch(/NSE board empty/);
    expect(fetchNseDetail).not.toHaveBeenCalled();
  });

  it('an SME key reads ipo-detail with series=SME (C-1); a DEBT key is not read', async () => {
    const sme = deps({ keys: ['RUNWALENTR|SME'] });
    await buildNseFetcher(sme.deps, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(sme.fetchNseDetail).toHaveBeenCalledWith('RUNWALENTR', 'SME');

    const debt = deps({ keys: ['RUNWALENTR|DEBT'] });
    const answer = await buildNseFetcher(debt.deps, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect(debt.fetchNseDetail).not.toHaveBeenCalled();
  });

  it('an IPO still on the board is answered from the board; no detail request', async () => {
    const vnl = CURRENT.find((r) => r.symbol === 'VNL')!;
    (await boardMock()).mockResolvedValue({
      ipos: [{ symbol: 'VNL', companyName: vnl.companyName, priceRangeMax: 220 }],
      subscriptions: [],
    });
    const { deps: d, fetchNseDetail } = deps({ ipo: { id: IPO_ID, symbol: 'VNL', companyName: vnl.companyName, isin: null }, keys: ['VNL|EQ'] });
    expect(await buildNseFetcher(d, new NseFieldFetcherState())(IPO_ID, 'ipos', '', 'price_range_max')).toEqual({
      outcome: 'SUPPLIED',
      value: 220,
    });
    expect(fetchNseDetail).not.toHaveBeenCalled();
  });
});
