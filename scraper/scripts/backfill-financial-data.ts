/**
 * Backfill Financial Data Script
 *
 * Scrapes and populates financial data for all IPOs that have DRHP documents
 * but are missing financial_data table entries.
 *
 * Usage:
 *   npx tsx scripts/backfill-financial-data.ts
 *   npx tsx scripts/backfill-financial-data.ts --limit=10
 *   npx tsx scripts/backfill-financial-data.ts --force  (re-scrape existing data)
 */

import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import {
  db,
  getRedisClient,
  IPORepository,
  DocumentRepository,
  FinancialDataRepository,
} from '@ipodhan/shared';
import { scrapeFinancialData } from '../src/scrapers/financial-data-scraper.js';
import { createFinancialData } from '../src/services/data-persister.js';
import logger from '../src/utils/logger.js';

interface BackfillOptions {
  limit?: number;
  force?: boolean; // Re-scrape even if data exists
  status?: string[]; // Filter by IPO status (e.g., ['OPEN', 'CLOSED', 'LISTED'])
}

/**
 * Parse command line arguments
 */
function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--status=')) {
      options.status = arg.split('=')[1].split(',');
    }
  }

  return options;
}

/**
 * Get IPOs that need financial data scraping
 */
async function getIPOsForBackfill(
  ipoRepository: IPORepository,
  documentRepository: DocumentRepository,
  financialDataRepository: FinancialDataRepository,
  options: BackfillOptions
): Promise<string[]> {
  logger.info('Finding IPOs that need financial data scraping');

  // Get all IPOs
  const allIPOs = await ipoRepository.findAll({
    status: options.status as any,
    limit: 1000, // Get a large batch
  });

  logger.info({ total: allIPOs.data.length }, 'Found IPOs');

  const iposNeedingData: string[] = [];

  for (const ipo of allIPOs.data) {
    // Check if IPO has DRHP document
    const documents = await documentRepository.findByIPO(ipo.id);
    const hasDRHP = documents.some(
      (doc) =>
        doc.documentType === 'DRHP' ||
        doc.documentType === 'RHP' ||
        doc.documentType === 'PROSPECTUS'
    );

    if (!hasDRHP) {
      logger.debug({ ipoId: ipo.id, companyName: ipo.companyName }, 'No DRHP document found, skipping');
      continue;
    }

    // Check if financial data already exists
    const existingData = await financialDataRepository.findByIPO(ipo.id);

    if (existingData && !options.force) {
      logger.debug(
        { ipoId: ipo.id, companyName: ipo.companyName },
        'Financial data already exists, skipping'
      );
      continue;
    }

    iposNeedingData.push(ipo.id);

    if (options.limit && iposNeedingData.length >= options.limit) {
      break;
    }
  }

  logger.info({ count: iposNeedingData.length }, 'IPOs needing financial data');

  return iposNeedingData;
}

/**
 * Main backfill function
 */
async function backfillFinancialData() {
  const startTime = Date.now();
  const options = parseArgs();

  logger.info({ options }, 'Starting financial data backfill');

  try {
    // Initialize repositories
    const redis = getRedisClient();

    const ipoRepository = new IPORepository(db, redis);
    const documentRepository = new DocumentRepository(db, redis);
    const financialDataRepository = new FinancialDataRepository(db, redis);

    // Get IPOs that need financial data
    const ipoIds = await getIPOsForBackfill(
      ipoRepository,
      documentRepository,
      financialDataRepository,
      options
    );

    if (ipoIds.length === 0) {
      logger.info('No IPOs need financial data backfill');
      return;
    }

    // Process each IPO
    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (let i = 0; i < ipoIds.length; i++) {
      const ipoId = ipoIds[i];

      try {
        logger.info({ ipoId, progress: `${i + 1}/${ipoIds.length}` }, 'Processing IPO');

        // Scrape financial data
        const scrapedData = await scrapeFinancialData(documentRepository, ipoId);

        if (!scrapedData) {
          logger.warn({ ipoId }, 'No financial data scraped, skipping');
          skipCount++;
          continue;
        }

        // Persist to database
        await createFinancialData(financialDataRepository, scrapedData);

        successCount++;
        logger.info({ ipoId, successCount }, 'Financial data backfilled successfully');

        // Add delay to avoid overwhelming servers
        await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay
      } catch (error) {
        logger.error({ ipoId, error }, 'Failed to backfill financial data');
        failCount++;
      }
    }

    const duration = Date.now() - startTime;
    const durationMin = Math.round(duration / 1000 / 60);

    logger.info(
      {
        total: ipoIds.length,
        success: successCount,
        failed: failCount,
        skipped: skipCount,
        duration: `${durationMin} minutes`,
      },
      'Financial data backfill completed'
    );

    // Print summary
    console.log('\n=== Financial Data Backfill Summary ===');
    console.log(`Total IPOs processed: ${ipoIds.length}`);
    console.log(`✅ Successfully scraped: ${successCount}`);
    console.log(`⚠️  Skipped (no data): ${skipCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`⏱️  Duration: ${durationMin} minutes`);
    console.log(`📊 Success rate: ${((successCount / ipoIds.length) * 100).toFixed(1)}%`);
    console.log('======================================\n');

    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Fatal error during backfill');
    process.exit(1);
  }
}

// Run backfill
backfillFinancialData();
