/**
 * #1486: read the walk's NSE fields from one `/api/ipo-detail` payload.
 *
 * `issueInfo.dataList` is a list of `{ title, value }` rows (real capture:
 * scraper/tests/fixtures/nse/ipo-detail-RUNWALENTR.live-2026-10-03.json). The boards carry the band
 * as `issuePrice`; ipo-detail carries it as the "Price Range" row, and NSE keeps serving it after the
 * IPO has left the boards -- which is why the walk fetcher falls back to it.
 *
 * Every field answers one of three shapes, never a guess (B4(c)):
 *   { value }    the row is present, single, and parses
 *   { absent }   the row is missing, empty, or states a shape that is not a value for this field
 *                (a single price is not a band: T-308, same as `parsePriceRange` on the board path)
 *   { error }    the row is duplicated, or present and unparseable -> the caller answers CHECK_FAILED
 */
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { parseNSEDate, parsePriceRange } from './nse-api-client.js';
import { parseNseLeadManagers } from '../services/nse-party-parser.js';

export type NseDetailField =
  | 'symbol'
  | 'openDate'
  | 'closeDate'
  | 'priceRangeMin'
  | 'priceRangeMax'
  | 'lotSize'
  // Item 43 (OD-164(e)): issueInfo rows Appendix A ranks NSE for, read from the SAME payload.
  | 'registrar'
  | 'leadManagers'
  | 'faceValue'
  | 'issueType'
  | 'sponsorBanks'
  | 'tickSize'
  | 'ipoMarketTimings'
  | 'upiCutoffTime'
  | 'employeeDiscount'
  | 'maxRetailSubscription'
  | 'maxEmployeeSubscription'
  | 'categoryDetails'
  | 'subCategoriesUPI';

export type NseDetailFieldValue = string | number | string[] | { codes: string[]; original: string };

export type NseDetailFieldAnswer = { value: NseDetailFieldValue } | { absent: true } | { error: string };

export type NseDetailParse =
  | { kind: 'empty' }
  | { kind: 'identity_mismatch'; cause: string }
  | { kind: 'ok'; fields: Record<NseDetailField, NseDetailFieldAnswer> };

export interface DataRow {
  title: string | null;
  value: string;
}

const ABSENT: NseDetailFieldAnswer = { absent: true };

/**
 * The rows with exactly this title (trimmed, case-insensitive). NSE wraps many values in literal
 * double quotes ('"Rs. 2,00,000"'); they are stripped here, as `nseDataListValue` does.
 */
function rowsTitled(rows: DataRow[], title: string): string[] {
  const want = title.toLowerCase();
  return rows
    .filter((r) => typeof r.title === 'string' && r.title.trim().toLowerCase() === want)
    .map((r) => (typeof r.value === 'string' ? r.value.replace(/^\s*"+|"+\s*$/g, '').trim() : ''));
}

/** One row's value, or why there is none. Two rows with the same title is never resolved by picking one. */
function single(rows: DataRow[], title: string): { value: string } | { absent: true } | { error: string } {
  const hits = rowsTitled(rows, title);
  if (hits.length > 1) return { error: `ipo-detail has ${hits.length} "${title}" rows` };
  if (hits.length === 0 || hits[0] === '') return { absent: true };
  return { value: hits[0] };
}

function band(rows: DataRow[]): { min: NseDetailFieldAnswer; max: NseDetailFieldAnswer } {
  const row = single(rows, 'Price Range');
  if (!('value' in row)) return { min: row, max: row };
  const { min, max } = parsePriceRange(row.value);
  if (min !== undefined && max !== undefined) {
    if (min > 0 && max > 0 && min <= max) return { min: { value: min }, max: { value: max } };
    const error = `ipo-detail "Price Range" is not a valid band: "${row.value}"`;
    return { min: { error }, max: { error } };
  }
  // A lone price is a stated shape (fixed price / final price), not a band: abstain like the board path.
  const numbers = row.value.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 1) return { min: ABSENT, max: ABSENT };
  const error = `ipo-detail "Price Range" unparseable: "${row.value}"`;
  return { min: { error }, max: { error } };
}

function period(rows: DataRow[]): { open: NseDetailFieldAnswer; close: NseDetailFieldAnswer } {
  const row = single(rows, 'Issue Period');
  if (!('value' in row)) return { open: row, close: row };
  const parts = row.value.split(/\s+to\s+/i);
  const open = parts.length === 2 ? parseNSEDate(parts[0]) : undefined;
  const close = parts.length === 2 ? parseNSEDate(parts[1]) : undefined;
  if (!open || !close || open > close) {
    const error = `ipo-detail "Issue Period" unparseable: "${row.value}"`;
    return { open: { error }, close: { error } };
  }
  return { open: { value: open }, close: { value: close } };
}

function lot(rows: DataRow[]): NseDetailFieldAnswer {
  const row = single(rows, 'Bid Lot');
  if (!('value' in row)) return row;
  const m = row.value.match(/^([\d,]+)\s+Equity Shares?\b/i);
  const n = m ? Number(m[1].replace(/,/g, '')) : NaN;
  if (!Number.isInteger(n) || n <= 0) return { error: `ipo-detail "Bid Lot" unparseable: "${row.value}"` };
  return { value: n };
}

/**
 * Parse one ipo-detail payload asked for `expectedSymbol` on behalf of the IPO stored as
 * `expectedCompanyName`. Identity must be PROVEN, not merely not contradicted (PR #1488 review):
 * the reply must carry a symbol equal to the one asked, AND its company-name row (dataList[0].title,
 * e.g. "Runwal Enterprises Limited") must normalise to the stored company name. Anything else is an
 * identity refusal for every field (fail closed), never a value of the IPO that was asked about.
 */
/**
 * D3 (F-236): what proves identity for an SME reply that prints no company name. The caller asks by the
 * IPO's own ACTIVE `NSE_ISSUE` key (so the symbol asked IS that key's symbol) and passes the key's series
 * and the stored issue dates; see `parseNseDetailFields`.
 */
export interface NseDetailSmeIdentity {
  series: 'EQ' | 'SME';
  storedOpenDate: unknown;
  storedCloseDate: unknown;
}

/** A stored `date` column value as YYYY-MM-DD, or null (drizzle's date mode is a string; anything else is not trusted). */
function storedDay(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

/**
 * The issue period NSE states NOW: the "Revised/Extended Issue Period" row when printed (F-237; its
 * title carries a trailing space and its value a trailing "(The Issue is further extended ...)" note),
 * else "Issue Period". Used for SME identity only.
 */
function statedPeriod(rows: DataRow[]): { open: string; close: string } | { cause: string } {
  const revised = single(rows, 'Revised/Extended Issue Period');
  const row = 'absent' in revised ? single(rows, 'Issue Period') : revised;
  if ('error' in row) return { cause: row.error };
  if (!('value' in row)) return { cause: 'no issue period printed' };
  const text = row.value.replace(/\s*\(.*\)\s*$/, '');
  const parts = text.split(/\s+to\s+/i);
  const open = parts.length === 2 ? parseNSEDate(parts[0]) : undefined;
  const close = parts.length === 2 ? parseNSEDate(parts[1]) : undefined;
  if (!open || !close) return { cause: `issue period unparseable: "${row.value.slice(0, 120)}"` };
  return { open, close };
}

export function parseNseDetailFields(
  payload: unknown,
  expectedSymbol: string,
  expectedCompanyName: string,
  sme?: NseDetailSmeIdentity
): NseDetailParse {
  const issueInfo = (payload as { issueInfo?: { dataList?: unknown; symbol?: unknown } } | null)?.issueInfo;
  const dataList = issueInfo?.dataList;
  if (!Array.isArray(dataList) || dataList.length === 0) return { kind: 'empty' };
  const rows = dataList.filter((r): r is DataRow => !!r && typeof r === 'object') as DataRow[];

  const want = expectedSymbol.trim().toUpperCase();
  const payloadSymbol = typeof issueInfo?.symbol === 'string' ? issueInfo.symbol.trim().toUpperCase() : '';
  if (payloadSymbol && payloadSymbol !== want) {
    return { kind: 'identity_mismatch', cause: `ipo-detail answered for ${payloadSymbol}, asked for ${want}` };
  }
  const symbolRow = single(rows, 'Symbol');
  if ('error' in symbolRow) return { kind: 'identity_mismatch', cause: `detail identity unproven: ${symbolRow.error}` };
  if ('value' in symbolRow && symbolRow.value.toUpperCase() !== want) {
    return { kind: 'identity_mismatch', cause: `ipo-detail "Symbol" row is ${symbolRow.value}, asked for ${want}` };
  }
  if (!payloadSymbol && !('value' in symbolRow)) {
    return { kind: 'identity_mismatch', cause: `detail identity unproven: the reply for ${want} carries no symbol` };
  }

  // D3 (F-236, supervisor + reviewer decision on the owner's delegation): an SME reply prints no company
  // name -- dataList[0].title is null and companyName is the symbol itself. Identity is then accepted ONLY
  // when (a) the key's series is SME and the reply has exactly that no-name shape (a reply carrying a
  // different name is still refused), (b) the symbol asked is the IPO's ACTIVE NSE_ISSUE key (the caller
  // asks by nothing else), and (c) the stated open AND close dates equal the stored ones, both present.
  // Side effect, fails closed: a relaunched SME issue with new dates (OD-83) reads CHECK_FAILED until the
  // board path updates the stored dates.
  const replyCompany = (payload as { companyName?: unknown } | null)?.companyName;
  if (sme?.series === 'SME' && rows[0]?.title === null && typeof replyCompany === 'string' && replyCompany.trim().toUpperCase() === want) {
    const storedOpen = storedDay(sme.storedOpenDate);
    const storedClose = storedDay(sme.storedCloseDate);
    if (!storedOpen || !storedClose) {
      return { kind: 'identity_mismatch', cause: `detail identity unproven: SME reply without a name and no stored open/close dates to compare` };
    }
    const stated = statedPeriod(rows);
    if ('cause' in stated) return { kind: 'identity_mismatch', cause: `detail identity unproven: SME reply without a name, ${stated.cause}` };
    if (stated.open !== storedOpen || stated.close !== storedClose) {
      return {
        kind: 'identity_mismatch',
        cause: `detail identity unproven: SME reply period ${stated.open}..${stated.close}, stored ${storedOpen}..${storedClose}`,
      };
    }
    return { kind: 'ok', fields: readNseDetailRowFields(rows) };
  }

  const nameTitle = typeof rows[0]?.title === 'string' ? rows[0].title.trim() : '';
  const replyName = nameTitle ? normalizeCompanyNameForMatching(nameTitle) : '';
  const storedName = normalizeCompanyNameForMatching(expectedCompanyName ?? '');
  if (!replyName || !storedName) {
    return { kind: 'identity_mismatch', cause: `detail identity unproven: no company name to compare ("${nameTitle}" vs "${expectedCompanyName ?? ''}")` };
  }
  if (replyName !== storedName) {
    return { kind: 'identity_mismatch', cause: `detail is a different company: "${nameTitle}", stored "${expectedCompanyName}"` };
  }

  return { kind: 'ok', fields: readNseDetailRowFields(rows) };
}

/**
 * Every field read off one identity-proven `dataList`. Exported so the readers can be tested on a
 * real payload whose identity the walk refuses (SME replies carry no company-name row), never so a
 * caller can skip the identity check.
 */
export function readNseDetailRowFields(rows: DataRow[]): Record<NseDetailField, NseDetailFieldAnswer> {
  const symbolRow = single(rows, 'Symbol');
  const b = band(rows);
  const p = period(rows);
  return {
    symbol: 'value' in symbolRow ? { value: symbolRow.value.toUpperCase() } : symbolRow,
    openDate: p.open,
    closeDate: p.close,
    priceRangeMin: b.min,
    priceRangeMax: b.max,
    lotSize: lot(rows),
    registrar: registrar(rows),
    leadManagers: leadManagers(rows),
    faceValue: faceValue(rows),
    issueType: issueType(rows),
    sponsorBanks: nameList(rows, 'Sponsor Bank'),
    tickSize: tickSize(rows),
    ipoMarketTimings: marketTimings(rows),
    upiCutoffTime: upiCutoff(rows),
    employeeDiscount: employeeDiscount(rows),
    maxRetailSubscription: rupees(rows, 'Maximum Subscription Amount for Retail Investor'),
    maxEmployeeSubscription: rupees(rows, 'Maximum Subscription Amount for Employee Investor'),
    categoryDetails: categories(rows),
    subCategoriesUPI: subCategories(rows),
  };
}

// ---- item 43 readers. Each answers value / absent / error, never a guess (B4(c)). ----

/** Printed words that state "no value here": an abstention (OD-60), never a value or a failure. */
const ABSTAIN_TEXT = /^(?:-+|na|n\.a\.?|n\/a|nil|not applicable|to be announced|tba)$/i;

/** `single`, plus the abstention words: the row's printed value, or why there is none. */
function printed(rows: DataRow[], title: string): { value: string } | { absent: true } | { error: string } {
  const row = single(rows, title);
  if ('value' in row && ABSTAIN_TEXT.test(row.value)) return ABSENT as { absent: true };
  return row;
}

/** Ordinary money / count text "2,00,000" -> 200000, parsed once; null when it is not exactly a number. */
function plainNumber(text: string): number | null {
  if (!/^\d{1,3}(?:,\d{2,3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a printed list of names or codes on commas and a standalone "and" / "&", but only OUTSIDE
 * parentheses: "IND (Up to Rs. 5,00,000)" is one item, not three. A leading "and" after a comma
 * ("IND, and NOH") is the list's own conjunction. Items keep their printed text.
 */
function splitPrintedList(text: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let current = '';
  const flush = () => {
    const item = current.replace(/\s+/g, ' ').trim().replace(/^and\s+/i, '');
    if (item) items.push(item);
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0) {
      if (ch === ',') {
        flush();
        continue;
      }
      const conj = /^\s+and\s+/i.exec(text.slice(i));
      if (conj) {
        flush();
        i += conj[0].length - 1;
        continue;
      }
    }
    current += ch;
  }
  flush();
  return items;
}

function registrar(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Name of the Registrar');
  if (!('value' in row)) return row;
  const name = row.value.replace(/\s+/g, ' ').trim();
  // ipos.registrar is varchar(255): a longer value is refused, never cut (a cut name is another name).
  if (name.length > 255) return { error: `ipo-detail "Name of the Registrar" is ${name.length} chars (column holds 255)` };
  return { value: name };
}

/** Lead managers through the project's one NSE parser (`parseNseLeadManagers`), on the single row. */
function leadManagers(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Book Running Lead Managers');
  if (!('value' in row)) return row;
  const names = parseNseLeadManagers({ dataList: [{ title: 'Book Running Lead Managers', value: row.value }] });
  return names.length > 0 ? { value: names } : { error: `ipo-detail "Book Running Lead Managers" unparseable: "${row.value}"` };
}

/** "Re. 2 per Equity Share" / "Rs.10 per Equity Share" -> 2 / 10. ipos.face_value is an integer of {1,2,5,10}. */
function faceValue(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Face Value');
  if (!('value' in row)) return row;
  const m = /^R[se]\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*(?:per\s+equity\s+share)?\.?$/i.exec(row.value);
  const n = m ? plainNumber(m[1]) : null;
  if (n === null) return { error: `ipo-detail "Face Value" unparseable: "${row.value}"` };
  // Same rule as the BSE fetcher (spec row 18): refuse, never round (OD-62).
  if (![1, 2, 5, 10].includes(n)) return { error: `FAILED_VALIDATION: ipo-detail face value ${n} not in {1,2,5,10}` };
  return { value: n };
}

const ISSUE_TYPES: ReadonlyMap<string, string> = new Map([
  ['book building', 'BOOK_BUILDING'],
  ['fixed price', 'FIXED_PRICE'],
]);

/** "Book Building" -> BOOK_BUILDING; any other wording is refused, never mapped by resemblance. */
function issueType(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Issue Type');
  if (!('value' in row)) return row;
  const v = ISSUE_TYPES.get(row.value.replace(/\s+/g, ' ').trim().toLowerCase());
  return v ? { value: v } : { error: `ipo-detail "Issue Type" not a known issue type: "${row.value}"` };
}

/** A printed list of names (sponsor banks), items as printed. */
function nameList(rows: DataRow[], title: string): NseDetailFieldAnswer {
  const row = printed(rows, title);
  if (!('value' in row)) return row;
  const text = row.value.replace(/\s+/g, ' ').trim();
  // Never split on "&": it is part of bank names ("Punjab & Sind Bank", "Jammu & Kashmir Bank").
  const items = text.split(/\s*[,;]\s*(?:and\s+)?|\s+and\s+/i).map((i) => i.trim()).filter(Boolean);
  if (items.length === 0) return { error: `ipo-detail "${title}" unparseable: "${row.value}"` };
  // A split is trusted only when every piece is a whole firm name ending in its suffix; otherwise the
  // "and" may be inside a name ("Bank of Baroda and Punjab & Sind Bank" cannot be cut safely): refuse.
  if (items.length > 1 && items.some((i) => !/(?:^|\s)(?:Bank|Limited|Ltd\.?)$/i.test(i))) {
    return { error: `ipo-detail "${title}" cannot be split into whole names: "${text}"` };
  }
  return { value: items };
}

/** "Re. 1" / "Re.1" -> 1 (rupees). */
function tickSize(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Tick Size');
  if (!('value' in row)) return row;
  const m = /^R[se]\.?\s*(\d+(?:\.\d+)?)$/i.exec(row.value);
  const n = m ? plainNumber(m[1]) : null;
  if (n === null || n <= 0) return { error: `ipo-detail "Tick Size" unparseable: "${row.value}"` };
  return { value: n };
}

/** As printed. ipo_details.ipo_market_timings is varchar(50): longer text is refused, never cut. */
function marketTimings(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'IPO Market Timings');
  if (!('value' in row)) return row;
  const text = row.value.replace(/\s+/g, ' ').trim();
  if (text.length > 50) return { error: `ipo-detail "IPO Market Timings" is ${text.length} chars (column holds 50): "${text}"` };
  return { value: text };
}

/**
 * The mandate cut-off TIME as the column already stores it ("17:00", written by the document
 * extractor): "29-Sep-2026 (upto 5:00 PM) ..." -> "17:00". NSE prints a "Revised ..." row when the
 * issue is extended; it supersedes the original row by its own label, so it is read first.
 */
function upiCutoff(rows: DataRow[]): NseDetailFieldAnswer {
  const revised = printed(rows, 'Revised Cut-off time for UPI Mandate Confirmation');
  const row = 'absent' in revised ? printed(rows, 'Cut-off time for UPI Mandate Confirmation') : revised;
  if (!('value' in row)) return row;
  const times = new Set<string>();
  for (const m of row.value.matchAll(/\bup\s*to\s+(\d{1,2})[:.](\d{2})\s*([ap])\.?\s*m\b\.?/gi)) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 1 || h > 12 || min > 59) continue;
    const h24 = (h % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0);
    times.add(`${String(h24).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  if (times.size !== 1) {
    return { error: `ipo-detail UPI cut-off states ${times.size} times (need exactly one): "${row.value.slice(0, 120)}"` };
  }
  return { value: [...times][0] };
}

/** "Discount of Rs. 14 per equity share ..." -> 14; "NA" -> abstention. */
function employeeDiscount(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Discount');
  if (!('value' in row)) return row;
  const amounts = [...row.value.matchAll(/R[se]\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?\s*per\s+equity\s+share/gi)].map((m) =>
    plainNumber(m[1])
  );
  const distinct = new Set(amounts);
  if (amounts.length === 0 || distinct.size !== 1 || amounts[0] === null || amounts[0] <= 0) {
    return { error: `ipo-detail "Discount" unparseable: "${row.value.slice(0, 120)}"` };
  }
  return { value: amounts[0] };
}

/** '"Rs. 2,00,000"' -> 200000 (rupees, the manifest's unit for these columns). */
function rupees(rows: DataRow[], title: string): NseDetailFieldAnswer {
  const row = printed(rows, title);
  if (!('value' in row)) return row;
  const m = /^R[se]\.?\s*([\d,]+(?:\.\d+)?)\s*(?:\/-)?$/i.exec(row.value);
  const n = m ? plainNumber(m[1]) : null;
  if (n === null || n <= 0) return { error: `ipo-detail "${title}" unparseable: "${row.value}"` };
  return { value: n };
}

/** "FI, IC, MF, ... IND, and NOH" -> { codes, original }, the shape the NSE orchestrator stores. */
function categories(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Categories');
  if (!('value' in row)) return row;
  const codes = splitPrintedList(row.value);
  if (codes.length === 0 || codes.some((c) => !/^[A-Z]{2,5}$/.test(c))) {
    return { error: `ipo-detail "Categories" is not a list of category codes: "${row.value}"` };
  }
  return { value: { codes, original: row.value } };
}

/** "IND and EMP (upto 5 Lakhs)" -> ["IND", "EMP (upto 5 Lakhs)"]: codes with their printed limits kept. */
function subCategories(rows: DataRow[]): NseDetailFieldAnswer {
  const row = printed(rows, 'Sub-Categories applicable for UPI');
  if (!('value' in row)) return row;
  const items = splitPrintedList(row.value);
  if (items.length === 0 || items.some((c) => !/^[A-Z]{2,5}(?:\s*\(.*\))?$/.test(c))) {
    return { error: `ipo-detail "Sub-Categories applicable for UPI" unparseable: "${row.value}"` };
  }
  return { value: items };
}
