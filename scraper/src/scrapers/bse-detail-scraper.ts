/**
 * BSE IPO Detail Page Scraper
 *
 * Implementation Date: 2025-10-17
 * Technology: Cheerio (no JavaScript rendering needed)
 * Data Completeness: ~60% (missing ISIN, financials, company description)
 *
 * Purpose:
 * - Extracts detailed IPO information from BSE detail pages
 * - Populates ipo_details and ipo_financials tables
 * - Fixes 20 BSE-only IPOs with missing issue_size data
 * - Extracts IPO documents (DRHP, RHP, Prospectus, etc.) - Story 11.8
 *
 * URL Pattern:
 * https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id={id}&type=IPO&idtype=1&status={status}&IPONo={ipoNo}&startdt={startDate}
 */

import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import { parseDdMmmYyyy } from '../utils/date-string-parsing.js';
import { scrapeBSEDocuments, type DocumentLink } from './bse-document-scraper.js';
import { detectDocumentType } from '../utils/document-type-mapper.js';
import type { DocumentInsert } from '@ipodhan/shared';

/**
 * BSE Detail Page Types
 * - ACQDisp: MAINBOARD and SME IPOs (On The Board)
 * - DisplayIPO: Rights Issues and Debt Issues (NCD)
 */
export type BSEDetailPageType = 'ACQDisp' | 'DisplayIPO';

export interface BSEDetailPageData {
  symbol: string | null;
  openDate: string | null;
  closeDate: string | null;
  priceRangeMin: number;
  priceRangeMax: number;
  issueSize: number; // In basic units (not crores)
  lotSize: number;
  faceValue: number | undefined;
  registrar: string | null;
  leadManagers: string[] | null;
  sponsorBanks: string[] | null;
  issueShares: number; // Raw share count
}

export interface BSEDetailScraperResult {
  details: BSEDetailPageData[];
  errors: string[];
}

export interface BSEDetailWithDocuments {
  details: BSEDetailPageData;
  documents: DocumentInsert[];
}

/**
 * Extract field value from BSE detail page table structure
 * BSE uses simple HTML tables with label-value pairs
 */
function extractFieldValue($: cheerio.CheerioAPI, label: string): string | null {
  let value: string | null = null;

  $('table tr').each((_, row) => {
    const cells = $(row).find('td.TTRow_left');
    if (cells.length === 2) {
      const cellLabel = $(cells[0]).text().trim();

      // Match label (case-insensitive, handles variations)
      if (cellLabel.toLowerCase().includes(label.toLowerCase())) {
        value = $(cells[1]).text().trim();
        return false; // Break loop
      }
    }
  });

  return value;
}

/**
 * Parse BSE issue period format: "15 Oct 2025 to 17 Oct 2025"
 * Returns ISO 8601 date strings
 */
function parseIssuePeriod(issuePeriod: string | null): {
  openDate: string | null;
  closeDate: string | null;
} {
  if (!issuePeriod) {
    return { openDate: null, closeDate: null };
  }

  try {
    const parts = issuePeriod.split(' to ').map(d => d.trim());

    if (parts.length !== 2) {
      logger.warn({ issuePeriod }, 'Invalid issue period format');
      return { openDate: null, closeDate: null };
    }

    const [startStr, endStr] = parts;

    // String arithmetic, TZ-invariant by construction (T-327, round-7 P1-1) —
    // NEVER `new Date(dateOnlyString).toISOString()`, which drifts a day on
    // any non-UTC host.
    const openDate = parseDdMmmYyyy(startStr);
    const closeDate = parseDdMmmYyyy(endStr);

    if (!openDate || !closeDate) {
      logger.warn({ startStr, endStr }, 'Failed to parse issue period dates');
      return { openDate: null, closeDate: null };
    }

    return { openDate, closeDate };
  } catch (error) {
    logger.error({ issuePeriod, error }, 'Error parsing issue period');
    return { openDate: null, closeDate: null };
  }
}

/**
 * Parse BSE price band format: "1014.00-1065.00" or "1014.00 - 1065.00"
 */
function parsePriceBand(priceBand: string | null): { min: number; max: number } {
  if (!priceBand) {
    return { min: 0, max: 0 };
  }

  try {
    // Handle both "1014.00-1065.00" and "1014.00 - 1065.00"
    const parts = priceBand.split(/-/).map(p => p.trim());

    if (parts.length !== 2) {
      logger.warn({ priceBand }, 'Invalid price band format');
      return { min: 0, max: 0 };
    }

    const [minStr, maxStr] = parts;
    const min = parseFloat(minStr);
    const max = parseFloat(maxStr);

    if (isNaN(min) || isNaN(max)) {
      logger.warn({ minStr, maxStr }, 'Failed to parse price band values');
      return { min: 0, max: 0 };
    }

    return { min, max };
  } catch (error) {
    logger.error({ priceBand, error }, 'Error parsing price band');
    return { min: 0, max: 0 };
  }
}

/**
 * Parse share count: "31,17,460" (Indian number format)
 * Returns integer share count
 */
function parseShareCount(sharesStr: string | null): number {
  if (!sharesStr) return 0;

  try {
    // Remove all commas and parse
    const cleaned = sharesStr.replace(/,/g, '');
    const shares = parseInt(cleaned, 10);

    if (isNaN(shares)) {
      logger.warn({ sharesStr }, 'Failed to parse share count');
      return 0;
    }

    return shares;
  } catch (error) {
    logger.error({ sharesStr, error }, 'Error parsing share count');
    return 0;
  }
}

/**
 * Calculate issue size in basic units (not crores).
 * Formula: shares x price.
 *
 * W-109 (round-8, Glass Wall Systems): the published share count is the
 * count AT THE FLOOR price ("up to N shares"). When a real band exists,
 * callers MUST pass the band's floor (priceRangeMin) — floor-count x
 * cap-price produces a total that appears nowhere in the filing (Glass
 * Wall: 23,702,094 x Rs182 cap = Rs4,313.78 Cr, never published; the real
 * floor total is 23,702,094 x Rs172 = Rs4,076.76 Cr, matching the ad). When
 * there is no band (a single fixed price), that fixed price is both the
 * floor and the cap, so it is passed unchanged.
 */
export function calculateIssueSize(shares: number, price: number): number {
  if (shares === 0 || price === 0) return 0;

  // Return in basic units (rupees), not crores
  return shares * price;
}

/**
 * Parse comma-separated list (lead managers, banks)
 * Returns array of trimmed strings
 */
function parseCommaSeparatedList(value: string | null): string[] | null {
  if (!value) return null;

  const items = value
    .split(',')
    .map(item => sanitizeText(item))
    .filter(item => item.length > 0);

  return items.length > 0 ? items : null;
}

/**
 * Detect BSE detail page type from URL
 * @param url - BSE detail page URL
 * @returns Page type: 'ACQDisp' or 'DisplayIPO'
 */
export function detectBSEDetailPageType(url: string): BSEDetailPageType {
  try {
    const urlLower = url.toLowerCase();

    // ACQDisp.aspx pattern: /PublicIssues/ACQDisp.aspx?...Type=OTB
    if (urlLower.includes('/acqdisp.aspx')) {
      return 'ACQDisp';
    }

    // DisplayIPO.aspx pattern: /publicIssues/DisplayIPO.aspx?...type=RI|DPI
    if (urlLower.includes('/displayipo.aspx')) {
      return 'DisplayIPO';
    }

    // Default to ACQDisp for unknown patterns (backward compatibility)
    logger.warn({ url }, 'Unknown BSE detail page type, defaulting to ACQDisp');
    return 'ACQDisp';
  } catch (error) {
    logger.error({ url, error }, 'Error detecting BSE detail page type');
    return 'ACQDisp'; // Fail-safe default
  }
}

/**
 * Parse ACQDisp.aspx page (MAINBOARD/SME IPOs)
 * This is the original parsing logic for OTB (On The Board) IPOs
 * @param $ - Cheerio loaded HTML
 * @returns Parsed BSE detail data
 */
export function parseACQDispPage($: cheerio.CheerioAPI): BSEDetailPageData {
  // Extract all fields using helper function
  const symbol = extractFieldValue($, 'Symbol');
  const issuePeriod = extractFieldValue($, 'Issue Period');
  const priceBand = extractFieldValue($, 'Price Band');
  const issueSharesStr = extractFieldValue($, 'Issue Size – No. of Shares') ||
                          extractFieldValue($, 'Issue Size');
  const faceValueStr = extractFieldValue($, 'Face Value');
  const lotSizeStr = extractFieldValue($, 'Market Lot') ||
                     extractFieldValue($, 'Lot Size');
  const registrar = extractFieldValue($, 'Registrar');
  const leadManagersStr = extractFieldValue($, 'Book Running Lead Manager') ||
                          extractFieldValue($, 'Lead Manager');
  const sponsorBanksStr = extractFieldValue($, 'Sponsor Bank');

  // Parse dates
  const { openDate, closeDate } = parseIssuePeriod(issuePeriod);

  // Parse price band
  const { min: priceRangeMin, max: priceRangeMax } = parsePriceBand(priceBand);

  // Parse share count
  const issueShares = parseShareCount(issueSharesStr);

  // Calculate issue size from the band FLOOR (W-109) — the exchange's share
  // count is the count at the floor price, not the cap.
  const issueSize = calculateIssueSize(issueShares, priceRangeMin);

  // Parse numeric fields
  const faceValue = faceValueStr ? parseInt(parseFloat(faceValueStr).toString(), 10) : undefined;
  const lotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : 100;

  // Parse lists
  const leadManagers = parseCommaSeparatedList(leadManagersStr);
  const sponsorBanks = parseCommaSeparatedList(sponsorBanksStr);

  return {
    symbol,
    openDate,
    closeDate,
    priceRangeMin,
    priceRangeMax,
    issueSize,
    lotSize,
    faceValue,
    registrar,
    leadManagers,
    sponsorBanks,
    issueShares,
  };
}

/**
 * Parse DisplayIPO.aspx page (RIGHTS/NCD IPOs)
 * Different HTML structure with optional symbol and lead managers
 * @param $ - Cheerio loaded HTML
 * @returns Parsed BSE detail data
 */
export function parseDisplayIPOPage($: cheerio.CheerioAPI): BSEDetailPageData {
  // Symbol: OPTIONAL (often missing for RIGHTS/NCD)
  const symbol = extractFieldValue($, 'Symbol') || null;

  // Lead Managers: Try multiple label variations, allow null
  const leadManagersStr =
    extractFieldValue($, 'Lead Manager') ||
    extractFieldValue($, 'Book Running Lead Manager') ||
    extractFieldValue($, 'Manager') ||
    null;

  // Price: DisplayIPO.aspx exposes exactly ONE "Issue Price" field, never a
  // genuine min/max band (unlike ACQDisp's "Price Band" field, parsed by
  // parsePriceBand() above). T-308 (round-6 P1, 3rd occurrence of this
  // class): the caller in bse-scraper.ts documents this page type is used
  // for BOTH RIGHTS/NCD (DisplayIPO.aspx?...type=RI|DPI) AND "regular IPOs"
  // — so this is not safely gated to single-price products. Writing the
  // lone issue price into both priceRangeMin and priceRangeMax silently
  // collapsed (or, via bse-scraper's merge, overwrote) a real book-built
  // band. Keep priceRangeMin/Max at 0 so bse-scraper's
  // `if (detailData.priceRangeMin > 0 && detailData.priceRangeMax > 0)`
  // merge guard treats this as "no update" — issueSize below still uses the
  // real lone price for its own (unrelated) computation.
  const issuePriceStr = extractFieldValue($, 'Issue Price') ||
                        extractFieldValue($, 'Price');
  const issuePrice = issuePriceStr ? parseFloat(issuePriceStr) : 0;
  const priceRangeMin = 0;
  const priceRangeMax = 0;

  // Lot Size: Different label
  const lotSizeStr = extractFieldValue($, 'Lot Size') ||
                     extractFieldValue($, 'Market Lot');
  const lotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : 100;

  // Issue Shares: Try multiple approaches
  const issueSharesStr = extractFieldValue($, 'Issue Size – No. of Shares') ||
                         extractFieldValue($, 'Issue Size') ||
                         extractFieldValue($, 'No. of Shares');
  const issueShares = parseShareCount(issueSharesStr);

  // Common fields (same extraction logic as ACQDisp)
  const issuePeriod = extractFieldValue($, 'Issue Period');
  const { openDate, closeDate } = parseIssuePeriod(issuePeriod);

  const faceValueStr = extractFieldValue($, 'Face Value');
  const faceValue = faceValueStr ? parseInt(parseFloat(faceValueStr).toString(), 10) : undefined;

  const registrar = extractFieldValue($, 'Registrar');
  const sponsorBanksStr = extractFieldValue($, 'Sponsor Bank');

  // Calculate issue size from the real lone issue price (unrelated to the
  // band fields, which are intentionally zeroed above).
  const issueSize = calculateIssueSize(issueShares, issuePrice);

  // Parse lists
  const leadManagers = parseCommaSeparatedList(leadManagersStr);
  const sponsorBanks = parseCommaSeparatedList(sponsorBanksStr);

  return {
    symbol,
    openDate,
    closeDate,
    priceRangeMin,
    priceRangeMax,
    issueSize,
    lotSize,
    faceValue,
    registrar,
    leadManagers,
    sponsorBanks,
    issueShares,
  };
}

/**
 * Scrape BSE IPO detail page
 * @param url - Full BSE detail page URL
 * @returns Parsed IPO detail data
 */
export async function scrapeBSEIPODetail(url: string): Promise<BSEDetailPageData> {
  logger.info({ url }, 'Scraping BSE IPO detail page');

  try {
    // Fetch HTML with retry logic
    const response = await retryWithExponentialBackoff(
      async () => {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return res;
      },
      3,
      1000
    );

    const html = await response.text();
    const $ = cheerio.load(html);

    // Detect page type and route to appropriate parser
    const pageType = detectBSEDetailPageType(url);
    logger.debug({ url, pageType }, 'Detected BSE detail page type');

    let result: BSEDetailPageData;

    if (pageType === 'DisplayIPO') {
      // Rights Issues and Debt Issues
      result = parseDisplayIPOPage($ as cheerio.CheerioAPI);
    } else {
      // MAINBOARD and SME IPOs (ACQDisp)
      result = parseACQDispPage($ as cheerio.CheerioAPI);
    }

    logger.debug({
      pageType,
      symbol: result.symbol,
      issueSize: result.issueSize,
      lotSize: result.lotSize
    }, 'Successfully scraped BSE detail page');

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ url, error: errorMsg }, 'Failed to scrape BSE detail page');
    throw error;
  }
}

/**
 * Scrape multiple BSE IPO detail pages with rate limiting
 * @param urls - Array of BSE detail page URLs
 * @param delayMs - Delay between requests in milliseconds (default: 2000)
 * @returns Scraper results with details and errors
 */
export async function scrapeBSEIPODetails(
  urls: string[],
  delayMs: number = 2000
): Promise<BSEDetailScraperResult> {
  const result: BSEDetailScraperResult = {
    details: [],
    errors: [],
  };

  logger.info({ urlCount: urls.length, delayMs }, 'Starting BSE detail page scraping');

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];

    try {
      const details = await scrapeBSEIPODetail(url);
      result.details.push(details);

      logger.info(
        {
          progress: `${i + 1}/${urls.length}`,
          symbol: details.symbol
        },
        'BSE detail page scraped successfully'
      );

      // Rate limiting (skip delay on last iteration)
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }

      // Extended delay every 10 requests
      if ((i + 1) % 10 === 0 && i < urls.length - 1) {
        logger.debug('Taking extended break after 10 requests');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn({ url, error: errorMsg }, 'Failed to scrape BSE detail page');
      result.errors.push(`${url}: ${errorMsg}`);
    }
  }

  logger.info(
    {
      detailsScraped: result.details.length,
      errors: result.errors.length
    },
    'BSE detail scraping completed'
  );

  return result;
}

/**
 * Validate BSE detail page data before database insertion
 * Note: Symbol and leadManagers are optional for RIGHTS/NCD issues
 * Category-specific validation happens in validators.ts
 */
export function validateBSEDetailData(data: BSEDetailPageData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Symbol and leadManagers are optional (may be null for RIGHTS/NCD)
  // Category-specific validation handled in main validator

  // Required fields
  if (!data.openDate) {
    errors.push('Missing required field: openDate');
  }

  if (!data.closeDate) {
    errors.push('Missing required field: closeDate');
  }

  if (data.priceRangeMin === 0 || data.priceRangeMax === 0) {
    errors.push('Invalid price band: min or max is zero');
  }

  // Allow min == max for RIGHTS/NCD (single price), but fail if min > max
  if (data.priceRangeMin > data.priceRangeMax) {
    errors.push('Invalid price band: min > max');
  }

  if (data.openDate && data.closeDate && data.openDate >= data.closeDate) {
    errors.push('Invalid dates: open >= close');
  }

  if (data.lotSize <= 0) {
    errors.push('Invalid lot size: must be positive');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Scrape BSE IPO detail page with documents (Story 11.8)
 * Extracts both detail data and document links in a single call
 *
 * @param url - Full BSE detail page URL
 * @param ipoId - IPO ID for associating documents
 * @returns Detail data and documents
 */
export async function scrapeBSEIPODetailWithDocuments(
  url: string,
  ipoId: string
): Promise<BSEDetailWithDocuments> {
  logger.info({ url, ipoId }, 'Scraping BSE IPO detail page with documents');

  try {
    // Fetch HTML once (reuse for both detail and documents)
    const response = await retryWithExponentialBackoff(
      async () => {
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return res;
      },
      3,
      1000
    );

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract detail data (existing logic)
    const pageType = detectBSEDetailPageType(url);
    let details: BSEDetailPageData;

    if (pageType === 'DisplayIPO') {
      details = parseDisplayIPOPage($ as cheerio.CheerioAPI);
    } else {
      details = parseACQDispPage($ as cheerio.CheerioAPI);
    }

    // Extract documents (Story 11.8)
    const documentLinks = scrapeBSEDocuments(html);

    // Map document links to DocumentInsert format
    const documents: DocumentInsert[] = documentLinks.map((doc: DocumentLink) => {
      const { type, mediaType } = detectDocumentType(doc.title);

      return {
        ipoId,
        type,
        mediaType,
        title: doc.title,
        url: doc.url,
        exchange: 'BSE',
        isActive: true,
        // sequenceNumber will be calculated by repository
      };
    });

    logger.info(
      {
        ipoId,
        detailExtracted: true,
        documentsExtracted: documents.length,
      },
      'Successfully scraped BSE detail page with documents'
    );

    return { details, documents };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(
      { url, ipoId, error: errorMsg },
      'Failed to scrape BSE detail page with documents'
    );
    throw error;
  }
}
