/**
 * Item 7 S5 (spec §2.1 "Post-listing price", OD-29, OD-54; delisting §2.3.3.3, OD-38).
 * The job's decisions and its exact call counts per run (T-568), plus the narrow writes
 * `writePostListingPrice` (exact columns, OD-73 no-op, forward-only as-of) and
 * `writePostListingState`. Round 2 (Tier A REVISE): outages never count, BSE-unknown never
 * counts, a later quote clears DELISTED, the as-of never moves backwards, the lock is `live`.
 */
import { describe, it, expect } from 'vitest';
import {
  runPostListingPriceJob,
  isPriceJobWindowIST,
  isCloseReadIST,
  istDateDaysBefore,
  type PriceCandidate,
  type PriceJobDeps,
  type PriceStatePatch,
} from '../../../src/scheduler/post-listing-price';
import {
  writePostListingPrice,
  writePostListingState,
  POST_LISTING_PRICE_COLUMNS,
} from '../../../src/services/data-persister';
import { createPacer, type QuoteOutcome } from '../../../src/scrapers/post-listing-quote';
import { PRICE_LOCK_RESOURCE, PRICE_LOCK_TTL_MS, PRICE_JOB_DEADLINE_MS } from '../../../src/scheduler/post-listing-price-wake';

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
  status: 'LISTED',
  delistedOn: null,
  nseSeries: null,
  ...over,
});

const price = (exchange: 'NSE' | 'BSE', p: number, calls = 1, series?: string): QuoteOutcome => ({
  kind: 'price', exchange, price: p, asOf: new Date('2026-09-24T06:43:42Z'), asOfText: '24-Sep-2026 12:13:42', calls,
  ...(series ? { series } : {}),
});
const none = (exchange: 'NSE' | 'BSE', calls: number): QuoteOutcome => ({ kind: 'no-symbol', exchange, detail: 'none', calls });
const refused = (exchange: 'NSE' | 'BSE', detail = 'Access Denied page'): QuoteOutcome => ({ kind: 'refused', exchange, detail, calls: 1 });

function harness(candidates: PriceCandidate[], nse: Record<string, QuoteOutcome>, bse: Record<string, QuoteOutcome>, scrips: Record<string, string> = {}) {
  const calls = { nse: [] as Array<[string, string | null]>, bse: [] as string[], bseList: 0 };
  const prices: Array<{ id: string; exchange: string; price: number }> = [];
  const states: Array<{ id: string } & PriceStatePatch> = [];
  const deps: PriceJobDeps = {
    now: NOW,
    candidates,
    readNse: async (s, _seg, cached) => { calls.nse.push([s, cached]); return nse[s]; },
    readBse: async (code) => { calls.bse.push(code); return bse[code]; },
    loadBseScrips: async () => { calls.bseList++; return new Map(Object.entries(scrips)); },
    writePrice: async (c, q) => { prices.push({ id: c.id, exchange: q.exchange, price: q.price }); return 'updated'; },
    writeState: async (c, patch) => { states.push({ id: c.id, ...patch }); },
    log: () => {},
  };
  return { deps, calls, prices, states };
}

/** Run the job three times, feeding each run's written count back into the row. */
async function threeRuns(c0: PriceCandidate, nse: Record<string, QuoteOutcome>, scrips: Record<string, string>, bse: Record<string, QuoteOutcome> = {}) {
  let c = c0;
  const perRun: Array<PriceStatePatch[]> = [];
  let last;
  for (let run = 1; run <= 3; run++) {
    const h = harness([c], nse, bse, scrips);
    last = await runPostListingPriceJob(h.deps);
    perRun.push(h.states.map(({ id: _id, ...p }) => p));
    const patch = h.states[0] ?? {};
    c = { ...c, priceNoSymbolReads: patch.reads ?? c.priceNoSymbolReads, status: patch.status ?? c.status, delistedOn: patch.delistedOn === undefined ? c.delistedOn : patch.delistedOn };
  }
  return { perRun, last: last!, row: c };
}

describe('runPostListingPriceJob', () => {
  it('NSE answers: NSE wins, BSE and the BSE list are never called (1 NSE read, 0 BSE, 0 list); the working series is cached', async () => {
    const h = harness([cand({ companyName: 'Hero', symbol: 'HEROMOTORS', isin: 'INE012G01022' })], { HEROMOTORS: price('NSE', 117.31, 1, 'EQ') }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(h.prices).toEqual([{ id: 'id-Hero', exchange: 'NSE', price: 117.31 }]);
    expect(s.calls).toEqual({ nse: 1, bse: 0, bseList: 0, total: 1 });
    expect(h.states).toEqual([{ id: 'id-Hero', nseSeries: 'EQ' }]);
  });

  it('the cached series is passed to the NSE read, and an unchanged series writes no state', async () => {
    const h = harness([cand({ companyName: 'Vinod', symbol: 'VINOD', segment: 'SME', nseSeries: 'ST' })], { VINOD: price('NSE', 69.25, 1, 'ST') }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(h.calls.nse).toEqual([['VINOD', 'ST']]);
    expect(s.calls.total).toBe(1);
    expect(h.states).toEqual([]);
  });

  it('NSE has no such symbol, BSE answers: BSE price written; the BSE list is fetched ONCE for the whole run', async () => {
    const cs = [
      cand({ companyName: 'A', symbol: 'AAA', isin: 'INE000000001' }),
      cand({ companyName: 'B', symbol: 'BBB', isin: 'INE000000002' }),
    ];
    const h = harness(cs, { AAA: none('NSE', 4), BBB: none('NSE', 4) }, { '500001': price('BSE', 10), '500002': price('BSE', 20) }, { INE000000001: '500001', INE000000002: '500002' });
    const s = await runPostListingPriceJob(h.deps);
    expect(h.prices.map((p) => [p.exchange, p.price])).toEqual([['BSE', 10], ['BSE', 20]]);
    expect(s.calls).toEqual({ nse: 8, bse: 2, bseList: 1, total: 11 });
  });

  it('three consecutive runs where NSE says no-such-symbol AND BSE does not list the ISIN -> DELISTED on the third, IST date', async () => {
    const { perRun, last, row } = await threeRuns(cand({ companyName: 'Gone', symbol: 'GONE', isin: 'INE000000009' }), { GONE: none('NSE', 4) }, {});
    expect(perRun).toEqual([[{ reads: 1 }], [{ reads: 2 }], [{ reads: 3, delistedOn: '2026-09-24', status: 'DELISTED' }]]);
    expect(last.delisted).toEqual(['Gone']);
    expect(row.status).toBe('DELISTED');
  });

  it('BSE scrip answers not-listed (a JSON no-scrip answer) also counts as BSE no-such-symbol', async () => {
    const { perRun } = await threeRuns(cand({ companyName: 'Gone2', symbol: 'GONE2', isin: 'INE000000010' }), { GONE2: none('NSE', 4) }, { INE000000010: '500010' }, { '500010': none('BSE', 1) });
    expect(perRun[2]).toEqual([{ reads: 3, delistedOn: '2026-09-24', status: 'DELISTED' }]);
  });

  it('a later quote clears DELISTED: status LISTED, delisted_on NULL, count 0', async () => {
    const c = cand({ companyName: 'Back', symbol: 'BACK', isin: 'INE000000011', status: 'DELISTED', delistedOn: '2026-09-20', priceNoSymbolReads: 3, nseSeries: 'EQ' });
    const h = harness([c], { BACK: price('NSE', 42, 1, 'EQ') }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(h.states).toEqual([{ id: c.id, reads: 0, delistedOn: null, status: 'LISTED' }]);
    expect(s.undelisted).toEqual(['Back']);
  });

  it('a DELISTED row that still has no symbol is not counted again (no state write)', async () => {
    const c = cand({ companyName: 'Still', symbol: 'STILL', isin: 'INE000000012', status: 'DELISTED', delistedOn: '2026-09-20', priceNoSymbolReads: 3 });
    const h = harness([c], { STILL: none('NSE', 4) }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(h.states).toEqual([]);
    expect(s.notJudged).toEqual(['Still']);
  });

  it('a no-such-symbol run once, then a price: count goes 1 then back to 0 — never delisted', async () => {
    const c = cand({ companyName: 'Blip', symbol: 'BLIP', isin: 'INE000000008' });
    const h1 = harness([c], { BLIP: none('NSE', 4) }, {});
    await runPostListingPriceJob(h1.deps);
    expect(h1.states).toEqual([{ id: c.id, reads: 1 }]);
    const h2 = harness([{ ...c, priceNoSymbolReads: 1 }], { BLIP: price('NSE', 50, 1, 'EQ') }, {});
    const s2 = await runPostListingPriceJob(h2.deps);
    expect(h2.states).toEqual([{ id: c.id, reads: 0, nseSeries: 'EQ' }]);
    expect(s2.delisted).toEqual([]);
  });

  for (const [label, outcome] of [
    ['an HTML 200 page', refused('NSE', 'series EQ: HTTP 200 with a non-JSON body (14000 bytes)')],
    ['an empty {} body', refused('NSE', 'series EQ: HTTP 200 JSON with no equityResponse ({})')],
    ['a 403', refused('NSE', 'series EQ: HTTP 403: Access Denied')],
    ['a 5xx', refused('NSE', 'series EQ: HTTP 503: Service Unavailable')],
    ['a timeout', refused('NSE', 'network: The operation was aborted due to timeout')],
  ] as const) {
    it(`an NSE outage (${label}) three runs running never counts and never resets (row at 2 stays at 2)`, async () => {
      const c = cand({ companyName: 'Outage', symbol: 'OUT', isin: 'INE000000007', priceNoSymbolReads: 2 });
      const { perRun, last } = await threeRuns(c, { OUT: outcome }, {});
      expect(perRun).toEqual([[], [], []]);
      expect(last.refused).toEqual(['Outage']);
      expect(last.delisted).toEqual([]);
    });
  }

  it('a BSE outage (NSE no-symbol, BSE refused) is UNKNOWN: never counted', async () => {
    const c = cand({ companyName: 'BseDown', symbol: 'BD', isin: 'INE000000013', priceNoSymbolReads: 2 });
    const h = harness([c], { BD: none('NSE', 4) }, { '500013': refused('BSE', 'non-JSON body (14000 bytes)') }, { INE000000013: '500013' });
    const s = await runPostListingPriceJob(h.deps);
    expect(s.refused).toEqual(['BseDown']);
    expect(h.states).toEqual([]);
  });

  it('no ISIN: BSE cannot be asked (UNKNOWN), so NSE no-such-symbol x3 is NOT counted', async () => {
    const { perRun, last } = await threeRuns(cand({ companyName: 'BseOnly', symbol: 'BSEONLY', segment: 'SME', isin: null }), { BSEONLY: none('NSE', 4) }, {});
    expect(perRun).toEqual([[], [], []]);
    expect(last.notJudged).toEqual(['BseOnly']);
    expect(last.calls.bseList).toBe(0);
  });

  it('no NSE symbol: NSE never said no-such-symbol, so a BSE no-scrip answer alone is NOT counted', async () => {
    const c = cand({ companyName: 'NoSym', symbol: null, isin: 'INE000000014' });
    const h = harness([c], {}, {}, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(s.notJudged).toEqual(['NoSym']);
    expect(h.states).toEqual([]);
  });

  it('on the listing date itself a no-symbol answer is not counted', async () => {
    const c = cand({ companyName: 'Today', symbol: 'TODAY', isin: 'INE000000006', listingDate: '2026-09-24' });
    const h = harness([c], { TODAY: none('NSE', 4) }, {});
    const s = await runPostListingPriceJob(h.deps);
    expect(s.notJudged).toEqual(['Today']);
    expect(h.states).toEqual([]);
  });

  it('past the run deadline no new IPO is started; the rest are named as not reached', async () => {
    const cs = [cand({ companyName: 'First', symbol: 'F1' }), cand({ companyName: 'Second', symbol: 'F2' })];
    const h = harness(cs, { F1: price('NSE', 1, 1, 'EQ'), F2: price('NSE', 2, 1, 'EQ') }, {});
    let t = 0;
    const s = await runPostListingPriceJob({ ...h.deps, deadlineAt: 100, clock: () => (t += 60) });
    expect(h.calls.nse.map(([sym]) => sym)).toEqual(['F1']);
    expect(s.notReached).toEqual(['Second']);
  });
});

describe('the lock and bounds (round 2, Tier A MAJOR 2)', () => {
  it('takes the §2.1 live lock: scraper:live, 4-minute TTL, a run deadline inside it', () => {
    expect(PRICE_LOCK_RESOURCE).toBe('scraper:live');
    expect(PRICE_LOCK_TTL_MS).toBe(240_000);
    expect(PRICE_JOB_DEADLINE_MS).toBeLessThan(PRICE_LOCK_TTL_MS - 15_000);
  });
});

describe('createPacer (round 2, Tier A MAJOR 3)', () => {
  it('spaces consecutive calls by the gap and does not wait before the first', async () => {
    let clock = 1_000;
    const slept: number[] = [];
    const wait = createPacer(400, { now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
    await wait();
    clock += 100;
    await wait();
    clock += 500;
    await wait();
    expect(slept).toEqual([300]);
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
  it('the close read is the 15:30 IST wake only', () => {
    expect(isCloseReadIST(new Date('2026-09-24T10:00:05Z'))).toBe(true); // 15:30:05 IST
    expect(isCloseReadIST(new Date('2026-09-24T09:44:00Z'))).toBe(false); // 15:14 IST
  });
  it('the 90-day floor is an IST date: at 00:30 IST on 24 Sep (still 23 Sep UTC) it is 26 Jun', () => {
    expect(istDateDaysBefore(new Date('2026-09-23T19:00:00Z'), 90)).toBe('2026-06-26');
  });
});

describe('writePostListingPrice (the narrow write)', () => {
  const run = async (existingPrice: unknown, existingAsOf: unknown = null, asOf = new Date('2026-09-24T06:47:31Z')) => {
    const updates: Array<Record<string, unknown>> = [];
    const tracked: string[] = [];
    const res = await writePostListingPrice({
      ipoRepository: { update: async (_id, data) => { updates.push(data); } },
      fieldSources: { trackFieldUpdate: async (i) => { tracked.push(`${i.fieldName}:${i.source}`); } },
      sourceTrackingEnabled: true,
      ipoId: 'ipo-1',
      existing: { currentPrice: existingPrice, currentPriceUpdatedAt: existingAsOf },
      price: 117.31,
      asOf,
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

  it('an identical price at the same as-of writes nothing (OD-73 no-op)', async () => {
    const { res, updates, tracked } = await run('117.31', new Date('2026-09-24T06:47:31Z'));
    expect(res.outcome).toBe('unchanged');
    expect(updates).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('an identical price read later moves only the as-of (§2.1 Label: the time it was read)', async () => {
    const { res, updates, tracked } = await run('117.31', new Date('2026-09-24T06:32:31Z'));
    expect(res.outcome).toBe('confirmed');
    expect(updates).toEqual([{ currentPriceUpdatedAt: new Date('2026-09-24T06:47:31Z') }]);
    expect(tracked).toEqual(['currentPriceUpdatedAt:NSE']);
  });

  it('an as-of OLDER than the stored one is refused, even with a different price (monotonic as-of)', async () => {
    const { res, updates, tracked } = await run('120.00', new Date('2026-09-24T07:02:31Z'));
    expect(res.outcome).toBe('stale');
    expect(updates).toEqual([]);
    expect(tracked).toEqual([]);
  });

  it('the stored as-of as naive UTC text (a raw read) is compared as UTC', async () => {
    const { res } = await run('120.00', '2026-09-24 07:02:31');
    expect(res.outcome).toBe('stale');
  });
});

describe('writePostListingState', () => {
  it('SETs only the given state keys; a status change gets one provenance row', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const tracked: string[] = [];
    const repo = { update: async (_id: string, data: Record<string, unknown>) => { updates.push(data); } };
    const fs = { trackFieldUpdate: async (i: { fieldName: string; source: string; previousValue?: string | null }) => { tracked.push(`${i.fieldName}:${i.source}:${i.previousValue}`); } };
    await writePostListingState({ ipoRepository: repo, fieldSources: fs as any, sourceTrackingEnabled: true, ipoId: 'i', previousStatus: 'LISTED', patch: { reads: 3, delistedOn: '2026-09-24', status: 'DELISTED' } });
    await writePostListingState({ ipoRepository: repo, ipoId: 'i', patch: { nseSeries: 'ST' } });
    expect(updates).toEqual([{ priceNoSymbolReads: 3, delistedOn: '2026-09-24', status: 'DELISTED' }, { priceNseSeries: 'ST' }]);
    expect(tracked).toEqual(['status:NSE:LISTED']);
  });
});
