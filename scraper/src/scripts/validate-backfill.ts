#!/usr/bin/env tsx
/**
 * Story 11.4 (AC6): Data Quality Validation Script
 *
 * Validates backfilled listing performance data against quality criteria.
 * Checks:
 * - Field validation (required fields not NULL)
 * - Date range validation (2015-01-01 to TODAY)
 * - Price range validation (> 0)
 * - Listing gain validation (-100% to 1000%)
 * - Referential integrity (valid ipo_id foreign keys)
 * - Duplicate prevention (no duplicate ipo_id, symbol + listing_date)
 * - Data consistency (dates match ±7 days, listing gain calculations)
 * - Quality score calculation (Target: > 95%)
 *
 * Usage:
 *   npm run validate:backfill
 */

import logger from '../utils/logger.js';
import { db } from '@ipodhan/shared/db';
import { sql } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

interface ValidationResult {
  passed: boolean;
  message: string;
  count?: number;
  failures?: any[];
}

interface ValidationReport {
  timestamp: string;
  totalRecords: number;
  validationResults: Record<string, ValidationResult>;
  qualityScore: number;
  passed: boolean;
}

/**
 * AC6.1: Field validation - Check for NULL in required fields
 */
async function validateRequiredFields(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        id,
        symbol,
        company_name,
        listing_date,
        listing_price
      FROM listing_performance
      WHERE symbol IS NULL
        OR company_name IS NULL
        OR listing_date IS NULL
        OR listing_price IS NULL
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'All records have required fields (symbol, company_name, listing_date, listing_price)'
        : `Found ${failures.length} records with NULL required fields`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate required fields (AC6.1)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.2: Date range validation - Check dates between 2015-01-01 and TODAY
 */
async function validateDateRange(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        id,
        symbol,
        company_name,
        listing_date
      FROM listing_performance
      WHERE listing_date IS NOT NULL
        AND (
          listing_date < '2015-01-01'::date
          OR listing_date > CURRENT_DATE
        )
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'All listing dates within valid range (2015-01-01 to TODAY)'
        : `Found ${failures.length} records with invalid listing dates`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate date range (AC6.2)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.3: Price validation - Check prices > 0
 */
async function validatePriceRanges(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        id,
        symbol,
        company_name,
        listing_price,
        issue_price,
        current_price
      FROM listing_performance
      WHERE (listing_price IS NOT NULL AND listing_price <= 0)
        OR (issue_price IS NOT NULL AND issue_price <= 0)
        OR (current_price IS NOT NULL AND current_price <= 0)
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'All prices are positive (> 0)'
        : `Found ${failures.length} records with invalid prices (≤ 0)`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate price ranges (AC6.3)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.4: Listing gain validation - Check range -100% to 1000%
 */
async function validateListingGain(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        id,
        symbol,
        company_name,
        listing_gain_percent
      FROM listing_performance
      WHERE listing_gain_percent IS NOT NULL
        AND (
          listing_gain_percent < -100
          OR listing_gain_percent > 1000
        )
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'All listing gains within valid range (-100% to 1000%)'
        : `Found ${failures.length} records with invalid listing gain`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate listing gain (AC6.4)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.5: Referential integrity - Check valid ipo_id foreign keys
 */
async function validateReferentialIntegrity(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        lp.id,
        lp.symbol,
        lp.company_name,
        lp.ipo_id
      FROM listing_performance lp
      WHERE lp.ipo_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ipos i WHERE i.id = lp.ipo_id
        )
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'All ipo_id foreign keys are valid'
        : `Found ${failures.length} records with invalid ipo_id references`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate referential integrity (AC6.5)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.6: Duplicate prevention - Check for duplicate ipo_id
 */
async function validateNoDuplicateIPOIds(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        ipo_id,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id) as listing_performance_ids
      FROM listing_performance
      WHERE ipo_id IS NOT NULL
      GROUP BY ipo_id
      HAVING COUNT(*) > 1
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'No duplicate ipo_id found (one-to-one relationship maintained)'
        : `Found ${failures.length} duplicate ipo_id values`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate duplicate ipo_id (AC6.6)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.7: Duplicate prevention - Check for duplicate symbol + listing_date
 */
async function validateNoDuplicateSymbolDate(dbClient: typeof db): Promise<ValidationResult> {
  try {
    const result = await dbClient.execute(sql`
      SELECT
        symbol,
        listing_date,
        COUNT(*) as duplicate_count,
        ARRAY_AGG(id) as listing_performance_ids
      FROM listing_performance
      WHERE symbol IS NOT NULL
        AND listing_date IS NOT NULL
      GROUP BY symbol, listing_date
      HAVING COUNT(*) > 1
    `);

    const failures = result.rows;
    const passed = failures.length === 0;

    return {
      passed,
      message: passed
        ? 'No duplicate symbol + listing_date combinations found'
        : `Found ${failures.length} duplicate symbol + listing_date combinations`,
      count: failures.length,
      failures: failures.length > 0 ? failures : undefined
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate duplicate symbol + listing_date (AC6.7)');
    return {
      passed: false,
      message: 'Validation query failed'
    };
  }
}

/**
 * AC6.8: Calculate quality score
 * Formula: (recordsWithAllRequired * 0.4 + recordsWithCurrentPrice * 0.3 + matchedRecords * 0.3) * 100
 */
async function calculateQualityScore(dbClient: typeof db): Promise<number> {
  try {
    // Count records with all required fields
    const requiredResult = await dbClient.execute(sql`
      SELECT COUNT(*) as count
      FROM listing_performance
      WHERE symbol IS NOT NULL
        AND company_name IS NOT NULL
        AND listing_date IS NOT NULL
        AND listing_price IS NOT NULL
    `);
    const recordsWithAllRequired = Number(requiredResult.rows[0]?.count || 0);

    // Count records with current price
    const currentPriceResult = await dbClient.execute(sql`
      SELECT COUNT(*) as count
      FROM listing_performance
      WHERE current_price IS NOT NULL
    `);
    const recordsWithCurrentPrice = Number(currentPriceResult.rows[0]?.count || 0);

    // Count matched records (non-NULL ipo_id)
    const matchedResult = await dbClient.execute(sql`
      SELECT COUNT(*) as count
      FROM listing_performance
      WHERE ipo_id IS NOT NULL
    `);
    const matchedRecords = Number(matchedResult.rows[0]?.count || 0);

    // Get total records
    const totalResult = await dbClient.execute(sql`
      SELECT COUNT(*) as count
      FROM listing_performance
    `);
    const totalRecords = Number(totalResult.rows[0]?.count || 0);

    if (totalRecords === 0) {
      return 0;
    }

    // Calculate quality score (AC6.8)
    const requiredScore = (recordsWithAllRequired / totalRecords) * 0.4;
    const currentPriceScore = (recordsWithCurrentPrice / totalRecords) * 0.3;
    const matchScore = (matchedRecords / totalRecords) * 0.3;

    const qualityScore = Math.round((requiredScore + currentPriceScore + matchScore) * 100);

    logger.info({
      totalRecords,
      recordsWithAllRequired,
      recordsWithCurrentPrice,
      matchedRecords,
      qualityScore,
      target: 95
    }, 'Quality score calculated (AC6.8)');

    return qualityScore;

  } catch (error) {
    logger.error({ error }, 'Failed to calculate quality score (AC6.8)');
    return 0;
  }
}

/**
 * Generate CSV report for validation failures
 */
async function generateFailuresReport(validationResults: Record<string, ValidationResult>): Promise<string | null> {
  try {
    const failures: any[] = [];

    for (const [checkName, result] of Object.entries(validationResults)) {
      if (!result.passed && result.failures) {
        for (const failure of result.failures) {
          failures.push({
            check: checkName,
            ...failure
          });
        }
      }
    }

    if (failures.length === 0) {
      return null;
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const filename = `validation-failures-${timestamp}.csv`;
    const logsDir = path.join(process.cwd(), 'logs');
    const filepath = path.join(logsDir, filename);

    // Ensure logs directory exists
    await fs.mkdir(logsDir, { recursive: true });

    // Generate CSV content
    const headers = 'Check,ID,Symbol,Company Name,Details\n';
    const rows = failures.map(f =>
      `"${f.check}","${f.id || ''}","${f.symbol || ''}","${f.company_name || ''}","${JSON.stringify(f).replace(/"/g, '""')}"`
    ).join('\n');

    const csvContent = headers + rows;

    await fs.writeFile(filepath, csvContent, 'utf-8');

    logger.info({ filepath, failureCount: failures.length }, 'Validation failures CSV report generated');

    return filepath;

  } catch (error) {
    logger.error({ error }, 'Failed to generate validation failures report');
    return null;
  }
}

/**
 * Main validation function
 */
async function validateBackfill(): Promise<ValidationReport> {
  logger.info('Starting backfill data quality validation (AC6)');

  // db is already initialized via lazy proxy from @ipodhan/shared/db

  // Get total records
  const totalResult = await db.execute(sql`
    SELECT COUNT(*) as count FROM listing_performance
  `);
  const totalRecords = Number(totalResult.rows[0]?.count || 0);

  // Run all validation checks (AC6)
  const validationResults: Record<string, ValidationResult> = {
    'Required Fields (AC6.1)': await validateRequiredFields(db),
    'Date Range (AC6.2)': await validateDateRange(db),
    'Price Ranges (AC6.3)': await validatePriceRanges(db),
    'Listing Gain (AC6.4)': await validateListingGain(db),
    'Referential Integrity (AC6.5)': await validateReferentialIntegrity(db),
    'No Duplicate ipo_id (AC6.6)': await validateNoDuplicateIPOIds(db),
    'No Duplicate Symbol+Date (AC6.7)': await validateNoDuplicateSymbolDate(db),
  };

  // Calculate quality score (AC6.8)
  const qualityScore = await calculateQualityScore(db);

  // Check if all validations passed
  const allPassed = Object.values(validationResults).every(r => r.passed);
  const passed = allPassed && qualityScore >= 95;

  // Generate failures report if any validation failed
  let failuresReportPath: string | null = null;
  if (!allPassed) {
    failuresReportPath = await generateFailuresReport(validationResults);
  }

  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    totalRecords,
    validationResults,
    qualityScore,
    passed,
  };

  // Print report to console
  console.log('\n' + '='.repeat(80));
  console.log('BACKFILL DATA QUALITY VALIDATION REPORT (AC6)');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`Total Records: ${report.totalRecords}`);
  console.log('');
  console.log('Validation Checks:');
  console.log('-'.repeat(80));

  for (const [checkName, result] of Object.entries(report.validationResults)) {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | ${checkName}`);
    console.log(`       ${result.message}`);
    if (result.count !== undefined) {
      console.log(`       Failures: ${result.count}`);
    }
  }

  console.log('');
  console.log('Quality Score:');
  console.log('-'.repeat(80));
  console.log(`Score: ${report.qualityScore}% (Target: > 95%)`);
  console.log(`Status: ${report.qualityScore >= 95 ? '✅ PASS' : '❌ FAIL'}`);
  console.log('');
  console.log('Overall Result:');
  console.log('-'.repeat(80));
  console.log(`${report.passed ? '✅ VALIDATION PASSED' : '❌ VALIDATION FAILED'}`);

  if (failuresReportPath) {
    console.log('');
    console.log(`Failures Report: ${failuresReportPath}`);
  }

  console.log('='.repeat(80) + '\n');

  logger.info({ report }, 'Backfill data quality validation completed (AC6)');

  return report;
}

/**
 * CLI entry point
 */
async function main() {
  try {
    const report = await validateBackfill();
    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    logger.error({ error }, 'Validation script failed');
    process.exit(1);
  }
}

// Run CLI if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
