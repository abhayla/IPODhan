/**
 * Test Data Cleanup Script
 *
 * Identifies and removes test/seed data from production database.
 * Based on analysis from STALE-DATA-ANALYSIS.md
 *
 * Patterns detected:
 * 1. Explicit "Test" in company name
 * 2. Fictional companies with real stock symbols
 * 3. Admin-created entries with "(Admin Edited)" suffix
 * 4. IPOs with status OPEN but close date > 30 days ago
 *
 * Usage:
 *   npm run cleanup-test-data              # Dry-run (preview only)
 *   npm run cleanup-test-data -- --execute # Execute deletions
 */

import { db } from '../lib/db/index.js';
import { ipos } from '@ipodhan/shared/db/schema';
import { or, and, like, sql, lte, eq } from 'drizzle-orm';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

interface CleanupCandidate {
  id: string;
  companyName: string;
  slug: string;
  symbol: string | null;
  segment: string | null;
  status: string;
  openDate: string | null;
  closeDate: string | null;
  updatedAt: Date;
  reason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

const KNOWN_TEST_PATTERNS = {
  // Fictional companies with real stock symbols (from stale data analysis)
  fictionalCompanies: [
    { name: 'Royal Technology Enterprises', symbol: 'PAYTM' },
    { name: 'Tech Group', symbol: 'EICHERMOT' },
    { name: 'New Infrastructure Corporation', symbol: 'GRASIM' },
    { name: 'Urban Solutions', symbol: 'IOC' },
    { name: 'Green Holdings', symbol: 'VEDL' },
    { name: 'Advanced Technologies', symbol: 'WIPRO' },
    { name: 'Apex Automobile Systems', symbol: 'AXISBANK' },
    { name: 'Innovative Solutions', symbol: 'BAJAJFINSV' },
    { name: 'Green Technologies', symbol: 'APOLLOHOSP' },
    { name: 'Supreme Manufacturing', symbol: 'ULTRACEMCO' },
    { name: 'Packaging Corporation', symbol: 'INFY' },
    { name: 'Pharmaceuticals Systems', symbol: 'VEDL5' },
    { name: 'Eco Systems', symbol: 'ICICIBANK' },
    { name: 'Advanced Automobile Associates', symbol: 'IOC4' },
    { name: 'Eco Renewable Energy', symbol: 'TECHM' },
    { name: 'Green Automobile Services', symbol: 'GAIL' },
    { name: 'New Herbal Products Industries', symbol: 'DIVISLAB' },
    { name: 'Integrated Food Processing Holdings', symbol: 'NTPC' },
    { name: 'Progressive Systems', symbol: 'DIVISLAB4' },
  ],
};

async function identifyTestData(): Promise<CleanupCandidate[]> {
  console.log('\n🔍 Identifying Test Data...\n');
  console.log('='.repeat(80));

  const candidates: CleanupCandidate[] = [];

  // Pattern 1: Explicit "Test" in company name
  console.log('\n1. Finding explicit test entries...');
  const explicitTests = await db
    .select()
    .from(ipos)
    .where(
      or(
        like(ipos.companyName, '%Test%'),
        like(ipos.companyName, '%test%'),
        like(ipos.companyName, '%TEST%')
      )
    );

  explicitTests.forEach(ipo => {
    candidates.push({
      id: ipo.id,
      companyName: ipo.companyName,
      slug: ipo.slug,
      symbol: ipo.symbol,
      segment: ipo.segment,
      status: ipo.status,
      openDate: ipo.openDate,
      closeDate: ipo.closeDate,
      updatedAt: ipo.updatedAt,
      reason: 'Explicit "Test" in company name',
      confidence: 'HIGH',
    });
  });
  console.log(`   Found ${explicitTests.length} entries`);

  // Pattern 2: Fictional companies with known mismatched symbols
  console.log('\n2. Finding fictional companies with real stock symbols...');
  for (const pattern of KNOWN_TEST_PATTERNS.fictionalCompanies) {
    const matches = await db
      .select()
      .from(ipos)
      .where(
        and(
          like(ipos.companyName, `%${pattern.name}%`),
          eq(ipos.symbol, pattern.symbol)
        )
      );

    matches.forEach(ipo => {
      // Avoid duplicates
      if (!candidates.find(c => c.id === ipo.id)) {
        candidates.push({
          id: ipo.id,
          companyName: ipo.companyName,
          slug: ipo.slug,
          symbol: ipo.symbol,
          segment: ipo.segment,
          status: ipo.status,
          openDate: ipo.openDate,
          closeDate: ipo.closeDate,
          updatedAt: ipo.updatedAt,
          reason: `Fictional company with mismatched symbol (${pattern.symbol})`,
          confidence: 'HIGH',
        });
      }
    });
  }
  console.log(`   Found ${candidates.filter(c => c.reason.includes('Fictional')).length} entries`);

  // Pattern 3: Admin-edited markers
  console.log('\n3. Finding admin-created test entries...');
  const adminTests = await db
    .select()
    .from(ipos)
    .where(like(ipos.companyName, '%(Admin Edited)%'));

  adminTests.forEach(ipo => {
    if (!candidates.find(c => c.id === ipo.id)) {
      candidates.push({
        id: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        symbol: ipo.symbol,
        segment: ipo.segment,
        status: ipo.status,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
        updatedAt: ipo.updatedAt,
        reason: 'Contains "(Admin Edited)" marker - likely test entry',
        confidence: 'MEDIUM',
      });
    }
  });
  console.log(`   Found ${adminTests.length} entries`);

  // Pattern 4: Very old OPEN IPOs (close date > 30 days ago, still marked OPEN)
  console.log('\n4. Finding stale OPEN IPOs (close date > 30 days ago)...');
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const staleOpen = await db
    .select()
    .from(ipos)
    .where(
      and(
        eq(ipos.status, 'OPEN'),
        lte(sql`${ipos.closeDate}::date`, thirtyDaysAgo.toISOString().split('T')[0])
      )
    );

  staleOpen.forEach(ipo => {
    if (!candidates.find(c => c.id === ipo.id)) {
      const daysSinceClose = Math.floor(
        (Date.now() - new Date(ipo.closeDate!).getTime()) / (1000 * 60 * 60 * 24)
      );
      candidates.push({
        id: ipo.id,
        companyName: ipo.companyName,
        slug: ipo.slug,
        symbol: ipo.symbol,
        segment: ipo.segment,
        status: ipo.status,
        openDate: ipo.openDate,
        closeDate: ipo.closeDate,
        updatedAt: ipo.updatedAt,
        reason: `Status still OPEN but close date was ${daysSinceClose} days ago`,
        confidence: 'LOW',
      });
    }
  });
  console.log(`   Found ${staleOpen.length} entries`);

  return candidates;
}

async function cleanupTestData(dryRun: boolean = true) {
  console.log('\n' + '='.repeat(80));
  console.log('TEST DATA CLEANUP SCRIPT');
  console.log('='.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY-RUN (Preview Only)' : 'EXECUTE (Will Delete)'}`);
  console.log('='.repeat(80));

  const candidates = await identifyTestData();

  if (candidates.length === 0) {
    console.log('\n✅ No test data found! Database is clean.\n');
    return;
  }

  // Group by confidence
  const highConfidence = candidates.filter(c => c.confidence === 'HIGH');
  const mediumConfidence = candidates.filter(c => c.confidence === 'MEDIUM');
  const lowConfidence = candidates.filter(c => c.confidence === 'LOW');

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal candidates for deletion: ${candidates.length}`);
  console.log(`  HIGH confidence:   ${highConfidence.length} (recommended for deletion)`);
  console.log(`  MEDIUM confidence: ${mediumConfidence.length} (review recommended)`);
  console.log(`  LOW confidence:    ${lowConfidence.length} (manual review required)`);
  console.log('');

  // Display details
  console.log('='.repeat(80));
  console.log('DETAILED LIST');
  console.log('='.repeat(80));
  console.log('');

  candidates.forEach((candidate, index) => {
    console.log(`${index + 1}. [${candidate.confidence}] ${candidate.companyName}`);
    console.log(`   ID: ${candidate.id}`);
    console.log(`   Slug: ${candidate.slug}`);
    console.log(`   Symbol: ${candidate.symbol || 'NULL'}`);
    console.log(`   Segment: ${candidate.segment || 'NULL'}`);
    console.log(`   Status: ${candidate.status}`);
    console.log(`   Close Date: ${candidate.closeDate || 'NULL'}`);
    console.log(`   Reason: ${candidate.reason}`);
    console.log('');
  });

  // Execute deletions (only HIGH confidence in auto mode)
  if (!dryRun) {
    console.log('='.repeat(80));
    console.log('EXECUTING DELETIONS');
    console.log('='.repeat(80));
    console.log('');
    console.log('⚠️  WARNING: Deleting HIGH confidence entries only');
    console.log('   MEDIUM and LOW confidence entries require manual review');
    console.log('');

    let deleted = 0;
    const deletionLog: any[] = [];

    for (const candidate of highConfidence) {
      try {
        await db.delete(ipos).where(eq(ipos.id, candidate.id));
        console.log(`✅ Deleted: ${candidate.companyName} (${candidate.id})`);
        deleted++;
        deletionLog.push({
          id: candidate.id,
          companyName: candidate.companyName,
          slug: candidate.slug,
          symbol: candidate.symbol,
          reason: candidate.reason,
          deletedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`❌ Failed to delete ${candidate.companyName}: ${error}`);
      }
    }

    // Save deletion log
    const logPath = join(process.cwd(), 'logs', 'test-data-cleanup.json');
    writeFileSync(logPath, JSON.stringify(deletionLog, null, 2));

    console.log('');
    console.log('='.repeat(80));
    console.log('CLEANUP COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n✅ Deleted ${deleted} HIGH confidence test entries`);
    console.log(`⚠️  ${mediumConfidence.length + lowConfidence.length} entries require manual review`);
    console.log(`📋 Deletion log saved: ${logPath}`);
    console.log('');
  } else {
    console.log('='.repeat(80));
    console.log('DRY-RUN COMPLETE');
    console.log('='.repeat(80));
    console.log('');
    console.log('No changes made to database (dry-run mode).');
    console.log('');
    console.log('To execute deletions:');
    console.log('  cd web && npx tsx scripts/cleanup-test-data.ts --execute');
    console.log('');
    console.log('⚠️  Note: Only HIGH confidence entries will be auto-deleted.');
    console.log('   MEDIUM and LOW entries require manual review via admin interface.');
    console.log('');
  }

  // Export IDs for manual review
  const manualReviewIds = [...mediumConfidence, ...lowConfidence].map(c => c.id);
  if (manualReviewIds.length > 0) {
    console.log('='.repeat(80));
    console.log('MANUAL REVIEW REQUIRED');
    console.log('='.repeat(80));
    console.log('');
    console.log('IDs requiring manual review:');
    console.log(manualReviewIds.join(','));
    console.log('');
    console.log('Review these entries via admin interface before deletion:');
    console.log(`  ${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/admin/dynamic`);
    console.log('');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const executeMode = args.includes('--execute');

cleanupTestData(!executeMode)
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
