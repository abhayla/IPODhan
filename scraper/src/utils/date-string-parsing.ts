/**
 * TZ-invariant parsing for date-only source strings scraped from external
 * sites (NSE, BSE, Moneycontrol, etc.).
 *
 * T-327 (round-7 P1-1): `new Date(dateOnlyString)` on a non-ISO string
 * (e.g. "27-Aug-2026", "17 Oct 25", "15 Oct 2025 to 17 Oct 2025") is parsed
 * at LOCAL midnight by the JS engine, then `.toISOString()` converts it back
 * to UTC — silently shifting the calendar date by a day on any host whose
 * process TZ is not UTC (the prod box is Asia/Kolkata; PM2 does not
 * propagate TZ to the process — see
 * .claude/rules/utc-naive-timestamp-normalization.md).
 *
 * These helpers do pure string/lookup arithmetic instead — TZ-invariant by
 * construction. NEVER `new Date(dateOnlyString)` for a date-only source
 * string anywhere in scraper/src; use these helpers (or, inside a Puppeteer
 * `page.evaluate()` browser-context closure, an inline copy of the same
 * month-map — see nse-scraper.ts, which cannot import this module across
 * the browser serialization boundary).
 */

export const MONTH_ABBR_TO_NUM: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parse "DD-MMM-YYYY" / "DD/MMM/YYYY" / "DD MMM YYYY" (3-letter month
 * abbreviation, case-insensitive) to "YYYY-MM-DD". Returns null if the
 * string doesn't match or the month abbreviation is unrecognized.
 */
export function parseDdMmmYyyy(dateStr: string): string | null {
  const match = dateStr.trim().match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{4})$/);
  if (!match) return null;

  const [, dayRaw, mon, year] = match;
  const month = MONTH_ABBR_TO_NUM[mon.toLowerCase()];
  return month ? `${year}-${month}-${dayRaw.padStart(2, '0')}` : null;
}

/**
 * Parse a 2-digit year "DD MMM YY" (e.g. "17 Oct 25") to "YYYY-MM-DD".
 * Assumes 2000s (correct for the IPO-listing domain through 2099).
 */
export function parseDdMmmYy(dateStr: string): string | null {
  const match = dateStr.trim().match(/^(\d{1,2})[-/\s]([A-Za-z]{3})[-/\s](\d{2})$/);
  if (!match) return null;

  const [, dayRaw, mon, yearRaw] = match;
  const month = MONTH_ABBR_TO_NUM[mon.toLowerCase()];
  if (!month) return null;

  const day = dayRaw.padStart(2, '0');
  const year = `20${yearRaw}`;
  return `${year}-${month}-${day}`;
}

/**
 * W-160b (T-327 ratchet closure): TZ-safe conversion of a Date instance or a
 * raw date/timestamp VALUE to epoch milliseconds, without ever re-parsing a
 * raw string through `new Date(identifier)` (the exact shape this module
 * exists to avoid — see file header). Handles every shape actually seen by
 * `data-consolidation-service.ts`'s date-triple/consensus comparisons:
 *   - a `Date` instance (already parsed elsewhere, e.g. Drizzle's
 *     `timestamp()` column reader under `configureUtcTimestampParsing()`) —
 *     read directly via `.getTime()`, no re-parse.
 *   - an ISO date-only string "YYYY-MM-DD" (a `date` column value) —
 *     constructed explicitly via `Date.UTC(...)`, never `new Date(str)`.
 *   - a full ISO datetime string with an explicit UTC offset ("...Z" or
 *     "+HH:MM"/"-HH:MM") — unambiguous regardless of host TZ, computed via
 *     `Date.UTC(...)` plus the parsed offset rather than trusting the
 *     engine's (implementation-defined for non-Z forms) string parser.
 *   - a known non-ISO scraped format (DD-MMM-YYYY / DD MMM YY) — normalized
 *     to YYYY-MM-DD via the existing string-arithmetic parsers above, then
 *     recursed into the date-only branch.
 * Returns null for anything else (unparseable / unexpected shape) so
 * callers can treat it as "can't judge" the same way they already do for a
 * missing date — never falls back to `new Date(value)`.
 */
export function toUtcEpochMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();

  const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
  }

  const isoWithOffset = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:?\d{2})$/
  );
  if (isoWithOffset) {
    const [, y, mo, d, h, mi, s, msRaw, offsetRaw] = isoWithOffset;
    const ms = Number((msRaw ?? '0').padEnd(3, '0'));
    let offsetMinutes = 0;
    if (offsetRaw !== 'Z') {
      const offsetMatch = offsetRaw.match(/^([+-])(\d{2}):?(\d{2})$/);
      if (offsetMatch) {
        const [, sign, oh, om] = offsetMatch;
        offsetMinutes = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
      }
    }
    const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
    return utcMs - offsetMinutes * 60000;
  }

  const normalized = parseDdMmmYyyy(trimmed) ?? parseDdMmmYy(trimmed);
  if (normalized) return toUtcEpochMs(normalized);

  return null;
}

/**
 * Same as `toUtcEpochMs` but truncated to a whole UTC calendar-day index —
 * the date-triple invariant (open < close < listing) and exchange-consensus
 * comparisons in `data-consolidation-service.ts` compare CALENDAR DAYS, not
 * instants, so this is the primary entry point for those call sites.
 */
export function toUtcEpochDay(value: unknown): number | null {
  const ms = toUtcEpochMs(value);
  return ms === null ? null : Math.floor(ms / 86400000);
}
