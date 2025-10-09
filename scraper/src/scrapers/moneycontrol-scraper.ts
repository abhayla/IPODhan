import logger from '../utils/logger.js';
import { scrapeWithAutoDetection, parseIndianCurrency, parseDate, sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import type { MoneycontrolIPO } from '../utils/validators.js';

const MONEYCONTROL_URL = 'https://www.moneycontrol.com/ipo/';
const TEST_SELECTOR = '.pcorporate'; // Main IPO table container

export interface MoneycontrolScraperResult {
  ipos: MoneycontrolIPO[];
  errors: string[];
}

/**
 * Scrape IPO data from Moneycontrol
 * Uses Cheerio first (static HTML), falls back to Puppeteer if needed
 * @returns Array of scraped IPO data with Moneycontrol-specific fields
 */
export async function scrapeMoneycontrolIPOs(): Promise<MoneycontrolScraperResult> {
  const result: MoneycontrolScraperResult = {
    ipos: [],
    errors: []
  };

  try {
    logger.info({ url: MONEYCONTROL_URL }, 'Starting Moneycontrol IPO scraper');

    // Scrape with auto-detection (Cheerio first, Puppeteer fallback)
    const $ = await retryWithExponentialBackoff(
      () => scrapeWithAutoDetection({
        url: MONEYCONTROL_URL,
        testSelector: TEST_SELECTOR,
        timeout: 15000
      }),
      3,
      1000
    );

    // Extract IPO listings
    const ipoRows = $('.pcorporate .bl_12').toArray();

    if (ipoRows.length === 0) {
      logger.warn('No IPO rows found on Moneycontrol page');
      result.errors.push('No IPO data found');
      return result;
    }

    logger.info({ rowCount: ipoRows.length }, 'Found IPO rows on Moneycontrol');

    // Parse each IPO row
    for (const row of ipoRows) {
      try {
        const $row = $(row);

        // Extract company name
        const companyNameEl = $row.find('a[href*="/company/"]').first();
        const companyName = sanitizeText(companyNameEl.text());

        if (!companyName) {
          logger.debug('Skipping row with no company name');
          continue;
        }

        // Extract IPO details - Moneycontrol layout varies, so we check multiple selectors
        const cells = $row.find('td, .PA7').toArray();

        // Parse issue size
        let issueSize = 0;
        const issueSizeText = $row.find('td:contains("Issue Size"), .PA7:contains("Issue Size")')
          .next()
          .text();
        if (issueSizeText) {
          issueSize = parseIndianCurrency(issueSizeText);
        }

        // Parse price range
        let priceRangeMin = 0;
        let priceRangeMax = 0;
        const priceText = $row.find('td:contains("Price Range"), .PA7:contains("Price Range")')
          .next()
          .text();
        const priceMatch = priceText.match(/(\d+)\s*-\s*(\d+)/);
        if (priceMatch) {
          priceRangeMin = parseInt(priceMatch[1], 10);
          priceRangeMax = parseInt(priceMatch[2], 10);
        }

        // Parse dates
        const dateText = $row.find('td:contains("Open"), .PA7:contains("Open")')
          .next()
          .text();
        const dates = dateText.split('-').map(d => d.trim());

        let openDate = '';
        let closeDate = '';
        if (dates.length >= 2) {
          openDate = parseDate(dates[0]);
          closeDate = parseDate(dates[1]);
        }

        // Determine status based on dates
        let status: 'UPCOMING' | 'LIVE' | 'CLOSED' | 'LISTED' = 'UPCOMING';
        const now = new Date();
        if (openDate && closeDate) {
          const open = new Date(openDate);
          const close = new Date(closeDate);

          if (now >= open && now <= close) {
            status = 'LIVE';
          } else if (now > close) {
            status = 'CLOSED';
          }
        }

        // Extract rating (Moneycontrol's IPO rating)
        let rating: number | undefined;
        const ratingEl = $row.find('.star-rating, [class*="rating"]');
        const ratingText = ratingEl.text().trim();
        const ratingMatch = ratingText.match(/([\d.]+)/);
        if (ratingMatch) {
          rating = parseFloat(ratingMatch[1]);
          if (rating < 0 || rating > 5) rating = undefined;
        }

        // Extract listing gains expectation
        let listingGains: number | undefined;
        const gainsText = $row.find('td:contains("Listing Gains"), .PA7:contains("Listing Gains")')
          .next()
          .text();
        const gainsMatch = gainsText.match(/([-+]?[\d.]+)%?/);
        if (gainsMatch) {
          listingGains = parseFloat(gainsMatch[1]);
        }

        // Extract subscription data
        let totalSubscription = 0;
        const subscriptionText = $row.find('td:contains("Subscription"), .PA7:contains("Subscription")')
          .next()
          .text();
        const subscriptionMatch = subscriptionText.match(/([\d.]+)x?/i);
        if (subscriptionMatch) {
          totalSubscription = parseFloat(subscriptionMatch[1]);
        }

        // Determine exchange - default to BOTH for Moneycontrol aggregates
        const listingExchange: 'NSE' | 'BSE' | 'BOTH' = 'BOTH';

        // Determine category - default to MAINBOARD
        let category: 'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' = 'MAINBOARD';
        const categoryText = $row.text().toLowerCase();
        if (categoryText.includes('sme')) {
          category = 'SME';
        } else if (categoryText.includes('rights')) {
          category = 'RIGHTS';
        } else if (categoryText.includes('ncd') || categoryText.includes('bond')) {
          category = 'NCD';
        }

        // Validate required fields
        if (!companyName || !openDate || !closeDate || issueSize === 0) {
          logger.debug(
            { companyName, issueSize, openDate, closeDate },
            'Skipping IPO with missing required fields'
          );
          continue;
        }

        const ipo: MoneycontrolIPO = {
          companyName: sanitizeText(companyName),
          issueSize,
          priceRangeMin: priceRangeMin || 0,
          priceRangeMax: priceRangeMax || priceRangeMin || 0,
          openDate,
          closeDate,
          listingExchange,
          category,
          status,
          dataSource: 'MONEYCONTROL',
          rating,
          listingGains,
        };

        result.ipos.push(ipo);

        logger.debug({ companyName: ipo.companyName }, 'Successfully parsed Moneycontrol IPO');

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMsg }, 'Failed to parse Moneycontrol IPO row');
        result.errors.push(`Row parsing error: ${errorMsg}`);
      }
    }

    logger.info(
      { iposScraped: result.ipos.length, errors: result.errors.length },
      'Moneycontrol scraper completed'
    );

    return result;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorMsg }, 'Moneycontrol scraper failed');
    result.errors.push(`Scraper error: ${errorMsg}`);
    return result;
  }
}
