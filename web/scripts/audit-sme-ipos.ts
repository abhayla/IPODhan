/**
 * SME IPO Data Quality Audit Script
 *
 * Purpose: Check if other SME IPOs have similar data quality issues as Cool Caps
 *
 * Checks:
 * 1. Total SME IPOs in database
 * 2. IPOs with lot_size = 1 (Phase 3 anti-pattern)
 * 3. IPOs with wrong segment (should be SME, not MAINBOARD)
 * 4. IPOs with missing price band
 * 5. IPOs with missing issue size
 * 6. IPOs with no related data (subscriptions, documents, etc.)
 * 7. IPOs created recently (potential test data)
 * 8. Scraper success rate for SME IPOs
 */

import { getDb } from '../lib/db';
import * as schema from '@ipodhan/shared/db/schema';
import { eq, and, or, isNull, sql } from 'drizzle-orm';

async function auditSMEIPOs() {
  console.log('🔍 Starting SME IPO Data Quality Audit...\n');
  console.log('=' .repeat(80));

  const db = await getDb();

  // ============================================================
  // 1. Total SME IPOs Count
  // ============================================================
  console.log('\n📊 Step 1: Total SME IPOs in Database');
  console.log('-'.repeat(80));

  const totalSMECount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.ipos)
    .where(eq(schema.ipos.segment, 'SME'));

  const totalMainboardCount = await db.select({ count: sql<number>`count(*)` })
    .from(schema.ipos)
    .where(eq(schema.ipos.segment, 'MAINBOARD'));

  const totalAllIPOs = await db.select({ count: sql<number>`count(*)` })
    .from(schema.ipos);

  console.log(`✅ Total SME IPOs: ${totalSMECount[0].count}`);
  console.log(`✅ Total MAINBOARD IPOs: ${totalMainboardCount[0].count}`);
  console.log(`✅ Total All IPOs: ${totalAllIPOs[0].count}`);
  console.log(`📊 SME Percentage: ${((totalSMECount[0].count / totalAllIPOs[0].count) * 100).toFixed(1)}%`);

  // ============================================================
  // 2. IPOs with lot_size = 1 (Critical Issue from Phase 3)
  // ============================================================
  console.log('\n🚨 Step 2: IPOs with lot_size = 1 (Phase 3 Anti-Pattern)');
  console.log('-'.repeat(80));

  const lotSizeOneIPOs = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    segment: schema.ipos.segment,
    lotSize: schema.ipos.lotSize,
    createdAt: schema.ipos.createdAt
  })
    .from(schema.ipos)
    .where(eq(schema.ipos.lotSize, 1))
    .orderBy(schema.ipos.createdAt);

  console.log(`❌ Found ${lotSizeOneIPOs.length} IPOs with lot_size = 1`);

  if (lotSizeOneIPOs.length > 0) {
    console.log(`\n📋 List of IPOs with lot_size = 1:`);
    lotSizeOneIPOs.slice(0, 10).forEach((ipo, index) => {
      console.log(`   ${index + 1}. ${ipo.companyName} (${ipo.segment}) - Created: ${ipo.createdAt}`);
    });
    if (lotSizeOneIPOs.length > 10) {
      console.log(`   ... and ${lotSizeOneIPOs.length - 10} more`);
    }
  }

  // ============================================================
  // 3. IPOs with Wrong Segment (Misclassified)
  // ============================================================
  console.log('\n⚠️  Step 3: IPOs with Potential Segment Misclassification');
  console.log('-'.repeat(80));

  // Check IPOs with symbol patterns suggesting SME but marked as MAINBOARD
  const suspectMainboard = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    symbol: schema.ipos.symbol,
    segment: schema.ipos.segment
  })
    .from(schema.ipos)
    .where(
      and(
        eq(schema.ipos.segment, 'MAINBOARD'),
        // SME symbols often end with 'SME' or 'R' suffix
        or(
          sql`${schema.ipos.symbol} LIKE '%SME'`,
          sql`${schema.ipos.symbol} LIKE '%R'`
        )
      )
    );

  console.log(`⚠️  Found ${suspectMainboard.length} MAINBOARD IPOs with SME-like symbols`);

  if (suspectMainboard.length > 0) {
    console.log(`\n📋 Potentially Misclassified IPOs:`);
    suspectMainboard.slice(0, 10).forEach((ipo, index) => {
      console.log(`   ${index + 1}. ${ipo.companyName} - Symbol: ${ipo.symbol} (marked as MAINBOARD)`);
    });
  }

  // ============================================================
  // 4. IPOs with Missing Price Band
  // ============================================================
  console.log('\n💰 Step 4: IPOs with Missing Price Band');
  console.log('-'.repeat(80));

  const missingPriceIPOs = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    segment: schema.ipos.segment,
    minPrice: schema.ipos.minPrice,
    maxPrice: schema.ipos.maxPrice,
    status: schema.ipos.status
  })
    .from(schema.ipos)
    .where(
      and(
        eq(schema.ipos.segment, 'SME'),
        or(
          isNull(schema.ipos.minPrice),
          isNull(schema.ipos.maxPrice)
        )
      )
    );

  console.log(`❌ Found ${missingPriceIPOs.length} SME IPOs with missing price band`);

  if (missingPriceIPOs.length > 0) {
    console.log(`\n📋 Sample IPOs with missing prices:`);
    missingPriceIPOs.slice(0, 10).forEach((ipo, index) => {
      console.log(`   ${index + 1}. ${ipo.companyName} (${ipo.status}) - Min: ${ipo.minPrice}, Max: ${ipo.maxPrice}`);
    });
  }

  // ============================================================
  // 5. IPOs with Missing Issue Size
  // ============================================================
  console.log('\n📦 Step 5: IPOs with Missing Issue Size');
  console.log('-'.repeat(80));

  const missingIssueSizeIPOs = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    segment: schema.ipos.segment,
    issueSizeCrores: schema.ipos.issueSizeCrores,
    status: schema.ipos.status
  })
    .from(schema.ipos)
    .where(
      and(
        eq(schema.ipos.segment, 'SME'),
        or(
          isNull(schema.ipos.issueSizeCrores),
          eq(schema.ipos.issueSizeCrores, 0)
        )
      )
    );

  console.log(`❌ Found ${missingIssueSizeIPOs.length} SME IPOs with missing/zero issue size`);

  // ============================================================
  // 6. IPOs with No Related Data
  // ============================================================
  console.log('\n🔗 Step 6: SME IPOs with No Related Data');
  console.log('-'.repeat(80));

  const smeIPOs = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    status: schema.ipos.status
  })
    .from(schema.ipos)
    .where(eq(schema.ipos.segment, 'SME'));

  let noRelatedDataCount = 0;
  const iposWithNoData: any[] = [];

  for (const ipo of smeIPOs.slice(0, 50)) { // Check first 50 SME IPOs
    const [subscriptions, documents, financials, gmpRecords] = await Promise.all([
      db.select({ count: sql<number>`count(*)` })
        .from(schema.subscriptions)
        .where(eq(schema.subscriptions.ipoId, ipo.id)),
      db.select({ count: sql<number>`count(*)` })
        .from(schema.documents)
        .where(eq(schema.documents.ipoId, ipo.id)),
      db.select({ count: sql<number>`count(*)` })
        .from(schema.financialData)
        .where(eq(schema.financialData.ipoId, ipo.id)),
      db.select({ count: sql<number>`count(*)` })
        .from(schema.gmpRecords)
        .where(eq(schema.gmpRecords.ipoId, ipo.id))
    ]);

    const totalRelated = Number(subscriptions[0].count) +
                         Number(documents[0].count) +
                         Number(financials[0].count) +
                         Number(gmpRecords[0].count);

    if (totalRelated === 0) {
      noRelatedDataCount++;
      iposWithNoData.push(ipo);
    }
  }

  console.log(`⚠️  Found ${noRelatedDataCount}/${Math.min(50, smeIPOs.length)} SME IPOs with NO related data (checked first 50)`);

  if (iposWithNoData.length > 0) {
    console.log(`\n📋 Sample IPOs with no subscriptions/documents/financials/GMP:`);
    iposWithNoData.slice(0, 10).forEach((ipo, index) => {
      console.log(`   ${index + 1}. ${ipo.companyName} (${ipo.status})`);
    });
  }

  // ============================================================
  // 7. Recently Created IPOs (Potential Test Data)
  // ============================================================
  console.log('\n🆕 Step 7: Recently Created SME IPOs (Potential Test Data)');
  console.log('-'.repeat(80));

  const recentIPOs = await db.select({
    id: schema.ipos.id,
    companyName: schema.ipos.companyName,
    segment: schema.ipos.segment,
    openDate: schema.ipos.openDate,
    closeDate: schema.ipos.closeDate,
    createdAt: schema.ipos.createdAt
  })
    .from(schema.ipos)
    .where(
      and(
        eq(schema.ipos.segment, 'SME'),
        sql`${schema.ipos.createdAt} > '2025-10-01'` // Created in last month
      )
    )
    .orderBy(schema.ipos.createdAt);

  console.log(`📅 Found ${recentIPOs.length} SME IPOs created since Oct 1, 2025`);

  if (recentIPOs.length > 0) {
    console.log(`\n📋 Recently created SME IPOs:`);
    recentIPOs.forEach((ipo, index) => {
      const dateMismatch = ipo.openDate && new Date(ipo.openDate) < new Date(ipo.createdAt);
      const flag = dateMismatch ? '⚠️  DATE MISMATCH' : '';
      console.log(`   ${index + 1}. ${ipo.companyName} - Created: ${ipo.createdAt}, Open: ${ipo.openDate} ${flag}`);
    });
  }

  // ============================================================
  // 8. Data Quality Score Card
  // ============================================================
  console.log('\n📊 Step 8: SME IPO Data Quality Score Card');
  console.log('-'.repeat(80));

  const totalSME = Number(totalSMECount[0].count);

  const metrics = {
    total: totalSME,
    lotSizeOne: lotSizeOneIPOs.length,
    missingPrice: missingPriceIPOs.length,
    missingIssueSize: missingIssueSizeIPOs.length,
    noRelatedData: (noRelatedDataCount / Math.min(50, smeIPOs.length)) * totalSME, // Extrapolate
    recentlyCreated: recentIPOs.length
  };

  console.log(`\n✅ Total SME IPOs: ${metrics.total}`);
  console.log(`\n❌ Data Quality Issues:`);
  console.log(`   🔴 Lot Size = 1: ${metrics.lotSizeOne} (${((metrics.lotSizeOne / metrics.total) * 100).toFixed(1)}%)`);
  console.log(`   🔴 Missing Price Band: ${metrics.missingPrice} (${((metrics.missingPrice / metrics.total) * 100).toFixed(1)}%)`);
  console.log(`   🔴 Missing Issue Size: ${metrics.missingIssueSize} (${((metrics.missingIssueSize / metrics.total) * 100).toFixed(1)}%)`);
  console.log(`   🟡 No Related Data: ~${Math.round(metrics.noRelatedData)} (estimated)`);
  console.log(`   🟡 Recently Created: ${metrics.recentlyCreated} (potential test data)`);

  const healthScore = (
    ((totalSME - metrics.lotSizeOne) / totalSME) * 30 + // 30% weight
    ((totalSME - metrics.missingPrice) / totalSME) * 30 + // 30% weight
    ((totalSME - metrics.missingIssueSize) / totalSME) * 40 // 40% weight
  );

  console.log(`\n🎯 Overall Data Quality Score: ${healthScore.toFixed(1)}%`);

  if (healthScore >= 90) {
    console.log('   ✅ EXCELLENT - Data quality is high');
  } else if (healthScore >= 70) {
    console.log('   🟡 GOOD - Some data quality issues present');
  } else if (healthScore >= 50) {
    console.log('   🟠 FAIR - Significant data quality issues');
  } else {
    console.log('   🔴 POOR - Critical data quality issues requiring immediate attention');
  }

  // ============================================================
  // 9. Recommendations
  // ============================================================
  console.log('\n💡 Recommendations');
  console.log('-'.repeat(80));

  console.log('\n🎯 Priority Actions:');

  if (metrics.lotSizeOne > totalSME * 0.1) { // More than 10%
    console.log(`   1. 🔴 CRITICAL: Fix ${metrics.lotSizeOne} IPOs with lot_size = 1`);
    console.log(`      → Implement Story 10.2 (Lot Size Validation)`);
    console.log(`      → Run migration script to fix existing data`);
  }

  if (metrics.missingPrice > totalSME * 0.2) { // More than 20%
    console.log(`   2. 🔴 HIGH: Populate price band for ${metrics.missingPrice} IPOs`);
    console.log(`      → Implement Story 10.4 (Missing Core Details)`);
    console.log(`      → Re-run scraper with fixed validation`);
  }

  if (metrics.missingIssueSize > totalSME * 0.2) {
    console.log(`   3. 🔴 HIGH: Calculate issue size for ${metrics.missingIssueSize} IPOs`);
    console.log(`      → Implement Story 10.4 (Issue Size Calculation)`);
  }

  if (suspectMainboard.length > 0) {
    console.log(`   4. 🟡 MEDIUM: Review ${suspectMainboard.length} potentially misclassified IPOs`);
    console.log(`      → Implement Story 10.1 (Segment Classification)`);
  }

  console.log('\n✅ Audit Complete!');
  console.log('=' .repeat(80));

  process.exit(0);
}

// Run audit
auditSMEIPOs().catch(error => {
  console.error('❌ Audit failed:', error);
  process.exit(1);
});
