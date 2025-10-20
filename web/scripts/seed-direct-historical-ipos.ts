/**
 * Direct Seed Historical IPOs (Bypassing Fuzzy Matching)
 *
 * This script directly creates IPO records from Chittorgarh historical data
 * WITHOUT using fuzzy matching, ensuring all 480 historical IPOs are inserted.
 */

import * as cheerio from 'cheerio';
import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { type InferInsertModel } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { sql } from 'drizzle-orm';

type NewIPO = InferInsertModel<typeof ipos>;

interface HistoricalIPOData {
  ipoName: string;
  issuePrice: number | null;
  listingPrice: number | null;
  listingGainPercentage: number | null;
  currentPrice: number | null;
  currentGainPercentage: number | null;
  listedOn: Date | null;
}

/**
 * Fetch HTML from URL
 */
async function fetchHTML(url: string): Promise<cheerio.CheerioAPI> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  const html = await response.text();
  return cheerio.load(html);
}

/**
 * Generate slug from company name
 */
function generateSlug(companyName: string): string {
  return companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

/**
 * Infer category from name
 */
function inferCategory(name: string): 'MAINBOARD' | 'SME' {
  const lower = name.toLowerCase();
  if (lower.includes('sme') || lower.includes('emerge')) return 'SME';
  return 'MAINBOARD';
}

/**
 * Parse number from text
 */
function parseNumber(text: string): number | null {
  if (!text || text === '-') return null;
  const cleaned = text.replace(/[₹,\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse percentage from text
 */
function parsePercentage(text: string): number | null {
  if (!text || text === '-') return null;
  const cleaned = text.replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Parse date from text
 */
function parseDate(text: string): Date | null {
  if (!text || text === '-') return null;
  try {
    const date = new Date(text);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Scrape Chittorgarh for all years
 */
async function scrapeAllYears(): Promise<HistoricalIPOData[]> {
  console.log('📊 Scraping Chittorgarh for historical IPO data...\n');

  const url = 'https://www.chittorgarh.com/ipo/ipo_perf_tracker.asp';
  const $ = await fetchHTML(url);
  const ipoData: HistoricalIPOData[] = [];

  // Find the main table
  let tableRows: cheerio.Element[] = [];
  $('table').each((_, table) => {
    const $table = $(table);
    const rows = $table.find('tbody tr, tr').toArray();
    const dataRows = rows.filter(row => {
      const $row = $(row);
      const cells = $row.find('td');
      return cells.length >= 3 && !$row.find('th').length;
    });
    if (dataRows.length > tableRows.length) {
      tableRows = dataRows;
    }
  });

  console.log(`  Found ${tableRows.length} IPO rows\n`);

  for (const row of tableRows) {
    try {
      const $row = $(row);
      const cells = $row.find('td').toArray();

      if (cells.length < 3) continue;

      const ipoName = $(cells[0]).text().trim();
      if (!ipoName || ipoName.toLowerCase().includes('no record')) continue;

      let data: HistoricalIPOData;

      if (cells.length >= 7) {
        // Full table with 7+ columns
        const listedOnText = $(cells[1]).text().trim();
        data = {
          ipoName,
          issuePrice: parseNumber($(cells[2]).text()),
          listingPrice: parseNumber($(cells[3]).text()),
          listingGainPercentage: parsePercentage($(cells[4]).text()),
          currentPrice: parseNumber($(cells[5]).text()),
          currentGainPercentage: parsePercentage($(cells[6]).text()),
          listedOn: parseDate(listedOnText),
        };
      } else {
        // Simple 3-column table
        data = {
          ipoName,
          issuePrice: null,
          listingPrice: null,
          listingGainPercentage: parsePercentage($(cells[1]).text()),
          currentPrice: null,
          currentGainPercentage: parsePercentage($(cells[2]).text()),
          listedOn: null,
        };
      }

      // Only add if has some valid data
      if (data.listingGainPercentage !== null || data.currentGainPercentage !== null) {
        ipoData.push(data);
      }
    } catch (error) {
      console.warn(`  ⚠️  Failed to parse row:`, error);
    }
  }

  return ipoData;
}

/**
 * Create IPO record
 */
async function createIPO(data: HistoricalIPOData, skipExisting: boolean = true): Promise<boolean> {
  try {
    const slug = generateSlug(data.ipoName);

    // Check if exists
    if (skipExisting) {
      const existing = await db.query.ipos.findFirst({
        where: (ipos, { eq }) => eq(ipos.slug, slug),
      });

      if (existing) {
        return false; // Skip existing
      }
    }

    const category = inferCategory(data.ipoName);
    const status = data.listedOn ? 'LISTED' : 'CLOSED';

    const newIPO: NewIPO = {
      id: nanoid(),
      companyName: data.ipoName,
      slug,
      category,
      status,
      exchange: 'BOTH',

      // Pricing
      priceBandLow: data.issuePrice?.toString(),
      priceBandHigh: data.issuePrice?.toString(),

      // Dates
      listingDate: data.listedOn ? data.listedOn.toISOString().split('T')[0] : null,

      // Historical data
      listingPriceHistorical: data.listingPrice?.toString(),
      listingGainPercentage: data.listingGainPercentage?.toString(),
      listingGainAmount: (data.issuePrice && data.listingPrice) ? (data.listingPrice - data.issuePrice).toString() : null,
      currentPrice: data.currentPrice?.toString(),
      currentGainPercentage: data.currentGainPercentage?.toString(),
      currentGainAmount: (data.issuePrice && data.currentPrice) ? (data.currentPrice - data.issuePrice).toString() : null,
      historicalDataSource: 'Chittorgarh',
      historicalDataScrapedAt: new Date(),
      currentPriceUpdatedAt: new Date(),

      // Metadata
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(ipos).values(newIPO);
    return true;
  } catch (error) {
    console.error(`  ❌ Failed to create ${data.ipoName}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🌱 Direct Historical IPO Seeding\n');
  console.log('━'.repeat(60) + '\n');

  try {
    // Get current count
    const beforeCount = await db.select({ count: sql<number>`count(*)::int` }).from(ipos);
    console.log(`📊 Current database: ${beforeCount[0]?.count || 0} IPOs\n`);

    // Scrape data
    const allIPOs = await scrapeAllYears();
    console.log(`✅ Scraped ${allIPOs.length} historical IPOs\n`);

    // Create new records
    console.log('━'.repeat(60));
    console.log('\n💾 Creating IPO records...\n');

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const ipo of allIPOs) {
      const result = await createIPO(ipo);
      if (result) {
        created++;
        if (created <= 10 || created % 50 === 0) {
          console.log(`  ✅ Created: ${ipo.ipoName} (${created}/${allIPOs.length})`);
        }
      } else {
        skipped++;
      }
    }

    // Get final count
    const afterCount = await db.select({ count: sql<number>`count(*)::int` }).from(ipos);
    const finalCount = afterCount[0]?.count || 0;

    console.log('\n' + '━'.repeat(60));
    console.log('\n📈 Seeding Complete!\n');
    console.log('Summary:');
    console.log(`  • Total scraped: ${allIPOs.length}`);
    console.log(`  • New IPOs created: ${created}`);
    console.log(`  • Skipped (existing): ${skipped}`);
    console.log(`  • Failed: ${failed}`);
    console.log(`  • Database now has: ${finalCount} IPOs\n`);

    console.log('━'.repeat(60) + '\n');

    if (finalCount >= 150) {
      console.log('🎉 SUCCESS: Database has 150+ IPOs for comprehensive testing!\n');
    } else {
      console.log(`⚠️  Target not reached: ${finalCount}/150 IPOs\n`);
    }

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Seeding failed:', error);
    process.exit(1);
  }
}

main();
