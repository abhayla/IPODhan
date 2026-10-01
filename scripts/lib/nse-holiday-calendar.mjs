/**
 * NSE's own trading-holiday list, read and compared ONE way (F-220, F-221, #1380).
 *
 * Why this exists: market_holidays is the exchange holiday calendar that OD-21's working-day
 * rules (listing_t3 / listing_t6, spec §4.6 "working_days_inclusive, defined once") and the
 * scheduler gates read. Two defects reached it: the web writer stored every NSE date one day early
 * (an IST-midnight Date sent through toISOString, F-220), and the 2026 rows were typed from
 * festival dates instead of the exchange list (F-221). This module is the single reader of NSE's
 * answer, used by the reconcile tool (scraper/scripts/repair-market-holidays-from-nse.ts) and by
 * the nightly check market_holidays_match_nse (scripts/audit-detection-floor.mjs).
 *
 * The answer-state table (spec-verified-recommendations rule 10) — every state NSE can give for
 * a year Y, and what a caller may do with it:
 *   list               >=1 parseable CM row dated in Y  -> reconcile Y to exactly that list
 *   fetch-failed       HTTP error / timeout / blocked   -> change NOTHING, exit non-zero, cause
 *   malformed          body is not JSON / no CM array   -> change NOTHING, exit non-zero, cause
 *   no-rows-for-year   valid answer, no row dated in Y  -> change NOTHING for Y (a year NSE has
 *                                                          not published is not "no holidays")
 *   unparseable-rows   a row of Y whose date fails       -> change NOTHING for Y, report the rows
 *
 * Measured 2026-10-02 (fixture scraper/tests/fixtures/nse/holiday-master-trading-2026-10-02.json):
 * the API publishes the CURRENT year only, so 2025 is "no-rows-for-year" there; the 2025 shifted
 * copies are repaired by #1380's repair-shifted-market-holidays.ts, not by this list.
 */

export const NSE_HOME_URL = 'https://www.nseindia.com/';
export const NSE_HOLIDAY_MASTER_URL = 'https://www.nseindia.com/api/holiday-master?type=trading';
/** The capital-market (equity) segment. The old web writer read CBM (corporate bonds). */
export const NSE_EQUITY_SEGMENT = 'CM';
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * NSE's "15-Jan-2026" -> "2026-01-15", built from the day / month / year components. Never goes
 * through a Date in the process zone (that is the F-220 shift). Returns null for anything that is
 * not a real calendar date in that exact shape.
 * @param {unknown} text
 * @returns {string | null}
 */
export function parseNseTradingDate(text) {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** @param {string} isoDate YYYY-MM-DD @returns {string} Mon..Sun */
export function weekdayOf(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
}

function cleanDescription(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Classify NSE's answer for one year. `body` is the parsed JSON (or the raw text, which is parsed
 * here so a non-JSON answer is classified, not thrown).
 * @param {unknown} body
 * @param {number} year
 * @param {string} [segment]
 */
export function interpretNseHolidayAnswer(body, year, segment = NSE_EQUITY_SEGMENT) {
  let data = body;
  if (typeof body === 'string') {
    try {
      data = JSON.parse(body);
    } catch (err) {
      return { state: 'malformed', year, cause: `answer is not JSON (${err.message}); first bytes: ${body.slice(0, 80)}` };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { state: 'malformed', year, cause: 'answer is not a JSON object' };
  }
  const rows = data[segment];
  if (!Array.isArray(rows)) {
    return { state: 'malformed', year, cause: `answer has no ${segment} array (keys: ${Object.keys(data).join(',') || 'none'})` };
  }
  const yearToken = String(year);
  const holidaysByDate = new Map();
  const unparseable = [];
  const yearsPresent = new Set();
  for (const row of rows) {
    const raw = row && typeof row === 'object' ? row.tradingDate : undefined;
    const iso = parseNseTradingDate(raw);
    if (iso) {
      yearsPresent.add(Number(iso.slice(0, 4)));
      if (iso.slice(0, 4) !== yearToken) continue;
      const description = cleanDescription(row.description) || 'Trading Holiday';
      const prior = holidaysByDate.get(iso);
      holidaysByDate.set(iso, prior && prior !== description ? `${prior} / ${description}` : description);
      continue;
    }
    // A row whose date cannot be read: it belongs to Y if its text names Y, and to EVERY year if
    // it names none (it might be a Y row, so Y cannot be called complete).
    const named = /(\d{4})\s*$/.exec(typeof raw === 'string' ? raw : '');
    if (!named || named[1] === yearToken) unparseable.push(row);
  }
  if (unparseable.length > 0) return { state: 'unparseable-rows', year, rows: unparseable };
  if (holidaysByDate.size === 0) return { state: 'no-rows-for-year', year, yearsPresent: [...yearsPresent].sort() };
  const holidays = [...holidaysByDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, description]) => ({ date, description, weekday: weekdayOf(date) }));
  return { state: 'list', year, holidays };
}

/**
 * One polite fetch of NSE's holiday master: a homepage visit for the session cookies (the same
 * warm-up scraper/src/scrapers/nse-api-client.ts does), then the API. Never throws: an HTTP error,
 * timeout, block or non-JSON body comes back as { ok: false, cause }.
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, body: string } | { ok: false, cause: string }>}
 */
export async function fetchNseHolidayMaster(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 20000;
  const timed = async (url, headers) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { headers, signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  };
  try {
    const home = await timed(NSE_HOME_URL, { 'User-Agent': BROWSER_UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' });
    const cookies = (typeof home.headers?.getSetCookie === 'function' ? home.headers.getSetCookie() : [])
      .map((c) => c.split(';')[0])
      .filter(Boolean);
    const res = await timed(NSE_HOLIDAY_MASTER_URL, {
      'User-Agent': BROWSER_UA,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.nseindia.com/resources/exchange-communication-holidays',
      ...(cookies.length > 0 ? { Cookie: cookies.join('; ') } : {}),
    });
    const body = await res.text();
    if (!res.ok) return { ok: false, cause: `NSE holiday-master answered HTTP ${res.status}` };
    return { ok: true, body };
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err ? err.name : '';
    const cause = err && typeof err === 'object' && 'cause' in err && err.cause ? ` (${err.cause.message ?? err.cause})` : '';
    return { ok: false, cause: name === 'AbortError' ? `NSE holiday-master timed out after ${timeoutMs} ms` : `NSE holiday-master fetch failed: ${err?.message ?? err}${cause}` };
  }
}

const STOP_TOKENS = new Set(['shri', 'holiday', 'trading', 'jayanti', 'festival', 'with']);
function tokens(description) {
  return new Set(
    String(description ?? '')
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP_TOKENS.has(w))
  );
}
/** Words of one description found in the other (a word may sit inside a run-together spelling: "Gurunanak" holds "nanak"). */
function sharedWords(a, b) {
  const compactA = String(a ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const compactB = String(b ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const fromB = [...tokens(b)].filter((t) => compactA.includes(t)).length;
  const fromA = [...tokens(a)].filter((t) => compactB.includes(t)).length;
  return Math.max(fromA, fromB);
}
function dayNumber(isoDate) {
  const [y, mo, d] = isoDate.split('-').map(Number);
  return Date.UTC(y, mo - 1, d) / 86400000;
}

/**
 * The plan that makes year Y's TRADING rows (EVERY exchange label, every writer) exactly NSE's
 * list: one row per NSE date, labelled BOTH (NSE and BSE trading holidays are one set, F-220; the
 * TradingCalendar of #1380 reads TRADING/BOTH rows of every exchange), description from NSE.
 *
 * - move:   a stored row on a date NSE does not list, for a holiday NSE lists on a nearby date
 *           (same significant word, within 45 days) -> the row keeps its id, gets NSE's date
 * - insert: an NSE date no stored row covers
 * - retire: a stored row on a date NSE does not list (no pairing), or a second row on an NSE date
 * - update: the row kept on an NSE date, relabelled BOTH and/or given NSE's description
 *
 * @param {Array<{id: string, date: string, description: string, exchange: string}>} existingRows
 *        TRADING rows dated in Y (any exchange)
 * @param {Array<{date: string, description: string}>} holidays NSE's list for Y
 */
export function planHolidayReconcile(existingRows, holidays) {
  const target = new Map(holidays.map((h) => [h.date, h.description]));
  const byDate = new Map();
  for (const row of existingRows) {
    if (!byDate.has(row.date)) byDate.set(row.date, []);
    byDate.get(row.date).push(row);
  }
  const actions = [];
  const stale = [];
  for (const [date, rows] of byDate) {
    if (!target.has(date)) stale.push(...rows);
  }
  const missing = [...target.keys()].filter((d) => !byDate.has(d)).sort();

  // Pair stale rows with missing dates (misdated holidays) — nearest first, one each.
  const pairs = [];
  for (const row of stale) {
    for (const date of missing) {
      const shared = sharedWords(row.description, target.get(date));
      const distance = Math.abs(dayNumber(date) - dayNumber(row.date));
      if (shared > 0 && distance <= 45) pairs.push({ row, date, distance, shared });
    }
  }
  // Most words in common first ("Diwali Balipratipada" -> "Diwali-Balipratipada"), then nearest.
  pairs.sort((a, b) => b.shared - a.shared || a.distance - b.distance || (a.row.date < b.row.date ? -1 : 1) || (a.date < b.date ? -1 : 1));
  const movedRows = new Set();
  const filledDates = new Set();
  for (const p of pairs) {
    if (movedRows.has(p.row.id) || filledDates.has(p.date)) continue;
    movedRows.add(p.row.id);
    filledDates.add(p.date);
    actions.push({ kind: 'move', id: p.row.id, from: p.row.date, date: p.date, before: p.row.description, description: target.get(p.date), exchangeBefore: p.row.exchange });
  }
  for (const row of stale) {
    if (!movedRows.has(row.id)) actions.push({ kind: 'retire', id: row.id, date: row.date, description: row.description, exchange: row.exchange, why: 'not in NSE list' });
  }
  for (const date of missing) {
    if (!filledDates.has(date)) actions.push({ kind: 'insert', date, description: target.get(date) });
  }
  for (const [date, description] of target) {
    const rows = byDate.get(date);
    if (!rows) continue;
    const keeper =
      rows.find((r) => r.exchange === 'BOTH' && r.description === description) ??
      rows.find((r) => r.exchange === 'BOTH') ??
      rows[0];
    if (keeper.exchange !== 'BOTH' || keeper.description !== description) {
      actions.push({ kind: 'update', id: keeper.id, date, before: keeper.description, description, exchangeBefore: keeper.exchange });
    }
    for (const extra of rows) {
      if (extra !== keeper) actions.push({ kind: 'retire', id: extra.id, date, description: extra.description, exchange: extra.exchange, why: 'second row on an NSE date' });
    }
  }
  const order = { insert: 0, move: 1, update: 2, retire: 3 };
  actions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));
  return actions;
}

/**
 * The detection comparison: the DISTINCT TRADING dates stored for Y (any exchange) against NSE's
 * list for Y.
 * @param {string[]} storedDates
 * @param {Array<{date: string}>} holidays
 */
export function compareYearToNse(storedDates, holidays) {
  const stored = new Set(storedDates);
  const nse = new Set(holidays.map((h) => h.date));
  return {
    missing: [...nse].filter((d) => !stored.has(d)).sort(),
    extra: [...stored].filter((d) => !nse.has(d)).sort(),
  };
}

/** One dry-run / apply line per action, with weekday and description. */
export function formatHolidayAction(a) {
  const wd = (d) => `${d} (${weekdayOf(d)})`;
  switch (a.kind) {
    case 'insert':
      return `INSERT ${wd(a.date)} '${a.description}'`;
    case 'retire':
      return `RETIRE ${wd(a.date)} '${a.description}' [${a.exchange}] — ${a.why}`;
    case 'move':
      return `MOVE   ${wd(a.from)} -> ${wd(a.date)} '${a.before}' -> '${a.description}' [${a.exchangeBefore} -> BOTH]`;
    case 'update':
      return `UPDATE ${wd(a.date)} '${a.before}' -> '${a.description}' [${a.exchangeBefore} -> BOTH]`;
    default:
      return JSON.stringify(a);
  }
}
