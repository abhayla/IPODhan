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
 *
 * URL Pattern:
 * https://www.bseindia.com/markets/publicIssues/DisplayIPO.aspx?id={id}&type=IPO&idtype=1&status={status}&IPONo={ipoNo}&startdt={startDate}
 */

import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';
import { sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';

export interface BSEDetailPageData {
  symbol: string | null;
  openDate: string | null;
  closeDate: string | null;
  priceRangeMin: number;
  priceRangeMax: number;
  issueSize: number; // In basic units (not crores)
  lotSize: number;
  faceValue: number;
  registrar: string | null;
  leadManagers: string[] | null;
  sponsorBanks: string[] | null;
  issueShares: number; // Raw share count
}

export interface BSEDetailScraperResult {
  details: BSEDetailPageData[];
  errors: string[];
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

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      logger.warn({ startStr, endStr }, 'Failed to parse issue period dates');
      return { openDate: null, closeDate: null };
    }

    return {
      openDate: startDate.toISOString().split('T')[0],
      closeDate: endDate.toISOString().split('T')[0],
    };
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
 * Calculate issue size in basic units (not crores)
 * Formula: shares × price_max
 */
function calculateIssueSize(shares: number, priceMax: number): number {
  if (shares === 0 || priceMax === 0) return 0;

  // Return in basic units (rupees), not crores
  return shares * priceMax;
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

    // Calculate issue size
    const issueSize = calculateIssueSize(issueShares, priceRangeMax);

    // Parse numeric fields
    const faceValue = faceValueStr ? parseInt(parseFloat(faceValueStr).toString(), 10) : 10; // Default face value (integer)
    const lotSize = lotSizeStr ? parseInt(lotSizeStr, 10) : 100; // Default lot size

    // Parse lists
    const leadManagers = parseCommaSeparatedList(leadManagersStr);
    const sponsorBanks = parseCommaSeparatedList(sponsorBanksStr);

    const result: BSEDetailPageData = {
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

    logger.debug({ symbol, issueSize, lotSize }, 'Successfully scraped BSE detail page');

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
 */
export function validateBSEDetailData(data: BSEDetailPageData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Required fields
  if (!data.symbol) {
    errors.push('Missing required field: symbol');
  }

  if (!data.openDate) {
    errors.push('Missing required field: openDate');
  }

  if (!data.closeDate) {
    errors.push('Missing required field: closeDate');
  }

  if (data.priceRangeMin === 0 || data.priceRangeMax === 0) {
    errors.push('Invalid price band: min or max is zero');
  }

  if (data.priceRangeMin >= data.priceRangeMax) {
    errors.push('Invalid price band: min >= max');
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
