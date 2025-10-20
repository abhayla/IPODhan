#!/usr/bin/env node

/**
 * Phase 1, Step 3: Data Population Verification
 * Checks all tables for data and generates coverage report
 */

const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

// Load .env.local
const envPath = path.join(__dirname, '..', '.env.local');
dotenv.config({ path: envPath });

async function verifyDataPopulation() {
  console.log('🔍 Phase 1, Step 3: Data Population Verification\n');
  console.log(`📍 VPS Database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const issues = [];
  const coverage = {};

  try {
    const client = await pool.connect();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 TABLE POPULATION COUNTS');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Count all tables
    const countQuery = `
      SELECT 'ipos' as table_name, COUNT(*) as count FROM ipos
      UNION ALL SELECT 'ipo_details', COUNT(*) FROM ipo_details
      UNION ALL SELECT 'ipo_financials', COUNT(*) FROM ipo_financials
      UNION ALL SELECT 'ipo_reviews', COUNT(*) FROM ipo_reviews
      UNION ALL SELECT 'ipo_scores', COUNT(*) FROM ipo_scores
      UNION ALL SELECT 'market_holidays', COUNT(*) FROM market_holidays
      UNION ALL SELECT 'registrars', COUNT(*) FROM registrars
      UNION ALL SELECT 'documents', COUNT(*) FROM documents
      UNION ALL SELECT 'listing_performance', COUNT(*) FROM listing_performance
      UNION ALL SELECT 'gmp_tracking', COUNT(*) FROM gmp_tracking
      UNION ALL SELECT 'gmp_records', COUNT(*) FROM gmp_records
      UNION ALL SELECT 'gmp_history', COUNT(*) FROM gmp_history
      UNION ALL SELECT 'subscriptions', COUNT(*) FROM subscriptions
      UNION ALL SELECT 'subscription_data', COUNT(*) FROM subscription_data
      UNION ALL SELECT 'peer_companies', COUNT(*) FROM peer_companies
      UNION ALL SELECT 'financial_data', COUNT(*) FROM financial_data
      UNION ALL SELECT 'broker_affiliates', COUNT(*) FROM broker_affiliates
      UNION ALL SELECT 'affiliate_clicks', COUNT(*) FROM affiliate_clicks
      UNION ALL SELECT 'scraper_logs', COUNT(*) FROM scraper_logs
      UNION ALL SELECT 'pipeline_status', COUNT(*) FROM pipeline_status
      UNION ALL SELECT 'users', COUNT(*) FROM users
      UNION ALL SELECT 'user_watchlist', COUNT(*) FROM user_watchlist
      UNION ALL SELECT 'score_history', COUNT(*) FROM score_history
      UNION ALL SELECT 'score_performance', COUNT(*) FROM score_performance
      UNION ALL SELECT 'ab_experiments', COUNT(*) FROM ab_experiments
      UNION ALL SELECT 'api_keys', COUNT(*) FROM api_keys
      ORDER BY count DESC;
    `;

    const countResult = await client.query(countQuery);

    countResult.rows.forEach((row, index) => {
      const count = parseInt(row.count);
      const icon = count > 0 ? '✅' : '⚠️ ';

      console.log(`${(index + 1).toString().padStart(2)}. ${icon} ${row.table_name.padEnd(25)} ${count.toLocaleString().padStart(10)} records`);

      coverage[row.table_name] = count;

      // Flag empty critical tables
      const criticalTables = ['ipos', 'ipo_details'];
      if (count === 0 && criticalTables.includes(row.table_name)) {
        issues.push({
          severity: 'CRITICAL',
          table: row.table_name,
          issue: 'Critical table is empty',
          expected: '> 0 records',
          actual: '0 records'
        });
      }
    });

    console.log('');

    // Check IPO status distribution
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📈 IPO STATUS DISTRIBUTION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const statusQuery = `
      SELECT status, COUNT(*) as count
      FROM ipos
      GROUP BY status
      ORDER BY count DESC;
    `;

    const statusResult = await client.query(statusQuery);

    if (statusResult.rows.length === 0) {
      console.log('⚠️  NO IPOs FOUND\n');
    } else {
      statusResult.rows.forEach((row) => {
        console.log(`  ${row.status.padEnd(15)} ${row.count.toString().padStart(5)} IPOs`);
      });
      console.log('');
    }

    // Check IPO category distribution
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 IPO CATEGORY DISTRIBUTION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const categoryQuery = `
      SELECT segment, COUNT(*) as count
      FROM ipos
      GROUP BY segment
      ORDER BY count DESC;
    `;

    const categoryResult = await client.query(categoryQuery);

    if (categoryResult.rows.length === 0) {
      console.log('⚠️  NO CATEGORIES FOUND\n');
    } else {
      categoryResult.rows.forEach((row) => {
        console.log(`  ${(row.segment || 'NULL').padEnd(15)} ${row.count.toString().padStart(5)} IPOs`);
      });
      console.log('');
    }

    // Check data relationships
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔗 DATA RELATIONSHIPS & COVERAGE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // IPOs with details
    const detailsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE id.id IS NOT NULL)::numeric / COUNT(*) * 100 as percentage
      FROM ipos i
      LEFT JOIN ipo_details id ON i.id = id.ipo_id;
    `;

    const detailsResult = await client.query(detailsQuery);
    const detailsPercent = parseFloat(detailsResult.rows[0].percentage || 0).toFixed(2);
    console.log(`✅ IPOs with details:      ${detailsPercent.padStart(6)}% (${coverage['ipo_details']}/${coverage['ipos']})`);

    // IPOs with financials
    const financialsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE if_table.id IS NOT NULL)::numeric / COUNT(*) * 100 as percentage
      FROM ipos i
      LEFT JOIN ipo_financials if_table ON i.id = if_table.ipo_id;
    `;

    const financialsResult = await client.query(financialsQuery);
    const financialsPercent = parseFloat(financialsResult.rows[0].percentage || 0).toFixed(2);
    console.log(`⚠️  IPOs with financials:   ${financialsPercent.padStart(6)}% (${coverage['ipo_financials']}/${coverage['ipos']})`);

    // LISTED IPOs with listing_performance
    const listingQuery = `
      SELECT
        COUNT(*) FILTER (WHERE lp.id IS NOT NULL)::numeric / COUNT(*) * 100 as percentage,
        COUNT(*) as total_listed,
        COUNT(*) FILTER (WHERE lp.id IS NOT NULL) as with_performance
      FROM ipos i
      LEFT JOIN listing_performance lp ON i.id = lp.ipo_id
      WHERE i.status = 'LISTED';
    `;

    const listingResult = await client.query(listingQuery);
    const listingPercent = listingResult.rows[0].total_listed > 0
      ? parseFloat(listingResult.rows[0].percentage || 0).toFixed(2)
      : '0.00';
    const totalListed = parseInt(listingResult.rows[0].total_listed || 0);
    const withPerformance = parseInt(listingResult.rows[0].with_performance || 0);
    console.log(`${withPerformance === totalListed ? '✅' : '⚠️ '} LISTED with performance: ${listingPercent.padStart(6)}% (${withPerformance}/${totalListed})`);

    if (withPerformance < totalListed) {
      issues.push({
        severity: 'MAJOR',
        table: 'listing_performance',
        issue: 'Some LISTED IPOs missing listing performance data',
        expected: `${totalListed} records`,
        actual: `${withPerformance} records`
      });
    }

    // OPEN IPOs with GMP data
    const gmpQuery = `
      SELECT
        COUNT(*) as total_open,
        COUNT(*) FILTER (WHERE i.gmp IS NOT NULL) as with_gmp
      FROM ipos i
      WHERE i.status = 'OPEN';
    `;

    const gmpResult = await client.query(gmpQuery);
    const totalOpen = parseInt(gmpResult.rows[0].total_open || 0);
    const withGmp = parseInt(gmpResult.rows[0].with_gmp || 0);
    const gmpPercent = totalOpen > 0 ? (withGmp / totalOpen * 100).toFixed(2) : '0.00';
    console.log(`${withGmp === totalOpen ? '✅' : '⚠️ '} OPEN with GMP data:    ${gmpPercent.padStart(6)}% (${withGmp}/${totalOpen})`);

    if (withGmp < totalOpen) {
      issues.push({
        severity: 'MAJOR',
        table: 'ipos',
        issue: 'Some OPEN IPOs missing GMP data',
        expected: `${totalOpen} with GMP`,
        actual: `${withGmp} with GMP`
      });
    }

    console.log('');

    // Sample a few IPOs
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔬 SAMPLE IPOS (Random 5)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const sampleQuery = `
      SELECT
        i.id,
        i.company_name,
        i.status,
        i.segment,
        i.open_date,
        i.close_date,
        CASE WHEN id.id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_details,
        CASE WHEN if_table.id IS NOT NULL THEN 'YES' ELSE 'NO' END as has_financials,
        CASE WHEN i.gmp IS NOT NULL THEN 'YES' ELSE 'NO' END as has_gmp
      FROM ipos i
      LEFT JOIN ipo_details id ON i.id = id.ipo_id
      LEFT JOIN ipo_financials if_table ON i.id = if_table.ipo_id
      ORDER BY RANDOM()
      LIMIT 5;
    `;

    const sampleResult = await client.query(sampleQuery);

    sampleResult.rows.forEach((ipo, index) => {
      console.log(`${index + 1}. ${ipo.company_name}`);
      console.log(`   ID: ${ipo.id}`);
      console.log(`   Status: ${ipo.status} | Segment: ${ipo.segment || 'N/A'}`);
      console.log(`   Dates: ${ipo.open_date || 'N/A'} to ${ipo.close_date || 'N/A'}`);
      console.log(`   Data: Details=${ipo.has_details} | Financials=${ipo.has_financials} | GMP=${ipo.has_gmp}`);
      console.log('');
    });

    client.release();

    // Summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 DATA POPULATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log(`✅ Total IPOs: ${coverage['ipos']}`);
    console.log(`✅ IPO Details Coverage: ${detailsPercent}%`);
    console.log(`⚠️  IPO Financials Coverage: ${financialsPercent}%`);
    console.log(`${withPerformance === totalListed ? '✅' : '⚠️ '} Listing Performance Coverage: ${listingPercent}%`);
    console.log(`${withGmp === totalOpen ? '✅' : '⚠️ '} GMP Coverage (OPEN IPOs): ${gmpPercent}%`);
    console.log(`✅ Market Holidays: ${coverage['market_holidays']}`);
    console.log(`✅ Scraper Logs: ${coverage['scraper_logs']}`);
    console.log('');

    if (issues.length > 0) {
      console.log('\n⚠️  ISSUES FOUND:');
      issues.forEach((issue, index) => {
        console.log(`\n${index + 1}. [${issue.severity}] ${issue.table}`);
        console.log(`   Issue: ${issue.issue}`);
        console.log(`   Expected: ${issue.expected}`);
        console.log(`   Actual: ${issue.actual}`);
      });
      console.log('');
    } else {
      console.log('✅ NO DATA POPULATION ISSUES FOUND\n');
    }

    console.log('✅ Step 3: Data Population Verification COMPLETE\n');

    // Write coverage data to file for later use
    const coverageReport = {
      timestamp: new Date().toISOString(),
      totalIPOs: coverage['ipos'],
      coverage: coverage,
      relationships: {
        detailsCoverage: parseFloat(detailsPercent),
        financialsCoverage: parseFloat(financialsPercent),
        listingPerformanceCoverage: parseFloat(listingPercent),
        gmpCoverage: parseFloat(gmpPercent)
      },
      issues: issues
    };

    fs.writeFileSync(
      path.join(__dirname, '..', 'DATA_POPULATION_REPORT.json'),
      JSON.stringify(coverageReport, null, 2)
    );

    console.log('📄 Report saved to: DATA_POPULATION_REPORT.json\n');

  } catch (error) {
    console.error('\n❌ ERROR during data population verification:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyDataPopulation();
