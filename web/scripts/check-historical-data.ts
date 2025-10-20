import { db } from '@/lib/db';
import { ipos } from '@/lib/db/schema';

async function checkHistoricalData() {
  console.log('Checking if historical data was populated...\n');
  
  const result = await db.select({
    companyName: ipos.companyName,
    subscriptionRetail: ipos.subscriptionRetail,
    gmpPrice: ipos.gmpPrice,
    listingGainPercentage: ipos.listingGainPercentage,
    currentPrice: ipos.currentPrice,
    historicalDataSource: ipos.historicalDataSource,
  }).from(ipos).limit(5);
  
  console.log('Sample of 5 IPOs with historical data:\n');
  for (const row of result) {
    console.log(`${row.companyName}:`);
    console.log(`  Subscription Retail: ${row.subscriptionRetail || 'NULL'}`);
    console.log(`  GMP Price: ${row.gmpPrice || 'NULL'}`);
    console.log(`  Listing Gain %: ${row.listingGainPercentage || 'NULL'}`);
    console.log(`  Current Price: ${row.currentPrice || 'NULL'}`);
    console.log(`  Data Source: ${row.historicalDataSource || 'NULL'}`);
    console.log('');
  }
  
  process.exit(0);
}

checkHistoricalData();
