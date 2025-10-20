/**
 * Moneycontrol IPO Scraper - Rewritten for new React/Next.js page (2025-10-17)
 *
 * Page Structure Changes:
 * - Old: Static HTML with .pcorporate and .bl_12 classes
 * - New: JavaScript-rendered React app with CSS Modules
 * - Requires: Puppeteer (not Cheerio) due to client-side rendering
 * - Sections: Closed IPO, Listed IPO, Draft IPO (each in separate tables)
 * - Dynamic: "Show More" buttons load additional IPOs
 */

import type { Browser, Page } from 'puppeteer';
import { launchBrowser, createPage, closeBrowser, navigateToUrl } from '../utils/browser.js';
import logger from '../utils/logger.js';
import type { MoneycontrolIPO } from '../utils/validators.js';
import { sanitizeText } from '../utils/scraper-utils.js';

const MONEYCONTROL_URL = 'https://www.moneycontrol.com/ipo/';

export interface MoneycontrolScraperResult {
  ipos: MoneycontrolIPO[];
  errors: string[];
}

/**
 * Parse Indian currency format (₹ 2,517.50 Cr)
 */
function parseMoneycontrolCurrency(text: string): number {
  if (!text || text === '-') return 0;

  const cleaned = text.replace(/[₹,\s]/g, '').toLowerCase();
  const match = cleaned.match(/([\d.]+)(cr|crore|lakh)?/);

  if (!match) return 0;

  const num = parseFloat(match[1]);
  const unit = match[2];

  if (unit === 'cr' || unit === 'crore') {
    return num * 10000000; // 1 Crore = 10 Million
  } else if (unit === 'lakh') {
    return num * 100000; // 1 Lakh = 100 Thousand
  }

  return num;
}

/**
 * Parse Moneycontrol date format (17 Oct 25)
 */
function parseMoneycontrolDate(text: string): string {
  if (!text || text === '-') return '';

  try {
    // Format: "17 Oct 25"
    const cleaned = text.trim();
    const date = new Date(cleaned);

    if (isNaN(date.getTime())) {
      return '';
    }

    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
}

/**
 * Scrape IPO data from Moneycontrol using Puppeteer
 * Handles new React/Next.js page with dynamic loading
 */
export async function scrapeMoneycontrolIPOs(): Promise<MoneycontrolScraperResult> {
  const result: MoneycontrolScraperResult = {
    ipos: [],
    errors: []
  };

  let browser: Browser | null = null;

  try {
    logger.info({ url: MONEYCONTROL_URL }, 'Starting Moneycontrol IPO scraper (new Puppeteer version)');

    browser = await launchBrowser();
    const page = await createPage(browser);

    await navigateToUrl(page, MONEYCONTROL_URL);

    // Wait for tables to load
    await page.waitForSelector('table', { timeout: 15000 });
    logger.debug('Tables loaded on Moneycontrol page');

    // Click all "Show More" buttons to load all IPOs
    try {
      const showMoreButtons = await page.$$('button[class*="showMoreBtn"]');
      logger.info({ buttonCount: showMoreButtons.length }, 'Found Show More buttons');

      for (const button of showMoreButtons) {
        await button.click();
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for data to load
      }

      if (showMoreButtons.length > 0) {
        logger.info('Clicked all Show More buttons, waiting for data');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Final wait for all data
      }
    } catch (error) {
      logger.warn('No Show More buttons found or error clicking them');
    }

    // Extract IPO data from page
    const extractedData = await page.evaluate(() => {
      const ipos: any[] = [];

      // Find all tables
      const tables = document.querySelectorAll('table');

      for (const table of Array.from(tables)) {
        // Find section heading to identify table type
        const section = table.closest('section');
        const heading = section?.querySelector('h2')?.textContent?.trim() || '';

        // Skip non-IPO tables
        if (!heading.includes('IPO')) {
          continue;
        }

        const tableType = heading.includes('Closed') ? 'CLOSED' :
                         heading.includes('Listed') ? 'LISTED' :
                         heading.includes('Draft') ? 'DRAFT' : 'UNKNOWN';

        console.log(`Processing ${tableType} IPO table`);

        const rows = table.querySelectorAll('tbody tr');

        for (const row of Array.from(rows)) {
          try {
            const cells = row.querySelectorAll('td');

            if (cells.length === 0) continue;

            // Extract company name and link (always in first cell)
            const companyLink = cells[0]?.querySelector('a');
            const companyName = companyLink?.textContent?.trim() || '';
            const companyUrl = companyLink?.getAttribute('href') || '';

            if (!companyName) continue;

            // Extract category (second cell)
            const category = cells[1]?.textContent?.trim().toUpperCase() || '';

            let ipoData: any = {
              companyName,
              companyUrl,
              category: category.includes('SME') ? 'SME' : 'MAINBOARD',
              tableType
            };

            // Parse based on table type
            if (tableType === 'CLOSED') {
              // Closed IPO Table columns:
              // 0: Company, 1: Category, 2: Issue Price, 3: QIB, 4: NII, 5: Retail,
              // 6: Total Subscription, 7: Allotment Date, 8: Refund Date,
              // 9: Demat Credit, 10: Listing Date, 11: Allotment Status
              ipoData.issuePrice = cells[2]?.textContent?.trim() || '';
              ipoData.qibSubscription = cells[3]?.textContent?.trim() || '';
              ipoData.niiSubscription = cells[4]?.textContent?.trim() || '';
              ipoData.retailSubscription = cells[5]?.textContent?.trim() || '';
              ipoData.totalSubscription = cells[6]?.textContent?.trim() || '';
              ipoData.allotmentDate = cells[7]?.textContent?.trim() || '';
              ipoData.listingDate = cells[10]?.textContent?.trim() || '';
              ipoData.status = 'CLOSED';
            } else if (tableType === 'LISTED') {
              // Listed IPO Table columns:
              // 0: Company, 1: Category, 2: Listing Date, 3: Issue Price, 4: Total Subscription,
              // 5: Listing Open, 6: Listing Close, 7: Listing Gain %, 8: LTP, 9: Current Gain,
              // 10: Issue Size
              ipoData.listingDate = cells[2]?.textContent?.trim() || '';
              ipoData.issuePrice = cells[3]?.textContent?.trim() || '';
              ipoData.totalSubscription = cells[4]?.textContent?.trim() || '';
              ipoData.listingGain = cells[7]?.textContent?.trim() || '';
              ipoData.issueSize = cells[10]?.textContent?.trim() || '';
              ipoData.status = 'LISTED';
            } else if (tableType === 'DRAFT') {
              // Draft IPO table (if present) - structure TBD
              ipoData.status = 'UPCOMING';
            }

            ipos.push(ipoData);

          } catch (error) {
            console.error('Error parsing row:', error);
          }
        }
      }

      return ipos;
    });

    logger.info({ extractedCount: extractedData.length }, 'Extracted IPOs from Moneycontrol');

    // Transform extracted data to MoneycontrolIPO format
    for (const raw of extractedData) {
      try {
        // Parse issue price (₹ 106)
        const issuePriceMatch = raw.issuePrice?.match(/([\d.]+)/);
        const issuePrice = issuePriceMatch ? parseFloat(issuePriceMatch[1]) : 0;

        // Parse issue size (₹ 2,517.50 Cr)
        const issueSize = parseMoneycontrolCurrency(raw.issueSize || '');

        // Parse subscription (2.29x or 2.29)
        const subscriptionMatch = raw.totalSubscription?.match(/([\d.]+)/);
        const totalSubscription = subscriptionMatch ? parseFloat(subscriptionMatch[1]) : 0;

        // Parse dates
        const listingDate = parseMoneycontrolDate(raw.listingDate);
        const allotmentDate = parseMoneycontrolDate(raw.allotmentDate);

        // Parse listing gain (percentage)
        const listingGainMatch = raw.listingGain?.match(/([-+]?[\d.]+)/);
        const listingGains = listingGainMatch ? parseFloat(listingGainMatch[1]) : undefined;

        // Determine status
        let status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' = raw.status || 'UPCOMING';

        // Calculate open/close dates if not available (for LISTED/CLOSED IPOs)
        // Use listingDate to estimate: closeDate = listingDate - 3 days, openDate = closeDate - 7 days
        let openDate = '';
        let closeDate = '';

        if (listingDate) {
          const listingDateObj = new Date(listingDate);

          // Estimate closeDate as 3 days before listing
          const closeDateObj = new Date(listingDateObj);
          closeDateObj.setDate(closeDateObj.getDate() - 3);
          closeDate = closeDateObj.toISOString().split('T')[0];

          // Estimate openDate as 7 days before closeDate (typical IPO duration)
          const openDateObj = new Date(closeDateObj);
          openDateObj.setDate(openDateObj.getDate() - 7);
          openDate = openDateObj.toISOString().split('T')[0];
        } else if (allotmentDate) {
          // If no listingDate but have allotmentDate, use that
          const allotmentDateObj = new Date(allotmentDate);

          // Estimate closeDate as 2 days before allotment
          const closeDateObj = new Date(allotmentDateObj);
          closeDateObj.setDate(closeDateObj.getDate() - 2);
          closeDate = closeDateObj.toISOString().split('T')[0];

          // Estimate openDate as 7 days before closeDate
          const openDateObj = new Date(closeDateObj);
          openDateObj.setDate(openDateObj.getDate() - 7);
          openDate = openDateObj.toISOString().split('T')[0];
        } else {
          // No dates available - use current date as fallback
          const now = new Date();
          closeDate = now.toISOString().split('T')[0];

          const sevenDaysAgo = new Date(now);
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
          openDate = sevenDaysAgo.toISOString().split('T')[0];
        }

        // Detect segment (MAINBOARD vs SME)
        const segment = raw.category === 'SME' ? 'SME' : 'MAINBOARD';

        // Detect offering type (default to IPO for Moneycontrol data)
        const offeringType = 'IPO'; // Moneycontrol primarily lists equity IPOs

        const ipo: MoneycontrolIPO = {
          companyName: sanitizeText(raw.companyName),
          issueSize,
          priceRangeMin: issuePrice,
          priceRangeMax: issuePrice,
          openDate,
          closeDate,
          listingExchange: 'BOTH', // Moneycontrol aggregates both exchanges
          segment: segment as 'MAINBOARD' | 'SME',
          offeringType: offeringType as 'IPO',
          status,
          dataSource: 'MONEYCONTROL',
          listingGains,
        };

        result.ipos.push(ipo);

        // DEBUG: Log parsed IPO with offering type
        logger.debug({
          companyName: ipo.companyName,
          status: ipo.status,
          issueSize: ipo.issueSize,
          segment: ipo.segment,
          offeringType: ipo.offeringType,
          rawCategory: raw.category
        }, '[MONEYCONTROL DEBUG] Successfully parsed IPO');

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ companyName: raw.companyName, error: errorMsg }, 'Failed to transform Moneycontrol IPO');
        result.errors.push(`Transform error for ${raw.companyName}: ${errorMsg}`);
      }
    }

    await closeBrowser(browser);
    browser = null;

    logger.info(
      { iposScraped: result.ipos.length, errors: result.errors.length },
      'Moneycontrol scraper completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Moneycontrol scraper failed');
    result.errors.push(`Scraper error: ${errorMsg}`);

    if (browser) {
      await closeBrowser(browser);
    }

    return result;
  }
}
