/**
 * Verify Historical IPO Data in Database
 * Quick verification script after running historical scraper
 */

// Load environment variables
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { db } from '@/lib/db';
import { ipos } from '@/lib/db/schema';
import { sql, isNotNull } from 'drizzle-orm';

async function verifyData() {
  console.log('\n========================================');
  console.log('DATABASE VERIFICATION AFTER HISTORICAL SCRAPER');
  console.log('========================================\n');

  try {
    // Count total IPOs
    const totalResult = await db.select({ count: sql<number>`count(*)::int` }).from(ipos);
    const totalCount = totalResult[0]?.count || 0;
    console.log(`✓ Total IPOs in database: ${totalCount}`);

    // Count IPOs with historical data
    const historicalResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ipos)
      .where(isNotNull(ipos.historicalDataScrapedAt));
    const historicalCount = historicalResult[0]?.count || 0;
    console.log(`✓ IPOs with historical data: ${historicalCount}`);

    // Count IPOs with subscription data
    const subscriptionResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ipos)
      .where(isNotNull(ipos.subscriptionTotal));
    const subscriptionCount = subscriptionResult[0]?.count || 0;
    console.log(`✓ IPOs with subscription data: ${subscriptionCount}`);

    // Count IPOs with GMP data
    const gmpResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ipos)
      .where(isNotNull(ipos.gmpPrice));
    const gmpCount = gmpResult[0]?.count || 0;
    console.log(`✓ IPOs with GMP data: ${gmpCount}`);

    // Count IPOs with listing performance
    const listingResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ipos)
      .where(isNotNull(ipos.listingGainPercentage));
    const listingCount = listingResult[0]?.count || 0;
    console.log(`✓ IPOs with listing performance: ${listingCount}`);

    // Sample IPOs with historical data
    const samples = await db
      .select({
        companyName: ipos.companyName,
        subscriptionTotal: ipos.subscriptionTotal,
        gmpPrice: ipos.gmpPrice,
        listingGainPercentage: ipos.listingGainPercentage,
      })
      .from(ipos)
      .where(isNotNull(ipos.historicalDataScrapedAt))
      .limit(5);

    console.log('\n📊 Sample IPOs with historical data:\n');
    samples.forEach((ipo, idx) => {
      console.log(`${idx + 1}. ${ipo.companyName}`);
      console.log(`   Subscription: ${ipo.subscriptionTotal || 'N/A'}`);
      console.log(`   GMP: ₹${ipo.gmpPrice || 'N/A'}`);
      console.log(`   Listing Gain: ${ipo.listingGainPercentage || 'N/A'}%`);
      console.log('');
    });

    console.log('========================================');
    console.log('✅ Database verification complete!');
    console.log('========================================\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

verifyData();
