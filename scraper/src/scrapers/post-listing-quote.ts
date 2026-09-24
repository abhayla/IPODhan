/**
 * Item 7 S5 — the post-listing price reads (spec §2.1 "Post-listing prices: 15 minutes,
 * 90 days, and no broker feed (OD-29)", OD-54; findings F-150, F-155).
 *
 * Two free public exchange endpoints, both measured before this was written:
 *   - NSE `GetQuoteApi?functionName=getSymbolData` (F-150). It answers only for the
 *     stock's real trading series: EQ for mainboard, SM or ST for SME depending on the
 *     stock. A wrong series is a 404 or an empty body, so a 404 is NOT delisting evidence
 *     by itself: only "no series answers" is a no-such-symbol read.
 *   - BSE `getScripHeaderData` by scrip code (F-150), the scrip code taken from the BSE
 *     active-scrip list by ISIN (F-155: `ipos.bse_scrip_code` is NULL on every row).
 *     Both BSE calls return an Akamai "Access Denied" page to a bare User-Agent.
 *
 * Every read returns one of three outcomes, never a thrown error for an exchange answer:
 *   price     — a positive last traded price with the exchange's own as-of time
 *   no-symbol — the exchange says there is no such symbol (every series tried answered
 *               404/empty; or BSE has no such scrip / the scrip is not Listed)
 *   refused   — Access Denied, a non-JSON page, a network error, a 5xx, a listed scrip
 *               with no trade yet: NOT a no-symbol read, never counted toward delisting.
 */
import { fetchNseSymbolQuoteRaw } from './nse-api-client.js';

export type QuoteOutcome =
  | { kind: 'price'; exchange: 'NSE' | 'BSE'; price: number; asOf: Date; asOfText: string; series?: string; isin?: string | null; calls: number }
  | { kind: 'no-symbol'; exchange: 'NSE' | 'BSE'; detail: string; calls: number }
  | { kind: 'refused'; exchange: 'NSE' | 'BSE'; detail: string; calls: number };

/** IST is UTC+05:30 with no daylight saving; both exchanges publish IST wall-clock times. */
const IST_OFFSET = '+05:30';
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** NSE `lastUpdateTime` "24-Sep-2026 12:13:42" (IST wall clock) -> the UTC instant. */
export function parseNseIstTimestamp(text: string): Date | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const d = new Date(`${m[3]}-${mon}-${m[1].padStart(2, '0')}T${m[4]}:${m[5]}:${m[6]}${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** BSE `Header.Ason` "24 Sep 26 | 12:13" (IST wall clock, two-digit year) -> the UTC instant. */
export function parseBseAsOn(text: string): Date | null {
  const m = /^(\d{1,2}) ([A-Za-z]{3}) (\d{2}) \| (\d{2}):(\d{2})$/.exec(String(text ?? '').trim());
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const d = new Date(`20${m[3]}-${mon}-${m[1].padStart(2, '0')}T${m[4]}:${m[5]}:00${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse one NSE getSymbolData body. null = no usable quote in it (empty body, no equityResponse). */
export function parseNseSymbolData(body: string): { price: number; asOf: Date; asOfText: string; series: string; isin: string | null } | null {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const row = Array.isArray(parsed?.equityResponse) ? parsed.equityResponse[0] : null;
  if (!row) return null;
  const price = Number(row?.tradeInfo?.lastPrice ?? row?.orderBook?.lastPrice);
  const asOfText = String(row?.lastUpdateTime ?? '');
  const asOf = parseNseIstTimestamp(asOfText);
  if (!Number.isFinite(price) || price <= 0 || !asOf) return null;
  const isinCode = row?.metaData?.isinCode;
  const isin = typeof isinCode === 'string' && /^IN[A-Z0-9]{10}$/.test(isinCode) ? isinCode : null;
  return { price, asOf, asOfText, series: String(row?.metaData?.series ?? ''), isin };
}

/** The series to try, likeliest first, per segment (F-150: SME trades as SM or ST). */
export function nseSeriesOrder(segment: string | null | undefined, cached?: string | null): string[] {
  const base = segment === 'SME' ? ['SM', 'ST', 'EQ', 'BE'] : ['EQ', 'BE', 'SM', 'ST'];
  if (cached && base.includes(cached)) return [cached, ...base.filter((s) => s !== cached)];
  return base;
}

export type NseRawFetch = (symbol: string, series: string) => Promise<{ status: number; body: string }>;

/**
 * Read one NSE price: try each series until one answers with a quote. A 404 or an empty
 * body means "not this series"; only when EVERY series says so is it a no-symbol read.
 * Anything else (401/403 after the client's one session refresh, 5xx, a network error,
 * an Access Denied page) is `refused` and stops the loop for this symbol.
 */
export async function readNsePrice(
  symbol: string,
  segment: string | null | undefined,
  opts: { cachedSeries?: string | null; fetchRaw?: NseRawFetch } = {},
): Promise<QuoteOutcome> {
  const fetchRaw = opts.fetchRaw ?? fetchNseSymbolQuoteRaw;
  let calls = 0;
  for (const series of nseSeriesOrder(segment, opts.cachedSeries)) {
    let res: { status: number; body: string };
    try {
      calls++;
      res = await fetchRaw(symbol, series);
    } catch (error) {
      return { kind: 'refused', exchange: 'NSE', detail: `network: ${error instanceof Error ? error.message : String(error)}`, calls };
    }
    if (res.status === 404) continue;
    if (res.status !== 200) {
      return { kind: 'refused', exchange: 'NSE', detail: `HTTP ${res.status}: ${res.body.slice(0, 120)}`, calls };
    }
    if (/Access Denied/i.test(res.body)) {
      return { kind: 'refused', exchange: 'NSE', detail: `Access Denied page (${res.body.length} bytes)`, calls };
    }
    const quote = parseNseSymbolData(res.body);
    if (quote) return { kind: 'price', exchange: 'NSE', ...quote, series, calls };
    // A 200 with an empty or quote-less body: not this series (F-150, ICELCO ST).
  }
  return { kind: 'no-symbol', exchange: 'NSE', detail: `no series answered for ${symbol}`, calls };
}

export const BSE_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  Referer: 'https://www.bseindia.com/',
};

export function bseScripHeaderUrl(scripCode: string): string {
  return `https://api.bseindia.com/BseIndiaAPI/api/getScripHeaderData/w?Debtflag=&scripcode=${encodeURIComponent(scripCode)}&seriesid=`;
}

/** Parse one BSE getScripHeaderData body. */
export function parseBseScripHeader(body: string):
  | { kind: 'price'; price: number; asOf: Date; asOfText: string }
  | { kind: 'no-symbol'; detail: string }
  | { kind: 'refused'; detail: string } {
  if (/Access Denied/i.test(body)) return { kind: 'refused', detail: `Access Denied page (${body.length} bytes)` };
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'refused', detail: `non-JSON body (${body.length} bytes)` };
  }
  const header = parsed?.Header;
  const category = String(header?.Category ?? parsed?.Cmpname?.Category ?? '').trim();
  if (!header || !parsed?.Cmpname?.FullN) return { kind: 'no-symbol', detail: 'no scrip in the answer' };
  if (category && !/^listed$/i.test(category)) return { kind: 'no-symbol', detail: `scrip category ${category}` };
  const price = Number(String(header.LTP ?? parsed?.CurrRate?.LTP ?? '').replace(/,/g, ''));
  const asOfText = String(header.Ason ?? '');
  const asOf = parseBseAsOn(asOfText);
  // A listed scrip with no trade yet (LTP "-", F-150: NSE IPO 544937) is neither a price
  // nor a no-symbol answer, so it never counts toward delisting.
  if (!Number.isFinite(price) || price <= 0 || !asOf) {
    return { kind: 'refused', detail: `no traded price yet (LTP "${header.LTP}", Ason "${asOfText}")` };
  }
  return { kind: 'price', price, asOf, asOfText };
}

export type BseRawFetch = (url: string) => Promise<{ status: number; body: string }>;

export const defaultBseRawFetch: BseRawFetch = async (url) => {
  const res = await fetch(url, { headers: BSE_BROWSER_HEADERS, signal: AbortSignal.timeout(20_000) });
  return { status: res.status, body: await res.text() };
};

export async function readBsePrice(scripCode: string, opts: { fetchRaw?: BseRawFetch } = {}): Promise<QuoteOutcome> {
  const fetchRaw = opts.fetchRaw ?? defaultBseRawFetch;
  let res: { status: number; body: string };
  try {
    res = await fetchRaw(bseScripHeaderUrl(scripCode));
  } catch (error) {
    return { kind: 'refused', exchange: 'BSE', detail: `network: ${error instanceof Error ? error.message : String(error)}`, calls: 1 };
  }
  if (res.status !== 200) return { kind: 'refused', exchange: 'BSE', detail: `HTTP ${res.status}: ${res.body.slice(0, 120)}`, calls: 1 };
  const parsed = parseBseScripHeader(res.body);
  if (parsed.kind === 'price') {
    return { kind: 'price', exchange: 'BSE', price: parsed.price, asOf: parsed.asOf, asOfText: parsed.asOfText, calls: 1 };
  }
  return { kind: parsed.kind, exchange: 'BSE', detail: parsed.detail, calls: 1 };
}
