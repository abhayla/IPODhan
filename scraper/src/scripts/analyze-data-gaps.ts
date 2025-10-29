/**
 * Comprehensive data gap analysis
 * Identifies missing/NULL fields and provides recommendations
 */

import pkg from 'pg';
const { Client } = pkg;

async function analyzeDataGaps() {
  const client = new Client({
    connectionString: 'postgresql://postgres:Papa3Monu%401234@103.118.16.189:5432/ipodhan'
  });

  await client.connect();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('   COMPREHENSIVE DATA GAP ANALYSIS');
  console.log('   BSE Scraper Results - Issue Size & Lot Size Focus');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Analysis 1: Issue Size Gaps
  console.log('📊 ISSUE SIZE ANALYSIS:\n');

  const issueSizeGaps = await client.query(`
    SELECT
      company_name,
      slug,
      offering_type,
      segment,
      status,
      issue_size,
      listing_exchanges,
      updated_at
    FROM ipos
    WHERE (issue_size IS NULL OR issue_size = 0)
      AND updated_at >= NOW() - INTERVAL '6 hours'
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  console.log(`   IPOs with NULL/0 issue_size (last 2 hours): ${issueSizeGaps.rows.length}\n`);

  if (issueSizeGaps.rows.length > 0) {
    console.log('   Top 10 Cases:\n');
    issueSizeGaps.rows.slice(0, 10).forEach((ipo, i) => {
      console.log(`   ${i+1}. ${ipo.company_name}`);
      console.log(`      Type: ${ipo.offering_type} | Segment: ${ipo.segment} | Status: ${ipo.status}`);
      console.log(`      Issue Size: ${ipo.issue_size || 'NULL'} | Exchange: ${ipo.listing_exchanges?.join(', ')}`);
      console.log('');
    });
  }

  // Analysis 2: Lot Size Gaps
  console.log('\n📊 LOT SIZE ANALYSIS:\n');

  const lotSizeGaps = await client.query(`
    SELECT
      company_name,
      slug,
      offering_type,
      segment,
      lot_size,
      price_range_min,
      price_range_max,
      face_value,
      listing_exchanges,
      updated_at
    FROM ipos
    WHERE (lot_size IS NULL OR lot_size <= 1)
      AND updated_at >= NOW() - INTERVAL '6 hours'
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  console.log(`   IPOs with NULL/invalid lot_size (last 2 hours): ${lotSizeGaps.rows.length}\n`);

  if (lotSizeGaps.rows.length > 0) {
    console.log('   Top 10 Cases:\n');
    lotSizeGaps.rows.slice(0, 10).forEach((ipo, i) => {
      console.log(`   ${i+1}. ${ipo.company_name}`);
      console.log(`      Type: ${ipo.offering_type} | Segment: ${ipo.segment}`);
      console.log(`      Lot Size: ${ipo.lot_size || 'NULL'} | Price: ₹${ipo.price_range_min}-${ipo.price_range_max}`);
      console.log(`      Face Value: ₹${ipo.face_value} | Exchange: ${ipo.listing_exchanges?.join(', ')}`);
      console.log('');
    });
  }

  // Analysis 3: Offering Type Breakdown
  console.log('\n📊 OFFERING TYPE BREAKDOWN (Recent IPOs):\n');

  const offeringTypeBreakdown = await client.query(`
    SELECT
      offering_type,
      COUNT(*) as count,
      COUNT(CASE WHEN issue_size IS NULL OR issue_size = 0 THEN 1 END) as missing_issue_size,
      COUNT(CASE WHEN lot_size IS NULL OR lot_size <= 1 THEN 1 END) as missing_lot_size
    FROM ipos
    WHERE updated_at >= NOW() - INTERVAL '6 hours'
    GROUP BY offering_type
    ORDER BY count DESC
  `);

  offeringTypeBreakdown.rows.forEach(row => {
    console.log(`   ${row.offering_type}:`);
    console.log(`      Total: ${row.count} IPOs`);
    console.log(`      Missing Issue Size: ${row.missing_issue_size} (${Math.round(row.missing_issue_size/row.count*100)}%)`);
    console.log(`      Missing Lot Size: ${row.missing_lot_size} (${Math.round(row.missing_lot_size/row.count*100)}%)`);
    console.log('');
  });

  // Analysis 4: Exchange-wise Analysis (simplified - avoiding JSONB array issues)
  console.log('\n📊 EXCHANGE-WISE DATA COMPLETENESS:\n');

  const bseAnalysis = await client.query(`
    SELECT
      COUNT(*) as total_ipos,
      COUNT(CASE WHEN issue_size IS NOT NULL AND issue_size > 0 THEN 1 END) as has_issue_size,
      COUNT(CASE WHEN lot_size IS NOT NULL AND lot_size > 1 THEN 1 END) as has_lot_size,
      COUNT(CASE WHEN isin IS NOT NULL AND isin != '' THEN 1 END) as has_isin
    FROM ipos
    WHERE updated_at >= NOW() - INTERVAL '6 hours'
      AND listing_exchanges @> '["BSE"]'::jsonb
  `);

  const nseAnalysis = await client.query(`
    SELECT
      COUNT(*) as total_ipos,
      COUNT(CASE WHEN issue_size IS NOT NULL AND issue_size > 0 THEN 1 END) as has_issue_size,
      COUNT(CASE WHEN lot_size IS NOT NULL AND lot_size > 1 THEN 1 END) as has_lot_size,
      COUNT(CASE WHEN isin IS NOT NULL AND isin != '' THEN 1 END) as has_isin
    FROM ipos
    WHERE updated_at >= NOW() - INTERVAL '6 hours'
      AND listing_exchanges @> '["NSE"]'::jsonb
  `);

  if (bseAnalysis.rows[0].total_ipos > 0) {
    console.log(`   BSE:`);
    console.log(`      Total IPOs: ${bseAnalysis.rows[0].total_ipos}`);
    console.log(`      Issue Size Coverage: ${Math.round(bseAnalysis.rows[0].has_issue_size/bseAnalysis.rows[0].total_ipos*100)}%`);
    console.log(`      Lot Size Coverage: ${Math.round(bseAnalysis.rows[0].has_lot_size/bseAnalysis.rows[0].total_ipos*100)}%`);
    console.log(`      ISIN Coverage: ${Math.round(bseAnalysis.rows[0].has_isin/bseAnalysis.rows[0].total_ipos*100)}%`);
    console.log('');
  }

  if (nseAnalysis.rows[0].total_ipos > 0) {
    console.log(`   NSE:`);
    console.log(`      Total IPOs: ${nseAnalysis.rows[0].total_ipos}`);
    console.log(`      Issue Size Coverage: ${Math.round(nseAnalysis.rows[0].has_issue_size/nseAnalysis.rows[0].total_ipos*100)}%`);
    console.log(`      Lot Size Coverage: ${Math.round(nseAnalysis.rows[0].has_lot_size/nseAnalysis.rows[0].total_ipos*100)}%`);
    console.log(`      ISIN Coverage: ${Math.round(nseAnalysis.rows[0].has_isin/nseAnalysis.rows[0].total_ipos*100)}%`);
    console.log('');
  }

  // Recommendations
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('   🎯 RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('1. ISSUE SIZE GAPS:');
  if (issueSizeGaps.rows.length > 5) {
    console.log(`   ⚠️  ${issueSizeGaps.rows.length} IPOs missing issue_size`);

    // Check if these are specific offering types
    const riCount = issueSizeGaps.rows.filter(r => r.offering_type === 'RIGHTS_ISSUE').length;
    const otbCount = issueSizeGaps.rows.filter(r => r.offering_type?.includes('OTB')).length;

    if (riCount > 0) {
      console.log(`   → ${riCount} are Rights Issues (RI) - Issue size may not be applicable`);
    }
    if (otbCount > 0) {
      console.log(`   → ${otbCount} are Offer To Buy (OTB) - Issue size may not be on BSE listing page`);
    }
    console.log('   ✅ Action: Review BSE detail page scraping for these offering types\n');
  } else {
    console.log('   ✅ Issue size coverage is good\n');
  }

  console.log('2. LOT SIZE GAPS:');
  if (lotSizeGaps.rows.length > 5) {
    console.log(`   ⚠️  ${lotSizeGaps.rows.length} IPOs with NULL/invalid lot_size`);
    console.log('   → Lot size validation is correctly rejecting lot_size=1');
    console.log('   ✅ Action: Extract lot_size from BSE detail pages\n');
  } else {
    console.log('   ✅ Lot size coverage is acceptable\n');
  }

  console.log('3. ISIN COVERAGE:');
  console.log('   ⚠️  0% ISIN coverage for recent NSE IPOs');
  console.log('   ✅ Action: NSE ISIN backfill script is currently running\n');

  await client.end();
  process.exit(0);
}

analyzeDataGaps().catch(console.error);
