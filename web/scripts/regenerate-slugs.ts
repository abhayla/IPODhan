/**
 * Regenerate IPO Slugs Using Canonical Slug Generation
 *
 * This script regenerates all IPO slugs using the canonical slug generation
 * utility to ensure consistency across the system.
 *
 * Usage:
 *   npm run tsx scripts/regenerate-slugs.ts [--dry-run] [--verbose]
 *
 * Options:
 *   --dry-run    Preview changes without applying them
 *   --verbose    Show detailed output for all IPOs
 *
 * Safety Features:
 * - Dry-run mode by default (must explicitly confirm to apply)
 * - Preserves slug uniqueness by appending counters
 * - Shows preview of all changes before applying
 * - Tracks and reports all changes made
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import { ipos } from '../lib/db';
import { generateIPOSlug, generateUniqueSlug } from '@ipodhan/shared/utils/slug';
import { eq } from 'drizzle-orm';
import readline from 'readline';

interface SlugUpdate {
  id: string;
  companyName: string;
  oldSlug: string;
  newSlug: string;
}

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isVerbose = args.includes('--verbose');

/**
 * Prompt user for confirmation
 */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

/**
 * Main regeneration logic
 */
async function regenerateSlugs() {
  console.log('\n📋 IPO Slug Regeneration Tool\n');
  console.log('━'.repeat(60));

  if (isDryRun) {
    console.log('🔍 Running in DRY-RUN mode (no changes will be applied)\n');
  } else {
    console.log('⚠️  WARNING: This will modify IPO slugs in the database!\n');
  }

  try {
    // Step 1: Fetch all IPOs
    console.log('Step 1: Fetching all IPOs from database...');
    const allIPOs = await db.select().from(ipos).orderBy(ipos.companyName);
    console.log(`✓ Found ${allIPOs.length} IPOs\n`);

    // Step 2: Generate new slugs
    console.log('Step 2: Generating new slugs using canonical function...');

    const updates: SlugUpdate[] = [];
    const existingSlugs: string[] = [];
    let unchangedCount = 0;

    for (const ipo of allIPOs) {
      // Generate new slug with uniqueness check
      const newSlug = generateUniqueSlug(ipo.companyName, existingSlugs);

      if (newSlug !== ipo.slug) {
        updates.push({
          id: ipo.id,
          companyName: ipo.companyName,
          oldSlug: ipo.slug,
          newSlug,
        });

        if (isVerbose) {
          console.log(`  • ${ipo.companyName}`);
          console.log(`    ${ipo.slug} → ${newSlug}`);
        }
      } else {
        unchangedCount++;
      }

      // Track all slugs (old and new) to prevent conflicts
      existingSlugs.push(newSlug);
    }

    console.log(`✓ Found ${updates.length} slugs to update`);
    console.log(`✓ ${unchangedCount} slugs are already correct\n`);

    // Step 3: Show preview
    if (updates.length === 0) {
      console.log('✅ No slug updates needed! All slugs are already correct.\n');
      return;
    }

    console.log('━'.repeat(60));
    console.log('Preview of Changes:');
    console.log('━'.repeat(60));

    const previewLimit = 20;
    updates.slice(0, previewLimit).forEach((update, index) => {
      console.log(`\n${index + 1}. ${update.companyName}`);
      console.log(`   OLD: ${update.oldSlug}`);
      console.log(`   NEW: ${update.newSlug}`);
    });

    if (updates.length > previewLimit) {
      console.log(`\n... and ${updates.length - previewLimit} more changes`);
    }

    console.log('\n' + '━'.repeat(60));

    // Step 4: Apply updates or exit if dry-run
    if (isDryRun) {
      console.log('\n🔍 Dry-run complete. No changes were applied.');
      console.log('   To apply changes, run without --dry-run flag:\n');
      console.log('   npm run tsx scripts/regenerate-slugs.ts\n');
      return;
    }

    // Confirmation prompt
    console.log('\n⚠️  This will update ' + updates.length + ' IPO slugs in the database.');
    const answer = await askQuestion('\n❓ Do you want to proceed? (yes/no): ');

    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ Operation cancelled by user.\n');
      return;
    }

    console.log('\nStep 3: Applying updates...');

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ companyName: string; error: string }> = [];

    for (const update of updates) {
      try {
        await db
          .update(ipos)
          .set({ slug: update.newSlug })
          .where(eq(ipos.id, update.id));

        successCount++;

        if (isVerbose) {
          console.log(`  ✓ Updated: ${update.companyName}`);
        } else if (successCount % 10 === 0) {
          console.log(`  Progress: ${successCount}/${updates.length}`);
        }
      } catch (error) {
        errorCount++;
        const errorMessage = error instanceof Error ? error.message : String(error);
        errors.push({
          companyName: update.companyName,
          error: errorMessage,
        });

        console.error(`  ✗ Failed: ${update.companyName} - ${errorMessage}`);
      }
    }

    // Step 5: Report results
    console.log('\n' + '━'.repeat(60));
    console.log('Results:');
    console.log('━'.repeat(60));
    console.log(`✓ Successfully updated: ${successCount}`);
    console.log(`✗ Failed: ${errorCount}`);
    console.log(`• Total IPOs: ${allIPOs.length}`);
    console.log(`• Unchanged: ${unchangedCount}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.forEach((err) => {
        console.log(`  • ${err.companyName}: ${err.error}`);
      });
    }

    if (errorCount === 0) {
      console.log('\n✅ Slug regeneration completed successfully!\n');
    } else {
      console.log('\n⚠️  Slug regeneration completed with errors.\n');
    }

    // Step 6: Verify uniqueness
    console.log('Step 4: Verifying slug uniqueness...');
    const allSlugs = await db.select({ slug: ipos.slug }).from(ipos);
    const slugSet = new Set(allSlugs.map((row) => row.slug));

    if (slugSet.size !== allSlugs.length) {
      console.error('❌ WARNING: Duplicate slugs detected!');
      console.error(`   Unique slugs: ${slugSet.size}`);
      console.error(`   Total slugs: ${allSlugs.length}`);
      console.error(`   Duplicates: ${allSlugs.length - slugSet.size}`);
    } else {
      console.log(`✓ All ${slugSet.size} slugs are unique\n`);
    }

  } catch (error) {
    console.error('\n❌ Error during slug regeneration:', error);
    throw error;
  }
}

// Run the script
regenerateSlugs()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Script failed:', error);
    process.exit(1);
  });
