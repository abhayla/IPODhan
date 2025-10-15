/**
 * Broker Affiliates Seeding Script
 * Story 5.7: Broker Affiliates DB Migration
 *
 * Seeds the broker_affiliates table with 6 major Indian brokers.
 * Idempotent: Skips seeding if data already exists.
 *
 * Usage:
 *   npm run seed:broker-affiliates       # Seed if table is empty
 *   npm run seed:broker-affiliates:force # Force re-seed (clears existing data)
 */

// Load environment variables FIRST
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

import { db, closePool, brokerAffiliates } from '../lib/db';
import { count } from 'drizzle-orm';

// ==================== BROKER DATA ====================

const BROKER_AFFILIATES = [
  {
    brokerName: 'Zerodha',
    brokerLogo: 'https://zerodha.com/static/images/logo.svg',
    affiliateUrl: 'https://zerodha.com/open-account?c=IPODHAN',
    displayText: 'Open Free Demat Account',
    active: true,
    displayOrder: 1,
  },
  {
    brokerName: 'Groww',
    brokerLogo: 'https://assets-netstorage.groww.in/web-assets/billion_groww_desktop/prod/_next/static/media/logo.png',
    affiliateUrl: 'https://groww.in/open-demat-account?utm_source=ipodhan',
    displayText: 'Start Investing Today',
    active: true,
    displayOrder: 2,
  },
  {
    brokerName: 'Angel One',
    brokerLogo: 'https://www.angelone.in/assets/images/angel-one-logo.svg',
    affiliateUrl: 'https://angelone.in/open-account?ref=IPODHAN',
    displayText: 'Open Demat Account',
    active: true,
    displayOrder: 3,
  },
  {
    brokerName: 'Upstox',
    brokerLogo: 'https://upstox.com/app/themes/upstox/dist/img/logo/upstox-logo.svg',
    affiliateUrl: 'https://upstox.com/open-account/?f=IPODHAN',
    displayText: 'Open Account Now',
    active: true,
    displayOrder: 4,
  },
  {
    brokerName: '5paisa',
    brokerLogo: 'https://www.5paisa.com/Content/Images/5paisa-logo.svg',
    affiliateUrl: 'https://5paisa.com/open-demat-account?source=IPODHAN',
    displayText: 'Start Trading',
    active: true,
    displayOrder: 5,
  },
  {
    brokerName: 'ICICI Direct',
    brokerLogo: 'https://www.icicidirect.com/content/dam/icicisecurities/images/logo-icicidirect.svg',
    affiliateUrl: 'https://www.icicidirect.com/open-demat-account?ref=IPODHAN',
    displayText: 'Apply for Demat',
    active: true,
    displayOrder: 6,
  },
];

// ==================== MAIN SEED FUNCTION ====================

async function seedBrokerAffiliates() {
  const startTime = Date.now();
  const forceFlag = process.argv.includes('--force');

  console.log('='.repeat(70));
  console.log('BROKER AFFILIATES SEEDING');
  console.log('Story 5.7: Broker Affiliates DB Migration');
  console.log('='.repeat(70));
  console.log(`Target: ${BROKER_AFFILIATES.length} Broker Affiliates`);
  console.log(`Force mode: ${forceFlag ? 'YES (will clear existing data)' : 'NO'}\n`);

  try {
    // Check existing data (Idempotency)
    console.log('[1/3] Checking existing data...');
    const existingResult = await db.select({ count: count() }).from(brokerAffiliates);
    const existingCount = Number(existingResult[0]?.count || 0);

    if (existingCount > 0 && !forceFlag) {
      console.log(`\n⚠️  Database already contains ${existingCount} broker affiliates`);
      console.log('Seed script is idempotent - skipping to avoid duplicates');
      console.log('\nTo force re-seed, run: node web/scripts/seed-broker-affiliates.ts --force');
      console.log('This will DELETE all existing broker affiliate data and re-seed.\n');
      await closePool();
      return;
    }

    if (existingCount > 0 && forceFlag) {
      console.log(`\n⚠️  Force mode enabled - clearing ${existingCount} existing broker affiliates`);
      await db.delete(brokerAffiliates);
      console.log('✓ Existing data cleared\n');
    } else {
      console.log('✓ Table is empty, ready for seeding\n');
    }

    // Insert broker affiliates
    console.log('[2/3] Inserting broker affiliates...');
    const now = new Date();

    const brokersWithTimestamps = BROKER_AFFILIATES.map((broker) => ({
      ...broker,
      createdAt: now,
      updatedAt: now,
    }));

    await db.insert(brokerAffiliates).values(brokersWithTimestamps);

    console.log(`✓ Inserted ${BROKER_AFFILIATES.length} broker affiliates\n`);

    // Verify insertion
    console.log('[3/3] Verifying insertion...');
    const finalResult = await db.select({ count: count() }).from(brokerAffiliates);
    const finalCount = Number(finalResult[0]?.count || 0);

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('='.repeat(70));
    console.log('SEEDING COMPLETED SUCCESSFULLY');
    console.log('='.repeat(70));
    console.log('\nFinal Statistics:');
    console.log(`  Total Broker Affiliates: ${finalCount}`);
    console.log(`  Execution Time: ${elapsedTime}s`);
    console.log('\n' + '='.repeat(70));
    console.log('\nBrokers Seeded:');
    BROKER_AFFILIATES.forEach((broker, index) => {
      console.log(`  ${index + 1}. ${broker.brokerName} (Display Order: ${broker.displayOrder})`);
    });
    console.log('\n' + '='.repeat(70));
    console.log('\nNext Steps:');
    console.log('  1. View data: npm run db:studio');
    console.log('  2. Test affiliates page: npm run dev -> http://localhost:3000/affiliates');
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

seedBrokerAffiliates();
