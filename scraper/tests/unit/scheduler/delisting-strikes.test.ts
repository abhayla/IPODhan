import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyNseSeriesAnswer, parseBseScripHeader, readNsePrice } from '../../../src/scrapers/post-listing-quote';
import {
  classifyRunForDelisting,
  delistingCanary,
  nextDelistingState,
  DELISTING_STRIKES_TO_DELIST,
} from '../../../src/scheduler/delisting-strikes';
import { runPostListingPriceJob, type PriceCandidate } from '../../../src/scheduler/post-listing-price';
import type { QuoteOutcome } from '../../../src/scrapers/post-listing-quote';

/**
 * #983 / OD-38 (spec §2.3.3.3). Every exchange body below is REAL, captured 2026-09-26 from the
 * live public endpoints (fixture provenance in the file's `_provenance`).
 */
const FIX = join(__dirname, '../../fixtures/post-listing-price');
const shapes = JSON.parse(readFileSync(join(FIX, 'delisting-read-shapes-2026-09-26.json'), 'utf8')).responses as Record<
  string,
  { status: number; body: string }
>;
const failures = JSON.parse(readFileSync(join(FIX, 'endpoint-failure-shapes-2026-09-24.json'), 'utf8')).responses as Record<string, string>;
const nse = (k: string) => ({ status: shapes[k].status, body: shapes[k].body });

describe('NSE series answer on real bodies (#983)', () => {
  it.each(['nse:HDFC:EQ', 'nse:IDFC:EQ', 'nse:CAIRN:EQ', 'nse:HEXAWARE:EQ'])('%s (a delisted company) is a delisting report', (k) => {
    const a = classifyNseSeriesAnswer(nse(k));
    expect(a.kind).toBe('delisted');
  });

  it('HDFC delisting report carries NSE\'s own ISIN, so BSE can be asked for a row with no stored ISIN (F-160)', () => {
    const a = classifyNseSeriesAnswer(nse('nse:HDFC:EQ'));
    expect(a).toMatchObject({ kind: 'delisted', isin: 'INE001A01036' });
  });

  it('a temporarily suspended stock (BALLARPUR, JETAIRWAYS in BZ) is UNKNOWN, never a delisting report', () => {
    expect(classifyNseSeriesAnswer(nse('nse:BALLARPUR:BZ')).kind).toBe('refused');
    expect(classifyNseSeriesAnswer(nse('nse:JETAIRWAYS:BZ')).kind).toBe('refused');
  });

  it('an all-null quote row (a series the symbol does not trade in now) is UNKNOWN', () => {
    expect(classifyNseSeriesAnswer(nse('nse:BALLARPUR:EQ')).kind).toBe('refused');
    expect(classifyNseSeriesAnswer(nse('nse:ADANITRANS:BE')).kind).toBe('refused');
  });

  it('the wrong-series 404, the never-existed 404 and the renamed-symbol 404 are the SAME body (so a body match cannot tell them apart)', () => {
    const bodies = new Set([shapes['nse:HEROMOTORS:SM'].body, shapes['nse:ZZNOSUCHSYM:EQ'].body, shapes['nse:ADANITRANS:EQ'].body]);
    expect(bodies.size).toBe(1);
    expect(classifyNseSeriesAnswer(nse('nse:ZZNOSUCHSYM:EQ')).kind).toBe('no-symbol');
  });

  it('a live stock is a price', () => {
    expect(classifyNseSeriesAnswer(nse('nse:HEROMOTORS:EQ')).kind).toBe('price');
  });

  it('outage shapes are UNKNOWN: an HTML 404 from a retired route, an empty 200, a non-JSON 200, an empty quote list is not a report', () => {
    expect(classifyNseSeriesAnswer({ status: 404, body: failures['nse-GetQuoteApiRetired-EQ-404'] }).kind).toBe('refused');
    expect(classifyNseSeriesAnswer({ status: 200, body: '' }).kind).toBe('refused');
    expect(classifyNseSeriesAnswer({ status: 200, body: '<html>maintenance</html>' }).kind).toBe('refused');
    expect(classifyNseSeriesAnswer({ status: 200, body: '{"equityResponse":[]}' }).kind).not.toBe('delisted');
  });

  it('readNsePrice stops at the first delisted series and reports it', async () => {
    const out = await readNsePrice('HDFC', 'MAINBOARD', { fetchRaw: async () => nse('nse:HDFC:EQ') });
    expect(out).toMatchObject({ kind: 'delisted', exchange: 'NSE', calls: 1 });
  });
});

describe('BSE header on real bodies (#983)', () => {
  it('HDFC on BSE (500010, Category Delisted) is a delisting report; 999999 (no scrip) is no-such-symbol; a suspended scrip is UNKNOWN', () => {
    expect(parseBseScripHeader(shapes['bse:500010'].body).kind).toBe('delisted');
    expect(parseBseScripHeader(shapes['bse:999999'].body).kind).toBe('no-symbol');
    expect(parseBseScripHeader(failures['bse-500102-suspended-200']).kind).toBe('refused');
  });
});

describe('run verdict and the consecutive count (OD-38)', () => {
  it('only an explicit report with every other exchange answering counts; outage or an exchange not asked is UNKNOWN; all no-such-symbol is not counted', () => {
    expect(classifyRunForDelisting({ priced: true, nse: 'delisted', bse: 'price' })).toBe('OK');
    expect(classifyRunForDelisting({ priced: false, nse: 'delisted', bse: 'no-symbol' })).toBe('STRIKE');
    expect(classifyRunForDelisting({ priced: false, nse: 'no-symbol', bse: 'delisted' })).toBe('STRIKE');
    expect(classifyRunForDelisting({ priced: false, nse: 'delisted', bse: 'not-asked' })).toBe('UNKNOWN');
    expect(classifyRunForDelisting({ priced: false, nse: 'delisted', bse: 'refused' })).toBe('UNKNOWN');
    expect(classifyRunForDelisting({ priced: false, nse: 'refused', bse: 'delisted' })).toBe('UNKNOWN');
    expect(classifyRunForDelisting({ priced: false, nse: 'not-asked', bse: 'delisted' })).toBe('UNKNOWN');
    expect(classifyRunForDelisting({ priced: false, nse: 'no-symbol', bse: 'no-symbol' })).toBe('NO_SUCH_SYMBOL');
  });

  it('three consecutive strikes delist with the third read\'s instant; UNKNOWN between strikes neither counts nor resets; a price resets', () => {
    const t = (m: number) => new Date(Date.UTC(2026, 8, 28, 4, m));
    let s = { strikes: 0, reads: [] as Array<{ at: string; exchange: string; detail: string }> };
    const step = (v: 'OK' | 'STRIKE' | 'UNKNOWN' | 'NO_SUCH_SYMBOL', m: number) => {
      const r = nextDelistingState(s, v, { at: t(m), exchange: 'NSE', detail: 'secStatus Permanent Suspended' });
      s = r.next;
      return r;
    };
    expect(step('STRIKE', 0).delistAt).toBeNull();
    expect(step('UNKNOWN', 15).changed).toBe(false);
    expect(step('NO_SUCH_SYMBOL', 30).changed).toBe(false);
    expect(step('STRIKE', 45).next.strikes).toBe(2);
    expect(step('OK', 60).next).toEqual({ strikes: 0, reads: [] });
    step('STRIKE', 75);
    step('STRIKE', 90);
    const third = step('STRIKE', 105);
    expect(third.next.strikes).toBe(DELISTING_STRIKES_TO_DELIST);
    expect(third.delistAt?.toISOString()).toBe(t(105).toISOString());
    expect(third.next.reads.map((r) => r.at)).toEqual([t(75), t(90), t(105)].map((d) => d.toISOString()));
  });

  it('canary: more than max(2, 20%) bad answers in one series voids that series only', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => ({ group: 'EQ', verdict: 'STRIKE' as const, nseAsked: true })),
      ...Array.from({ length: 7 }, () => ({ group: 'EQ', verdict: 'OK' as const, nseAsked: true })),
      { group: 'SM', verdict: 'STRIKE' as const, nseAsked: true },
      ...Array.from({ length: 5 }, () => ({ group: 'SM', verdict: 'OK' as const, nseAsked: true })),
    ];
    const v = delistingCanary(rows);
    expect([...v.keys()]).toEqual(['EQ']);
    expect(v.get('EQ')).toEqual({ asked: 10, bad: 3, limit: 2 });
  });
});

describe('the job wires it end to end (fakes, real bodies)', () => {
  const base: PriceCandidate = {
    id: 'x', companyName: 'Delisted Co', symbol: 'HDFC', segment: 'MAINBOARD', isin: null, listingDate: '2026-09-20',
    currentPrice: null, currentPriceUpdatedAt: null, status: 'LISTED', nseSeries: null, delistingStrikes: 2,
    delistingStrikeReads: [{ at: 'a', exchange: 'NSE', detail: 'd' }, { at: 'b', exchange: 'NSE', detail: 'd' }],
  };
  const now = new Date('2026-09-28T05:00:00Z');
  const run = async (opts: { bseList?: number; bseFails?: boolean; candidates?: PriceCandidate[] }) => {
    const writes: Array<{ id: string; strikes: number; delistAt: Date | null }> = [];
    const summary = await runPostListingPriceJob({
      now,
      candidates: opts.candidates ?? [base],
      readNse: (symbol, segment, cached) => readNsePrice(symbol, segment, { cachedSeries: cached, fetchRaw: async () => nse('nse:HDFC:EQ') }),
      readBse: async (): Promise<QuoteOutcome> => ({ kind: 'delisted', exchange: 'BSE', detail: 'scrip category Delisted', calls: 1 }),
      loadBseScrips: async () => {
        if (opts.bseFails) throw new Error('HTTP 503');
        return new Map(Array.from({ length: opts.bseList ?? 5047 }, (_, i) => [`INE${i}`, String(i)]));
      },
      writePrice: async () => 'updated',
      writeState: async () => {},
      writeDelisting: async (c, next, delistAt) => { writes.push({ id: c.id, strikes: next.strikes, delistAt }); },
      log: () => {},
    });
    return { summary, writes };
  };

  it('third NSE delisting report, BSE asked by NSE\'s own ISIN and not trading it: DELISTED', async () => {
    const { writes, summary } = await run({});
    expect(writes).toEqual([{ id: 'x', strikes: 3, delistAt: now }]);
    expect(summary.delisting.delisted).toEqual(['Delisted Co']);
  });

  it('BSE list truncated (below the floor) or failed: UNKNOWN, nothing written', async () => {
    expect((await run({ bseList: 1200 })).writes).toEqual([]);
    expect((await run({ bseFails: true })).writes).toEqual([]);
  });

  it('an outage-wide run (3 of 3 asked answer delisted) is voided by the canary', async () => {
    const cands = ['a', 'b', 'c'].map((id) => ({ ...base, id, companyName: id }));
    const { writes, summary } = await run({ candidates: cands });
    expect(writes).toEqual([]);
    expect(summary.delisting.voided).toEqual(['a', 'b', 'c']);
  });
});
