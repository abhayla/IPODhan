/**
 * Data Migration Script: financial_data → ipo_financials
 *
 * Migrates existing financial data from the old financial_data table
 * to the new ipo_financials table with enhanced metrics.
 *
 * Story 4.10: Enhanced Financial Metrics
 *
 * Usage:
 *   npm run ts-node web/scripts/migrate-financial-data-to-ipo-financials.ts
 *
 * Options:
 *   --dry-run: Preview migration without committing changes
 *   --force: Skip confirmation prompt
 */

import { eq, sql } from 'drizzle-orm';
import { db, closePool, financialData, ipoFinancials } from '../lib/db';
import type { FinancialData, IpoFinancialsInsert } from '../lib/repositories/types';

interface MigrationStats {
  totalRecords: number;
  migrated: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ ipoId: string; error: string }>;
}

async function confirmMigration(): Promise<boolean> {
  if (process.argv.includes('--force')) {
    return true;
  }

  console.log('\n⚠️  MIGRATION WARNING ⚠️');
  console.log('This will copy all data from financial_data to ipo_financials table.');
  console.log('New fields (pbRatio, rocePercentage, industryPe, peerCompanies) will be NULL.');
  console.log('');
  console.log('Type "MIGRATE" to confirm, or anything else to cancel:');

  return new Promise((resolve) => {
    process.stdin.once('data', (data) => {
      const input = data.toString().trim();
      resolve(input === 'MIGRATE');
    });
  });
}

/**
 * Map financial_data fields to ipo_financials structure
 */
function mapToIpoFinancials(data: FinancialData): IpoFinancialsInsert {
  return {
    ipoId: data.ipoId,
    // Map FY2024 → FY1 (most recent)
    revenueFy1: data.revenueFy2024,
    revenueFy2: data.revenueFy2023,
    revenueFy3: data.revenueFy2022,
    profitFy1: data.profitFy2024,
    profitFy2: data.profitFy2023,
    profitFy3: data.profitFy2022,
    // Existing metrics
    peRatio: data.peRatio,
    roePercentage: data.roe,
    debtToEquity: data.debtToEquity,
    // New metrics - set to NULL initially
    pbRatio: null,
    rocePercentage: null,
    industryPe: null,
    peerCompanies: null,
    financialYearEnd: null,
  };
}

/**
 * Check if record already exists in ipo_financials
 */
async function recordExists(db: any, ipoId: string): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(ipoFinancials)
    .where(eq(ipoFinancials.ipoId, ipoId))
    .limit(1);

  return !!existing;
}

/**
 * Main migration function
 */
async function migrateData(dryRun: boolean = false): Promise<MigrationStats> {
  const stats: MigrationStats = {
    totalRecords: 0,
    migrated: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    console.log('\n📊 Fetching data from financial_data table...');
    const allFinancialData = await db.select().from(financialData);
    stats.totalRecords = allFinancialData.length;

    console.log(`Found ${stats.totalRecords} records to migrate.\n`);

    if (stats.totalRecords === 0) {
      console.log('✅ No records to migrate. Exiting.');
      return stats;
    }

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be committed\n');
    }

    // Process each record
    for (const data of allFinancialData) {
      try {
        // Check if already exists
        const exists = await recordExists(db, data.ipoId);
        if (exists) {
          console.log(`⏭️  Skipping IPO ${data.ipoId} (already exists in ipo_financials)`);
          stats.skipped++;
          continue;
        }

        // Map to new structure
        const mappedData = mapToIpoFinancials(data as FinancialData);

        if (!dryRun) {
          // Insert into ipo_financials
          await db.insert(ipoFinancials).values(mappedData);
          console.log(`✅ Migrated IPO ${data.ipoId}`);
        } else {
          console.log(`[DRY RUN] Would migrate IPO ${data.ipoId}`);
        }

        stats.migrated++;
      } catch (error) {
        stats.errors++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        stats.errorDetails.push({
          ipoId: data.ipoId,
          error: errorMessage,
        });
        console.error(`❌ Error migrating IPO ${data.ipoId}:`, errorMessage);
      }
    }

    return stats;
  } catch (error) {
    console.error('❌ Fatal migration error:', error);
    throw error;
  }
}

/**
 * Verify migration integrity
 */
async function verifyMigration(): Promise<void> {

  console.log('\n🔍 Verifying migration...');

  // Count records in both tables
  const [{ count: oldCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(financialData);

  const [{ count: newCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ipoFinancials);

  console.log(`\nRecord counts:`);
  console.log(`  financial_data: ${oldCount}`);
  console.log(`  ipo_financials: ${newCount}`);

  if (oldCount === newCount) {
    console.log('\n✅ Migration verified successfully - counts match!');
  } else {
    console.log('\n⚠️  Warning: Record counts do not match. Review error details.');
  }
}

/**
 * Rollback migration (delete all records from ipo_financials)
 */
async function rollbackMigration(): Promise<void> {

  console.log('\n⚠️  Rolling back migration...');
  const result = await db.delete(ipoFinancials);
  console.log(`✅ Deleted all records from ipo_financials`);
}

/**
 * Main execution
 */
async function main() {
  const isDryRun = process.argv.includes('--dry-run');
  const isRollback = process.argv.includes('--rollback');

  console.log('🚀 Financial Data Migration Script');
  console.log('===================================\n');

  if (isRollback) {
    console.log('⚠️  ROLLBACK MODE');
    const confirmed = await confirmMigration();
    if (!confirmed) {
      console.log('\n❌ Rollback cancelled.');
      process.exit(0);
    }
    await rollbackMigration();
    process.exit(0);
  }

  if (!isDryRun) {
    const confirmed = await confirmMigration();
    if (!confirmed) {
      console.log('\n❌ Migration cancelled.');
      process.exit(0);
    }
  }

  const startTime = Date.now();
  const stats = await migrateData(isDryRun);
  const duration = Date.now() - startTime;

  // Print summary
  console.log('\n\n📈 MIGRATION SUMMARY');
  console.log('====================');
  console.log(`Total records:    ${stats.totalRecords}`);
  console.log(`Migrated:         ${stats.migrated} ✅`);
  console.log(`Skipped:          ${stats.skipped} ⏭️`);
  console.log(`Errors:           ${stats.errors} ❌`);
  console.log(`Duration:         ${duration}ms`);

  if (stats.errorDetails.length > 0) {
    console.log('\n❌ Error Details:');
    stats.errorDetails.forEach(({ ipoId, error }) => {
      console.log(`  - IPO ${ipoId}: ${error}`);
    });
  }

  if (!isDryRun && stats.errors === 0 && stats.migrated > 0) {
    await verifyMigration();
  }

  console.log('\n✨ Migration complete!\n');
  process.exit(0);
}

// Execute
main().catch((error) => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});
