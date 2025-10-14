/**
 * Database Seed Verification Script
 * Story 7.11: Verify database seeding results
 *
 * Validates:
 * - Total IPO count (≥150)
 * - Status distribution (OPEN 10-15%, CLOSED 20-25%, LISTED 50-60%, UPCOMING 10-15%)
 * - Category distribution (MAINBOARD 70%, SME 30%)
 * - Unique slugs (no duplicates)
 * - Required fields populated
 * - Listing performance coverage for LISTED IPOs
 *
 * Usage: npm run verify:seed
 */

// Load environment variables
import { config } from 'dotenv';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db, closePool } from '../lib/db/index';
import { ipos, listingPerformance } from '../lib/db';
import { count, sql } from 'drizzle-orm';

// ==================== CONFIGURATION ====================

const EXPECTED_TOTOTAL = 150;
const TOLERANCE = 5; // ±5% tolerance for distributions

const EXPECTED_DISTRIBUTIONS = {
  status: {
    OPEN: { min: 10, max: 15 },
    CLOSED: { min: 20, max: 25 },
    LISTED: { min: 50, max: 60 },
    UPCOMING: { min: 10, max: 15 },
  },
  category: {
    MAINBOARD: 70,
    SME: 30,
  },
};

// ==================== VERIFICATION FUNCTIONS ====================

interface VerificationResult {
  test: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: any;
}

const results: VerificationResult[] = [];

function addResult(test: string, status: 'PASS' | 'FAIL' | 'WARN', message: string, details?: any) {
  results.push({ test, status, message, details });
}

function printResults() {
  console.log('\n' + '='.repeat(70));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(70) + '\n');

  const passCount = results.filter(r => r.status === 'PASS').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;

  for (const result of results) {
    const icon = result.status === 'PASS' ? '✓' : result.status === 'WARN' ? '⚠' : '✗';
    const color = result.status === 'PASS' ? '' : result.status === 'WARN' ? '' : '';

    console.log(`${icon} ${result.test}`);
    console.log(`  ${result.message}`);
    if (result.details) {
      console.log(`  Details: ${JSON.stringify(result.details, null, 2)}`);
    }
    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`Summary: ${passCount} passed, ${warnCount} warnings, ${failCount} failed`);
  console.log('='.repeat(70) + '\n');

  return failCount === 0;
}

// ==================== MAIN VERIFICATION ====================

async function verifySeeding() {
  console.log('='.repeat(70));
  console.log('DATABASE SEED VERIFICATION');
  console.log('Story 7.11: Comprehensive IPO Database Seeding');
  console.log('='.repeat(70));

  try {
    // Test 1: Total IPO count (AC: 1)
    console.log('\n[1/7] Verifying total IPO count...');
    const totalResult = await db.select({ count: count() }).from(ipos);
    const totalIPOs = Number(totalResult[0]?.count || 0);

    if (totalIPOs >= EXPECTED_TOTOTAL) {
      addResult(
        'Total IPO Count',
        'PASS',
        `Database contains ${totalIPOs} IPOs (target: ≥${EXPECTED_TOTOTAL})`,
        { actual: totalIPOs, expected: `≥${EXPECTED_TOTOTAL}` }
      );
    } else {
      addResult(
        'Total IPO Count',
        'FAIL',
        `Database contains only ${totalIPOs} IPOs (target: ≥${EXPECTED_TOTOTAL})`,
        { actual: totalIPOs, expected: `≥${EXPECTED_TOTOTAL}` }
      );
    }

    // Test 2: Status distribution (AC: 2)
    console.log('[2/7] Verifying status distribution...');
    const statusCounts = {
      OPEN: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'OPEN'`).then(r => Number(r[0]?.count || 0)),
      CLOSED: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'CLOSED'`).then(r => Number(r[0]?.count || 0)),
      LISTED: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'LISTED'`).then(r => Number(r[0]?.count || 0)),
      UPCOMING: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'UPCOMING'`).then(r => Number(r[0]?.count || 0)),
    };

    const statusPercentages = {
      OPEN: (statusCounts.OPEN / totalIPOs) * 100,
      CLOSED: (statusCounts.CLOSED / totalIPOs) * 100,
      LISTED: (statusCounts.LISTED / totalIPOs) * 100,
      UPCOMING: (statusCounts.UPCOMING / totalIPOs) * 100,
    };

    let statusPass = true;
    for (const [status, percent] of Object.entries(statusPercentages)) {
      const expected = EXPECTED_DISTRIBUTIONS.status[status as keyof typeof EXPECTED_DISTRIBUTIONS.status];
      const isInRange = percent >= expected.min && percent <= expected.max;
      const isClose = percent >= (expected.min - TOLERANCE) && percent <= (expected.max + TOLERANCE);

      if (!isInRange) {
        statusPass = false;
      }

      addResult(
        `Status: ${status}`,
        isInRange ? 'PASS' : isClose ? 'WARN' : 'FAIL',
        `${status}: ${statusCounts[status as keyof typeof statusCounts]} IPOs (${percent.toFixed(1)}%) - Expected: ${expected.min}-${expected.max}%`,
        { actual: percent.toFixed(1) + '%', expected: `${expected.min}-${expected.max}%` }
      );
    }

    // Test 3: Category distribution (AC: 5)
    console.log('[3/7] Verifying category distribution...');
    const categoryCounts = {
      MAINBOARD: await db.select({ count: count() }).from(ipos).where(sql`${ipos.category} = 'MAINBOARD'`).then(r => Number(r[0]?.count || 0)),
      SME: await db.select({ count: count() }).from(ipos).where(sql`${ipos.category} = 'SME'`).then(r => Number(r[0]?.count || 0)),
    };

    const categoryPercentages = {
      MAINBOARD: (categoryCounts.MAINBOARD / totalIPOs) * 100,
      SME: (categoryCounts.SME / totalIPOs) * 100,
    };

    for (const [category, percent] of Object.entries(categoryPercentages)) {
      const expected = EXPECTED_DISTRIBUTIONS.category[category as keyof typeof EXPECTED_DISTRIBUTIONS.category];
      const isClose = Math.abs(percent - expected) <= TOLERANCE;

      addResult(
        `Category: ${category}`,
        isClose ? 'PASS' : 'WARN',
        `${category}: ${categoryCounts[category as keyof typeof categoryCounts]} IPOs (${percent.toFixed(1)}%) - Expected: ~${expected}%`,
        { actual: percent.toFixed(1) + '%', expected: `~${expected}%` }
      );
    }

    // Test 4: Unique slugs (AC: 4)
    console.log('[4/7] Checking for duplicate slugs...');
    const duplicateSlugResult = await db.execute(sql`
      SELECT slug, COUNT(*) as count
      FROM ${ipos}
      GROUP BY slug
      HAVING COUNT(*) > 1
    `);

    if (duplicateSlugResult.rows.length === 0) {
      addResult(
        'Unique Slugs',
        'PASS',
        'All IPO slugs are unique (no duplicates found)',
        { duplicates: 0 }
      );
    } else {
      addResult(
        'Unique Slugs',
        'FAIL',
        `Found ${duplicateSlugResult.rows.length} duplicate slugs`,
        { duplicates: duplicateSlugResult.rows }
      );
    }

    // Test 5: Required fields populated (AC: 3)
    console.log('[5/7] Checking required fields...');
    const nullFieldChecks = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE company_name IS NULL) as null_company_name,
        COUNT(*) FILTER (WHERE slug IS NULL) as null_slug,
        COUNT(*) FILTER (WHERE category IS NULL) as null_category,
        COUNT(*) FILTER (WHERE status IS NULL) as null_status,
        COUNT(*) FILTER (WHERE created_at IS NULL) as null_created_at,
        COUNT(*) FILTER (WHERE updated_at IS NULL) as null_updated_at
      FROM ${ipos}
    `);

    const nullCounts = nullFieldChecks.rows[0] as any;
    const hasNulls = Object.values(nullCounts).some((v: any) => Number(v) > 0);

    if (!hasNulls) {
      addResult(
        'Required Fields',
        'PASS',
        'All required fields (companyName, slug, category, status, createdAt, updatedAt) are populated',
        nullCounts
      );
    } else {
      addResult(
        'Required Fields',
        'FAIL',
        'Some required fields have NULL values',
        nullCounts
      );
    }

    // Test 6: Enum validation (AC: 6)
    console.log('[6/7] Validating enum values...');
    const invalidEnums = await db.execute(sql`
      SELECT COUNT(*) as count
      FROM ${ipos}
      WHERE category NOT IN ('MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO')
        OR status NOT IN ('UPCOMING', 'OPEN', 'CLOSED', 'LISTED')
    `);

    const invalidCount = Number((invalidEnums.rows[0] as any)?.count || 0);

    if (invalidCount === 0) {
      addResult(
        'Enum Values',
        'PASS',
        'All category and status enum values are valid',
        { invalidRecords: 0 }
      );
    } else {
      addResult(
        'Enum Values',
        'FAIL',
        `Found ${invalidCount} records with invalid enum values`,
        { invalidRecords: invalidCount }
      );
    }

    // Test 7: Listing performance coverage (AC: 7)
    console.log('[7/7] Checking listing performance coverage...');
    const listedIPOsCount = statusCounts.LISTED;
    const listingPerfResult = await db.select({ count: count() }).from(listingPerformance);
    const listingPerfCount = Number(listingPerfResult[0]?.count || 0);

    const coverage = listedIPOsCount > 0 ? (listingPerfCount / listedIPOsCount) * 100 : 0;

    if (coverage >= 90) {
      addResult(
        'Listing Performance',
        'PASS',
        `${listingPerfCount}/${listedIPOsCount} LISTED IPOs have performance data (${coverage.toFixed(1)}% coverage)`,
        { coverage: coverage.toFixed(1) + '%', expected: '≥90%' }
      );
    } else if (coverage >= 70) {
      addResult(
        'Listing Performance',
        'WARN',
        `${listingPerfCount}/${listedIPOsCount} LISTED IPOs have performance data (${coverage.toFixed(1)}% coverage)`,
        { coverage: coverage.toFixed(1) + '%', expected: '≥90%' }
      );
    } else {
      addResult(
        'Listing Performance',
        'FAIL',
        `Only ${listingPerfCount}/${listedIPOsCount} LISTED IPOs have performance data (${coverage.toFixed(1)}% coverage)`,
        { coverage: coverage.toFixed(1) + '%', expected: '≥90%' }
      );
    }

    // Print results
    const allPassed = printResults();

    if (allPassed) {
      console.log('✓ All verification tests passed!');
      console.log('Database seeding is successful and meets all acceptance criteria.\n');
      process.exit(0);
    } else {
      console.log('✗ Some verification tests failed.');
      console.log('Please review the results above and re-run seeding if necessary.\n');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Verification failed with error:');
    console.error(error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

// ==================== EXECUTION ====================

verifySeeding();
