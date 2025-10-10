import logger from '../utils/logger.js';
import { scrapeWithCheerio, parseIndianCurrency, parseDate, sanitizeText, retryWithExponentialBackoff } from '../utils/scraper-utils.js';
import { validateGMP } from '../utils/validators.js';
import type { ChittorgarhIPO } from '../utils/validators.js';

const CHITTORGARH_URL = 'https://www.chittorgarh.com/ipo/ipo_list.asp';

export interface ChittorgarhScraperResult {
  ipos: ChittorgarhIPO[];
  errors: string[];
}

/**
 * Scrape IPO data from Chittorgarh including GMP (Grey Market Premium)
 * Uses Cheerio (static HTML - Chittorgarh has simple table structure)
 * @returns Array of scraped IPO data with GMP information
 */
export async function scrapeChittorgarhIPOs(): Promise<ChittorgarhScraperResult> {
  const result: ChittorgarhScraperResult = {
    ipos: [],
    errors: []
  };

  try {
    logger.info({ url: CHITTORGARH_URL }, 'Starting Chittorgarh IPO scraper');

    // Scrape with Cheerio (Chittorgarh uses static HTML tables)
    const $ = await retryWithExponentialBackoff(
      () => scrapeWithCheerio(CHITTORGARH_URL),
      3,
      1000
    );

    // Extract IPO table rows
    const ipoRows = $('table.table tr').toArray();

    if (ipoRows.length === 0) {
      logger.warn('No IPO rows found on Chittorgarh page');
      result.errors.push('No IPO data found');
      return result;
    }

    logger.info({ rowCount: ipoRows.length }, 'Found IPO rows on Chittorgarh');

    // Parse each IPO row (skip header row)
    for (let i = 1; i < ipoRows.length; i++) {
      try {
        const $row = $(ipoRows[i]);
        const cells = $row.find('td').toArray();

        if (cells.length < 6) {
          continue; // Skip incomplete rows
        }

        // Chittorgarh table structure (approximate):
        // [0] Company Name | [1] Issue Size | [2] Price Range | [3] Open-Close | [4] GMP | [5] Subscription

        // Extract company name
        const companyName = sanitizeText($(cells[0]).text());
        if (!companyName) continue;

        // Extract issue size
        const issueSizeText = $(cells[1]).text();
        const issueSize = parseIndianCurrency(issueSizeText);

        // Extract price range
        const priceText = sanitizeText($(cells[2]).text());
        const priceMatch = priceText.match(/₹?\s*(\d+)\s*-\s*(\d+)/);
        let priceRangeMin = 0;
        let priceRangeMax = 0;
        if (priceMatch) {
          priceRangeMin = parseInt(priceMatch[1], 10);
          priceRangeMax = parseInt(priceMatch[2], 10);
        }

        // Extract open and close dates
        const dateText = sanitizeText($(cells[3]).text());
        // Split on ' - ' (with spaces) or ' to ' to avoid splitting date components
        const dateParts = dateText.split(/\s+-\s+|\s+to\s+/i);
        let openDate = '';
        let closeDate = '';
        if (dateParts.length >= 2) {
          openDate = parseDate(dateParts[0].trim());
          closeDate = parseDate(dateParts[1].trim());
        } else if (dateParts.length === 1) {
          // Sometimes only one date is shown
          openDate = parseDate(dateParts[0].trim());
          closeDate = openDate;
        }

        // Extract GMP (Grey Market Premium) - KEY FEATURE OF CHITTORGARH
        let gmp: number | undefined;
        let gmpPercentage: number | undefined;
        const gmpText = sanitizeText($(cells[4]).text());
        const gmpMatch = gmpText.match(/₹?\s*([-+]?\d+)/);
        if (gmpMatch) {
          gmp = parseInt(gmpMatch[1], 10);

          // Calculate GMP percentage if we have price range
          if (priceRangeMax > 0 && gmp !== undefined) {
            gmpPercentage = (gmp / priceRangeMax) * 100;

            // Validate GMP using validation function
            if (!validateGMP(gmp, priceRangeMax)) {
              logger.warn(
                { companyName, gmp, gmpPercentage, priceRangeMax },
                'Suspicious GMP value detected, setting to undefined'
              );
              gmp = undefined;
              gmpPercentage = undefined;
            }
          }
        }

        const gmpUpdatedAt = gmp !== undefined ? new Date().toISOString() : undefined;

        // Extract subscription data
        let totalSubscription = 0;
        if (cells.length > 5) {
          const subscriptionText = sanitizeText($(cells[5]).text());
          const subscriptionMatch = subscriptionText.match(/([\d.]+)x?/i);
          if (subscriptionMatch) {
            totalSubscription = parseFloat(subscriptionMatch[1]);
          }
        }

        // Determine status based on dates
        let status: 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' = 'UPCOMING';
        if (openDate && closeDate) {
          const now = new Date();
          const open = new Date(openDate);
          const close = new Date(closeDate);

          if (now >= open && now <= close) {
            status = 'OPEN';
          } else if (now > close) {
            status = 'CLOSED';
          }
        }

        // Determine exchange - default to BOTH
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

        // Extract lot size if available
        let lotSize: number | undefined;
        const lotSizeText = $row.text();
        const lotMatch = lotSizeText.match(/lot[:\s]*(\d+)/i);
        if (lotMatch) {
          lotSize = parseInt(lotMatch[1], 10);
        }

        // Validate required fields
        if (!companyName || !openDate || !closeDate) {
          logger.debug(
            { companyName, openDate, closeDate },
            'Skipping IPO with missing required fields'
          );
          continue;
        }

        const ipo: ChittorgarhIPO = {
          companyName: sanitizeText(companyName),
          issueSize: issueSize || 0,
          priceRangeMin: priceRangeMin || 0,
          priceRangeMax: priceRangeMax || priceRangeMin || 0,
          openDate,
          closeDate,
          listingExchange,
          category,
          status,
          lotSize,
          dataSource: 'CHITTORGARH',
          gmp,
          gmpPercentage,
          gmpUpdatedAt,
        };

        result.ipos.push(ipo);

        logger.debug(
          { companyName: ipo.companyName, gmp: ipo.gmp, gmpPercentage: ipo.gmpPercentage },
          'Successfully parsed Chittorgarh IPO with GMP data'
        );

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn({ error: errorMsg }, 'Failed to parse Chittorgarh IPO row');
        result.errors.push(`Row parsing error: ${errorMsg}`);
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
