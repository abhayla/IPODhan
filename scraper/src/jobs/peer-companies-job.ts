/**
 * Peer Companies Job
 *
 * Scheduled job to scrape peer company data for all IPOs with valid sectors
 * Runs: Daily at 4 AM IST
 * Duration: ~30-60 minutes for all IPOs
 */

import { db } from '@ipodhan/shared';
import { logger } from '../utils/logger.js';
import { scrapePeerCompanies } from '../scrapers/peer-companies-scraper.js';
import { createPeerCompanies } from '../services/data-persister.js';
import { PeerCompanyRepository } from '../repositories/peer-company-repository.js';
import * as schema from '@ipodhan/shared/db/schema';
import { isNull, not, inArray } from 'drizzle-orm';

export interface PeerCompaniesJobOptions {
  limit?: number; // Limit number of IPOs to process (for testing)
  force?: boolean; // Force re-scrape even if peer data exists
  ipoIds?: string[]; // Process specific IPO IDs only
}

export async function runPeerCompaniesJob(options: PeerCompaniesJobOptions = {}): Promise<void> {
  const startTime = Date.now();

  logger.info('[Peer Companies Job] Starting peer companies scraping job');

  try {
    // db is already imported from @ipodhan/shared
    const peerCompanyRepository = new PeerCompanyRepository(db);

    // Step 1: Get IPOs that need peer company data
    const ipos = await getIPOsForPeerScraping(db, options);

    if (ipos.length === 0) {
      logger.info('[Peer Companies Job] No IPOs found for peer company scraping');
      return;
    }

    logger.info(
      { ipoCount: ipos.length },
      `[Peer Companies Job] Found ${ipos.length} IPOs to process`
    );

    // Step 2: Process each IPO
    let successCount = 0;
    let errorCount = 0;

    for (const ipo of ipos) {
      try {
        logger.debug(
          { ipoId: ipo.id, companyName: ipo.companyName, sector: ipo.sector },
          '[Peer Companies Job] Processing IPO'
        );

        // Scrape peer companies
        const scrapedPeers = await scrapePeerCompanies(ipo.id, ipo.sector!);

        if (scrapedPeers.length === 0) {
          logger.warn(
            { ipoId: ipo.id, sector: ipo.sector },
            '[Peer Companies Job] No peer companies found'
          );
          continue;
        }

        // Persist to database
        const createdCount = await createPeerCompanies(
          peerCompanyRepository,
          ipo.id,
          scrapedPeers
        );

        logger.info(
          { ipoId: ipo.id, companyName: ipo.companyName, peerCount: createdCount },
          '[Peer Companies Job] ✓ Successfully scraped peer companies'
        );

        successCount++;

        // Rate limiting: wait 3 seconds between IPOs
        await new Promise((resolve) => setTimeout(resolve, 3000));

      } catch (error: any) {
        logger.error(
          {
            ipoId: ipo.id,
            companyName: ipo.companyName,
            error: error.message,
            stack: error.stack,
          },
          '[Peer Companies Job] ✗ Failed to scrape peer companies'
        );
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;

    logger.info(
      {
        duration,
        totalIPOs: ipos.length,
        successCount,
        errorCount,
        successRate: ((successCount / ipos.length) * 100).toFixed(2) + '%',
      },
      '[Peer Companies Job] ✓ Peer companies scraping job completed'
    );

  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      '[Peer Companies Job] ✗ Job failed with critical error'
    );
    throw error;
  }
}

/**
 * Get IPOs that need peer company data
 */
async function getIPOsForPeerScraping(
  db: any,
  options: PeerCompaniesJobOptions
): Promise<Array<{ id: string; companyName: string; sector: string }>> {
  let query = db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      sector: schema.ipos.sector,
    })
    .from(schema.ipos)
    .where(not(isNull(schema.ipos.sector))); // Only IPOs with valid sector

  // Filter by specific IPO IDs if provided
  if (options.ipoIds && options.ipoIds.length > 0) {
    query = query.where(inArray(schema.ipos.id, options.ipoIds));
  }

  // Limit results if specified
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const ipos = await query;

  return ipos.filter((ipo): ipo is { id: string; companyName: string; sector: string } =>
    ipo.sector !== null
  );
}
