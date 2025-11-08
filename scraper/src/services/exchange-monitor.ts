/**
 * Exchange Monitor Service
 * Real-time IPO detection and status tracking from NSE and BSE
 *
 * Purpose:
 * - Detects new IPOs when they appear on exchange websites
 * - Tracks status changes (ANNOUNCED → UPCOMING → OPEN → CLOSED → LISTED)
 * - Prevents duplicate IPO creation
 * - Triggers downstream processing (DRHP, consolidation)
 *
 * Detection Logic:
 * 1. Fetch current IPOs from NSE and BSE
 * 2. Check each against database using deduplication
 * 3. Create new IPO if genuinely new
 * 4. Update existing IPO if status changed
 * 5. Trigger DRHP download for new IPOs
 *
 * Schedule: Hourly (more frequent during market hours)
 *
 * Usage:
 * ```typescript
 * const monitor = new ExchangeMonitorService(db);
 * const results = await monitor.detectChanges();
 * console.log(`Detected ${results.newIPOs} new, ${results.statusChanges} updates`);
 * ```
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, or } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import type { IPO, IPOStatus } from '@ipodhan/shared/db/types';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import {
  IPODeduplicationService,
  type IPOCandidate,
  type DeduplicationMatch,
} from './ipo-deduplication';
import { DRHPDownloaderService } from './drhp-downloader';
import { scrapeNSEIPOs, type NSEScrapeResult } from '../scrapers/nse-scraper';
import { scrapeBSE, type BSEScraperResult } from '../scrapers/bse-scraper';
import logger from '../utils/logger';

/**
 * Exchange IPO candidate
 * Minimal data needed for detection
 */
export interface ExchangeIPO {
  companyName: string;
  source: 'NSE' | 'BSE';
  status: IPOStatus;
  openDate?: Date | null;
  closeDate?: Date | null;
  issueSize?: number | null;
  priceRange?: string | null;
  segment?: 'MAINBOARD' | 'SME' | null;
}

/**
 * Monitor detection result
 */
export interface MonitorDetectionResult {
  newIPOs: number;
  statusChanges: number;
  duplicatesSkipped: number;
  errors: number;
  drhpDownloadsTriggered: number;
  details: {
    newIPOsList: Array<{ companyName: string; id: string; source: string }>;
    statusChangesList: Array<{
      companyName: string;
      id: string;
      oldStatus: string;
      newStatus: string;
    }>;
    errorsList: string[];
  };
}

/**
 * Exchange Monitor Service
 * Monitors NSE and BSE for new IPOs and status changes
 */
export class ExchangeMonitorService {
  private db: NodePgDatabase<typeof schema>;
  private deduplication: IPODeduplicationService;
  private drhpDownloader: DRHPDownloaderService;

  constructor(db: NodePgDatabase<typeof schema>) {
    this.db = db;
    this.deduplication = new IPODeduplicationService(db);
    this.drhpDownloader = new DRHPDownloaderService(db);
  }

  /**
   * Main detection method - Called by cron job
   * Checks NSE and BSE for changes
   */
  async detectChanges(): Promise<MonitorDetectionResult> {
    const result: MonitorDetectionResult = {
      newIPOs: 0,
      statusChanges: 0,
      duplicatesSkipped: 0,
      errors: 0,
      drhpDownloadsTriggered: 0,
      details: {
        newIPOsList: [],
        statusChangesList: [],
        errorsList: [],
      },
    };

    logger.info('🔍 Exchange Monitor: Starting IPO detection sweep');

    try {
      // Fetch from both exchanges in parallel
      const [nseResult, bseResult] = await Promise.allSettled([
        this.fetchNSEIPOs(),
        this.fetchBSEIPOs(),
      ]);

      // Process NSE results
      if (nseResult.status === 'fulfilled') {
        const nseStats = await this.processExchangeIPOs(nseResult.value, 'NSE');
        this.mergeStats(result, nseStats);
      } else {
        logger.error({
          error: nseResult.reason instanceof Error ? nseResult.reason.message : String(nseResult.reason),
        }, '❌ NSE fetch failed');
        result.errors++;
        result.details.errorsList.push(`NSE fetch failed: ${nseResult.reason}`);
      }

      // Process BSE results
      if (bseResult.status === 'fulfilled') {
        const bseStats = await this.processExchangeIPOs(bseResult.value, 'BSE');
        this.mergeStats(result, bseStats);
      } else {
        logger.error({
          error: bseResult.reason instanceof Error ? bseResult.reason.message : String(bseResult.reason),
        }, '❌ BSE fetch failed');
        result.errors++;
        result.details.errorsList.push(`BSE fetch failed: ${bseResult.reason}`);
      }

      // Log summary
      logger.info({
        newIPOs: result.newIPOs,
        statusChanges: result.statusChanges,
        duplicates: result.duplicatesSkipped,
        errors: result.errors,
        drhpDownloads: result.drhpDownloadsTriggered,
      }, '✅ Exchange Monitor completed');

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, '❌ Exchange Monitor failed');
      result.errors++;
      result.details.errorsList.push(`Monitor failed: ${errorMsg}`);
      return result;
    }
  }

  /**
   * Fetch IPOs from NSE
   */
  private async fetchNSEIPOs(): Promise<ExchangeIPO[]> {
    logger.debug('Fetching IPOs from NSE');

    try {
      const nseData: NSEScrapeResult = await scrapeNSEIPOs();

      const ipos: ExchangeIPO[] = [];

      // Convert NSE data to ExchangeIPO format
      for (const ipo of nseData.ipos) {
        ipos.push({
          companyName: ipo.company_name,
          source: 'NSE',
          status: this.mapNSEStatus(ipo.status || 'UPCOMING'),
          openDate: ipo.open_date || null,
          closeDate: ipo.close_date || null,
          issueSize: ipo.issue_size || null,
          priceRange: ipo.price_range || null,
          segment: ipo.segment || 'MAINBOARD',
        });
      }

      logger.debug(`Fetched ${ipos.length} IPOs from NSE`);
      return ipos;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'NSE IPO fetch failed');
      throw error;
    }
  }

  /**
   * Fetch IPOs from BSE
   */
  private async fetchBSEIPOs(): Promise<ExchangeIPO[]> {
    logger.debug('Fetching IPOs from BSE');

    try {
      const bseData: BSEScraperResult = await scrapeBSE();

      const ipos: ExchangeIPO[] = [];

      // Convert BSE data to ExchangeIPO format
      for (const ipo of bseData.ipos) {
        ipos.push({
          companyName: ipo.company_name,
          source: 'BSE',
          status: this.mapBSEStatus(ipo.status || 'UPCOMING'),
          openDate: ipo.open_date || null,
          closeDate: ipo.close_date || null,
          issueSize: ipo.issue_size || null,
          priceRange: ipo.price_range || null,
          segment: ipo.segment || 'MAINBOARD',
        });
      }

      logger.debug(`Fetched ${ipos.length} IPOs from BSE`);
      return ipos;
    } catch (error) {
      logger.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'BSE IPO fetch failed');
      throw error;
    }
  }

  /**
   * Process IPOs from an exchange
   * Creates new IPOs or updates existing ones
   */
  private async processExchangeIPOs(
    ipos: ExchangeIPO[],
    source: 'NSE' | 'BSE'
  ): Promise<MonitorDetectionResult> {
    const result: MonitorDetectionResult = {
      newIPOs: 0,
      statusChanges: 0,
      duplicatesSkipped: 0,
      errors: 0,
      drhpDownloadsTriggered: 0,
      details: {
        newIPOsList: [],
        statusChangesList: [],
        errorsList: [],
      },
    };

    for (const ipo of ipos) {
      try {
        const candidate: IPOCandidate = {
          companyName: ipo.companyName,
          openDate: ipo.openDate,
          closeDate: ipo.closeDate,
        };

        const match = await this.deduplication.findExisting(candidate);

        if (match) {
          // Existing IPO - Check for status changes
          const statusChanged = await this.checkAndUpdateStatus(match.ipo, ipo);

          if (statusChanged) {
            result.statusChanges++;
            result.details.statusChangesList.push({
              companyName: ipo.companyName,
              id: match.ipo.id,
              oldStatus: match.ipo.status,
              newStatus: ipo.status,
            });

            logger.info({
              company: ipo.companyName,
              oldStatus: match.ipo.status,
              newStatus: ipo.status,
              source,
            }, '📊 Status change detected');
          } else {
            result.duplicatesSkipped++;
          }
        } else {
          // New IPO - Create it
          const newIPO = await this.createNewIPO(ipo);

          result.newIPOs++;
          result.details.newIPOsList.push({
            companyName: ipo.companyName,
            id: newIPO.id,
            source,
          });

          logger.info({
            company: ipo.companyName,
            id: newIPO.id,
            source,
            status: ipo.status,
          }, '✅ New IPO detected from exchange');

          // Trigger DRHP download for new IPOs (fire-and-forget)
          this.triggerDRHPDownload(newIPO.id, newIPO.companyName);
          result.drhpDownloadsTriggered++;
        }
      } catch (error) {
        result.errors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.details.errorsList.push(`${ipo.companyName}: ${errorMsg}`);

        logger.error({
          error: errorMsg,
          company: ipo.companyName,
        }, '❌ Failed to process exchange IPO');
      }
    }

    return result;
  }

  /**
   * Create new IPO from exchange data
   */
  private async createNewIPO(exchangeIPO: ExchangeIPO): Promise<IPO> {
    const slug = generateIPOSlug(exchangeIPO.companyName);

    const [newIPO] = await this.db
      .insert(schema.ipos)
      .values({
        companyName: exchangeIPO.companyName,
        slug,
        status: exchangeIPO.status,
        segment: exchangeIPO.segment,
        category: exchangeIPO.segment === 'SME' ? 'SME' : 'MAINBOARD',
        openDate: exchangeIPO.openDate,
        closeDate: exchangeIPO.closeDate,
        issueSize: exchangeIPO.issueSize,
        priceRange: exchangeIPO.priceRange,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return newIPO;
  }

  /**
   * Check if IPO status changed and update if needed
   * Returns true if status was updated
   */
  private async checkAndUpdateStatus(
    existingIPO: IPO,
    exchangeIPO: ExchangeIPO
  ): Promise<boolean> {
    if (existingIPO.status === exchangeIPO.status) {
      return false; // No change
    }

    // Status changed - Update database
    await this.db
      .update(schema.ipos)
      .set({
        status: exchangeIPO.status,
        // Also update dates if they were null before
        openDate: exchangeIPO.openDate || existingIPO.openDate,
        closeDate: exchangeIPO.closeDate || existingIPO.closeDate,
        updatedAt: new Date(),
      })
      .where(eq(schema.ipos.id, existingIPO.id));

    return true;
  }

  /**
   * Trigger DRHP download (fire-and-forget)
   */
  private triggerDRHPDownload(ipoId: string, companyName: string): void {
    this.drhpDownloader
      .downloadDRHP(ipoId, companyName, null) // Will search for DRHP URL
      .then(() => {
        logger.debug({ ipoId }, 'DRHP download completed');
      })
      .catch(error => {
        logger.warn({
          ipoId,
          error: error instanceof Error ? error.message : String(error),
        }, 'DRHP download failed (non-critical)');
      });
  }

  /**
   * Map NSE status string to IPOStatus enum
   */
  private mapNSEStatus(nseStatus: string): IPOStatus {
    const status = nseStatus.toUpperCase();

    if (status.includes('OPEN') || status.includes('BIDDING')) {
      return 'OPEN';
    }
    if (status.includes('CLOSE') || status.includes('SUBSCRIBED')) {
      return 'CLOSED';
    }
    if (status.includes('LIST')) {
      return 'LISTED';
    }
    if (status.includes('UPCOMING') || status.includes('FORTHCOMING')) {
      return 'UPCOMING';
    }
    if (status.includes('ANNOUNCED')) {
      return 'ANNOUNCED';
    }

    return 'UPCOMING'; // Default
  }

  /**
   * Map BSE status string to IPOStatus enum
   */
  private mapBSEStatus(bseStatus: string): IPOStatus {
    return this.mapNSEStatus(bseStatus); // Same logic for now
  }

  /**
   * Merge stats from multiple sources
   */
  private mergeStats(
    target: MonitorDetectionResult,
    source: MonitorDetectionResult
  ): void {
    target.newIPOs += source.newIPOs;
    target.statusChanges += source.statusChanges;
    target.duplicatesSkipped += source.duplicatesSkipped;
    target.errors += source.errors;
    target.drhpDownloadsTriggered += source.drhpDownloadsTriggered;

    target.details.newIPOsList.push(...source.details.newIPOsList);
    target.details.statusChangesList.push(...source.details.statusChangesList);
    target.details.errorsList.push(...source.details.errorsList);
  }
}

/**
 * Factory function for dependency injection
 */
export function createExchangeMonitor(
  db: NodePgDatabase<typeof schema>
): ExchangeMonitorService {
  return new ExchangeMonitorService(db);
}

/**
 * Standalone execution function for cron job
 * Called by scheduler
 */
export async function runExchangeMonitor(): Promise<MonitorDetectionResult> {
  const { db } = await import('@ipodhan/shared');
  const monitor = new ExchangeMonitorService(db);
  return await monitor.detectChanges();
}
