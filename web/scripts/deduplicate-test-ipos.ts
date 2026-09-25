/**
 * De-duplicate Test IPOs - Phase 11 Step 3
 *
 * Merges 11 duplicate IPO records down to 5 canonical records
 * for the test IPOs identified in Phase 10 investigation.
 *
 * Usage:
 *   npx tsx scripts/deduplicate-test-ipos.ts --dry-run    # Preview changes
 *   npx tsx scripts/deduplicate-test-ipos.ts --execute    # Apply changes
 *
 * FIXED (issue #447, item 1 slice s2 follow-up): the re-parenting sequence
 * (per-table FK reassignment, then duplicate delete - Steps 3-4) now runs
 * inside one `db.transaction(...)`, per the original DEFERRED note this
 * replaces - a throw at any step rolls back the whole re-parent instead of
 * leaving some tables reassigned and others not, with the duplicate row
 * still present. `peer_companies` carries
 * UNIQUE (ipo_id, normalized_name) (web/drizzle/migrations/_gated/
 * E1_row_key_unique_constraints.sql), so a canonical and duplicate IPO that
 * share a peer company name would violate it on a bare reassignment; the
 * peer-company step now DELETES the duplicate's colliding row first (the
 * canonical IPO already has that peer) and only reassigns the rest.
 * `promoters` and `ipo_intermediaries` get the same unique constraint but
 * this script never re-parents them (it predates those tables' population
 * for these test IPOs), so no equivalent branch is needed for them here.
 */

import { getDb } from '../lib/db/index.js';
import { ipos, subscriptions, gmpRecords, financialData, documents, listingPerformance, peerCompanies } from '../lib/db/index.js';
import { eq, ilike, inArray } from 'drizzle-orm';
import { pathToFileURL } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../../packages/shared/src/db/schema.js';

let db: NodePgDatabase<typeof schema>;

/**
 * Test-only injection point (#447 regression coverage) - lets the unit test
 * drive `deduplicateGroup`'s execute path against a mocked
 * `NodePgDatabase`-shaped object without a real Postgres connection, so the
 * transaction/rollback behaviour is provable without standing up
 * ipodhan_test for what is otherwise a one-off historical script.
 */
export function setDbForTest(mockDb: NodePgDatabase<typeof schema>): void {
  db = mockDb;
}

interface DuplicateGroup {
  companyPattern: string;
  canonicalName: string;
  canonicalSlug: string;
}

const DUPLICATE_GROUPS: DuplicateGroup[] = [
  {
    companyPattern: '%shreeji%global%fmcg%',
    canonicalName: 'Shreeji Global FMCG Limited',
    canonicalSlug: 'shreeji-global-fmcg-ltd',
  },
  {
    companyPattern: '%midwest%',
    canonicalName: 'Midwest Limited',
    canonicalSlug: 'midwest-ltd',
  },
  {
    companyPattern: '%sihora%',
    canonicalName: 'Sihora Industries Limited',
    canonicalSlug: 'sihora-industries-ltd',
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
    score += Math.max(0, 20 - daysSinceCreation);
  }

  return score;
}

/**
 * Merge data from source IPO into target IPO (prefer non-null values)
 */
function mergeIPOData(target: any, source: any): any {
  const merged = { ...target };

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
export async function deduplicateGroup(group: DuplicateGroup, dryRun: boolean = true): Promise<void> {
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

    // Step 1: Clear symbols on duplicate records first (prevents unique constraint violations)
    for (const duplicate of toMerge) {
      if (duplicate.symbol) {
        await db.update(ipos)
          .set({ symbol: null })
          .where(eq(ipos.id, duplicate.id));
      }
    }

    // Step 2: Update canonical record with merged data
    await db.update(ipos)
      .set({
        companyName: group.canonicalName,
        slug: group.canonicalSlug,
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

    // #447: Steps 3-4 (the actual re-parenting: reassigning every child
    // table's ipo_id, then deleting the duplicate ipos row) run in one
    // transaction - a throw partway through (e.g. a peer_companies
    // unique-constraint hit) rolls back the whole re-parent instead of
    // leaving some tables reassigned, others not, and the duplicate row
    // still present.
    await db.transaction(async (tx) => {
      // Step 3: Reassign foreign key references
      for (const duplicate of toMerge) {
        // Reassign subscriptions
        await tx.update(subscriptions)
          .set({ ipoId: canonical.id })
          .where(eq(subscriptions.ipoId, duplicate.id));

        // Reassign GMP records
        await tx.update(gmpRecords)
          .set({ ipoId: canonical.id })
          .where(eq(gmpRecords.ipoId, duplicate.id));

        // Reassign financial data
        await tx.update(financialData)
          .set({ ipoId: canonical.id })
          .where(eq(financialData.ipoId, duplicate.id));

        // Reassign documents
        await tx.update(documents)
          .set({ ipoId: canonical.id })
          .where(eq(documents.ipoId, duplicate.id));

        // Reassign listing performance
        await tx.update(listingPerformance)
          .set({ ipoId: canonical.id })
          .where(eq(listingPerformance.ipoId, duplicate.id));

        // Reassign peer companies (#447): a peer whose normalized_name
        // already exists under the canonical IPO would violate
        // unique_peer_companies_ipo_id_normalized_name on a bare
        // reassignment - the canonical IPO already has that peer, so
        // delete the duplicate's colliding row instead of reassigning it.
        const canonicalPeerNames = new Set(
          (
            await tx
              .select({ normalizedName: peerCompanies.normalizedName })
              .from(peerCompanies)
              .where(eq(peerCompanies.ipoId, canonical.id))
          ).map((r) => r.normalizedName)
        );
        const duplicatePeers = await tx
          .select({ id: peerCompanies.id, normalizedName: peerCompanies.normalizedName })
          .from(peerCompanies)
          .where(eq(peerCompanies.ipoId, duplicate.id));
        const collidingIds = duplicatePeers
          .filter((p) => canonicalPeerNames.has(p.normalizedName))
          .map((p) => p.id);
        if (collidingIds.length > 0) {
          await tx.delete(peerCompanies).where(inArray(peerCompanies.id, collidingIds));
        }
        await tx.update(peerCompanies)
          .set({ ipoId: canonical.id })
          .where(eq(peerCompanies.ipoId, duplicate.id));

        console.log(`     ✅ Reassigned foreign keys from ${duplicate.slug}`);
      }

      // Step 4: Delete duplicate records
      for (const duplicate of toMerge) {
        await tx.delete(ipos).where(eq(ipos.id, duplicate.id));
        console.log(`     ✅ Deleted duplicate: ${duplicate.slug}`);
      }
    });

    console.log(`\n  ✅ De-duplication complete!`);
  }
}

/**
 * Main execution
 */
async function main() {
  // Initialize database connection
  db = await getDb();

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
    console.log(`\nTo execute, run: npx tsx scripts/deduplicate-test-ipos.ts --execute`);
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

// Guarded (#447 test coverage): running `main()` unconditionally on import
// would open a real DB connection and `process.exit(0)` the moment a test
// imports this module for `deduplicateGroup` / `setDbForTest`.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('❌ Error during de-duplication:', error);
    process.exit(1);
  });
}
