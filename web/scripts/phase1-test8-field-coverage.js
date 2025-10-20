#!/usr/bin/env node

/**
 * Phase 1 - Test 8: Field Coverage Analysis
 *
 * Validates:
 * - Field completeness percentages for 31 key fields
 * - Critical fields must have >90% coverage
 * - Secondary fields must have >70% coverage
 * - Identify fields with low coverage for improvement
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Field categories based on criticality (using actual database column names)
const CRITICAL_FIELDS = [
  'company_name',
  'slug',
  'status',
  'segment',           // NOT category
  'exchange',
  'offering_type',
  'open_date',
  'close_date',
  'lot_size',
  'issue_size',
];

const SECONDARY_FIELDS = [
  'listing_date',
  'allotment_date',
  'price_band_low',    // NOT price_band_lower
  'price_band_high',   // NOT price_band_upper
  'face_value',
  'price_range_min',
  'price_range_max',
  'listing_price_historical',
  'listing_gain_percentage',
  'current_price',
  'current_gain_percentage',
];

const OPTIONAL_FIELDS = [
  'gmp',
  'gmp_percentage',
  'subscription_retail',
  'subscription_hni',
  'subscription_qib',
  'subscription_total',
  'lead_managers',
  'registrar_id',
  'rating',
  'rating_rationale',
  'isin',
  'symbol',
  'sector',
  'company_description',
];

async function runFieldCoverageAnalysis() {
  console.log('🔍 Phase 1 - Test 8: Field Coverage Analysis\n');
  console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  try {
    // Get total count
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM ipos');
    const totalIPOs = parseInt(totalResult.rows[0].total);

    console.log(`📊 Total IPOs in Database: ${totalIPOs}\n`);
    console.log('='.repeat(80));

    // Query 1: Critical Fields Coverage
    console.log('\n📊 Query 1: Critical Fields Coverage (Target: >90%)\n' + '='.repeat(80));

    const criticalCoverage = [];
    for (const field of CRITICAL_FIELDS) {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(${field}) as filled,
          ROUND(100.0 * COUNT(${field}) / COUNT(*), 2) as coverage_percent
        FROM ipos
      `);

      const row = result.rows[0];
      const coverage = parseFloat(row.coverage_percent);
      const status = coverage >= 90 ? '✅' : '❌';

      criticalCoverage.push({
        field,
        total: parseInt(row.total),
        filled: parseInt(row.filled),
        missing: parseInt(row.total) - parseInt(row.filled),
        coverage,
        status
      });
    }

    criticalCoverage.forEach(item => {
      console.log(`  ${item.status} ${item.field.padEnd(30)} ${item.coverage.toFixed(2)}%  (${item.filled}/${item.total})`);
    });

    const criticalPass = criticalCoverage.filter(c => c.coverage >= 90).length;
    const criticalFail = criticalCoverage.filter(c => c.coverage < 90).length;
    console.log(`\n  Summary: ${criticalPass}/${CRITICAL_FIELDS.length} critical fields passed (≥90%)`);
    if (criticalFail > 0) {
      console.log(`  ⚠️  ${criticalFail} critical fields below 90% threshold\n`);
    }

    // Query 2: Secondary Fields Coverage
    console.log('\n📊 Query 2: Secondary Fields Coverage (Target: >70%)\n' + '='.repeat(80));

    const secondaryCoverage = [];
    for (const field of SECONDARY_FIELDS) {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(${field}) as filled,
          ROUND(100.0 * COUNT(${field}) / COUNT(*), 2) as coverage_percent
        FROM ipos
      `);

      const row = result.rows[0];
      const coverage = parseFloat(row.coverage_percent);
      const status = coverage >= 70 ? '✅' : '⚠️';

      secondaryCoverage.push({
        field,
        total: parseInt(row.total),
        filled: parseInt(row.filled),
        missing: parseInt(row.total) - parseInt(row.filled),
        coverage,
        status
      });
    }

    secondaryCoverage.forEach(item => {
      console.log(`  ${item.status} ${item.field.padEnd(30)} ${item.coverage.toFixed(2)}%  (${item.filled}/${item.total})`);
    });

    const secondaryPass = secondaryCoverage.filter(c => c.coverage >= 70).length;
    const secondaryFail = secondaryCoverage.filter(c => c.coverage < 70).length;
    console.log(`\n  Summary: ${secondaryPass}/${SECONDARY_FIELDS.length} secondary fields passed (≥70%)`);
    if (secondaryFail > 0) {
      console.log(`  ⚠️  ${secondaryFail} secondary fields below 70% threshold\n`);
    }

    // Query 3: Optional Fields Coverage (No target)
    console.log('\n📊 Query 3: Optional Fields Coverage (Informational)\n' + '='.repeat(80));

    const optionalCoverage = [];
    for (const field of OPTIONAL_FIELDS) {
      const result = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(${field}) as filled,
          ROUND(100.0 * COUNT(${field}) / COUNT(*), 2) as coverage_percent
        FROM ipos
      `);

      const row = result.rows[0];
      const coverage = parseFloat(row.coverage_percent);

      optionalCoverage.push({
        field,
        total: parseInt(row.total),
        filled: parseInt(row.filled),
        missing: parseInt(row.total) - parseInt(row.filled),
        coverage
      });
    }

    optionalCoverage.forEach(item => {
      const icon = item.coverage >= 50 ? '✅' : item.coverage >= 20 ? '⚠️' : '❌';
      console.log(`  ${icon} ${item.field.padEnd(30)} ${item.coverage.toFixed(2)}%  (${item.filled}/${item.total})`);
    });

    // Query 4: Fields with Zero Coverage (Critical Issues)
    console.log('\n📊 Query 4: Fields with Zero Coverage (Critical Issues)\n' + '='.repeat(80));

    const allFields = [...criticalCoverage, ...secondaryCoverage, ...optionalCoverage];
    const zeroFields = allFields.filter(f => f.filled === 0);

    if (zeroFields.length === 0) {
      console.log('  ✅ No fields with zero coverage\n');
    } else {
      console.log(`  ⚠️  Found ${zeroFields.length} fields with ZERO data:\n`);
      zeroFields.forEach(item => {
        console.log(`  ❌ ${item.field}`);
      });
      console.log('\n  These fields require immediate attention - no data being collected\n');
    }

    // Query 5: Low Coverage Fields (<50%)
    console.log('\n📊 Query 5: Low Coverage Fields (<50%)\n' + '='.repeat(80));

    const lowCoverageFields = allFields.filter(f => f.coverage < 50 && f.filled > 0);

    if (lowCoverageFields.length === 0) {
      console.log('  ✅ All populated fields have ≥50% coverage\n');
    } else {
      console.log(`  Found ${lowCoverageFields.length} fields with <50% coverage:\n`);
      lowCoverageFields
        .sort((a, b) => a.coverage - b.coverage)
        .forEach(item => {
          console.log(`  ⚠️  ${item.field.padEnd(30)} ${item.coverage.toFixed(2)}%  (${item.filled}/${item.total} filled, ${item.missing} missing)`);
        });
      console.log('\n  Recommendation: Prioritize scraper improvements for these fields\n');
    }

    // Query 6: IPO Status Distribution
    console.log('\n📊 Query 6: IPO Status Distribution\n' + '='.repeat(80));

    const statusDist = await pool.query(`
      SELECT
        status,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM ipos), 2) as percent
      FROM ipos
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log('IPO Status Distribution:\n');
    statusDist.rows.forEach(row => {
      console.log(`  ${row.status.padEnd(15)} ${row.count.toString().padStart(5)} (${row.percent}%)`);
    });

    // Query 7: Exchange Distribution
    console.log('\n\n📊 Query 7: Exchange Distribution\n' + '='.repeat(80));

    const exchangeDist = await pool.query(`
      SELECT
        exchange,
        COUNT(*) as count,
        ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM ipos), 2) as percent
      FROM ipos
      WHERE exchange IS NOT NULL
      GROUP BY exchange
      ORDER BY count DESC
    `);

    console.log('Exchange Distribution:\n');
    exchangeDist.rows.forEach(row => {
      console.log(`  ${(row.exchange || 'NULL').padEnd(15)} ${row.count.toString().padStart(5)} (${row.percent}%)`);
    });

    // Success Criteria Validation
    console.log('\n\n📊 Success Criteria Validation\n' + '='.repeat(80));

    const criticalFieldsPass = criticalCoverage.every(c => c.coverage >= 90);
    const secondaryFieldsPass = secondaryCoverage.filter(c => c.coverage >= 70).length >= (SECONDARY_FIELDS.length * 0.8); // 80% of secondary fields must pass
    const noZeroFields = zeroFields.length === 0;

    console.log(`  ${criticalFieldsPass ? '✅' : '❌'} All critical fields have ≥90% coverage`);
    console.log(`  ${secondaryFieldsPass ? '✅' : '⚠️'} ≥80% of secondary fields have ≥70% coverage`);
    console.log(`  ${noZeroFields ? '✅' : '❌'} No fields with zero coverage`);

    const allCriteriaMet = criticalFieldsPass && secondaryFieldsPass && noZeroFields;
    console.log(`\n  ${allCriteriaMet ? '✅ ALL SUCCESS CRITERIA MET' : '❌ SOME CRITERIA FAILED'}`);

    if (!allCriteriaMet) {
      console.log('\n  Recommendations:');
      if (!criticalFieldsPass) {
        const failedCritical = criticalCoverage.filter(c => c.coverage < 90);
        console.log('    - Fix critical field coverage:');
        failedCritical.forEach(f => {
          console.log(`      • ${f.field}: ${f.coverage.toFixed(2)}% (need ${f.missing} more records)`);
        });
      }
      if (!secondaryFieldsPass) {
        const failedSecondary = secondaryCoverage.filter(c => c.coverage < 70);
        console.log('    - Improve secondary field coverage:');
        failedSecondary.forEach(f => {
          console.log(`      • ${f.field}: ${f.coverage.toFixed(2)}% (need ${f.missing} more records)`);
        });
      }
      if (!noZeroFields) {
        console.log('    - Implement scrapers for zero-coverage fields:');
        zeroFields.forEach(f => {
          console.log(`      • ${f.field} (0% coverage)`);
        });
      }
      console.log('');
    }

    console.log('\n✅ Field coverage analysis complete\n');

  } catch (error) {
    console.error('❌ Error running field coverage analysis:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runFieldCoverageAnalysis();
