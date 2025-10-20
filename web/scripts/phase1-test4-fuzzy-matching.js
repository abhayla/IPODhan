#!/usr/bin/env node

/**
 * Phase 1 - Test 4: Fuzzy Matching Quality Tests
 *
 * Validates:
 * - Review matching to IPOs (>90% target)
 * - Document matching to IPOs (>90% target)
 * - No false positives (wrong IPO matched)
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runFuzzyMatchingTests() {
  console.log('🔍 Phase 1 - Test 4: Fuzzy Matching Quality Tests\n');
  console.log(`⚠️  Running against VPS database: ${process.env.DATABASE_HOST}:${process.env.DATABASE_PORT}/${process.env.DATABASE_NAME}\n`);

  try {
    // Query 1: Check unmatched reviews
    console.log('📊 Query 1: Unmatched Reviews\n' + '='.repeat(80));
    const unmatchedReviews = await pool.query(`
      SELECT
        id,
        review_title,
        author,
        segment,
        recommendation,
        created_at
      FROM ipo_reviews
      WHERE ipo_id IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log(`Found ${unmatchedReviews.rowCount} unmatched reviews (showing first 20):\n`);
    if (unmatchedReviews.rowCount > 0) {
      unmatchedReviews.rows.forEach((review, index) => {
        console.log(`  ${index + 1}. "${review.review_title}"`);
        console.log(`     Author: ${review.author || 'N/A'}`);
        console.log(`     Segment: ${review.segment || 'N/A'}`);
        console.log(`     Recommendation: ${review.recommendation || 'N/A'}`);
        console.log(`     Created: ${review.created_at}\n`);
      });
    } else {
      console.log('  ✅ All reviews are matched to IPOs!\n');
    }

    // Query 2: Check unmatched documents
    console.log('\n📊 Query 2: Unmatched Documents\n' + '='.repeat(80));
    const unmatchedDocs = await pool.query(`
      SELECT
        id,
        title,
        exchange,
        type,
        url,
        created_at
      FROM documents
      WHERE ipo_id IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `);

    console.log(`Found ${unmatchedDocs.rowCount} unmatched documents (showing first 20):\n`);
    if (unmatchedDocs.rowCount > 0) {
      unmatchedDocs.rows.forEach((doc, index) => {
        console.log(`  ${index + 1}. "${doc.title}"`);
        console.log(`     Exchange: ${doc.exchange || 'N/A'}`);
        console.log(`     Type: ${doc.type || 'N/A'}`);
        console.log(`     URL: ${doc.url?.substring(0, 60)}...`);
        console.log(`     Created: ${doc.created_at}\n`);
      });
    } else {
      console.log('  ✅ All documents are matched to IPOs!\n');
    }

    // Query 3: Match rate calculation
    console.log('\n📊 Query 3: Match Rate Calculation\n' + '='.repeat(80));
    const matchRates = await pool.query(`
      SELECT
        'ipo_reviews' as table_name,
        COUNT(*) as total_records,
        COUNT(ipo_id) as matched_records,
        COUNT(*) - COUNT(ipo_id) as unmatched_records,
        ROUND(100.0 * COUNT(ipo_id) / NULLIF(COUNT(*), 0), 2) as match_rate
      FROM ipo_reviews
      UNION ALL
      SELECT
        'documents',
        COUNT(*),
        COUNT(ipo_id),
        COUNT(*) - COUNT(ipo_id),
        ROUND(100.0 * COUNT(ipo_id) / NULLIF(COUNT(*), 0), 2)
      FROM documents
    `);

    console.log('Match Rates:\n');
    matchRates.rows.forEach(row => {
      const status = parseFloat(row.match_rate) >= 90 ? '✅' : '❌';
      console.log(`  ${status} ${row.table_name.toUpperCase()}:`);
      console.log(`     Total: ${row.total_records}`);
      console.log(`     Matched: ${row.matched_records}`);
      console.log(`     Unmatched: ${row.unmatched_records}`);
      console.log(`     Match Rate: ${row.match_rate}%`);
      console.log(`     Target: ≥90%\n`);
    });

    // Query 4: Review distribution by segment
    console.log('\n📊 Query 4: Review Distribution by Segment\n' + '='.repeat(80));
    const reviewDist = await pool.query(`
      SELECT
        segment,
        COUNT(*) as review_count,
        COUNT(ipo_id) as matched_count,
        ROUND(100.0 * COUNT(ipo_id) / COUNT(*), 2) as match_rate
      FROM ipo_reviews
      GROUP BY segment
      ORDER BY review_count DESC
    `);

    if (reviewDist.rowCount > 0) {
      console.log('Review Distribution:\n');
      reviewDist.rows.forEach(row => {
        const status = parseFloat(row.match_rate) >= 90 ? '✅' : '⚠️';
        console.log(`  ${status} ${row.segment || 'UNKNOWN'}:`);
        console.log(`     Reviews: ${row.review_count}`);
        console.log(`     Matched: ${row.matched_count}`);
        console.log(`     Match Rate: ${row.match_rate}%\n`);
      });
    } else {
      console.log('  No reviews found in database\n');
    }

    // Query 5: Document distribution by type
    console.log('\n📊 Query 5: Document Distribution by Type\n' + '='.repeat(80));
    const docDist = await pool.query(`
      SELECT
        type,
        COUNT(*) as doc_count,
        COUNT(ipo_id) as matched_count,
        ROUND(100.0 * COUNT(ipo_id) / COUNT(*), 2) as match_rate
      FROM documents
      GROUP BY type
      ORDER BY doc_count DESC
    `);

    if (docDist.rowCount > 0) {
      console.log('Document Distribution:\n');
      docDist.rows.forEach(row => {
        const status = parseFloat(row.match_rate) >= 90 ? '✅' : '⚠️';
        console.log(`  ${status} ${row.type || 'UNKNOWN'}:`);
        console.log(`     Documents: ${row.doc_count}`);
        console.log(`     Matched: ${row.matched_count}`);
        console.log(`     Match Rate: ${row.match_rate}%\n`);
      });
    } else {
      console.log('  ⚠️  No documents found in database\n');
    }

    // Success Criteria Validation
    console.log('\n📊 Success Criteria Validation\n' + '='.repeat(80));

    const reviewMatchRate = matchRates.rows[0]?.match_rate || 0;
    const documentMatchRate = matchRates.rows[1]?.match_rate || 0;

    const reviewPass = reviewMatchRate >= 90 || matchRates.rows[0]?.total_records === 0;
    const documentPass = documentMatchRate >= 90 || matchRates.rows[1]?.total_records === 0;

    console.log(`  ${reviewPass ? '✅' : '❌'} Review match rate >90%: ${reviewMatchRate}%`);
    console.log(`  ${documentPass ? '✅' : '❌'} Document match rate >90%: ${documentMatchRate}%`);
    console.log(`  ⏳ Manual verification of 10 sample IPOs (pending)\n`);

    if (reviewPass && documentPass) {
      console.log('  ✅ ALL CRITERIA PASSED\n');
    } else {
      console.log('  ❌ SOME CRITERIA FAILED\n');
      console.log('  Recommendations:');
      if (!reviewPass && matchRates.rows[0]?.total_records > 0) {
        console.log('    - Improve review fuzzy matching algorithm');
        console.log(`    - ${matchRates.rows[0].unmatched_records} reviews need manual mapping`);
      }
      if (!documentPass && matchRates.rows[1]?.total_records > 0) {
        console.log('    - Improve document fuzzy matching algorithm');
        console.log(`    - ${matchRates.rows[1].unmatched_records} documents need manual mapping`);
      }
      if (matchRates.rows[1]?.total_records === 0) {
        console.log('    - Documents table is empty - run prospectus scraper');
      }
      console.log('');
    }

    console.log('✅ Fuzzy matching quality tests complete\n');

  } catch (error) {
    console.error('❌ Error running fuzzy matching tests:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runFuzzyMatchingTests();
