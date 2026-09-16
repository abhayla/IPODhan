// implements: stage 2 item 6 -- the CHITTORGARH fetcher (rank 3) for the
// field-plan walk. `scrapeChittorgarhIPOs` (ruling 33's whole-IPO call) is
// mocked at the module boundary — the same function the live orchestrator
// calls, exercised through its own real-fixture tests elsewhere
// (chittorgarh-scraper tests); this file's job is the ADAPTER (resolution +
// capability gating + serveable-field mapping), not re-proving the parser.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

  it('answers NOT_PRINTED for financial_statements.revenue — the list scrape carries no financial series', async () => {
    scrapeChittorgarhIPOsMock.mockResolvedValue({ ipos: [], errors: [] });
    const state = new ChittorgarhFieldFetcherState();
    const fetcher = buildChittorgarhFetcher(
      { ipoRepository: makeIpoRepository('Kanohar Electricals Limited'), isChittorgarhCapable: () => true },
      state
    );
    const answer = await fetcher(IPO_ID, 'financial_statements', 'FY2026', 'revenue');
    expect(answer).toEqual({ outcome: 'NOT_PRINTED' });
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
