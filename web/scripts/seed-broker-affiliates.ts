/**
 * Broker Affiliates Seeding Script
 *
 * Seeds the broker_affiliates table with exactly ONE broker (Zerodha), the
 * only broker IPODhan has a real partner link for (owner decision 2026-09-28,
 * issue #97). The affiliate URL is never hard-coded: it comes only from the
 * required env var ZERODHA_AFFILIATE_URL so the real value never lands in
 * the repo.
 *
 * Idempotent: upserts by brokerName, so re-running updates the URL instead
 * of creating duplicates, and removes any other broker row left over from
 * the old multi-broker seed.
 *
 * Usage:
 *   npm run seed:broker-affiliates          # Dry run - prints what it would write
 *   npm run seed:broker-affiliates -- --apply  # Actually write to the DB
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
import { eq, ne } from 'drizzle-orm';

const BROKER_NAME = 'Zerodha';

function resolveAffiliateUrl(): string {
  const url = process.env.ZERODHA_AFFILIATE_URL;
  if (!url) {
    console.error('ERROR: ZERODHA_AFFILIATE_URL is not set.');
    console.error('Set ZERODHA_AFFILIATE_URL to the real PIFS Zerodha partner link');
    console.error('(in web/.env.local or the environment) before running this script.');
    process.exit(1);
  }
  if (!url.startsWith('https://signup.zerodha.com/')) {
    console.error('ERROR: ZERODHA_AFFILIATE_URL does not look like a Zerodha signup link.');
    console.error(`Expected it to start with "https://signup.zerodha.com/", got: ${url}`);
    process.exit(1);
  }
  return url;
}

async function seedBrokerAffiliates() {
  const startTime = Date.now();
  const apply = process.argv.includes('--apply');

  console.log('='.repeat(70));
  console.log('BROKER AFFILIATES SEEDING (Zerodha only, #97)');
  console.log('='.repeat(70));
  console.log(`Mode: ${apply ? 'APPLY (will write to the database)' : 'DRY RUN (no writes)'}\n`);

  const affiliateUrl = resolveAffiliateUrl();

  // Zerodha's own logo already ships under web/public/logos/; no new asset added.
  const brokerLogo = '/logos/zerodha.svg';

  const zerodhaRow = {
    brokerName: BROKER_NAME,
    brokerLogo,
    affiliateUrl,
    displayText: 'Open Zerodha account',
    active: true,
    displayOrder: 1,
  };

  try {
    console.log('[1/2] Checking existing broker_affiliates rows...');
    const existing = await db.select().from(brokerAffiliates);
    const otherBrokers = existing.filter((row) => row.brokerName !== BROKER_NAME);
    const existingZerodha = existing.find((row) => row.brokerName === BROKER_NAME);

    console.log(`  Found ${existing.length} row(s): ${existingZerodha ? '1 Zerodha' : '0 Zerodha'}, ${otherBrokers.length} other broker(s) to remove`);
    console.log('\nWould write:');
    console.log(`  ${zerodhaRow.brokerName} -> ${zerodhaRow.affiliateUrl} (logo: ${zerodhaRow.brokerLogo})`);
    if (otherBrokers.length > 0) {
      console.log('\nWould remove:');
      otherBrokers.forEach((row) => console.log(`  ${row.brokerName} (${row.affiliateUrl})`));
    }

    if (!apply) {
      console.log('\nDry run complete. Re-run with --apply to write these changes.\n');
      await closePool();
      return;
    }

    console.log('\n[2/2] Applying changes...');
    const now = new Date();

    if (otherBrokers.length > 0) {
      await db.delete(brokerAffiliates).where(ne(brokerAffiliates.brokerName, BROKER_NAME));
      console.log(`✓ Removed ${otherBrokers.length} non-Zerodha row(s)`);
    }

    if (existingZerodha) {
      await db
        .update(brokerAffiliates)
        .set({ ...zerodhaRow, updatedAt: now })
        .where(eq(brokerAffiliates.brokerName, BROKER_NAME));
      console.log('✓ Updated existing Zerodha row');
    } else {
      await db.insert(brokerAffiliates).values({ ...zerodhaRow, createdAt: now, updatedAt: now });
      console.log('✓ Inserted Zerodha row');
    }

    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('='.repeat(70));
    console.log('SEEDING COMPLETED SUCCESSFULLY');
    console.log(`Execution Time: ${elapsedTime}s`);
    console.log('='.repeat(70));
  } catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('SEEDING FAILED');
    console.error('='.repeat(70));
    console.error('\nError details:');
    console.error(error);
    console.error('');
    process.exit(1);
  } finally {
    await closePool();
  }
}

seedBrokerAffiliates();
