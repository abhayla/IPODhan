// implements: stage 2 item 6 -- the BSE fetcher (rank 2) for the field-plan
// walk. Real fixtures: docs/design/probes/fixtures/bse/IPO_HomePageDetail.json
// and GetMkt_ISSUE_BBS_IPO-7950.json (live BSE JSON API captures).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const listFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../../docs/design/probes/fixtures/bse/IPO_HomePageDetail.json'), 'utf-8')
);
const detailFixture = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../docs/design/probes/fixtures/bse/GetMkt_ISSUE_BBS_IPO-7950.json'),
    'utf-8'
  )
);

const listRow = listFixture.Table.find((r: any) => r.IPO_NO === 7950) ?? {
  Scrip_name: 'Asset Reconstruction Company (India) Limited',
  Start_Dt: '2026-09-09T00:00:00',
  End_Dt: '2026-09-11T00:00:00',
  Status: 'L',
  IR_flag: 'IPO',
  IR_FLAG_FULL: 'Book Building',
  IPO_NO: 7950,
  Scrip_cd: 4801,
};
const detailRow = detailFixture.IPONO_0[0];

const fetchBSEBoardMock = vi.fn();
const fetchBSEDetailMock = vi.fn();

vi.mock('../../../src/scrapers/bse-api-scraper.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/scrapers/bse-api-scraper.js')>(
    '../../../src/scrapers/bse-api-scraper.js'
  );
  return {
    ...actual,
    fetchBSEBoard: (...args: unknown[]) => fetchBSEBoardMock(...args),
    fetchBSEDetail: (...args: unknown[]) => fetchBSEDetailMock(...args),
  };
});

import { buildBseFetcher, BseFieldFetcherState } from '../../../src/services/field-plan-walk-bse-fetcher.js';
import { computeBSEIssueSize, parsePriceBand } from '../../../src/scrapers/bse-api-scraper.js';

const IPO_ID = '00000000-0000-4000-8000-0000000660a2';

beforeEach(() => {
  fetchBSEBoardMock.mockReset();
  fetchBSEDetailMock.mockReset();
});

function makeIpoRepository(companyName: string, symbol: string | null = null) {
  return { findById: vi.fn().mockResolvedValue({ companyName, symbol, isin: null }) } as any;
}

describe('BSE fetcher — capability + serveable-field gating', () => {
  it('answers NOT_PRINTED when the manifest marks this table.field NOT capable.BSE', async () => {
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('Asset Reconstruction Company (India) Limited'), isBseCapable: () => false },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
    expect(fetchBSEBoardMock).not.toHaveBeenCalled();
  });

  it('answers NOT_PRINTED for a manifest-capable field the mapped ScrapedIPO shape does not carry (e.g. fresh_issue)', async () => {
    fetchBSEBoardMock.mockResolvedValue([listRow]);
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('Asset Reconstruction Company (India) Limited'), isBseCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipo_details', '', 'fresh_issue');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
  });
});

describe('BSE fetcher — SUPPLIED from real fixtures', () => {
  it('resolves the board row by normalised name, fetches detail once, and answers issue_size', async () => {
    fetchBSEBoardMock.mockResolvedValue([listRow]);
    fetchBSEDetailMock.mockResolvedValue(detailRow);
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository(listRow.Scrip_name), isBseCapable: () => true },
      state
    );

    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');

    const band = parsePriceBand(detailRow.Price_Band);
    const expected = computeBSEIssueSize(parseInt(detailRow.Issue_Size_No_of_shares, 10), band.min);
    expect(answer).toEqual({ outcome: 'SUPPLIED', value: expected });
  });

  it('memoises the board and detail fetch — a second field of the same IPO does not refetch', async () => {
    fetchBSEBoardMock.mockResolvedValue([listRow]);
    fetchBSEDetailMock.mockResolvedValue(detailRow);
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository(listRow.Scrip_name), isBseCapable: () => true },
      state
    );

    await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    await fetcher(IPO_ID, 'ipos', '', 'issue_size');

    expect(fetchBSEBoardMock).toHaveBeenCalledTimes(1);
    expect(fetchBSEDetailMock).toHaveBeenCalledTimes(1);
  });
});

describe('BSE fetcher — no board row', () => {
  it('answers NOT_AVAILABLE_YET when no board row matches this IPO', async () => {
    fetchBSEBoardMock.mockResolvedValue([]);
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('Some Unlisted Company Ltd'), isBseCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});

describe('BSE fetcher — transient failures', () => {
  it('a board fetch throw answers CHECK_FAILED (transient default)', async () => {
    fetchBSEBoardMock.mockRejectedValue(new Error('BSE API HTTP 503'));
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('Any Company Ltd'), isBseCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: 'BSE API HTTP 503' });
  });
});

// Review round 1, M1 (MAJOR): normalizeCompanyNameForMatching('SIS Limited')
// and ('SIS Ltd') both normalise to 'sis' -- two DIFFERENT companies can
// collide on the normalised key. Picking nameMatches[0] when neither
// symbol nor isin confirms exactly one row is a GUESS that can silently
// attach one IPO's issue_size to another IPO's plan row. The walk must
// refuse to guess: NOT_AVAILABLE_YET, never a guessed SUPPLIED.
describe('BSE fetcher — ambiguous name match refuses to guess', () => {
  it('two board rows normalise to the same key and neither symbol nor isin confirms one — NOT_AVAILABLE_YET, never a guess', async () => {
    const rowA = { ...listRow, IPO_NO: 9001, Scrip_name: 'SIS Limited' };
    const rowB = { ...listRow, IPO_NO: 9002, Scrip_name: 'SIS Ltd' };
    fetchBSEBoardMock.mockResolvedValue([rowA, rowB]);
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('SIS Limited', null), isBseCapable: () => true },
      state
    );

    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');

    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    // Never guessed a detail fetch for either ambiguous row.
    expect(fetchBSEDetailMock).not.toHaveBeenCalled();
  });

  it('an ambiguous name match IS resolved when the symbol confirms exactly one row', async () => {
    const rowA = { ...listRow, IPO_NO: 9001, Scrip_name: 'SIS Limited' };
    const rowB = { ...listRow, IPO_NO: 9002, Scrip_name: 'SIS Ltd' };
    fetchBSEBoardMock.mockResolvedValue([rowA, rowB]);
    fetchBSEDetailMock.mockImplementation(async (ipoNo: number) =>
      ipoNo === 9002 ? { ...detailRow, Symbol: 'SISL' } : { ...detailRow, Symbol: 'OTHR' }
    );
    const state = new BseFieldFetcherState();
    const fetcher = buildBseFetcher(
      { ipoRepository: makeIpoRepository('SIS Limited', 'SISL'), isBseCapable: () => true },
      state
    );

    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');

    expect(answer.outcome).toBe('SUPPLIED');
  });
});
