/**
 * Verify all NSE and BSE IPO data is properly saved
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { db } from '@ipodhan/shared';

async function verifyData() {
  try {
    console.log('\n=== VERIFYING NSE & BSE DATA IN DATABASE ===\n');

    const ipos = await db.query.ipos.findMany({
      orderBy: (ipos, { desc }) => [desc(ipos.createdAt)]
    });

    console.log(`📊 Total IPOs: ${ipos.length}\n`);

    // Count by exchange
    const bseOnly = ipos.filter(ipo => {
      const exchanges = ipo.listingExchanges as string[];
      return exchanges.includes('BSE') && !exchanges.includes('NSE');
    });

    const nseOnly = ipos.filter(ipo => {
      const exchanges = ipo.listingExchanges as string[];
      return exchanges.includes('NSE') && !exchanges.includes('BSE');
    });

    const dualListed = ipos.filter(ipo => {
      const exchanges = ipo.listingExchanges as string[];
      return exchanges.includes('NSE') && exchanges.includes('BSE');
    });

    console.log('📈 Exchange Breakdown:');
    console.log(`   BSE Only: ${bseOnly.length}`);
    console.log(`   NSE Only: ${nseOnly.length}`);
    console.log(`   Dual-Listed (BSE + NSE): ${dualListed.length}`);
    console.log(`   Total with NSE: ${nseOnly.length + dualListed.length}`);
    console.log(`   Total with BSE: ${bseOnly.length + dualListed.length}\n`);

    console.log('📋 Status Breakdown:');
    const byStatus = ipos.reduce((acc, ipo) => {
      acc[ipo.status] = (acc[ipo.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });

    console.log('\n📂 Category Breakdown:');
    const byCategory = ipos.reduce((acc, ipo) => {
      acc[ipo.category] = (acc[ipo.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    Object.entries(byCategory).forEach(([category, count]) => {
      console.log(`   ${category}: ${count}`);
    });

    if (nseOnly.length > 0) {
      console.log('\n\n🔵 NSE-Only IPOs:');
      nseOnly.forEach((ipo, i) => {
        console.log(`${i + 1}. ${ipo.companyName} - ${ipo.status}`);
      });
    }

    if (dualListed.length > 0) {
      console.log('\n\n🟣 Dual-Listed IPOs (BSE + NSE):');
      dualListed.forEach((ipo, i) => {
        console.log(`${i + 1}. ${ipo.companyName} - ${ipo.status}`);
      });
    }

    console.log('\n\n=== VERIFICATION COMPLETE ===');
    console.log(`✅ NSE scraping is ${nseOnly.length + dualListed.length > 0 ? 'WORKING' : 'NOT WORKING'}`);
    console.log(`✅ BSE scraping is ${bseOnly.length + dualListed.length > 0 ? 'WORKING' : 'NOT WORKING'}`);
    console.log(`✅ Dual-listing merge is ${dualListed.length > 0 ? 'WORKING' : 'NOT WORKING'}`);

    // Check for data quality issues
    console.log('\n📝 Data Quality Check:');
    const missingLotSize = ipos.filter(ipo => !ipo.lotSize || ipo.lotSize === 0);
    const missingPrice = ipos.filter(ipo => !ipo.priceRangeMin || !ipo.priceRangeMax);
    const missingDates = ipos.filter(ipo => !ipo.openDate || !ipo.closeDate);

    console.log(`   Missing lot_size: ${missingLotSize.length}`);
    console.log(`   Missing prices: ${missingPrice.length}`);
    console.log(`   Missing dates: ${missingDates.length}`);

    if (missingLotSize.length > 0) {
      console.log('\n   ⚠️ IPOs with missing lot_size:');
      missingLotSize.slice(0, 5).forEach(ipo => {
        console.log(`      - ${ipo.companyName} (${(ipo.listingExchanges as string[]).join(', ')})`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

verifyData();
