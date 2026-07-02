/**
 * Force NSE scraping using direct fetch (bypassing complex cookie logic)
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '../../.env') });

import { db, getRedisClient } from '@ipodhan/shared';
import { IPORepository } from '@ipodhan/shared';
import { upsertIPO } from '../services/data-persister.js';
import type { ScrapedIPO } from '../utils/validators.js';

const BASE_URL = 'https://www.nseindia.com';

async function scrapeNSEDirect() {
  console.log('\n=== FORCE NSE SCRAPING ===\n');

  try {
    // Step 1: Visit homepage to get cookies
    console.log('1. Visiting NSE homepage to get session cookies...');
    const homeResponse = await fetch(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const cookies = homeResponse.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') || '';
    console.log(`   Got ${cookies.split(';').length} cookies\n`);

    // Step 2: Fetch IPO list
    console.log('2. Fetching IPO list from API...');
    const apiResponse = await fetch(BASE_URL + '/api/all-upcoming-issues?category=ipo', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
        ...(cookies && { 'Cookie': cookies })
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`API returned ${apiResponse.status}`);
    }

    const ipos = await apiResponse.json();
    console.log(`   Found ${ipos.length} IPOs\n`);

    // Step 3: Transform and save
    console.log('3. Transforming and saving to database...\n');

    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    let successCount = 0;
    let failCount = 0;

    for (const item of ipos) {
      try {
        // Parse dates
        const parseDate = (dateStr: string) => {
          const date = new Date(dateStr);
          return date.toISOString().split('T')[0];
        };

        // Parse price range
        const parsePrice = (priceStr: string) => {
          const match = priceStr.match(/(\d+)\s*to\s*(\d+)/);
          if (match) {
            return { min: parseInt(match[1]), max: parseInt(match[2]) };
          }
          const single = parseInt(priceStr.replace(/\D/g, ''));
          return { min: single, max: single };
        };

        const prices = parsePrice(item.issuePrice || '0');

        const ipo: ScrapedIPO = {
          companyName: item.companyName,
          issueSize: parseFloat(item.issueSize) || 0,
          priceRangeMin: prices.min,
          priceRangeMax: prices.max,
          openDate: parseDate(item.issueStartDate),
          closeDate: parseDate(item.issueEndDate),
          listingDate: undefined,
          listingExchange: 'NSE',
          category: item.series === 'SME' ? 'SME' : (item.series === 'NCD' ? 'NCD' : 'MAINBOARD'),
          sector: undefined, // never write '' — plants a blank that blocks real backfills
          status: item.status === 'Active' ? 'OPEN' : (item.status === 'Closed' ? 'CLOSED' : 'UPCOMING'),
          lotSize: 1, // Default
          faceValue: 10, // Default
          symbol: item.symbol
        };

        const ipoId = await upsertIPO(ipoRepository, ipo, 'NSE');
        console.log(`✅ ${ipo.companyName}`);
        successCount++;
      } catch (error) {
        console.log(`❌ ${item.companyName}: ${error instanceof Error ? error.message : String(error)}`);
        failCount++;
      }
    }

    console.log(`\n=== RESULTS ===`);
    console.log(`✅ Success: ${successCount}/${ipos.length}`);
    console.log(`❌ Failed: ${failCount}/${ipos.length}`);
    console.log(`📊 Success Rate: ${((successCount / ipos.length) * 100).toFixed(1)}%`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

scrapeNSEDirect();
