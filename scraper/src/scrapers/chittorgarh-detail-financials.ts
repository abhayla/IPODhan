/**
 * Item 43 round 2 (OD-164(e)): the Chittorgarh IPO detail page's financial, KPI, valuation,
 * shareholding, timetable and anchor values, read for the field-plan walk.
 *
 * Every read is fail-closed (B4(c)): a value is returned only when exactly one printed cell
 * carries it, under a label read from the page, in a unit read from the page. Otherwise the
 * read is `absent` (the page does not print it for this IPO: OD-60 abstention, never 0) or
 * `refused` with the reason (two different values, an unreadable unit, an out-of-bounds number).
 *
 * Units (spec Appendix A rows 56-81, §0.8): `financial_data` money columns are stored in
 * ₹ crore. The financial table states its own unit ("Amount in ₹ Crore"); a crore table is
 * stored as printed, a lakh or million table is converted exactly once, and a table whose unit
 * line is missing or unknown is refused for every money field it carries.
 *
 * Years: the per-FY columns are mapped by the PRINTED period label ("31 Mar 2024" -> FY2024),
 * never by column position; balance-sheet snapshots take the column with the latest printed
 * period date. F-230: "Total Income" is never read as revenue; no revenue row is mapped here.
 */
import { FINANCIAL_FIELD_BOUNDS } from './chittorgarh-detail-fields.js';
import { isinCheckDigitValid } from './isin-check-digit.js';

/** `note`: a provenance remark recorded with the answer (e.g. OD-167 "RoNW used for ROE"). */
export type DetailRead = { value: number | string; note?: string } | { absent: true } | { refused: string };

const ABSENT: DetailRead = { absent: true };

function cellText(s: string): string {
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#8377;|&#x20b9;/gi, '₹')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowsOf(table: string): string[][] {
  return (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) =>
    [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => cellText(m[1]))
  );
}

/** Every rendered <table> on the page, identical copies collapsed (the page repeats some blocks). */
function tablesOf(html: string): string[] {
  return [...new Set(html.match(/<table[\s\S]*?<\/table>/gi) ?? [])];
}

/** A printed number: strips ₹, separators, "Cr.", "%", "(x)"; "(12.3)" is -12.3; blank / "-" / "N/A" is absent. */
function parseNumber(raw: string): number | null {
  let s = raw.replace(/₹/g, '').replace(/,/g, '').replace(/cr\.?/gi, '').replace(/%/g, '').replace(/\(x\)/gi, '').trim();
  let neg = false;
  const paren = s.match(/^\((.+)\)$/);
  if (paren) {
    neg = true;
    s = paren[1].trim();
  }
  if (s === '' || /^[-–—]$/.test(s) || /^\[?[•●]\]?$/.test(s) || /^n\/?a$/i.test(s)) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "31 Mar 2024" / "Mar 31, 2024" -> { y, m, d }; anything else -> null. */
function parsePeriod(label: string): { y: number; m: number; d: number } | null {
  const a = label.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(20\d{2})$/);
  const b = label.match(/^([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(20\d{2})$/);
  const [d, mon, y] = a ? [a[1], a[2], a[3]] : b ? [b[2], b[1], b[3]] : [];
  const m = mon ? MONTHS[mon.toLowerCase()] : undefined;
  if (!m) return null;
  return { y: Number(y), m, d: Number(d) };
}

/** The fiscal-year slot a period column fills: a 31 March period ending in year Y is FY{Y}. */
function fiscalYearOf(p: { y: number; m: number; d: number }): number | null {
  return p.m === 3 && p.d === 31 ? p.y : null;
}

type Bound = { min: number; max: number };

function bounded(n: number, b: Bound, what: string): DetailRead {
  if (n < b.min || n > b.max) return { refused: `${what} ${n} outside [${b.min}, ${b.max}]` };
  return { value: n };
}

/** One labelled row's cells from a set of tables; two rows with different cells is ambiguous. */
function oneRow(rows: string[][], label: RegExp): string[] | 'none' | 'ambiguous' {
  const hits = rows.filter((r) => r.length >= 2 && label.test(r[0]));
  if (hits.length === 0) return 'none';
  const distinct = new Set(hits.map((r) => JSON.stringify(r)));
  return distinct.size === 1 ? hits[0] : 'ambiguous';
}

// ---------------------------------------------------------------------------------------------
// Financial table (id="financialTable")
// ---------------------------------------------------------------------------------------------

const UNIT_TO_CRORE: ReadonlyArray<[RegExp, number, string]> = [
  [/^crores?$/i, 1, 'crore'],
  [/^lakhs?$/i, 0.01, 'lakh'],
  [/^millions?$/i, 0.1, 'million'],
];

/** The financial table's own unit line -> crore factor, or a refusal reason. */
function financialUnit(html: string, tableIdx: number, tableEnd: number): { factor: number; unit: string } | { refused: string } {
  // The unit line sits in the table's last row or immediately after it.
  const tail = cellText(html.slice(tableIdx, tableEnd + 400));
  // Word boundaries: "Amount Invested" (the anchor block) is not a unit line.
  const units = [...tail.matchAll(/\bAmount in\s+(?:₹|Rs\.?|INR)?\s*([A-Za-z]+)\b/gi)].map((m) => m[1]);
  const distinct = [...new Set(units.map((u) => u.toLowerCase()))];
  if (distinct.length === 0) return { refused: 'financial table unit line not found' };
  if (distinct.length > 1) return { refused: `financial table states two units: ${distinct.join(', ')}` };
  const hit = UNIT_TO_CRORE.find(([re]) => re.test(distinct[0]));
  if (!hit) return { refused: `financial table unit "${distinct[0]}" is not crore, lakh or million` };
  return { factor: hit[1], unit: hit[2] };
}

/** Round a converted crore value to the column's 2 decimals without float noise. */
function toCrore(n: number, factor: number): number {
  return Math.round(n * factor * 100) / 100;
}

const PER_FY_ROWS: ReadonlyArray<[string, RegExp, Bound]> = [
  ['totalIncome', /^total income$/i, FINANCIAL_FIELD_BOUNDS.totalIncome],
  ['profit', /^profit after tax$/i, FINANCIAL_FIELD_BOUNDS.profit],
  ['ebitda', /^ebitda$/i, FINANCIAL_FIELD_BOUNDS.ebitda],
];

const SNAPSHOT_ROWS: ReadonlyArray<[string, RegExp, Bound]> = [
  ['netWorth', /^net worth$/i, FINANCIAL_FIELD_BOUNDS.netWorth],
  ['reservesAndSurplus', /^reserves (and|&) surplus$/i, FINANCIAL_FIELD_BOUNDS.reservesAndSurplus],
  ['totalAssets', /^(total )?assets$/i, FINANCIAL_FIELD_BOUNDS.totalAssets],
  ['totalBorrowing', /^total borrowings?$/i, FINANCIAL_FIELD_BOUNDS.totalBorrowing],
];

const FY_SLOTS = [2022, 2023, 2024] as const;

function readFinancialTable(html: string, out: Map<string, DetailRead>): void {
  const re = /<table[^>]*id=['"]financialTable['"][\s\S]*?<\/table>/gi;
  const found: Array<{ table: string; idx: number; end: number }> = [];
  for (let m = re.exec(html); m; m = re.exec(html)) found.push({ table: m[0], idx: m.index, end: m.index + m[0].length });
  const distinct = [...new Map(found.map((f) => [f.table, f])).values()];
  const keys = [
    ...PER_FY_ROWS.flatMap(([p]) => FY_SLOTS.map((y) => `${p}Fy${y}`)),
    ...SNAPSHOT_ROWS.map(([k]) => k),
  ];
  if (distinct.length === 0) return; // not printed: every key stays absent
  if (distinct.length > 1) {
    for (const k of keys) out.set(k, { refused: 'two different financial tables on the page' });
    return;
  }
  const { table, idx, end } = distinct[0];
  const unit = financialUnit(html, idx, end);
  const rows = rowsOf(table);
  const header = rows.find((r) => /^period ended$/i.test(r[0] ?? ''));
  if (!header) {
    for (const k of keys) out.set(k, { refused: 'financial table has no "Period Ended" header row' });
    return;
  }
  const periods = header.slice(1).map(parsePeriod);
  const refuseAll = (reason: string) => {
    for (const k of keys) out.set(k, { refused: reason });
  };
  if ('refused' in unit) return refuseAll(unit.refused);
  if (periods.some((p) => p === null)) return refuseAll(`unreadable period label in ${JSON.stringify(header.slice(1))}`);
  const ps = periods as Array<{ y: number; m: number; d: number }>;
  const dateKey = (p: { y: number; m: number; d: number }) => p.y * 10000 + p.m * 100 + p.d;
  const latestKey = Math.max(...ps.map(dateKey));
  const latestCols = ps.map((p, i) => (dateKey(p) === latestKey ? i : -1)).filter((i) => i >= 0);

  for (const [prefix, label, bound] of PER_FY_ROWS) {
    const row = oneRow(rows, label);
    for (const fy of FY_SLOTS) {
      const key = `${prefix}Fy${fy}`;
      if (row === 'ambiguous') {
        out.set(key, { refused: `two "${label.source}" rows` });
        continue;
      }
      const cols = ps.map((p, i) => (fiscalYearOf(p) === fy ? i : -1)).filter((i) => i >= 0);
      if (row === 'none' || cols.length === 0) continue; // not printed for this year
      if (cols.length > 1) {
        out.set(key, { refused: `two columns for FY${fy}` });
        continue;
      }
      const n = parseNumber(row[cols[0] + 1] ?? '');
      if (n === null) continue;
      out.set(key, bounded(toCrore(n, unit.factor), bound, key));
    }
  }

  for (const [key, label, bound] of SNAPSHOT_ROWS) {
    const row = oneRow(rows, label);
    if (row === 'ambiguous') {
      out.set(key, { refused: `two "${label.source}" rows` });
      continue;
    }
    if (row === 'none') continue;
    if (latestCols.length !== 1) {
      out.set(key, { refused: 'two columns share the latest period' });
      continue;
    }
    const n = parseNumber(row[latestCols[0] + 1] ?? '');
    if (n === null) continue;
    out.set(key, bounded(toCrore(n, unit.factor), bound, key));
  }
}

// ---------------------------------------------------------------------------------------------
// KPI, valuation and shareholding tables (classified by their own header row)
// ---------------------------------------------------------------------------------------------

function tablesWithHeader(html: string, header: RegExp): string[][][] {
  return tablesOf(html)
    .map(rowsOf)
    .filter((rows) => rows.length > 0 && header.test(rows[0].join(' | ')));
}

function readSingleTable(html: string, header: RegExp, keys: string[], out: Map<string, DetailRead>): string[][] | null {
  const tables = tablesWithHeader(html, header);
  if (tables.length === 0) return null;
  const distinct = new Set(tables.map((t) => JSON.stringify(t)));
  if (distinct.size > 1) {
    for (const k of keys) out.set(k, { refused: `two different tables headed ${header.source}` });
    return null;
  }
  return tables[0];
}

function readKpiTable(html: string, out: Map<string, DetailRead>): void {
  const keys = ['roe', 'ronw', 'debtToEquity'];
  const rows = readSingleTable(html, /^KPI \| /i, keys, out);
  if (!rows) return;
  const refuseAll = (reason: string) => {
    for (const k of keys) out.set(k, { refused: reason });
  };
  // The KPI table prints one column per period (e.g. "Feb 28, 2026" stub | "Mar 31, 2025"). The value is read
  // from the latest FULL fiscal year-end (31 March) column by its printed label, never by position.
  const periods = rows[0].slice(1).map(parsePeriod);
  if (periods.length === 0 || periods.some((p) => p === null)) {
    return refuseAll(`KPI header has an unreadable period: ${JSON.stringify(rows[0].slice(1))}`);
  }
  const fyCols = (periods as Array<{ y: number; m: number; d: number }>)
    .map((p, i) => ({ fy: fiscalYearOf(p), i }))
    .filter((c): c is { fy: number; i: number } => c.fy !== null);
  if (fyCols.length === 0) return refuseAll(`KPI header has no 31 March fiscal year-end column: ${JSON.stringify(rows[0].slice(1))}`);
  const latest = Math.max(...fyCols.map((c) => c.fy));
  const cols = fyCols.filter((c) => c.fy === latest);
  if (cols.length > 1) return refuseAll(`KPI header has two columns for FY${latest}`);
  const col = cols[0].i + 1;
  const headerSaysPercent = /%/.test(rows[0][col] ?? '');
  const read = (key: string, label: RegExp, bound: Bound, percent: boolean): DetailRead => {
    const row = oneRow(rows.slice(1), label);
    if (row === 'ambiguous') return { refused: `two "${label.source}" rows` };
    if (row === 'none') return ABSENT;
    const raw = row[col] ?? '';
    const n = parseNumber(raw);
    if (n === null) return ABSENT;
    if (percent && !/%/.test(raw) && !headerSaysPercent) return { refused: `${key} "${raw}" is not printed as a percentage` };
    return bounded(n, bound, key);
  };
  const ronw = read('ronw', /^ronw$/i, FINANCIAL_FIELD_BOUNDS.ronw, true);
  const roe = read('roe', /^roe$/i, FINANCIAL_FIELD_BOUNDS.roe, true);
  // OD-167: "Chittorgarh RoNW for ROE" -- when the page prints no ROE row, its RoNW answers roe, and the
  // answer says so (recorded as the answer's cause, so the admin sees the substitution).
  out.set('roe', 'absent' in roe && 'value' in ronw ? { value: ronw.value, note: `RoNW used for ROE (OD-167), FY${latest}` } : 'absent' in roe ? ronw : roe);
  out.set('ronw', ronw);
  out.set('debtToEquity', read('debtToEquity', /^debt\s*\/\s*equity$/i, FINANCIAL_FIELD_BOUNDS.debtToEquity, false));
}

/** Column index of a header label in a "<metric> | Pre IPO | Post IPO" table, read from the header. */
function headerCol(rows: string[][], label: RegExp): number {
  const hits = rows[0].map((c, i) => (label.test(c) ? i : -1)).filter((i) => i >= 0);
  return hits.length === 1 ? hits[0] : -1;
}

function readValuationTable(html: string, out: Map<string, DetailRead>): void {
  const keys = ['preIpoEps', 'postIpoEps', 'marketCap'];
  const rows = readSingleTable(html, /^Valuation Metric \| /i, keys, out);
  if (!rows) return;
  const pre = headerCol(rows, /^pre ipo$/i);
  const post = headerCol(rows, /^post ipo$/i);
  if (pre < 0 || post < 0) {
    for (const k of keys) out.set(k, { refused: 'valuation table has no single Pre IPO / Post IPO header' });
    return;
  }
  const eps = oneRow(rows.slice(1), /^eps\b/i);
  for (const [key, col] of [['preIpoEps', pre], ['postIpoEps', post]] as const) {
    if (eps === 'ambiguous') out.set(key, { refused: 'two EPS rows' });
    else if (eps !== 'none') {
      const n = parseNumber(eps[col] ?? '');
      if (n !== null) out.set(key, bounded(n, FINANCIAL_FIELD_BOUNDS.eps, key));
    }
  }
  // Spec Appendix A row 72: market_cap = post-issue shares x cap, so the POST IPO column. The cell's own unit
  // ("Cr", "Crore", "Lakh") is converted to crore once; a number with no readable unit is refused.
  const mcap = oneRow(rows.slice(1), /^market cap/i);
  if (mcap === 'ambiguous') out.set('marketCap', { refused: 'two Market Cap rows' });
  else if (mcap !== 'none') {
    const raw = (mcap[post] ?? '').trim();
    if (raw !== '' && !/^[-–—]$/.test(raw)) out.set('marketCap', marketCapCrore(raw));
  }
}

function marketCapCrore(raw: string): DetailRead {
  const m = raw.match(/^(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(cr\.?|crores?|lakhs?|lacs?)?\s*\.?$/i);
  if (!m) return { refused: `market cap "${raw}" is unreadable` };
  if (!m[2]) return { refused: `market cap "${raw}" carries no crore or lakh unit` };
  const n = Number(m[1].replace(/,/g, ''));
  const factor = /^(lakh|lac)/i.test(m[2]) ? 0.01 : 1;
  return bounded(toCrore(n, factor), FINANCIAL_FIELD_BOUNDS.marketCap, 'marketCap');
}

function readShareholdingTable(html: string, out: Map<string, DetailRead>): void {
  const keys = ['promoterHoldingPreIssue', 'promoterHoldingPostIssue'];
  const rows = readSingleTable(html, /^Category \| Pre IPO \| Post IPO$/i, keys, out);
  if (!rows) return;
  const promoter = oneRow(rows.slice(1), /^promoters?\b/i);
  if (promoter === 'none') return;
  for (const [key, col] of [['promoterHoldingPreIssue', 1], ['promoterHoldingPostIssue', 2]] as const) {
    if (promoter === 'ambiguous') {
      out.set(key, { refused: 'two promoter rows in the shareholding table' });
      continue;
    }
    const raw = promoter[col] ?? '';
    const n = parseNumber(raw);
    if (n === null) continue;
    out.set(key, /%/.test(raw) ? bounded(n, FINANCIAL_FIELD_BOUNDS.promoterHolding, key) : { refused: `holding "${raw}" is not a percentage` });
  }
}

/**
 * Every financial_data value the detail page prints, keyed by the camelCase column name.
 * A key not in the map is not printed for this IPO (absent).
 */
export function readChittorgarhFinancialData(html: string): Map<string, DetailRead> {
  const out = new Map<string, DetailRead>();
  if (!html) return out;
  readFinancialTable(html, out);
  readKpiTable(html, out);
  readValuationTable(html, out);
  readShareholdingTable(html, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Timetable and anchor bid date
// ---------------------------------------------------------------------------------------------

function isoDate(raw: string): DetailRead {
  const s = raw.trim();
  if (!s || /^(n\/?a|tbd|tba|-+)$/i.test(s)) return ABSENT;
  const m = s.match(/^(?:[A-Za-z]{3},\s*)?([A-Za-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})$/);
  const month = m ? MONTHS[m[1].toLowerCase()] : undefined;
  if (!m || !month) return { refused: `unreadable date "${s}"` };
  const iso = `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (isNaN(check.getTime()) || check.getUTCDate() !== Number(m[2])) return { refused: `impossible date "${s}"` };
  return { value: iso };
}

function onlyDate(raws: string[]): DetailRead {
  const distinct = [...new Set(raws.map((r) => r.trim()))];
  if (distinct.length === 0) return ABSENT;
  if (distinct.length > 1) return { refused: `two different dates printed: ${distinct.join(' / ')}` };
  return isoDate(distinct[0]);
}

/** The "IPO Timetable" date whose keyword link carries `title` (e.g. "Initiation of Refunds Description"). */
export function readChittorgarhTimetableDate(html: string, title: string): DetailRead {
  if (!html) return ABSENT;
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`title="${esc}"[^>]*>[^<]*</a></span><span class="text-end">([^<]*)</span>`, 'gi');
  return onlyDate([...html.matchAll(re)].map((m) => m[1]));
}

/** The anchor section's "Bid Date" row (rendered HTML, not the RSC stream copy). */
export function readChittorgarhAnchorBidDate(html: string): DetailRead {
  if (!html) return ABSENT;
  return onlyDate([...html.matchAll(/<tr><td>Bid Date<\/td><td class="text-end">([^<]*)<\/td><\/tr>/gi)].map((m) => m[1]));
}

/** The detail page's ISIN cell: an Indian equity ISIN (INE + 9) with a valid check digit, else refused. */
export function readChittorgarhIsin(html: string): DetailRead {
  if (!html) return ABSENT;
  const m = html.match(/ISIN<\/a>[\s\S]{0,160}?<td[^>]*>\s*([^<]*?)\s*<\/td>/i) ?? html.match(/ISIN<\/a>[\s\S]{0,160}?\b([A-Z0-9]{12})\b/i);
  if (!m) return ABSENT;
  const raw = m[1].trim().toUpperCase();
  if (raw === '' || /^(n\/?a|-+|\[?[•●]\]?)$/i.test(raw)) return ABSENT;
  if (!/^INE[A-Z0-9]{9}$/.test(raw)) return { refused: `ISIN "${raw}" is not an INE + 9 character ISIN` };
  if (!isinCheckDigitValid(raw)) return { refused: `ISIN "${raw}" fails the ISIN check digit` };
  return { value: raw };
}
