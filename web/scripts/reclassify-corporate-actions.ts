/**
 * Reclassify Corporate Actions
 * Updates offeringType from 'IPO' to correct type for the 4 misclassified entries
 */

import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

interface Reclassification {
  symbol: string | null;
  companyName: string;
  currentType: string;
  newType: 'TENDER' | 'RIGHTS' | 'OFS';
  reason: string;
}

const reclassifications: Reclassification[] = [
  {
    symbol: 'CUPIDALBV',
    companyName: 'CUPID BREWERIES AND DISTILLERIES LTD',
    currentType: 'IPO',
    newType: 'OFS',
    reason: 'Already listed on BSE (Nov 2024), no active offering',
  },
  {
    symbol: 'SBECSUG',
    companyName: 'SBEC SUGAR LTD',
    currentType: 'IPO',
    newType: 'TENDER',
    reason: 'Open Offer for existing shareholders (Oct 28 - Nov 12, 2025)',
  },
  {
    symbol: 'SHAMROIN',
    companyName: 'SHAMROCK INDUSTRIAL COMPANY LTD',
    currentType: 'IPO',
    newType: 'TENDER',
    reason: 'Open Offer announced October 2025',
  },
  {
    symbol: null,
    companyName: 'GARMENT MANTRA LIFESTYLE LTD',
    currentType: 'IPO',
    newType: 'RIGHTS',
    reason: 'Rights Issue with 39:20 entitlement ratio',
  },
];

async function reclassifyCorporateActions() {
  console.log('🔄 Reclassifying Corporate Actions\n');
  console.log('='.repeat(80));

  let updatedCount = 0;
  let notFoundCount = 0;

  for (const item of reclassifications) {
    console.log(`\n${item.companyName}`);
    console.log(`  Symbol: ${item.symbol || 'N/A'}`);
    console.log(`  Current Type: ${item.currentType}`);
    console.log(`  New Type: ${item.newType}`);
    console.log(`  Reason: ${item.reason}`);

    try {
      // Find IPO by symbol or company name
      let ipo;
      if (item.symbol) {
        [ipo] = await db
          .select()
          .from(ipos)
          .where(eq(ipos.symbol, item.symbol))
          .limit(1);
      } else {
        [ipo] = await db
          .select()
          .from(ipos)
          .where(eq(ipos.companyName, item.companyName))
          .limit(1);
      }

      if (!ipo) {
        console.log(`  ❌ IPO not found in database`);
        notFoundCount++;
        continue;
      }

      console.log(`  Current offeringType: ${ipo.offeringType}`);

      // Update offering type
      await db
        .update(ipos)
        .set({
          offeringType: item.newType,
          updatedAt: new Date(),
        })
        .where(eq(ipos.id, ipo.id));

      console.log(`  ✅ Updated: offeringType = ${item.newType}`);
      updatedCount++;
    } catch (error) {
      console.log(`  ❌ Error:`, error);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary');
  console.log('='.repeat(80));
  console.log(`✅ Updated: ${updatedCount}/4`);
  console.log(`❌ Not Found: ${notFoundCount}/4`);
  console.log('\n');

  if (updatedCount === 4) {
    console.log('✅ All entries successfully reclassified!');
    console.log('\nNext Steps:');
    console.log('  1. Add UI indicators to differentiate offering types');
    console.log('  2. Update filters to show TENDER and RIGHTS offerings');
    console.log('  3. Update listing pages to show offering type badges\n');
  }
}

reclassifyCorporateActions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
