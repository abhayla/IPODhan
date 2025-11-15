#!/usr/bin/env tsx

/**
 * Fix Timeline Dates Script
 *
 * Purpose: Clean up unrealistic test data where timeline dates (basis_of_allotment_date,
 * initiation_of_refunds_date, credit_of_shares_date) are set months/years after the IPO
 * close date. This violates real-world IPO timelines where all milestones complete within
 * 2-3 weeks.
 *
 * Real-World IPO Timeline:
 * - Day 0: IPO Opens
 * - Day 3-10: IPO Closes
 * - Day +2: Basis of Allotment finalized
 * - Day +4: Initiation of Refunds
 * - Day +6: Credit of Shares to Demat
 * - Day +10-14: Listing on exchange
 *
 * This script recalculates timeline dates to be realistic based on close_date.
 *
 * Usage:
 *   npm run fix-timeline-dates
 *
 * Created: 2025-11-15
 * Related: docs/01-planning/Plan-Calendar-Fixes-2025-11-15-v2.md
 */

import { db } from '@/lib/db';
import { ipos, ipoDetails } from '@ipodhan/shared/db/schema';
import { eq, and, isNotNull, sql, gt } from 'drizzle-orm';

interface ProblematicRecord {
  detailsId: string;
  ipoId: string;
  companyName: string;
  closeDate: Date | string | null;
  basisOfAllotmentDate: Date | string | null;
  initiationOfRefundsDate: Date | string | null;
  creditOfSharesDate: Date | string | null;
  daysGap: number;
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1: Date | string | null, date2: Date | string | null): number {
  if (!date1 || !date2) return 0;

  // Convert to Date objects if they're strings
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;

  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Find all IPO detail records with timeline dates > 30 days after close date
 */
async function findProblematicRecords(): Promise<ProblematicRecord[]> {
  console.log('🔍 Searching for problematic timeline dates...\n');

  const allRecords = await db
    .select({
      detailsId: ipoDetails.id,
      ipoId: ipos.id,
      companyName: ipos.companyName,
      closeDate: ipos.closeDate,
      basisOfAllotmentDate: ipoDetails.basisOfAllotmentDate,
      initiationOfRefundsDate: ipoDetails.initiationOfRefundsDate,
      creditOfSharesDate: ipoDetails.creditOfSharesDate,
    })
    .from(ipoDetails)
    .innerJoin(ipos, eq(ipoDetails.ipoId, ipos.id))
    .where(isNotNull(ipos.closeDate));

  const problematic: ProblematicRecord[] = [];

  for (const record of allRecords) {
    if (!record.closeDate) continue;

    const basisGap = daysBetween(record.closeDate, record.basisOfAllotmentDate);
    const refundGap = daysBetween(record.closeDate, record.initiationOfRefundsDate);
    const creditGap = daysBetween(record.closeDate, record.creditOfSharesDate);

    // Check if ANY timeline date is > 30 days after close
    const maxGap = Math.max(basisGap, refundGap, creditGap);

    if (maxGap > 30) {
      problematic.push({
        ...record,
        daysGap: maxGap,
      });
    }
  }

  return problematic;
}

/**
 * Fix a single IPO's timeline dates
 */
async function fixTimelineDates(record: ProblematicRecord): Promise<void> {
  if (!record.closeDate) {
    console.log(`⚠️  Skipping ${record.companyName} - no close date`);
    return;
  }

  // Convert closeDate to Date object if it's a string
  const closeDate = typeof record.closeDate === 'string' ? new Date(record.closeDate) : record.closeDate;

  // Calculate realistic dates based on close_date
  const basisOfAllotment = addDays(closeDate, 2);  // 2 days after close
  const refundDate = addDays(closeDate, 4);         // 4 days after close
  const creditDate = addDays(closeDate, 6);         // 6 days after close

  // Helper to format date (handles both Date and string)
  const formatDate = (date: Date | string | null): string => {
    if (!date) return 'null';
    if (typeof date === 'string') return date.split('T')[0];
    return date.toISOString().split('T')[0];
  };

  console.log(`\n  📝 ${record.companyName}`);
  console.log(`     Close Date: ${formatDate(record.closeDate)}`);

  if (record.basisOfAllotmentDate && daysBetween(record.closeDate, record.basisOfAllotmentDate) > 30) {
    console.log(`     ❌ Old Basis: ${formatDate(record.basisOfAllotmentDate)} (${daysBetween(record.closeDate, record.basisOfAllotmentDate)} days gap)`);
    console.log(`     ✅ New Basis: ${formatDate(basisOfAllotment)} (2 days gap)`);
  }

  if (record.initiationOfRefundsDate && daysBetween(record.closeDate, record.initiationOfRefundsDate) > 30) {
    console.log(`     ❌ Old Refund: ${formatDate(record.initiationOfRefundsDate)} (${daysBetween(record.closeDate, record.initiationOfRefundsDate)} days gap)`);
    console.log(`     ✅ New Refund: ${formatDate(refundDate)} (4 days gap)`);
  }

  if (record.creditOfSharesDate && daysBetween(record.closeDate, record.creditOfSharesDate) > 30) {
    console.log(`     ❌ Old Credit: ${formatDate(record.creditOfSharesDate)} (${daysBetween(record.closeDate, record.creditOfSharesDate)} days gap)`);
    console.log(`     ✅ New Credit: ${formatDate(creditDate)} (6 days gap)`);
  }

  // Update the record (convert Date objects to ISO strings for database)
  await db
    .update(ipoDetails)
    .set({
      basisOfAllotmentDate: basisOfAllotment.toISOString().split('T')[0],
      initiationOfRefundsDate: refundDate.toISOString().split('T')[0],
      creditOfSharesDate: creditDate.toISOString().split('T')[0],
    })
    .where(eq(ipoDetails.id, record.detailsId));
}

/**
 * Main execution
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       Fix Timeline Dates - Database Cleanup Script          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  try {
    // Step 1: Find problematic records
    const problematicRecords = await findProblematicRecords();

    if (problematicRecords.length === 0) {
      console.log('✅ No problematic records found! All timeline dates are within 30 days of close date.\n');
      console.log('📊 Database is clean. No action needed.');
      return;
    }

    console.log(`\n📊 Found ${problematicRecords.length} records with timeline dates > 30 days after close:\n`);

    // Show summary
    const sortedByGap = problematicRecords.sort((a, b) => b.daysGap - a.daysGap);
    console.log('Top 5 worst offenders:');
    sortedByGap.slice(0, 5).forEach((record, index) => {
      console.log(`  ${index + 1}. ${record.companyName.padEnd(40)} - ${record.daysGap} days gap`);
    });

    console.log('\n─────────────────────────────────────────────────────────────\n');
    console.log('🔧 Starting fixes...');

    // Step 2: Fix each record
    let successCount = 0;
    let errorCount = 0;

    for (const record of problematicRecords) {
      try {
        await fixTimelineDates(record);
        successCount++;
      } catch (error) {
        errorCount++;
        console.error(`\n❌ Error fixing ${record.companyName}:`, error);
      }
    }

    // Step 3: Summary
    console.log('\n─────────────────────────────────────────────────────────────\n');
    console.log('📊 CLEANUP SUMMARY:');
    console.log(`   Total problematic records: ${problematicRecords.length}`);
    console.log(`   ✅ Successfully fixed: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   ❌ Errors: ${errorCount}`);
    }

    console.log('\n✅ Timeline date cleanup complete!');
    console.log('\n💡 Next steps:');
    console.log('   1. Clear Redis cache: redis-cli FLUSHDB');
    console.log('   2. Check calendar: http://localhost:3000/mainboard-ipo-calendar');
    console.log('   3. Verify event count dropped from 628 to ~136 events\n');

  } catch (error) {
    console.error('\n❌ Fatal error during cleanup:', error);
    process.exit(1);
  }
}

// Run the script
main()
  .then(() => {
    console.log('🎉 Script completed successfully!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Script failed:', error);
    process.exit(1);
  });
