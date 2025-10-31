/**
 * IPO Reviews Job
 *
 * Scheduled job to aggregate IPO reviews from multiple sources for all IPOs
 * Runs: Every 6 hours (reviews update less frequently than other data)
 * Duration: ~30-45 minutes for all IPOs
 */

import { db } from '@ipodhan/shared';
import { logger } from '../utils/logger.js';
import { aggregateIPOReviews } from '../scrapers/ipo-reviews-aggregator.js';
import { createIPOReviews } from '../services/data-persister.js';
import { ReviewRepository } from '../repositories/review-repository.js';
import * as schema from '@ipodhan/shared/db/schema';
import { inArray, or, eq } from 'drizzle-orm';

export interface IPOReviewsJobOptions {
  limit?: number; // Limit number of IPOs to process (for testing)
  force?: boolean; // Force re-scrape even if reviews exist
  ipoIds?: string[]; // Process specific IPO IDs only
  status?: 'OPEN' | 'CLOSED' | 'LISTED' | 'UPCOMING'; // Filter by IPO status
}

export async function runIPOReviewsJob(options: IPOReviewsJobOptions = {}): Promise<void> {
  const startTime = Date.now();

  logger.info('[IPO Reviews Job] Starting IPO reviews aggregation job');

  try {
    // db is already imported from @ipodhan/shared
    const reviewRepository = new ReviewRepository(db);

    // Step 1: Get IPOs that need reviews
    const ipos = await getIPOsForReviewScraping(db, options);

    if (ipos.length === 0) {
      logger.info('[IPO Reviews Job] No IPOs found for review aggregation');
      return;
    }

    logger.info(
      { ipoCount: ipos.length },
      `[IPO Reviews Job] Found ${ipos.length} IPOs to process`
    );

    // Step 2: Process each IPO
    let successCount = 0;
    let errorCount = 0;
    let totalReviewsScraped = 0;

    for (const ipo of ipos) {
      try {
        logger.debug(
          { ipoId: ipo.id, companyName: ipo.companyName, slug: ipo.slug },
          '[IPO Reviews Job] Processing IPO'
        );

        // Aggregate reviews from all sources
        const scrapedReviews = await aggregateIPOReviews({
          ipoId: ipo.id,
          companyName: ipo.companyName,
          slug: ipo.slug,
        });

        if (scrapedReviews.length === 0) {
          logger.warn(
            { ipoId: ipo.id, companyName: ipo.companyName },
            '[IPO Reviews Job] No reviews found from any source'
          );
          continue;
        }

        // Persist to database
        const createdCount = await createIPOReviews(
          reviewRepository,
          ipo.id,
          ipo.segment,
          scrapedReviews
        );

        logger.info(
          { ipoId: ipo.id, companyName: ipo.companyName, reviewCount: createdCount },
          '[IPO Reviews Job] ✓ Successfully aggregated reviews'
        );

        successCount++;
        totalReviewsScraped += createdCount;

        // Rate limiting: wait 5 seconds between IPOs (reviews are slower to scrape)
        await new Promise((resolve) => setTimeout(resolve, 5000));

      } catch (error: any) {
        logger.error(
          {
            ipoId: ipo.id,
            companyName: ipo.companyName,
            error: error.message,
            stack: error.stack,
          },
          '[IPO Reviews Job] ✗ Failed to aggregate reviews'
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
        totalReviews: totalReviewsScraped,
        avgReviewsPerIPO: (totalReviewsScraped / successCount || 0).toFixed(1),
        successRate: ((successCount / ipos.length) * 100).toFixed(2) + '%',
      },
      '[IPO Reviews Job] ✓ IPO reviews aggregation job completed'
    );

  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
      },
      '[IPO Reviews Job] ✗ Job failed with critical error'
    );
    throw error;
  }
}

/**
 * Get IPOs that need reviews
 * Priority: OPEN > CLOSED > LISTED
 */
async function getIPOsForReviewScraping(
  db: any,
  options: IPOReviewsJobOptions
): Promise<Array<{ id: string; companyName: string; slug: string; segment: 'MAINBOARD' | 'SME' }>> {
  let query = db
    .select({
      id: schema.ipos.id,
      companyName: schema.ipos.companyName,
      slug: schema.ipos.slug,
      segment: schema.ipos.segment,
    })
    .from(schema.ipos);

  // Filter by status (default: OPEN, CLOSED, LISTED - exclude UPCOMING)
  if (options.status) {
    query = query.where(eq(schema.ipos.status, options.status));
  } else {
    // Default: Focus on OPEN and recently CLOSED IPOs (most relevant for reviews)
    query = query.where(
      or(
        eq(schema.ipos.status, 'OPEN'),
        eq(schema.ipos.status, 'CLOSED'),
        eq(schema.ipos.status, 'LISTED')
      )
    );
  }

  // Filter by specific IPO IDs if provided
  if (options.ipoIds && options.ipoIds.length > 0) {
    query = query.where(inArray(schema.ipos.id, options.ipoIds));
  }

  // Limit results if specified
  if (options.limit) {
    query = query.limit(options.limit);
  }

  const ipos = await query;
  return ipos as Array<{ id: string; companyName: string; slug: string; segment: 'MAINBOARD' | 'SME' }>;
}
