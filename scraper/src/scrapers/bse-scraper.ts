/**
 * BSE Scraper Implementation
 *
 * PARSING APPROACH DECISION (Evaluated: 2025-10-08)
 * ==================================================
 * Technology: Puppeteer (JavaScript-rendered content)
 *
 * Evidence:
 * 1. View Source Test: BSE page contains IPO table data in initial HTML render
 * 2. Network Tab Analysis: Page uses ASP.NET postbacks (__doPostBack) for dynamic content
 * 3. JavaScript Dependency: Subscription data loaded via JavaScript interactions and popups
 *
 * Rationale:
 * - BSE uses ASP.NET with JavaScript postbacks for subscription data
 * - While basic IPO list is in static HTML, subscription data requires JavaScript execution
 * - Consistency with NSE scraper (Puppeteer already configured)
 * - More reliable for complex page interactions and future-proofing
 * - Can handle all modern web scenarios including potential structure changes
 *
 * Trade-offs Accepted:
 * - Slower than Cheerio (3-5s browser launch vs <1s HTML fetch)
 * - Higher memory usage (~100MB vs ~10MB)
 * - Still meets <60s performance target for typical data volume
 */

import type { Browser, Page } from 'puppeteer';
import { launchBrowser, createPage, closeBrowser, navigateToUrl, waitForSelector } from '../utils/browser.js';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { scrapeBSEIPODetails, type BSEDetailPageData } from './bse-detail-scraper.js';
import {
  enrichRightsIssuesFromChittorgarh,
  enrichDebtIssuesFromChittorgarh,
} from './rights-debt-enrichment-scraper.js';
import {
  fetchRightsIssuesFromChittorgarh,
  fetchDebtIssuesFromChittorgarh,
} from './chittorgarh-rights-debt-adapter.js';
import { detectOfferingType, detectSegmentFromExchange } from '../utils/detect-offering-type.js';

const BSE_URL = config.scraper.bseUrl;

export interface BSEScrapeResult {
  ipos: ScrapedIPO[];
  subscriptions: ScrapedSubscription[];
  smeCount: number;
  mainboardCount: number;
}

// Story 11.8: Removed extractCategory function - now using detectSegmentFromExchange and detectOfferingType

/**
 * Extract IPO status from BSE issue status field
 * @param issueStatus - Issue status string from BSE
 * @returns IPO status enum value
 */
function extractStatus(issueStatus: string): 'UPCOMING' | 'OPEN' | 'CLOSED' | 'LISTED' {
  const normalized = issueStatus.trim().toUpperCase();

  if (normalized.includes('LIVE') || normalized.includes('OPEN')) {
    return 'OPEN';
  } else if (normalized.includes('FORTHCOMING') || normalized.includes('UPCOMING')) {
    return 'UPCOMING';
  } else if (normalized.includes('CLOSED')) {
    return 'CLOSED';
  } else if (normalized.includes('LISTED')) {
    return 'LISTED';
  }

  // Default to UPCOMING for unrecognized status
  return 'UPCOMING';
}

/**
 * Parse date string from BSE format (DD-MM-YYYY) to ISO 8601
 * @param dateStr - Date string in BSE format
 * @returns ISO 8601 date string
 */
function parseBSEDate(dateStr: string): string {
  try {
    // BSE format: "16-10-2025" (DD-MM-YYYY) or "06/Oct/2025"
    const cleaned = dateStr.trim();

    // Handle DD-MM-YYYY format (e.g., "16-10-2025")
    if (cleaned.match(/^\d{2}-\d{2}-\d{4}$/)) {
      const [day, month, year] = cleaned.split('-');
      return `${year}-${month}-${day}`;
    }

    // Handle DD/MMM/YYYY format (e.g., "06/Oct/2025")
    if (cleaned.match(/^\d{2}\/[A-Za-z]{3}\/\d{4}$/)) {
      const date = new Date(cleaned);
      return date.toISOString().split('T')[0];
    }

    // Fallback: try to parse with Date constructor
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    // If all parsing fails, return current date
    logger.warn({ dateStr }, 'Failed to parse BSE date, using current date');
    return new Date().toISOString().split('T')[0];
  } catch (error) {
    logger.error({ dateStr, error }, 'Error parsing BSE date');
    return new Date().toISOString().split('T')[0];
  }
}

/**
 * Parse price range from BSE format
 * BSE format: "310.00 - 326.00" or "310.00" or "--"
 * @param priceStr - Price string from BSE
 * @returns {min: number, max: number}
 */
function parsePriceRange(priceStr: string): { min: number | undefined; max: number | undefined } {
  try {
    const cleaned = priceStr.trim();

    // Handle "--" (no price)
    if (cleaned === '--' || cleaned === '' || cleaned === 'N/A') {
      return { min: undefined, max: undefined };
    }

    // Handle range format "310.00 - 326.00"
    if (cleaned.includes('-')) {
      const parts = cleaned.split('-').map(p => parseFloat(p.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { min: parts[0], max: parts[1] };
      }
    }

    // Handle single price "310.00"
    const price = parseFloat(cleaned);
    if (!isNaN(price)) {
      return { min: price, max: price };
    }

    return { min: undefined, max: undefined };
  } catch (error) {
    logger.error({ priceStr, error }, 'Error parsing price range');
    return { min: undefined, max: undefined };
  }
}

/**
 * Scrape IPO data from BSE India website using Puppeteer
 * @returns Promise<BSEScrapeResult> - Scraped IPO and subscription data
 */
export async function scrapeBSEIPOs(): Promise<BSEScrapeResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    logger.info({ url: BSE_URL }, 'Starting BSE scraper');

    browser = await launchBrowser();
    const page = await createPage(browser);

    await navigateToUrl(page, BSE_URL);

    // Wait for IPO table to load
    try {
      await waitForSelector(page, 'table', 15000);
      logger.debug('IPO table found on BSE page');
    } catch (error) {
      logger.warn('IPO table not found within timeout, attempting to extract data anyway');
    }

    // Extract IPO data using page.evaluate()
    const extractedData = await page.evaluate(() => {
      const ipos: any[] = [];
      const subscriptions: any[] = [];

      // Find the main IPO table
      // Based on inspection, the table contains rows with IPO data
      const tables = document.querySelectorAll('table');
      let ipoTable: Element | null = null;

      // Find table with IPO data (contains headers: Security Name, Exchange Platform, etc.)
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        const text = table.textContent || '';

        const hasSecurityName = text.includes('Security Name');
        const hasExchangePlatform = text.includes('Exchange Platform');
        const hasIssueStatus = text.includes('Issue Status');

        if (hasSecurityName && hasExchangePlatform && hasIssueStatus) {
          ipoTable = table;
          break;
        }
      }

      if (!ipoTable) {
        return { ipos: [], subscriptions: [], smeCount: 0, mainboardCount: 0 };
      }

      // Extract IPO rows
      const rows = ipoTable.querySelectorAll('tr');
      let smeCount = 0;
      let mainboardCount = 0;

      for (const row of Array.from(rows)) {
        const cells = row.querySelectorAll('td');

        // Skip header rows, empty rows, and the giant merged cell row (194 cells)
        // BSE table has exactly 8 columns: Security Name, Exchange Platform, Start Date, End Date,
        // Offer Price, Face Value, Type Of Issue, Issue Status
        if (cells.length !== 8) {
          continue;
        }

        try {
          // Extract data from cells
          // Based on BSE table structure:
          // [0] Security Name, [1] Exchange Platform, [2] Start Date, [3] End Date,
          // [4] Offer Price, [5] Face Value, [6] Type Of Issue, [7] Issue Status

          const companyName = cells[0]?.textContent?.trim() || '';
          const platform = cells[1]?.textContent?.trim() || '';
          const startDate = cells[2]?.textContent?.trim() || '';
          const endDate = cells[3]?.textContent?.trim() || '';
          const offerPrice = cells[4]?.textContent?.trim() || '';
          const faceValue = cells[5]?.textContent?.trim() || '';
          const typeOfIssue = cells[6]?.textContent?.trim() || '';
          const issueStatus = cells[7]?.textContent?.trim() || '';

          // Extract detail page URL from company name link
          const nameCell = cells[0];
          const detailLink = nameCell?.querySelector('a');
          let detailUrl: string | null = null;
          if (detailLink) {
            const href = detailLink.getAttribute('href');
            // Include both DisplayIPO.aspx (regular IPOs/RI/DPI) and ACQDisp.aspx (OTB - Offer To Buy)
            if (href && (href.includes('DisplayIPO.aspx') || href.includes('ACQDisp.aspx'))) {
              detailUrl = `https://www.bseindia.com${href.startsWith('/') ? '' : '/'}${href}`;
            }
          }

          // Skip if no company name
          if (!companyName || companyName.includes('Security Name')) {
            continue;
          }

          // Story 11.8: Determine segment (SME vs MAINBOARD) from platform
          const isSME = platform.trim().toUpperCase().includes('SME');
          const segment = isSME ? 'SME' : 'MAINBOARD';

          // Count SME vs MAINBOARD
          if (segment === 'SME') {
            smeCount++;
          } else {
            mainboardCount++;
          }

          ipos.push({
            companyName,
            platform,
            startDate,
            endDate,
            offerPrice,
            faceValue: faceValue && faceValue !== '--' ? faceValue : '10',
            typeOfIssue,
            issueStatus,
            segment, // Story 11.8: Store segment instead of category
            detailUrl
          });

        } catch (error) {
          console.error('Error extracting IPO row:', error);
        }
      }

      return { ipos, subscriptions, smeCount, mainboardCount };
    });

    // Transform extracted data to ScrapedIPO format
    const scrapedIPOs: ScrapedIPO[] = [];
    let smeCount = 0;
    let mainboardCount = 0;

    for (const rawIPO of extractedData.ipos) {
      try {
        const status = extractStatus(rawIPO.issueStatus);
        const priceRange = parsePriceRange(rawIPO.offerPrice);

        // Story 11.8: Detect segment and offering type
        const listingExchanges = [rawIPO.platform]; // Use platform as exchange indicator
        const segment = detectSegmentFromExchange(listingExchanges);
        const offeringType = detectOfferingType({
          symbol: rawIPO.companyName, // Use company name as fallback
          bseType: rawIPO.typeOfIssue, // BSE type field (RI, DPI, IPO, etc.)
          issueType: undefined
        });

        // Count categories
        if (segment === 'SME') {
          smeCount++;
        } else if (segment === 'MAINBOARD') {
          mainboardCount++;
        }

        const ipoData: ScrapedIPO = {
          companyName: rawIPO.companyName,
          issueSize: 0, // BSE doesn't show issue size in main table, would need detail page
          priceRangeMin: priceRange.min,
          priceRangeMax: priceRange.max,
          openDate: parseBSEDate(rawIPO.startDate),
          closeDate: parseBSEDate(rawIPO.endDate),
          listingExchange: 'BSE',
          segment: segment as 'MAINBOARD' | 'SME' | null | undefined,
          offeringType: offeringType as 'IPO' | 'FPO' | 'RIGHTS' | 'OFS' | 'BUYBACK' | 'DELISTING' | 'TENDER' | 'NCD' | 'BONDS' | 'INVITS' | 'REITS' | 'IPP' | 'QIP' | 'PREFERENTIAL',
          sector: undefined, // Not available in BSE main table — never write '' (it plants a blank that blocks real backfills)
          status,
          lotSize: undefined, // Let detail page scraper populate this (don't default to 100)
          faceValue: parseInt(rawIPO.faceValue, 10) || 10 // Integer face value
        };

        scrapedIPOs.push(ipoData);
      } catch (error) {
        logger.warn({ companyName: rawIPO.companyName, error }, 'Failed to transform BSE IPO data');
      }
    }

    await closeBrowser(browser);
    browser = null;

    // Phase 2: Scrape detail pages for additional data
    logger.info('Phase 2: Starting BSE detail page scraping');

    const detailUrls = extractedData.ipos
      .map((ipo: any) => ipo.detailUrl)
      .filter((url: string | null) => url !== null) as string[];

    logger.info(
      { detailUrlsFound: detailUrls.length, totalIPOs: scrapedIPOs.length },
      'Found detail page URLs'
    );

    let detailDataMap: Map<string, BSEDetailPageData> = new Map();

    if (detailUrls.length > 0) {
      const detailResult = await scrapeBSEIPODetails(detailUrls, 2000);

      // Create URL-to-detail mapping for matching
      const urlToDetailMap = new Map<string, BSEDetailPageData>();
      for (let i = 0; i < detailUrls.length; i++) {
        urlToDetailMap.set(detailUrls[i], detailResult.details[i]);
      }

      logger.info(
        {
          detailsScraped: detailResult.details.length,
          errors: detailResult.errors.length
        },
        'Detail page scraping completed'
      );

      // Merge detail data with scraped IPOs
      // Strategy: Match by URL (detailUrls are in same order as scrapedIPOs)
      let enrichedCount = 0;

      for (let i = 0; i < scrapedIPOs.length; i++) {
        const ipo = scrapedIPOs[i];
        const rawIPO = extractedData.ipos[i];

        // Skip if no detail URL
        if (!rawIPO.detailUrl) {
          logger.debug({ companyName: ipo.companyName }, 'No detail URL available');
          continue;
        }

        // Find matching detail data by URL
        const detailData = urlToDetailMap.get(rawIPO.detailUrl);

        if (detailData) {
          logger.debug(
            {
              companyName: ipo.companyName,
              symbol: detailData.symbol,
              detailUrl: rawIPO.detailUrl
            },
            'Merging detail data'
          );

          // Update with detail page data
          if (detailData.issueSize > 0) {
            ipo.issueSize = detailData.issueSize;
          }
          if (detailData.lotSize > 0) {
            ipo.lotSize = detailData.lotSize;
          }
          if (detailData.faceValue > 0) {
            ipo.faceValue = detailData.faceValue;
          }
          if (detailData.priceRangeMin > 0 && detailData.priceRangeMax > 0) {
            ipo.priceRangeMin = detailData.priceRangeMin;
            ipo.priceRangeMax = detailData.priceRangeMax;
          }
          if (detailData.openDate) {
            ipo.openDate = detailData.openDate;
          }
          if (detailData.closeDate) {
            ipo.closeDate = detailData.closeDate;
          }

          // Additional fields for ipo_details table (stored in ScrapedIPO for now)
          (ipo as any).registrar = detailData.registrar;
          (ipo as any).leadManagers = detailData.leadManagers;
          (ipo as any).sponsorBanks = detailData.sponsorBanks;
          (ipo as any).symbol = detailData.symbol;

          // Store in map for final log (only if symbol exists)
          if (detailData.symbol) {
            detailDataMap.set(detailData.symbol.toUpperCase(), detailData);
          }

          enrichedCount++;
        } else {
          logger.debug(
            { companyName: ipo.companyName },
            'No matching detail data found'
          );
        }
      }

      logger.info({ enrichedCount, totalIPOs: scrapedIPOs.length }, 'Detail data merged');
    } else {
      logger.warn('No detail page URLs found, skipping detail scraping');
    }

    // Phase 2B: Rights/Debt Issue Enrichment from Chittorgarh
    logger.info('Phase 2B: Starting Rights/Debt issue enrichment from Chittorgarh');

    const rightsIPOs = scrapedIPOs.filter(ipo =>
      ipo.offeringType === 'RIGHTS' && ipo.issueSize === 0
    );
    const debtIPOs = scrapedIPOs.filter(ipo =>
      ipo.offeringType === 'NCD' && ipo.issueSize === 0
    );

    logger.info({
      rightsCount: rightsIPOs.length,
      debtCount: debtIPOs.length,
    }, 'Found Rights/Debt IPOs needing enrichment');

    let rightsEnrichedCount = 0;
    let debtEnrichedCount = 0;

    // Enrich Rights Issues
    if (rightsIPOs.length > 0) {
      try {
        logger.info('Fetching Rights Issue data from Chittorgarh');
        const rightsData = await fetchRightsIssuesFromChittorgarh();
        logger.info({ dataCount: rightsData.length }, 'Rights Issue data fetched');

        if (rightsData.length > 0) {
          const rightsResult = await enrichRightsIssuesFromChittorgarh(rightsIPOs, rightsData);

          // Replace original Rights IPOs with enriched ones
          for (let i = 0; i < scrapedIPOs.length; i++) {
            const ipo = scrapedIPOs[i];
            if (ipo.offeringType === 'RIGHTS' && ipo.issueSize === 0) {
              const enriched = rightsResult.enriched.find(
                e => e.companyName === ipo.companyName
              );
              if (enriched) {
                scrapedIPOs[i] = enriched;
              }
            }
          }

          rightsEnrichedCount = rightsResult.stats.enrichedCount;
          logger.info({
            enrichedCount: rightsResult.stats.enrichedCount,
            failedMatches: rightsResult.stats.failedMatches,
            errors: rightsResult.errors.length,
          }, 'Rights Issue enrichment completed');
        } else {
          logger.warn('No Rights Issue data available from Chittorgarh');
        }
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to enrich Rights Issues');
      }
    }

    // Enrich Debt Issues
    if (debtIPOs.length > 0) {
      try {
        logger.info('Fetching Debt Issue data from Chittorgarh');
        const debtData = await fetchDebtIssuesFromChittorgarh();
        logger.info({ dataCount: debtData.length }, 'Debt Issue data fetched');

        if (debtData.length > 0) {
          const debtResult = await enrichDebtIssuesFromChittorgarh(debtIPOs, debtData);

          // Replace original Debt IPOs with enriched ones
          for (let i = 0; i < scrapedIPOs.length; i++) {
            const ipo = scrapedIPOs[i];
            if (ipo.offeringType === 'NCD' && ipo.issueSize === 0) {
              const enriched = debtResult.enriched.find(
                e => e.companyName === ipo.companyName
              );
              if (enriched) {
                scrapedIPOs[i] = enriched;
              }
            }
          }

          debtEnrichedCount = debtResult.stats.enrichedCount;
          logger.info({
            enrichedCount: debtResult.stats.enrichedCount,
            failedMatches: debtResult.stats.failedMatches,
            errors: debtResult.errors.length,
          }, 'Debt Issue enrichment completed');
        } else {
          logger.warn('No Debt Issue data available from Chittorgarh');
        }
      } catch (error) {
        logger.error({
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to enrich Debt Issues');
      }
    }

    const duration = Date.now() - startTime;
    logger.info(
      {
        iposFound: scrapedIPOs.length,
        detailsEnriched: detailDataMap.size,
        rightsEnriched: rightsEnrichedCount,
        debtEnriched: debtEnrichedCount,
        smeCount,
        mainboardCount,
        subscriptionsFound: extractedData.subscriptions.length,
        duration
      },
      'BSE scrape completed successfully'
    );

    return {
      ipos: scrapedIPOs,
      subscriptions: extractedData.subscriptions,
      smeCount,
      mainboardCount
    };

  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        url: BSE_URL
      },
      'BSE scrape failed'
    );

    // Ensure browser is closed on error
    if (browser) {
      await closeBrowser(browser);
    }

    throw error;
  }
}
