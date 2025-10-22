/**
 * Database Audit Script: Cool Caps Industries Limited
 *
 * Purpose: Determine if Cool Caps is test/seed data or real scraped data
 *
 * Checks:
 * 1. Existence in database
 * 2. All field values (identify NULL/dummy values)
 * 3. Created/updated timestamps
 * 4. Related data (subscriptions, documents, financials, etc.)
 * 5. Scraper log entries
 */

import { getDb } from '../lib/db';
import * as schema from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

async function auditCoolCapsData() {
  console.log('🔍 Starting Cool Caps Industries Limited Database Audit...\n');

  const db = await getDb();

  // ============================================================
  // 1. IPO Record Audit
  // ============================================================
  console.log('📋 Step 1: IPO Record Audit');
  console.log('=' .repeat(60));

  const ipoResult = await db.select()
    .from(schema.ipos)
    .where(eq(schema.ipos.companyName, 'Cool Caps Industries Limited'));

  if (ipoResult.length === 0) {
    console.log('❌ Cool Caps not found in database');
    process.exit(1);
  }

  const ipo = ipoResult[0];
  console.log(`✅ Found Cool Caps IPO in database`);
  console.log(`   ID: ${ipo.id}`);
  console.log(`   Slug: ${ipo.slug}`);
  console.log(`   Created At: ${ipo.createdAt}`);
  console.log(`   Updated At: ${ipo.updatedAt}`);
  console.log('\n');

  // ============================================================
  // 2. Field-by-Field Analysis
  // ============================================================
  console.log('📊 Step 2: Field-by-Field Analysis');
  console.log('=' .repeat(60));

  const fields = [
    { name: 'company_name', value: ipo.companyName, expected: 'Cool Caps Industries Limited' },
    { name: 'symbol', value: ipo.symbol, expected: 'COOLCAPS' },
    { name: 'segment', value: ipo.segment, expected: 'SME' },
    { name: 'category', value: ipo.category, expected: 'IPO' },
    { name: 'status', value: ipo.status, expected: 'LISTED' },
    { name: 'open_date', value: ipo.openDate, expected: '2022-03-10' },
    { name: 'close_date', value: ipo.closeDate, expected: '2022-03-15' },
    { name: 'min_price', value: ipo.minPrice, expected: 36 },
    { name: 'max_price', value: ipo.maxPrice, expected: 38 },
    { name: 'face_value', value: ipo.faceValue, expected: 10 },
    { name: 'lot_size', value: ipo.lotSize, expected: 3000 },
    { name: 'issue_size_crores', value: ipo.issueSizeCrores, expected: 11.63 },
    { name: 'total_shares', value: ipo.totalShares, expected: 3060000 },
    { name: 'registrar_id', value: ipo.registrarId, expected: 'link-intime-id' },
    { name: 'lead_manager', value: ipo.leadManager, expected: 'Holani Consultants' },
  ];

  let correctCount = 0;
  let incorrectCount = 0;
  let nullCount = 0;

  fields.forEach(field => {
    const value = field.value;
    const status = value === null ? '⚠️  NULL' :
                   value === field.expected ? '✅ CORRECT' :
                   '❌ INCORRECT';

    if (value === null) nullCount++;
    else if (value === field.expected) correctCount++;
    else incorrectCount++;

    console.log(`${status} | ${field.name}: ${value} (expected: ${field.expected})`);
  });

  console.log('\n📈 Field Statistics:');
  console.log(`   ✅ Correct: ${correctCount}`);
  console.log(`   ❌ Incorrect: ${incorrectCount}`);
  console.log(`   ⚠️  NULL/Missing: ${nullCount}`);
  console.log(`   📊 Accuracy: ${((correctCount / fields.length) * 100).toFixed(1)}%`);
  console.log('\n');

  // ============================================================
  // 3. Related Data Check
  // ============================================================
  console.log('🔗 Step 3: Related Data Check');
  console.log('=' .repeat(60));

  // Subscriptions
  const subscriptions = await db.select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.ipoId, ipo.id));
  console.log(`   Subscriptions: ${subscriptions.length} records`);
  if (subscriptions.length > 0) {
    console.log(`      Latest: ${subscriptions[0].updatedAt}`);
    console.log(`      Total Times: ${subscriptions[0].totalTimes || 'NULL'}x`);
  }

  // GMP Records
  const gmpRecords = await db.select()
    .from(schema.gmpRecords)
    .where(eq(schema.gmpRecords.ipoId, ipo.id));
  console.log(`   GMP Records: ${gmpRecords.length} records`);

  // Financial Data
  const financialData = await db.select()
    .from(schema.financialData)
    .where(eq(schema.financialData.ipoId, ipo.id));
  console.log(`   Financial Data: ${financialData.length} records`);

  // Documents
  const documents = await db.select()
    .from(schema.documents)
    .where(eq(schema.documents.ipoId, ipo.id));
  console.log(`   Documents: ${documents.length} records`);
  if (documents.length > 0) {
    documents.forEach(doc => {
      console.log(`      - ${doc.documentType}: ${doc.documentUrl}`);
    });
  }

  // Listing Performance
  const listingPerformance = await db.select()
    .from(schema.listingPerformance)
    .where(eq(schema.listingPerformance.ipoId, ipo.id));
  console.log(`   Listing Performance: ${listingPerformance.length} records`);

  console.log('\n');

  // ============================================================
  // 4. Scraper Log Check
  // ============================================================
  console.log('📝 Step 4: Scraper Log Check');
  console.log('=' .repeat(60));

  const scraperLogs = await db.select()
    .from(schema.scraperLogs)
    .where(eq(schema.scraperLogs.ipoId, ipo.id))
    .orderBy(schema.scraperLogs.scrapedAt);

  if (scraperLogs.length === 0) {
    console.log('⚠️  No scraper logs found for Cool Caps');
    console.log('   🔍 This suggests it might be manually inserted or seed data');
  } else {
    console.log(`✅ Found ${scraperLogs.length} scraper log entries:`);
    scraperLogs.forEach((log, index) => {
      console.log(`   ${index + 1}. ${log.scraperType} - ${log.status} - ${log.scrapedAt}`);
      if (log.errorMessage) {
        console.log(`      Error: ${log.errorMessage}`);
      }
    });
  }

  console.log('\n');

  // ============================================================
  // 5. Data Source Analysis
  // ============================================================
  console.log('🔬 Step 5: Data Source Analysis');
  console.log('=' .repeat(60));

  const indicators = {
    isTestData: false,
    isSeedData: false,
    isScrapedData: false,
    isManualEntry: false,
  };

  const reasons = [];

  // Check 1: Dates in future (Oct 2025 for a 2022 IPO)
  if (ipo.openDate && new Date(ipo.openDate) > new Date('2025-01-01')) {
    indicators.isTestData = true;
    reasons.push('❌ Open date is in future (2025) but NSE shows March 2022');
  }

  // Check 2: Lot size = 1 (Phase 3 identified this as test data pattern)
  if (ipo.lotSize === 1) {
    indicators.isTestData = true;
    reasons.push('❌ Lot size = 1 (Phase 3 documented this as invalid test pattern)');
  }

  // Check 3: NULL/missing critical fields
  if (ipo.minPrice === null || ipo.maxPrice === null) {
    indicators.isSeedData = true;
    reasons.push('⚠️  Price band is NULL (seed data pattern)');
  }

  // Check 4: No scraper logs
  if (scraperLogs.length === 0) {
    indicators.isManualEntry = true;
    reasons.push('⚠️  No scraper logs (manually inserted or seed data)');
  }

  // Check 5: Wrong segment
  if (ipo.segment === 'MAINBOARD') {
    indicators.isTestData = true;
    reasons.push('❌ Segment is MAINBOARD but NSE shows SME (incorrect data)');
  }

  // Check 6: Issue size = 0 or NULL
  if (ipo.issueSizeCrores === null || ipo.issueSizeCrores === 0) {
    indicators.isSeedData = true;
    reasons.push('⚠️  Issue size is NULL/0 (incomplete data)');
  }

  // Check 7: No related data
  if (subscriptions.length === 0 && gmpRecords.length === 0 && documents.length === 0) {
    indicators.isSeedData = true;
    reasons.push('⚠️  No related data (subscriptions, GMP, documents) - likely seed data');
  }

  console.log('🔍 Data Source Indicators:');
  console.log(`   Is Test Data: ${indicators.isTestData ? '✅ YES' : '❌ NO'}`);
  console.log(`   Is Seed Data: ${indicators.isSeedData ? '✅ YES' : '❌ NO'}`);
  console.log(`   Is Scraped Data: ${indicators.isScrapedData ? '✅ YES' : '❌ NO'}`);
  console.log(`   Is Manual Entry: ${indicators.isManualEntry ? '✅ YES' : '❌ NO'}`);

  console.log('\n📋 Reasons:');
  reasons.forEach(reason => {
    console.log(`   ${reason}`);
  });

  console.log('\n');

  // ============================================================
  // 6. Final Verdict
  // ============================================================
  console.log('⚖️  Step 6: Final Verdict');
  console.log('=' .repeat(60));

  let verdict = '';
  let confidence = '';

  if (indicators.isTestData && indicators.isSeedData && !indicators.isScrapedData) {
    verdict = '🎭 TEST/SEED DATA';
    confidence = 'HIGH (95%)';
  } else if (indicators.isSeedData && scraperLogs.length === 0) {
    verdict = '🌱 SEED DATA (Not Scraped)';
    confidence = 'MEDIUM (75%)';
  } else if (indicators.isScrapedData) {
    verdict = '🤖 SCRAPED DATA (But Incomplete)';
    confidence = 'MEDIUM (60%)';
  } else {
    verdict = '❓ UNKNOWN SOURCE';
    confidence = 'LOW (40%)';
  }

  console.log(`📊 Verdict: ${verdict}`);
  console.log(`🎯 Confidence: ${confidence}`);
  console.log('\n');

  console.log('💡 Recommendations:');
  if (indicators.isTestData) {
    console.log('   1. Delete this record (it\'s test data)');
    console.log('   2. Re-scrape from NSE with correct parameters');
    console.log('   3. Fix scraper to correctly identify SME IPOs');
  } else if (indicators.isSeedData) {
    console.log('   1. Update with correct NSE data (use Stories 10.1-10.4)');
    console.log('   2. Run scraper to populate missing fields');
    console.log('   3. Verify all related data is populated');
  } else {
    console.log('   1. Investigate further to determine data source');
    console.log('   2. Check application logs for insertion records');
    console.log('   3. Review git history for when this record was added');
  }

  console.log('\n');
  console.log('✅ Audit Complete!');
  console.log('=' .repeat(60));

  process.exit(0);
}

// Run audit
auditCoolCapsData().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});
