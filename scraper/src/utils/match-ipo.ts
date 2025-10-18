/**
 * Story 11.4: IPO Matching Algorithm
 *
 * Matches NSE past IPO data against existing IPOs in database.
 * Implements AC3 - Data Matching & Validation:
 * - Primary matching: by NSE symbol (highest confidence)
 * - Fallback matching: by company name using PostgreSQL pg_trgm similarity
 * - Match confidence scoring (100%, 90%, 70%, 0%)
 * - Conflict detection and resolution
 * - Unmatched record logging with CSV report generation
 */

import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import logger from './logger.js';
import type { TransformedPastIPO } from './transform-past-ipo.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Match result with confidence score and method
 */
export interface IPOMatchResult {
  ipoId: string | null;
  confidence: number; // 0-100
  method: 'SYMBOL' | 'NAME_HIGH' | 'NAME_MEDIUM' | 'NONE';
  matchedCompanyName?: string;
  matchedSymbol?: string;
  similarityScore?: number; // For name matching (0.0-1.0)
}

/**
 * Unmatched record for CSV report (AC3)
 */
export interface UnmatchedRecord {
  symbol: string | null;
  companyName: string;
  listingDate: string | null;
  listingPrice: number | null;
  reason: string;
  extractedAt: string;
}

/**
 * AC3: Match IPO by NSE symbol (Primary, highest confidence: 100%)
 * Exact match on ipos.symbol field
 *
 * @param db - Database connection
 * @param symbol - NSE symbol to match
 * @returns Match result with 100% confidence if found
 */
export async function matchIPOBySymbol(
  db: NodePgDatabase<typeof schema>,
  symbol: string | null
): Promise<IPOMatchResult> {
  if (!symbol) {
    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };
  }

  try {
    logger.debug({ symbol }, 'Attempting symbol match (AC3 - Primary)');

    const result = await db
      .select({
        id: schema.ipos.id,
        companyName: schema.ipos.companyName,
        symbol: schema.ipos.symbol
      })
      .from(schema.ipos)
      .where(eq(schema.ipos.symbol, symbol))
      .limit(1);

    if (result.length > 0) {
      logger.info({
        symbol,
        ipoId: result[0].id,
        companyName: result[0].companyName
      }, 'Symbol match found with 100% confidence (AC3)');

      return {
        ipoId: result[0].id,
        confidence: 100,
        method: 'SYMBOL',
        matchedCompanyName: result[0].companyName,
        matchedSymbol: result[0].symbol
      };
    }

    logger.debug({ symbol }, 'No symbol match found (AC3)');
    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };

  } catch (error) {
    logger.error({
      symbol,
      error: error instanceof Error ? error.message : String(error)
    }, 'Symbol match query failed (AC3)');

    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };
  }
}

/**
 * AC3: Match IPO by company name using pg_trgm similarity
 * Fallback method with threshold-based confidence scoring
 *
 * Similarity thresholds (AC3):
 * - ≥ 0.9: 90% confidence (HIGH)
 * - 0.7-0.89: 70% confidence (MEDIUM)
 * - < 0.7: No match (0% confidence)
 *
 * @param db - Database connection
 * @param companyName - Company name to match
 * @returns Match result with confidence based on similarity score
 */
export async function matchIPOByName(
  db: NodePgDatabase<typeof schema>,
  companyName: string
): Promise<IPOMatchResult> {
  if (!companyName || companyName.length < 3) {
    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };
  }

  try {
    logger.debug({ companyName }, 'Attempting name match with pg_trgm (AC3 - Fallback)');

    // Use PostgreSQL pg_trgm for fuzzy name matching (AC3)
    // Note: pg_trgm extension must be enabled in database (created in 0000_initial_schema.sql)
    const result = await db.execute(sql`
      SELECT
        id,
        company_name,
        symbol,
        similarity(company_name, ${companyName}) as similarity_score
      FROM ipos
      WHERE similarity(company_name, ${companyName}) >= 0.7
      ORDER BY similarity_score DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const row = result.rows[0] as {
        id: string;
        company_name: string;
        symbol: string | null;
        similarity_score: number;
      };

      // Determine confidence based on similarity score (AC3)
      let confidence: number;
      let method: 'NAME_HIGH' | 'NAME_MEDIUM';

      if (row.similarity_score >= 0.9) {
        confidence = 90;
        method = 'NAME_HIGH';
      } else if (row.similarity_score >= 0.7) {
        confidence = 70;
        method = 'NAME_MEDIUM';
      } else {
        // Should not reach here due to WHERE clause, but safety check
        return {
          ipoId: null,
          confidence: 0,
          method: 'NONE'
        };
      }

      logger.info({
        companyName,
        matchedCompanyName: row.company_name,
        symbol: row.symbol,
        similarityScore: row.similarity_score,
        confidence,
        method
      }, 'Name match found with pg_trgm similarity (AC3)');

      return {
        ipoId: row.id,
        confidence,
        method,
        matchedCompanyName: row.company_name,
        matchedSymbol: row.symbol || undefined,
        similarityScore: row.similarity_score
      };
    }

    logger.debug({
      companyName
    }, 'No name match found above 70% threshold (AC3)');

    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };

  } catch (error) {
    logger.error({
      companyName,
      error: error instanceof Error ? error.message : String(error),
      errorCode: (error as any)?.code
    }, 'Name match query failed - check pg_trgm extension is enabled (AC3)');

    return {
      ipoId: null,
      confidence: 0,
      method: 'NONE'
    };
  }
}

/**
 * AC3: Orchestrator - Match IPO using symbol first, then fallback to name
 * Implements the two-tier matching strategy
 *
 * @param db - Database connection
 * @param pastIPO - Transformed past IPO data
 * @returns Match result with best confidence from either method
 */
export async function matchIPO(
  db: NodePgDatabase<typeof schema>,
  pastIPO: TransformedPastIPO
): Promise<IPOMatchResult> {
  logger.debug({
    symbol: pastIPO.symbol,
    companyName: pastIPO.companyName
  }, 'Starting IPO matching (AC3)');

  // Step 1: Try symbol match first (highest confidence) (AC3)
  const symbolMatch = await matchIPOBySymbol(db, pastIPO.symbol);

  if (symbolMatch.ipoId) {
    logger.info({
      symbol: pastIPO.symbol,
      companyName: pastIPO.companyName,
      ipoId: symbolMatch.ipoId,
      confidence: symbolMatch.confidence
    }, 'IPO matched by symbol (AC3 - Primary method)');
    return symbolMatch;
  }

  // Step 2: Fallback to name matching (AC3)
  logger.debug({
    companyName: pastIPO.companyName
  }, 'Symbol match failed, trying name match (AC3 - Fallback)');

  const nameMatch = await matchIPOByName(db, pastIPO.companyName);

  if (nameMatch.ipoId) {
    logger.info({
      companyName: pastIPO.companyName,
      matchedCompanyName: nameMatch.matchedCompanyName,
      ipoId: nameMatch.ipoId,
      confidence: nameMatch.confidence,
      similarityScore: nameMatch.similarityScore
    }, 'IPO matched by name similarity (AC3 - Fallback method)');
    return nameMatch;
  }

  // Step 3: No match found (AC3)
  logger.warn({
    symbol: pastIPO.symbol,
    companyName: pastIPO.companyName
  }, 'No IPO match found - will store with NULL ipo_id (AC3)');

  return {
    ipoId: null,
    confidence: 0,
    method: 'NONE'
  };
}

/**
 * AC3: Validate match against listing date constraint
 * Check if listing dates match within ±7 days tolerance
 *
 * @param db - Database connection
 * @param ipoId - Matched IPO ID
 * @param pastIPOListingDate - Listing date from NSE data
 * @returns true if dates match within tolerance, false otherwise
 */
export async function validateMatchByDate(
  db: NodePgDatabase<typeof schema>,
  ipoId: string,
  pastIPOListingDate: string | null
): Promise<boolean> {
  if (!pastIPOListingDate) {
    // No date to validate - allow match
    return true;
  }

  try {
    const result = await db
      .select({
        listingDate: schema.ipos.listingDate
      })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, ipoId))
      .limit(1);

    if (result.length === 0) {
      return false;
    }

    const dbListingDate = result[0].listingDate;

    if (!dbListingDate) {
      // DB has no listing date - allow match
      return true;
    }

    // Calculate date difference in days (AC3 - ±7 days tolerance)
    const pastDate = new Date(pastIPOListingDate);
    const dbDate = new Date(dbListingDate);
    const diffMs = Math.abs(pastDate.getTime() - dbDate.getTime());
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    const isValid = diffDays <= 7;

    logger.debug({
      ipoId,
      pastIPOListingDate,
      dbListingDate,
      diffDays,
      isValid
    }, 'Date validation result (AC3 - ±7 days tolerance)');

    return isValid;

  } catch (error) {
    logger.error({
      ipoId,
      pastIPOListingDate,
      error: error instanceof Error ? error.message : String(error)
    }, 'Date validation query failed (AC3)');
    return false;
  }
}

/**
 * AC3: Detect conflicts - check if listing_performance already exists for matched IPO
 * Returns true if conflict detected (existing data would be overwritten)
 *
 * @param db - Database connection
 * @param ipoId - Matched IPO ID
 * @returns true if listing_performance record already exists
 */
export async function detectConflict(
  db: NodePgDatabase<typeof schema>,
  ipoId: string
): Promise<boolean> {
  try {
    const result = await db
      .select({
        id: schema.listingPerformance.id,
        dataSource: schema.listingPerformance.dataSource
      })
      .from(schema.listingPerformance)
      .where(eq(schema.listingPerformance.ipoId, ipoId))
      .limit(1);

    if (result.length > 0) {
      logger.warn({
        ipoId,
        existingDataSource: result[0].dataSource
      }, 'Conflict detected - listing_performance already exists (AC3)');
      return true;
    }

    return false;

  } catch (error) {
    logger.error({
      ipoId,
      error: error instanceof Error ? error.message : String(error)
    }, 'Conflict detection query failed (AC3)');
    return false;
  }
}

/**
 * AC3: Generate CSV report of unmatched records
 * Saved to scraper/logs/unmatched-ipos-{timestamp}.csv
 *
 * @param unmatchedRecords - Array of unmatched records
 * @returns Path to generated CSV file
 */
export async function generateUnmatchedReport(
  unmatchedRecords: UnmatchedRecord[]
): Promise<string> {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `unmatched-ipos-${timestamp}.csv`;
    const logsDir = path.join(process.cwd(), 'logs');
    const filepath = path.join(logsDir, filename);

    // Ensure logs directory exists
    await fs.mkdir(logsDir, { recursive: true });

    // Generate CSV content
    const headers = 'Symbol,Company Name,Listing Date,Listing Price,Reason,Extracted At\n';
    const rows = unmatchedRecords.map(record =>
      `"${record.symbol || ''}","${record.companyName}","${record.listingDate || ''}","${record.listingPrice || ''}","${record.reason}","${record.extractedAt}"`
    ).join('\n');

    const csvContent = headers + rows;

    // Write to file
    await fs.writeFile(filepath, csvContent, 'utf-8');

    logger.info({
      filepath,
      recordCount: unmatchedRecords.length
    }, 'Unmatched records CSV report generated (AC3)');

    return filepath;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      recordCount: unmatchedRecords.length
    }, 'Failed to generate unmatched records CSV report (AC3)');
    throw error;
  }
}

/**
 * AC3: Batch match past IPOs against database
 * Returns match results with statistics
 *
 * @param db - Database connection
 * @param pastIPOs - Array of transformed past IPOs
 * @returns Match results and statistics
 */
export async function batchMatchIPOs(
  db: NodePgDatabase<typeof schema>,
  pastIPOs: TransformedPastIPO[]
): Promise<{
  matches: Map<TransformedPastIPO, IPOMatchResult>;
  statistics: {
    totalRecords: number;
    matchedBySymbol: number;
    matchedByNameHigh: number;
    matchedByNameMedium: number;
    unmatched: number;
    matchRate: number;
    conflicts: number;
  };
  unmatchedRecords: UnmatchedRecord[];
}> {
  const startTime = Date.now();
  const matches = new Map<TransformedPastIPO, IPOMatchResult>();
  const unmatchedRecords: UnmatchedRecord[] = [];

  let matchedBySymbol = 0;
  let matchedByNameHigh = 0;
  let matchedByNameMedium = 0;
  let unmatched = 0;
  let conflicts = 0;

  logger.info({
    totalRecords: pastIPOs.length
  }, 'Starting batch IPO matching (AC3)');

  for (const pastIPO of pastIPOs) {
    const matchResult = await matchIPO(db, pastIPO);
    matches.set(pastIPO, matchResult);

    // Update statistics (AC3)
    switch (matchResult.method) {
      case 'SYMBOL':
        matchedBySymbol++;
        break;
      case 'NAME_HIGH':
        matchedByNameHigh++;
        break;
      case 'NAME_MEDIUM':
        matchedByNameMedium++;
        break;
      case 'NONE':
        unmatched++;
        unmatchedRecords.push({
          symbol: pastIPO.symbol,
          companyName: pastIPO.companyName,
          listingDate: pastIPO.listingDate,
          listingPrice: pastIPO.listingPrice,
          reason: 'No match found (symbol or name)',
          extractedAt: pastIPO.extractedAt
        });
        break;
    }

    // Check for conflicts if matched (AC3)
    if (matchResult.ipoId) {
      const hasConflict = await detectConflict(db, matchResult.ipoId);
      if (hasConflict) {
        conflicts++;
      }
    }
  }

  const matchRate = pastIPOs.length > 0
    ? Math.round(((matchedBySymbol + matchedByNameHigh + matchedByNameMedium) / pastIPOs.length) * 100)
    : 0;

  const duration = Date.now() - startTime;

  const statistics = {
    totalRecords: pastIPOs.length,
    matchedBySymbol,
    matchedByNameHigh,
    matchedByNameMedium,
    unmatched,
    matchRate,
    conflicts
  };

  logger.info({
    ...statistics,
    duration
  }, 'Batch IPO matching completed (AC3, AC5 - Target: 60%+ match rate)');

  return {
    matches,
    statistics,
    unmatchedRecords
  };
}
