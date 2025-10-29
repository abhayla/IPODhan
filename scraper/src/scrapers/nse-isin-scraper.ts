/**
 * NSE Website ISIN Scraper
 *
 * Purpose: Extract ISIN from NSE website for NSE-only IPOs
 * Method: Puppeteer-based browser automation with stealth
 * Target: 11 NSE-only IPOs without ISIN data
 *
 * Created: 2025-10-29
 */

import puppeteer, { Browser, Page } from 'puppeteer';
import logger from '../utils/logger.js';

/**
 * Simple delay utility
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// NSE URL patterns
const NSE_URLS = {
  IPO_DETAIL: 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
  QUOTE: 'https://www.nseindia.com/get-quotes/equity',
  COMPANY_INFO: 'https://www.nseindia.com/companies-listing/corporate-filings-company-details',
};

export interface NSEISINResult {
  symbol: string;
  isin: string | null;
  source: 'quote_page' | 'ipo_page' | 'company_page' | 'api' | null;
  success: boolean;
  error?: string;
}

/**
 * Launch browser with stealth settings to avoid detection
 */
async function launchBrowser(): Promise<Browser> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920,1080',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    ],
  });

  return browser;
}

/**
 * Setup page with stealth settings and NSE session cookies
 * Uses multi-page visit strategy to collect all required cookies
 */
async function setupPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();

  // Set viewport
  await page.setViewport({ width: 1920, height: 1080 });

  // Set extra headers to mimic real browser
  await page.setExtraHTTPHeaders({
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
  });

  // Mask automation detection
  await page.evaluateOnNewDocument(() => {
    // @ts-ignore
    delete navigator.__proto__.webdriver;
  });

  // Initialize NSE session by visiting required pages
  await initNSESessionInBrowser(page);

  return page;
}

/**
 * Initialize NSE session by visiting multiple pages to collect cookies
 * This mimics the approach used in nse-api-client.ts but with Puppeteer
 */
async function initNSESessionInBrowser(page: Page): Promise<void> {
  try {
    logger.info('Initializing NSE session (multi-page cookie collection)');

    // Step 1: Visit NSE homepage
    logger.debug('Step 1: Visiting NSE homepage for initial cookies');
    await page.goto('https://www.nseindia.com', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(1500); // Human-like delay

    // Step 2: Visit market-data page (where IPO data lives)
    logger.debug('Step 2: Visiting market-data page for additional cookies');
    await page.goto('https://www.nseindia.com/market-data/all-upcoming-issues-ipo', {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    await delay(1000);

    // Check cookies collected
    const cookies = await page.cookies();
    const cookieNames = cookies.map(c => c.name);

    logger.info({
      cookieCount: cookies.length,
      cookieNames: cookieNames.join(', '),
      hasNsit: cookieNames.includes('nsit'),
      hasNseappid: cookieNames.includes('nseappid'),
    }, 'NSE session initialized successfully');

    if (cookies.length < 3) {
      logger.warn('Insufficient cookies collected - may face authentication issues');
    }
  } catch (error) {
    logger.error({ error }, 'Failed to initialize NSE session in browser');
  }
}

/**
 * Extract ISIN from NSE quote page
 */
async function extractISINFromQuotePage(page: Page, symbol: string): Promise<string | null> {
  try {
    const url = `${NSE_URLS.QUOTE}?symbol=${symbol}`;
    logger.info({ url }, 'Navigating to NSE quote page');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(2000); // Wait for JavaScript to render

    // Try multiple selectors for ISIN
    const selectors = [
      'span:contains("ISIN")', // Generic
      '.security-info .isin', // Common pattern
      '[data-label="ISIN"]', // Data attribute
      'td:contains("ISIN") + td', // Table format
      '.quote-info .isin-code', // Quote info section
    ];

    for (const selector of selectors) {
      try {
        const isinElement = await page.$(selector);
        if (isinElement) {
          const text = await page.evaluate(el => el.textContent, isinElement);
          const isinMatch = text?.match(/IN[A-Z0-9]{10}/);
          if (isinMatch) {
            logger.info({ symbol, isin: isinMatch[0], selector }, 'ISIN found on quote page');
            return isinMatch[0];
          }
        }
      } catch (err) {
        // Continue to next selector
        continue;
      }
    }

    // Try extracting ISIN from page content as fallback
    const pageContent = await page.content();
    const isinMatch = pageContent.match(/ISIN[:\s]+([IN][A-Z0-9]{10})/i);
    if (isinMatch && isinMatch[1]) {
      logger.info({ symbol, isin: isinMatch[1], source: 'content' }, 'ISIN found in page content');
      return isinMatch[1];
    }

    logger.warn({ symbol }, 'ISIN not found on quote page');
    return null;
  } catch (error) {
    logger.error({ symbol, error }, 'Error extracting ISIN from quote page');
    return null;
  }
}

/**
 * Extract ISIN from NSE IPO page
 */
async function extractISINFromIPOPage(page: Page, companyName: string): Promise<string | null> {
  try {
    const url = NSE_URLS.IPO_DETAIL;
    logger.info({ url }, 'Navigating to NSE IPO page');

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000); // Wait for dynamic content

    // Search for company name in page
    const pageContent = await page.content();
    const companyIndex = pageContent.toLowerCase().indexOf(companyName.toLowerCase());

    if (companyIndex === -1) {
      logger.warn({ companyName }, 'Company not found on IPO page');
      return null;
    }

    // Look for ISIN near company name (within 500 characters)
    const searchArea = pageContent.substring(
      Math.max(0, companyIndex - 200),
      Math.min(pageContent.length, companyIndex + 500)
    );

    const isinMatch = searchArea.match(/IN[A-Z0-9]{10}/);
    if (isinMatch) {
      logger.info({ companyName, isin: isinMatch[0] }, 'ISIN found on IPO page');
      return isinMatch[0];
    }

    logger.warn({ companyName }, 'ISIN not found near company name on IPO page');
    return null;
  } catch (error) {
    logger.error({ companyName, error }, 'Error extracting ISIN from IPO page');
    return null;
  }
}

/**
 * Extract ISIN via NSE API call (if available)
 */
async function extractISINFromAPI(page: Page, symbol: string): Promise<string | null> {
  try {
    // NSE sometimes has API endpoints that return ISIN
    const apiURL = `https://www.nseindia.com/api/quote-equity?symbol=${symbol}`;

    logger.info({ apiURL }, 'Trying NSE API for ISIN');

    const response = await page.goto(apiURL, { waitUntil: 'networkidle2', timeout: 15000 });
    if (!response || response.status() !== 200) {
      logger.warn({ symbol, status: response?.status() }, 'NSE API request failed');
      return null;
    }

    const content = await page.content();
    const jsonMatch = content.match(/<pre[^>]*>(.*?)<\/pre>/s);

    if (jsonMatch && jsonMatch[1]) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        if (data.info && data.info.isin) {
          logger.info({ symbol, isin: data.info.isin }, 'ISIN found via NSE API');
          return data.info.isin;
        }
      } catch (parseError) {
        logger.warn({ symbol }, 'Failed to parse NSE API response');
      }
    }

    logger.warn({ symbol }, 'ISIN not available in NSE API');
    return null;
  } catch (error) {
    logger.error({ symbol, error }, 'Error extracting ISIN from NSE API');
    return null;
  }
}

/**
 * Main function to scrape ISIN for a given NSE symbol
 * Tries multiple strategies in order:
 * 1. NSE API (fastest)
 * 2. Quote page (most reliable)
 * 3. IPO page (fallback)
 */
export async function scrapeNSEISIN(
  symbol: string,
  companyName: string
): Promise<NSEISINResult> {
  let browser: Browser | null = null;

  try {
    logger.info({ symbol, companyName }, 'Starting ISIN extraction');

    browser = await launchBrowser();
    const page = await setupPage(browser);

    // Strategy 1: Try NSE API first (fastest)
    let isin = await extractISINFromAPI(page, symbol);
    if (isin) {
      await browser.close();
      return {
        symbol,
        isin,
        source: 'api',
        success: true,
      };
    }

    await delay(2000); // Rate limiting

    // Strategy 2: Try quote page
    isin = await extractISINFromQuotePage(page, symbol);
    if (isin) {
      await browser.close();
      return {
        symbol,
        isin,
        source: 'quote_page',
        success: true,
      };
    }

    await delay(2000); // Rate limiting

    // Strategy 3: Try IPO page
    isin = await extractISINFromIPOPage(page, companyName);
    if (isin) {
      await browser.close();
      return {
        symbol,
        isin,
        source: 'ipo_page',
        success: true,
      };
    }

    // All strategies failed
    await browser.close();
    logger.warn({ symbol, companyName }, 'Failed to extract ISIN from all sources');

    return {
      symbol,
      isin: null,
      source: null,
      success: false,
      error: 'ISIN not found on any NSE page',
    };
  } catch (error: any) {
    logger.error({ symbol, companyName, error }, 'Fatal error during ISIN extraction');

    if (browser) {
      await browser.close();
    }

    return {
      symbol,
      isin: null,
      source: null,
      success: false,
      error: error.message || 'Unknown error',
    };
  }
}

/**
 * Batch scrape ISINs for multiple symbols
 * Includes rate limiting to avoid IP blocks
 */
export async function scrapeMultipleISINs(
  items: Array<{ symbol: string; companyName: string }>
): Promise<NSEISINResult[]> {
  const results: NSEISINResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const { symbol, companyName } = items[i];

    logger.info(
      { progress: `${i + 1}/${items.length}`, symbol },
      'Processing ISIN extraction'
    );

    const result = await scrapeNSEISIN(symbol, companyName);
    results.push(result);

    // Rate limiting: 3-5 seconds between requests
    if (i < items.length - 1) {
      const delayMs = 3000 + Math.random() * 2000; // 3-5 seconds
      logger.info({ delayMs: Math.round(delayMs) }, 'Rate limiting delay');
      await delay(delayMs);
    }
  }

  // Summary statistics
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  logger.info(
    {
      total: items.length,
      successful,
      failed,
      successRate: `${((successful / items.length) * 100).toFixed(1)}%`,
    },
    'ISIN extraction batch completed'
  );

  return results;
}
