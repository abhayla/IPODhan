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
 * Prod guard: `--apply` is refused when the connection's own
 * `current_database()` (never an env var) is `ipodhan`, unless `--allow-prod`
 * is also passed (`decideProdWriteRefusal`, web/scripts/lib/prod-write-guard.ts,
 * ported from scraper/scripts/lib/repair-tool.ts — see that file's header for
 * why it is a small duplicated port rather than a cross-package import).
 *
 * Ledger: before any delete/update, the full prior `broker_affiliates` rows
 * are written to a timestamped JSON file (default under
 * web/scripts/state/, override with --ledger-dir=<path>; that directory is
 * gitignored, so a ledger is never committed).
 *
 * Usage:
 *   npm run seed:broker-affiliates                          # Dry run - prints what it would write
 *   npm run seed:broker-affiliates -- --apply                # Write (refused against prod)
 *   npm run seed:broker-affiliates -- --apply --allow-prod   # Write against prod, on purpose
 *   npm run seed:broker-affiliates -- --apply --ledger-dir=./tmp-ledgers
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
import { eq, ne, sql } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { decideProdWriteRefusal } from './lib/prod-write-guard';
import { getRedisClient } from '../lib/cache/redis-client';
import { BrokerAffiliateRepository } from '../lib/repositories/broker-affiliate-repository';

const BROKER_NAME = 'Zerodha';
const TOOL_NAME = 'seed-broker-affiliates';

function parseFlagValue(flag: string): string | null {
  const withEquals = process.argv.find((a) => a.startsWith(`--${flag}=`));
  if (withEquals) return withEquals.slice(`--${flag}=`.length);
  return null;
}

/** Writes the full prior rows to a JSON ledger BEFORE any delete/update. */
function writeLedgerFile(rows: unknown[]): string {
  const ledgerDir = parseFlagValue('ledger-dir') ?? path.resolve(__dirname, 'state');
  fs.mkdirSync(ledgerDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(ledgerDir, `broker-affiliates-${stamp}.json`);
  fs.writeFileSync(
    filePath,
    JSON.stringify({ tool: TOOL_NAME, writtenAt: new Date().toISOString(), priorRows: rows }, null, 1)
  );
  return filePath;
}

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
  const allowProd = process.argv.includes('--allow-prod');

  console.log('='.repeat(70));
  console.log('BROKER AFFILIATES SEEDING (Zerodha only, #97)');
  console.log('='.repeat(70));
  console.log(`Mode: ${apply ? 'APPLY (will write to the database)' : 'DRY RUN (no writes)'}\n`);

  // The SAME connection that will do the writing, asked what it actually is
  // — never trusted from DATABASE_URL/DATABASE_NAME (signal-ownership R6:
  // the env can say "staging" while the socket is on prod).
  const dbNameResult = await db.execute(sql`SELECT current_database() AS name`);
  const dbNameRows = Array.isArray(dbNameResult)
    ? dbNameResult
    : ((dbNameResult as unknown as { rows?: { name: string }[] })?.rows ?? []);
  const dbName = (dbNameRows[0] as { name?: string } | undefined)?.name ?? '';
  console.log(`current_database(): ${dbName}`);

  const refusal = decideProdWriteRefusal({ apply, dbName, allowProd, toolName: TOOL_NAME });
  if (refusal.refuse) {
    console.error(`\nERROR: ${refusal.reason}`);
    await closePool();
    process.exit(1);
  }

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

    if (existing.length > 0) {
      const ledgerPath = writeLedgerFile(existing);
      console.log(`✓ Wrote ledger of ${existing.length} prior row(s) to ${ledgerPath}`);
    }

    await db.transaction(async (tx) => {
      if (otherBrokers.length > 0) {
        await tx.delete(brokerAffiliates).where(ne(brokerAffiliates.brokerName, BROKER_NAME));
        console.log(`✓ Removed ${otherBrokers.length} non-Zerodha row(s)`);
      }

      if (existingZerodha) {
        await tx
          .update(brokerAffiliates)
          .set({ ...zerodhaRow, updatedAt: now })
          .where(eq(brokerAffiliates.brokerName, BROKER_NAME));
        console.log('✓ Updated existing Zerodha row');
      } else {
        await tx.insert(brokerAffiliates).values({ ...zerodhaRow, createdAt: now, updatedAt: now });
        console.log('✓ Inserted Zerodha row');
      }
    });

    // Drop the exact cache key the repository owns (never a DEL pattern) so the
    // next /affiliates read is not served a stale pre-seed list from Redis.
    try {
      const redis = getRedisClient();
      await redis.del(BrokerAffiliateRepository.ACTIVE_CACHE_KEY);
      console.log(`✓ Dropped cache key ${BrokerAffiliateRepository.ACTIVE_CACHE_KEY}`);
    } catch (cacheError) {
      console.warn(
        `WARNING: could not drop cache key ${BrokerAffiliateRepository.ACTIVE_CACHE_KEY} ` +
          `(Redis unreachable) — it will expire on its own in 30 minutes (TTL). Cause:`,
        cacheError
      );
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
