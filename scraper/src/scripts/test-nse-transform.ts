/**
 * Test NSE API data transformation
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { scrapeNSEAPI } from '../scrapers/nse-api-client.js';
import { upsertIPO } from '../services/data-persister.js';
import { db, getRedisClient } from '@ipodhan/shared';
import logger from '../utils/logger.js';

async function testNSE() {
  try {
    console.log('\n=== TESTING NSE SCRAPER ===\n');

    // Scrape NSE API
    const result = await scrapeNSEAPI();

    console.log(`Total IPOs found: ${result.ipos.length}`);
    console.log(`Total subscriptions found: ${result.subscriptions.length}\n`);

    if (result.ipos.length === 0) {
      console.log('❌ No IPOs found!');
      process.exit(1);
    }

    console.log('IPOs scraped:');
    result.ipos.forEach((ipo, i) => {
      console.log(`${i + 1}. ${ipo.companyName}`);
      console.log(`   Status: ${ipo.status} | Category: ${ipo.category}`);
      console.log(`   Dates: ${ipo.openDate} to ${ipo.closeDate}`);
      console.log(`   Price: ₹${ipo.priceRangeMin} - ₹${ipo.priceRangeMax}`);
      console.log(`   Issue Size: ₹${ipo.issueSize} Cr`);
      console.log('');
    });

    // Now try to save to database
    console.log('=== SAVING TO DATABASE ===\n');

    const { IPORepository } = await import('@ipodhan/shared');
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    let successCount = 0;
    let failCount = 0;

    for (const ipo of result.ipos) {
      try {
        const ipoId = await upsertIPO(ipoRepository, ipo, 'NSE');
        console.log(`✅ ${ipo.companyName} - Saved (ID: ${ipoId})`);
        successCount++;
      } catch (error) {
        console.log(`❌ ${ipo.companyName} - Failed: ${error}`);
        failCount++;
      }
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`✅ Success: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📊 Success Rate: ${((successCount / result.ipos.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

testNSE();
