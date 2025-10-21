/**
 * Link IPOs to Registrars for Allotment Checker Testing
 * Links some CLOSED and LISTED IPOs to registrars for testing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

import { db } from '../lib/db/index';
import { ipos, registrars } from '../lib/db';
import { eq } from 'drizzle-orm';

async function linkIPOsToRegistrars() {
  console.log('\n🔗 Linking IPOs to Registrars for Testing...\n');

  try {
    // Get registrar IDs
    const linkIntime = await db.select().from(registrars).where(eq(registrars.shortName, 'Link Intime')).limit(1);
    const kfin = await db.select().from(registrars).where(eq(registrars.shortName, 'KFin')).limit(1);
    const bigshare = await db.select().from(registrars).where(eq(registrars.shortName, 'Bigshare')).limit(1);

    console.log('Found registrars:', {
      linkIntime: linkIntime[0]?.shortName,
      kfin: kfin[0]?.shortName,
      bigshare: bigshare[0]?.shortName,
    });

    if (!linkIntime[0] || !kfin[0] || !bigshare[0]) {
      console.error('❌ Registrars not found. Run seed-registrars.ts first.');
      throw new Error('Registrars not found');
    }

    // Update CLOSED IPOs
    console.log('\n📋 Updating CLOSED IPOs...');

    const closedUpdates = [
      { slug: 'midwest-ltd-ipo-c', registrar: linkIntime[0] },
      { slug: 'midwest-ltd-ipo', registrar: kfin[0] },
      { slug: 'midwest-ltd-ipo-ct', registrar: bigshare[0] },
    ];

    for (const update of closedUpdates) {
      await db.update(ipos)
        .set({
          registrarId: update.registrar.id,
          registrar: update.registrar.name,
        })
        .where(eq(ipos.slug, update.slug));
      console.log(`✓ Linked ${update.slug} to ${update.registrar.shortName}`);
    }

    // Update LISTED IPOs
    console.log('\n📋 Updating LISTED IPOs...');

    const listedUpdates = [
      { slug: 'shlokka-dyes-ltd-ipo', registrar: linkIntime[0] },
      { slug: 'sihora-industries-ltd-ipo', registrar: kfin[0] },
      { slug: 'canara-hsbc-life-insurance-co-ltd-ipo', registrar: bigshare[0] },
    ];

    for (const update of listedUpdates) {
      await db.update(ipos)
        .set({
          registrarId: update.registrar.id,
          registrar: update.registrar.name,
        })
        .where(eq(ipos.slug, update.slug));
      console.log(`✓ Linked ${update.slug} to ${update.registrar.shortName}`);
    }

    console.log('\n✅ Successfully linked IPOs to registrars!\n');

  } catch (error) {
    console.error('\n❌ Error linking IPOs:', error);
    throw error;
  }
}

linkIPOsToRegistrars()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('✗ Script failed:', error);
    process.exit(1);
  });
