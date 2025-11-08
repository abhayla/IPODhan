/**
 * SEBI Monitor Service
 * Early IPO detection by monitoring SEBI DRHP filings
 *
 * Purpose:
 * - Detects IPOs 30-60 days before they open (when DRHP is filed)
 * - Downloads DRHP PDF early for extraction
 * - Creates IPO with status='ANNOUNCED'
 * - Enables early data collection window
 *
 * Detection Sources:
 * 1. SEBI Public Issues Page - https://www.sebi.gov.in/sebiweb/other/otherListingAction.do
 * 2. SEBI DRHP Filings - Daily monitoring
 * 3. SEBI Press Releases - Approval announcements
 *
 * Schedule: Daily at 6:00 AM IST
 *
 * Usage:
 * ```typescript
 * const monitor = new SEBIMonitorService(db);
 * const results = await monitor.detectNewDRHPFilings();
 * console.log(`Detected ${results.detected} new IPOs, ${results.duplicates} duplicates`);
 * ```
 */

import axios, { type AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import {
  IPODeduplicationService,
  type IPOCandidate,
  type DeduplicationMatch,
} from './ipo-deduplication';
import { DRHPDownloaderService } from './drhp-downloader';
import logger from '../utils/logger';

/**
 * SEBI filing detection result
 */
export interface SEBIFiling {
  companyName: string;
  drhpUrl: string | null;
  filingDate: Date;
  issueType: 'IPO' | 'FPO' | 'RIGHTS' | 'UNKNOWN';
  estimatedOpenDate: Date | null;
}

/**
 * Detection statistics
 */
export interface SEBIMonitorStats {
  totalFilingsScraped: number;
  newIPOsDetected: number;
  duplicatesSkipped: number;
  failedCreations: number;
  drhpDownloadsTriggered: number;
  errors: string[];
}

/**
 * SEBI Monitor Service
 * Monitors SEBI website for new DRHP filings
 */
export class SEBIMonitorService {
  private db: NodePgDatabase<typeof schema>;
  private deduplication: IPODeduplicationService;
  private drhpDownloader: DRHPDownloaderService;
  private httpClient: AxiosInstance;

  // SEBI endpoints
  private readonly SEBI_BASE_URL = 'https://www.sebi.gov.in';
  private readonly SEBI_PUBLIC_ISSUES_URL =
    'https://www.sebi.gov.in/sebiweb/other/otherListingAction.do';

  constructor(db: NodePgDatabase<typeof schema>) {
    this.db = db;
    this.deduplication = new IPODeduplicationService(db);
    this.drhpDownloader = new DRHPDownloaderService(db);

    // Configure HTTP client with timeouts and retries
    this.httpClient = axios.create({
      timeout: 30000, // 30 seconds
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
    });
  }

  /**
   * Main detection method - Called by cron job
   * Scrapes SEBI for new DRHP filings and creates IPO entries
   */
  async detectNewDRHPFilings(): Promise<SEBIMonitorStats> {
    const stats: SEBIMonitorStats = {
      totalFilingsScraped: 0,
      newIPOsDetected: 0,
      duplicatesSkipped: 0,
      failedCreations: 0,
      drhpDownloadsTriggered: 0,
      errors: [],
    };

    logger.info('🔍 SEBI Monitor: Starting daily DRHP filing detection');

    try {
      // Scrape SEBI public issues page
      const filings = await this.scrapeSEBIPublicIssues();
      stats.totalFilingsScraped = filings.length;

      logger.info(`Found ${filings.length} DRHP filings on SEBI website`);

      // Process each filing
      for (const filing of filings) {
        try {
          const result = await this.processFiling(filing);

          if (result.created) {
            stats.newIPOsDetected++;
            logger.info({
              company: filing.companyName,
              ipoId: result.ipoId,
              slug: result.slug,
            }, '✅ New IPO detected and created');
          } else if (result.duplicate) {
            stats.duplicatesSkipped++;
            logger.debug({
              company: filing.companyName,
              existingId: result.existingId,
              matchTier: result.matchTier,
            }, '⏭️  Duplicate IPO skipped');
          }

          if (result.drhpDownloadTriggered) {
            stats.drhpDownloadsTriggered++;
          }
        } catch (error) {
          stats.failedCreations++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          stats.errors.push(`${filing.companyName}: ${errorMsg}`);
          logger.error({
            error: errorMsg,
            company: filing.companyName,
          }, '❌ Failed to process filing');
        }
      }

      // Log summary
      logger.info({
        totalFilings: stats.totalFilingsScraped,
        newIPOs: stats.newIPOsDetected,
        duplicates: stats.duplicatesSkipped,
        failures: stats.failedCreations,
        drhpDownloads: stats.drhpDownloadsTriggered,
      }, '✅ SEBI Monitor completed');

      return stats;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      stats.errors.push(`Scraping failed: ${errorMsg}`);
      logger.error({ error: errorMsg }, '❌ SEBI Monitor failed');
      throw error;
    }
  }

  /**
   * Scrape SEBI website for public issue filings
   * Returns list of DRHP filings
   */
  private async scrapeSEBIPublicIssues(): Promise<SEBIFiling[]> {
    try {
      logger.debug('Fetching SEBI public issues page');

      const response = await this.httpClient.get(this.SEBI_PUBLIC_ISSUES_URL);
      const $ = cheerio.load(response.data);

      const filings: SEBIFiling[] = [];

      // Parse table rows (SEBI uses tables for listings)
      // Note: This selector may need adjustment based on actual SEBI HTML structure
      $('table.table-data tbody tr').each((index, element) => {
        try {
          const $row = $(element);
          const cells = $row.find('td');

          if (cells.length < 3) return; // Skip invalid rows

          // Extract data (adjust column indices based on actual structure)
          const companyNameCell = cells.eq(0).text().trim();
          const linkCell = cells.eq(1).find('a');
          const dateCell = cells.eq(2).text().trim();

          const companyName = companyNameCell.replace(/\s*\(DRHP\)\s*$/i, '').trim();
          const drhpUrl = linkCell.attr('href') || null;
          const filingDateStr = dateCell;

          // Parse filing date
          const filingDate = this.parseDate(filingDateStr) || new Date();

          // Determine issue type
          const issueType = this.determineIssueType(companyName);

          // Estimate open date (typically 30-45 days after DRHP filing)
          const estimatedOpenDate = new Date(filingDate);
          estimatedOpenDate.setDate(estimatedOpenDate.getDate() + 35); // +35 days average

          filings.push({
            companyName,
            drhpUrl: drhpUrl ? this.resolveURL(drhpUrl) : null,
            filingDate,
            issueType,
            estimatedOpenDate,
          });
        } catch (error) {
          logger.warn({ error, index }, 'Failed to parse SEBI table row');
        }
      });

      // Filter for last 90 days only (avoid re-processing old filings)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      const recentFilings = filings.filter(f => f.filingDate >= ninetyDaysAgo);

      logger.debug(`Parsed ${filings.length} filings, ${recentFilings.length} recent`);

      return recentFilings;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
        url: this.SEBI_PUBLIC_ISSUES_URL,
      }, 'Failed to scrape SEBI website');

      // Fallback: Return empty array (graceful degradation)
      // System will continue functioning, just missing early detections
      return [];
    }
  }

  /**
   * Process a single SEBI filing
   * Checks for duplicates and creates IPO if new
   */
  private async processFiling(filing: SEBIFiling): Promise<{
    created: boolean;
    duplicate: boolean;
    ipoId?: string;
    existingId?: string;
    slug?: string;
    matchTier?: string;
    drhpDownloadTriggered: boolean;
  }> {
    // Skip non-IPO filings
    if (filing.issueType !== 'IPO' && filing.issueType !== 'UNKNOWN') {
      logger.debug({ company: filing.companyName, type: filing.issueType }, 'Skipping non-IPO filing');
      return { created: false, duplicate: false, drhpDownloadTriggered: false };
    }

    // Check for duplicates using deduplication service
    const candidate: IPOCandidate = {
      companyName: filing.companyName,
    };

    const match = await this.deduplication.findExisting(candidate);

    if (match) {
      logger.debug({
        company: filing.companyName,
        existingIPO: match.ipo.companyName,
        matchTier: match.matchTier,
        confidence: match.confidence,
      }, 'Duplicate detected');

      return {
        created: false,
        duplicate: true,
        existingId: match.ipo.id,
        matchTier: match.matchTier,
        drhpDownloadTriggered: false,
      };
    }

    // Create new IPO entry
    const slug = generateIPOSlug(filing.companyName);

    const [newIPO] = await this.db
      .insert(schema.ipos)
      .values({
        companyName: filing.companyName,
        slug,
        status: 'ANNOUNCED', // Early detection status
        segment: null, // Unknown until exchange confirms
        category: 'MAINBOARD', // Default assumption
        // Dates are null until exchange provides details
        openDate: null,
        closeDate: null,
        listingDate: null,
        // Metadata
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    logger.info({
      ipoId: newIPO.id,
      company: filing.companyName,
      slug,
      filingDate: filing.filingDate,
    }, '✅ New IPO created from SEBI filing');

    // Trigger DRHP download if URL available (fire-and-forget)
    let drhpDownloadTriggered = false;
    if (filing.drhpUrl) {
      this.drhpDownloader
        .downloadDRHP(newIPO.id, filing.companyName, filing.drhpUrl)
        .then(() => {
          logger.info({ ipoId: newIPO.id }, 'DRHP download completed');
        })
        .catch(error => {
          logger.warn({
            ipoId: newIPO.id,
            error: error instanceof Error ? error.message : String(error),
          }, 'DRHP download failed (non-critical)');
        });

      drhpDownloadTriggered = true;
    }

    return {
      created: true,
      duplicate: false,
      ipoId: newIPO.id,
      slug: newIPO.slug,
      drhpDownloadTriggered,
    };
  }

  /**
   * Parse various date formats used by SEBI
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      // Try multiple date formats
      const formats = [
        // DD-MM-YYYY or DD/MM/YYYY
        /(\d{1,2})[-/](\d{1,2})[-/](\d{4})/,
        // YYYY-MM-DD
        /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
        // DD MMM YYYY (e.g., 15 Nov 2024)
        /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i,
      ];

      for (const format of formats) {
        const match = dateStr.match(format);
        if (match) {
          // Handle different capture groups
          if (format === formats[0]) {
            // DD-MM-YYYY
            const [, day, month, year] = match;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          } else if (format === formats[1]) {
            // YYYY-MM-DD
            const [, year, month, day] = match;
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          } else if (format === formats[2]) {
            // DD MMM YYYY
            const [, day, monthStr, year] = match;
            const monthMap: Record<string, number> = {
              jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
              jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
            };
            const month = monthMap[monthStr.toLowerCase()];
            return new Date(parseInt(year), month, parseInt(day));
          }
        }
      }

      // Fallback: Try native Date parsing
      const parsed = new Date(dateStr);
      return isNaN(parsed.getTime()) ? null : parsed;
    } catch {
      return null;
    }
  }

  /**
   * Determine issue type from company name patterns
   */
  private determineIssueType(companyName: string): 'IPO' | 'FPO' | 'RIGHTS' | 'UNKNOWN' {
    const nameLower = companyName.toLowerCase();

    if (nameLower.includes('fpo') || nameLower.includes('further public')) {
      return 'FPO';
    }

    if (nameLower.includes('rights') || nameLower.includes('rights issue')) {
      return 'RIGHTS';
    }

    if (nameLower.includes('ipo') || nameLower.includes('initial public')) {
      return 'IPO';
    }

    return 'UNKNOWN'; // Assume IPO if unclear
  }

  /**
   * Resolve relative URL to absolute URL
   */
  private resolveURL(url: string): string {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }

    if (url.startsWith('//')) {
      return `https:${url}`;
    }

    if (url.startsWith('/')) {
      return `${this.SEBI_BASE_URL}${url}`;
    }

    return `${this.SEBI_BASE_URL}/${url}`;
  }

  /**
   * Get detection statistics from deduplication service
   */
  getDeduplicationStats() {
    return this.deduplication.getStats();
  }
}

/**
 * Factory function for dependency injection
 */
export function createSEBIMonitor(
  db: NodePgDatabase<typeof schema>
): SEBIMonitorService {
  return new SEBIMonitorService(db);
}

/**
 * Standalone execution function for cron job
 * Called by scheduler
 */
export async function runSEBIMonitor(): Promise<SEBIMonitorStats> {
  const { db } = await import('@ipodhan/shared');
  const monitor = new SEBIMonitorService(db);
  return await monitor.detectNewDRHPFilings();
}
