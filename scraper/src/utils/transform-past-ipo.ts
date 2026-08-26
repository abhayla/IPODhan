/**
 * Story 11.4: Data Transformation Module for Past IPO Data
 *
 * Transforms NSE past IPO responses to database schema format.
 * Implements AC2 - Data Extraction & Transformation:
 * - Field mapping: NSE response → database schema
 * - Data type conversion (strings → decimals, dates)
 * - Null handling with validation
 * - Deduplication by symbol + listing date
 * - Audit trail tracking
 */

import { z } from 'zod';
import logger from './logger.js';
import type { NSEPastIPOResponse } from '../scrapers/nse-api-client.js';
import { parseDdMmmYyyy } from './date-string-parsing.js';

/**
 * Zod schema for validating transformed past IPO data (AC2)
 * Ensures data quality before database insertion
 */
export const PastIPOSchema = z.object({
  symbol: z.string().min(1).max(20).nullable(),
  companyName: z.string().min(1).max(255),
  listingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), // YYYY-MM-DD format
  listingPrice: z.number().positive().nullable(),
  issuePrice: z.number().positive().nullable(),
  currentPrice: z.number().positive().nullable(),
  listingGainPercent: z.number().min(-100).max(1000).nullable(), // -100% to 1000%
  dataSource: z.literal('NSE_PAST_API'),
  extractedAt: z.string().datetime(), // ISO 8601 timestamp
  isin: z.string().length(12).nullable(),
  securityType: z.string().nullable(),
});

export type TransformedPastIPO = z.infer<typeof PastIPOSchema>;

/**
 * AC2: Helper - Clean and normalize NSE symbol
 * Removes special characters, trims whitespace
 */
export function cleanSymbol(symbol: string | null | undefined): string | null {
  if (!symbol || typeof symbol !== 'string') {
    return null;
  }

  const cleaned = symbol.trim().toUpperCase();

  // Validate symbol format (alphanumeric + hyphens only)
  if (!/^[A-Z0-9\-]+$/.test(cleaned)) {
    logger.warn({ symbol, cleaned }, 'Invalid symbol format detected (AC2)');
    return null;
  }

  return cleaned;
}

/**
 * AC2: Helper - Parse price string to decimal number
 * Handles formats: "₹1,234.50", "1234.5", "Rs. 1234"
 * Returns null for invalid/missing prices
 */
export function parsePrice(priceStr: string | number | null | undefined): number | null {
  if (priceStr === null || priceStr === undefined) {
    return null;
  }

  // Already a number
  if (typeof priceStr === 'number') {
    return priceStr > 0 ? priceStr : null;
  }

  // String parsing
  if (typeof priceStr === 'string') {
    try {
      // Remove currency symbols, commas, and extra whitespace
      const cleaned = priceStr
        .replace(/Rs\.?|₹/gi, '')
        .replace(/,/g, '')
        .trim();

      const parsed = parseFloat(cleaned);

      // Validate: must be positive number
      if (isNaN(parsed) || parsed <= 0) {
        logger.debug({ priceStr, parsed }, 'Invalid price value - not positive (AC2)');
        return null;
      }

      return parsed;
    } catch (error) {
      logger.warn({ priceStr, error }, 'Failed to parse price string (AC2)');
      return null;
    }
  }

  return null;
}

/**
 * AC2: Helper - Parse date string to PostgreSQL date format (YYYY-MM-DD)
 * Handles formats: "DD-MMM-YYYY", "DD/MM/YYYY", "YYYY-MM-DD", ISO 8601
 * Returns null for invalid/missing dates
 */
export function parseDate(dateStr: string | null | undefined): string | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  try {
    const cleaned = dateStr.trim();

    // Already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      const date = new Date(cleaned);
      if (!isNaN(date.getTime())) {
        return cleaned;
      }
    }

    // Handle DD-MMM-YYYY format (e.g., "15-Jan-2024") — string arithmetic,
    // TZ-invariant by construction (T-327, round-7 P1-1); NEVER
    // `new Date(dateOnlyString).toISOString()`.
    const ddMmmIso = parseDdMmmYyyy(cleaned);
    if (ddMmmIso) {
      return ddMmmIso;
    }

    // Handle DD/MM/YYYY format
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
      const [day, month, year] = cleaned.split('/');
      const date = new Date(`${year}-${month}-${day}`);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    // Try direct parsing as fallback
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    logger.debug({ dateStr }, 'Could not parse date string (AC2)');
    return null;
  } catch (error) {
    logger.warn({ dateStr, error }, 'Failed to parse date (AC2)');
    return null;
  }
}

/**
 * AC2: Helper - Calculate listing gain percentage
 * Formula: ((listingPrice - issuePrice) / issuePrice) * 100
 * Returns null if either price is missing/invalid
 */
export function calculateListingGain(
  listingPrice: number | null,
  issuePrice: number | null
): number | null {
  if (!listingPrice || !issuePrice || issuePrice <= 0) {
    return null;
  }

  try {
    const gain = ((listingPrice - issuePrice) / issuePrice) * 100;

    // Validate range: -100% to 1000% (AC2, AC6)
    if (gain < -100 || gain > 1000) {
      logger.warn({
        listingPrice,
        issuePrice,
        gain
      }, 'Listing gain outside expected range -100% to 1000% (AC6)');
      return null;
    }

    return Math.round(gain * 100) / 100; // Round to 2 decimal places
  } catch (error) {
    logger.warn({ listingPrice, issuePrice, error }, 'Failed to calculate listing gain (AC2)');
    return null;
  }
}

/**
 * AC2: Validate listing date is in the past (not future)
 */
export function validateListingDate(listingDate: string | null): boolean {
  if (!listingDate) {
    return false;
  }

  try {
    const date = new Date(listingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to compare dates only

    return date <= today;
  } catch {
    return false;
  }
}

/**
 * AC2: Transform NSE past IPO response to database schema format
 * Implements complete field mapping and validation
 *
 * @param nseResponse - Raw NSE API response
 * @returns Transformed and validated past IPO data, or null if validation fails
 */
export function transformPastIPO(nseResponse: NSEPastIPOResponse): TransformedPastIPO | null {
  try {
    // Extract and transform fields (AC2)
    const symbol = cleanSymbol(nseResponse.symbol);
    const companyName = nseResponse.companyName?.trim() || '';
    const listingDate = parseDate(nseResponse.listingDate);
    const listingPrice = parsePrice(nseResponse.listingPrice);
    const issuePrice = parsePrice(nseResponse.issuePrice);
    const currentPrice = parsePrice(nseResponse.currentPrice);
    const isin = nseResponse.isin?.trim().toUpperCase() || null;
    const securityType = nseResponse.securityType?.trim() || null;

    // Calculate listing gain (AC2)
    const listingGainPercent = calculateListingGain(listingPrice, issuePrice);

    // Validation: Minimum required fields (AC2)
    // Must have at least companyName + 2 of (symbol, listingDate, listingPrice)
    const requiredFieldsCount = [symbol, listingDate, listingPrice].filter(f => f !== null).length;

    if (!companyName || requiredFieldsCount < 2) {
      logger.debug({
        companyName,
        symbol,
        listingDate,
        listingPrice,
        requiredFieldsCount
      }, 'Skipping record - insufficient required fields (AC2: minimum 3 required)');
      return null;
    }

    // Validate listing date is in past (AC2, AC6)
    if (listingDate && !validateListingDate(listingDate)) {
      logger.warn({
        companyName,
        symbol,
        listingDate
      }, 'Listing date is in future - invalid data (AC2, AC6)');
      return null;
    }

    // Construct transformed object
    const transformed: TransformedPastIPO = {
      symbol,
      companyName,
      listingDate,
      listingPrice,
      issuePrice,
      currentPrice,
      listingGainPercent,
      dataSource: 'NSE_PAST_API',
      extractedAt: new Date().toISOString(), // Audit trail (AC2)
      isin,
      securityType,
    };

    // Validate with Zod schema (AC2)
    const validationResult = PastIPOSchema.safeParse(transformed);

    if (!validationResult.success) {
      logger.warn({
        companyName,
        symbol,
        errors: validationResult.error.issues
      }, 'Zod validation failed for transformed past IPO (AC2)');
      return null;
    }

    logger.debug({
      companyName,
      symbol,
      listingDate,
      listingGainPercent,
      hasCurrentPrice: !!currentPrice
    }, 'Past IPO transformed successfully (AC2)');

    return transformed;

  } catch (error) {
    logger.error({
      nseResponse,
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to transform past IPO (AC2)');
    return null;
  }
}

/**
 * AC2: Batch transform NSE past IPO responses
 * Deduplicates by symbol + listing date (keeps most complete record)
 *
 * @param nseResponses - Array of NSE API responses
 * @returns Array of transformed and deduplicated past IPOs
 */
export function transformPastIPOs(nseResponses: NSEPastIPOResponse[]): TransformedPastIPO[] {
  const startTime = Date.now();
  const transformed: TransformedPastIPO[] = [];
  const deduplicationMap = new Map<string, TransformedPastIPO>();

  let skippedCount = 0;

  for (const response of nseResponses) {
    const transformedIPO = transformPastIPO(response);

    if (!transformedIPO) {
      skippedCount++;
      continue;
    }

    // Deduplication key: symbol + listing date (AC2)
    const dedupeKey = `${transformedIPO.symbol || 'NO_SYMBOL'}_${transformedIPO.listingDate || 'NO_DATE'}`;

    // Check if we already have this IPO
    const existing = deduplicationMap.get(dedupeKey);

    if (existing) {
      // Keep the record with more non-null fields (AC2 - conflict resolution)
      const existingFieldCount = Object.values(existing).filter(v => v !== null).length;
      const newFieldCount = Object.values(transformedIPO).filter(v => v !== null).length;

      if (newFieldCount > existingFieldCount) {
        logger.debug({
          dedupeKey,
          existingFieldCount,
          newFieldCount
        }, 'Replacing duplicate with more complete record (AC2)');
        deduplicationMap.set(dedupeKey, transformedIPO);
      } else {
        logger.debug({ dedupeKey }, 'Skipping duplicate - existing record more complete (AC2)');
      }
    } else {
      deduplicationMap.set(dedupeKey, transformedIPO);
    }
  }

  // Convert map to array
  const deduplicated = Array.from(deduplicationMap.values());

  const duration = Date.now() - startTime;
  logger.info({
    inputCount: nseResponses.length,
    transformedCount: deduplicated.length,
    skippedCount,
    duplicatesRemoved: transformed.length - deduplicated.length,
    duration
  }, 'Batch transformation completed (AC2)');

  return deduplicated;
}
