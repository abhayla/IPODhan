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
 * Parse HTML-encoded GMP value
 * Examples:
 *   "&#8377;<b>110</b> (10.33%)" → 110
 *   "&#8377;<b>-3</b> (-2.22%)" → -3
 *   "&#8377;<b>--</b> (0.00%)" → null
 */
function parseGMP(gmpHTML: string): number | null {
  if (!gmpHTML) return null;

  // Extract number from <b> tag
  const match = gmpHTML.match(/<b>(-?\d+(?:\.\d+)?)<\/b>/);

  if (!match || match[1] === '--') {
    return null; // No active GMP
  }

  const value = parseFloat(match[1]);
  return isNaN(value) ? null : value;
}

/**
 * Parse GMP percentage (already numeric in API)
 */
function parseGMPPercentage(percentStr: string): number {
  if (!percentStr) return 0;

  const value = parseFloat(percentStr);
  return isNaN(value) ? 0 : value;
}

/**
 * Parse GMP update timestamp from HTML
 * Example: "<small style='...'><b>18-Oct 7:33</b></small>" → Date
 */
function parseGMPTimestamp(timestampHTML: string): Date {
  if (!timestampHTML) return new Date();

  // Extract text from HTML tags
  const text = timestampHTML.replace(/<\/?[^>]+(>|$)/g, '').trim();

  if (!text) return new Date();

  try {
    // Parse "18-Oct 7:33" format
    // Assume current year if not specified
    const dateStr = `${text} ${CURRENT_YEAR}`;
    const date = new Date(dateStr);

    if (isNaN(date.getTime())) {
      return new Date(); // Fallback to current time
    }

    return date;
  } catch {
    return new Date();
  }
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
  perPage: number = 100,
  category: string = 'ipo'
): Promise<InvestorgainAPIResponse> {
  // Generate cache-busting version (format: "DD-HH")
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const version = `${day}-${hour}`;

  const url = `${INVESTORGAIN_API_BASE}/${REPORT_ID}/${page}/${perPage}/${CURRENT_YEAR}/${YEAR_RANGE}/0/${category}?search=&v=${version}`;

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

    let page = 1;
    const perPage = 100;
    let hasMorePages = true;

    // Fetch all pages
    while (hasMorePages) {
      // Fetch data with retry logic
      const apiData = await retryWithExponentialBackoff(
        () => fetchInvestorgainAPI(page, perPage, 'ipo'),
        3,
        1000
      );

      logger.info(
        {
          page,
          hasData: !!apiData,
          hasReportTableData: !!apiData.reportTableData,
          isArray: Array.isArray(apiData.reportTableData),
          length: apiData.reportTableData?.length,
          msg: apiData.msg,
          error: (apiData as any).error,
        },
        'API response structure'
      );

      // Check for API error
      if ((apiData as any).error) {
        const errorMsg = `Investorgain API error: ${(apiData as any).error}`;
        logger.error({ error: (apiData as any).error }, errorMsg);
        result.errors.push(errorMsg);
        break;
      }

      if (!apiData.reportTableData || apiData.reportTableData.length === 0) {
        logger.info({ page }, 'No more IPO data - stopping pagination');
        hasMorePages = false;
        break;
      }

      logger.info(
        { page, recordCount: apiData.reportTableData.length },
        'Received GMP data from Investorgain API'
      );

      // Parse each GMP record
      for (const record of apiData.reportTableData) {
        try {
          // Parse GMP value
          const gmp = parseGMP(record['GMP']);

          // Skip if no active GMP
          if (gmp === null) {
            logger.debug(
              { companyName: record['~ipo_name'], gmpHTML: record['GMP'] },
              'Skipping IPO with no active GMP'
            );
            continue;
          }

          // Parse other fields
          const gmpPercentage = parseGMPPercentage(record['~gmp_percent_calc']);
          const gmpUpdatedAt = parseGMPTimestamp(record['Updated-On']);
          const price = parsePrice(record['Price']);

          // Parse dates (prefer sortable ISO format)
          const openDate = record['~Srt_Open'];
          const closeDate = record['~Srt_Close'];
          const listingDate = record['~Str_Listing'];

          // Skip if missing essential dates
          if (!openDate || !closeDate) {
            logger.debug(
              { companyName: record['~ipo_name'], openDate, closeDate },
              'Skipping GMP with missing dates'
            );
            continue;
          }

          // Extract slug
          const investorgainSlug = extractSlug(record['~urlrewrite_folder_name']);

          const gmpData: InvestorgainGMP = {
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
          };

          result.gmps.push(gmpData);

          logger.debug(
            {
              companyName: gmpData.companyName,
              gmp: gmpData.gmp,
              gmpPercentage: gmpData.gmpPercentage,
              openDate: gmpData.openDate,
              investorgainId: gmpData.investorgainId
            },
            'Successfully parsed Investorgain GMP'
          );

        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.warn({ error: errorMsg }, 'Failed to parse Investorgain API record');
          result.errors.push(`Record parsing error: ${errorMsg}`);
        }
      }

      // Check if there are more pages (if we got full page, likely more exist)
      if (apiData.reportTableData.length < perPage) {
        hasMorePages = false;
      } else {
        page++;
      }
    }

    logger.info(
      { gmpsScraped: result.gmps.length, errors: result.errors.length, pagesFetched: page },
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
