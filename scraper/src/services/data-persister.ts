import type { IPORepository, SubscriptionRepository, GMPRepository, FinancialDataRepository, IPOInsert, SubscriptionInsert, GMPRecordInsert, FinancialDataInsert } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { config } from '../config.js';
import type { ScrapedIPO, ScrapedSubscription } from '../utils/validators.js';
import { generateSlug, sanitizeCompanyName } from '../utils/validators.js';
import { validateLotSize } from '../utils/lot-size-validator.js';
import type { ScraperSource } from './types.js';
import type { ScrapedFinancialData } from '../scrapers/financial-data-scraper.js';
import type { ScrapedPeerCompany } from '../scrapers/peer-companies-scraper.js';
import { PeerCompanyRepository } from '../repositories/peer-company-repository.js';

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
 * Normalize company name for fuzzy matching (Phase 11 Step 2)
 * Strips legal entity suffixes and common variations to enable duplicate detection
 *
 * @param companyName - Raw company name
 * @returns Normalized company name for matching
 *
 * @example
 * normalizeCompanyNameForMatching('Midwest Ltd. IPO') // 'midwest'
 * normalizeCompanyNameForMatching('Midwest Limited') // 'midwest'
 */
function normalizeCompanyNameForMatching(companyName: string): string {
  if (!companyName) return '';

  return companyName
    .toLowerCase()
    .trim()
    // Remove common suffixes that create duplicates
    .replace(/\s+ipo$/i, '')
    .replace(/\s+fpo$/i, '')
    .replace(/\s+limited$/i, '')
    .replace(/\s+ltd\.?$/i, '')
    .replace(/\s+private\s+limited$/i, '')
    .replace(/\s+pvt\.?\s+ltd\.?$/i, '')
    .replace(/\s+pvt\.?$/i, '')
    .replace(/\s+private$/i, '')
    .replace(/\s+inc\.?$/i, '')
    .replace(/\s+incorporated$/i, '')
    .replace(/\s+corp\.?$/i, '')
    .replace(/\s+corporation$/i, '')
    .replace(/\s+llc$/i, '')
    .replace(/\s+llp$/i, '')
    .replace(/\s+plc$/i, '')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Upsert IPO data to database with retry logic
 * Handles merge logic for dual-listed IPOs (both NSE and BSE)
 * Enhanced Phase 11 Step 2: Fuzzy company name matching to prevent duplicates
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
  const normalizedName = normalizeCompanyNameForMatching(scrapedIPO.companyName);

  logger.debug({
    companyName: scrapedIPO.companyName,
    normalizedName,
    slug,
    source
  }, 'Upserting IPO (Phase 11: with fuzzy matching)');

  const result = await retryWithBackoff(
    async () => {
      // Phase 11 Step 2: Try fuzzy company name matching first
      // This prevents duplicates when scrapers use different name variations
      let existingIPO = await ipoRepository.findByNormalizedName(normalizedName);

      if (!existingIPO) {
        // Fallback to slug-based lookup (existing behavior)
        existingIPO = await ipoRepository.findBySlug(slug);
      } else {
        logger.info({
          companyName: scrapedIPO.companyName,
          normalizedName,
          existingCompanyName: existingIPO.companyName,
          existingSlug: existingIPO.slug,
          newSlug: slug
        }, '[Phase 11] Found existing IPO via fuzzy name matching - preventing duplicate!');
      }

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
        // Story 11.8: Use segment and offeringType from scraped data
        // segment is nullable for RIGHTS/InvITs/REITs/NCDs (they don't have market segments)
        segment: scrapedIPO.segment || null,
        // offering_type: Determines the type of offering (required NOT NULL field)
        offeringType: scrapedIPO.offeringType,
        sector: scrapedIPO.sector,
        issueSize: scrapedIPO.issueSize.toString(),
        // Round price values to integers for INTEGER fields in database
        // Use explicit check to avoid storing 0 (only store positive values or undefined)
        priceRangeMin: scrapedIPO.priceRangeMin !== undefined && scrapedIPO.priceRangeMin > 0
          ? Math.round(scrapedIPO.priceRangeMin)
          : undefined,
        priceRangeMax: scrapedIPO.priceRangeMax !== undefined && scrapedIPO.priceRangeMax > 0
          ? Math.round(scrapedIPO.priceRangeMax)
          : undefined,
        lotSize: validateLotSize(scrapedIPO.lotSize, scrapedIPO.segment, scrapedIPO.companyName) ?? undefined, // Validate and reject lot_size = 1
        faceValue: scrapedIPO.faceValue || 10, // Default to 10 if not provided
        status: scrapedIPO.status as any,
        openDate: scrapedIPO.openDate,
        closeDate: scrapedIPO.closeDate,
        // Convert empty strings to undefined for date fields (Story 11.7 - Fix Chittorgarh date handling)
        allotmentDate: scrapedIPO.allotmentDate || undefined,
        listingDate: scrapedIPO.listingDate || undefined,
        companyDescription: scrapedIPO.companyDescription || undefined,
        registrar: scrapedIPO.registrar || undefined,
        leadManagers: scrapedIPO.leadManagers,
        listingExchanges,
        lastScrapedAt: new Date(), // Track last successful scrape time (Story 7.4)
        updatedAt: new Date(),
        // Symbol: Only set if scraper explicitly provides it (NSE/BSE have symbols, upcoming IPOs may not)
        symbol: scrapedIPO.symbol || undefined,
        // ISIN: Only set if scraper provides it (NSE API / BSE Detail may have it)
        isin: scrapedIPO.isin || undefined
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
 * Create subscription snapshot with retry logic and validation
 * Enhanced for Story 11.3 - validates subscription data before persistence (AC4, AC6)
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

  logger.debug({
    ipoId,
    companyName: scrapedSubscription.ipoCompanyName,
    qib: scrapedSubscription.qibSubscription,
    nii: scrapedSubscription.niiSubscription,
    retail: scrapedSubscription.retailSubscription,
    total: scrapedSubscription.totalSubscription
  }, 'Creating subscription snapshot (AC4)');

  const result = await retryWithBackoff(
    async () => {
      // Prepare subscription data for database insert (AC4)
      const subscriptionData: SubscriptionInsert = {
        ipoId,
        // Timestamp set to current date/time in ISO 8601 format (AC4)
        timestamp: new Date(), // Current time for this snapshot
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

      // Validate foreign key constraint (IPO must exist) before insert (AC4)
      try {
        const snapshot = await subscriptionRepository.createSnapshot(subscriptionData);
        logger.debug({
          ipoId,
          subscriptionId: snapshot.id,
          timestamp: subscriptionData.timestamp
        }, 'Subscription snapshot persisted successfully (AC4)');
        return snapshot.id;
      } catch (dbError: any) {
        // Enhanced PostgreSQL error logging (Story 11.2, AC4)
        logger.error({
          ipoId,
          companyName: scrapedSubscription.ipoCompanyName,
          error: dbError?.message,
          code: dbError?.code,
          constraint: dbError?.constraint,
          detail: dbError?.detail,
          table: dbError?.table
        }, 'Database insert failed for subscription snapshot (AC4)');
        throw dbError;
      }
    },
    `Create subscription snapshot for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    {
      ipoId,
      subscriptionId: result,
      companyName: scrapedSubscription.ipoCompanyName,
      duration
    },
    'Subscription snapshot created successfully (AC4, AC6)'
  );

  return result;
}

/**
 * Create GMP (Grey Market Premium) record with retry logic
 * @param gmpRepository - GMP repository instance
 * @param ipoId - IPO ID to associate GMP record with
 * @param gmp - GMP value in rupees
 * @param timestamp - Optional timestamp (defaults to now)
 * @returns GMP record ID on success
 */
export async function createGMPRecord(
  gmpRepository: GMPRepository,
  ipoId: string,
  gmp: number,
  timestamp: Date = new Date()
): Promise<string> {
  const startTime = Date.now();

  logger.debug({ ipoId, gmp, timestamp }, 'Creating GMP record');

  const result = await retryWithBackoff(
    async () => {
      const gmpData: GMPRecordInsert = {
        ipoId,
        gmp: Math.round(gmp), // Round to integer as per schema
        timestamp,
        source: 'INVESTORGAIN_GMP',
      };

      const gmpRecord = await gmpRepository.create(gmpData);
      return gmpRecord.id;
    },
    `Create GMP record for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;
  logger.info(
    { ipoId, gmpRecordId: result, gmp, duration },
    'GMP record created successfully'
  );

  return result;
}

/**
 * Create or update financial data for an IPO with retry logic
 * @param financialDataRepository - Financial data repository instance
 * @param scrapedFinancialData - Scraped financial metrics from DRHP
 * @returns Financial data ID on success
 */
export async function createFinancialData(
  financialDataRepository: FinancialDataRepository,
  scrapedFinancialData: ScrapedFinancialData
): Promise<string> {
  const startTime = Date.now();
  const { ipoId } = scrapedFinancialData;

  logger.debug({ ipoId }, 'Creating/updating financial data');

  const result = await retryWithBackoff(
    async () => {
      // Prepare financial data insert object
      const financialData: FinancialDataInsert = {
        ipoId: scrapedFinancialData.ipoId,
        // Revenue by fiscal year (in INR crores)
        revenueFy2022: scrapedFinancialData.revenueFy2022?.toString(),
        revenueFy2023: scrapedFinancialData.revenueFy2023?.toString(),
        revenueFy2024: scrapedFinancialData.revenueFy2024?.toString(),
        // Profit by fiscal year (in INR crores)
        profitFy2022: scrapedFinancialData.profitFy2022?.toString(),
        profitFy2023: scrapedFinancialData.profitFy2023?.toString(),
        profitFy2024: scrapedFinancialData.profitFy2024?.toString(),
        // EBITDA by fiscal year
        ebitdaFy2022: scrapedFinancialData.ebitdaFy2022?.toString(),
        ebitdaFy2023: scrapedFinancialData.ebitdaFy2023?.toString(),
        ebitdaFy2024: scrapedFinancialData.ebitdaFy2024?.toString(),
        // Total Income by fiscal year
        totalIncomeFy2022: scrapedFinancialData.totalIncomeFy2022?.toString(),
        totalIncomeFy2023: scrapedFinancialData.totalIncomeFy2023?.toString(),
        totalIncomeFy2024: scrapedFinancialData.totalIncomeFy2024?.toString(),
        // Financial ratios and metrics
        netWorth: scrapedFinancialData.netWorth?.toString(),
        peRatio: scrapedFinancialData.peRatio?.toString(),
        eps: scrapedFinancialData.eps?.toString(),
        roe: scrapedFinancialData.roe?.toString(),
        ronw: scrapedFinancialData.ronw?.toString(),
        debtToEquity: scrapedFinancialData.debtToEquity?.toString(),
        reservesAndSurplus: scrapedFinancialData.reservesAndSurplus?.toString(),
        totalAssets: scrapedFinancialData.totalAssets?.toString(),
        totalBorrowing: scrapedFinancialData.totalBorrowing?.toString(),
        // Promoter holding
        promoterHoldingPreIssue: scrapedFinancialData.promoterHoldingPreIssue?.toString(),
        promoterHoldingPostIssue: scrapedFinancialData.promoterHoldingPostIssue?.toString(),
        // Additional metrics
        marketCap: scrapedFinancialData.marketCap?.toString(),
        preIpoEps: scrapedFinancialData.preIpoEps?.toString(),
        postIpoEps: scrapedFinancialData.postIpoEps?.toString(),
      };

      // Upsert financial data (creates new or updates existing)
      const result = await financialDataRepository.upsert(financialData);
      return result.id;
    },
    `Create financial data for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Count how many fields were populated
  const populatedFields = Object.values(scrapedFinancialData).filter(
    (val) => val !== null && val !== undefined
  ).length;

  logger.info(
    {
      ipoId,
      financialDataId: result,
      duration,
      fieldsPopulated: populatedFields,
    },
    'Financial data created/updated successfully'
  );

  return result;
}

/**
 * Create or update peer companies for an IPO with retry logic
 * Deletes existing peer companies and creates fresh data
 *
 * @param peerCompanyRepository - Peer company repository instance
 * @param ipoId - IPO identifier
 * @param scrapedPeers - Array of scraped peer companies
 * @returns Number of peer companies created
 */
export async function createPeerCompanies(
  peerCompanyRepository: PeerCompanyRepository,
  ipoId: string,
  scrapedPeers: ScrapedPeerCompany[]
): Promise<number> {
  const startTime = Date.now();

  logger.debug({ ipoId, peerCount: scrapedPeers.length }, 'Creating peer companies');

  if (scrapedPeers.length === 0) {
    logger.warn({ ipoId }, 'No peer companies to create');
    return 0;
  }

  const result = await retryWithBackoff(
    async () => {
      // Step 1: Delete existing peer companies for this IPO
      const deletedCount = await peerCompanyRepository.deleteByIPOId(ipoId);
      if (deletedCount > 0) {
        logger.debug({ ipoId, deletedCount }, 'Deleted existing peer companies');
      }

      // Step 2: Prepare peer company data
      const peerCompanyData = scrapedPeers.map((peer) => ({
        ipoId,
        companyName: peer.companyName,
        sector: peer.sector || null,
        isListed: peer.isListed,
        peRatio: peer.peRatio?.toString() || null,
        eps: peer.eps?.toString() || null,
        dilutedEps: peer.dilutedEps?.toString() || null,
        ronw: peer.ronw?.toString() || null,
        nav: peer.nav?.toString() || null,
        pbvRatio: peer.pbvRatio?.toString() || null,
        financialStatementType: null, // Not available from Moneycontrol
        dataSource: peer.dataSource || 'MONEYCONTROL',
        lastUpdated: new Date(),
      }));

      // Step 3: Batch insert peer companies
      const createdPeers = await peerCompanyRepository.batchCreate(peerCompanyData);

      return createdPeers.length;
    },
    `Create peer companies for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Calculate metrics
  const peersWithPE = scrapedPeers.filter((p) => p.peRatio !== undefined).length;
  const peersWithEPS = scrapedPeers.filter((p) => p.eps !== undefined).length;
  const peersWithRONW = scrapedPeers.filter((p) => p.ronw !== undefined).length;

  logger.info(
    {
      ipoId,
      peerCount: result,
      duration,
      metrics: {
        withPE: peersWithPE,
        withEPS: peersWithEPS,
        withRONW: peersWithRONW,
      },
    },
    'Peer companies created successfully'
  );

  return result;
}

/**
 * Create anchor investor record with retry logic
 *
 * @param anchorInvestorRepository - Anchor investor repository instance
 * @param ipoId - IPO ID to associate anchor investors with
 * @param anchorData - Scraped anchor investor data
 * @returns Anchor investor record ID on success
 */
export async function createAnchorInvestors(
  anchorInvestorRepository: any, // AnchorInvestorRepository type
  ipoId: string,
  anchorData: {
    bidDate: Date | null;
    totalSharesOffered: number;
    totalAmountRaised: number;
    anchorInvestorsCount: number;
    lockIn50PercentDate: Date | null;
    lockInRemainingDate: Date | null;
    investorList: any[];
  }
): Promise<string> {
  const startTime = Date.now();

  logger.debug({
    ipoId,
    anchorInvestorsCount: anchorData.anchorInvestorsCount,
    totalAmountRaised: anchorData.totalAmountRaised
  }, 'Creating anchor investor record');

  const result = await retryWithBackoff(
    async () => {
      // Check if anchor data already exists
      const existing = await anchorInvestorRepository.findByIPOId(ipoId);

      if (existing) {
        // Update existing record
        await anchorInvestorRepository.update(existing.id, {
          bidDate: anchorData.bidDate,
          totalSharesOffered: anchorData.totalSharesOffered,
          totalAmountRaised: anchorData.totalAmountRaised,
          anchorInvestorsCount: anchorData.anchorInvestorsCount,
          lockIn50PercentDate: anchorData.lockIn50PercentDate,
          lockInRemainingDate: anchorData.lockInRemainingDate,
          investorList: JSON.stringify(anchorData.investorList)
        });

        logger.info({ ipoId, anchorInvestorId: existing.id }, 'Updated anchor investor record');
        return existing.id;
      } else {
        // Create new record
        const anchorInvestor = await anchorInvestorRepository.create({
          ipoId,
          bidDate: anchorData.bidDate,
          totalSharesOffered: anchorData.totalSharesOffered,
          totalAmountRaised: anchorData.totalAmountRaised,
          anchorInvestorsCount: anchorData.anchorInvestorsCount,
          lockIn50PercentDate: anchorData.lockIn50PercentDate,
          lockInRemainingDate: anchorData.lockInRemainingDate,
          investorList: JSON.stringify(anchorData.investorList)
        });

        logger.info({ ipoId, anchorInvestorId: anchorInvestor.id }, 'Created anchor investor record');
        return anchorInvestor.id;
      }
    },
    `Create anchor investors for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  logger.info(
    {
      ipoId,
      anchorInvestorId: result,
      anchorInvestorsCount: anchorData.anchorInvestorsCount,
      totalAmountRaised: anchorData.totalAmountRaised,
      duration
    },
    'Anchor investor record persisted successfully'
  );

  return result;
}

// ==================== IPO REVIEWS ====================

/**
 * Create or update IPO reviews with retry logic
 * @param reviewRepository - Review repository instance
 * @param ipoId - IPO ID to associate reviews with
 * @param segment - IPO segment (MAINBOARD/SME)
 * @param scrapedReviews - Array of scraped reviews
 * @returns Number of reviews created/updated
 */
export async function createIPOReviews(
  reviewRepository: any, // ReviewRepository type
  ipoId: string,
  segment: 'MAINBOARD' | 'SME',
  scrapedReviews: Array<{
    source: string;
    author: string;
    reviewTitle: string;
    recommendation: 'Subscribe' | 'May apply' | 'Avoid' | 'Not Recommended';
    publishedDate: Date;
    reviewContent: string;
    reviewUrl?: string;
  }>
): Promise<number> {
  const startTime = Date.now();

  if (scrapedReviews.length === 0) {
    logger.info({ ipoId }, 'No reviews to persist (empty array)');
    return 0;
  }

  const result = await retryWithExponentialBackoff(
    async () => {
      let createdCount = 0;
      let updatedCount = 0;

      // Process each review with upsert logic (create or update if exists)
      for (const review of scrapedReviews) {
        const year = review.publishedDate.getFullYear();

        // Check if review already exists (by IPO ID + author)
        const existing = await reviewRepository.findByIPOIdAndAuthor(ipoId, review.author);

        if (existing) {
          // Update existing review
          await reviewRepository.update(existing.id, {
            reviewTitle: review.reviewTitle,
            recommendation: review.recommendation,
            reviewContent: review.reviewContent,
            reviewUrl: review.reviewUrl,
            publishedDate: review.publishedDate,
            year,
            segment,
            isApproved: false, // Reset approval on update
          });
          updatedCount++;
          logger.debug({ ipoId, author: review.author }, 'Updated existing review');
        } else {
          // Create new review
          await reviewRepository.create({
            ipoId,
            reviewTitle: review.reviewTitle,
            author: review.author,
            recommendation: review.recommendation,
            reviewContent: review.reviewContent,
            reviewUrl: review.reviewUrl,
            publishedDate: review.publishedDate,
            year,
            segment,
            isApproved: false, // Requires moderation
          });
          createdCount++;
          logger.debug({ ipoId, author: review.author }, 'Created new review');
        }
      }

      logger.info(
        { ipoId, created: createdCount, updated: updatedCount, total: scrapedReviews.length },
        'IPO reviews persisted successfully'
      );

      return createdCount + updatedCount;
    },
    `Create IPO reviews for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  logger.info(
    {
      ipoId,
      reviewsProcessed: result,
      totalReviews: scrapedReviews.length,
      duration
    },
    'IPO reviews persistence complete'
  );

  return result;
}

// ==================== IPO OBJECTIVES ====================

/**
 * Update IPO objectives (use of funds) with retry logic
 * Updates the objectives field in the ipos table with parsed DRHP data
 *
 * @param ipoRepository - IPO repository instance
 * @param ipoId - IPO ID to update
 * @param objectives - Array of IPO objectives from DRHP
 * @returns void on success
 */
export async function updateIPOObjectives(
  ipoRepository: IPORepository,
  ipoId: string,
  objectives: Array<{
    sno: number;
    description: string;
    amount: number | null;
  }>
): Promise<void> {
  const startTime = Date.now();

  if (objectives.length === 0) {
    logger.warn({ ipoId }, 'No objectives to update (empty array)');
    return;
  }

  logger.debug({
    ipoId,
    objectivesCount: objectives.length,
    totalAmount: objectives.reduce((sum, obj) => sum + (obj.amount || 0), 0)
  }, 'Updating IPO objectives');

  await retryWithBackoff(
    async () => {
      // Update the objectives field (JSONB) in ipos table
      await ipoRepository.update(ipoId, {
        objectives: objectives as any, // Drizzle will serialize to JSONB
        updatedAt: new Date()
      });

      logger.debug({ ipoId, objectivesCount: objectives.length }, 'IPO objectives updated');
    },
    `Update objectives for IPO: ${ipoId}`
  );

  const duration = Date.now() - startTime;

  // Calculate metrics
  const objectivesWithAmount = objectives.filter((obj) => obj.amount !== null).length;
  const totalAmount = objectives.reduce((sum, obj) => sum + (obj.amount || 0), 0);

  logger.info(
    {
      ipoId,
      objectivesCount: objectives.length,
      objectivesWithAmount,
      totalAmount,
      duration
    },
    'IPO objectives updated successfully'
  );
}
