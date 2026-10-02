// implements: item 43 (OD-164(e), F-226) -- every NO_MAPPING source/field pair a real page prints
// gets a fetcher mapping. Each test feeds a page captured LIVE on 2026-10-02 (fixtures + .meta.json
// provenance) through the SAME parsing the source's orchestrator uses, then asserts the exact value
// the walk would write, so a wrong selector or a mapping that returns another field's value is red.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const fetchBSEBoardMock = vi.fn();
const fetchBSEDetailMock = vi.fn();

vi.mock('../../../src/scrapers/bse-api-scraper.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/scrapers/bse-api-scraper.js')>();
  return {
    ...real,
    fetchBSEBoard: (...a: unknown[]) => fetchBSEBoardMock(...a),
    fetchBSEDetail: (...a: unknown[]) => fetchBSEDetailMock(...a),
  };
});

import { asArray } from '../../../src/scrapers/bse-api-scraper.js';
import { buildBseFetcher, BseFieldFetcherState } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
} from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';

const FIX = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '../../fixtures');
const readJson = (p: string) => JSON.parse(readFileSync(nodePath.join(FIX, p), 'utf8'));
const IPO_ID = '00000000-0000-4000-8000-000000004343';
const repo = (companyName: string) => ({ findById: vi.fn().mockResolvedValue({ companyName }) }) as any;

describe('BSE fetcher -- item 43 mappings on the live 2026-10-02 board + detail (IPO_NO 8022)', () => {
  beforeEach(() => {
    const board = asArray<any>(readJson('bse/bse-board-2026-10-02.json')).filter((r) => r.IR_flag === 'IPO');
    fetchBSEBoardMock.mockResolvedValue(board);
    fetchBSEDetailMock.mockImplementation(async (n: number) => {
      const d = readJson(`bse/bse-detail-${n}-2026-10-02.json`);
      return asArray<any>(d)[0] ?? null;
    });
  });
  afterEach(() => vi.clearAllMocks());

  const ask = (field: string) =>
    buildBseFetcher(
      { ipoRepository: repo('Nityas Gems and Jewellery Limited'), isBseCapable: () => true },
      new BseFieldFetcherState()
    )(IPO_ID, 'ipos', '', field);

  it.each([
    ['company_name', 'NITYAS GEMS AND JEWELLERY LIMITED'],
    ['open_date', '2026-09-30'],
    ['close_date', '2026-10-05'],
    ['price_range_min', 70],
    ['price_range_max', 75],
    ['lot_size', 200],
    ['face_value', 5],
    ['registrar', 'Bigshare Services Private Limited'],
    ['lead_managers', ['Choice Capital Advisors Private Limited']],
    ['symbol', 'NITYAS'],
  ])('ipos.%s -> %j', async (field, expected) => {
    expect(await ask(field)).toEqual({ outcome: 'SUPPLIED', value: expected });
  });

  it('an open date BSE does not print stays absent (never today, unlike the orchestrator mapper)', async () => {
    const board = asArray<any>(readJson('bse/bse-board-2026-10-02.json'))
      .filter((r) => r.IPO_NO === 8022)
      .map((r) => ({ ...r, Start_Dt: '' }));
    fetchBSEBoardMock.mockResolvedValue(board);
    expect(await ask('open_date')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  describe('name matching is exact on the normalised name, never partial', () => {
    const askAs = (name: string, field: string) =>
      buildBseFetcher({ ipoRepository: repo(name), isBseCapable: () => true }, new BseFieldFetcherState())(IPO_ID, 'ipos', '', field);

    it('"Dove Soft Technologies Limited" does not match the "Dove  Soft Limited" row', async () => {
      expect(await askAs('Dove Soft Technologies Limited', 'lot_size')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    });

    it('"Dove Soft Ltd" matches the "Dove  Soft Limited" row (spacing and suffix fold)', async () => {
      const a = await askAs('Dove Soft Ltd', 'symbol');
      expect(a.outcome).toBe('SUPPLIED');
    });

    it('two board rows with the same normalised name and no symbol fail closed (ambiguous)', async () => {
      const board = asArray<any>(readJson('bse/bse-board-2026-10-02.json')).filter((r) => r.IPO_NO === 8015);
      fetchBSEBoardMock.mockResolvedValue([board[0], { ...board[0], IPO_NO: 8022, Scrip_name: 'Dove Soft Ltd' }]);
      expect(await askAs('Dove Soft Limited', 'lot_size')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    });
  });

  it('a decimal face value keeps its decimals (Rs 2.50 is 2.5, not 3)', async () => {
    fetchBSEDetailMock.mockImplementation(async () => ({
      ...asArray<any>(readJson('bse/bse-detail-8022-2026-10-02.json'))[0],
      Face_Value: '2.50',
    }));
    expect(await ask('face_value')).toEqual({ outcome: 'SUPPLIED', value: 2.5 });
  });

  it('a pair BSE does not print (listing_exchanges) stays a NO_MAPPING gap, not a guessed value', async () => {
    const a = await ask('listing_exchanges');
    expect(a).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_MAPPING', transient: true });
  });
});

describe('CHITTORGARH fetcher -- item 43 mappings on live 2026-10-02 report 82 + detail page', () => {
  const report82 = readFileSync(nodePath.join(FIX, 'chittorgarh/chittorgarh-report82-2026-10-02.json'), 'utf8');
  const runwalHtml = readFileSync(nodePath.join(FIX, 'chittorgarh/chittorgarh-runwal-enterprises-detail-2026-10-02.html'), 'utf8');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(report82, { status: 200, headers: { 'content-type': 'application/json' } }))
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const ask = (company: string, field: string, fetchDetailHtml = vi.fn().mockResolvedValue(runwalHtml)) =>
    buildChittorgarhFetcher(
      { ipoRepository: repo(company), isChittorgarhCapable: () => true, fetchDetailHtml },
      new ChittorgarhFieldFetcherState()
    )(IPO_ID, 'ipos', '', field);

  it.each([
    ['open_date', '2026-09-25'],
    ['close_date', '2026-09-29'],
    ['segment', 'MAINBOARD'],
    ['listing_exchanges', ['NSE', 'BSE']],
  ])('list row: Runwal Enterprises ipos.%s -> %j', async (field, expected) => {
    expect(await ask('Runwal Enterprises Limited', field)).toEqual({ outcome: 'SUPPLIED', value: expected });
  });

  it('list row: an open band (Vishal Nirmiti "208.00 to 220.00") -> price_range_min 208 / max 220', async () => {
    expect(await ask('Vishal Nirmiti Limited', 'price_range_min')).toEqual({ outcome: 'SUPPLIED', value: 208 });
    expect(await ask('Vishal Nirmiti Limited', 'price_range_max')).toEqual({ outcome: 'SUPPLIED', value: 220 });
  });

  it('list row: a listed IPO prints one final price ("305.00"), not a band -> range stays absent (T-308)', async () => {
    expect(await ask('Runwal Enterprises Limited', 'price_range_min')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('list row: an SME on BSE SME (Dove Soft) -> segment SME, listing_exchanges [BSE]', async () => {
    expect(await ask('Dove Soft Limited', 'segment')).toEqual({ outcome: 'SUPPLIED', value: 'SME' });
    expect(await ask('Dove Soft Limited', 'listing_exchanges')).toEqual({ outcome: 'SUPPLIED', value: ['BSE'] });
  });

  it.each([
    ['isin', 'INE804W01029'],
    ['allotment_date', '2026-09-30'],
    ['face_value', 2],
    ['lot_size', 49],
  ])('detail page: Runwal Enterprises ipos.%s -> %j', async (field, expected) => {
    expect(await ask('Runwal Enterprises Limited', field)).toEqual({ outcome: 'SUPPLIED', value: expected });
  });

  it('detail page: registrar is the registrar-name anchor text, not the lead manager', async () => {
    expect(await ask('Runwal Enterprises Limited', 'registrar')).toEqual({
      outcome: 'SUPPLIED',
      value: 'MUFG Intime India Pvt. Ltd.',
    });
  });

  it('detail page: a decimal face value keeps its decimals (Rs 2.50 is 2.5, not 3)', async () => {
    const html = '<a href="#">Face Value</a><span>₹ 2.50 per share</span>';
    expect(await ask('Runwal Enterprises Limited', 'face_value', vi.fn().mockResolvedValue(html))).toEqual({
      outcome: 'SUPPLIED',
      value: 2.5,
    });
  });

  it('detail page fetch failure -> CHECK_FAILED transient with the cause', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('Chittorgarh detail HTTP 503'));
    expect(await ask('Runwal Enterprises Limited', 'isin', failing)).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'Chittorgarh detail HTTP 503',
      transient: true,
    });
  });

  it('a page without the label answers NOT_AVAILABLE_YET, never another field', async () => {
    const blank = vi.fn().mockResolvedValue('<html><body>no timetable</body></html>');
    expect(await ask('Runwal Enterprises Limited', 'allotment_date', blank)).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('a pair CG does not print (status) stays a NO_MAPPING gap', async () => {
    expect(await ask('Runwal Enterprises Limited', 'status')).toMatchObject({ outcome: 'CHECK_FAILED', gap: 'NO_MAPPING' });
  });

  describe('name matching is exact on the normalised name, never partial', () => {
    it('"Dove Soft Technologies Limited" does not match the "Dove Soft Ltd." row', async () => {
      expect(await ask('Dove Soft Technologies Limited', 'segment')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    });

    it('"Dove Soft Limited" matches the "Dove Soft Ltd." row (suffix folds)', async () => {
      expect(await ask('Dove Soft Limited', 'segment')).toEqual({ outcome: 'SUPPLIED', value: 'SME' });
    });

    it('an SME and a mainboard twin with the same normalised name fail closed (ambiguous)', async () => {
      const body = JSON.parse(report82);
      const twin = { ...body.reportTableData[0], 'Issue Category': 'Mainboard' };
      body.reportTableData = [body.reportTableData[0], twin];
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
      );
      expect(await ask('Dove Soft Limited', 'segment')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    });
  });

  describe('a failed or empty list is a failed check, never "not published yet"', () => {
    const expectCheckFailed = async () => {
      const a = await ask('Runwal Enterprises Limited', 'open_date');
      expect(a).toMatchObject({ outcome: 'CHECK_FAILED', transient: true });
      expect((a as { reason: string }).reason).toMatch(/Chittorgarh list fetch failed/);
    };

    it('a list fetch error -> CHECK_FAILED transient with the cause', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('socket hang up'); }));
      await expectCheckFailed();
    }, 30000);

    it('an empty list -> CHECK_FAILED transient', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ reportTableData: [] }), { status: 200, headers: { 'content-type': 'application/json' } }))
      );
      await expectCheckFailed();
    }, 30000);

    it('a non-empty list without the IPO still answers not found (NOT_AVAILABLE_YET)', async () => {
      expect(await ask('Totally Absent Company Limited', 'open_date')).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    });
  });
});
