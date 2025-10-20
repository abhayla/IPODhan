#!/usr/bin/env node

/**
 * Phase 1 - Test 9: GMP & Subscription Data Tests
 *
 * Validates:
 * - GMP data completeness for OPEN/UPCOMING IPOs
 * - Subscription data for OPEN IPOs
 * - GMP historical tracking
 * - Subscription trend data
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runGMPSubscriptionTests() {
  console.log('🔍 Phase 1 - Test 9: GMP & Subscription Data Tests\n');
  console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  try {
    // Query 1: Count IPOs by status requiring GMP data
    console.log('📊 Query 1: IPOs Requiring GMP Data (OPEN/UPCOMING)\n' + '='.repeat(80));
    const gmpEligibleIPOs = await pool.query(`
      SELECT
        status,
        COUNT(*) as count
      FROM ipos
      WHERE status IN ('OPEN', 'UPCOMING')
      GROUP BY status
      ORDER BY status
    `);

    let totalGMPEligible = 0;
    console.log('IPOs eligible for GMP data:\n');
    gmpEligibleIPOs.rows.forEach(row => {
      console.log(`  ${row.status.padEnd(15)} ${row.count} IPOs`);
      totalGMPEligible += parseInt(row.count);
    });
    console.log(`\n  Total GMP-Eligible: ${totalGMPEligible} IPOs`);
    console.log(`  (Status: OPEN or UPCOMING)\n`);

    // Query 2: Check GMP field coverage in ipos table
    console.log('\n📊 Query 2: GMP Field Coverage in IPOs Table\n' + '='.repeat(80));
    const gmpCoverage = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(gmp) as has_gmp,
        COUNT(gmp_percentage) as has_gmp_percentage,
        ROUND(100.0 * COUNT(gmp) / NULLIF(COUNT(*), 0), 2) as gmp_coverage,
        ROUND(100.0 * COUNT(gmp_percentage) / NULLIF(COUNT(*), 0), 2) as gmp_percentage_coverage
      FROM ipos
      WHERE status IN ('OPEN', 'UPCOMING')
    `);

    const gmpRow = gmpCoverage.rows[0];
    console.log(`GMP Field Coverage for OPEN/UPCOMING IPOs:\n`);
    console.log(`  Total IPOs: ${gmpRow.total}`);
    console.log(`  ${gmpRow.gmp_coverage >= 80 ? '✅' : '❌'} gmp field populated: ${gmpRow.has_gmp}/${gmpRow.total} (${gmpRow.gmp_coverage}%)`);
    console.log(`  ${gmpRow.gmp_percentage_coverage >= 80 ? '✅' : '❌'} gmp_percentage field populated: ${gmpRow.has_gmp_percentage}/${gmpRow.total} (${gmpRow.gmp_percentage_coverage}%)`);
    console.log(`  Target: ≥80% coverage\n`);

    // Query 3: Check subscription field coverage for OPEN IPOs
    console.log('\n📊 Query 3: Subscription Field Coverage for OPEN IPOs\n' + '='.repeat(80));
    const subscriptionCoverage = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(subscription_retail) as has_retail,
        COUNT(subscription_hni) as has_hni,
        COUNT(subscription_qib) as has_qib,
        COUNT(subscription_total) as has_total,
        ROUND(100.0 * COUNT(subscription_retail) / NULLIF(COUNT(*), 0), 2) as retail_coverage,
        ROUND(100.0 * COUNT(subscription_hni) / NULLIF(COUNT(*), 0), 2) as hni_coverage,
        ROUND(100.0 * COUNT(subscription_qib) / NULLIF(COUNT(*), 0), 2) as qib_coverage,
        ROUND(100.0 * COUNT(subscription_total) / NULLIF(COUNT(*), 0), 2) as total_coverage
      FROM ipos
      WHERE status = 'OPEN'
    `);

    const subRow = subscriptionCoverage.rows[0];
    console.log(`Subscription Field Coverage for OPEN IPOs:\n`);
    console.log(`  Total OPEN IPOs: ${subRow.total}`);
    console.log(`  ${subRow.retail_coverage >= 90 ? '✅' : '❌'} subscription_retail: ${subRow.has_retail}/${subRow.total} (${subRow.retail_coverage}%)`);
    console.log(`  ${subRow.hni_coverage >= 90 ? '✅' : '❌'} subscription_hni: ${subRow.has_hni}/${subRow.total} (${subRow.hni_coverage}%)`);
    console.log(`  ${subRow.qib_coverage >= 90 ? '✅' : '❌'} subscription_qib: ${subRow.has_qib}/${subRow.total} (${subRow.qib_coverage}%)`);
    console.log(`  ${subRow.total_coverage >= 90 ? '✅' : '❌'} subscription_total: ${subRow.has_total}/${subRow.total} (${subRow.total_coverage}%)`);
    console.log(`  Target: ≥90% coverage for OPEN IPOs\n`);

    // Query 4: Check GMP records table
    console.log('\n📊 Query 4: GMP Records Table (gmp_records)\n' + '='.repeat(80));
    const gmpRecordsCount = await pool.query('SELECT COUNT(*) as count FROM gmp_records');
    const gmpRecords = parseInt(gmpRecordsCount.rows[0].count);

    console.log(`Total GMP Records: ${gmpRecords}`);
    if (gmpRecords === 0) {
      console.log(`  ❌ GMP records table is EMPTY`);
      console.log(`  Expected: Historical GMP tracking for OPEN/UPCOMING IPOs\n`);
    } else {
      console.log(`  ✅ GMP records exist\n`);

      // Show latest GMP records
      const latestGMP = await pool.query(`
        SELECT
          ipo_id,
          gmp,
          timestamp
        FROM gmp_records
        ORDER BY timestamp DESC
        LIMIT 10
      `);

      console.log('  Latest GMP Records (Top 10):\n');
      latestGMP.rows.forEach((row, index) => {
        console.log(`    ${index + 1}. IPO ID: ${row.ipo_id}`);
        console.log(`       GMP: ₹${row.gmp}`);
        console.log(`       Updated: ${row.timestamp}\n`);
      });
    }

    // Query 5: Check subscriptions table
    console.log('\n📊 Query 5: Subscriptions Table\n' + '='.repeat(80));
    const subscriptionsCount = await pool.query('SELECT COUNT(*) as count FROM subscriptions');
    const subscriptions = parseInt(subscriptionsCount.rows[0].count);

    console.log(`Total Subscription Records: ${subscriptions}`);
    if (subscriptions === 0) {
      console.log(`  ❌ Subscriptions table is EMPTY`);
      console.log(`  Expected: Time-series subscription data for OPEN IPOs\n`);
    } else {
      console.log(`  ✅ Subscription records exist\n`);

      // Show subscription distribution
      const subDist = await pool.query(`
        SELECT
          ipo_id,
          COUNT(*) as data_points,
          MAX(timestamp) as latest_update
        FROM subscriptions
        GROUP BY ipo_id
        ORDER BY latest_update DESC
        LIMIT 10
      `);

      console.log('  Subscription Data by IPO (Top 10 most recent):\n');
      subDist.rows.forEach((row, index) => {
        console.log(`    ${index + 1}. IPO ID: ${row.ipo_id}`);
        console.log(`       Data Points: ${row.data_points}`);
        console.log(`       Latest Update: ${row.latest_update}\n`);
      });
    }

    // Query 6: GMP tracking completeness
    console.log('\n📊 Query 6: GMP Tracking Completeness\n' + '='.repeat(80));
    const gmpTracking = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'UPCOMING')) as eligible_ipos,
        (SELECT COUNT(DISTINCT ipo_id) FROM gmp_records) as ipos_with_gmp,
        CASE
          WHEN (SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'UPCOMING')) > 0
          THEN ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM gmp_records) / (SELECT COUNT(*) FROM ipos WHERE status IN ('OPEN', 'UPCOMING')), 2)
          ELSE 0
        END as gmp_tracking_percentage
    `);

    const trackingRow = gmpTracking.rows[0];
    const trackingPercent = parseFloat(trackingRow.gmp_tracking_percentage);

    console.log(`GMP Tracking Coverage:\n`);
    console.log(`  Eligible IPOs (OPEN/UPCOMING): ${trackingRow.eligible_ipos}`);
    console.log(`  IPOs with GMP records: ${trackingRow.ipos_with_gmp}`);
    console.log(`  ${trackingPercent >= 80 ? '✅' : '❌'} Tracking Coverage: ${trackingPercent}%`);
    console.log(`  Target: ≥80% of OPEN/UPCOMING IPOs should have GMP tracking\n`);

    // Query 7: Subscription tracking completeness
    console.log('\n📊 Query 7: Subscription Tracking Completeness\n' + '='.repeat(80));
    const subTracking = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM ipos WHERE status = 'OPEN') as open_ipos,
        (SELECT COUNT(DISTINCT ipo_id) FROM subscriptions) as ipos_with_subscriptions,
        CASE
          WHEN (SELECT COUNT(*) FROM ipos WHERE status = 'OPEN') > 0
          THEN ROUND(100.0 * (SELECT COUNT(DISTINCT ipo_id) FROM subscriptions) / (SELECT COUNT(*) FROM ipos WHERE status = 'OPEN'), 2)
          ELSE 0
        END as subscription_tracking_percentage
    `);

    const subTrackingRow = subTracking.rows[0];
    const subTrackingPercent = parseFloat(subTrackingRow.subscription_tracking_percentage);

    console.log(`Subscription Tracking Coverage:\n`);
    console.log(`  OPEN IPOs: ${subTrackingRow.open_ipos}`);
    console.log(`  IPOs with subscription records: ${subTrackingRow.ipos_with_subscriptions}`);
    console.log(`  ${subTrackingPercent >= 90 ? '✅' : '❌'} Tracking Coverage: ${subTrackingPercent}%`);
    console.log(`  Target: ≥90% of OPEN IPOs should have subscription tracking\n`);

    // Success Criteria Validation
    console.log('\n📊 Success Criteria Validation\n' + '='.repeat(80));

    const gmpFieldsPass = gmpRow.gmp_coverage >= 80 && gmpRow.gmp_percentage_coverage >= 80;
    const subscriptionFieldsPass = subRow.retail_coverage >= 90 && subRow.hni_coverage >= 90 && subRow.qib_coverage >= 90 && subRow.total_coverage >= 90;
    const gmpTrackingPass = trackingPercent >= 80 || trackingRow.eligible_ipos === 0;
    const subscriptionTrackingPass = subTrackingPercent >= 90 || subTrackingRow.open_ipos === 0;

    console.log(`  ${gmpFieldsPass ? '✅' : '❌'} GMP fields have ≥80% coverage for OPEN/UPCOMING IPOs`);
    console.log(`  ${subscriptionFieldsPass ? '✅' : '❌'} Subscription fields have ≥90% coverage for OPEN IPOs`);
    console.log(`  ${gmpTrackingPass ? '✅' : '❌'} GMP tracking covers ≥80% of eligible IPOs`);
    console.log(`  ${subscriptionTrackingPass ? '✅' : '❌'} Subscription tracking covers ≥90% of OPEN IPOs`);

    const allCriteriaMet = gmpFieldsPass && subscriptionFieldsPass && gmpTrackingPass && subscriptionTrackingPass;
    console.log(`\n  ${allCriteriaMet ? '✅ ALL SUCCESS CRITERIA MET' : '❌ SOME CRITERIA FAILED'}`);

    if (!allCriteriaMet) {
      console.log('\n  Recommendations:');
      if (!gmpFieldsPass) {
        console.log('    - Run GMP scraper to populate gmp/gmp_percentage fields');
        console.log('    - Command: cd scraper && npm run start:gmp');
      }
      if (!subscriptionFieldsPass) {
        console.log('    - Run NSE scraper to populate subscription fields');
        console.log('    - Command: cd scraper && npm start');
      }
      if (!gmpTrackingPass) {
        console.log('    - Implement historical GMP tracking scraper');
        console.log('    - Populate gmp_records table with time-series data');
      }
      if (!subscriptionTrackingPass) {
        console.log('    - Implement subscription tracking scraper');
        console.log('    - Populate subscriptions table with hourly/daily snapshots');
      }
      console.log('');
    }

    console.log('\n✅ GMP & Subscription data tests complete\n');

  } catch (error) {
    console.error('❌ Error running GMP & Subscription tests:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runGMPSubscriptionTests();
