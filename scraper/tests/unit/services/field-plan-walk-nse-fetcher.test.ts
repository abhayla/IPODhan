/**
 * Item 6 (#705 / #759): the NSE fetcher's answer contract.
 *
 * The behaviour under test is not "does it fetch" — it is WHICH OUTCOME it
 * returns when it cannot answer, because the walk treats the three very
 * differently:
 *
 *   NOT_PRINTED        settled; every rank answering this retires the field
 *                      (EXHAUSTED, next_due_at nulled, never asked again)
 *   CHECK_FAILED       transient; backs off and is re-asked
 *   NOT_AVAILABLE_YET  re-askable; taken the moment the source publishes
 *
 * Getting that wrong is exactly how #858 happened: 36 fields retired for good
 * because a "not here" was read as settled rather than not-yet. So each test
 * below pins one outcome, and the manifest-capability boundary is the only
 * place NOT_PRINTED may come from.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildNseFetcher, NseFieldFetcherState } from '../../../src/services/field-plan-walk-nse-fetcher.js';

vi.mock('../../../src/scrapers/nse-scraper.js', () => ({
  scrapeNSEIPOs: vi.fn(async () => ({ ipos: [], subscriptions: [] })),
}));

const IPO_ID = '11111111-1111-1111-1111-111111111111';

function depsWith(capable: boolean, ipo: unknown = null) {
  return {
    ipoRepository: { findById: vi.fn(async () => ipo) } as never,
    isNseCapable: () => capable,
  };
}

describe('NSE fetcher — outcome contract (item 6)', () => {
  it('answers NOT_PRINTED only when the manifest says NSE is not capable', async () => {
    const fetcher = buildNseFetcher(depsWith(false), new NseFieldFetcherState());
    const answer = await fetcher(IPO_ID, 'ipos', '', 'open_date');
    expect(answer.outcome).toBe('NOT_PRINTED');
  });

  it('answers CHECK_FAILED TRANSIENT for a capable field this adapter cannot serve yet', async () => {
    // The manifest ranks NSE for ipos.status, but the board shape this fetcher
    // reads does not carry it. That is a code gap, not a settled "not here" —
    // retiring the field would mean extending the mapping later could not
    // bring it back without a manual requeue.
    const fetcher = buildNseFetcher(depsWith(true), new NseFieldFetcherState());
    const answer = await fetcher(IPO_ID, 'ipos', '', 'status');
    expect(answer.outcome).toBe('CHECK_FAILED');
    expect((answer as { transient?: boolean }).transient).toBe(true);
    expect((answer as { reason?: string }).reason).toMatch(/coverage gap, not a manifest no/);
  });

  it('answers NOT_AVAILABLE_YET when the IPO is not on the board — re-askable, never terminal', async () => {
    const fetcher = buildNseFetcher(depsWith(true, null), new NseFieldFetcherState());
    const answer = await fetcher(IPO_ID, 'ipos', '', 'open_date');
    expect(answer.outcome).toBe('NOT_AVAILABLE_YET');
  });

  it('a serveable field on a resolvable IPO is SUPPLIED with the board value', async () => {
    const nse = await import('../../../src/scrapers/nse-scraper.js');
    (nse.scrapeNSEIPOs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ipos: [{ symbol: 'ACME', companyName: 'Acme Ltd', openDate: '2026-10-01' }],
      subscriptions: [],
    });
    const fetcher = buildNseFetcher(
      depsWith(true, { id: IPO_ID, symbol: 'ACME', companyName: 'Acme Ltd', isin: null }),
      new NseFieldFetcherState()
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'open_date');
    expect(answer.outcome).toBe('SUPPLIED');
    expect((answer as { value?: unknown }).value).toBe('2026-10-01');
  });

  it('refuses to guess when two board rows share the symbol — NOT_AVAILABLE_YET, not a wrong SUPPLIED', async () => {
    const nse = await import('../../../src/scrapers/nse-scraper.js');
    (nse.scrapeNSEIPOs as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ipos: [
        { symbol: 'DUP', companyName: 'One Ltd', openDate: '2026-10-01' },
        { symbol: 'DUP', companyName: 'Two Ltd', openDate: '2026-11-01' },
      ],
      subscriptions: [],
    });
    const fetcher = buildNseFetcher(
      depsWith(true, { id: IPO_ID, symbol: 'DUP', companyName: 'One Ltd', isin: null }),
      new NseFieldFetcherState()
    );
    const answer = await fetcher(IPO_ID, 'ipos', '', 'open_date');
    expect(answer.outcome).toBe('NOT_AVAILABLE_YET');
  });

  it('fetches the board AT MOST ONCE per state instance (ruling 33)', async () => {
    const nse = await import('../../../src/scrapers/nse-scraper.js');
    const spy = nse.scrapeNSEIPOs as unknown as ReturnType<typeof vi.fn>;
    spy.mockClear();
    spy.mockResolvedValue({ ipos: [{ symbol: 'ACME', companyName: 'Acme Ltd', openDate: '2026-10-01' }], subscriptions: [] });

    const state = new NseFieldFetcherState();
    const deps = depsWith(true, { id: IPO_ID, symbol: 'ACME', companyName: 'Acme Ltd', isin: null });
    const fetcher = buildNseFetcher(deps, state);

    await fetcher(IPO_ID, 'ipos', '', 'open_date');
    await fetcher(IPO_ID, 'ipos', '', 'close_date');
    await fetcher(IPO_ID, 'ipos', '', 'lot_size');

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
