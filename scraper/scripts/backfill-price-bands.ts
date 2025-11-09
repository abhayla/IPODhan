/**
 * Backfill Missing Price Bands
 *
 * Fixes Phase 5 data quality issue: 493/495 IPOs (99.6%) missing price band data
 *
 * This script:
 * 1. Queries database for IPOs with missing price_range_min/max
 * 2. Uses NSE public-past-issues API to fetch price range data
 * 3. Updates database with price band information
 * 4. Provides progress reporting and error handling
 *
 * Run:
 * cd scraper
 * npx tsx scripts/backfill-price-bands.ts
 *
 * @module scraper/scripts/backfill-price-bands
 */

import { db } from '@ipodhan/shared/db';
import { ipos } from '@ipodhan/shared/db/schema';
import { sql, isNull, or } from 'drizzle-orm';
import logger from '../src/utils/logger.js';

/**
 * NSE Past IPO Response Interface
 */
interface NSEPastIPO {
  company: string;
  symbol: string;
  priceRange: string; // Format: "Rs.100 to Rs.106" or "₹253-₹266"
  ipoStartDate: string;
  ipoEndDate: string;
  listingDate?: string;
}

/**
 * Parse price range from NSE format
 * Handles formats: "Rs.100 to Rs.106", "₹253-₹266", "100 - 120"
 */
function parsePriceRange(priceStr: string): { min: number; max: number } | null {
  if (!priceStr || priceStr === '--' || priceStr === 'N/A') {
    return null;
  }

  try {
    const cleaned = priceStr.replace(/Rs\.?|₹|INR/gi, '').trim();

    // Handle range format "253 to 266" or "253 - 266" or "253-266"
    const rangeMatch = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:to|-)\s*(\d+(?:\.\d+)?)/i);
    if (rangeMatch) {
      const min = parseFloat(rangeMatch[1]);
      const max = parseFloat(rangeMatch[2]);
      if (!isNaN(min) && !isNaN(max) && min > 0 && max > 0 && max >= min) {
        return { min, max };
      }
    }

    // Handle single price
    const price = parseFloat(cleaned);
    if (!isNaN(price) && price > 0) {
      return { min: price, max: price };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch NSE past IPO data from API
 */
async function fetchNSEPastIPOs(): Promise<NSEPastIPO[]> {
  const BASE_URL = 'https://www.nseindia.com';
  const ENDPOINT = '/api/public-past-issues';

  logger.info('Fetching NSE past IPO data...');

  try {
    // Step 1: Initialize session by visiting homepage
    const homepageResponse = await fetch(BASE_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });

    const homepageCookies = homepageResponse.headers.getSetCookie?.() || [];
    const cookieHeader = homepageCookies.map(c => c.split(';')[0]).join('; ');

    // Wait 1.5 seconds (human-like behavior)
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Step 2: Fetch past IPO data with cookies
    const apiResponse = await fetch(BASE_URL + ENDPOINT, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.nseindia.com/market-data/all-upcoming-issues-ipo',
        'Cookie': cookieHeader,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      }
    });

    if (!apiResponse.ok) {
      throw new Error(`NSE API returned ${apiResponse.status}: ${apiResponse.statusText}`);
    }

    const data = await apiResponse.json() as NSEPastIPO[];

    if (!Array.isArray(data)) {
      throw new Error('NSE API returned non-array response');
    }

    logger.info({ ipoCount: data.length }, 'NSE past IPO data fetched successfully');
    return data;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error)
    }, 'Failed to fetch NSE past IPO data');
    throw error;
  }
}

/**
 * Match NSE IPO to database IPO by company name similarity
 * Returns best match or null if no good match found
 */
function matchIPOByName(dbIPO: { companyName: string; symbol?: string | null }, nseIPOs: NSEPastIPO[]): NSEPastIPO | null {
  const dbName = dbIPO.companyName.toLowerCase().trim();
  const dbSymbol = dbIPO.symbol?.toLowerCase().trim();

  // Try exact symbol match first
  if (dbSymbol) {
    const symbolMatch = nseIPOs.find(nseIPO =>
      nseIPO.symbol?.toLowerCase() === dbSymbol
    );
    if (symbolMatch) {
      return symbolMatch;
    }
  }

  // Try company name matching
  let bestMatch: NSEPastIPO | null = null;
  let bestScore = 0;

  for (const nseIPO of nseIPOs) {
    const nseName = nseIPO.company.toLowerCase().trim();

    // Exact match
    if (dbName === nseName) {
      return nseIPO;
    }

    // Partial match (calculate similarity score)
    const dbWords = dbName.split(/\s+/);
    const nseWords = nseName.split(/\s+/);
    let matchingWords = 0;

    for (const dbWord of dbWords) {
      if (dbWord.length < 3) continue; // Skip short words
      if (nseWords.some(nseWord => nseWord.includes(dbWord) || dbWord.includes(nseWord))) {
        matchingWords++;
      }
    }

    const score = matchingWords / Math.max(dbWords.length, nseWords.length);

    if (score > bestScore && score >= 0.6) { // 60% similarity threshold
      bestScore = score;
      bestMatch = nseIPO;
    }
  }

  return bestMatch;
}

/**
 * Main backfill function
 */
async function backfillPriceBands() {
  console.log('========================================');
  console.log('Backfill Missing Price Bands');
  console.log('========================================\n');

  try {
    // Step 1: Get IPOs with missing price bands
    console.log('Step 1: Querying IPOs with missing price bands...\n');

    const iposWithoutPriceBands = await db.select({
      id: ipos.id,
      companyName: ipos.companyName,
      symbol: ipos.symbol,
      slug: ipos.slug,
      priceRangeMin: ipos.priceRangeMin,
      priceRangeMax: ipos.priceRangeMax
    })
      .from(ipos)
      .where(
        or(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax)
        )
      );

    console.log(`Found ${iposWithoutPriceBands.length} IPOs without price bands\n`);

    if (iposWithoutPriceBands.length === 0) {
      console.log('✅ No IPOs need price band backfill!\n');
      process.exit(0);
    }

    // Step 2: Fetch NSE past IPO data
    console.log('Step 2: Fetching NSE past IPO data...\n');
    const nseIPOs = await fetchNSEPastIPOs();

    if (nseIPOs.length === 0) {
      console.log('❌ No NSE IPO data available for backfill\n');
      process.exit(1);
    }

    // Step 3: Match and update
    console.log('Step 3: Matching and updating price bands...\n');

    let updated = 0;
    let notFound = 0;
    let failed = 0;

    for (const dbIPO of iposWithoutPriceBands) {
      try {
        // Match IPO by name/symbol
        const nseIPO = matchIPOByName(dbIPO, nseIPOs);

        if (!nseIPO) {
          console.log(`⚠️  No match: ${dbIPO.companyName}`);
          notFound++;
          continue;
        }

        // Parse price range
        const priceRange = parsePriceRange(nseIPO.priceRange);

        if (!priceRange) {
          console.log(`⚠️  Invalid price range: ${dbIPO.companyName} (${nseIPO.priceRange})`);
          failed++;
          continue;
        }

        // Update database
        await db.update(ipos)
          .set({
            priceRangeMin: priceRange.min,
            priceRangeMax: priceRange.max,
            updatedAt: new Date()
          })
          .where(sql`${ipos.id} = ${dbIPO.id}`);

        console.log(`✅ Updated: ${dbIPO.companyName} → ₹${priceRange.min}-₹${priceRange.max}`);
        updated++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Error updating ${dbIPO.companyName}:`, error instanceof Error ? error.message : String(error));
        failed++;
      }
    }

    // Step 4: Summary
    console.log('\n========================================');
    console.log('Backfill Summary');
    console.log('========================================\n');

    console.log(`Total IPOs processed: ${iposWithoutPriceBands.length}`);
    console.log(`✅ Successfully updated: ${updated}`);
    console.log(`⚠️  No NSE match found: ${notFound}`);
    console.log(`❌ Failed to update: ${failed}\n`);

    const successRate = ((updated / iposWithoutPriceBands.length) * 100).toFixed(2);
    console.log(`Success rate: ${successRate}%\n`);

    // Verify improvement
    const remainingWithout = await db.select({ count: sql<number>`count(*)` })
      .from(ipos)
      .where(
        or(
          isNull(ipos.priceRangeMin),
          isNull(ipos.priceRangeMax)
        )
      );

    const totalIPOs = await db.select({ count: sql<number>`count(*)` }).from(ipos);
    const remaining = Number(remainingWithout[0]?.count || 0);
    const total = Number(totalIPOs[0]?.count || 0);
    const coverage = ((total - remaining) / total * 100).toFixed(2);

    console.log('Current coverage:');
    console.log(`  IPOs with price bands: ${total - remaining}/${total} (${coverage}%)`);
    console.log(`  IPOs without price bands: ${remaining}\n`);

    if (parseFloat(coverage) >= 90) {
      console.log('✅ TARGET ACHIEVED: Price band coverage >= 90%\n');
    } else {
      console.log(`⚠️  Target not met: Need ${90 - parseFloat(coverage)}% more coverage\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERROR: Backfill failed\n');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nStack trace:');
    console.error(error instanceof Error ? error.stack : 'No stack trace available');
    process.exit(1);
  }
}

backfillPriceBands();
