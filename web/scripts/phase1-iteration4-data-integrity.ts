/**
 * Phase 1 Iteration 4: Data Integrity Checks
 *
 * Comprehensive validation of data quality and referential integrity
 *
 * Usage: npx tsx scripts/phase1-iteration4-data-integrity.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { Pool } from 'pg';

async function runDataIntegrityChecks() {
  console.log('\n🔍 Phase 1 Iteration 4: Data Integrity Checks\n');
  console.log('='.repeat(60));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`,
  });

  let allPassed = true;

  try {
    // Test 1: Foreign Key Integrity
    console.log('\n📌 Test 1: Foreign Key Integrity');

    const fkTests = [
      {
        name: 'ipo_details → ipos',
        query: 'SELECT COUNT(*) as count FROM ipo_details WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
      {
        name: 'ipo_reviews → ipos',
        query: 'SELECT COUNT(*) as count FROM ipo_reviews WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
      {
        name: 'documents → ipos',
        query: 'SELECT COUNT(*) as count FROM documents WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
      {
        name: 'gmp_records → ipos',
        query: 'SELECT COUNT(*) as count FROM gmp_records WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
      {
        name: 'subscriptions → ipos',
        query: 'SELECT COUNT(*) as count FROM subscriptions WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
      {
        name: 'peer_companies → ipos',
        query: 'SELECT COUNT(*) as count FROM peer_companies WHERE ipo_id NOT IN (SELECT id FROM ipos)',
      },
    ];

    for (const test of fkTests) {
      const result = await pool.query(test.query);
      const orphans = parseInt(result.rows[0].count);
      const status = orphans === 0 ? '✓' : '✗';
      console.log(`   ${status} ${test.name}: ${orphans} orphaned records`);
      if (orphans > 0) allPassed = false;
    }

    // Test 2: Duplicate Slugs
    console.log('\n📌 Test 2: Duplicate Slugs');
    const dupSlugs = await pool.query(`
      SELECT slug, COUNT(*) as count
      FROM ipos
      GROUP BY slug
      HAVING COUNT(*) > 1
    `);
    const hasDuplicates = dupSlugs.rows.length > 0;
    console.log(`   ${hasDuplicates ? '✗' : '✓'} Duplicate slugs: ${dupSlugs.rows.length}`);
    if (hasDuplicates) {
      console.log('   Duplicates found:');
      dupSlugs.rows.forEach(row => {
        console.log(`     - ${row.slug}: ${row.count} occurrences`);
      });
      allPassed = false;
    }

    // Test 3: Date Logic
    console.log('\n📌 Test 3: Date Logic Validation');

    const invalidCloseDates = await pool.query(`
      SELECT id, company_name, open_date, close_date
      FROM ipos
      WHERE close_date < open_date
    `);
    console.log(`   ${invalidCloseDates.rows.length === 0 ? '✓' : '✗'} close_date >= open_date: ${invalidCloseDates.rows.length} violations`);
    if (invalidCloseDates.rows.length > 0) {
      invalidCloseDates.rows.slice(0, 5).forEach(row => {
        console.log(`     - ${row.company_name}: open=${row.open_date}, close=${row.close_date}`);
      });
      allPassed = false;
    }

    const listedWithoutDate = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE status = 'LISTED' AND listing_date IS NULL
    `);
    const missingListingDate = parseInt(listedWithoutDate.rows[0].count);
    console.log(`   ${missingListingDate === 0 ? '✓' : '⚠️'} LISTED IPOs have listing_date: ${missingListingDate} missing`);
    if (missingListingDate > 0) {
      // This is a warning, not a failure - listing dates might not be available yet
      console.log(`     Note: ${missingListingDate} LISTED IPOs are missing listing dates`);
    }

    // Test 4: Price Logic
    console.log('\n📌 Test 4: Price Band Validation');

    const invalidPriceBands = await pool.query(`
      SELECT id, company_name, price_range_min, price_range_max
      FROM ipos
      WHERE price_range_max < price_range_min
    `);
    console.log(`   ${invalidPriceBands.rows.length === 0 ? '✓' : '✗'} price_range_max >= price_range_min: ${invalidPriceBands.rows.length} violations`);
    if (invalidPriceBands.rows.length > 0) {
      invalidPriceBands.rows.forEach(row => {
        console.log(`     - ${row.company_name}: min=${row.price_range_min}, max=${row.price_range_max}`);
      });
      allPassed = false;
    }

    // Test 5: Data Quality Checks
    console.log('\n📌 Test 5: Data Quality Validation');

    const invalidLotSize = await pool.query(`
      SELECT COUNT(*) as count FROM ipos WHERE lot_size <= 0
    `);
    const badLotSize = parseInt(invalidLotSize.rows[0].count);
    console.log(`   ${badLotSize === 0 ? '✓' : '✗'} lot_size > 0: ${badLotSize} violations`);
    if (badLotSize > 0) allPassed = false;

    const invalidIssueSize = await pool.query(`
      SELECT COUNT(*) as count FROM ipos WHERE issue_size IS NOT NULL AND issue_size::numeric <= 0
    `);
    const badIssueSize = parseInt(invalidIssueSize.rows[0].count);
    console.log(`   ${badIssueSize === 0 ? '✓' : '✗'} issue_size > 0: ${badIssueSize} violations`);
    if (badIssueSize > 0) allPassed = false;

    // Test 6: Critical Fields Coverage
    console.log('\n📌 Test 6: Critical Fields Coverage');

    const totalIPOs = await pool.query('SELECT COUNT(*) as count FROM ipos');
    const total = parseInt(totalIPOs.rows[0].count);

    const criticalFields = [
      { name: 'company_name', query: 'SELECT COUNT(*) as count FROM ipos WHERE company_name IS NOT NULL' },
      { name: 'slug', query: 'SELECT COUNT(*) as count FROM ipos WHERE slug IS NOT NULL' },
      { name: 'status', query: 'SELECT COUNT(*) as count FROM ipos WHERE status IS NOT NULL' },
      { name: 'exchange', query: 'SELECT COUNT(*) as count FROM ipos WHERE exchange IS NOT NULL' },
      { name: 'offering_type', query: 'SELECT COUNT(*) as count FROM ipos WHERE offering_type IS NOT NULL' },
    ];

    for (const field of criticalFields) {
      const result = await pool.query(field.query);
      const filled = parseInt(result.rows[0].count);
      const coverage = ((filled / total) * 100).toFixed(1);
      const status = parseFloat(coverage) >= 90 ? '✓' : '✗';
      console.log(`   ${status} ${field.name}: ${coverage}%`);
      if (parseFloat(coverage) < 90) allPassed = false;
    }

    // Test 7: Scraper Health
    console.log('\n📌 Test 7: Scraper Health Check');

    const scraperHealth = await pool.query(`
      WITH latest_runs AS (
        SELECT
          source,
          MAX(created_at) as latest_run
        FROM scraper_logs
        GROUP BY source
      )
      SELECT
        sl.source,
        sl.status,
        sl.created_at,
        sl.records_processed,
        sl.error_message
      FROM scraper_logs sl
      INNER JOIN latest_runs lr ON sl.source = lr.source AND sl.created_at = lr.latest_run
      ORDER BY sl.source
    `);

    console.log(`   Last scraper runs:`);
    scraperHealth.rows.forEach(row => {
      const daysSince = Math.floor((Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24));
      const statusIcon = row.status === 'SUCCESS' ? '✓' : row.status === 'PARTIAL' ? '⚠️' : '✗';
      console.log(`   ${statusIcon} ${row.source}: ${row.status} (${daysSince}d ago, ${row.records_processed} records)`);
      if (row.status === 'FAILURE') {
        console.log(`       Error: ${row.error_message}`);
      }
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Data Integrity Summary:\n');
    console.log(`   Total IPOs: ${total}`);
    console.log(`   Foreign Key Integrity: ${allPassed ? 'PASS' : 'FAIL'}`);
    console.log(`   Duplicate Slugs: ${hasDuplicates ? 'FAIL' : 'PASS'}`);
    console.log(`   Date Logic: ${invalidCloseDates.rows.length === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   Price Logic: ${invalidPriceBands.rows.length === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`   Data Quality: ${badLotSize === 0 && badIssueSize === 0 ? 'PASS' : 'FAIL'}`);

    if (allPassed) {
      console.log('\n✅ All data integrity checks PASSED!');
    } else {
      console.log('\n⚠️  Some data integrity checks FAILED - review above for details');
    }

    await pool.end();
    process.exit(allPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Data integrity check failed:', error);
    await pool.end();
    process.exit(1);
  }
}

runDataIntegrityChecks();
