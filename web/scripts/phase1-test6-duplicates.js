#!/usr/bin/env node

/**
 * Phase 1 - Test 6: Incremental Scraping Tests (Duplicate Checks)
 *
 * Validates:
 * - Zero duplicate IPOs (by slug)
 * - Zero duplicate reviews
 * - Zero duplicate documents
 * - Zero duplicate market holidays
 * - updated_at timestamps reflect re-scraping
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runDuplicateChecks() {
  console.log('🔍 Phase 1 - Test 6: Incremental Scraping Tests (Duplicate Checks)\n');
  console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  try {
    // Query 1: Check for duplicate IPOs by slug
    console.log('📊 Query 1: Duplicate IPOs (by slug)\n' + '='.repeat(80));
    const duplicateIPOs = await pool.query(`
      SELECT slug, COUNT(*) as count
      FROM ipos
      GROUP BY slug
      HAVING COUNT(*) > 1
      ORDER BY count DESC
    `);

    if (duplicateIPOs.rowCount > 0) {
      console.log(`❌ Found ${duplicateIPOs.rowCount} duplicate IPO slugs:\n`);
      duplicateIPOs.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. slug: "${row.slug}" - ${row.count} occurrences`);
      });
      console.log('');
    } else {
      console.log('  ✅ No duplicate IPOs found!\n');
    }

    // Query 2: Check for duplicate reviews
    console.log('\n📊 Query 2: Duplicate Reviews (by ipo_id + review_title)\n' + '='.repeat(80));
    const duplicateReviews = await pool.query(`
      SELECT ipo_id, review_title, COUNT(*) as count
      FROM ipo_reviews
      WHERE ipo_id IS NOT NULL
      GROUP BY ipo_id, review_title
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);

    if (duplicateReviews.rowCount > 0) {
      console.log(`❌ Found ${duplicateReviews.rowCount} duplicate reviews:\n`);
      duplicateReviews.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. IPO ID: ${row.ipo_id}`);
        console.log(`     Review: "${row.review_title}"`);
        console.log(`     Count: ${row.count} occurrences\n`);
      });
    } else {
      console.log('  ✅ No duplicate reviews found!\n');
    }

    // Query 3: Check for duplicate documents
    console.log('\n📊 Query 3: Duplicate Documents (by URL)\n' + '='.repeat(80));
    const duplicateDocs = await pool.query(`
      SELECT url, COUNT(*) as count
      FROM documents
      WHERE url IS NOT NULL
      GROUP BY url
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);

    if (duplicateDocs.rowCount > 0) {
      console.log(`❌ Found ${duplicateDocs.rowCount} duplicate documents:\n`);
      duplicateDocs.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. URL: ${row.url.substring(0, 70)}...`);
        console.log(`     Count: ${row.count} occurrences\n`);
      });
    } else {
      console.log('  ✅ No duplicate documents found!\n');
    }

    // Query 4: Check for duplicate market holidays
    console.log('\n📊 Query 4: Duplicate Market Holidays\n' + '='.repeat(80));
    const duplicateHolidays = await pool.query(`
      SELECT date, exchange, description, COUNT(*) as count
      FROM market_holidays
      GROUP BY date, exchange, description
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 20
    `);

    if (duplicateHolidays.rowCount > 0) {
      console.log(`❌ Found ${duplicateHolidays.rowCount} duplicate market holidays:\n`);
      duplicateHolidays.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. Date: ${row.date}`);
        console.log(`     Exchange: ${row.exchange}`);
        console.log(`     Description: ${row.description}`);
        console.log(`     Count: ${row.count} occurrences\n`);
      });
    } else {
      console.log('  ✅ No duplicate market holidays found!\n');
    }

    // Query 5: Check updated_at timestamp freshness
    console.log('\n📊 Query 5: Recently Updated IPOs (Last 24 hours)\n' + '='.repeat(80));
    const recentUpdates = await pool.query(`
      SELECT
        id,
        company_name,
        slug,
        status,
        updated_at,
        EXTRACT(EPOCH FROM (NOW() - updated_at))/3600 as hours_since_update
      FROM ipos
      WHERE updated_at > NOW() - INTERVAL '24 hours'
      ORDER BY updated_at DESC
      LIMIT 10
    `);

    console.log(`Found ${recentUpdates.rowCount} IPOs updated in the last 24 hours:\n`);
    if (recentUpdates.rowCount > 0) {
      recentUpdates.rows.forEach((row, index) => {
        console.log(`  ${index + 1}. "${row.company_name}"`);
        console.log(`     Status: ${row.status}`);
        console.log(`     Updated: ${row.updated_at}`);
        console.log(`     Hours ago: ${parseFloat(row.hours_since_update).toFixed(1)}\n`);
      });
    } else {
      console.log('  ⚠️  No IPOs have been updated in the last 24 hours\n');
      console.log('  This suggests scrapers may not be running regularly.\n');
    }

    // Query 6: Stale IPO data (not updated in 7 days)
    console.log('\n📊 Query 6: Stale IPO Data (Not updated in 7 days)\n' + '='.repeat(80));
    const staleIPOs = await pool.query(`
      SELECT
        COUNT(*) as stale_count,
        MIN(updated_at) as oldest_update,
        MAX(updated_at) as newest_update
      FROM ipos
      WHERE updated_at < NOW() - INTERVAL '7 days'
    `);

    const staleCount = staleIPOs.rows[0].stale_count;
    console.log(`  Total IPOs not updated in 7+ days: ${staleCount}`);
    console.log(`  Oldest update: ${staleIPOs.rows[0].oldest_update}`);
    console.log(`  Newest update: ${staleIPOs.rows[0].newest_update}\n`);

    // Success Criteria Validation
    console.log('\n📊 Success Criteria Validation\n' + '='.repeat(80));

    const noDuplicateIPOs = duplicateIPOs.rowCount === 0;
    const noDuplicateReviews = duplicateReviews.rowCount === 0;
    const noDuplicateDocs = duplicateDocs.rowCount === 0;
    const noDuplicateHolidays = duplicateHolidays.rowCount === 0;
    const hasRecentUpdates = recentUpdates.rowCount > 0;

    console.log(`  ${noDuplicateIPOs ? '✅' : '❌'} Zero duplicate IPOs`);
    console.log(`  ${noDuplicateReviews ? '✅' : '❌'} Zero duplicate reviews`);
    console.log(`  ${noDuplicateDocs ? '✅' : '❌'} Zero duplicate documents`);
    console.log(`  ${noDuplicateHolidays ? '✅' : '❌'} Zero duplicate market holidays`);
    console.log(`  ${hasRecentUpdates ? '✅' : '⚠️ '} updated_at reflects recent scraping (last 24h)\n`);

    if (noDuplicateIPOs && noDuplicateReviews && noDuplicateDocs && noDuplicateHolidays) {
      console.log('  ✅ ALL DUPLICATE CHECKS PASSED\n');
      if (!hasRecentUpdates) {
        console.log('  ⚠️  WARNING: No recent updates - scrapers may not be running regularly\n');
      }
    } else {
      console.log('  ❌ SOME CRITERIA FAILED\n');
      console.log('  Recommendations:');
      if (!noDuplicateIPOs) {
        console.log('    - Fix duplicate IPOs - likely caused by inconsistent slug generation');
      }
      if (!noDuplicateReviews) {
        console.log('    - Fix duplicate reviews - check review deduplication logic');
      }
      if (!noDuplicateDocs) {
        console.log('    - Fix duplicate documents - check document URL uniqueness');
      }
      if (!noDuplicateHolidays) {
        console.log('    - Fix duplicate holidays - check holiday insertion logic');
      }
      console.log('');
    }

    console.log('✅ Duplicate checks complete\n');

  } catch (error) {
    console.error('❌ Error running duplicate checks:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runDuplicateChecks();
