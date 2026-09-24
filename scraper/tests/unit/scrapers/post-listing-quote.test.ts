/**
 * Item 7 S5 (OD-29, F-150, F-155): the post-listing price reads, on the REAL client
 * functions, fed the REAL responses captured by the core-proof run on 2026-09-24
 * (scraper/tests/fixtures/post-listing-price/live-quotes-2026-09-24.json). Every test
 * counts the HTTP calls it caused (T-568: the call budget §7.4 counts calls).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  readNsePrice,
  readBsePrice,
  parseNseIstTimestamp,
  parseBseAsOn,
  nseSeriesOrder,
} from '../../../src/scrapers/post-listing-quote';
import { resetNseSessionForTests } from '../../../src/scrapers/nse-api-client';
import { parseBseScripPayload, indexBseScrips } from '../../../src/scrapers/bse-scrip-master';

const ROOT = join(__dirname, '..', '..', '..', '..');
const LIVE = JSON.parse(readFileSync(join(__dirname, '..', '..', 'fixtures', 'post-listing-price', 'live-quotes-2026-09-24.json'), 'utf8')).responses as Record<string, string>;
const BSE_LIST = readFileSync(join(ROOT, 'docs', 'design', 'probes', 'fixtures', 'bse', 'ListofScripData.sample.json'), 'utf8');

type Route = (url: string) => { status: number; body: string; setCookie?: string } | null;

function serve(route: Route) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string | URL) => {
    const url = String(u);
    urls.push(url);
    if (url === 'https://www.nseindia.com' || url.includes('/market-data/all-upcoming-issues-ipo')) {
      return new Response('<html></html>', { status: 200, headers: { 'set-cookie': `nsit=${urls.length}; Path=/` } });
    }
    const hit = route(url);
    if (!hit) throw new Error(`unrouted ${url}`);
    return new Response(hit.body, { status: hit.status });
  }));
  return urls;
}

const nseQuote = (url: string) => {
  const u = new URL(url);
  if (!u.pathname.endsWith('/GetQuoteApi')) return null;
  const key = `nse-${u.searchParams.get('symbol')}-${u.searchParams.get('series')}`;
  const found = Object.keys(LIVE).find((k) => k.startsWith(`${key}-`));
  if (!found) return { status: 404, body: '{"error":"Unexpected end of JSON input"}' };
  return { status: Number(found.split('-').pop()), body: LIVE[found] };
};

const quoteCalls = (urls: string[]) => urls.filter((u) => u.includes('GetQuoteApi'));
const warmUps = (urls: string[]) => urls.filter((u) => !u.includes('/api/') && u.includes('nseindia.com'));

describe('NSE getSymbolData (F-150), real responses', () => {
  beforeEach(() => resetNseSessionForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('mainboard EQ found: 2 warm-up page loads + 1 quote call, price and as-of from the real body', async () => {
    const urls = serve(nseQuote);
    const q = await readNsePrice('HEROMOTORS', 'MAINBOARD');
    expect(q.kind).toBe('price');
    if (q.kind !== 'price') return;
    expect(q.price).toBe(117.31);
    expect(q.series).toBe('EQ');
    expect(q.isin).toBe('INE012G01022');
    expect(q.asOfText).toBe('24-Sep-2026 12:17:31');
    expect(q.asOf.toISOString()).toBe('2026-09-24T06:47:31.000Z');
    expect(q.calls).toBe(1);
    expect(warmUps(urls)).toHaveLength(2);
    expect(quoteCalls(urls)).toHaveLength(1);
    expect(urls).toHaveLength(3);
  }, 10_000);

  it('SME: wrong series SM answers 404, the next series ST answers — 2 quote calls, not a no-symbol read', async () => {
    const urls = serve(nseQuote);
    const q = await readNsePrice('VINOD', 'SME');
    expect(q.kind).toBe('price');
    if (q.kind !== 'price') return;
    expect(q.series).toBe('ST');
    expect(q.price).toBe(69.25);
    expect(q.calls).toBe(2);
    expect(quoteCalls(urls).map((u) => new URL(u).searchParams.get('series'))).toEqual(['SM', 'ST']);
  }, 10_000);

  it('no such symbol: every series answers 404 — exactly 4 quote calls and a no-symbol outcome', async () => {
    const urls = serve(nseQuote);
    const q = await readNsePrice('ZZNOSUCHSYM', 'MAINBOARD');
    expect(q.kind).toBe('no-symbol');
    expect(q.calls).toBe(4);
    expect(quoteCalls(urls).map((u) => new URL(u).searchParams.get('series'))).toEqual(['EQ', 'BE', 'SM', 'ST']);
  }, 10_000);

  it('a 403 refreshes the session ONCE, retries ONCE, then is refused (never a no-symbol read)', async () => {
    const urls = serve((u) => (u.includes('GetQuoteApi') ? { status: 403, body: LIVE['bse-bare-ua'] } : null));
    const q = await readNsePrice('HEROMOTORS', 'MAINBOARD');
    expect(q.kind).toBe('refused');
    expect(quoteCalls(urls)).toHaveLength(2);
    expect(warmUps(urls)).toHaveLength(4);
  }, 15_000);

  it('series order: mainboard EQ first, SME SM then ST', () => {
    expect(nseSeriesOrder('MAINBOARD')).toEqual(['EQ', 'BE', 'SM', 'ST']);
    expect(nseSeriesOrder('SME')).toEqual(['SM', 'ST', 'EQ', 'BE']);
    expect(nseSeriesOrder('SME', 'ST')).toEqual(['ST', 'SM', 'EQ', 'BE']);
  });
});

describe('BSE (F-150, F-155), real responses', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('getScripHeaderData by scrip code: 1 call, LTP and the IST Ason converted to UTC', async () => {
    const urls = serve((u) => (u.includes('scripcode=544936') ? { status: 200, body: LIVE['bse-544936-200'] } : null));
    const q = await readBsePrice('544936');
    expect(q.kind).toBe('price');
    if (q.kind !== 'price') return;
    expect(q.price).toBe(117.43); // Header.LTP (the core-proof printout read the same body: 117.43)
    expect(q.asOfText).toMatch(/^24 Sep 26 \| 12:1\d$/);
    expect(q.asOf.toISOString().slice(0, 13)).toBe('2026-09-24T06');
    expect(urls).toHaveLength(1);
  });

  it('an SME (group M) scrip answers the same endpoint (segment=Equity covers SME, measured 2026-09-24)', async () => {
    serve(() => ({ status: 200, body: LIVE['bse-534708-200'] }));
    const q = await readBsePrice('534708');
    expect(q.kind).toBe('price');
  });

  it('an unknown scrip code is a no-symbol answer', async () => {
    serve(() => ({ status: 200, body: LIVE['bse-999999-200'] }));
    const q = await readBsePrice('999999');
    expect(q.kind).toBe('no-symbol');
  });

  it('the page BSE serves a bare User-Agent is a named refusal, never a price and never a no-symbol read', async () => {
    serve(() => ({ status: 200, body: LIVE['bse-bare-ua'] }));
    const q = await readBsePrice('544936');
    expect(q.kind).toBe('refused');
    if (q.kind === 'refused') expect(q.detail).toMatch(/non-JSON body/);
  });

  it('ListofScripData maps ISIN -> SCRIP_CD (real rows, including an SME group-M scrip)', () => {
    const master = indexBseScrips(parseBseScripPayload(BSE_LIST));
    expect(master.byIsin.get('INE565E01016')?.scripCode).toBe('519604');
    const sme = master.byIsin.get('INE0JSJ01014');
    expect(sme?.scripCode).toBe('543464');
    expect(sme?.group).toBe('M');
  });
});

describe('exchange timestamps are IST wall clock', () => {
  it('NSE lastUpdateTime converts with +05:30, not as UTC or local time', () => {
    expect(parseNseIstTimestamp('24-Sep-2026 12:13:42')?.toISOString()).toBe('2026-09-24T06:43:42.000Z');
    expect(parseNseIstTimestamp('23-Sep-2026 16:00:00')?.toISOString()).toBe('2026-09-23T10:30:00.000Z');
    expect(parseNseIstTimestamp('garbage')).toBeNull();
  });
  it('BSE Ason converts with +05:30', () => {
    expect(parseBseAsOn('24 Sep 26 | 12:13')?.toISOString()).toBe('2026-09-24T06:43:00.000Z');
    expect(parseBseAsOn('')).toBeNull();
  });
});

/**
 * Round 2 (Tier A MAJOR 1): an exchange OUTAGE is never read as "no such symbol".
 * Only an HTTP 404 or a well-formed JSON body that explicitly carries no quote
 * (`equityResponse: []`) is a no-such-symbol answer for a series; an HTML 200, an
 * empty `{}`, an empty body, a 403, a 5xx or a timeout is REFUSED (unknown), with its
 * cause, and stops the read.
 */
describe('NSE outage shapes are refused, never no-symbol (round 2)', () => {
  const always = (res: { status: number; body: string } | Error) => {
    const seen: string[] = [];
    const fetchRaw = async (_symbol: string, series: string) => {
      seen.push(series);
      if (res instanceof Error) throw res;
      return res;
    };
    return { seen, fetchRaw };
  };
  const cases: Array<[string, { status: number; body: string } | Error, RegExp]> = [
    ['an HTML 200 page', { status: 200, body: LIVE['bse-bare-ua'] }, /non-JSON/],
    ['an empty JSON object {}', { status: 200, body: '{}' }, /no equityResponse/],
    ['an empty body', { status: 200, body: '' }, /empty body/],
    ['a 403 Access Denied', { status: 403, body: 'Access Denied' }, /HTTP 403/],
    ['a 503', { status: 503, body: 'Service Unavailable' }, /HTTP 503/],
    ['a timeout', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }), /network: .*timeout/],
  ];
  for (const [label, res, cause] of cases) {
    it(`${label}: refused on the first series, with its cause, 1 call`, async () => {
      const h = always(res);
      const q = await readNsePrice('HEROMOTORS', 'MAINBOARD', { fetchRaw: h.fetchRaw });
      expect(q.kind).toBe('refused');
      if (q.kind !== 'refused') return;
      expect(q.detail).toMatch(cause);
      expect(q.calls).toBe(1);
      expect(h.seen).toEqual(['EQ']);
    });
  }

  it('a 404 on EQ then an outage on BE: refused (unknown), never no-symbol', async () => {
    const fetchRaw = async (_s: string, series: string) =>
      series === 'EQ' ? { status: 404, body: '{"error":"Unexpected end of JSON input"}' } : { status: 200, body: '{}' };
    const q = await readNsePrice('X', 'MAINBOARD', { fetchRaw });
    expect(q.kind).toBe('refused');
    expect(q.calls).toBe(2);
  });

  it('an explicit empty quote list (equityResponse: []) on every series is a no-symbol answer', async () => {
    const fetchRaw = async () => ({ status: 200, body: '{"equityResponse":[]}' });
    const q = await readNsePrice('X', 'MAINBOARD', { fetchRaw });
    expect(q.kind).toBe('no-symbol');
    expect(q.calls).toBe(4);
  });

  it('the cached series is asked first: an SME cached as ST costs 1 call, not 2', async () => {
    const seen: string[] = [];
    const fetchRaw = async (_s: string, series: string) => {
      seen.push(series);
      return series === 'ST' ? { status: 200, body: LIVE['nse-VINOD-ST-200'] } : { status: 404, body: '' };
    };
    const first = await readNsePrice('VINOD', 'SME', { fetchRaw });
    expect(first.calls).toBe(2);
    const second = await readNsePrice('VINOD', 'SME', { fetchRaw, cachedSeries: first.kind === 'price' ? first.series : null });
    expect(second.kind).toBe('price');
    expect(second.calls).toBe(1);
    expect(seen).toEqual(['SM', 'ST', 'ST']);
  });
});

describe('BSE outage shapes are refused (round 2)', () => {
  it('an HTML 200, a 5xx and a timeout are refused; only a JSON body with no scrip is no-symbol', async () => {
    const html = await readBsePrice('544936', { fetchRaw: async () => ({ status: 200, body: LIVE['bse-bare-ua'] }) });
    expect(html.kind).toBe('refused');
    const five = await readBsePrice('544936', { fetchRaw: async () => ({ status: 502, body: 'Bad Gateway' }) });
    expect(five.kind).toBe('refused');
    const slow = await readBsePrice('544936', { fetchRaw: async () => { throw new Error('The operation was aborted due to timeout'); } });
    expect(slow.kind).toBe('refused');
    const empty = await readBsePrice('544936', { fetchRaw: async () => ({ status: 200, body: '{}' }) });
    expect(empty.kind).toBe('refused');
    const none = await readBsePrice('999999', { fetchRaw: async () => ({ status: 200, body: LIVE['bse-999999-200'] }) });
    expect(none.kind).toBe('no-symbol');
  });
});
