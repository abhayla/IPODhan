import type { IPORepository, SubscriptionRepository, IPOInsert, SubscriptionInsert } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { generateSlug, sanitizeCompanyName } from '../utils/validators.js';
import type { ScraperSource } from './types.js';

/**
 * PostgreSQL error codes (Story 11.2 - Enhanced error logging)
 */
const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',      // Duplicate key (e.g., duplicate slug)
  NOT_NULL_VIOLATION: '23502',    // Missing required field
  NUMERIC_OVERFLOW: '22003',      // Numeric field overflow
  FOREIGN_KEY_VIOLATION: '23503', // Invalid foreign key
  CONNECTION_ERROR: '08000',      // Connection exception (transient)
  CONNECTION_FAILURE: '08006',    // Connection failure (transient)
};

/**
 * Check if PostgreSQL error should skip retry (permanent errors)
 */
function shouldSkipRetry(error: any): boolean {
  const pgCode = error?.code;
  return [
    PG_ERROR_CODES.UNIQUE_VIOLATION,
    PG_ERROR_CODES.NOT_NULL_VIOLATION,
    PG_ERROR_CODES.NUMERIC_OVERFLOW,
    PG_ERROR_CODES.FOREIGN_KEY_VIOLATION,
  ].includes(pgCode);
}

/**
 * Retry an async operation with exponential backoff
 * Enhanced with PostgreSQL error code detection (Story 11.2)
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = config.scraper.retryAttempts,
  delays: number[] = config.scraper.retryDelays
): Promise<T> {
  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Enhanced error logging (Story 11.2)
      const pgErrorDetails = {
        message: error?.message,
        code: error?.code,
        constraint: error?.constraint,
        column: error?.column,
        detail: error?.detail,
        hint: error?.hint,
        table: error?.table,
      };

      logger.error(
        {
          ...pgErrorDetails,
          attempt: attempt + 1,
          maxAttempts,
          operation: operationName,
        },
        'Database operation failed - PostgreSQL error details'
      );

      // Skip retry for permanent errors (Story 11.2)
      if (shouldSkipRetry(error)) {
        logger.error(
          {
            code: error?.code,
            constraint: error?.constraint,
            operation: operationName,
          },
          'Permanent database error detected - skipping retry'
        );
        throw error; // Don't retry constraint violations
      }

      if (attempt < maxAttempts - 1) {
        const delay = delays[attempt] || delays[delays.length - 1];
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts,
            delay,
            error: error?.message,
            operation: operationName
          },
          'Transient error - retrying with exponential backoff'
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Merge listing exchanges for dual-listed IPOs
 * Adds new exchange to array if not already present
 * @param existingExchanges - Current listing exchanges
 * @param newExchange - New exchange to add
 * @returns Merged array with deduplicated exchanges
 */
function mergeListingExchanges(
  existingExchanges: ('NSE' | 'BSE')[],
  newExchange: 'NSE' | 'BSE'
): ('NSE' | 'BSE')[] {
  const merged = [...existingExchanges];
  if (!merged.includes(newExchange)) {
    merged.push(newExchange);
  }
  return merged;
}

/**
 * Upsert IPO data to database with retry logic
 * Handles merge logic for dual-listed IPOs (both NSE and BSE)
 * @param ipoRepository - IPO repository instance
 * @param scrapedIPO - Validated scraped IPO data
 * @param source - Source exchange ('NSE' | 'BSE') for merge logic
 * @returns IPO ID on success
 */
export async function upsertIPO(
  ipoRepository: IPORepository,
  scrapedIPO: ScrapedIPO,
  source: ScraperSource = 'NSE'
): Promise<string> {
  const startTime = Date.now();
  const slug = generateSlug(scrapedIPO.companyName);

  logger.debug({ companyName: scrapedIPO.companyName, slug, source }, 'Upserting IPO');

  const result = await retryWithBackoff(
    async () => {
      // Find existing IPO by slug
      const existingIPO = await ipoRepository.findBySlug(slug);

      // Determine listing exchange(s)
      let listingExchanges: ('NSE' | 'BSE')[];
      if (scrapedIPO.listingExchange === 'BOTH') {
        listingExchanges = ['NSE', 'BSE'];
      } else {
        listingExchanges = [scrapedIPO.listingExchange];
      }

      const ipoData: Partial<IPOInsert> = {
        companyName: sanitizeCompanyName(scrapedIPO.companyName),
        slug,
        category: scrapedIPO.category,
        sector: scrapedIPO.sector,
        issueSize: scrapedIPO.issueSize.toString(),
        // Round price values to integers for INTEGER fields in database
        priceRangeMin: scrapedIPO.priceRangeMin ? Math.round(scrapedIPO.priceRangeMin) : undefined,
        priceRangeMax: scrapedIPO.priceRangeMax ? Math.round(scrapedIPO.priceRangeMax) : undefined,
        lotSize: scrapedIPO.lotSize || 1, // Default to 1 if not provided (NSE doesn't always provide)
        faceValue: scrapedIPO.faceValue || 10, // Default to 10 if not provided
        status: scrapedIPO.status as any,
        openDate: scrapedIPO.openDate,
        closeDate: scrapedIPO.closeDate,
        allotmentDate: scrapedIPO.allotmentDate,
        listingDate: scrapedIPO.listingDate,
        companyDescription: scrapedIPO.companyDescription,
        registrar: scrapedIPO.registrar,
        leadManagers: scrapedIPO.leadManagers,
        listingExchanges,
        lastScrapedAt: new Date(), // Track last successful scrape time (Story 7.4)
        updatedAt: new Date(),
        // Symbol: Only set if scraper explicitly provides it (NSE/BSE have symbols, upcoming IPOs may not)
        symbol: scrapedIPO.symbol || undefined
      } as any;

      if (existingIPO) {
        // MERGE LOGIC for dual-listed IPOs
        // Only merge exchanges for actual exchange sources (NSE/BSE), not for aggregator sources
        let mergedExchanges = existingIPO.listingExchanges as ('NSE' | 'BSE')[];
        if (source === 'NSE' || source === 'BSE') {
          const currentExchange = scrapedIPO.listingExchange === 'BOTH' ? source : scrapedIPO.listingExchange;
          mergedExchanges = mergeListingExchanges(mergedExchanges, currentExchange);
        }

        // Check for data discrepancies
        if (existingIPO.issueSize !== ipoData.issueSize && source === 'BSE') {
          logger.warn(
            {
              companyName: scrapedIPO.companyName,
              nseIssueSize: existingIPO.issueSize,
              bseIssueSize: ipoData.issueSize
            },
            'Data mismatch detected: NSE vs BSE issue size differs, prioritizing NSE data'
          );
          // Prioritize NSE data - don't overwrite issue size
          delete ipoData.issueSize;
        }

        // Update with merged exchanges
        ipoData.listingExchanges = mergedExchanges;

        logger.debug(
          { ipoId: existingIPO.id, slug, exchanges: mergedExchanges },
          `Updating existing IPO with ${source} listing`
        );
        await ipoRepository.update(existingIPO.id, ipoData);

        // Log merge operation
        if (mergedExchanges.length > (existingIPO.listingExchanges as string[]).length) {
          logger.info(
            { slug, exchanges: mergedExchanges },
            `IPO ${slug} updated with ${source} listing (dual-listed)`
          );
        }

        return existingIPO.id;
      } else {
        // Create new IPO
        logger.debug({ slug, source }, `Creating new ${source} IPO`);
        const newIPO = await ipoRepository.create({
          ...ipoData,
          createdAt: new Date()
        } as IPOInsert);

        logger.info({ slug, source }, `New ${source} IPO ${slug} created`);
        return newIPO.id;
      }
    },
    `Upsert IPO: ${scrapedIPO.companyName}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { companyName: scrapedIPO.companyName, ipoId: result, source, duration },
    'IPO upserted successfully'
  );

  return result;
}

/**
 * Create subscription snapshot with retry logic
 * @param subscriptionRepository - Subscription repository instance
 * @param ipoId - IPO ID to associate subscription with
 * @param scrapedSubscription - Validated scraped subscription data
 * @returns Subscription ID on success
 */
export async function createSubscriptionSnapshot(
  subscriptionRepository: SubscriptionRepository,
  ipoId: string,
  scrapedSubscription: ScrapedSubscription
): Promise<string> {
  const startTime = Date.now();

  logger.debug({ ipoId, companyName: scrapedSubscription.ipoCompanyName }, 'Creating subscription snapshot');

  const result = await retryWithBackoff(
    async () => {
      const subscriptionData: SubscriptionInsert = {
        ipoId,
        timestamp: new Date(scrapedSubscription.timestamp),
        qibSubscription: scrapedSubscription.qibSubscription.toString(),
        niiSubscription: scrapedSubscription.niiSubscription.toString(),
        retailSubscription: scrapedSubscription.retailSubscription.toString(),
        totalSubscription: scrapedSubscription.totalSubscription.toString(),
        employeeSubscription: scrapedSubscription.employeeSubscription?.toString(),
        anchorInvestorSubscription: scrapedSubscription.anchorInvestorSubscription?.toString(),
        bNIISubscription: scrapedSubscription.bNIISubscription?.toString(),
        sNIISubscription: scrapedSubscription.sNIISubscription?.toString(),
        retailHNISubscription: scrapedSubscription.retailHNISubscription?.toString(),
        retailOthersSubscription: scrapedSubscription.retailOthersSubscription?.toString()
      };

      const snapshot = await subscriptionRepository.createSnapshot(subscriptionData);
      return snapshot.id;
    },
    `Create subscription snapshot for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { ipoId, subscriptionId: result, duration },
    'Subscription snapshot created successfully'
  );

  return result;
}
