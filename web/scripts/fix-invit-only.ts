/**
 * Fix Capital Infra Trust InvIT - Update only
 * (Steps 1 & 2 already completed successfully)
 */

import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';

async function fixInvIT() {
  console.log('Updating Capital Infra Trust InvIT...\n');

  try {
    const invitResult = await db
      .update(ipos)
      .set({
        offeringType: 'INVITS', // Note: enum value is plural
        lotSize: 150
      })
      .where(eq(ipos.id, 'e7765944-270a-493b-aef4-a8298eecfed6'));

    console.log(`✅ Updated ${invitResult.rowCount || 0} InvIT (Capital Infra Trust)`);
    console.log('   - offeringType: INVITS');
    console.log('   - lotSize: 150\n');

  } catch (error) {
    console.error('Error updating InvIT:', error);
    throw error;
  }
}

fixInvIT()
  .then(() => {
    console.log('✅ InvIT correction complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
