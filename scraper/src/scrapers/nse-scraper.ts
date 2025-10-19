import type { Browser } from 'puppeteer';
import { launchBrowser, createPage, closeBrowser, navigateToUrl, waitForSelector } from '../utils/browser.js';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { scrapeNSEAPI, testNSEAPIConnection } from './nse-api-client.js';
import { detectOfferingType, detectSegmentFromExchange } from '../utils/detect-offering-type.js';

const NSE_URL = config.scraper.nseUrl;

export interface NSEScrapeResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  source?: 'api' | 'browser' | 'fallback';
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

    // Task 8: Tab Navigation Implementation (AC5)
    // NSE All Upcoming Issues page has 3 tabs: CURRENT, PAST, UPCOMING
    const allIPOs: any[] = [];

    logger.info('Starting tab navigation for NSE IPO scraping (AC5, Task 8)');

    // Iterate through all tabs (tab-1, tab-2, tab-3)
    for (let tabIndex = 1; tabIndex <= 3; tabIndex++) {
      try {
        logger.debug({ tabIndex }, `Clicking tab ${tabIndex}`);

        // Click the tab
        await page.click(`[data-tabid="tab-${tabIndex}"]`).catch(() => {
          logger.warn({ tabIndex }, `Tab ${tabIndex} not found, trying alternative selector`);
        });

        // Wait for tab content to load (2 seconds as per story requirements)
        await new Promise(resolve => setTimeout(resolve, 2000));

        logger.debug({ tabIndex }, `Extracting IPOs from tab ${tabIndex}`);

        // Extract IPO data from current tab
        const tabIPOs = await page.evaluate(() => {
          const ipos: any[] = [];

          // Find all tables in the active tab
          const tables = document.querySelectorAll('table');

          console.log(`Found ${tables.length} tables in current tab`);

          // Process each table
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

          // Story 11.8: Detect segment and offering type
          const listingExchanges = ['NSE']; // NSE scraper always returns NSE listings
          const segment = detectSegmentFromExchange(listingExchanges);
          const offeringType = detectOfferingType({
            symbol: companyName, // Use company name as fallback if symbol not available
            bseType: undefined,
            issueType: issueType
          });

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
            segment: segment as 'MAINBOARD' | 'SME',
            offeringType: offeringType as 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'BUYBACK' | 'DELISTING' | 'TENDER' | 'NCD' | 'BONDS',
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

          return ipos;
        });

        // Add IPOs from this tab to the master list
        allIPOs.push(...tabIPOs);
        logger.info({ tabIndex, iposFound: tabIPOs.length }, `Tab ${tabIndex} scraped successfully (AC5)`);

      } catch (error) {
        logger.error({
          tabIndex,
          error: error instanceof Error ? error.message : String(error)
        }, `Failed to scrape tab ${tabIndex}`);
      }
    }

    logger.info({ totalIPOs: allIPOs.length }, 'All tabs scraped, combining results (AC5, Task 8)');

    // Task 10: Browser Fallback Integration - Extract subscriptions for OPEN IPOs (AC5)
    const subscriptions: ScrapedSubscription[] = [];
    const openIPOs = allIPOs.filter(ipo => ipo.status === 'OPEN');

    logger.info({ openIPOCount: openIPOs.length }, 'Extracting subscription data for OPEN IPOs (AC5, Task 10)');

    for (const ipo of openIPOs) {
      if (!ipo.symbol) {
        logger.warn({ companyName: ipo.companyName }, 'IPO missing symbol, skipping subscription extraction');
        continue;
      }

      try {
        const subscription = await scrapeNSESubscriptions(browser, ipo.symbol, ipo.companyName);
        if (subscription) {
          subscriptions.push(subscription);
        }
      } catch (error) {
        logger.error({
          symbol: ipo.symbol,
          companyName: ipo.companyName,
          error: error instanceof Error ? error.message : String(error)
        }, 'Failed to extract subscription data for IPO');
      }
    }

    await closeBrowser(browser);
    browser = null;

    const duration = Date.now() - startTime;
    logger.info(
      {
        iposFound: allIPOs.length,
        subscriptionsFound: subscriptions.length,
        openIPOs: openIPOs.length,
        duration
      },
      'NSE browser scrape completed successfully (AC5, Task 10)'
    );

    return { ipos: allIPOs, subscriptions, source: 'browser' as const };

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

// Track consecutive API failures for fallback trigger (Task 11, AC2, AC5)
let consecutiveAPIFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Main function to scrape NSE IPO data
 * Enhanced for Story 11.3 - automatic browser fallback after 3 API failures (AC2, AC5, AC6, AC7, Task 11, Task 13)
 * Uses API-first approach, falls back to browser automation if needed
 * @returns Promise<NSEScrapeResult> - Scraped IPO and subscription data
 */
export async function scrapeNSEIPOs(): Promise<NSEScrapeResult> {
  const startTime = Date.now();

  try {
    // Task 11: Check if browser fallback should be triggered (AC2, AC5)
    if (consecutiveAPIFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.warn({
        consecutiveFailures: consecutiveAPIFailures,
        maxFailures: MAX_CONSECUTIVE_FAILURES
      }, 'API failure threshold reached, activating browser fallback (AC5, Task 11)');

      // Fall back to browser immediately
      const browserResult = await scrapeNSEWithBrowser();

      const duration = Date.now() - startTime;
      const coverage = calculateSubscriptionCoverage(browserResult);

      // Task 13: Log monitoring metrics (AC6, AC7)
      logger.info(
        {
          iposFound: browserResult.ipos.length,
          subscriptionsFound: browserResult.subscriptions.length,
          openIPOs: browserResult.ipos.filter(ipo => ipo.status === 'OPEN').length,
          coverage: `${coverage.percentage.toFixed(2)}%`,
          source: 'browser',
          duration,
          fallbackTriggered: true
        },
        'NSE scrape completed using browser fallback (AC6, AC7, Task 13)'
      );

      return browserResult;
    }

    // First, test if API is accessible
    const apiAvailable = await testNSEAPIConnection();

    if (apiAvailable) {
      logger.info('NSE API is available, using API-first approach');

      try {
        // Try to scrape using the API
        const apiResult = await scrapeNSEAPI();

        if (apiResult.ipos.length > 0) {
          // Reset failure count on successful API call (Task 11, AC2, AC5)
          consecutiveAPIFailures = 0;

          const duration = Date.now() - startTime;
          const coverage = calculateSubscriptionCoverage(apiResult);

          // Task 13: Log monitoring metrics (AC6, AC7)
          logger.info(
            {
              iposFound: apiResult.ipos.length,
              subscriptionsFound: apiResult.subscriptions.length,
              openIPOs: apiResult.ipos.filter(ipo => ipo.status === 'OPEN').length,
              coverage: `${coverage.percentage.toFixed(2)}%`,
              coverageTarget: '100%',
              source: 'api',
              duration,
              consecutiveFailures: consecutiveAPIFailures
            },
            'NSE scrape completed successfully using API (AC6, AC7, Task 13)'
          );

          return {
            ipos: apiResult.ipos,
            subscriptions: apiResult.subscriptions,
            source: 'api'
          };
        }
      } catch (apiError) {
        // Increment failure counter (Task 11, AC2, AC5)
        consecutiveAPIFailures++;

        logger.warn(
          {
            error: apiError instanceof Error ? apiError.message : String(apiError),
            consecutiveFailures: consecutiveAPIFailures,
            maxFailures: MAX_CONSECUTIVE_FAILURES,
            willTriggerFallback: consecutiveAPIFailures >= MAX_CONSECUTIVE_FAILURES
          },
          'NSE API scraping failed, falling back to browser automation (AC5, Task 11)'
        );
      }
    } else {
      // Increment failure counter if API not available
      consecutiveAPIFailures++;
      logger.warn({
        consecutiveFailures: consecutiveAPIFailures,
        maxFailures: MAX_CONSECUTIVE_FAILURES
      }, 'NSE API not available (AC2)');
    }

    // Fall back to browser automation if API fails or returns no data
    logger.info('Using browser automation for NSE scraping');
    const browserResult = await scrapeNSEWithBrowser();

    const duration = Date.now() - startTime;
    const coverage = calculateSubscriptionCoverage(browserResult);

    // Task 13: Log monitoring metrics (AC6, AC7)
    logger.info(
      {
        iposFound: browserResult.ipos.length,
        subscriptionsFound: browserResult.subscriptions.length,
        openIPOs: browserResult.ipos.filter(ipo => ipo.status === 'OPEN').length,
        coverage: `${coverage.percentage.toFixed(2)}%`,
        source: 'browser',
        duration,
        consecutiveAPIFailures
      },
      'NSE scrape completed using browser automation (AC6, AC7, Task 13)'
    );

    return browserResult;

  } catch (error) {
    // Increment failure counter on complete failure
    consecutiveAPIFailures++;

    const duration = Date.now() - startTime;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        duration,
        consecutiveFailures: consecutiveAPIFailures
      },
      'NSE scraping failed completely (both API and browser methods) (AC7)'
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
 * Calculate subscription coverage percentage
 * Task 13: Monitoring metrics (AC6, AC7)
 * @param result - Scrape result with IPOs and subscriptions
 * @returns Coverage statistics
 */
function calculateSubscriptionCoverage(result: NSEScrapeResult): {
  openIPOs: number;
  withSubscriptions: number;
  percentage: number;
} {
  const openIPOs = result.ipos.filter(ipo => ipo.status === 'OPEN');
  const openIPOCount = openIPOs.length;
  const subscriptionsCount = result.subscriptions.length;

  const percentage = openIPOCount > 0 ? (subscriptionsCount / openIPOCount) * 100 : 0;

  return {
    openIPOs: openIPOCount,
    withSubscriptions: subscriptionsCount,
    percentage
  };
}

/**
 * Extract subscription data for a specific IPO from NSE detail page
 * Enhanced for Story 11.3 - browser fallback for subscription data (AC5, Task 9)
 * @param browser - Puppeteer browser instance
 * @param symbol - IPO symbol
 * @param companyName - IPO company name
 * @returns Promise<ScrapedSubscription | null>
 */
async function scrapeNSESubscriptions(
  browser: Browser,
  symbol: string,
  companyName: string
): Promise<ScrapedSubscription | null> {
  try {
    logger.debug({ symbol, companyName }, 'Scraping subscription data from NSE detail page (AC5)');

    const page = await createPage(browser);

    // Navigate to NSE IPO detail page
    const detailUrl = `https://www.nseindia.com/companies-listing/corporate-filings-ipo-detail?symbol=${symbol}`;
    await navigateToUrl(page, detailUrl);

    // Wait for subscription table to load
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Extract subscription data from HTML table
    const subscriptionData = await page.evaluate((compName, sym) => {
      // Find subscription table (look for table with subscription data)
      const tables = document.querySelectorAll('table');
      let subscriptionTable: Element | null = null;

      for (const table of Array.from(tables)) {
        const tableText = table.textContent || '';
        if (tableText.includes('QIB') || tableText.includes('NII') || tableText.includes('Retail') ||
            tableText.includes('Qualified Institutional') || tableText.includes('Non Institutional')) {
          subscriptionTable = table;
          break;
        }
      }

      if (!subscriptionTable) {
        console.log('No subscription table found');
        return null;
      }

      // Initialize subscription object
      const subscription: any = {
        ipoCompanyName: compName,
        ipoSymbol: sym,
        qibSubscription: 0,
        niiSubscription: 0,
        retailSubscription: 0,
        totalSubscription: 0,
        timestamp: new Date().toISOString()
      };

      // Parse table rows
      const rows = subscriptionTable.querySelectorAll('tbody tr');
      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue;

        const category = cells[0]?.textContent?.trim().toUpperCase() || '';
        const subscriptionText = cells[cells.length - 1]?.textContent?.trim() || '';

        // Parse "times subscribed" value (e.g., "5.23x" or "5.23 times")
        const subscriptionMatch = subscriptionText.match(/([\d.]+)/);
        if (!subscriptionMatch) continue;

        const timesSubscribed = parseFloat(subscriptionMatch[1]);
        if (isNaN(timesSubscribed)) continue;

        // Map category to subscription fields (AC5)
        if (category.includes('QIB') || category.includes('QUALIFIED INSTITUTIONAL')) {
          subscription.qibSubscription = timesSubscribed;
        } else if (category.includes('NII') || category.includes('NON-INSTITUTIONAL') || category.includes('NON INSTITUTIONAL')) {
          subscription.niiSubscription = timesSubscribed;
        } else if (category.includes('RETAIL') || category.includes('RII') || category.includes('INDIVIDUAL')) {
          subscription.retailSubscription = timesSubscribed;
        } else if (category.includes('EMPLOYEE')) {
          subscription.employeeSubscription = timesSubscribed;
        } else if (category.includes('TOTAL') || category.includes('OVERALL')) {
          subscription.totalSubscription = timesSubscribed;
        }
      }

      // Calculate total if not found
      if (subscription.totalSubscription === 0) {
        subscription.totalSubscription = Math.max(
          subscription.qibSubscription,
          subscription.niiSubscription,
          subscription.retailSubscription
        );
      }

      // Return null if no valid data found
      if (subscription.qibSubscription === 0 &&
          subscription.niiSubscription === 0 &&
          subscription.retailSubscription === 0) {
        return null;
      }

      return subscription;
    }, companyName, symbol);

    await page.close();

    if (!subscriptionData) {
      logger.warn({ symbol, companyName }, 'No subscription data found on NSE detail page');
      return null;
    }

    logger.debug({
      symbol,
      qib: subscriptionData.qibSubscription,
      nii: subscriptionData.niiSubscription,
      retail: subscriptionData.retailSubscription,
      total: subscriptionData.totalSubscription
    }, 'Subscription data scraped from browser (AC5)');

    return subscriptionData as ScrapedSubscription;

  } catch (error) {
    logger.error({
      symbol,
      companyName,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to scrape subscription data from NSE detail page');
    return null;
  }
}
