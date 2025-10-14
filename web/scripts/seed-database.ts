/**
 * Database Seeding Script for Testing Environment
 * Story 7.11: Comprehensive IPO Database Seeding
 *
 * Creates 150+ IPO records with realistic data and proper distributions:
 * - Status: OPEN (10-15%), CLOSED (20-25%), LISTED (50-60%), UPCOMING (10-15%)
 * - Category: MAINBOARD (70%), SME (30%)
 * - All required schema fields populated
 * - Unique slugs guaranteed
 * - Idempotent execution
 *
 * Usage:
 *   npm run seed:database       # Seed if database is empty
 *   npm run seed:force          # Force re-seed (clears existing data)
 */

// Load environment variables FIRST before any other imports
import { config } from 'dotenv';
import { resolve } from 'path';

const envPath = resolve(__dirname, '../.env.local');
const result = config({ path: envPath });

if (result.error) {
  console.error('Error loading .env.local:', result.error);
  process.exit(1);
}

if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
  console.error('ERROR: Database configuration not found in environment variables');
  console.error('Tried loading from:', envPath);
  process.exit(1);
}

console.log('✓ Environment variables loaded successfully\n');

import { db, closePool } from '../lib/db/index';
import { ipos, listingPerformance } from '../lib/db';
import { count, sql } from 'drizzle-orm';
import type { IPOStatus, IPOCategory } from '../lib/db/types';

// ==================== CONFIGURATION ====================

const SEED_CONFIG = {
  totalIPOs: 150,
  statusDistribution: {
    OPEN: { min: 10, max: 15 },      // 10-15%
    CLOSED: { min: 20, max: 25 },    // 20-25%
    LISTED: { min: 50, max: 60 },    // 50-60%
    UPCOMING: { min: 10, max: 15 },  // 10-15%
  },
  categoryDistribution: {
    MAINBOARD: 70,  // 70%
    SME: 30,        // 30%
  },
  batchSize: 50,  // Process 50 IPOs per batch
};

const SECTORS = [
  'Technology',
  'Pharmaceuticals',
  'Infrastructure',
  'Automobile',
  'Renewable Energy',
  'Financial Services',
  'Hospitality',
  'Manufacturing',
  'Retail',
  'Food Processing',
  'Electronics',
  'Education Technology',
  'Herbal Products',
  'Microfinance',
  'Packaging',
];

const COMPANY_PREFIXES = [
  'Tech', 'Digital', 'Smart', 'Advanced', 'Global', 'National', 'Metro', 'Urban',
  'Green', 'Eco', 'New', 'Prime', 'Elite', 'Royal', 'Supreme', 'Apex',
  'Innovative', 'Dynamic', 'Progressive', 'United', 'Integrated', 'Modern',
];

const COMPANY_SUFFIXES = [
  'Solutions', 'Systems', 'Technologies', 'Industries', 'Services', 'Enterprises',
  'Corporation', 'Group', 'Holdings', 'Ventures', 'Partners', 'Associates',
];

const REGISTRARS = [
  'KFin Technologies Ltd',
  'Link Intime India Pvt Ltd',
  'Karvy Computershare Pvt Ltd',
  'Bigshare Services Pvt Ltd',
  'Cameo Corporate Services Ltd',
];

const LEAD_MANAGERS = [
  'ICICI Securities',
  'Kotak Mahindra Capital',
  'Axis Capital',
  'HDFC Bank',
  'SBI Capital Markets',
  'JM Financial',
  'Nomura',
  'Goldman Sachs',
  'Morgan Stanley',
  'IIFL Securities',
];

// ==================== HELPER FUNCTIONS ====================

/**
 * Generate random integer between min and max (inclusive)
 */
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random decimal string
 */
function randomDecimal(min: number, max: number, decimals: number = 2): string {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(decimals);
}

/**
 * Get random item from array
 */
function randomChoice<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

/**
 * Get multiple random items from array
 */
function randomChoices<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * Calculate relative date from today
 */
function getRelativeDate(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split('T')[0];
}

/**
 * Generate unique company name
 */
function generateCompanyName(existingNames: Set<string>): string {
  let companyName: string;
  let attempts = 0;

  do {
    const prefix = randomChoice(COMPANY_PREFIXES);
    const sector = randomChoice(SECTORS);
    const suffix = randomChoice(COMPANY_SUFFIXES);

    // Mix different patterns for variety
    const pattern = randomInt(1, 4);
    switch (pattern) {
      case 1:
        companyName = `${prefix} ${sector} ${suffix} Ltd`;
        break;
      case 2:
        companyName = `${prefix} ${suffix} Ltd`;
        break;
      case 3:
        companyName = `${sector} ${suffix} Ltd`;
        break;
      default:
        companyName = `${prefix} ${sector} Ltd`;
    }

    attempts++;
    if (attempts > 1000) {
      // Fallback: append random number
      companyName = `${prefix} ${sector} ${suffix} ${randomInt(100, 999)} Ltd`;
      break;
    }
  } while (existingNames.has(companyName));

  existingNames.add(companyName);
  return companyName;
}

/**
 * Generate unique slug from company name
 */
function generateSlug(companyName: string, existingSlugs: Set<string>): string {
  let slug = companyName
    .toLowerCase()
    .replace(/\s+ltd$/i, '')
    .replace(/\s+limited$/i, '')
    .replace(/\s+pvt$/i, '')
    .replace(/\s+private$/i, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

  // Ensure uniqueness
  let uniqueSlug = slug;
  let counter = 1;
  while (existingSlugs.has(uniqueSlug)) {
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }

  existingSlugs.add(uniqueSlug);
  return uniqueSlug;
}

/**
 * Generate company description
 */
function generateDescription(companyName: string, sector: string, category: IPOCategory): string {
  const descriptions = [
    `${companyName} is a leading player in the ${sector} sector with strong market presence.`,
    `Established ${sector} company with innovative solutions and experienced management team.`,
    `${companyName} operates in ${sector} segment with focus on quality and customer satisfaction.`,
    `Fast-growing ${sector} enterprise with diversified operations and strong fundamentals.`,
  ];

  const categoryInfo = category === 'SME'
    ? ' Registered on SME platform with growth potential.'
    : ' Well-established company with proven track record.';

  return randomChoice(descriptions) + categoryInfo;
}

/**
 * Generate dates based on IPO status
 */
function generateDates(status: IPOStatus): {
  openDate: string;
  closeDate: string;
  allotmentDate: string | null;
  listingDate: string | null;
} {
  switch (status) {
    case 'UPCOMING':
      const upcomingOpenOffset = randomInt(5, 30);
      const upcomingCloseOffset = upcomingOpenOffset + randomInt(2, 5); // Always 2-5 days after open
      return {
        openDate: getRelativeDate(upcomingOpenOffset),
        closeDate: getRelativeDate(upcomingCloseOffset),
        allotmentDate: null,
        listingDate: null,
      };

    case 'OPEN':
      return {
        openDate: getRelativeDate(randomInt(-2, 0)),
        closeDate: getRelativeDate(randomInt(1, 3)),
        allotmentDate: getRelativeDate(randomInt(5, 8)),
        listingDate: getRelativeDate(randomInt(10, 14)),
      };

    case 'CLOSED':
      return {
        openDate: getRelativeDate(randomInt(-10, -3)),
        closeDate: getRelativeDate(randomInt(-2, -1)),
        allotmentDate: getRelativeDate(randomInt(2, 5)),
        listingDate: getRelativeDate(randomInt(7, 12)),
      };

    case 'LISTED':
      const daysAgoListed = randomInt(30, 365);
      return {
        openDate: getRelativeDate(-daysAgoListed - 5),
        closeDate: getRelativeDate(-daysAgoListed - 3),
        allotmentDate: getRelativeDate(-daysAgoListed - 1),
        listingDate: getRelativeDate(-daysAgoListed),
      };

    default:
      throw new Error(`Unknown status: ${status}`);
  }
}

/**
 * Calculate status distribution counts
 */
function calculateStatusDistribution(total: number): Record<IPOStatus, number> {
  const distribution = SEED_CONFIG.statusDistribution;

  // Calculate percentages (use midpoint of range)
  const openPercent = (distribution.OPEN.min + distribution.OPEN.max) / 2;
  const closedPercent = (distribution.CLOSED.min + distribution.CLOSED.max) / 2;
  const listedPercent = (distribution.LISTED.min + distribution.LISTED.max) / 2;
  const upcomingPercent = (distribution.UPCOMING.min + distribution.UPCOMING.max) / 2;

  // Calculate counts
  let openCount = Math.round((total * openPercent) / 100);
  let closedCount = Math.round((total * closedPercent) / 100);
  let listedCount = Math.round((total * listedPercent) / 100);
  let upcomingCount = Math.round((total * upcomingPercent) / 100);

  // Adjust to ensure total equals target
  const calculatedTotal = openCount + closedCount + listedCount + upcomingCount;
  const diff = total - calculatedTotal;

  // Add difference to LISTED (largest category)
  listedCount += diff;

  return {
    OPEN: openCount,
    CLOSED: closedCount,
    LISTED: listedCount,
    UPCOMING: upcomingCount,
  };
}

/**
 * Generate IPO data
 */
function generateIPOData(
  status: IPOStatus,
  category: IPOCategory,
  existingNames: Set<string>,
  existingSlugs: Set<string>
) {
  const companyName = generateCompanyName(existingNames);
  const slug = generateSlug(companyName, existingSlugs);
  const sector = randomChoice(SECTORS);
  const dates = generateDates(status);

  // Generate realistic financial parameters based on category
  const isMainboard = category === 'MAINBOARD';
  const issueSize = isMainboard
    ? randomDecimal(100, 5000, 2)
    : randomDecimal(10, 100, 2);

  const priceRangeMin = isMainboard
    ? randomInt(50, 800)
    : randomInt(10, 100);

  const priceRangeMax = priceRangeMin + randomInt(5, Math.round(priceRangeMin * 0.15));

  const lotSize = isMainboard
    ? randomInt(15, 100)
    : randomInt(1000, 5000);

  const faceValue = randomChoice([1, 2, 5, 10]);

  const listingExchanges: ('NSE' | 'BSE')[] = isMainboard
    ? ['NSE', 'BSE']
    : (randomChoice([['NSE'], ['BSE'], ['NSE', 'BSE']]) as ('NSE' | 'BSE')[]);

  const rating = randomInt(2, 5);
  const ratingRationales = [
    'Strong fundamentals with healthy growth trajectory.',
    'Experienced management team and good market position.',
    'Reasonable valuation with long-term growth potential.',
    'Established player with consistent financial performance.',
    'Innovative business model with competitive advantages.',
  ];

  // Explicit timestamp values (don't rely on Drizzle defaults)
  const now = new Date();

  return {
    companyName,
    slug,
    category,
    sector,
    issueSize,
    priceRangeMin,
    priceRangeMax,
    lotSize,
    status,
    openDate: dates.openDate,
    closeDate: dates.closeDate,
    allotmentDate: dates.allotmentDate,
    listingDate: dates.listingDate,
    companyDescription: generateDescription(companyName, sector, category),
    faceValue,
    listingExchanges,
    registrar: randomChoice(REGISTRARS),
    leadManagers: randomChoices(LEAD_MANAGERS, randomInt(1, 3)),
    rating,
    ratingRationale: randomChoice(ratingRationales),
    ratingOverride: false,
    // Explicit timestamps (AC: 10)
    createdAt: now,
    updatedAt: now,
    // Other optional fields
    registrarId: null,
    lastScrapedAt: null,
    // Historical fields (Story 7.10) - null by default
    subscriptionRetail: null,
    subscriptionHni: null,
    subscriptionQib: null,
    subscriptionTotal: null,
    gmpPrice: null,
    gmpPercentageHistorical: null,
    gmpUpdatedAtHistorical: null,
    listingPriceHistorical: null,
    listingGainPercentage: null,
    listingGainAmount: null,
    listingDateHistorical: null,
    currentPrice: null,
    currentGainPercentage: null,
    currentGainAmount: null,
    currentPriceUpdatedAt: null,
    historicalDataSource: null,
    historicalDataScrapedAt: null,
  };
}

// ==================== MAIN SEED FUNCTION ====================

async function seedDatabase() {
  const startTime = Date.now();
  const forceFlag = process.argv.includes('--force');

  console.log('='.repeat(70));
  console.log('DATABASE SEEDING FOR TESTING ENVIRONMENT');
  console.log('Story 7.11: Comprehensive IPO Database Seeding');
  console.log('='.repeat(70));
  console.log(`Target: ${SEED_CONFIG.totalIPOs} IPOs`);
  console.log(`Force mode: ${forceFlag ? 'YES (will clear existing data)' : 'NO'}\n`);

  try {
    // Check existing data (AC: 9 - Idempotency)
    console.log('[1/5] Checking existing data...');
    const result = await db.select({ count: count() }).from(ipos);
    const existingCount = Number(result[0]?.count || 0);

    if (existingCount > 0 && !forceFlag) {
      console.log(`\n⚠️  Database already contains ${existingCount} IPOs`);
      console.log('Seed script is idempotent - skipping to avoid duplicates');
      console.log('\nTo force re-seed, run: npm run seed:force');
      console.log('This will DELETE all existing IPO data and re-seed.\n');
      await closePool();
      return;
    }

    if (existingCount > 0 && forceFlag) {
      console.log(`\n⚠️  Force mode enabled - clearing ${existingCount} existing IPOs`);
      // Delete listing_performance first (foreign key constraint)
      await db.delete(listingPerformance);
      // Delete all IPOs (cascades to related tables)
      await db.delete(ipos);
      console.log('✓ Existing data cleared\n');
    } else {
      console.log('✓ Database is empty, ready for seeding\n');
    }

    // Calculate distributions (AC: 2, 5)
    console.log('[2/5] Calculating data distributions...');
    const statusCounts = calculateStatusDistribution(SEED_CONFIG.totalIPOs);
    const mainboardCount = Math.round((SEED_CONFIG.totalIPOs * SEED_CONFIG.categoryDistribution.MAINBOARD) / 100);
    const smeCount = SEED_CONFIG.totalIPOs - mainboardCount;

    console.log('\nTarget Distribution:');
    console.log(`  Total: ${SEED_CONFIG.totalIPOs}`);
    console.log(`  └─ Status:`);
    console.log(`     ├─ OPEN: ${statusCounts.OPEN} (${((statusCounts.OPEN / SEED_CONFIG.totalIPOs) * 100).toFixed(1)}%)`);
    console.log(`     ├─ CLOSED: ${statusCounts.CLOSED} (${((statusCounts.CLOSED / SEED_CONFIG.totalIPOs) * 100).toFixed(1)}%)`);
    console.log(`     ├─ LISTED: ${statusCounts.LISTED} (${((statusCounts.LISTED / SEED_CONFIG.totalIPOs) * 100).toFixed(1)}%)`);
    console.log(`     └─ UPCOMING: ${statusCounts.UPCOMING} (${((statusCounts.UPCOMING / SEED_CONFIG.totalIPOs) * 100).toFixed(1)}%)`);
    console.log(`  └─ Category:`);
    console.log(`     ├─ MAINBOARD: ${mainboardCount} (${SEED_CONFIG.categoryDistribution.MAINBOARD}%)`);
    console.log(`     └─ SME: ${smeCount} (${SEED_CONFIG.categoryDistribution.SME}%)\n`);

    // Generate IPO data (AC: 1, 3, 4, 6, 11)
    console.log('[3/5] Generating IPO data...');
    const ipoData: Array<ReturnType<typeof generateIPOData>> = [];
    const existingNames = new Set<string>();
    const existingSlugs = new Set<string>();

    // Generate for each status
    for (const [status, targetCount] of Object.entries(statusCounts)) {
      const statusTyped = status as IPOStatus;
      const mainboardForStatus = Math.round((targetCount * SEED_CONFIG.categoryDistribution.MAINBOARD) / 100);
      const smeForStatus = targetCount - mainboardForStatus;

      console.log(`  Generating ${targetCount} ${status} IPOs (${mainboardForStatus} MAINBOARD, ${smeForStatus} SME)...`);

      // Generate MAINBOARD IPOs
      for (let i = 0; i < mainboardForStatus; i++) {
        ipoData.push(generateIPOData(statusTyped, 'MAINBOARD', existingNames, existingSlugs));
      }

      // Generate SME IPOs
      for (let i = 0; i < smeForStatus; i++) {
        ipoData.push(generateIPOData(statusTyped, 'SME', existingNames, existingSlugs));
      }
    }

    console.log(`✓ Generated ${ipoData.length} IPO records\n`);

    // Insert IPOs in batches (AC: 8, 12)
    console.log('[4/5] Inserting IPOs into database...');
    const totalBatches = Math.ceil(ipoData.length / SEED_CONFIG.batchSize);
    let insertedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < ipoData.length; i += SEED_CONFIG.batchSize) {
      const batch = ipoData.slice(i, i + SEED_CONFIG.batchSize);
      const batchNumber = Math.floor(i / SEED_CONFIG.batchSize) + 1;

      try {
        await db.insert(ipos).values(batch);
        insertedCount += batch.length;
        console.log(`  ✓ Batch ${batchNumber}/${totalBatches}: Inserted ${batch.length} IPOs (Total: ${insertedCount}/${ipoData.length})`);
      } catch (error) {
        failedCount += batch.length;
        console.error(`  ✗ Batch ${batchNumber}/${totalBatches} failed:`, error);
        console.error(`  First failed record:`, JSON.stringify(batch[0], null, 2));
      }
    }

    console.log(`\n✓ Insertion complete: ${insertedCount} succeeded, ${failedCount} failed\n`);

    // Populate listing performance for LISTED IPOs (AC: 7)
    console.log('[5/5] Populating historical data for LISTED IPOs...');
    const listedIPOs = await db.select().from(ipos).where(sql`${ipos.status} = 'LISTED'`);
    console.log(`  Found ${listedIPOs.length} LISTED IPOs`);

    let listingPerfCount = 0;
    for (const ipo of listedIPOs) {
      try {
        const issuePrice = ipo.priceRangeMax || ipo.priceRangeMin || 100;
        const listingPrice = issuePrice + randomInt(-10, 100);
        const listingGainPercent = ((listingPrice - issuePrice) / issuePrice) * 100;

        const currentPrice = listingPrice + randomInt(-50, 150);
        const currentGainPercent = ((currentPrice - issuePrice) / issuePrice) * 100;

        await db.insert(listingPerformance).values({
          ipoId: ipo.id,
          listingPrice,
          issuePrice,
          listingGainPercent: randomDecimal(listingGainPercent - 2, listingGainPercent + 2),
          currentPrice,
          currentGainPercent: randomDecimal(currentGainPercent - 5, currentGainPercent + 5),
        });

        listingPerfCount++;
      } catch (error) {
        console.error(`  ✗ Failed to create listing performance for ${ipo.companyName}:`, error);
      }
    }

    console.log(`  ✓ Created ${listingPerfCount} listing performance records\n`);

    // Final summary
    const finalCount = await db.select({ count: count() }).from(ipos);
    const finalIPOCount = Number(finalCount[0]?.count || 0);

    // Verify distributions
    const actualStatusCounts = {
      OPEN: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'OPEN'`).then(r => Number(r[0]?.count || 0)),
      CLOSED: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'CLOSED'`).then(r => Number(r[0]?.count || 0)),
      LISTED: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'LISTED'`).then(r => Number(r[0]?.count || 0)),
      UPCOMING: await db.select({ count: count() }).from(ipos).where(sql`${ipos.status} = 'UPCOMING'`).then(r => Number(r[0]?.count || 0)),
    };

    const actualCategoryCounts = {
      MAINBOARD: await db.select({ count: count() }).from(ipos).where(sql`${ipos.category} = 'MAINBOARD'`).then(r => Number(r[0]?.count || 0)),
      SME: await db.select({ count: count() }).from(ipos).where(sql`${ipos.category} = 'SME'`).then(r => Number(r[0]?.count || 0)),
    };

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('='.repeat(70));
    console.log('SEEDING COMPLETED SUCCESSFULLY');
    console.log('='.repeat(70));
    console.log('\nFinal Statistics:');
    console.log(`  Total IPOs: ${finalIPOCount}`);
    console.log('\n  Status Distribution:');
    console.log(`    ├─ OPEN: ${actualStatusCounts.OPEN} (${((actualStatusCounts.OPEN / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log(`    ├─ CLOSED: ${actualStatusCounts.CLOSED} (${((actualStatusCounts.CLOSED / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log(`    ├─ LISTED: ${actualStatusCounts.LISTED} (${((actualStatusCounts.LISTED / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log(`    └─ UPCOMING: ${actualStatusCounts.UPCOMING} (${((actualStatusCounts.UPCOMING / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log('\n  Category Distribution:');
    console.log(`    ├─ MAINBOARD: ${actualCategoryCounts.MAINBOARD} (${((actualCategoryCounts.MAINBOARD / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log(`    └─ SME: ${actualCategoryCounts.SME} (${((actualCategoryCounts.SME / finalIPOCount) * 100).toFixed(1)}%)`);
    console.log('\n  Historical Data:');
    console.log(`    └─ Listing Performance Records: ${listingPerfCount}`);
    console.log(`\n  Execution Time: ${elapsedTime}s`);
    console.log('\n' + '='.repeat(70));
    console.log('\nNext Steps:');
    console.log('  1. Verify data: npm run verify:seed');
    console.log('  2. Start dev server: npm run dev');
    console.log('  3. Open Drizzle Studio: npm run db:studio');
    console.log('');

  } catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ SEEDING FAILED');
    console.error('='.repeat(70));
    console.error('\nError details:');
    console.error(error);
    console.error('');
    process.exit(1);
  } finally {
    await closePool();
  }
}

// ==================== EXECUTION ====================

seedDatabase();
