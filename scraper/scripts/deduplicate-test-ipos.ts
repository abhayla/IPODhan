/**
 * De-duplicate Test IPOs - Phase 11 Step 3
 *
 * Merges 11 duplicate IPO records down to 5 canonical records
 * for the test IPOs identified in Phase 10 investigation.
 *
 * Companies to de-duplicate:
 * - Hypersoft: 1 record (no action needed)
 * - Shreeji: 2 duplicates → 1 canonical
 * - Midwest: 4 duplicates → 1 canonical
 * - Jinkushal: 1 record (no action needed)
 * - Sihora: 3 duplicates → 1 canonical
 *
 * Merge strategy:
 * 1. Identify all duplicates for each company
 * 2. Select canonical record (most complete data)
 * 3. Merge non-null values from duplicates
 * 4. Reassign foreign key references (subscriptions, GMP, etc.)
 * 5. Update slug to canonical form
 * 6. Delete duplicate records
 */

import { getDb } from '../../web/lib/db/index.js';
import { ipos, subscriptions, gmpRecords, financialData, documents, listingPerformance, peerCompanies } from '../../web/lib/db/index.js';
import { eq, ilike, sql } from 'drizzle-orm';
import { generateIPOSlug } from '../../packages/shared/src/utils/slug.js';

// Get database instance
const db = await getDb();

interface DuplicateGroup {
  companyPattern: string;
  canonicalName: string;
  canonicalSlug: string;
  keepStrategy: 'most_complete' | 'specific_id';
  keepId?: string;
}

const DUPLICATE_GROUPS: DuplicateGroup[] = [
  {
    companyPattern: '%shreeji%global%fmcg%',
    canonicalName: 'Shreeji Global FMCG Limited',
    canonicalSlug: 'shreeji-global-fmcg-ltd',
    keepStrategy: 'most_complete', // Keep the one with lot_size data
  },
  {
    companyPattern: '%midwest%',
    canonicalName: 'Midwest Limited',
    canonicalSlug: 'midwest-ltd',
    keepStrategy: 'most_complete',
  },
  {
    companyPattern: '%sihora%',
    canonicalName: 'Sihora Industries Limited',
    canonicalSlug: 'sihora-industries-ltd',
    keepStrategy: 'most_complete',
  },
];

/**
 * Score IPO record completeness (higher = more complete)
 */
function scoreCompleteness(ipo: any): number {
  let score = 0;

  // Core fields (10 points each)
  if (ipo.lotSize) score += 10;
  if (ipo.priceRangeMin) score += 10;
  if (ipo.priceRangeMax) score += 10;
  if (ipo.issueSize) score += 10;
  if (ipo.faceValue) score += 10;

  // Dates (5 points each)
  if (ipo.openDate) score += 5;
  if (ipo.closeDate) score += 5;
  if (ipo.listingDate) score += 5;
  if (ipo.allotmentDate) score += 5;

  // Additional fields (2 points each)
  if (ipo.sector) score += 2;
  if (ipo.companyDescription) score += 2;
  if (ipo.registrar) score += 2;
  if (ipo.symbol) score += 2;
  if (ipo.isin) score += 2;

  // Historical data (3 points each)
  if (ipo.subscriptionTotal) score += 3;
  if (ipo.gmpPrice) score += 3;
  if (ipo.listingPriceHistorical) score += 3;

  // Recency bonus (prefer newer records)
  if (ipo.createdAt) {
    const daysSinceCreation = Math.floor(
      (Date.now() - new Date(ipo.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );
    score += Math.max(0, 20 - daysSinceCreation); // Up to 20 bonus points for recent
  }

  return score;
}

/**
 * Merge data from source IPO into target IPO (prefer non-null values)
 */
function mergeIPOData(target: any, source: any): any {
  const merged = { ...target };

  // Merge non-null values from source
  for (const [key, value] of Object.entries(source)) {
    // Skip metadata fields
    if (['id', 'slug', 'createdAt', 'updatedAt'].includes(key)) {
      continue;
    }

    // Use source value if target is null/undefined
    if (value !== null && value !== undefined && (merged[key] === null || merged[key] === undefined)) {
      merged[key] = value;
    }
  }

  return merged;
}

/**
 * De-duplicate a group of IPOs
 */
async function deduplicateGroup(group: DuplicateGroup, dryRun: boolean = true): Promise<void> {
  console.log(`\n=== Processing: ${group.canonicalName} ===`);

  // Find all duplicates
  const duplicates = await db.select().from(ipos).where(ilike(ipos.companyName, group.companyPattern));

  if (duplicates.length === 0) {
    console.log('  ⚠️  No records found');
    return;
  }

  if (duplicates.length === 1) {
    console.log(`  ✅ Only 1 record found (no duplicates)`);
    console.log(`     ${duplicates[0].companyName} (${duplicates[0].slug})`);
    return;
  }

  console.log(`  Found ${duplicates.length} duplicates:`);
  duplicates.forEach((ipo, idx) => {
    const score = scoreCompleteness(ipo);
    console.log(`    ${idx + 1}. ${ipo.companyName} (${ipo.slug})`);
    console.log(`       Score: ${score}, lot_size: ${ipo.lotSize || 'NULL'}, ID: ${ipo.id.substring(0, 8)}...`);
  });

  // Select canonical record (highest completeness score)
  const sorted = [...duplicates].sort((a, b) => scoreCompleteness(b) - scoreCompleteness(a));
  const canonical = sorted[0];
  const toMerge = sorted.slice(1);

  console.log(`\n  ✅ Canonical record selected: ${canonical.companyName}`);
  console.log(`     Slug: ${canonical.slug}, Score: ${scoreCompleteness(canonical)}`);
  console.log(`     ID: ${canonical.id}`);

  // Merge data from duplicates
  let mergedData = { ...canonical };
  for (const duplicate of toMerge) {
    mergedData = mergeIPOData(mergedData, duplicate);
  }

  // Update slug to canonical form
  mergedData.slug = group.canonicalSlug;
  mergedData.companyName = group.canonicalName;

  if (dryRun) {
    console.log(`\n  🔵 DRY RUN - Would perform these actions:`);
    console.log(`     1. Update canonical record (${canonical.id.substring(0, 8)}...) with merged data`);
    console.log(`     2. Update slug to: ${group.canonicalSlug}`);
    console.log(`     3. Reassign foreign keys from ${toMerge.length} duplicate(s)`);
    console.log(`     4. Delete ${toMerge.length} duplicate record(s):`);
    toMerge.forEach((dup) => {
      console.log(`        - ${dup.companyName} (${dup.slug}) [ID: ${dup.id.substring(0, 8)}...]`);
    });
  } else {
    console.log(`\n  🚀 Executing de-duplication...`);

    // Step 1: Update canonical record with merged data
    await db.update(ipos)
      .set({
        companyName: mergedData.companyName,
        slug: mergedData.slug,
        lotSize: mergedData.lotSize,
        priceRangeMin: mergedData.priceRangeMin,
        priceRangeMax: mergedData.priceRangeMax,
        issueSize: mergedData.issueSize,
        faceValue: mergedData.faceValue,
        sector: mergedData.sector,
        companyDescription: mergedData.companyDescription,
        registrar: mergedData.registrar,
        symbol: mergedData.symbol,
        isin: mergedData.isin,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, canonical.id));

    console.log(`     ✅ Updated canonical record`);

    // Step 2: Reassign foreign key references
    for (const duplicate of toMerge) {
      // Reassign subscriptions
      const subCount = await db.update(subscriptions)
        .set({ ipoId: canonical.id })
        .where(eq(subscriptions.ipoId, duplicate.id))
        .then(() => db.select({ count: sql`COUNT(*)` }).from(subscriptions).where(eq(subscriptions.ipoId, canonical.id)));

      // Reassign GMP records
      const gmpCount = await db.update(gmpRecords)
        .set({ ipoId: canonical.id })
        .where(eq(gmpRecords.ipoId, duplicate.id))
        .then(() => db.select({ count: sql`COUNT(*)` }).from(gmpRecords).where(eq(gmpRecords.ipoId, canonical.id)));

      // Reassign financial data
      await db.update(financialData)
        .set({ ipoId: canonical.id })
        .where(eq(financialData.ipoId, duplicate.id));

      // Reassign documents
      await db.update(documents)
        .set({ ipoId: canonical.id })
        .where(eq(documents.ipoId, duplicate.id));

      // Reassign listing performance
      await db.update(listingPerformance)
        .set({ ipoId: canonical.id })
        .where(eq(listingPerformance.ipoId, duplicate.id));

      // Reassign peer companies
      await db.update(peerCompanies)
        .set({ ipoId: canonical.id })
        .where(eq(peerCompanies.ipoId, duplicate.id));

      console.log(`     ✅ Reassigned foreign keys from ${duplicate.slug}`);
    }

    // Step 3: Delete duplicate records
    for (const duplicate of toMerge) {
      await db.delete(ipos).where(eq(ipos.id, duplicate.id));
      console.log(`     ✅ Deleted duplicate: ${duplicate.slug}`);
    }

    console.log(`\n  ✅ De-duplication complete!`);
  }
}

/**
 * Main execution
 */
async function main() {
  const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--execute');

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Phase 11 Step 3: De-duplicate Test IPOs                      ║');
  console.log('║  Target: Merge 11 records → 5 canonical records               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('');

  if (dryRun) {
    console.log('🔵 DRY RUN MODE - No changes will be made');
    console.log('   Run with --execute to apply changes\n');
  } else {
    console.log('🚀 EXECUTE MODE - Changes will be applied to database\n');
  }

  // Process each duplicate group
  for (const group of DUPLICATE_GROUPS) {
    await deduplicateGroup(group, dryRun);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  Summary                                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  // Count total test IPOs
  const totalHypersoft = await db.select().from(ipos).where(ilike(ipos.companyName, '%hypersoft%'));
  const totalShreeji = await db.select().from(ipos).where(ilike(ipos.companyName, '%shreeji%global%fmcg%'));
  const totalMidwest = await db.select().from(ipos).where(ilike(ipos.companyName, '%midwest%'));
  const totalJinkushal = await db.select().from(ipos).where(ilike(ipos.companyName, '%jinkushal%'));
  const totalSihora = await db.select().from(ipos).where(ilike(ipos.companyName, '%sihora%'));

  const totalRecords = totalHypersoft.length + totalShreeji.length + totalMidwest.length + totalJinkushal.length + totalSihora.length;

  console.log(`\nTotal test IPO records: ${totalRecords}`);
  console.log(`  - Hypersoft: ${totalHypersoft.length} record(s)`);
  console.log(`  - Shreeji: ${totalShreeji.length} record(s)`);
  console.log(`  - Midwest: ${totalMidwest.length} record(s)`);
  console.log(`  - Jinkushal: ${totalJinkushal.length} record(s)`);
  console.log(`  - Sihora: ${totalSihora.length} record(s)`);

  if (dryRun) {
    console.log(`\n✅ Expected after de-duplication: 5 records (1 per company)`);
    console.log(`\nTo execute, run: npx tsx scraper/scripts/deduplicate-test-ipos.ts --execute`);
  } else {
    console.log(`\n✅ De-duplication complete!`);
    if (totalRecords === 5) {
      console.log('   ✅ Target achieved: 5 canonical records');
    } else {
      console.log(`   ⚠️  Expected 5, got ${totalRecords} - please verify`);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('❌ Error during de-duplication:', error);
  process.exit(1);
});
