/**
 * Item 7 S5 (spec §2.1 "Post-listing price", OD-29, OD-54; delisting §2.3.3.3, OD-38).
 * The job's decisions and its exact call counts per run (T-568), plus the narrow write
 * `writePostListingPrice` (exact columns, OD-73 no-op).
 */
import { describe, it, expect } from 'vitest';
import {
  runPostListingPriceJob,
  isPriceJobWindowIST,
  istDateDaysBefore,
  type PriceCandidate,
  type PriceJobDeps,
} from '../../../src/scheduler/post-listing-price';
import { writePostListingPrice, POST_LISTING_PRICE_COLUMNS } from '../../../src/services/data-persister';
import type { QuoteOutcome } from '../../../src/scrapers/post-listing-quote';

// 12:15 IST on Thursday 2026-09-24.
const NOW = new Date('2026-09-24T06:45:00Z');

const cand = (over: Partial<PriceCandidate>): PriceCandidate => ({
  id: over.id ?? `id-${over.companyName}`,
  companyName: 'X Ltd',
  symbol: 'X',
  segment: 'MAINBOARD',
  isin: null,
  listingDate: '2026-09-17',
  currentPrice: null,
  currentPriceUpdatedAt: null,
  priceNoSymbolReads: 0,
  ...over,
});

const price = (exchange: 'NSE' | 'BSE', p: number, calls = 1): QuoteOutcome => ({
  kind: 'price', exchange, price: p, asOf: new Date('2026-09-24T06:43:42Z'), asOfText: '24-Sep-2026 12:13:42', calls,
});
const none = (exchange: 'NSE' | 'BSE', calls: number): QuoteOutcome => ({ kind: 'no-symbol', exchange, detail: 'none', calls });
const refused = (exchange: 'NSE' | 'BSE'): QuoteOutcome => ({ kind: 'refused', exchange, detail: 'Access Denied page', calls: 1 });

function harness(candidates: PriceCandidate[], nse: Record<string, QuoteOutcome>, bse: Record<string, QuoteOutcome>, scrips: Record<string, string> = {}) {
  const calls = { nse: [] as string[], bse: [] as string[], bseList: 0 };
  const prices: Array<{ id: string; exchange: string; price: number }> = [];
  const reads: Array<{ id: string; reads: number; delistedOn: string | null }> = [];
  const deps: PriceJobDeps = {
    now: NOW,
    candidates,
    readNse: async (s) => { calls.nse.push(s); return nse[s]; },
    readBse: async (code) => { calls.bse.push(code); return bse[code]; },
    loadBseScrips: async () => { calls.bseList++; return new Map(Object.entries(scrips)); },
    writePrice: async (c, q) => { prices.push({ id: c.id, exchange: q.exchange, price: q.price }); return 'updated'; },
    writeReads: async (c, r, d) => { reads.push({ id: c.id, reads: r, delistedOn: d }); },
    log: () => {},
  };
  return { deps, calls, prices, reads };
}

describe('runPostListingPriceJob', () => {
  it('NSE answers: NSE wins, BSE and the BSE list are never called (1 NSE read, 0 BSE, 0 list)', async () => {
    const h = harness([cand({ companyName: 'Hero', symbol: 'HEROMOTORS', isin: 'INE012G01022' })], { HEROMOTORS: price('NSE', 117.31) }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(h.prices).toEqual([{ id: 'id-Hero', exchange: 'NSE', price: 117.31 }]);
    expect(s.calls).toEqual({ nse: 1, bse: 0, bseList: 0 });
    expect(h.reads).toEqual([]);
  });

  it('NSE has no such symbol, BSE answers: BSE price written; the BSE list is fetched ONCE for the whole run', async () => {
    const cs = [
      cand({ companyName: 'A', symbol: 'AAA', isin: 'INE000000001' }),
      cand({ companyName: 'B', symbol: 'BBB', isin: 'INE000000002' }),
    ];
    const h = harness(cs, { AAA: none('NSE', 4), BBB: none('NSE', 4) }, { '500001': price('BSE', 10), '500002': price('BSE', 20) }, { INE000000001: '500001', INE000000002: '500002' });
    const s = await runPostListingPriceJob(h.deps);
    expect(h.prices.map((p) => [p.exchange, p.price])).toEqual([['BSE', 10], ['BSE', 20]]);
    expect(s.calls).toEqual({ nse: 8, bse: 2, bseList: 1 });
  });

  it('three consecutive no-such-symbol reads (NSE none, ISIN absent from BSE list) -> delisted on the third, IST date', async () => {
    let c = cand({ companyName: 'Gone', symbol: 'GONE', isin: 'INE000000009' });
    const seen: Array<{ reads: number; delistedOn: string | null }> = [];
    for (let run = 1; run <= 3; run++) {
      const h = harness([c], { GONE: none('NSE', 4) }, {}, {});
      const s = await runPostListingPriceJob(h.deps);
      expect(h.prices).toEqual([]);
      seen.push(...h.reads.map(({ reads, delistedOn }) => ({ reads, delistedOn })));
      c = { ...c, priceNoSymbolReads: h.reads[0].reads };
      if (run === 3) expect(s.delisted).toEqual(['Gone']);
    }
    expect(seen).toEqual([
      { reads: 1, delistedOn: null },
      { reads: 2, delistedOn: null },
      { reads: 3, delistedOn: '2026-09-24' },
    ]);
  });

  it('a no-such-symbol read once, then a price: count goes 1 then back to 0 — never delisted', async () => {
    const c = cand({ companyName: 'Blip', symbol: 'BLIP', isin: 'INE000000008' });
    const h1 = harness([c], { BLIP: none('NSE', 4) }, {}, {});
    await runPostListingPriceJob(h1.deps);
    expect(h1.reads).toEqual([{ id: c.id, reads: 1, delistedOn: null }]);
    const h2 = harness([{ ...c, priceNoSymbolReads: 1 }], { BLIP: price('NSE', 50) }, {}, {});
    const s2 = await runPostListingPriceJob(h2.deps);
    expect(h2.reads).toEqual([{ id: c.id, reads: 0, delistedOn: null }]);
    expect(s2.delisted).toEqual([]);
  });

  it('a refusal (Access Denied) is never counted toward delisting', async () => {
    const c = cand({ companyName: 'Denied', symbol: 'DEN', isin: 'INE000000007', priceNoSymbolReads: 2 });
    const h = harness([c], { DEN: refused('NSE') }, {}, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(s.refused).toEqual(['Denied']);
    expect(h.reads).toEqual([]);
    expect(h.prices).toEqual([]);
  });

  it('no ISIN: BSE cannot be judged, so an NSE no-symbol answer is NOT counted (a BSE-only SME would be falsely delisted)', async () => {
    const c = cand({ companyName: 'BseOnly', symbol: 'BSEONLY', segment: 'SME', isin: null });
    const h = harness([c], { BSEONLY: none('NSE', 4) }, {}, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(s.notJudged).toEqual(['BseOnly']);
    expect(h.reads).toEqual([]);
    expect(s.calls.bseList).toBe(0);
  });

  it('on the listing date itself a no-symbol answer is not counted', async () => {
    const c = cand({ companyName: 'Today', symbol: 'TODAY', isin: 'INE000000006', listingDate: '2026-09-24' });
    const h = harness([c], { TODAY: none('NSE', 4) }, {}, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(s.notJudged).toEqual(['Today']);
    expect(h.reads).toEqual([]);
  });
});

describe('the window (IST)', () => {
  it('09:15-15:30 IST Mon-Fri inclusive; 09:14, 15:31 and Saturday are outside', () => {
    expect(isPriceJobWindowIST(new Date('2026-09-24T03:44:00Z'))).toBe(false); // 09:14 IST
    expect(isPriceJobWindowIST(new Date('2026-09-24T03:45:00Z'))).toBe(true); // 09:15 IST
    expect(isPriceJobWindowIST(new Date('2026-09-24T10:00:00Z'))).toBe(true); // 15:30 IST
    expect(isPriceJobWindowIST(new Date('2026-09-24T10:01:00Z'))).toBe(false); // 15:31 IST
    expect(isPriceJobWindowIST(new Date('2026-09-26T06:45:00Z'))).toBe(false); // Saturday 12:15 IST
  });
  it('the 90-day floor is an IST date: at 00:30 IST on 24 Sep (still 23 Sep UTC) it is 26 Jun', () => {
    expect(istDateDaysBefore(new Date('2026-09-23T19:00:00Z'), 90)).toBe('2026-06-26');
  });
});

describe('writePostListingPrice (the narrow write)', () => {
  const run = async (existingPrice: unknown) => {
    const updates: Array<Record<string, unknown>> = [];
    const tracked: string[] = [];
    const res = await writePostListingPrice({
      ipoRepository: { update: async (_id, data) => { updates.push(data); } },
      fieldSources: { trackFieldUpdate: async (i) => { tracked.push(`${i.fieldName}:${i.source}`); } },
      sourceTrackingEnabled: true,
      ipoId: 'ipo-1',
      existing: { currentPrice: existingPrice, currentPriceUpdatedAt: null },
      price: 117.31,
      asOf: new Date('2026-09-24T06:47:31Z'),
      source: 'NSE',
    });
    return { res, updates, tracked };
  };

  it('SETs exactly current_price and current_price_updated_at, one provenance row each', async () => {
    const { res, updates, tracked } = await run('98.40');
    expect(res.outcome).toBe('updated');
    expect(updates).toHaveLength(1);
    expect(Object.keys(updates[0]).sort()).toEqual([...POST_LISTING_PRICE_COLUMNS].sort());
    expect(updates[0]).toEqual({ currentPrice: '117.31', currentPriceUpdatedAt: new Date('2026-09-24T06:47:31Z') });
    expect(tracked).toEqual(['currentPrice:NSE', 'currentPriceUpdatedAt:NSE']);
  });

  it('an identical price writes nothing (OD-73 no-op)', async () => {
    const { res, updates, tracked } = await run('117.31');
    expect(res.outcome).toBe('unchanged');
    expect(updates).toEqual([]);
    expect(tracked).toEqual([]);
  });
});
