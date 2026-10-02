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

export type NseDetailField = 'symbol' | 'openDate' | 'closeDate' | 'priceRangeMin' | 'priceRangeMax' | 'lotSize';

export type NseDetailFieldAnswer = { value: string | number } | { absent: true } | { error: string };

export type NseDetailParse =
  | { kind: 'empty' }
  | { kind: 'identity_mismatch'; cause: string }
  | { kind: 'ok'; fields: Record<NseDetailField, NseDetailFieldAnswer> };

interface DataRow {
  title: string | null;
  value: string;
}

const ABSENT: NseDetailFieldAnswer = { absent: true };

/** The rows with exactly this title (trimmed, case-insensitive). */
function rowsTitled(rows: DataRow[], title: string): string[] {
  const want = title.toLowerCase();
  return rows
    .filter((r) => typeof r.title === 'string' && r.title.trim().toLowerCase() === want)
    .map((r) => (typeof r.value === 'string' ? r.value.trim() : ''));
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
export function parseNseDetailFields(payload: unknown, expectedSymbol: string, expectedCompanyName: string): NseDetailParse {
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

  const nameTitle = typeof rows[0]?.title === 'string' ? rows[0].title.trim() : '';
  const replyName = nameTitle ? normalizeCompanyNameForMatching(nameTitle) : '';
  const storedName = normalizeCompanyNameForMatching(expectedCompanyName ?? '');
  if (!replyName || !storedName) {
    return { kind: 'identity_mismatch', cause: `detail identity unproven: no company name to compare ("${nameTitle}" vs "${expectedCompanyName ?? ''}")` };
  }
  if (replyName !== storedName) {
    return { kind: 'identity_mismatch', cause: `detail is a different company: "${nameTitle}", stored "${expectedCompanyName}"` };
  }

  const b = band(rows);
  const p = period(rows);
  return {
    kind: 'ok',
    fields: {
      symbol: 'value' in symbolRow ? { value: symbolRow.value.toUpperCase() } : symbolRow,
      openDate: p.open,
      closeDate: p.close,
      priceRangeMin: b.min,
      priceRangeMax: b.max,
      lotSize: lot(rows),
    },
  };
}
