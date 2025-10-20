/**
 * Fix ISS-008: Populate Exchange Field from listing_exchanges
 *
 * This script fixes the critical P1 issue where the exchange field has 0% coverage.
 * It populates the exchange field based on the existing listing_exchanges array.
 *
 * Logic:
 * - listing_exchanges = ["NSE"] → exchange = "NSE"
 * - listing_exchanges = ["BSE"] → exchange = "BSE"
 * - listing_exchanges = ["NSE", "BSE"] → exchange = "BOTH"
 * - listing_exchanges = null/empty → exchange = null
 *
 * Usage: npx tsx scripts/fix-exchange-field.ts
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { Pool } from 'pg';

async function fixExchangeField() {
  console.log('\n🔧 ISS-008 Fix: Populating Exchange Field\n');
  console.log('='.repeat(60));

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgresql://${process.env.DATABASE_USER}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}`,
  });

  try {
    // Step 1: Analyze current data
    console.log('\n📌 Step 1: Analyzing current data');

    const totalResult = await pool.query('SELECT COUNT(*) as total FROM ipos');
    const totalIPOs = parseInt(totalResult.rows[0].total);
    console.log(`   Total IPOs: ${totalIPOs}`);

    const nullExchangeResult = await pool.query(`
      SELECT COUNT(*) as count
      FROM ipos
      WHERE exchange IS NULL AND listing_exchanges IS NOT NULL
    `);
    const needsFixing = parseInt(nullExchangeResult.rows[0].count);
    console.log(`   IPOs needing exchange fix: ${needsFixing}`);

    if (needsFixing === 0) {
      console.log('\n✅ No IPOs need fixing! Exchange field is already populated.');
      await pool.end();
      process.exit(0);
    }

    // Step 2: Update exchange field based on listing_exchanges
    console.log('\n📌 Step 2: Populating exchange field');

    // Update NSE only (single element JSONB array with NSE)
    const nseResult = await pool.query(`
      UPDATE ipos
      SET exchange = 'NSE'
      WHERE exchange IS NULL
        AND listing_exchanges IS NOT NULL
        AND jsonb_array_length(listing_exchanges) = 1
        AND listing_exchanges->>0 = 'NSE'
    `);
    console.log(`   NSE only: ${nseResult.rowCount} IPOs updated`);

    // Update BSE only (single element JSONB array with BSE)
    const bseResult = await pool.query(`
      UPDATE ipos
      SET exchange = 'BSE'
      WHERE exchange IS NULL
        AND listing_exchanges IS NOT NULL
        AND jsonb_array_length(listing_exchanges) = 1
        AND listing_exchanges->>0 = 'BSE'
    `);
    console.log(`   BSE only: ${bseResult.rowCount} IPOs updated`);

    // Update BOTH (two element JSONB array)
    const bothResult = await pool.query(`
      UPDATE ipos
      SET exchange = 'BOTH'
      WHERE exchange IS NULL
        AND listing_exchanges IS NOT NULL
        AND jsonb_array_length(listing_exchanges) = 2
    `);
    console.log(`   BOTH: ${bothResult.rowCount} IPOs updated`);

    const totalUpdated = (nseResult.rowCount || 0) + (bseResult.rowCount || 0) + (bothResult.rowCount || 0);
    console.log(`   ✓ Total updated: ${totalUpdated}`);

    // Step 3: Verify the fix
    console.log('\n📌 Step 3: Verifying fix');

    const withExchangeResult = await pool.query(`
      SELECT COUNT(*) as count FROM ipos WHERE exchange IS NOT NULL
    `);
    const withExchange = parseInt(withExchangeResult.rows[0].count);
    const coverage = ((withExchange / totalIPOs) * 100).toFixed(1);

    console.log(`   Total IPOs: ${totalIPOs}`);
    console.log(`   IPOs with exchange: ${withExchange}`);
    console.log(`   Coverage: ${coverage}%`);

    // Breakdown by exchange
    const distributionResult = await pool.query(`
      SELECT exchange, COUNT(*) as count
      FROM ipos
      WHERE exchange IS NOT NULL
      GROUP BY exchange
      ORDER BY exchange
    `);

    console.log(`\n   Exchange Distribution:`);
    distributionResult.rows.forEach(row => {
      console.log(`   - ${row.exchange}: ${row.count}`);
    });

    // Step 4: Sample verification
    console.log('\n📌 Step 4: Sample data verification');

    const samplesResult = await pool.query(`
      SELECT company_name, exchange, listing_exchanges
      FROM ipos
      WHERE exchange IS NOT NULL
      LIMIT 5
    `);

    console.log('\n   Sample IPOs:');
    samplesResult.rows.forEach((ipo, idx) => {
      console.log(`   ${idx + 1}. ${ipo.company_name}`);
      console.log(`      Exchange: ${ipo.exchange}`);
      console.log(`      Listing Exchanges: ${JSON.stringify(ipo.listing_exchanges)}`);
    });

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Fix Summary:\n');
    console.log(`   ✓ Updated ${totalUpdated} IPOs`);
    console.log(`   ✓ Coverage improved: 0% → ${coverage}%`);

    if (parseFloat(coverage) >= 99.0) {
      console.log('\n✅ ISS-008 RESOLVED: Exchange field now has near-complete coverage!');
    } else {
      console.log(`\n⚠️  ISS-008 PARTIALLY RESOLVED: Coverage at ${coverage}%`);
    }

    await pool.end();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fix failed:', error);
    await pool.end();
    process.exit(1);
  }
}

fixExchangeField();
