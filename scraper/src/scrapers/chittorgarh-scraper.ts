/**
 * Chittorgarh IPO Scraper - Rewritten for API-based data fetching (2025-10-17)
 *
 * Page Structure Changes:
 * - Old: Static HTML tables with Cheerio parsing
 * - New: React/Next.js app with API-based data loading
 * - API Endpoint: https://webnodejs.chittorgarh.com/cloud/report/data-read/82/...
 * - GMP Data: NOT available on list page (would require detail page scraping)
 */

import logger from '../utils/logger.js';
import { isVerifierUrl } from '../services/company-host-source.js';
import { sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import type { ChittorgarhIPO } from '../utils/validators.js';
import { offeringTypeFromBusinessTrustName } from '../utils/data-validation.js';

const CHITTORGARH_API_BASE = 'https://webnodejs.chittorgarh.com/cloud/report/data-read';
const REPORT_ID = '82'; // IPO list report ID
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_RANGE = `${CURRENT_YEAR}-${(CURRENT_YEAR + 1) % 100}`; // e.g., "2025-26"

export interface ChittorgarhScraperResult {
  ipos: ChittorgarhIPO[];
  errors: string[];
}

interface ChittorgarhAPIResponse {
  msg: number;
  sSearchWhere: string;
  reportTableData: ChittorgarhAPIRecord[];
}

interface ChittorgarhAPIRecord {
  'Company': string; // HTML: <a href="/ipo/slug/id/">Company Name</a>
  'Opening Date': string; // "Tue, Oct 07, 2025"
  'Closing Date': string; // "Thu, Oct 09, 2025"
  'Listing Date': string; // "Fri, Oct 10, 2025" or empty
  'Issue Price (Rs.)': string; // "1140.00" or "120.00 to 125.00"
  'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': string; // "11607.01"
  'Listing at': string; // "BSE, NSE" or "NSE SME" or "BSE SME"
  'Lead Manager': string; // HTML: <a href="/lead-manager/slug/">Manager Name</a>
  '~Issue_Open_Date'?: string; // ISO: "2025-10-07T00:00:00.000Z"
  '~IssueCloseDate'?: string; // ISO: "2025-10-09T00:00:00.000Z"
  '~ListingDate'?: string; // ISO: "2025-10-10T00:00:00.000Z"
  '~URLRewrite_Folder_Name'?: string; // "company-slug"
}

/**
 * Extract plain text from HTML anchor tag
 * @param html - HTML string like "<a href='/ipo/slug/id/'>Company Name</a>"
 * @returns Plain text "Company Name"
 */
/**
 * Extract the href from an anchor ("<a href='/ipo/slug/id/'>X</a>") as an
 * absolute Chittorgarh URL. Used ONLY to record a link-VERIFIER page for
 * document discovery (T-403 M-6); a document is never stored from this host.
 */
/**
 * The verifier-page URL from a row's company anchor.
 *
 * M-b: an ABSOLUTE href used to be returned verbatim on the strength of
 * `startsWith('http')` alone. This value is persisted and later FETCHED by the
 * discovery runner, so an off-host absolute link on a scraped page was a
 * server-side request we would make on its behalf. Both branches now end at the
 * same host check, and a link that is not a Chittorgarh page is simply dropped —
 * the verifier rung then records `no_verifier_url`, which is the truth.
 */
function extractHrefFromAnchor(html: string): string | undefined {
  if (!html) return undefined;
  const m = html.match(/href\s*=\s*['"]([^'"]+)['"]/i);
  if (!m) return undefined;
  const href = m[1].trim();
  if (href === '') return undefined;
  const absolute = /^https?:\/\//i.test(href)
    ? href
    : `https://www.chittorgarh.com${href.startsWith('/') ? '' : '/'}${href}`;
  return isVerifierUrl(absolute) ? absolute : undefined;
}

export function extractTextFromAnchor(html: string): string {
  if (!html) return '';

  // W-36: the report-table cell can carry a status badge/span alongside the
  // anchor (e.g. Chittorgarh's "Open" pill: `<span class="badge ...">O</span>`,
  // sibling to or nested inside the <a>). Blindly stripping all tags and
  // concatenating the leftover text turned "Deepa Jewellers Ltd." into
  // "Deepa Jewellers Ltd. O". Strip badge/status elements FIRST, then keep
  // only the anchor's own text (falling back to the remaining cell text when
  // there is no anchor at all).
  const withoutBadges = html.replace(/<(span|sup|sub)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const anchorMatch = withoutBadges.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i);
  const text = anchorMatch ? anchorMatch[1] : withoutBadges;
  return sanitizeText(text);
}

/**
 * Parse Chittorgarh API date format to ISO 8601
 * Prefers metadata ISO date, falls back to display date parsing
 * Returns undefined for missing/invalid dates to ensure proper database handling
 */
export function parseChittorgarhDate(displayDate: string, isoDate?: string): string | undefined {
  // Prefer ISO date from metadata (already in correct format)
  if (isoDate) {
    return isoDate.split('T')[0]; // "2025-10-07T00:00:00.000Z" → "2025-10-07"
  }

  // Fallback: parse display date "Tue, Oct 07, 2025" / "04-Dec-2025".
  if (!displayDate || displayDate.trim() === '') return undefined;

  try {
    const date = new Date(displayDate);
    if (isNaN(date.getTime())) {
      return undefined;
    }
    // Use LOCAL date components, NOT toISOString(). `new Date("04-Dec-2025")` builds a
    // LOCAL-midnight Date; toISOString() converts it to UTC, and on any server east of
    // UTC (the IST prod VPS, UTC+5:30) that shifts the calendar date back one day
    // ("04-Dec" → "2025-12-03"). This silently stored ~55 SME IPO open/close dates one
    // day early — caught by the chittorgarh oracle cross-check, invisible to UTC-CI unit
    // tests. Local components preserve the parsed calendar date TZ-independently.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  } catch {
    return undefined;
  }
}

/**
 * Parse price string (fixed or range)
 * @param priceStr - "1140.00" or "120.00 to 125.00"
 * @returns {min, max}
 */
function parseChittorgarhPrice(priceStr: string): { min: number; max: number } {
  if (!priceStr) return { min: 0, max: 0 };

  const cleaned = priceStr.trim();

  // Handle range: "120.00 to 125.00"
  if (cleaned.includes(' to ')) {
    const parts = cleaned.split(' to ').map(p => parseFloat(p.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return { min: parts[0], max: parts[1] };
    }
  }

  // T-308 (round-6 P1, 3rd occurrence of this class): a lone price string
  // (no "to" range) is NOT a real book-built band -- writing it into both
  // min and max silently collapses a previously-published band once
  // Chittorgarh's report stops showing the range at close/listing. Return
  // {0,0} (the existing "no band" sentinel this function already used for
  // unparseable input) so the caller's `price.min > 0 ? ... : undefined`
  // guard leaves the band fields unset instead of overwriting.
  return { min: 0, max: 0 };
}

/**
 * Parse issue amount in crores
 * @param amountStr - "11607.01" (in crores)
 * @returns Number in basic units
 */
function parseChittorgarhAmount(amountStr: string): number {
  if (!amountStr) return 0;

  const cleaned = amountStr.replace(/[,\s]/g, '');
  const amount = parseFloat(cleaned);

  if (isNaN(amount)) return 0;

  // Amount is already in crores, convert to basic units (multiply by 10^7)
  return amount * 10000000;
}

/**
 * Determine listing exchange and segment from "Listing at" field
 * Story 11.8: Returns segment instead of category
 * @param listingAt - "BSE, NSE" or "NSE SME" or "BSE SME"
 * @returns {exchange, segment}
 */
function parseListingInfo(listingAt: string): {
  exchange: 'NSE' | 'BSE' | 'BOTH';
  segment: 'MAINBOARD' | 'SME';
} {
  const normalized = listingAt.toUpperCase().trim();

  let segment: 'MAINBOARD' | 'SME' = 'MAINBOARD';
  let exchange: 'NSE' | 'BSE' | 'BOTH' = 'BOTH';

  // Determine segment
  if (normalized.includes('SME')) {
    segment = 'SME';
  }

  // Determine exchange
  const hasBSE = normalized.includes('BSE');
  const hasNSE = normalized.includes('NSE');

  if (hasBSE && hasNSE) {
    exchange = 'BOTH';
  } else if (hasNSE) {
    exchange = 'NSE';
  } else if (hasBSE) {
    exchange = 'BSE';
  }

  return { exchange, segment };
}

/**
 * Determine IPO status based on dates
 */
function determineStatus(
  openDate: string,
  closeDate: string,
  listingDate: string
): 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' {
  if (!openDate || !closeDate) return 'UPCOMING';

  const now = new Date();
  const open = new Date(openDate);
  const close = new Date(closeDate);
  const listing = listingDate ? new Date(listingDate) : null;

  // If listed date is in the past, status is LISTED
  if (listing && now > listing) {
    return 'LISTED';
  }

  // If current date is within open-close range, status is OPEN
  if (now >= open && now <= close) {
    return 'OPEN';
  }

  // If close date has passed, status is CLOSED
  if (now > close) {
    return 'CLOSED';
  }

  // Otherwise, status is UPCOMING
  return 'UPCOMING';
}

/**
 * Fetch IPO data from Chittorgarh API
 * @param page - Page number (1-indexed)
 * @param perPage - Records per page
 * @param category - Filter: "all" | "mainboard" | "sme" | "reit" | "invit" | "mainboard-fpo" | "sme-fpo"
 * @returns API response data
 */
async function fetchChittorgarhAPI(
  page: number = 1,
  perPage: number = 100,
  category: string = 'all'
): Promise<ChittorgarhAPIResponse> {
  const url = `${CHITTORGARH_API_BASE}/${REPORT_ID}/${page}/${perPage}/${CURRENT_YEAR}/${YEAR_RANGE}/0/${category}/0?search=&v=15-11`;

  logger.info({
    url,
    page,
    perPage,
    category,
    currentYear: CURRENT_YEAR,
    yearRange: YEAR_RANGE,
    reportId: REPORT_ID
  }, 'Fetching Chittorgarh API with parameters');

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json() as ChittorgarhAPIResponse;

  logger.debug(
    {
      url,
      msg: data.msg,
      recordCount: data.reportTableData?.length || 0,
      sampleRecord: data.reportTableData?.[0]
    },
    'Chittorgarh API response received'
  );

  return data;
}

/**
 * Scrape IPO data from Chittorgarh API
 * Note: GMP data is NOT available on the list API (requires detail page scraping)
 */
export async function scrapeChittorgarhIPOs(): Promise<ChittorgarhScraperResult> {
  const result: ChittorgarhScraperResult = {
    ipos: [],
    errors: []
  };

  try {
    logger.info({ url: CHITTORGARH_API_BASE }, 'Starting Chittorgarh IPO scraper (API version)');

    // Fetch data with retry logic (API accepts perPage: 10, 20, 30...)
    const apiData = await retryWithExponentialBackoff(
      () => fetchChittorgarhAPI(1, 10, 'all'),
      3,
      1000
    );

    logger.info(
      {
        hasData: !!apiData,
        hasReportTableData: !!apiData.reportTableData,
        dataType: typeof apiData.reportTableData,
        isArray: Array.isArray(apiData.reportTableData),
        length: apiData.reportTableData?.length,
        msg: apiData.msg,
        error: (apiData as any).error,
        keys: apiData ? Object.keys(apiData) : []
      },
      'API response structure'
    );

    // Check for API error
    if ((apiData as any).error) {
      const errorMsg = `Chittorgarh API error: ${(apiData as any).error}`;
      logger.error({ error: (apiData as any).error }, errorMsg);
      result.errors.push(errorMsg);
      return result;
    }

    if (!apiData.reportTableData || apiData.reportTableData.length === 0) {
      logger.warn('No IPO data returned from Chittorgarh API');
      result.errors.push('No IPO data found');
      return result;
    }

    logger.info(
      { recordCount: apiData.reportTableData.length },
      'Received IPO data from Chittorgarh API'
    );

    // Parse each IPO record
    for (const record of apiData.reportTableData) {
      try {
        // Extract company name (from HTML anchor tag)
        const companyName = extractTextFromAnchor(record['Company']);
        if (!companyName) continue;
        // The same anchor carries this IPO's Chittorgarh page. Recorded as a
        // link verifier only (T-403 M-6) — never as a document source.
        const verifierUrl = extractHrefFromAnchor(record['Company']);

        // Parse dates (prefer ISO metadata over display date)
        const openDate = parseChittorgarhDate(
          record['Opening Date'],
          record['~Issue_Open_Date']
        );
        const closeDate = parseChittorgarhDate(
          record['Closing Date'],
          record['~IssueCloseDate']
        );
        const listingDate = parseChittorgarhDate(
          record['Listing Date'],
          record['~ListingDate']
        );

        // Skip if missing open date (close date can be empty for far-future IPOs)
        if (!openDate) {
          logger.debug(
            { companyName, openDate, closeDate },
            'Skipping IPO with missing open date'
          );
          continue;
        }

        // For IPOs without close date, use open date + 3 days as default
        const effectiveCloseDate = closeDate || (() => {
          const openDateObj = new Date(openDate);
          openDateObj.setDate(openDateObj.getDate() + 3);
          return openDateObj.toISOString().split('T')[0];
        })();

        // Parse price
        const price = parseChittorgarhPrice(record['Issue Price (Rs.)']);

        // Parse issue amount
        const issueSize = parseChittorgarhAmount(
          record['Total Issue Amount (Incl.Firm reservations) (Rs.cr.)']
        );

        // Parse listing info (exchange + segment)
        const listingInfo = parseListingInfo(record['Listing at']);

        // Determine status
        const status = determineStatus(openDate, effectiveCloseDate, listingDate);

        // Extract lead manager (optional)
        const leadManager = extractTextFromAnchor(record['Lead Manager']);

        // T-287F2: a business trust (InvIT/REIT) does not sit on the equity
        // mainboard/SME axis at all (see schema.ts: "segment ... nullable for
        // RIGHTS/InvITs/REITs"), so `listingInfo.segment` (which only ever
        // resolves to MAINBOARD or SME from the "Listing at" text) is WRONG
        // for these rows -- it was previously written unconditionally,
        // re-defaulting a manually-corrected segment=NULL back to MAINBOARD
        // on every scrape cycle (checker T-287C2 FINDING-hold-rebounded.md).
        // Detect the trust shape from the company name BEFORE assigning
        // segment/offeringType, instead of hardcoding both and relying on a
        // downstream validation pass to catch it after the wrong value has
        // already been scraped.
        const trustOfferingType = offeringTypeFromBusinessTrustName(companyName);

        // Story 11.8: Default to IPO offering type for Chittorgarh data,
        // EXCEPT business trusts (T-287F2) which are never IPOs.
        const ipo: ChittorgarhIPO = {
          companyName: sanitizeText(companyName),
          issueSize,
          // T-228: an unannounced price band comes back as 0 from the source.
          // The schema types these as optional-but-positive, so passing 0 made the
          // whole record fail validation and get dropped -- losing the name, dates
          // and lot size of every IPO whose band is not published yet.
          // "Not announced" is UNKNOWN, not zero: omit the field instead.
          priceRangeMin: price.min > 0 ? price.min : undefined,
          priceRangeMax: price.max > 0 ? price.max : undefined,
          openDate,
          closeDate: effectiveCloseDate,
          listingDate,
          verifierUrl,
          listingExchange: listingInfo.exchange,
          // T-287F2: null (not MAINBOARD) for a detected business trust.
          segment: trustOfferingType ? null : listingInfo.segment,
          offeringType: trustOfferingType ?? 'IPO',
          status,
          leadManagers: leadManager ? [leadManager] : undefined,
          dataSource: 'CHITTORGARH',
          // NOTE: GMP data NOT available on list API
          // Would require scraping individual IPO detail pages
          gmp: undefined,
          gmpPercentage: undefined,
          gmpUpdatedAt: undefined,
        };

        result.ipos.push(ipo);

        logger.debug(
          {
            companyName: ipo.companyName,
            status: ipo.status,
            exchange: ipo.listingExchange,
            segment: ipo.segment,
            offeringType: ipo.offeringType
          },
          'Successfully parsed Chittorgarh IPO'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMsg }, 'Failed to parse Chittorgarh API record');
        result.errors.push(`Record parsing error: ${errorMsg}`);
      }
    }

    logger.info(
      { iposScraped: result.ipos.length, errors: result.errors.length },
      'Chittorgarh scraper completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Chittorgarh scraper failed');
    result.errors.push(`Scraper error: ${errorMsg}`);
    return result;
  }
}
