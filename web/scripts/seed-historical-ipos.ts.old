/**
 * Seed Historical IPOs
 *
 * This script imports historical IPO data into the database by:
 * 1. Running the historical scraper to get 480 IPOs from Chittorgarh
 * 2. Creating new IPO records for unmatched IPOs
 * 3. Enriching existing IPOs with historical data
 *
 * Goal: Populate database with 150+ IPOs for comprehensive testing
 */

import { historicalIPOScraper } from '@/lib/scrapers/sources/historical-ipo-scraper';
import { db } from '@/lib/db';
import { ipos, type NewIPO } from '@/lib/db/schema';
import { nanoid } from 'nanoid';

interface SeedStats {
  totalScraped: number;
  alreadyMatched: number;
  newIPOsCreated: number;
  existingIPOsEnriched: number;
  failed: number;
}

/**
 * Generate a URL-safe slug from company name
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
 * Infer IPO category from company name or default to MAINBOARD
 */
function inferCategory(companyName: string): 'MAINBOARD' | 'SME' {
  const lowerName = companyName.toLowerCase();
  // SME keywords
  if (lowerName.includes('sme') || lowerName.includes('emerge')) {
    return 'SME';
  }
  // Default to MAINBOARD
  return 'MAINBOARD';
}

/**
 * Determine IPO status based on listing date
 */
function inferStatus(listingDate: Date | null): 'LISTED' | 'CLOSED' | 'OPEN' | 'UPCOMING' {
  if (listingDate) {
    return 'LISTED';
  }
  // For historical data without listing date, assume CLOSED
  return 'CLOSED';
}

/**
 * Create a new IPO record from historical data
 */
async function createIPORecord(data: any): Promise<string | null> {
  try {
    const slug = generateSlug(data.ipoName);
    const category = inferCategory(data.ipoName);
    const status = inferStatus(data.listingDate);

    // Check if slug already exists
    const existing = await db.query.ipos.findFirst({
      where: (ipos, { eq }) => eq(ipos.slug, slug),
    });

    if (existing) {
      console.log(`  ⚠️  Slug already exists: ${slug}`);
      return null;
    }

    const newIPO: NewIPO = {
      id: nanoid(),
      companyName: data.ipoName,
      slug,
      category,
      status,

      // Dates
      openDate: data.openDate ? data.openDate.toISOString().split('T')[0] : null,
      closeDate: data.closeDate ? data.closeDate.toISOString().split('T')[0] : null,
      listingDate: data.listingDate ? data.listingDate.toISOString().split('T')[0] : null,

      // Pricing
      priceBandLow: data.issuePrice ? data.issuePrice.toString() : null,
      priceBandHigh: data.issuePrice ? data.issuePrice.toString() : null,

      // Historical data
      subscriptionRetail: data.subscriptionRetail?.toString(),
      subscriptionHni: data.subscriptionHni?.toString(),
      subscriptionQib: data.subscriptionQib?.toString(),
      subscriptionTotal: data.subscriptionTotal?.toString(),
      gmpPrice: data.gmpPrice?.toString(),
      gmpPercentageHistorical: data.gmpPercentage?.toString(),
      gmpUpdatedAtHistorical: new Date(),
      listingPriceHistorical: data.listingPrice?.toString(),
      listingGainPercentage: data.listingGainPercentage?.toString(),
      listingGainAmount: data.listingGainAmount?.toString(),
      listingDateHistorical: data.listingDate ? data.listingDate.toISOString().split('T')[0] : null,
      currentPrice: data.currentPrice?.toString(),
      currentGainPercentage: data.currentGainPercentage?.toString(),
      currentGainAmount: data.currentGainAmount?.toString(),
      currentPriceUpdatedAt: new Date(),
      historicalDataSource: 'Chittorgarh',
      historicalDataScrapedAt: new Date(),

      // Exchange (default to BOTH for historical data)
      exchange: 'BOTH',

      // Metadata
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(ipos).values(newIPO);
    console.log(`  ✅ Created: ${data.ipoName} (${category})`);
    return newIPO.id;
  } catch (error) {
    console.error(`  ❌ Failed to create ${data.ipoName}:`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Main seeding function
 */
async function seedHistoricalIPOs() {
  console.log('🌱 Starting Historical IPO Seeding Process\n');
  console.log('━'.repeat(60));

  const stats: SeedStats = {
    totalScraped: 0,
    alreadyMatched: 0,
    newIPOsCreated: 0,
    existingIPOsEnriched: 0,
    failed: 0,
  };

  try {
    // Step 1: Run historical scraper
    console.log('\n📊 Step 1: Scraping historical IPO data from Chittorgarh...\n');
    const result = await historicalIPOScraper.scrape({
      years: [2020, 2021, 2022, 2023, 2024, 2025],
    });

    if (!result.success || !result.data) {
      throw new Error('Historical scraper failed');
    }

    stats.totalScraped = result.data.length;
    console.log(`\n✅ Scraped ${stats.totalScraped} IPOs from Chittorgarh\n`);

    // Step 2: Categorize scraped data
    console.log('━'.repeat(60));
    console.log('\n📋 Step 2: Categorizing scraped data...\n');

    const matched = result.data.filter(d => d.ipoId);
    const unmatched = result.data.filter(d => !d.ipoId);

    stats.alreadyMatched = matched.length;
    stats.existingIPOsEnriched = matched.length;

    console.log(`  ✓ Already matched to existing IPOs: ${matched.length}`);
    console.log(`  ✓ Unmatched (will create new): ${unmatched.length}\n`);

    // Step 3: Create new IPO records for unmatched data
    if (unmatched.length > 0) {
      console.log('━'.repeat(60));
      console.log('\n💾 Step 3: Creating new IPO records...\n');

      for (const data of unmatched) {
        const created = await createIPORecord(data);
        if (created) {
          stats.newIPOsCreated++;
        } else {
          stats.failed++;
        }
      }
    }

    // Step 4: Summary
    console.log('\n' + '━'.repeat(60));
    console.log('\n📈 Seeding Complete!\n');
    console.log('Summary:');
    console.log(`  • Total scraped from Chittorgarh: ${stats.totalScraped}`);
    console.log(`  • Already matched (enriched): ${stats.existingIPOsEnriched}`);
    console.log(`  • New IPOs created: ${stats.newIPOsCreated}`);
    console.log(`  • Failed: ${stats.failed}`);
    console.log(`  • Total IPOs in database: ${stats.existingIPOsEnriched + stats.newIPOsCreated}\n`);

    // Verify final count
    const finalCount = await db.select().from(ipos);
    console.log('━'.repeat(60));
    console.log(`\n✨ Database now contains ${finalCount.length} IPOs\n`);

    if (finalCount.length >= 150) {
      console.log('🎉 SUCCESS: Database has 150+ IPOs for comprehensive testing!\n');
    } else {
      console.log(`⚠️  WARNING: Only ${finalCount.length} IPOs (target: 150+)\n`);
    }

  } catch (error) {
    console.error('\n❌ Seeding failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

// Run the seeding process
seedHistoricalIPOs()
  .then(() => {
    console.log('✅ Seeding process completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding process failed:', error);
    process.exit(1);
  });
