/**
 * Direct Update for 4 Priority IPO Lot Sizes
 *
 * Based on manual research from NSE/BSE/Moneycontrol
 */

import { db } from '@/lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { eq } from 'drizzle-orm';

// MANUAL RESEARCH RESULTS
// Update these values after researching each IPO
const lotSizeUpdates = [
  {
    symbol: 'CUPIDALBV',
    companyName: 'CUPID BREWERIES AND DISTILLERIES LTD',
    lotSize: 1, // Standard market lot (already listed on BSE)
    source: 'BSE Market Lot (Listed Stock)',
  },
  {
    symbol: 'SBECSUG',
    companyName: 'SBEC SUGAR LTD',
    lotSize: 1, // Standard market lot (Open Offer for listed stock)
    source: 'BSE Market Lot (Open Offer)',
  },
  {
    symbol: 'SHAMROIN',
    companyName: 'SHAMROCK INDUSTRIAL COMPANY LTD',
    lotSize: 1, // Standard market lot (Open Offer for listed stock)
    source: 'BSE Market Lot (Open Offer)',
  },
  {
    symbol: null,
    companyName: 'GARMENT MANTRA LIFESTYLE LTD',
    lotSize: 1, // Standard market lot (Rights Issue, 39:20 ratio)
    source: 'BSE Market Lot (Rights Issue)',
  },
];

async function updateLotSizes() {
  console.log('🔄 Updating lot sizes for 4 priority IPOs\n');

  let updatedCount = 0;
  let skippedCount = 0;

  for (const update of lotSizeUpdates) {
    console.log(`\nProcessing: ${update.companyName}`);
    console.log(`  Symbol: ${update.symbol || 'N/A'}`);
    console.log(`  Lot Size: ${update.lotSize || 'NOT SET'}`);

    if (update.lotSize === null) {
      console.log(`  ⏭️  Skipped (lot size not researched yet)`);
      skippedCount++;
      continue;
    }

    try {
      // Find IPO by symbol or company name
      let ipo;
      if (update.symbol) {
        [ipo] = await db
          .select()
          .from(ipos)
          .where(eq(ipos.symbol, update.symbol))
          .limit(1);
      } else {
        [ipo] = await db
          .select()
          .from(ipos)
          .where(eq(ipos.companyName, update.companyName))
          .limit(1);
      }

      if (!ipo) {
        console.log(`  ❌ IPO not found in database`);
        continue;
      }

      // Update lot size
      await db
        .update(ipos)
        .set({
          lotSize: update.lotSize,
          updatedAt: new Date(),
        })
        .where(eq(ipos.id, ipo.id));

      console.log(`  ✅ Updated: lot_size = ${update.lotSize}`);
      updatedCount++;
    } catch (error) {
      console.log(`  ❌ Error:`, error);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary');
  console.log('='.repeat(80));
  console.log(`✅ Updated: ${updatedCount}/4`);
  console.log(`⏭️  Skipped: ${skippedCount}/4 (lot sizes not researched)`);
  console.log('\n');

  if (skippedCount > 0) {
    console.log('⚠️  To complete updates:');
    console.log('   1. Research lot sizes on NSE/BSE');
    console.log('   2. Update lotSize values in this script');
    console.log('   3. Re-run: npm run update-priority-lot-sizes\n');
  }
}

updateLotSizes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
