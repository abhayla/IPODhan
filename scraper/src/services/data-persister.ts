import type { IPORepository } from '@web/lib/repositories/ipo-repository';
import type { SubscriptionRepository } from '@web/lib/repositories/subscription-repository';
import type { IPOInsert, SubscriptionInsert } from '@web/lib/repositories/types';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { generateSlug, sanitizeCompanyName } from '../utils/validators.js';

/**
 * Retry an async operation with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  operationName: string,
  maxAttempts: number = config.scraper.retryAttempts,
  delays: number[] = config.scraper.retryDelays
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts - 1) {
        const delay = delays[attempt] || delays[delays.length - 1];
        logger.warn(
          {
            attempt: attempt + 1,
            maxAttempts,
            delay,
            error: lastError.message,
            operation: operationName
          },
          'Operation failed, retrying with exponential backoff'
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`${operationName} failed after ${maxAttempts} attempts: ${lastError?.message}`);
}

/**
 * Upsert IPO data to database with retry logic
 * @param ipoRepository - IPO repository instance
 * @param scrapedIPO - Validated scraped IPO data
 * @returns IPO ID on success
 */
export async function upsertIPO(
  ipoRepository: IPORepository,
  scrapedIPO: ScrapedIPO
): Promise<string> {
  const startTime = Date.now();
  const slug = generateSlug(scrapedIPO.companyName);

  logger.debug({ companyName: scrapedIPO.companyName, slug }, 'Upserting IPO');

  const result = await retryWithBackoff(
    async () => {
      // Find existing IPO by slug
      const existingIPO = await ipoRepository.findBySlug(slug);

      const ipoData: Partial<IPOInsert> = {
        companyName: sanitizeCompanyName(scrapedIPO.companyName),
        slug,
        category: scrapedIPO.category,
        sector: scrapedIPO.sector,
        issueSize: scrapedIPO.issueSize.toString(),
        priceRangeMin: scrapedIPO.priceRangeMin,
        priceRangeMax: scrapedIPO.priceRangeMax,
        lotSize: scrapedIPO.lotSize,
        faceValue: scrapedIPO.faceValue,
        status: scrapedIPO.status,
        openDate: scrapedIPO.openDate,
        closeDate: scrapedIPO.closeDate,
        allotmentDate: scrapedIPO.allotmentDate,
        listingDate: scrapedIPO.listingDate,
        companyDescription: scrapedIPO.companyDescription,
        registrar: scrapedIPO.registrar,
        leadManagers: scrapedIPO.leadManagers,
        listingExchanges: [scrapedIPO.listingExchange === 'BOTH' ? 'NSE' : scrapedIPO.listingExchange] as ('NSE' | 'BSE')[],
        updatedAt: new Date()
      };

      if (existingIPO) {
        // Update existing IPO
        logger.debug({ ipoId: existingIPO.id, slug }, 'Updating existing IPO');
        await ipoRepository.update(existingIPO.id, ipoData);
        return existingIPO.id;
      } else {
        // Create new IPO
        logger.debug({ slug }, 'Creating new IPO');
        const newIPO = await ipoRepository.create({
          ...ipoData,
          createdAt: new Date()
        } as IPOInsert);
        return newIPO.id;
      }
    },
    `Upsert IPO: ${scrapedIPO.companyName}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { companyName: scrapedIPO.companyName, ipoId: result, duration },
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
