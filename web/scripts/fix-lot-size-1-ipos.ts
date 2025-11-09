/**
 * Fix lot_size=1 IPOs - Execute Database Corrections
 *
 * Based on research findings documented in:
 * docs/04-data-flow/LOT-SIZE-DATA-QUALITY-ANALYSIS.md
 *
 * Actions:
 * 1. Delete 5 invalid entries (already-listed companies)
 * 2. Update 8 RIGHTS issues (mark offeringType='RIGHTS')
 * 3. Update 1 InvIT (Capital Infra Trust)
 */

import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';

async function fixLotSizeOneIPOs() {
  console.log('Starting database corrections for lot_size=1 IPOs...\n');

  try {
    // Step 1: Delete 5 invalid entries (already-listed companies)
    console.log('Step 1: Deleting 5 invalid entries (already-listed companies)...');
    const invalidIds = [
      '78ea471f-3511-460a-a366-4e8901ca4d03', // VIP Industries (listed since 1968)
      'dc8f4909-c56a-4b7b-93db-bee0cf3b2fd7', // Devinsu Trading (listed since 1985)
      '22218dec-e32d-40ab-bb66-5294d38ac558', // Shree Pacetronix (listed since 1993)
      'ce4b88c7-4ea0-4944-be91-aaabd97a3eb1', // Grand Foundry (listed since 1992)
      '0bd06d91-0c4d-4ea8-b4e2-7bb3559958bf'  // BJ Duplex Boards (listed since 1995)
    ];

    const deleteResult = await db
      .delete(ipos)
      .where(inArray(ipos.id, invalidIds));

    console.log(`✅ Deleted ${deleteResult.rowCount || 0} invalid entries\n`);

    // Step 2: Update 8 RIGHTS issues
    console.log('Step 2: Updating 8 RIGHTS issues...');
    const rightsIds = [
      'fb6240af-081b-44ce-bf88-9284c13ac443', // Ashnisha Industries
      'f0892437-1248-465e-ae99-ff930e34dc3c', // Star Housing Finance
      '9f0ba7b8-cfef-4797-be67-0d6d3d5ceeff', // Mangalam Industrial Finance
      'dc6daa24-d687-49c5-b56c-53c3a47dabc6', // U H Zaveri
      '8c2efe49-d953-4fe0-ae66-82645e8e8d95', // Covidh Technologies
      '64c4c707-02f2-4e82-9cf1-d58968b3069a', // Magnus Steel and Infra
      'fcb593db-193d-49bd-a80d-5830191e37a0', // Times Green Energy
      '626e1816-d97a-49f7-8cdf-0a7548e45b1c'  // Titan Intech
    ];

    const rightsResult = await db
      .update(ipos)
      .set({ offeringType: 'RIGHTS' })
      .where(inArray(ipos.id, rightsIds));

    console.log(`✅ Updated ${rightsResult.rowCount || 0} RIGHTS issues\n`);

    // Step 3: Update 1 InvIT (Capital Infra Trust)
    console.log('Step 3: Updating 1 InvIT...');
    const invitResult = await db
      .update(ipos)
      .set({
        offeringType: 'INVITS', // Note: enum value is plural 'INVITS'
        lotSize: 150
      })
      .where(eq(ipos.id, 'e7765944-270a-493b-aef4-a8298eecfed6'));

    console.log(`✅ Updated ${invitResult.rowCount || 0} InvIT\n`);

    // Summary
    console.log('='.repeat(60));
    console.log('DATABASE CORRECTIONS COMPLETE ✅');
    console.log('='.repeat(60));
    console.log(`Deleted: ${deleteResult.rowCount || 0} invalid entries`);
    console.log(`Updated: ${rightsResult.rowCount || 0} RIGHTS issues`);
    console.log(`Updated: ${invitResult.rowCount || 0} InvIT`);
    console.log('='.repeat(60));
    console.log('\nNext step: Run find-lot-size-1-ipos.ts to verify corrections');

  } catch (error) {
    console.error('Error executing database corrections:', error);
    throw error;
  }
}

// Run the corrections
fixLotSizeOneIPOs()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
