import type { Browser } from 'puppeteer';
import { launchBrowser, createPage, closeBrowser, navigateToUrl, waitForSelector } from '../utils/browser.js';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { scrapeNSEAPI, testNSEAPIConnection } from './nse-api-client.js';

const NSE_URL = config.scraper.nseUrl;

export interface NSEScrapeResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  source?: 'api' | 'browser';
}

/**
 * Scrape IPO data from NSE using browser automation (fallback method)
 * This is used when the API approach fails
 * @returns Promise<NSEScrapeResult> - Scraped IPO and subscription data
 */
async function scrapeNSEWithBrowser(): Promise<NSEScrapeResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    logger.info({ url: NSE_URL }, 'Starting NSE scraper');

    browser = await launchBrowser();
    const page = await createPage(browser);

    // Set NSE-required headers
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    });

    await navigateToUrl(page, NSE_URL);

    // Wait for the page to load completely
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Wait for IPO table/content to load
    try {
      await waitForSelector(page, '[data-tabid], .tab-content, table', 15000);
      logger.info('NSE page content loaded');
    } catch (error) {
      logger.warn('Tab content not found within timeout, attempting to scrape anyway');
    }

    // Extract IPO data using page.evaluate()
    const extractedData = await page.evaluate(() => {
      const ipos: any[] = [];
      const subscriptions: any[] = [];

      // NSE All Upcoming Issues page has 3 tabs:
      // 1. CURRENT ISSUES (tab-1)
      // 2. PAST ISSUES (tab-2)
      // 3. UPCOMING ISSUES (tab-3)

      // Find all tables in the page
      const tables = document.querySelectorAll('table');

      console.log(`Found ${tables.length} tables on NSE page`);

      // Process each table (each tab might have its own table)
      for (const table of Array.from(tables)) {
        const rows = table.querySelectorAll('tbody tr');

        if (rows.length === 0) continue;

        for (const row of Array.from(rows)) {
          const cells = row.querySelectorAll('td');

          // Skip empty rows
          if (cells.length < 3) continue;

          try {
            // NSE table structure can vary, but typically:
            // Company Name | Issue Type | Open Date | Close Date | Issue Size | Price Range | Listing Date | Status

            const companyName = cells[0]?.textContent?.trim() || '';
            const issueType = cells[1]?.textContent?.trim() || '';
            const openDateStr = cells[2]?.textContent?.trim() || '';
            const closeDateStr = cells[3]?.textContent?.trim() || '';
            const issueSizeStr = cells[4]?.textContent?.trim() || '';
            const priceRangeStr = cells[5]?.textContent?.trim() || '';
            const listingDateStr = cells[6]?.textContent?.trim() || '';
            const statusStr = cells[7]?.textContent?.trim() || '';

            // Skip header rows or empty data
            if (!companyName || companyName.toLowerCase().includes('company') || companyName.toLowerCase().includes('name') || companyName === '-') {
              continue;
            }

            console.log(`Processing NSE IPO: ${companyName}`);

          // Parse dates (NSE format: DD-Mon-YYYY or DD/MM/YYYY)
          const parseNSEDate = (dateStr: string): string => {
            try {
              const cleaned = dateStr.trim();

              // Handle DD-MM-YYYY format
              if (cleaned.match(/^\d{2}-\d{2}-\d{4}$/)) {
                const [day, month, year] = cleaned.split('-');
                return `${year}-${month}-${day}`;
              }

              // Handle DD-Mon-YYYY format (e.g., "06-Oct-2025")
              if (cleaned.match(/^\d{2}-[A-Za-z]{3}-\d{4}$/)) {
                const date = new Date(cleaned);
                return date.toISOString().split('T')[0];
              }

              // Fallback: try Date constructor
              const date = new Date(cleaned);
              if (!isNaN(date.getTime())) {
                return date.toISOString().split('T')[0];
              }

              // Default to current date if parsing fails
              return new Date().toISOString().split('T')[0];
            } catch (error) {
              return new Date().toISOString().split('T')[0];
            }
          };

          // Parse price range
          const parsePriceRange = (priceStr: string): { min: number; max: number } => {
            try {
              const cleaned = priceStr.trim().replace(/₹|Rs\.?|INR/gi, '').trim();

              if (cleaned === '--' || cleaned === '' || cleaned === 'N/A') {
                return { min: 0, max: 0 };
              }

              // Handle range format "100 - 120" or "100-120"
              if (cleaned.includes('-')) {
                const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                  return { min: parts[0], max: parts[1] };
                }
              }

              // Handle single price
              const price = parseFloat(cleaned);
              if (!isNaN(price)) {
                return { min: price, max: price };
              }

              return { min: 0, max: 0 };
            } catch (error) {
              return { min: 0, max: 0 };
            }
          };

          // Determine status from the status column or dates
          const openDate = parseNSEDate(openDateStr);
          const closeDate = parseNSEDate(closeDateStr);
          const listingDate = listingDateStr ? parseNSEDate(listingDateStr) : undefined;

          let status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' = 'UPCOMING';

          // First check if status is explicitly provided
          if (statusStr) {
            const statusUpper = statusStr.toUpperCase();
            if (statusUpper.includes('OPEN') || statusUpper.includes('LIVE')) {
              status = 'OPEN';
            } else if (statusUpper.includes('CLOSED')) {
              status = 'CLOSED';
            } else if (statusUpper.includes('LISTED')) {
              status = 'LISTED';
            } else if (statusUpper.includes('UPCOMING') || statusUpper.includes('FORTHCOMING')) {
              status = 'UPCOMING';
            }
          } else {
            // Fallback: determine from dates
            const today = new Date().toISOString().split('T')[0];
            if (listingDate && today >= listingDate) {
              status = 'LISTED';
            } else if (today >= openDate && today <= closeDate) {
              status = 'OPEN';
            } else if (today > closeDate) {
              status = 'CLOSED';
            }
          }

          // Parse price range
          const priceRange = parsePriceRange(priceRangeStr);

          // Parse issue size (in crores)
          const issueSize = parseFloat(issueSizeStr.trim().replace(/[^0-9.]/g, '')) || 0;

          // Determine category from issue type
          let category: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' = 'MAINBOARD';
          const issueTypeUpper = issueType.toUpperCase();
          if (issueTypeUpper.includes('SME')) {
            category = 'SME';
          } else if (issueTypeUpper.includes('RIGHTS')) {
            category = 'RIGHTS';
          } else if (issueTypeUpper.includes('DEBT') || issueTypeUpper.includes('NCD')) {
            category = 'NCD';
          }

          // Create IPO object
          const ipo = {
            companyName: companyName,
            issueSize: issueSize,
            priceRangeMin: priceRange.min,
            priceRangeMax: priceRange.max,
            openDate: openDate,
            closeDate: closeDate,
            listingDate: listingDate,
            listingExchange: 'NSE' as const,
            category: category,
            status: status,
            lotSize: undefined, // NSE doesn't always show lot size in listing
            faceValue: 10 // NSE default face value
          };

          ipos.push(ipo);
          } catch (error) {
            console.error('Error parsing NSE IPO row:', error);
          }
        }
      }

      // Note: Subscription data for NSE is typically on a separate page or requires interaction
      // For now, returning empty subscriptions array
      // Future enhancement: Navigate to individual IPO pages to extract subscription data

      return { ipos, subscriptions };
    });

    await closeBrowser(browser);
    browser = null;

    const duration = Date.now() - startTime;
    logger.info(
      {
        iposFound: extractedData.ipos.length,
        subscriptionsFound: extractedData.subscriptions.length,
        duration
      },
      'NSE scrape completed successfully'
    );

    return { ...extractedData, source: 'browser' as const };

  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        url: NSE_URL
      },
      'NSE browser scrape failed'
    );

    // Ensure browser is closed on error
    if (browser) {
      await closeBrowser(browser);
    }

    throw error;
  }
}

/**
 * Main function to scrape NSE IPO data
 * Uses API-first approach, falls back to browser automation if needed
 * @returns Promise<NSEScrapeResult> - Scraped IPO and subscription data
 */
export async function scrapeNSEIPOs(): Promise<NSEScrapeResult> {
  const startTime = Date.now();

  try {
    // First, test if API is accessible
    const apiAvailable = await testNSEAPIConnection();

    if (apiAvailable) {
      logger.info('NSE API is available, using API-first approach');

      try {
        // Try to scrape using the API
        const apiResult = await scrapeNSEAPI();

        if (apiResult.ipos.length > 0) {
          const duration = Date.now() - startTime;
          logger.info(
            {
              iposFound: apiResult.ipos.length,
              subscriptionsFound: apiResult.subscriptions.length,
              source: 'api',
              duration
            },
            'NSE scrape completed successfully using API'
          );

          return {
            ipos: apiResult.ipos,
            subscriptions: apiResult.subscriptions,
            source: 'api'
          };
        }
      } catch (apiError) {
        logger.warn(
          { error: apiError instanceof Error ? apiError.message : String(apiError) },
          'NSE API scraping failed, falling back to browser automation'
        );
      }
    }

    // Fall back to browser automation if API fails or returns no data
    logger.info('Using browser automation for NSE scraping');
    const browserResult = await scrapeNSEWithBrowser();

    const duration = Date.now() - startTime;
    logger.info(
      {
        iposFound: browserResult.ipos.length,
        subscriptionsFound: browserResult.subscriptions.length,
        source: 'browser',
        duration
      },
      'NSE scrape completed using browser automation'
    );

    return browserResult;

  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        duration
      },
      'NSE scraping failed completely (both API and browser methods)'
    );

    // Return empty result instead of throwing
    return {
      ipos: [],
      subscriptions: [],
      source: undefined
    };
  }
}

/**
 * Extract subscription data for OPEN IPOs
 * This function would parse subscription tables from NSE
 * @param page - Puppeteer page instance
 * @returns Promise<ScrapedSubscription[]>
 */
// NOTE: This is a helper function that will be implemented when actual NSE scraping is done
// For now, it's not used as the mock data doesn't include OPEN IPOs with subscriptions
