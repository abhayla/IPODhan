/**
 * Historical IPO Data Scraper
 * Story 7.10: Historical IPO Data Scraper Implementation
 *
 * Scrapes historical IPO performance data from Chittorgarh.com including:
 * - Subscription data (Retail, HNI, QIB)
 * - Grey Market Premium (GMP)
 * - Listing performance
 * - Current price data
 *
 * Features:
 * - Fuzzy matching to existing IPOs (85% similarity threshold)
 * - Batch processing (50 IPOs per batch)
 * - Incremental updates support
 * - Rate limiting (3 seconds between year requests)
 * - Zod validation
 */

import { BaseScraper, type ScraperResult } from '../base-scraper';
import { z } from 'zod';
import levenshtein from 'fast-levenshtein';
import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { logger } from '@/lib/logger';

// ==================== INTERFACES & TYPES ====================

export interface HistoricalIPOData {
  ipoName: string;
  issuePrice: number | null;
  subscriptionRetail: number | null;
  subscriptionHni: number | null;
  subscriptionQib: number | null;
  subscriptionTotal: number | null;
  gmpPrice: number | null;
  gmpPercentage: number | null;
  listingPrice: number | null;
  listingGainPercentage: number | null;
  listingGainAmount: number | null;
  listingDate: Date | null;
  currentPrice: number | null;
  currentGainPercentage: number | null;
  currentGainAmount: number | null;
  openDate: Date | null;
  closeDate: Date | null;
}

export interface MatchedIPOData extends HistoricalIPOData {
  ipoId: string | null;
  matchScore: number;
}

export interface MatchResult {
  ipoId: string | null;
  matchScore: number;
  matched: boolean;
}

export interface ScrapeOptions {
  years?: number[];
  incrementalUpdate?: boolean;
}

// ==================== ZOD VALIDATION SCHEMA ====================

const HistoricalIPODataSchema = z.object({
  ipoName: z.string().min(1),
  issuePrice: z.number().positive().nullable(),
  subscriptionRetail: z.number().nonnegative().nullable(),
  subscriptionHni: z.number().nonnegative().nullable(),
  subscriptionQib: z.number().nonnegative().nullable(),
  subscriptionTotal: z.number().nonnegative().nullable(),
  gmpPrice: z.number().nullable(), // Can be negative
  gmpPercentage: z.number().nullable(),
  listingPrice: z.number().positive().nullable(),
  listingGainPercentage: z.number().nullable(),
  listingGainAmount: z.number().nullable(),
  listingDate: z.date().nullable(),
  currentPrice: z.number().positive().nullable(),
  currentGainPercentage: z.number().nullable(),
  currentGainAmount: z.number().nullable(),
  openDate: z.date().nullable(),
  closeDate: z.date().nullable(),
}).refine(
  // At least one performance metric must be present
  (data) => data.listingGainPercentage !== null || data.currentGainPercentage !== null || data.issuePrice !== null,
  { message: 'At least one performance metric is required' }
);

// ==================== SCRAPER CLASS ====================

export class HistoricalIPOScraper extends BaseScraper<MatchedIPOData[]> {
  private ipoCache: Array<{ id: string; companyName: string }> | null = null;

  constructor() {
    super({
      name: 'HistoricalIPOScraper',
      baseUrl: 'https://www.chittorgarh.com',
      rateLimit: 0.33, // 3 second delay between requests (AC: 14)
      timeout: 30000,
      retries: 3, // AC: 10
    });
  }

  // ==================== MAIN SCRAPE METHOD ====================

  /**
   * Main orchestration method for scraping historical IPO data
   * AC: 12, 13
   */
  async scrape(options: ScrapeOptions = {}): Promise<ScraperResult<MatchedIPOData[]>> {
    try {
      this.logStart('Starting historical IPO data scrape');

      // Step 1: Determine years to scrape
      const years = this.determineYearsToScrape(options);
      logger.info({
        scraper: 'historical-ipo',
        phase: 'initialization',
        years,
        mode: options.incrementalUpdate ? 'incremental' : 'full',
      }, `Scraping ${years.length} years`);

      // Step 2: Scrape each year with rate limiting (AC: 14)
      const allData: HistoricalIPOData[] = [];
      for (let i = 0; i < years.length; i++) {
        const year = years[i];
        logger.info({ scraper: 'historical-ipo', phase: 'scraping', year }, `Scraping year ${year}`);

        const yearData = await this.scrapeChittorgarh(year);
        allData.push(...yearData);

        // Rate limiting: 3 seconds between year requests
        if (i < years.length - 1) {
          await this.sleep(3000);
        }
      }

      logger.info({
        scraper: 'historical-ipo',
        phase: 'scraping-complete',
        iposFound: allData.length,
      }, `Found ${allData.length} total IPOs`);

      // Step 3: Validate all data (AC: 11)
      const validData = allData
        .map(data => this.validateIPOData(data))
        .filter((data): data is HistoricalIPOData => data !== null);

      logger.info({
        scraper: 'historical-ipo',
        phase: 'validation',
        validIPOs: validData.length,
        invalidIPOs: allData.length - validData.length,
      }, `Validated ${validData.length}/${allData.length} IPOs`);

      // Step 4: Match to existing IPOs (AC: 7)
      const matchedData = await this.matchAllData(validData);
      const matchedCount = matchedData.filter(d => d.ipoId).length;

      logger.info({
        scraper: 'historical-ipo',
        phase: 'matching',
        matchedIPOs: matchedCount,
        unmatchedIPOs: matchedData.length - matchedCount,
        matchRate: ((matchedCount / matchedData.length) * 100).toFixed(1),
      }, `Matched ${matchedCount}/${matchedData.length} IPOs`);

      // Step 5: Store in database with batch processing (AC: 8)
      await this.storeHistoricalData(matchedData);

      logger.info({
        scraper: 'historical-ipo',
        phase: 'complete',
        storedIPOs: matchedCount,
      }, `Stored ${matchedCount} IPOs in database`);

      this.logComplete(matchedData.length);
      return this.createSuccessResult(matchedData);
    } catch (error) {
      this.logError(error as Error);
      return this.createErrorResult(error as Error);
    }
  }

  // ==================== CHITTORGARH SCRAPING ====================

  /**
   * Scrape Chittorgarh IPO performance tracker for a specific year
   * AC: 1, 2, 3, 4, 5, 6
   *
   * NOTE: The website structure has changed as of 2025.
   * - For current year (2025): Only summary table available with limited data
   * - For past years (2020-2024): Detailed table should be available
   */
  private async scrapeChittorgarh(year: number): Promise<HistoricalIPOData[]> {
    // URL Source: docs/URLs-Tracker.md - Historical IPO Performance
    const url = `${this.config.baseUrl}/ipo/ipo_perf_tracker.asp`;

    const $ = await this.fetchHTML(url);
    const ipoData: HistoricalIPOData[] = [];

    // Try multiple table selection strategies
    // Strategy 1: Look for tables with specific headers
    let tableRows = $('table').filter((_, table) => {
      const headers = $(table).find('th, td').first().text();
      return headers.includes('Company Name') || headers.includes('IPO Name');
    }).find('tbody tr').toArray();

    // Strategy 2: If no rows found, look for any table with data rows
    if (tableRows.length === 0) {
      $('table').each((_, table) => {
        const $table = $(table);
        const rows = $table.find('tbody tr, tr').toArray();
        // Filter out header rows and empty rows
        const dataRows = rows.filter(row => {
          const $row = $(row);
          const cells = $row.find('td');
          return cells.length >= 3 && !$row.find('th').length;
        });
        if (dataRows.length > tableRows.length) {
          tableRows = dataRows;
        }
      });
    }

    logger.info({
      scraper: 'historical-ipo',
      phase: 'table-detection',
      year,
      rowsFound: tableRows.length,
    }, `Found ${tableRows.length} table rows for year ${year}`);

    for (const row of tableRows) {
      try {
        const $row = $(row);
        const cells = $row.find('td').toArray();

        // Skip rows without enough data or "No Record Found" messages
        if (cells.length < 3) continue;
        const firstCellText = $(cells[0]).text().trim();
        if (!firstCellText || firstCellText.toLowerCase().includes('no record')) continue;

        const ipoName = firstCellText;

        // Detect table structure based on column count
        let issuePrice: number | null = null;
        let subscriptionRetail: number | null = null;
        let subscriptionHni: number | null = null;
        let subscriptionQib: number | null = null;
        let subscriptionTotal: number | null = null;
        let gmpPrice: number | null = null;
        let gmpPercentage: number | null = null;
        let listingPrice: number | null = null;
        let listingGainPercentage: number | null = null;
        let listingGainAmount: number | null = null;
        let listingDate: Date | null = null;
        let currentPrice: number | null = null;
        let currentGainPercentage: number | null = null;
        let currentGainAmount: number | null = null;
        let openDate: Date | null = null;
        let closeDate: Date | null = null;

        if (cells.length >= 10) {
          // Full detailed table structure (10+ columns)
          issuePrice = this.parseNumber($(cells[1]).text());
          const openDateText = $(cells[2]).text().trim();
          const closeDateText = $(cells[3]).text().trim();
          subscriptionRetail = this.parseSubscription($(cells[4]).text());
          subscriptionHni = this.parseSubscription($(cells[5]).text());
          subscriptionQib = this.parseSubscription($(cells[6]).text());
          subscriptionTotal = this.parseSubscription($(cells[7]).text());
          gmpPrice = this.parseNumber($(cells[8]).text());
          gmpPercentage = this.parsePercentage($(cells[9]).text());

          const listingDateText = cells.length > 10 ? $(cells[10]).text().trim() : null;
          listingPrice = cells.length > 11 ? this.parseNumber($(cells[11]).text()) : null;
          listingGainPercentage = cells.length > 12 ? this.parsePercentage($(cells[12]).text()) : null;
          currentPrice = cells.length > 13 ? this.parseNumber($(cells[13]).text()) : null;
          currentGainPercentage = cells.length > 14 ? this.parsePercentage($(cells[14]).text()) : null;

          listingGainAmount = issuePrice && listingPrice ? listingPrice - issuePrice : null;
          currentGainAmount = issuePrice && currentPrice ? currentPrice - issuePrice : null;
          openDate = this.parseDate(openDateText);
          closeDate = this.parseDate(closeDateText);
          listingDate = listingDateText ? this.parseDate(listingDateText) : null;
        } else if (cells.length >= 7) {
          // Medium table structure (7-9 columns)
          const listedOnText = $(cells[1]).text().trim();
          issuePrice = this.parseNumber($(cells[2]).text());
          listingPrice = this.parseNumber($(cells[3]).text());
          listingGainPercentage = this.parsePercentage($(cells[4]).text());
          currentPrice = cells.length > 5 ? this.parseNumber($(cells[5]).text()) : null;
          currentGainPercentage = cells.length > 6 ? this.parsePercentage($(cells[6]).text()) : null;

          listingDate = this.parseDate(listedOnText);
          listingGainAmount = issuePrice && listingPrice ? listingPrice - issuePrice : null;
          currentGainAmount = issuePrice && currentPrice ? currentPrice - issuePrice : null;
        } else if (cells.length === 3) {
          // Simple summary table structure (3 columns: Name, Listing Gain %, Current Gain %)
          listingGainPercentage = this.parsePercentage($(cells[1]).text());
          currentGainPercentage = this.parsePercentage($(cells[2]).text());
        } else {
          // Unknown structure, skip
          continue;
        }

        ipoData.push({
          ipoName,
          issuePrice,
          subscriptionRetail,
          subscriptionHni,
          subscriptionQib,
          subscriptionTotal,
          gmpPrice,
          gmpPercentage,
          listingPrice,
          listingGainPercentage,
          listingGainAmount,
          listingDate,
          currentPrice,
          currentGainPercentage,
          currentGainAmount,
          openDate,
          closeDate,
        });
      } catch (error) {
        logger.warn({
          scraper: 'historical-ipo',
          phase: 'parsing',
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to parse IPO row');
      }
    }

    return ipoData;
  }

  // ==================== DATA PARSING UTILITIES ====================

  /**
   * Parse number from text (handles �, Rs., commas, etc.)
   */
  private parseNumber(text: string): number | null {
    if (!text || text.trim() === '' || text === '' || text === '-' || text.toLowerCase().includes('not')) {
      return null;
    }

    // Remove currency symbols (₹, Rs.), commas, and spaces, but preserve decimal points
    const cleaned = text
      .replace(/₹/g, '')
      .replace(/Rs\.?/gi, '')
      .replace(/,/g, '')
      .replace(/\s/g, '')
      .trim();
    const num = parseFloat(cleaned);

    return isNaN(num) ? null : num;
  }

  /**
   * Parse subscription multiple (removes 'x' suffix)
   */
  private parseSubscription(text: string): number | null {
    if (!text || text.trim() === '' || text === '' || text === '-') {
      return null;
    }

    // Remove 'x' suffix and parse
    const cleaned = text.replace(/x/gi, '').trim();
    const num = parseFloat(cleaned);

    return isNaN(num) ? null : num;
  }

  /**
   * Parse percentage (removes '%' suffix)
   */
  private parsePercentage(text: string): number | null {
    if (!text || text.trim() === '' || text === '' || text === '-') {
      return null;
    }

    // Remove '%' suffix and parse
    const cleaned = text.replace(/%/g, '').trim();
    const num = parseFloat(cleaned);

    return isNaN(num) ? null : num;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(text: string): Date | null {
    if (!text || text.trim() === '' || text === '' || text === '-') {
      return null;
    }

    try {
      // Try parsing common date formats
      // Format: DD-MMM-YYYY or DD-MM-YYYY or DD/MM/YYYY
      const date = new Date(text);
      return isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  // ==================== DATA VALIDATION ====================

  /**
   * Validate IPO data using Zod schema
   * AC: 11
   */
  private validateIPOData(data: unknown): HistoricalIPOData | null {
    const result = HistoricalIPODataSchema.safeParse(data);

    if (!result.success) {
      logger.warn({
        scraper: 'historical-ipo',
        phase: 'validation',
        ipoName: (data as any).ipoName,
        errors: result.error.issues,
      }, 'Validation failed for IPO');
      return null;
    }

    return result.data;
  }

  // ==================== IPO MATCHING ====================

  /**
   * Normalize company name for matching
   */
  private normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      // Remove special characters first
      .replace(/[^a-z0-9\s]/g, '')
      // Then remove company suffixes
      .replace(/\b(limited|ltd|inc|pvt|private|corporation|corp|company)\b/gi, '')
      // Normalize multiple spaces
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Calculate similarity between two company names
   * AC: 7
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const normalized1 = this.normalizeCompanyName(str1);
    const normalized2 = this.normalizeCompanyName(str2);

    if (normalized1 === normalized2) return 100;
    if (normalized1.length === 0 || normalized2.length === 0) return 0;

    const distance = levenshtein.get(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    return ((maxLength - distance) / maxLength) * 100;
  }

  /**
   * Fetch all IPOs from database (with caching)
   */
  private async fetchAllIPOs(): Promise<Array<{ id: string; companyName: string }>> {
    if (this.ipoCache) {
      return this.ipoCache;
    }

    const allIPOs = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
      })
      .from(ipos);

    this.ipoCache = allIPOs;
    return allIPOs;
  }

  /**
   * Match scraped data to existing IPO in database
   * AC: 7 - 85% similarity threshold
   */
  private async matchDataToIPO(data: HistoricalIPOData): Promise<MatchResult> {
    const allIPOs = await this.fetchAllIPOs();

    let bestMatch: MatchResult = {
      ipoId: null,
      matchScore: 0,
      matched: false,
    };

    for (const ipo of allIPOs) {
      const score = this.calculateSimilarity(data.ipoName, ipo.companyName);

      if (score > bestMatch.matchScore) {
        bestMatch = {
          ipoId: ipo.id,
          matchScore: score,
          matched: score >= 85, // AC: 7 - 85% threshold
        };
      }
    }

    if (!bestMatch.matched && bestMatch.matchScore > 0) {
      logger.debug({
        scraper: 'historical-ipo',
        phase: 'matching',
        ipoName: data.ipoName,
        bestScore: bestMatch.matchScore.toFixed(1),
        threshold: 85,
      }, 'No match found below threshold');
    }

    return bestMatch;
  }

  /**
   * Match all scraped data to existing IPOs
   */
  private async matchAllData(dataArray: HistoricalIPOData[]): Promise<MatchedIPOData[]> {
    const matchedData: MatchedIPOData[] = [];

    for (const data of dataArray) {
      const matchResult = await this.matchDataToIPO(data);
      matchedData.push({
        ...data,
        ipoId: matchResult.ipoId,
        matchScore: matchResult.matchScore,
      });
    }

    const matchCount = matchedData.filter(d => d.ipoId).length;
    logger.info({
      scraper: 'historical-ipo',
      phase: 'matching-complete',
      matched: matchCount,
      unmatched: matchedData.length - matchCount,
      matchRate: ((matchCount / matchedData.length) * 100).toFixed(1),
    }, `Matching complete: ${matchCount}/${matchedData.length} matched`);

    return matchedData;
  }

  // ==================== DATABASE STORAGE ====================

  /**
   * Store historical data in database with batch processing
   * AC: 8 - Batch processing (50 IPOs per batch)
   */
  private async storeHistoricalData(data: MatchedIPOData[]): Promise<void> {
    // Filter to only matched IPOs
    const matchedData = data.filter(d => d.ipoId);

    if (matchedData.length === 0) {
      logger.warn({ scraper: 'historical-ipo', phase: 'storage' }, 'No matched IPOs to store');
      return;
    }

    // Process in batches of 50
    await this.batchProcess(matchedData, 50, async (batch) => {
      await this.upsertBatch(batch);
    });

    logger.info({
      scraper: 'historical-ipo',
      phase: 'storage-complete',
      storedIPOs: matchedData.length,
    }, `Stored ${matchedData.length} IPOs`);
  }

  /**
   * Batch processing utility
   */
  private async batchProcess<T>(
    items: T[],
    batchSize: number,
    processor: (batch: T[]) => Promise<void>
  ): Promise<void> {
    const totalBatches = Math.ceil(items.length / batchSize);

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;

      logger.info({
        scraper: 'historical-ipo',
        phase: 'batch-processing',
        batch: batchNum,
        totalBatches,
      }, `Processing batch ${batchNum}/${totalBatches}`);

      await processor(batch);
    }
  }

  /**
   * Upsert a batch of IPOs into database
   */
  private async upsertBatch(batch: MatchedIPOData[]): Promise<void> {
    for (const data of batch) {
      if (!data.ipoId) continue;

      try {
        await db
          .update(ipos)
          .set({
            subscriptionRetail: data.subscriptionRetail?.toString(),
            subscriptionHni: data.subscriptionHni?.toString(),
            subscriptionQib: data.subscriptionQib?.toString(),
            subscriptionTotal: data.subscriptionTotal?.toString(),
            gmpPrice: data.gmpPrice?.toString(),
            gmpPercentageHistorical: data.gmpPercentage?.toString(),
            gmpUpdatedAtHistorical: new Date(),
            listingPriceHistorical: data.listingPrice?.toString(),
            listingGainPercentage: data.listingGainPercentage?.toString(),
            listingGainAmount: data.listingGainAmount?.toString(),
            listingDateHistorical: data.listingDate ? data.listingDate.toISOString().split('T')[0] : null,
            currentPrice: data.currentPrice?.toString(),
            currentGainPercentage: data.currentGainPercentage?.toString(),
            currentGainAmount: data.currentGainAmount?.toString(),
            currentPriceUpdatedAt: new Date(),
            historicalDataSource: 'Chittorgarh',
            historicalDataScrapedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(ipos.id, data.ipoId));
      } catch (error) {
        logger.error({
          scraper: 'historical-ipo',
          phase: 'upsert',
          ipoId: data.ipoId,
          ipoName: data.ipoName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to upsert IPO');
      }
    }
  }

  // ==================== INCREMENTAL UPDATE LOGIC ====================

  /**
   * Get last scraped timestamp from database
   * AC: 9
   */
  private async getLastScrapedTimestamp(): Promise<Date | null> {
    const result = await db
      .select({ lastScraped: ipos.historicalDataScrapedAt })
      .from(ipos)
      .orderBy(desc(ipos.historicalDataScrapedAt))
      .limit(1);

    return result[0]?.lastScraped || null;
  }

  /**
   * Determine which years to scrape
   */
  private determineYearsToScrape(options: ScrapeOptions): number[] {
    // Explicit years provided
    if (options.years && options.years.length > 0) {
      return options.years;
    }

    // Incremental update mode (AC: 9)
    if (options.incrementalUpdate) {
      const currentYear = new Date().getFullYear();
      return [currentYear, currentYear - 1];
    }

    // Default: All years (2020-current)
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let year = 2020; year <= currentYear; year++) {
      years.push(year);
    }
    return years;
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Sleep utility for rate limiting
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const historicalIPOScraper = new HistoricalIPOScraper();
