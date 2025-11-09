/**
 * Filtered Analysis - Real IPOs Missing Critical Fields
 *
 * Filters out:
 * - Test entries
 * - RIGHTS issues (lot_size not applicable)
 * - Development/integration test data
 */

import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { or, and, isNull, inArray, not, eq, like, sql } from 'drizzle-orm';

async function analyzeRealIPOs() {
  console.log('Filtered Analysis: Real IPOs Missing Critical Fields\n');
  console.log('='.repeat(80));

  // Find real OPEN/UPCOMING IPOs (exclude RIGHTS, test data) missing lot_size
  const realIPOsMissingLotSize = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      segment: ipos.segment,
      status: ipos.status,
      offeringType: ipos.offeringType,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate
    })
    .from(ipos)
    .where(
      and(
        isNull(ipos.lotSize),
        inArray(ipos.status, ['OPEN', 'UPCOMING']),
        // Exclude RIGHTS issues (lot_size not applicable)
        or(
          isNull(ipos.offeringType),
          eq(ipos.offeringType, 'IPO'),
          eq(ipos.offeringType, 'FPO')
        ),
        // Exclude test entries
        not(sql`lower(${ipos.companyName}) like '%test%'`)
      )
    )
    .orderBy(ipos.status, ipos.openDate);

  console.log('1. REAL IPOs Missing lot_size (excluding RIGHTS & test data):');
  console.log('='.repeat(80));

  if (realIPOsMissingLotSize.length === 0) {
    console.log('✅ No real IPOs missing lot_size\n');
  } else {
    console.log(`⚠️  Found ${realIPOsMissingLotSize.length} real IPO(s) missing lot_size:\n`);
    realIPOsMissingLotSize.forEach((ipo, index) => {
      console.log(`${index + 1}. ${ipo.companyName}`);
      console.log(`   Slug: ${ipo.slug}`);
      console.log(`   Segment: ${ipo.segment || 'NULL'}`);
      console.log(`   Status: ${ipo.status}`);
      console.log(`   Open: ${ipo.openDate || 'NULL'} → Close: ${ipo.closeDate || 'NULL'}`);
      console.log('');
    });
  }

  // Find real OPEN/UPCOMING IPOs missing price band
  const realIPOsMissingPriceBand = await db
    .select({
      id: ipos.id,
      companyName: ipos.companyName,
      slug: ipos.slug,
      segment: ipos.segment,
      status: ipos.status,
      offeringType: ipos.offeringType,
      openDate: ipos.openDate,
      closeDate: ipos.closeDate
    })
    .from(ipos)
    .where(
      and(
        or(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax)
        ),
        inArray(ipos.status, ['OPEN', 'UPCOMING']),
        // Exclude RIGHTS issues
        or(
          isNull(ipos.offeringType),
          eq(ipos.offeringType, 'IPO'),
          eq(ipos.offeringType, 'FPO')
        ),
        // Exclude test entries
        not(sql`lower(${ipos.companyName}) like '%test%'`)
      )
    )
    .orderBy(ipos.status, ipos.openDate);

  console.log('='.repeat(80));
  console.log('2. REAL IPOs Missing price_band (excluding RIGHTS & test data):');
  console.log('='.repeat(80));

  if (realIPOsMissingPriceBand.length === 0) {
    console.log('✅ No real IPOs missing price band\n');
  } else {
    console.log(`⚠️  Found ${realIPOsMissingPriceBand.length} real IPO(s) missing price band:\n`);
    realIPOsMissingPriceBand.forEach((ipo, index) => {
      console.log(`${index + 1}. ${ipo.companyName}`);
      console.log(`   Slug: ${ipo.slug}`);
      console.log(`   Segment: ${ipo.segment || 'NULL'}`);
      console.log(`   Status: ${ipo.status}`);
      console.log(`   Open: ${ipo.openDate || 'NULL'} → Close: ${ipo.closeDate || 'NULL'}`);
      console.log('');
    });
  }

  // Summary
  console.log('='.repeat(80));
  console.log('FILTERED SUMMARY');
  console.log('='.repeat(80));
  console.log(`Real IPOs missing lot_size: ${realIPOsMissingLotSize.length}`);
  console.log(`Real IPOs missing price_band: ${realIPOsMissingPriceBand.length}`);
  console.log('='.repeat(80));
  console.log('\nRECOMMENDATION:');
  console.log('- Run NSE/BSE scrapers to populate missing lot_size and price_band');
  console.log('- Most missing data is from older IPOs that need scraper refresh');
  console.log('- Test entries and RIGHTS issues have been filtered out');
}

analyzeRealIPOs()
  .then(() => {
    console.log('\n✅ Filtered analysis complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error);
    process.exit(1);
  });
