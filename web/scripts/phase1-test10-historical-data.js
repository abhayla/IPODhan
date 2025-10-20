/**
 * Phase 1 - Test 10: Historical Data Completeness
 *
 * Validates historical IPO performance data for LISTED IPOs:
 * - listing_price_historical
 * - listing_gain_percentage
 * - current_price
 * - current_gain_percentage
 * - listing_performance table
 *
 * Success Criteria:
 * - ≥80% of LISTED IPOs have listing_price_historical
 * - ≥70% of LISTED IPOs have current_price
 * - listing_performance table has ≥50 records
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

console.log('🔍 Phase 1 - Test 10: Historical Data Completeness\n');
console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_URL?.split('@')[1]}\n`);

async function runTest() {
  try {
    // Query 1: Count LISTED IPOs
    console.log('📊 Query 1: LISTED IPOs Count');
    console.log('='.repeat(80));

    const listedIPOs = await pool.query(`
      SELECT COUNT(*) as total
      FROM ipos
      WHERE status = 'LISTED'
    `);

    const totalListed = parseInt(listedIPOs.rows[0].total);
    console.log(`Total LISTED IPOs: ${totalListed}`);
    console.log(`  (These IPOs should have historical performance data)\n`);

    // Query 2: Historical Fields Coverage in ipos Table
    console.log('📊 Query 2: Historical Fields Coverage (ipos table)');
    console.log('='.repeat(80));

    const historicalFields = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE listing_price_historical IS NOT NULL) as listing_price_count,
        COUNT(*) FILTER (WHERE listing_gain_percentage IS NOT NULL) as listing_gain_count,
        COUNT(*) FILTER (WHERE current_price IS NOT NULL) as current_price_count,
        COUNT(*) FILTER (WHERE current_gain_percentage IS NOT NULL) as current_gain_count,
        COUNT(*) FILTER (WHERE listing_date_historical IS NOT NULL) as listing_date_count
      FROM ipos
      WHERE status = 'LISTED'
    `);

    const fields = historicalFields.rows[0];
    const listingPricePercent = ((fields.listing_price_count / totalListed) * 100).toFixed(2);
    const listingGainPercent = ((fields.listing_gain_count / totalListed) * 100).toFixed(2);
    const currentPricePercent = ((fields.current_price_count / totalListed) * 100).toFixed(2);
    const currentGainPercent = ((fields.current_gain_count / totalListed) * 100).toFixed(2);
    const listingDatePercent = ((fields.listing_date_count / totalListed) * 100).toFixed(2);

    console.log(`Historical Field Coverage for LISTED IPOs:\n`);
    console.log(`  Total LISTED IPOs: ${totalListed}`);
    console.log(`  ${listingPricePercent >= 80 ? '✅' : '❌'} listing_price_historical: ${fields.listing_price_count}/${totalListed} (${listingPricePercent}%)`);
    console.log(`  ${listingGainPercent >= 80 ? '✅' : '❌'} listing_gain_percentage: ${fields.listing_gain_count}/${totalListed} (${listingGainPercent}%)`);
    console.log(`  ${currentPricePercent >= 70 ? '✅' : '❌'} current_price: ${fields.current_price_count}/${totalListed} (${currentPricePercent}%)`);
    console.log(`  ${currentGainPercent >= 70 ? '✅' : '❌'} current_gain_percentage: ${fields.current_gain_count}/${totalListed} (${currentGainPercent}%)`);
    console.log(`  ${listingDatePercent >= 80 ? '✅' : '❌'} listing_date_historical: ${fields.listing_date_count}/${totalListed} (${listingDatePercent}%)`);
    console.log(`  Target: ≥80% for listing fields, ≥70% for current fields\n`);

    // Query 3: listing_performance Table
    console.log('📊 Query 3: listing_performance Table');
    console.log('='.repeat(80));

    const listingPerf = await pool.query(`
      SELECT COUNT(*) as total
      FROM listing_performance
    `);

    const listingPerfCount = parseInt(listingPerf.rows[0].total);
    console.log(`Total listing_performance records: ${listingPerfCount}`);
    console.log(`  ${listingPerfCount >= 50 ? '✅' : '❌'} Target: ≥50 records\n`);

    // Query 4: Recent listing_performance Records
    console.log('📊 Query 4: Recent listing_performance Records (Top 10)');
    console.log('='.repeat(80));

    const recentPerf = await pool.query(`
      SELECT
        lp.ipo_id,
        i.company_name,
        lp.listing_date,
        lp.listing_price,
        lp.listing_gain_percent,
        lp.current_price,
        lp.current_gain_percent,
        lp.data_source
      FROM listing_performance lp
      JOIN ipos i ON lp.ipo_id = i.id
      ORDER BY lp.listing_date DESC NULLS LAST
      LIMIT 10
    `);

    if (recentPerf.rows.length > 0) {
      console.log('Recent listing performance data:\n');
      recentPerf.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. ${row.company_name}`);
        console.log(`     Listing Date: ${row.listing_date ? new Date(row.listing_date).toDateString() : 'N/A'}`);
        console.log(`     Listing Price: ₹${row.listing_price || 'N/A'}`);
        console.log(`     Listing Gain: ${row.listing_gain_percent || 'N/A'}%`);
        console.log(`     Current Price: ₹${row.current_price || 'N/A'}`);
        console.log(`     Current Gain: ${row.current_gain_percent || 'N/A'}%`);
        console.log(`     Source: ${row.data_source || 'N/A'}\n`);
      });
    } else {
      console.log('  ❌ No listing performance records found\n');
    }

    // Query 5: Historical Data Source Analysis
    console.log('📊 Query 5: Historical Data Source Analysis');
    console.log('='.repeat(80));

    const dataSources = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE historical_data_source = 'NSE') as nse_count,
        COUNT(*) FILTER (WHERE historical_data_source = 'BSE') as bse_count,
        COUNT(*) FILTER (WHERE historical_data_source = 'MONEYCONTROL') as mc_count,
        COUNT(*) FILTER (WHERE historical_data_source = 'CHITTORGARH') as cg_count,
        COUNT(*) FILTER (WHERE historical_data_source IS NULL) as no_source
      FROM ipos
      WHERE status = 'LISTED'
    `);

    const sources = dataSources.rows[0];
    console.log(`Historical Data Source Distribution:\n`);
    console.log(`  NSE: ${sources.nse_count} IPOs`);
    console.log(`  BSE: ${sources.bse_count} IPOs`);
    console.log(`  Moneycontrol: ${sources.mc_count} IPOs`);
    console.log(`  Chittorgarh: ${sources.cg_count} IPOs`);
    console.log(`  No Source: ${sources.no_source} IPOs\n`);

    // Query 6: IPOs with Complete Historical Data
    console.log('📊 Query 6: IPOs with Complete Historical Data');
    console.log('='.repeat(80));

    const completeData = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE status = 'LISTED'
        AND listing_price_historical IS NOT NULL
        AND listing_gain_percentage IS NOT NULL
        AND current_price IS NOT NULL
        AND current_gain_percentage IS NOT NULL
    `);

    const completeCount = parseInt(completeData.rows[0].count);
    const completePercent = ((completeCount / totalListed) * 100).toFixed(2);
    console.log(`IPOs with ALL historical fields populated:\n`);
    console.log(`  ${completeCount}/${totalListed} (${completePercent}%)`);
    console.log(`  ${completePercent >= 50 ? '✅' : '❌'} Target: ≥50% with complete data\n`);

    // Success Criteria Validation
    console.log('📊 Success Criteria Validation');
    console.log('='.repeat(80));

    const criteria = [
      {
        name: 'listing_price_historical coverage ≥80%',
        actual: listingPricePercent,
        target: 80,
        pass: listingPricePercent >= 80
      },
      {
        name: 'current_price coverage ≥70%',
        actual: currentPricePercent,
        target: 70,
        pass: currentPricePercent >= 70
      },
      {
        name: 'listing_performance records ≥50',
        actual: listingPerfCount,
        target: 50,
        pass: listingPerfCount >= 50
      },
      {
        name: 'Complete historical data ≥50%',
        actual: completePercent,
        target: 50,
        pass: completePercent >= 50
      }
    ];

    criteria.forEach(c => {
      console.log(`  ${c.pass ? '✅' : '❌'} ${c.name}: ${c.actual}${typeof c.actual === 'string' && c.actual.includes('%') ? '' : '%'}`);
    });

    const allPass = criteria.every(c => c.pass);
    console.log(`\n  ${allPass ? '✅ ALL CRITERIA PASSED' : '❌ SOME CRITERIA FAILED'}\n`);

    if (!allPass) {
      console.log('  Recommendations:');
      console.log('    - Implement historical data scraper for NSE/BSE');
      console.log('    - Backfill listing prices from market data APIs');
      console.log('    - Schedule daily current price updates');
      console.log('    - Consider using Moneycontrol for historical listing data\n');
    }

    console.log('✅ Historical data completeness tests complete\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runTest().catch(console.error);
