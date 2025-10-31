/**
 * Financial Data Scraper Job
 *
 * Scheduled job that scrapes financial data from DRHP PDFs for all IPOs
 * that have documents but are missing financial_data entries.
 *
 * Schedule: Daily at 3 AM IST (after BSE document scraper completes)
 * Duration: 30-60 minutes for ~50 IPOs
 */

import { getDb, getRedisClient } from '@ipodhan/shared';
import {
  IPORepository,
  DocumentRepository,
  FinancialDataRepository,
  ScraperLogRepository,
} from '@ipodhan/shared';
import { scrapeFinancialData, batchScrapeFinancialData } from '../scrapers/financial-data-scraper.js';
import { createFinancialData } from '../services/data-persister.js';
import logger from '../utils/logger.js';

export async function runFinancialDataJob(): Promise<void> {
  const startTime = Date.now();
  const jobName = 'financial-data-scraper';

  logger.info('Starting financial data scraper job');

  try {
    // Initialize repositories
    const db = await getDb();
    const redis = getRedisClient();

    const ipoRepository = new IPORepository(db, redis);
    const documentRepository = new DocumentRepository(db, redis);
    const financialDataRepository = new FinancialDataRepository(db, redis);
    const scraperLogRepository = new ScraperLogRepository(db, redis);

    // Get all OPEN, CLOSED, and LISTED IPOs
    const ipos = await ipoRepository.findAll({
      status: ['OPEN', 'CLOSED', 'LISTED'] as any,
      limit: 500,
    });

    logger.info({ total: ipos.data.length }, 'Found IPOs to check');

    const iposToScrape: string[] = [];

    // Find IPOs that have DRHP but no financial data
    for (const ipo of ipos.data) {
      const documents = await documentRepository.findByIPO(ipo.id);
      const hasDRHP = documents.some(
        (doc) =>
          doc.documentType === 'DRHP' ||
          doc.documentType === 'RHP' ||
          doc.documentType === 'PROSPECTUS'
      );

      if (!hasDRHP) continue;

      const existingData = await financialDataRepository.findByIPO(ipo.id);
      if (!existingData) {
        iposToScrape.push(ipo.id);
      }
    }

    if (iposToScrape.length === 0) {
      logger.info('No IPOs need financial data scraping');

      await scraperLogRepository.create({
        scraperName: jobName,
        status: 'SUCCESS' as any,
        recordsScraped: 0,
        scrapedAt: new Date(),
      });

      return;
    }

    logger.info({ count: iposToScrape.length }, 'IPOs needing financial data');

    // Process IPOs one by one with error handling
    let successCount = 0;
    let failCount = 0;

    for (const ipoId of iposToScrape) {
      try {
        const scrapedData = await scrapeFinancialData(documentRepository, ipoId);

        if (scrapedData) {
          await createFinancialData(financialDataRepository, scrapedData);
          successCount++;
        } else {
          failCount++;
        }

        // Add delay between scrapes
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (error) {
        logger.error({ ipoId, error }, 'Failed to scrape financial data for IPO');
        failCount++;
      }
    }

    const duration = Date.now() - startTime;

    // Log job completion
    await scraperLogRepository.create({
      scraperName: jobName,
      status: failCount > 0 ? ('PARTIAL' as any) : ('SUCCESS' as any),
      recordsScraped: successCount,
      recordsFailed: failCount,
      scrapedAt: new Date(),
      duration: Math.round(duration / 1000), // seconds
    });

    logger.info(
      {
        duration: Math.round(duration / 1000),
        success: successCount,
        failed: failCount,
      },
      'Financial data scraper job completed'
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error({ error, duration }, 'Financial data scraper job failed');

    // Log failure
    try {
      const db = await getDb();
      const redis = getRedisClient();
      const scraperLogRepository = new ScraperLogRepository(db, redis);

      await scraperLogRepository.create({
        scraperName: jobName,
        status: 'FAILURE' as any,
        recordsScraped: 0,
        scrapedAt: new Date(),
        duration: Math.round(duration / 1000),
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    } catch (logError) {
      logger.error({ logError }, 'Failed to log scraper failure');
    }

    throw error;
  }
}
