/**
 * Update Past Close Date Status
 *
 * Updates IPOs from OPEN to CLOSED when their close date has passed.
 *
 * Usage:
 *   npm run update-past-close-status              # Dry-run (preview only)
 *   npm run update-past-close-status -- --execute # Execute updates
 */

import { db } from '../lib/db/index.js';
import { ipos } from '@ipodhan/shared/db/schema';
import { and, eq, lte, sql } from 'drizzle-orm';

async function updatePastCloseDateStatus(dryRun: boolean = true) {
  console.log('\n' + '='.repeat(80));
  console.log('UPDATE PAST CLOSE DATE STATUS');
  console.log('='.repeat(80));
  console.log(`Mode: ${dryRun ? 'DRY-RUN (Preview Only)' : 'EXECUTE (Will Update)'}`);
  console.log('='.repeat(80));
  console.log('');

  // Get current date (midnight)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  console.log(`📅 Current Date: ${todayStr}\n`);

  // Find OPEN IPOs with close date in the past
  const staleIPOs = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      symbol: ipos.symbol,
      segment: ipos.segment,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate,
      status: ipos.status,
      updatedAt: ipos.updatedAt,
    })
    .from(ipos)
    .where(
      and(
        eq(ipos.status, 'OPEN'),
        lte(sql`${ipos.closeDate}::date`, todayStr)
      )
    )
    .orderBy(ipos.closeDate);

  console.log(`Found ${staleIPOs.length} OPEN IPOs with past close dates\n`);

  if (staleIPOs.length === 0) {
    console.log('✅ No IPOs need status update!\n');
    return;
  }

  // Display list
  console.log('='.repeat(80));
  console.log('IPOs TO UPDATE (OPEN → CLOSED):');
  console.log('='.repeat(80));
  console.log('');

  staleIPOs.forEach((ipo, index) => {
    const daysSinceClose = Math.floor(
      (Date.now() - new Date(ipo.closeDate!).getTime()) / (1000 * 60 * 60 * 24)
    );

    console.log(`${index + 1}. ${ipo.companyName}`);
    console.log(`   Symbol: ${ipo.symbol || 'NULL'}`);
    console.log(`   Segment: ${ipo.segment || 'NULL'}`);
    console.log(`   Open Date: ${ipo.openDate}`);
    console.log(`   Close Date: ${ipo.closeDate} (${daysSinceClose} days ago)`);
    console.log(`   Current Status: ${ipo.status} → Will update to: CLOSED`);
    console.log(`   Slug: ${ipo.slug}`);
    console.log('');
  });

  // Execute updates
  if (!dryRun) {
    console.log('='.repeat(80));
    console.log('EXECUTING UPDATES');
    console.log('='.repeat(80));
    console.log('');

    let updated = 0;
    const updateLog: any[] = [];

    for (const ipo of staleIPOs) {
      try {
        await db
          .update(ipos)
          .set({
            status: 'CLOSED',
            updatedAt: new Date(),
          })
          .where(eq(ipos.id, ipo.id));

        console.log(`✅ Updated: ${ipo.companyName} (${ipo.id})`);
        updated++;

        updateLog.push({
          id: ipo.id,
          companyName: ipo.companyName,
          slug: ipo.slug,
          symbol: ipo.symbol,
          closeDate: ipo.closeDate,
          oldStatus: ipo.status,
          newStatus: 'CLOSED',
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        console.error(`❌ Failed to update ${ipo.companyName}: ${error}`);
      }
    }

    console.log('');
    console.log('='.repeat(80));
    console.log('UPDATE COMPLETE');
    console.log('='.repeat(80));
    console.log(`\n✅ Updated ${updated} IPOs from OPEN to CLOSED`);
    console.log('');

    // Display summary
    console.log('Summary:');
    console.log(`  - IPOs updated: ${updated}`);
    console.log(`  - Status changed: OPEN → CLOSED`);
    console.log(`  - Update timestamp: ${new Date().toISOString()}`);
    console.log('');
  } else {
    console.log('='.repeat(80));
    console.log('DRY-RUN COMPLETE');
    console.log('='.repeat(80));
    console.log('');
    console.log('No changes made to database (dry-run mode).');
    console.log('');
    console.log('To execute updates:');
    console.log('  cd web && npm run update-past-close-status:execute');
    console.log('');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const executeMode = args.includes('--execute');

updatePastCloseDateStatus(!executeMode)
  .then(() => {
    console.log('✅ Script completed successfully\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
