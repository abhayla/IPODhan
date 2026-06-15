/**
 * Investorgain GMP Scraper - API-based GMP data fetching
 *
 * Data Source: https://webnodejs.investorgain.com/cloud/report/data-read/331/...
 * Purpose: Fetch Grey Market Premium (GMP) data for IPOs
 * Alternative to: Chittorgarh detail page scraping (client-side rendered)
 *
 * Created: 2025-10-18
 */

import logger from '../utils/logger.js';
import { sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';

const INVESTORGAIN_API_BASE = 'https://webnodejs.investorgain.com/cloud/report/data-read';
const REPORT_ID = '331'; // Live IPO GMP report ID
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_RANGE = `${CURRENT_YEAR}-${(CURRENT_YEAR + 1) % 100}`; // e.g., "2025-26"

export interface InvestorgainGMP {
  companyName: string;
  gmp: number; // GMP value in rupees
  gmpPercentage: number; // GMP as percentage of price
  gmpUpdatedAt: Date; // Last update timestamp
  openDate: string; // ISO format YYYY-MM-DD
  closeDate: string; // ISO format YYYY-MM-DD
  listingDate?: string; // ISO format YYYY-MM-DD (optional)
  price: number; // IPO price
  investorgainId: number; // Internal ID for reference
  investorgainSlug: string; // URL slug for reference
}

export interface InvestorgainGMPScraperResult {
  gmps: InvestorgainGMP[];
  errors: string[];
}

interface InvestorgainAPIResponse {
  msg: number;
  sSearchWhere: string;
  reportTableData: InvestorgainAPIRecord[];
}

interface InvestorgainAPIRecord {
  '~id': number; // Internal investorgain ID
  '~ipo_name': string; // Clean company name
  'Name': string; // HTML with company link
  'GMP': string; // HTML-encoded: "&#8377;<b>110</b> (10.33%)"
  '~gmp_percent_calc': string; // Numeric: "10.33"
  'Price': string; // "1065"
  'Updated-On': string; // HTML: "<small><b>18-Oct 7:33</b></small>"
  'Open': string; // Display: "15-Oct"
  'Close': string; // Display: "17-Oct"
  'Listing': string; // Display: "24-Oct"
  '~Srt_Open': string; // ISO: "2025-10-15"
  '~Srt_Close': string; // ISO: "2025-10-17"
  '~Str_Listing': string; // ISO: "2025-10-24"
  '~urlrewrite_folder_name': string; // "/gmp/midwest-ipo/1501/"
  '~IPO_Category': string; // "IPO" or "SME"
  'IPO Size': string; // "451.00 " (in crores)
  'Sub': string; // "92.36x"
}

/**
 * Parse HTML-encoded GMP value, resilient to markup drift (G4).
 * Examples:
 *   "&#8377;<b>110</b> (10.33%)" → 110
 *   "&#8377;<b>-3</b> (-2.22%)" → -3
 *   "&#8377;<b>--</b> (0.00%)" → null  (no active GMP)
 *   "₹110 (10.33%)" → 110  (fallback when the <b> wrapper is gone — never the %)
 */
export function parseGMP(gmpHTML: string): number | null {
  if (!gmpHTML) return null;

  // Primary: the value lives inside the <b> tag.
  const inBold = gmpHTML.match(/<b>\s*(-?\d+(?:\.\d+)?)\s*<\/b>/);
  if (inBold) {
    const value = parseFloat(inBold[1]);
    return isNaN(value) ? null : value;
  }

  // Explicit "--" placeholder = no active GMP (whether or not it is bolded).
  if (/(^|>)\s*--\s*(<|$)/.test(gmpHTML)) return null;

  // Fallback (markup drift): drop the trailing "(xx%)" so the percentage can
  // never be mistaken for the GMP, strip tags + HTML entities, take the first
  // signed number that remains.
  const withoutPercent = gmpHTML.replace(/\([^)]*%\)/g, ' ');
  const text = withoutPercent.replace(/<\/?[^>]+(>|$)/g, ' ').replace(/&#?\w+;/g, ' ');
  const num = text.match(/-?\d+(?:\.\d+)?/);
  if (!num) return null;
  const value = parseFloat(num[0]);
  return isNaN(value) ? null : value;
}

/**
 * Fraction of fetched rows that yielded a GMP value MUST stay above this floor;
 * below it the markup likely changed and the run reports failure (G4). An empty
 * fetch is a different concern (no data ≠ broken parser) and is treated healthy.
 */
const PARSE_RATE_FLOOR = 0.5;

/**
 * Parse-rate guard (G4). The InvestorGain "live GMP" report lists IPOs that
 * carry a GMP, so a healthy run parses the large majority of fetched rows; a
 * sudden collapse means the markup drifted and we must fail loudly, not silently
 * skip every row.
 */
export function isParseRateHealthy(fetched: number, parsed: number, floor: number = PARSE_RATE_FLOOR): boolean {
  if (fetched <= 0) return true;
  return parsed / fetched >= floor;
}

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// A source timestamp landing more than this far in the future means we guessed
// the wrong (current) year across the Dec→Jan rollover; subtract a year.
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Parse GMP percentage (already numeric in API)
 */
function parseGMPPercentage(percentStr: string): number {
  if (!percentStr) return 0;

  const value = parseFloat(percentStr);
  return isNaN(value) ? 0 : value;
}

/**
 * Parse a GMP update timestamp from HTML (G6).
 * Example: "<small style='...'><b>18-Oct 7:33</b></small>" → Date
 *
 * The source omits the year. We infer it deterministically instead of assuming
 * the current year: a date that would land in the future (e.g. "31-Dec" parsed
 * on "1-Jan") is rolled back to the previous year, fixing the Dec→Jan boundary.
 * `now` is injectable for testing.
 */
export function parseGMPTimestamp(timestampHTML: string, now: Date = new Date()): Date {
  if (!timestampHTML) return now;

  const text = timestampHTML.replace(/<\/?[^>]+(>|$)/g, '').trim();
  if (!text) return now;

  // e.g. "18-Oct 7:33" / "31-Dec 23:30"
  const m = text.match(/^(\d{1,2})-([A-Za-z]{3,})\s+(\d{1,2}):(\d{2})/);
  if (!m) return now;

  const day = parseInt(m[1], 10);
  const month = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()];
  if (month === undefined) return now;
  const hour = parseInt(m[3], 10);
  const minute = parseInt(m[4], 10);

  let candidate = new Date(now.getFullYear(), month, day, hour, minute, 0, 0);
  if (candidate.getTime() - now.getTime() > FUTURE_SKEW_MS) {
    candidate = new Date(now.getFullYear() - 1, month, day, hour, minute, 0, 0);
  }
  return candidate;
}

/**
 * Parse price (simple numeric string)
 */
function parsePrice(priceStr: string): number {
  if (!priceStr) return 0;

  const cleaned = priceStr.replace(/[,\s]/g, '');
  const price = parseFloat(cleaned);

  return isNaN(price) ? 0 : price;
}

/**
 * Extract slug from URL folder name
 * Example: "/gmp/midwest-ipo/1501/" → "midwest-ipo"
 */
function extractSlug(urlFolder: string): string {
  if (!urlFolder) return '';

  // Remove leading/trailing slashes and extract middle part
  const parts = urlFolder.split('/').filter(p => p.length > 0);

  // Expected format: ["gmp", "company-slug", "id"]
  if (parts.length >= 2) {
    return parts[1]; // Return "company-slug"
  }

  return '';
}

/**
 * Fetch GMP data from Investorgain API
 * @param page - Page number (1-indexed)
 * @param perPage - Records per page (10, 50, 100)
 * @param category - Filter: "ipo" (mainboard), "sme", or "all"
 * @returns API response data
 */
async function fetchInvestorgainAPI(
  page: number = 1,
  perPage: number = 10,
  category: string = 'ipo'
): Promise<InvestorgainAPIResponse> {
  // Generate cache-busting version (format: "DD-HH")
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const version = `${day}-${hour}`;

  const url = `${INVESTORGAIN_API_BASE}/${REPORT_ID}/${page}/${perPage}/${CURRENT_YEAR}/${YEAR_RANGE}/0/${category}`;

  logger.info({
    url,
    page,
    perPage,
    category,
    currentYear: CURRENT_YEAR,
    yearRange: YEAR_RANGE,
    reportId: REPORT_ID,
    version
  }, 'Fetching Investorgain API with parameters');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'Referer': 'https://www.investorgain.com/report/live-ipo-gmp/331/ipo/'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as InvestorgainAPIResponse;

  logger.debug(
    {
      url,
      msg: data.msg,
      recordCount: data.reportTableData?.length || 0,
      sampleRecord: data.reportTableData?.[0]
    },
    'Investorgain API response received'
  );

  return data;
}

/**
 * Scrape GMP data from Investorgain API
 * Fetches all pages until no more records are returned
 */
export async function scrapeInvestorgainGMPs(): Promise<InvestorgainGMPScraperResult> {
  const result: InvestorgainGMPScraperResult = {
    gmps: [],
    errors: []
  };

  try {
    logger.info({ url: INVESTORGAIN_API_BASE }, 'Starting Investorgain GMP scraper (API version)');

    const perPage = 10; // API ignores pagination and returns all rows for the category.

    // G3: fetch BOTH mainboard ('ipo') AND SME so symbol-less SME IPOs are covered.
    // The API does not support pagination, so one call per category suffices.
    const categories = ['ipo', 'sme'] as const;
    const allRecords: InvestorgainAPIRecord[] = [];

    for (const category of categories) {
      const apiData = await retryWithExponentialBackoff(
        () => fetchInvestorgainAPI(1, perPage, category),
        3,
        1000
      );

      if ((apiData as any).error) {
        const errorMsg = `Investorgain API error (${category}): ${(apiData as any).error}`;
        logger.error({ category, error: (apiData as any).error }, errorMsg);
        result.errors.push(errorMsg);
        continue;
      }
      if (!apiData.reportTableData || apiData.reportTableData.length === 0) {
        logger.info({ category }, 'No GMP data returned from API for category');
        continue;
      }
      logger.info(
        { category, recordCount: apiData.reportTableData.length },
        'Received GMP data from Investorgain API'
      );
      allRecords.push(...apiData.reportTableData);
    }

    // Dedupe across categories by InvestorGain id (mainboard/SME shouldn't overlap,
    // but guard against it so a row is never counted/parsed twice).
    const seenIds = new Set<number>();
    const fetchedRecords = allRecords.filter((r) => {
      const id = r['~id'];
      if (seenIds.has(id)) return false;
      seenIds.add(id);
      return true;
    });

    let parsedWithGMP = 0; // rows that yielded a usable GMP value (for the parse-rate guard)

    for (const record of fetchedRecords) {
      try {
        const gmp = parseGMP(record['GMP']);
        if (gmp === null) {
          logger.debug(
            { companyName: record['~ipo_name'], gmpHTML: record['GMP'] },
            'No active GMP for this row'
          );
          continue;
        }
        parsedWithGMP++;

        const gmpPercentage = parseGMPPercentage(record['~gmp_percent_calc']);
        const gmpUpdatedAt = parseGMPTimestamp(record['Updated-On']);
        const price = parsePrice(record['Price']);

        const openDate = record['~Srt_Open'];
        const closeDate = record['~Srt_Close'];
        const listingDate = record['~Str_Listing'];

        if (!openDate || !closeDate) {
          logger.debug(
            { companyName: record['~ipo_name'], openDate, closeDate },
            'Skipping GMP with missing dates'
          );
          continue;
        }

        const investorgainSlug = extractSlug(record['~urlrewrite_folder_name']);

        result.gmps.push({
          companyName: sanitizeText(record['~ipo_name']),
          gmp,
          gmpPercentage,
          gmpUpdatedAt,
          openDate,
          closeDate,
          listingDate: listingDate || undefined,
          price,
          investorgainId: record['~id'],
          investorgainSlug,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMsg }, 'Failed to parse Investorgain API record');
        result.errors.push(`Record parsing error: ${errorMsg}`);
      }
    }

    // G4: parse-rate guard — a collapse means the markup drifted. Fail loudly so
    // the run reports failure instead of silently skipping every row.
    if (!isParseRateHealthy(fetchedRecords.length, parsedWithGMP)) {
      const parseRateMsg =
        `Investorgain GMP parse rate too low: ${parsedWithGMP}/${fetchedRecords.length} rows ` +
        `yielded a GMP (< ${Math.round(PARSE_RATE_FLOOR * 100)}%) — markup likely changed`;
      logger.error(
        { fetched: fetchedRecords.length, parsedWithGMP, floor: PARSE_RATE_FLOOR },
        parseRateMsg
      );
      result.errors.push(parseRateMsg);
    }

    logger.info(
      { gmpsScraped: result.gmps.length, fetched: fetchedRecords.length, parsedWithGMP, errors: result.errors.length },
      'Investorgain GMP scraper completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Investorgain GMP scraper failed');
    result.errors.push(`Scraper error: ${errorMsg}`);
    return result;
  }
}
