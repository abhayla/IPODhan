/**
 * NSE Security Type Web Scraper
 *
 * Scrapes security type (EQ vs SME) from NSE website when API doesn't provide it.
 * Used as fallback when API response doesn't include segment information.
 *
 * @module scraper/src/scrapers/nse-security-type-scraper
 */

import logger from '../utils/logger.js';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.nseindia.com';

// Required headers to bypass NSE's bot detection
const DEFAULT_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.nseindia.com/',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Cache-Control': 'no-cache'
};

// Cookie storage
let nseSessionCookies: string[] = [];

/**
 * Initialize NSE session by visiting homepage to collect cookies
 */
async function initNSEWebSession(): Promise<void> {
  try {
    logger.debug('Initializing NSE web session for security type scraping');

    const response = await fetch(BASE_URL, {
      method: 'GET',
      headers: DEFAULT_HEADERS
    });

    // Extract cookies
    const cookies = response.headers.getSetCookie?.() || [];
    if (cookies.length > 0) {
      nseSessionCookies = cookies.map(cookie => cookie.split(';')[0]);
      logger.debug({
        cookieCount: nseSessionCookies.length
      }, 'NSE web session cookies obtained');
    }

    // Wait 1 second (human-like behavior)
    await new Promise(resolve => setTimeout(resolve, 1000));

  } catch (error) {
    logger.error({ error }, 'Failed to initialize NSE web session');
  }
}

/**
 * Security type mapping for an IPO
 */
export interface SecurityTypeResult {
  companyName: string;
  securityType: 'EQ' | 'SME' | null;
  segment: 'MAINBOARD' | 'SME' | null;
  source: 'website-html';
}

/**
 * Scrape security type from NSE upcoming IPOs page
 *
 * @param companyName - Company name to search for
 * @param symbol - Optional NSE symbol for more accurate matching
 * @returns Security type result (EQ → MAINBOARD, SME → SME, null if not found)
 */
export async function scrapeSecurityTypeFromWebsite(
  companyName: string,
  symbol?: string
): Promise<SecurityTypeResult> {
  try {
    // Initialize session if needed
    if (nseSessionCookies.length === 0) {
      await initNSEWebSession();
    }

    logger.debug({ companyName, symbol }, 'Scraping security type from NSE website');

    // Fetch NSE upcoming IPOs page
    const url = `${BASE_URL}/market-data/all-upcoming-issues-ipo`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...DEFAULT_HEADERS,
        ...(nseSessionCookies.length > 0 && { 'Cookie': nseSessionCookies.join('; ') })
      }
    });

    if (!response.ok) {
      throw new Error(`NSE website returned ${response.status}`);
    }

    const html = await response.text();

    // Parse HTML with cheerio
    const $ = cheerio.load(html);

    // Find the table row containing this company
    let securityType: 'EQ' | 'SME' | null = null;

    // Strategy 1: Search by company name (case-insensitive)
    $('table tbody tr').each((_, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      // Check if this row contains our company name
      let foundCompany = false;
      cells.each((_, cell) => {
        const cellText = $(cell).text().trim();
        if (cellText.toLowerCase().includes(companyName.toLowerCase())) {
          foundCompany = true;
        }
      });

      if (foundCompany) {
        // Found the row, now extract security type
        // Security type is typically in the first cell or has class/attribute indicating type
        cells.each((_, cell) => {
          const cellText = $(cell).text().trim().toUpperCase();
          if (cellText === 'EQ' || cellText === 'SME') {
            securityType = cellText as 'EQ' | 'SME';
            return false; // Break loop
          }
        });
      }

      if (securityType) {
        return false; // Break outer loop
      }
    });

    // Strategy 2: Search by symbol if provided
    if (!securityType && symbol) {
      $('table tbody tr').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        let foundSymbol = false;
        cells.each((_, cell) => {
          const cellText = $(cell).text().trim();
          if (cellText.toUpperCase() === symbol.toUpperCase()) {
            foundSymbol = true;
          }
        });

        if (foundSymbol) {
          cells.each((_, cell) => {
            const cellText = $(cell).text().trim().toUpperCase();
            if (cellText === 'EQ' || cellText === 'SME') {
              securityType = cellText as 'EQ' | 'SME';
              return false;
            }
          });
        }

        if (securityType) {
          return false;
        }
      });
    }

    // Map security type to segment
    const segment = securityType === 'EQ' ? 'MAINBOARD' : securityType === 'SME' ? 'SME' : null;

    if (securityType) {
      logger.info({
        companyName,
        symbol,
        securityType,
        segment
      }, '✅ Security type scraped successfully from website');
    } else {
      logger.warn({
        companyName,
        symbol
      }, '⚠️  Security type not found on NSE website');
    }

    return {
      companyName,
      securityType,
      segment,
      source: 'website-html'
    };

  } catch (error) {
    logger.error({
      companyName,
      symbol,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to scrape security type from website');

    return {
      companyName,
      securityType: null,
      segment: null,
      source: 'website-html'
    };
  }
}

/**
 * Batch scrape security types for multiple IPOs
 *
 * @param ipos - Array of { companyName, symbol? }
 * @param delayMs - Delay between requests (default: 1000ms for rate limiting)
 * @returns Array of security type results
 */
export async function batchScrapeSecurityTypes(
  ipos: Array<{ companyName: string; symbol?: string }>,
  delayMs: number = 1000
): Promise<SecurityTypeResult[]> {
  const results: SecurityTypeResult[] = [];

  logger.info({ count: ipos.length, delayMs }, 'Starting batch security type scraping');

  for (let i = 0; i < ipos.length; i++) {
    const ipo = ipos[i];

    logger.debug({ index: i + 1, total: ipos.length, companyName: ipo.companyName }, 'Scraping security type');

    const result = await scrapeSecurityTypeFromWebsite(ipo.companyName, ipo.symbol);
    results.push(result);

    // Add delay between requests (rate limiting)
    if (i < ipos.length - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  const successCount = results.filter(r => r.securityType !== null).length;
  const failCount = results.filter(r => r.securityType === null).length;

  logger.info({
    total: results.length,
    success: successCount,
    failed: failCount,
    successRate: `${((successCount / results.length) * 100).toFixed(1)}%`
  }, 'Batch security type scraping completed');

  return results;
}

/**
 * Clear session cookies (call when scraper is done)
 */
export function clearWebSession(): void {
  nseSessionCookies = [];
  logger.debug('NSE web session cookies cleared');
}
