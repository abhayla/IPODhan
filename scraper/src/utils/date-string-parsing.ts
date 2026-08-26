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
