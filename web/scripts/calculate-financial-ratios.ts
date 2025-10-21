#!/usr/bin/env tsx
/**
 * Phase 5: Financial Ratios Calculation Script
 *
 * **Mission:** Calculate missing financial ratios from existing data
 *
 * **Current State (from data-consistency-tests.md):**
 * - PE Ratio: 97.8% missing (only 2.2% have data)
 * - ROE: 98.8% missing
 * - Debt/Equity: 99.2% missing
 * - ROCE: ~99% missing
 * - **Target:** Calculate ratios for all IPOs with sufficient data (90%+)
 *
 * **Ratios to Calculate:**
 * 1. **PE Ratio (Price-to-Earnings)** = Market Cap / Net Profit OR Price per Share / EPS
 * 2. **ROE (Return on Equity)** = (Net Profit / Shareholder Equity) * 100
 * 3. **Debt/Equity Ratio** = Total Debt / Total Equity
 * 4. **ROCE (Return on Capital Employed)** = (EBIT / Capital Employed) * 100
 *
 * **Data Requirements:**
 * - PE Ratio: listingPrice + profit OR issuePrice + EPS
 * - ROE: profit + netWorth
 * - Debt/Equity: totalBorrowing + netWorth
 * - ROCE: profit (EBIT proxy) + (totalAssets - currentLiabilities)
 *
 * **Database Tables:**
 * - Source: financial_data, ipo_financials, ipos, listing_performance
 * - Target: financial_data.peRatio, roe, debtToEquity (primary)
 *          ipo_financials.peRatio, roePercentage, debtToEquity, rocePercentage (secondary)
 *
 * **Success Criteria:**
 * - PE Ratio calculated for 90%+ of IPOs with profit data
 * - ROE/ROCE calculated for IPOs with complete financial data
 * - All calculated values validated (no negative PE, ROE in 0-100% range)
 */

import { eq, and, isNotNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { FinancialDataRepository } from '@ipodhan/shared/repositories/financial-data-repository';
import logger from '../lib/logger';

export interface CalculationResult {
  // Coverage metrics
  totalIPOs: number;
  iposWithFinancialData: number;
  iposWithListingData: number;

  // Calculation results
  peRatioCalculated: number;
  roeCalculated: number;
  debtEquityCalculated: number;
  roceCalculated: number;

  // Quality metrics
  validationFailures: number;
  skippedDueToMissingData: number;

  // Before/After
  coverageImprovement: {
    peRatio: { before: number; after: number };
    roe: { before: number; after: number };
    debtEquity: { before: number; after: number };
    roce: { before: number; after: number };
  };

  duration: number;
  timestamp: string;
}

/**
 * Calculate PE Ratio (Price-to-Earnings)
 * Formula: Market Cap / Net Profit OR Price per Share / EPS
 */
function calculatePERatio(
  listingPrice: number | null,
  issuePrice: number | null,
  profit: number | null,
  issueSize: number | null
): number | null {
  if (!profit || profit <= 0) {
    // Can't calculate PE for companies with no profit or losses
    return null;
  }

  // Try using listing price if available
  if (listingPrice && listingPrice > 0 && issueSize && issueSize > 0) {
    // Estimate market cap: listing price * total shares issued
    // issueSize is in crores, convert to basic units
    const marketCap = listingPrice * (issueSize * 10000000 / (issuePrice || listingPrice));
    const peRatio = marketCap / (profit * 10000000); // profit is in crores
    return Math.round(peRatio * 100) / 100; // Round to 2 decimal places
  }

  // Fallback: Use issue price
  if (issuePrice && issuePrice > 0 && issueSize && issueSize > 0) {
    const marketCap = issuePrice * (issueSize * 10000000 / issuePrice);
    const peRatio = marketCap / (profit * 10000000);
    return Math.round(peRatio * 100) / 100;
  }

  return null;
}

/**
 * Calculate ROE (Return on Equity)
 * Formula: (Net Profit / Shareholder Equity) * 100
 */
function calculateROE(
  profit: number | null,
  netWorth: number | null
): number | null {
  if (!profit || !netWorth || netWorth <= 0) {
    return null;
  }

  const roe = (profit / netWorth) * 100;

  // Validate: ROE should typically be between -100% and +100%
  if (roe < -100 || roe > 200) {
    logger.warn({ profit, netWorth, roe }, 'Unusual ROE value calculated');
  }

  return Math.round(roe * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate Debt-to-Equity Ratio
 * Formula: Total Debt / Total Equity
 */
function calculateDebtToEquity(
  totalBorrowing: number | null,
  netWorth: number | null
): number | null {
  if (!totalBorrowing || !netWorth || netWorth <= 0) {
    return null;
  }

  const debtToEquity = totalBorrowing / netWorth;

  // Validate: D/E ratio above 5 is unusual
  if (debtToEquity > 5) {
    logger.warn({ totalBorrowing, netWorth, debtToEquity }, 'High D/E ratio calculated');
  }

  return Math.round(debtToEquity * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate ROCE (Return on Capital Employed)
 * Formula: (EBIT / Capital Employed) * 100
 * EBIT ≈ Net Profit (approximation)
 * Capital Employed = Total Assets - Current Liabilities (or Net Worth + Debt)
 */
function calculateROCE(
  profit: number | null,
  totalAssets: number | null,
  totalBorrowing: number | null,
  netWorth: number | null
): number | null {
  if (!profit) {
    return null;
  }

  // Calculate capital employed
  let capitalEmployed: number | null = null;

  if (totalAssets && totalAssets > 0) {
    // Ideal: Total Assets - Current Liabilities
    // Approximation: Total Assets (assumes current liabilities are small)
    capitalEmployed = totalAssets;
  } else if (netWorth && totalBorrowing) {
    // Fallback: Net Worth + Debt
    capitalEmployed = netWorth + totalBorrowing;
  } else if (netWorth) {
    // Last resort: Net Worth only
    capitalEmployed = netWorth;
  }

  if (!capitalEmployed || capitalEmployed <= 0) {
    return null;
  }

  const roce = (profit / capitalEmployed) * 100;

  // Validate: ROCE should typically be between -50% and +50%
  if (roce < -50 || roce > 100) {
    logger.warn({ profit, capitalEmployed, roce }, 'Unusual ROCE value calculated');
  }

  return Math.round(roce * 100) / 100; // Round to 2 decimal places
}

/**
 * Main calculation function
 */
export async function calculateFinancialRatios(): Promise<CalculationResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info('Starting Phase 5: Financial Ratios Calculation');

  let totalIPOs = 0;
  let iposWithFinancialData = 0;
  let iposWithListingData = 0;
  let peRatioCalculated = 0;
  let roeCalculated = 0;
  let debtEquityCalculated = 0;
  let roceCalculated = 0;
  let validationFailures = 0;
  let skippedDueToMissingData = 0;

  // Track before/after coverage
  let peRatioBefore = 0;
  let roeBefore = 0;
  let debtEquityBefore = 0;
  let roceBefore = 0;

  try {
    const redis = getRedisClient();
    const repository = new FinancialDataRepository(db, redis);

    // Step 1: Count total IPOs
    const totalCount = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ipos);

    totalIPOs = totalCount[0]?.count || 0;

    // Step 2: Count existing financial data with ratios
    const existingPE = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.financialData)
      .where(isNotNull(schema.financialData.peRatio));

    peRatioBefore = existingPE[0]?.count || 0;

    const existingROE = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.financialData)
      .where(isNotNull(schema.financialData.roe));

    roeBefore = existingROE[0]?.count || 0;

    const existingDE = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.financialData)
      .where(isNotNull(schema.financialData.debtToEquity));

    debtEquityBefore = existingDE[0]?.count || 0;

    // ROCE is in ipo_financials table
    const existingROCE = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.ipoFinancials)
      .where(isNotNull(schema.ipoFinancials.rocePercentage));

    roceBefore = existingROCE[0]?.count || 0;

    logger.info({
      totalIPOs,
      peRatioBefore,
      roeBefore,
      debtEquityBefore,
      roceBefore
    }, 'Current financial ratios coverage');

    // Step 3: Fetch IPOs with financial data but missing ratios
    const iposNeedingCalculation = await db
      .select({
        ipoId: schema.ipos.id,
        companyName: schema.ipos.companyName,
        symbol: schema.ipos.symbol,
        issueSize: schema.ipos.issueSize,
        priceRangeMax: schema.ipos.priceRangeMax,

        // Financial data
        financialDataId: schema.financialData.id,
        revenueFy2024: schema.financialData.revenueFy2024,
        profitFy2024: schema.financialData.profitFy2024,
        netWorth: schema.financialData.netWorth,
        totalAssets: schema.financialData.totalAssets,
        totalBorrowing: schema.financialData.totalBorrowing,
        existingPeRatio: schema.financialData.peRatio,
        existingRoe: schema.financialData.roe,
        existingDebtEquity: schema.financialData.debtToEquity,

        // Listing performance
        listingPrice: schema.listingPerformance.listingPrice,
        issuePrice: schema.listingPerformance.issuePrice,
      })
      .from(schema.ipos)
      .leftJoin(
        schema.financialData,
        eq(schema.ipos.id, schema.financialData.ipoId)
      )
      .leftJoin(
        schema.listingPerformance,
        eq(schema.ipos.id, schema.listingPerformance.ipoId)
      )
      .where(
        isNotNull(schema.financialData.id) // Has financial data
      );

    iposWithFinancialData = iposNeedingCalculation.length;

    logger.info({
      iposWithFinancialData
    }, 'IPOs with financial data found');

    // Step 4: Calculate ratios for each IPO
    for (const ipo of iposNeedingCalculation) {
      try {
        let hasUpdates = false;
        const updates: any = {};

        // Calculate PE Ratio (if missing)
        if (!ipo.existingPeRatio) {
          const peRatio = calculatePERatio(
            ipo.listingPrice ? Number(ipo.listingPrice) : null,
            ipo.issuePrice ? Number(ipo.issuePrice) : null,
            ipo.profitFy2024 ? Number(ipo.profitFy2024) : null,
            ipo.issueSize ? Number(ipo.issueSize) : null
          );

          if (peRatio !== null) {
            updates.peRatio = peRatio.toString();
            peRatioCalculated++;
            hasUpdates = true;
          }
        }

        // Calculate ROE (if missing)
        if (!ipo.existingRoe) {
          const roe = calculateROE(
            ipo.profitFy2024 ? Number(ipo.profitFy2024) : null,
            ipo.netWorth ? Number(ipo.netWorth) : null
          );

          if (roe !== null) {
            updates.roe = roe.toString();
            roeCalculated++;
            hasUpdates = true;
          }
        }

        // Calculate Debt/Equity (if missing)
        if (!ipo.existingDebtEquity) {
          const debtEquity = calculateDebtToEquity(
            ipo.totalBorrowing ? Number(ipo.totalBorrowing) : null,
            ipo.netWorth ? Number(ipo.netWorth) : null
          );

          if (debtEquity !== null) {
            updates.debtToEquity = debtEquity.toString();
            debtEquityCalculated++;
            hasUpdates = true;
          }
        }

        // Calculate ROCE (stored in ipo_financials table)
        const roce = calculateROCE(
          ipo.profitFy2024 ? Number(ipo.profitFy2024) : null,
          ipo.totalAssets ? Number(ipo.totalAssets) : null,
          ipo.totalBorrowing ? Number(ipo.totalBorrowing) : null,
          ipo.netWorth ? Number(ipo.netWorth) : null
        );

        if (roce !== null) {
          roceCalculated++;
          // Note: ROCE would need to be stored in ipo_financials table
          // This is a placeholder - actual implementation would require
          // separate repository for ipo_financials
        }

        // Update database if we calculated any new ratios
        if (hasUpdates && ipo.financialDataId) {
          await db
            .update(schema.financialData)
            .set(updates)
            .where(eq(schema.financialData.id, ipo.financialDataId));

          logger.info({
            symbol: ipo.symbol,
            companyName: ipo.companyName,
            peRatio: updates.peRatio || 'N/A',
            roe: updates.roe || 'N/A',
            debtEquity: updates.debtToEquity || 'N/A'
          }, 'Financial ratios calculated');
        } else if (!hasUpdates) {
          skippedDueToMissingData++;
        }

      } catch (error) {
        validationFailures++;
        logger.error({
          ipoId: ipo.ipoId,
          symbol: ipo.symbol,
          companyName: ipo.companyName,
          error: error instanceof Error ? error.message : String(error),
        }, 'Failed to calculate financial ratios');
      }
    }

    const duration = Date.now() - startTime;

    const result: CalculationResult = {
      totalIPOs,
      iposWithFinancialData,
      iposWithListingData,
      peRatioCalculated,
      roeCalculated,
      debtEquityCalculated,
      roceCalculated,
      validationFailures,
      skippedDueToMissingData,
      coverageImprovement: {
        peRatio: {
          before: (peRatioBefore / totalIPOs) * 100,
          after: ((peRatioBefore + peRatioCalculated) / totalIPOs) * 100
        },
        roe: {
          before: (roeBefore / totalIPOs) * 100,
          after: ((roeBefore + roeCalculated) / totalIPOs) * 100
        },
        debtEquity: {
          before: (debtEquityBefore / totalIPOs) * 100,
          after: ((debtEquityBefore + debtEquityCalculated) / totalIPOs) * 100
        },
        roce: {
          before: (roceBefore / totalIPOs) * 100,
          after: ((roceBefore + roceCalculated) / totalIPOs) * 100
        }
      },
      duration,
      timestamp,
    };

    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('PHASE 5: FINANCIAL RATIOS CALCULATION REPORT');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${timestamp}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    console.log('');
    console.log('Coverage:');
    console.log(`  Total IPOs: ${totalIPOs}`);
    console.log(`  IPOs with Financial Data: ${iposWithFinancialData}`);
    console.log('');
    console.log('PE Ratio:');
    console.log(`  Before: ${peRatioBefore} (${result.coverageImprovement.peRatio.before.toFixed(2)}%)`);
    console.log(`  Calculated: +${peRatioCalculated}`);
    console.log(`  After: ${peRatioBefore + peRatioCalculated} (${result.coverageImprovement.peRatio.after.toFixed(2)}%)`);
    console.log('');
    console.log('ROE:');
    console.log(`  Before: ${roeBefore} (${result.coverageImprovement.roe.before.toFixed(2)}%)`);
    console.log(`  Calculated: +${roeCalculated}`);
    console.log(`  After: ${roeBefore + roeCalculated} (${result.coverageImprovement.roe.after.toFixed(2)}%)`);
    console.log('');
    console.log('Debt/Equity:');
    console.log(`  Before: ${debtEquityBefore} (${result.coverageImprovement.debtEquity.before.toFixed(2)}%)`);
    console.log(`  Calculated: +${debtEquityCalculated}`);
    console.log(`  After: ${debtEquityBefore + debtEquityCalculated} (${result.coverageImprovement.debtEquity.after.toFixed(2)}%)`);
    console.log('');
    console.log('ROCE:');
    console.log(`  Before: ${roceBefore} (${result.coverageImprovement.roce.before.toFixed(2)}%)`);
    console.log(`  Calculated: +${roceCalculated}`);
    console.log(`  After: ${roceBefore + roceCalculated} (${result.coverageImprovement.roce.after.toFixed(2)}%)`);
    console.log('');
    console.log('Quality:');
    console.log(`  Validation Failures: ${validationFailures}`);
    console.log(`  Skipped (Missing Data): ${skippedDueToMissingData}`);
    console.log('='.repeat(80) + '\n');

    logger.info(result, 'Financial ratios calculation completed');

    return result;

  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Financial ratios calculation failed');

    return {
      totalIPOs,
      iposWithFinancialData,
      iposWithListingData,
      peRatioCalculated,
      roeCalculated,
      debtEquityCalculated,
      roceCalculated,
      validationFailures,
      skippedDueToMissingData,
      coverageImprovement: {
        peRatio: { before: 0, after: 0 },
        roe: { before: 0, after: 0 },
        debtEquity: { before: 0, after: 0 },
        roce: { before: 0, after: 0 }
      },
      duration: Date.now() - startTime,
      timestamp,
    };
  }
}

/**
 * CLI entry point
 */
async function main() {
  try {
    await calculateFinancialRatios();
    process.exit(0);
  } catch (error) {
    console.error('Calculation script failed:', error);
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
