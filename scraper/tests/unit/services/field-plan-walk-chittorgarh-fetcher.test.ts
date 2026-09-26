// implements: stage 2 item 6 -- the CHITTORGARH fetcher (rank 3) for the
// field-plan walk. `scrapeChittorgarhIPOs` (ruling 33's whole-IPO call) is
// mocked at the module boundary — the same function the live orchestrator
// calls, exercised through its own real-fixture tests elsewhere
// (chittorgarh-scraper tests); this file's job is the ADAPTER (resolution +
// capability gating + serveable-field mapping), not re-proving the parser.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

const scrapeChittorgarhIPOsMock = vi.fn();

vi.mock('../../../src/scrapers/chittorgarh-scraper.js', () => ({
  scrapeChittorgarhIPOs: (...args: unknown[]) => scrapeChittorgarhIPOsMock(...args),
}));

import {
  buildChittorgarhFetcher,
  ChittorgarhFieldFetcherState,
} from '../../../src/services/field-plan-walk-chittorgarh-fetcher.js';

const IPO_ID = '00000000-0000-4000-8000-0000000660a3';

beforeEach(() => {
  scrapeChittorgarhIPOsMock.mockReset();
});

function makeIpoRepository(companyName: string | null) {
  return { findById: vi.fn().mockResolvedValue(companyName ? { companyName } : null) } as any;
}

describe('CHITTORGARH fetcher — capability + serveable-field gating', () => {
  it('answers NOT_PRINTED when the manifest marks this table.field NOT capable.CHITTORGARH', async () => {
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Kanohar Electricals Limited'), isChittorgarhCapable: () => false },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
    expect(scrapeChittorgarhIPOsMock).not.toHaveBeenCalled();
  });

  // Review round 2, RCA2 extended: manifest says capable.CHITTORGARH.capable
  // is TRUE for financial_statements.revenue, but the list-scrape shape this
  // fetcher reads does not carry it — a code limitation (a detail-page
  // adapter is its own future slice), not a manifest "no". Only
  // capability.CHITTORGARH.capable === false may answer NOT_PRINTED.
  it('answers CHECK_FAILED transient for financial_statements.revenue — the list scrape carries no financial series yet (coverage gap, not a manifest no)', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [], errors: [] });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Kanohar Electricals Limited'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'financial_statements', 'FY2026', 'revenue');
    expect(answer).toEqual({
      outcome: 'CHECK_FAILED',
      reason: 'CHITTORGARH has no mapped field for financial_statements.revenue yet (coverage gap, not a manifest no)',
      transient: true,
      gap: 'NO_MAPPING',
    });
    // Never fetched the list for a field it structurally cannot serve.
    expect(scrapeChittorgarhIPOsMock).not.toHaveBeenCalled();
  });
});

describe('CHITTORGARH fetcher — SUPPLIED', () => {
  it('resolves by normalised name and answers issue_size from the list row', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'Kanohar Electricals Limited', issueSize: 8234.5 }],
      errors: [],
    });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Kanohar Electricals Limited'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'SUPPLIED', value: 8234.5 });
  });

  it('matches despite a casing/suffix difference (normalised name matching)', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [{ companyName: 'KANOHAR ELECTRICALS LTD', issueSize: 8234.5 }],
      errors: [],
    });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Kanohar Electricals Limited'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'SUPPLIED', value: 8234.5 });
  });

  it('memoises the whole-IPO list fetch across calls for different IPOs in the same cycle', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [
        { companyName: 'Kanohar Electricals Limited', issueSize: 8234.5 },
        { companyName: 'Pranav Constructions Limited', issueSize: 4210 },
      ],
      errors: [],
    });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Pranav Constructions Limited'), isChittorgarhCapable: () => true },
      state
    );
    await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(scrapeChittorgarhIPOsMock).toHaveBeenCalledTimes(1);
  });
});

describe('CHITTORGARH fetcher — no match', () => {
  it('answers NOT_AVAILABLE_YET when no list row matches this IPO by name', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [], errors: [] });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Unmatched Company Ltd'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});

// Review round 1, M1 (MAJOR): the CHITTORGARH list shape carries no
// symbol/isin, so a normalised-name collision (`normalizeCompanyNameForMatching`
// folds 'SIS Limited' and 'SIS Ltd' to the same key) can NEVER be resolved
// here — `.find()` silently picking the first match is a guess with no
// fallback confirmation available. Every ambiguous match must answer
// NOT_AVAILABLE_YET, never a guessed SUPPLIED.
describe('CHITTORGARH fetcher — ambiguous name match refuses to guess', () => {
  it('two list rows normalise to the same key — NOT_AVAILABLE_YET, never the first row picked', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({
      ipos: [
        { companyName: 'SIS Limited', issueSize: 1111 },
        { companyName: 'SIS Ltd', issueSize: 2222 },
      ],
      errors: [],
    });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('SIS Limited'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });
});

describe('CHITTORGARH fetcher — transient failures', () => {
  it('a scrape throw answers CHECK_FAILED (transient default)', async () => {
    scrapeChittorgarhIPOsMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Any Company Ltd'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'issue_size');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: 'ETIMEDOUT' });
  });
});

// #394 / #343 / #73: spec field 13 ipos.sector, rank 2 CHITTORGARH (after DOC). The list row's
// verifierUrl is the IPO's CG detail page; the page is a REAL capture (fixtures/chittorgarh).
describe('CHITTORGARH fetcher — ipos.sector from the detail page', () => {
  const PARAMOUNT_HTML = readFileSync(
    nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'chittorgarh', 'chittorgarh-paramount-syntex-detail.html'),
    'utf8'
  );
  const URL_ = 'https://www.chittorgarh.com/ipo/paramount-syntex-ipo/2743/';

  function sectorFetcher(fetchDetailHtml: (url: string) => Promise<string>, state = new ChittorgarhFieldFetcherState()) {
    return buildChittorgarhFetcher(
      {
        ipoRepository: makeIpoRepository('Paramount Syntex Ltd.'),
        isChittorgarhCapable: () => true,
        fetchDetailHtml,
      },
      state
    );
  }

  it('answers SUPPLIED "Other Textile Products" from the real page at the row verifierUrl', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [{ companyName: 'Paramount Syntex Ltd.', verifierUrl: URL_ }], errors: [] });
    const fetchDetailHtml = vi.fn().mockResolvedValue(PARAMOUNT_HTML);
    const answer = await sectorFetcher(fetchDetailHtml)(IPO_ID, 'ipos', '', 'sector');
    expect(answer).toEqual({ outcome: 'SUPPLIED', value: 'Other Textile Products' });
    expect(fetchDetailHtml).toHaveBeenCalledTimes(1);
    expect(fetchDetailHtml).toHaveBeenCalledWith(URL_);
  });

  it('fetches one detail page once per cycle, however many fields ask', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [{ companyName: 'Paramount Syntex Ltd.', verifierUrl: URL_ }], errors: [] });
    const fetchDetailHtml = vi.fn().mockResolvedValue(PARAMOUNT_HTML);
    const fetcher = sectorFetcher(fetchDetailHtml);
    await fetcher(IPO_ID, 'ipos', '', 'sector');
    await fetcher(IPO_ID, 'ipos', '', 'sector');
    expect(fetchDetailHtml).toHaveBeenCalledTimes(1);
  });

  it('a page with no mappable industry answers NOT_AVAILABLE_YET — never SUPPLIED ""', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [{ companyName: 'Paramount Syntex Ltd.', verifierUrl: URL_ }], errors: [] });
    const fetchDetailHtml = vi.fn().mockResolvedValue(PARAMOUNT_HTML.replace(/ipo_industry/g, 'ipo_xindustry'));
    const answer = await sectorFetcher(fetchDetailHtml)(IPO_ID, 'ipos', '', 'sector');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
  });

  it('a list row with no verifierUrl answers NOT_AVAILABLE_YET without fetching', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [{ companyName: 'Paramount Syntex Ltd.' }], errors: [] });
    const fetchDetailHtml = vi.fn();
    const answer = await sectorFetcher(fetchDetailHtml)(IPO_ID, 'ipos', '', 'sector');
    expect(answer).toEqual({ outcome: 'NOT_AVAILABLE_YET' });
    expect(fetchDetailHtml).not.toHaveBeenCalled();
  });

  it('a detail fetch failure answers CHECK_FAILED transient with its cause', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [{ companyName: 'Paramount Syntex Ltd.', verifierUrl: URL_ }], errors: [] });
    const fetchDetailHtml = vi.fn().mockRejectedValue(new Error(`Chittorgarh detail ${URL_} HTTP 503`));
    const answer = await sectorFetcher(fetchDetailHtml)(IPO_ID, 'ipos', '', 'sector');
    expect(answer).toEqual({ outcome: 'CHECK_FAILED', reason: `Chittorgarh detail ${URL_} HTTP 503`, transient: true });
  });
});
