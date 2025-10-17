/**
 * GMP API Scraper
 * Story 10.7: Implement GMP API Scraper
 *
 * Scrapes Grey Market Premium (GMP) data from Chittorgarh.com for active IPOs.
 *
 * Features:
 * - Real-time GMP data collection
 * - Fuzzy matching to existing IPOs (85% similarity threshold)
 * - Rate limiting (3 seconds between requests)
 * - Zod validation
 * - Stores time-series data in gmp_records table
 *
 * Data Source: Chittorgarh.com - IPO Grey Market Premium tracker
 * URL: https://www.chittorgarh.com/ipo/ipo_grey_market_premium.asp
 *
 * TODO: Legal/Compliance Review Required
 * - Verify scraping is permitted under Chittorgarh.com ToS
 * - Ensure proper attribution of data source
 * - Review rate limiting to be respectful of their servers
 * - Consider reaching out for API access if available
 */

import { BaseScraper, type ScraperResult } from '../base-scraper';
import { z } from 'zod';
import { distance as levenshtein } from 'fastest-levenshtein';
import { getDb } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { getRedisClient } from '@/lib/cache/redis-client';
import type { GMPRecordInsert } from '@/lib/repositories/types';

// ==================== INTERFACES & TYPES ====================

export interface GMPData {
  ipoName: string;
  gmp: number; // GMP value in rupees
  gmpPercentage: number | null;
  expectedListingPrice: number;
  subjectRate: number | null; // Subject/Safalya rate
  kostakRate: number | null; // Kostak rate (allotment rights)
  saudaDetails: string | null; // Trading info
  issuePrice: number | null; // Issue price for reference
  timestamp: Date;
}

export interface MatchedGMPData extends GMPData {
  ipoId: string | null;
  matchScore: number;
}

export interface MatchResult {
  ipoId: string | null;
  matchScore: number;
  matched: boolean;
}

export interface ScrapeOptions {
  filterStatus?: ('OPEN' | 'UPCOMING' | 'CLOSED')[];
}

// ==================== ZOD VALIDATION SCHEMA ====================

const GMPDataSchema = z.object({
  ipoName: z.string().min(1),
  gmp: z.number(),
  gmpPercentage: z.number().nullable(),
  expectedListingPrice: z.number().positive(),
  subjectRate: z.number().nullable(),
  kostakRate: z.number().nullable(),
  saudaDetails: z.string().nullable(),
  issuePrice: z.number().positive().nullable(),
  timestamp: z.date(),
});

// ==================== SCRAPER CLASS ====================

export class GMPAPIScraper extends BaseScraper<MatchedGMPData[]> {
  private ipoCache: Array<{ id: string; companyName: string; status: string }> | null = null;
  private gmpRepository: GMPRepository | null = null;

  constructor() {
    super({
      name: 'GMPAPIScraper',
      baseUrl: 'https://www.chittorgarh.com',
      rateLimit: 0.33, // 3 second delay between requests (AC: 5)
      timeout: 30000, // 30 seconds timeout (AC: 5)
      retries: 3, // 3 retry attempts with exponential backoff (AC: 5)
    });
  }

  // ==================== MAIN SCRAPE METHOD ====================

  /**
   * Main orchestration method for scraping GMP data
   * AC: 1, 2, 3, 4, 5, 6
   */
  async scrape(options: ScrapeOptions = {}): Promise<ScraperResult<MatchedGMPData[]>> {
    try {
      this.logStart('Starting GMP data scrape');

      // Step 1: Scrape GMP data from Chittorgarh
      const allData = await this.scrapeChittorgarhGMP();

      logger.info({
        scraper: 'gmp-api',
        phase: 'scraping-complete',
        gmpsFound: allData.length,
      }, `Found ${allData.length} total GMP records`);

      // Step 2: Validate all data (AC: 3)
      const validData = allData
        .map(data => this.validateGMPData(data))
        .filter((data): data is GMPData => data !== null);

      logger.info({
        scraper: 'gmp-api',
        phase: 'validation',
        validGMPs: validData.length,
        invalidGMPs: allData.length - validData.length,
      }, `Validated ${validData.length}/${allData.length} GMP records`);

      // Step 3: Match to existing IPOs (AC: 4)
      const matchedData = await this.matchAllData(validData, options.filterStatus);
      const matchedCount = matchedData.filter(d => d.ipoId).length;

      logger.info({
        scraper: 'gmp-api',
        phase: 'matching',
        matchedGMPs: matchedCount,
        unmatchedGMPs: matchedData.length - matchedCount,
        matchRate: matchedData.length > 0 ? ((matchedCount / matchedData.length) * 100).toFixed(1) : '0',
      }, `Matched ${matchedCount}/${matchedData.length} GMP records to IPOs`);

      // Step 4: Store in database (AC: 3)
      await this.storeGMPData(matchedData);

      logger.info({
        scraper: 'gmp-api',
        phase: 'complete',
        storedGMPs: matchedCount,
      }, `Stored ${matchedCount} GMP records in database`);

      this.logComplete(matchedData.length);
      return this.createSuccessResult(matchedData);
    } catch (error) {
      this.logError(error as Error);
      return this.createErrorResult(error as Error);
    }
  }

  // ==================== CHITTORGARH SCRAPING ====================

  /**
   * Scrape Chittorgarh IPO Grey Market Premium tracker
   * AC: 2 - Scrapes GMP value, percentage, expected listing price, subject rate, kostak rate, sauda details
   */
  private async scrapeChittorgarhGMP(): Promise<GMPData[]> {
    const url = `${this.config.baseUrl}/ipo/ipo_grey_market_premium.asp`;

    const $ = await this.fetchHTML(url);
    const gmpData: GMPData[] = [];

    // Find the GMP table
    // Note: This selector may need adjustment based on actual website structure
    const tableRows = $('table.table tbody tr, table#gmp-tracker tbody tr, .gmp-table tbody tr').toArray();

    for (const row of tableRows) {
      try {
        const $row = $(row);
        const cells = $row.find('td').toArray();

        if (cells.length < 5) continue; // Skip rows with insufficient data

        // Extract data from table cells
        const ipoName = $(cells[0]).text().trim();
        if (!ipoName || ipoName.toLowerCase().includes('company')) continue; // Skip header rows

        // Parse numeric values
        const issuePrice = this.parseNumber($(cells[1]).text());
        const gmpPrice = this.parseNumber($(cells[2]).text());
        const gmpPercentage = this.parsePercentage($(cells[3]).text());

        // Skip if no GMP data available
        if (gmpPrice === null) {
          logger.debug({
            scraper: 'gmp-api',
            phase: 'parsing',
            ipoName,
          }, 'Skipping IPO with no GMP data');
          continue;
        }

        // Calculate expected listing price
        const expectedListingPrice = issuePrice && gmpPrice
          ? issuePrice + gmpPrice
          : null;

        if (!expectedListingPrice) {
          logger.debug({
            scraper: 'gmp-api',
            phase: 'parsing',
            ipoName,
          }, 'Skipping IPO with invalid expected listing price');
          continue;
        }

        // Optional fields (if available in table)
        const subjectRate = cells.length > 4 ? this.parseNumber($(cells[4]).text()) : null;
        const kostakRate = cells.length > 5 ? this.parseNumber($(cells[5]).text()) : null;
        const saudaDetails = cells.length > 6 ? $(cells[6]).text().trim() || null : null;

        gmpData.push({
          ipoName,
          gmp: gmpPrice,
          gmpPercentage,
          expectedListingPrice,
          subjectRate,
          kostakRate,
          saudaDetails,
          issuePrice,
          timestamp: new Date(),
        });
      } catch (error) {
        logger.warn({
          scraper: 'gmp-api',
          phase: 'parsing',
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to parse GMP row');
      }
    }

    return gmpData;
  }

  // ==================== DATA PARSING UTILITIES ====================

  /**
   * Parse number from text (handles ₹, Rs., commas, etc.)
   */
  private parseNumber(text: string): number | null {
    if (!text || text.trim() === '' || text === '-' || text.toLowerCase().includes('not listed') || text.toLowerCase().includes('n/a')) {
      return null;
    }

    // Remove currency symbols (₹, Rs.), commas, and spaces
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
   * Parse percentage (removes '%' suffix)
   */
  private parsePercentage(text: string): number | null {
    if (!text || text.trim() === '' || text === '-' || text.toLowerCase().includes('n/a')) {
      return null;
    }

    // Remove '%' suffix and parse
    const cleaned = text.replace(/%/g, '').trim();
    const num = parseFloat(cleaned);

    return isNaN(num) ? null : num;
  }

  // ==================== DATA VALIDATION ====================

  /**
   * Validate GMP data using Zod schema
   * AC: 3
   */
  private validateGMPData(data: unknown): GMPData | null {
    const result = GMPDataSchema.safeParse(data);

    if (!result.success) {
      logger.warn({
        scraper: 'gmp-api',
        phase: 'validation',
        ipoName: (data as any).ipoName,
        errors: result.error.issues,
      }, 'Validation failed for GMP data');
      return null;
    }

    return result.data;
  }

  // ==================== IPO MATCHING ====================

  /**
   * Normalize company name for matching
   * AC: 4
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
   * AC: 4 - 85% similarity threshold
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const normalized1 = this.normalizeCompanyName(str1);
    const normalized2 = this.normalizeCompanyName(str2);

    if (normalized1 === normalized2) return 100;
    if (normalized1.length === 0 || normalized2.length === 0) return 0;

    const distance = levenshtein(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);

    return ((maxLength - distance) / maxLength) * 100;
  }

  /**
   * Fetch all IPOs from database (with caching)
   * AC: 4 - Filter to active IPOs (OPEN, UPCOMING, CLOSED status)
   */
  private async fetchAllIPOs(filterStatus?: ('OPEN' | 'UPCOMING' | 'CLOSED')[]): Promise<Array<{ id: string; companyName: string; status: string }>> {
    if (this.ipoCache) {
      return this.ipoCache;
    }

    const db = await getDb();

    let query = db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        status: ipos.status,
      })
      .from(ipos);

    // Filter to active IPOs if specified (AC: 4)
    if (filterStatus && filterStatus.length > 0) {
      query = query.where(inArray(ipos.status, filterStatus)) as any;
    }

    const allIPOs = await query;

    this.ipoCache = allIPOs;
    return allIPOs;
  }

  /**
   * Match scraped data to existing IPO in database
   * AC: 4 - 85% similarity threshold
   */
  private async matchDataToIPO(data: GMPData, filterStatus?: ('OPEN' | 'UPCOMING' | 'CLOSED')[]): Promise<MatchResult> {
    const allIPOs = await this.fetchAllIPOs(filterStatus);

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
          matched: score >= 85, // AC: 4 - 85% threshold
        };
      }
    }

    if (!bestMatch.matched && bestMatch.matchScore > 0) {
      logger.debug({
        scraper: 'gmp-api',
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
  private async matchAllData(dataArray: GMPData[], filterStatus?: ('OPEN' | 'UPCOMING' | 'CLOSED')[]): Promise<MatchedGMPData[]> {
    const matchedData: MatchedGMPData[] = [];

    for (const data of dataArray) {
      const matchResult = await this.matchDataToIPO(data, filterStatus);
      matchedData.push({
        ...data,
        ipoId: matchResult.ipoId,
        matchScore: matchResult.matchScore,
      });

      // Log unmatched IPOs for manual review (AC: 4)
      if (!matchResult.matched) {
        logger.info({
          scraper: 'gmp-api',
          phase: 'matching',
          ipoName: data.ipoName,
          matchScore: matchResult.matchScore.toFixed(1),
        }, `Unmatched IPO: ${data.ipoName} (best match score: ${matchResult.matchScore.toFixed(1)}%)`);
      }
    }

    const matchCount = matchedData.filter(d => d.ipoId).length;
    logger.info({
      scraper: 'gmp-api',
      phase: 'matching-complete',
      matched: matchCount,
      unmatched: matchedData.length - matchCount,
      matchRate: matchedData.length > 0 ? ((matchCount / matchedData.length) * 100).toFixed(1) : '0',
    }, `Matching complete: ${matchCount}/${matchedData.length} matched`);

    return matchedData;
  }

  // ==================== DATABASE STORAGE ====================

  /**
   * Store GMP data in database using GMPRepository
   * AC: 3 - Use existing GMPRepository's createGMPRecord() method
   */
  private async storeGMPData(data: MatchedGMPData[]): Promise<void> {
    // Filter to only matched IPOs
    const matchedData = data.filter(d => d.ipoId);

    if (matchedData.length === 0) {
      logger.warn({ scraper: 'gmp-api', phase: 'storage' }, 'No matched IPOs to store');
      return;
    }

    // Initialize repository
    const db = await getDb();
    const redis = getRedisClient();
    this.gmpRepository = new GMPRepository(db, redis);

    // Store each GMP record (AC: 5 - graceful error handling)
    let successCount = 0;
    let failureCount = 0;

    for (const gmpData of matchedData) {
      if (!gmpData.ipoId) continue;

      try {
        const insertData: GMPRecordInsert = {
          ipoId: gmpData.ipoId,
          timestamp: gmpData.timestamp,
          gmp: gmpData.gmp,
          expectedListingPrice: gmpData.expectedListingPrice,
          subjectRate: gmpData.subjectRate,
          kostakRate: gmpData.kostakRate,
          saudaDetails: gmpData.saudaDetails,
          source: 'Chittorgarh', // AC: 3 - Source attribution
        };

        await this.gmpRepository.create(insertData);
        successCount++;

        // Rate limiting between inserts (AC: 5 - 3-second delay)
        await this.sleep(3000);
      } catch (error) {
        failureCount++;
        logger.error({
          scraper: 'gmp-api',
          phase: 'storage',
          ipoId: gmpData.ipoId,
          ipoName: gmpData.ipoName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to store GMP record');
        // Continue to next record (AC: 5 - graceful error handling)
      }
    }

    logger.info({
      scraper: 'gmp-api',
      phase: 'storage-complete',
      successCount,
      failureCount,
    }, `Storage complete: ${successCount} stored, ${failureCount} failed`);
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Sleep utility for rate limiting
   * AC: 5 - 3-second delay between requests
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const gmpAPIScraper = new GMPAPIScraper();
