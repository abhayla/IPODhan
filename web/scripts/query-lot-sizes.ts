import { getDb } from '../lib/db/index';
import { ipos } from '@ipodhan/shared/db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getDb();

  console.log('\n=== LOT SIZE DATA QUALITY ANALYSIS ===\n');

  // Query 1: Lot size distribution by segment
  console.log('--- Lot Size Distribution by Segment ---\n');

  const lotSizeBySegment = await db
    .select({
      segment: ipos.segment,
      ipoCount: sql<number>`COUNT(*)`,
      minLotSize: sql<number>`MIN(${ipos.lotSize})`,
      maxLotSize: sql<number>`MAX(${ipos.lotSize})`,
      avgLotSize: sql<number>`ROUND(AVG(${ipos.lotSize}), 2)`,
      countLotSize1: sql<number>`COUNT(CASE WHEN ${ipos.lotSize} = 1 THEN 1 END)`,
      countTypicalMainboard: sql<number>`COUNT(CASE WHEN ${ipos.lotSize} BETWEEN 10 AND 75 THEN 1 END)`,
      countTypicalSME: sql<number>`COUNT(CASE WHEN ${ipos.lotSize} BETWEEN 100 AND 150 THEN 1 END)`,
    })
    .from(ipos)
    .where(sql`${ipos.segment} IS NOT NULL`)
    .groupBy(ipos.segment)
    .orderBy(ipos.segment);

  console.log('Segment | IPOs | Min | Max | Avg | Lot=1 | Typical MB (10-75) | Typical SME (100-150)');
  console.log('---'.repeat(30));
  lotSizeBySegment.forEach(row => {
    console.log(
      `${row.segment || 'NULL'} | ${row.ipoCount} | ${row.minLotSize} | ${row.maxLotSize} | ${row.avgLotSize} | ${row.countLotSize1} | ${row.countTypicalMainboard} | ${row.countTypicalSME}`
    );
  });

  // Query 2: Sample IPOs with lot_size = 1
  console.log('\n\n--- Sample IPOs with Lot Size = 1 (Unrealistic) ---\n');

  const lotSize1IPOs = await db
    .select({
      companyName: ipos.companyName,
      segment: ipos.segment,
      lotSize: ipos.lotSize,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax,
      status: ipos.status,
    })
    .from(ipos)
    .where(sql`${ipos.lotSize} = 1`)
    .limit(10);

  if (lotSize1IPOs.length === 0) {
    console.log('✅ No IPOs with lot_size = 1 found!');
  } else {
    console.log(`Found ${lotSize1IPOs.length} IPOs with lot_size = 1:\n`);
    lotSize1IPOs.forEach((ipo, i) => {
      console.log(`${i + 1}. ${ipo.companyName}`);
      console.log(`   Segment: ${ipo.segment || 'N/A'}`);
      console.log(`   Lot Size: ${ipo.lotSize}`);
      console.log(`   Price Range: ₹${ipo.priceRangeMin} - ₹${ipo.priceRangeMax}`);
      console.log(`   Status: ${ipo.status}`);
      console.log('');
    });
  }

  // Query 3: Lot size distribution overall
  console.log('\n--- Overall Lot Size Distribution ---\n');

  const distribution = await db
    .select({
      lotSizeRange: sql<string>`CASE
        WHEN ${ipos.lotSize} = 1 THEN '1 (Unrealistic)'
        WHEN ${ipos.lotSize} BETWEEN 2 AND 9 THEN '2-9 (Very Low)'
        WHEN ${ipos.lotSize} BETWEEN 10 AND 75 THEN '10-75 (Typical MAINBOARD)'
        WHEN ${ipos.lotSize} BETWEEN 76 AND 99 THEN '76-99 (High MAINBOARD)'
        WHEN ${ipos.lotSize} BETWEEN 100 AND 150 THEN '100-150 (Typical SME)'
        WHEN ${ipos.lotSize} > 150 THEN '150+ (Very High)'
        ELSE 'NULL/Unknown'
      END`,
      count: sql<number>`COUNT(*)`,
      percentage: sql<number>`ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ${ipos}), 2)`,
    })
    .from(ipos)
    .groupBy(sql`CASE
      WHEN ${ipos.lotSize} = 1 THEN '1 (Unrealistic)'
      WHEN ${ipos.lotSize} BETWEEN 2 AND 9 THEN '2-9 (Very Low)'
      WHEN ${ipos.lotSize} BETWEEN 10 AND 75 THEN '10-75 (Typical MAINBOARD)'
      WHEN ${ipos.lotSize} BETWEEN 76 AND 99 THEN '76-99 (High MAINBOARD)'
      WHEN ${ipos.lotSize} BETWEEN 100 AND 150 THEN '100-150 (Typical SME)'
      WHEN ${ipos.lotSize} > 150 THEN '150+ (Very High)'
      ELSE 'NULL/Unknown'
    END`)
    .orderBy(sql`COUNT(*) DESC`);

  console.log('Lot Size Range | Count | Percentage');
  console.log('---'.repeat(20));
  distribution.forEach(row => {
    console.log(`${row.lotSizeRange} | ${row.count} | ${row.percentage}%`);
  });

  // Query 4: Recommendations
  console.log('\n\n=== RECOMMENDATIONS ===\n');

  const totalIPOs = await db.select({ count: sql<number>`COUNT(*)` }).from(ipos);
  const lot1Count = await db.select({ count: sql<number>`COUNT(*)` }).from(ipos).where(sql`${ipos.lotSize} = 1`);

  const lot1Percentage = totalIPOs[0].count > 0
    ? ((lot1Count[0].count / totalIPOs[0].count) * 100).toFixed(2)
    : 0;

  console.log(`Total IPOs: ${totalIPOs[0].count}`);
  console.log(`IPOs with lot_size = 1: ${lot1Count[0].count} (${lot1Percentage}%)`);
  console.log('');

  if (lot1Count[0].count > 0) {
    console.log('⚠️ DATA QUALITY ISSUE CONFIRMED:');
    console.log(`   ${lot1Count[0].count} IPOs have unrealistic lot_size = 1`);
    console.log('');
    console.log('RECOMMENDED ACTIONS:');
    console.log('1. Review scraper logic for lot size extraction');
    console.log('2. Check if lot_size field is being populated correctly');
    console.log('3. Consider setting default lot sizes:');
    console.log('   - MAINBOARD: 75 shares (typical)');
    console.log('   - SME: 100-125 shares (typical)');
    console.log('4. Re-scrape affected IPOs to get correct lot sizes');
    console.log('');
    console.log('IMPACT:');
    console.log('- Lot Calculator will show incorrect results');
    console.log('- Users will get wrong investment calculations');
    console.log('- Critical for user experience');
  } else {
    console.log('✅ No data quality issues found!');
    console.log('   All lot sizes are realistic (> 1)');
  }

  process.exit(0);
}

main().catch(console.error);
