/**
 * Item 7 S5 — the post-listing price reads (spec §2.1 "Post-listing prices: 15 minutes,
 * 90 days, and no broker feed (OD-29)", OD-54; findings F-150, F-155).
 *
 * Two free public exchange endpoints, both measured before this was written:
 *   - NSE `GetQuoteApi?functionName=getSymbolData` (F-150). It answers only for the
 *     stock's real trading series: EQ for mainboard, SM or ST for SME depending on the
 *     stock. A wrong series is a 404 (measured), so a 404 is NOT a real "no such symbol" answer
 *     by itself: only "no series answers" is a no-such-symbol read.
 *   - BSE `getScripHeaderData` by scrip code (F-150), the scrip code taken from the BSE
 *     active-scrip list by ISIN (F-155: `ipos.bse_scrip_code` is NULL on every row).
 *     Both BSE calls return an Akamai "Access Denied" page to a bare User-Agent.
 *
 * Every read returns one of three outcomes, never a thrown error for an exchange answer:
 *   price     — a positive last traded price with the exchange's own as-of time
 *   no-symbol — the exchange says there is no such symbol (every series tried answered
 *               a 404 with NSE's JSON error body or an explicit empty quote list; or BSE's
 *               well-formed answer names no scrip / a scrip whose category is Delisted on BSE)
 *   refused   — UNKNOWN: Access Denied, a 404 without NSE's JSON error body (a renamed or
 *               retired route), a BSE scrip that is suspended or of any category other than
 *               Listed/Delisted, a non-JSON or empty 200, an empty `{}`, a network
 *               error or timeout, a 5xx, a listed scrip with no trade yet. Never counted
 *              , always logged with its cause (round 2, Tier A MAJOR 1).
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

/** Per-request timeout for every exchange quote call: one hung request must never eat the run. */
export const EXCHANGE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Round 3 (independent review of round 2, MAJOR): the body NSE's GetQuoteApi sends with a
 * 404 when the symbol has no quote in that series, measured on 2026-09-24 for a wrong series
 * (VINOD/SM) and a symbol that does not exist (ZZNOSUCHSYM, all four series): exactly
 * `{"error":"Unexpected end of JSON input"}`. A 404 whose body is anything else (the HTML page
 * a renamed or retired route answers with, an empty body, some other JSON) says nothing about
 * the symbol and is UNKNOWN.
 */
export function isNseNoSuchSeriesBody(body: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && typeof (parsed as { error?: unknown }).error === 'string';
}

/**
 * What one NSE series answer means (round 2, Tier A MAJOR 1). Only an HTTP 404 or a
 * well-formed JSON body that EXPLICITLY carries no quote (`equityResponse: []`) says
 * "no such symbol in this series". Everything else that is not a quote is UNKNOWN: an
 * outage page must never be read as a real "no such symbol" answer (a caller deciding
 * and an outage is not an answer).
 */
export function classifyNseSeriesAnswer(res: { status: number; body: string }):
  | { kind: 'price'; quote: NonNullable<ReturnType<typeof parseNseSymbolData>> }
  | { kind: 'no-symbol' }
  | { kind: 'refused'; detail: string } {
  if (res.status === 404) {
    return isNseNoSuchSeriesBody(res.body)
      ? { kind: 'no-symbol' }
      : { kind: 'refused', detail: `HTTP 404 without NSE's JSON error body (route renamed, retired or down?): ${res.body.slice(0, 80)}` };
  }
  if (res.status !== 200) return { kind: 'refused', detail: `HTTP ${res.status}: ${res.body.slice(0, 120)}` };
  if (res.body.trim() === '') return { kind: 'refused', detail: 'HTTP 200 with an empty body' };
  if (/Access Denied/i.test(res.body)) return { kind: 'refused', detail: `Access Denied page (${res.body.length} bytes)` };
  let parsed: any;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    return { kind: 'refused', detail: `HTTP 200 with a non-JSON body (${res.body.length} bytes)` };
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.equityResponse)) {
    return { kind: 'refused', detail: `HTTP 200 JSON with no equityResponse (${res.body.slice(0, 80)})` };
  }
  if (parsed.equityResponse.length === 0) return { kind: 'no-symbol' };
  const quote = parseNseSymbolData(res.body);
  if (quote) return { kind: 'price', quote };
  return { kind: 'refused', detail: 'HTTP 200 quote row with no usable price or as-of time' };
}

/**
 * Read one NSE price: try each series (the cached working series first) until one
 * answers with a quote. Only when EVERY series answers "no such symbol" (404, or an
 * explicit empty quote list) is it a no-symbol read. The first unknown answer (403,
 * 5xx, timeout, an HTML or empty 200) stops the loop: `refused`, with its cause.
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
    const answer = classifyNseSeriesAnswer(res);
    if (answer.kind === 'price') return { kind: 'price', exchange: 'NSE', ...answer.quote, series, calls };
    if (answer.kind === 'refused') return { kind: 'refused', exchange: 'NSE', detail: `series ${series}: ${answer.detail}`, calls };
  }
  return { kind: 'no-symbol', exchange: 'NSE', detail: `every series answered no-such-symbol for ${symbol}`, calls };
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
  const cmp = parsed?.Cmpname;
  // Round 2: "no such scrip" only when BSE's answer has its usual shape and says so
  // (Cmpname present, FullN null: scrip 999999). An empty `{}` or any other shape is unknown.
  if (!header || typeof header !== 'object' || !cmp || typeof cmp !== 'object') {
    return { kind: 'refused', detail: `JSON without Header/Cmpname (${body.slice(0, 80)})` };
  }
  const category = String(header?.Category ?? cmp?.Category ?? '').trim();
  if (!cmp.FullN) return { kind: 'no-symbol', detail: 'no scrip in the answer' };
  // Round 3 (review MINOR 1): the categories this reader recognises. "Delisted" is the only one
  // that says the scrip no longer trades. "Listed" (or blank, with a named scrip) goes on to the
  // price. Anything else — "Suspended", "Permitted", a word BSE adds later — is UNKNOWN: a
  // suspended scrip still exists and may resume, so it is never a real "no such symbol" answer.
  if (/^delisted$/i.test(category)) return { kind: 'no-symbol', detail: `scrip category ${category}` };
  if (category && !/^listed$/i.test(category)) return { kind: 'refused', detail: `scrip category ${category} (not Listed, not Delisted: unknown)` };
  // Measured 2026-09-24: a suspended scrip (500102) answers Category "Listed" with DisplayText
  // "Suspended due to Procedural reasons" and its last pre-suspension LTP (0.89, as of 22 Jun 23).
  // That LTP is not today's price and the suspension is not a price: UNKNOWN.
  const notice = [header.DisplayText, header.IDB_DisplayText].map((s) => String(s ?? '').trim()).find((s) => /suspend/i.test(s));
  if (notice) return { kind: 'refused', detail: `scrip suspended: ${notice}` };
  const price = Number(String(header.LTP ?? parsed?.CurrRate?.LTP ?? '').replace(/,/g, ''));
  const asOfText = String(header.Ason ?? '');
  const asOf = parseBseAsOn(asOfText);
  // A listed scrip with no trade yet (LTP "-", F-150: NSE IPO 544937) is neither a price
  // nor a no-symbol answer, so it is UNKNOWN.
  if (!Number.isFinite(price) || price <= 0 || !asOf) {
    return { kind: 'refused', detail: `no traded price yet (LTP "${header.LTP}", Ason "${asOfText}")` };
  }
  return { kind: 'price', price, asOf, asOfText };
}

export type BseRawFetch = (url: string) => Promise<{ status: number; body: string }>;

export const defaultBseRawFetch: BseRawFetch = async (url) => {
  const res = await fetch(url, { headers: BSE_BROWSER_HEADERS, signal: AbortSignal.timeout(EXCHANGE_REQUEST_TIMEOUT_MS) });
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

/**
 * Round 2 (Tier A MAJOR 3): the pause between exchange calls, so a run is a steady trickle and
 * not a burst. 400 ms: 129 in-window IPOs (staging, 2026-09-24) at about one call each is ~52 s
 * of spacing plus ~0.3 s of latency a call (measured on the core-proof reads), ~90 s a run —
 * comfortably inside the 3-minute run deadline and the 4-minute `live` lock — and at most 2.5
 * requests a second, well under the page-plus-assets burst a browser opening one NSE quote page
 * makes. Neither exchange publishes a rate limit for these endpoints (§7.4 "Politeness").
 */
export const EXCHANGE_CALL_GAP_MS = 400;

/** Returns `wait()`: resolves once at least `gapMs` has passed since the previous `wait()` resolved. */
export function createPacer(
  gapMs: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): () => Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: number | null = null;
  return async () => {
    if (last !== null) {
      const due = last + gapMs - now();
      if (due > 0) await sleep(due);
    }
    last = now();
  };
}
