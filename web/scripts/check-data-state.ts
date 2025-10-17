/**
 * Quick Database Data State Check
 * Story 10.5: Check current data population
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

// Load env FIRST before any other imports
const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

// Create direct pool connection
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  connectionTimeoutMillis: 5000,
});

async function checkDataState() {
  console.log('='.repeat(70));
  console.log('DATABASE DATA STATE CHECK');
  console.log('Story 10.5: Populate Missing IPO Data');
  console.log('='.repeat(70));
  console.log('');

  try {
    console.log('✓ Database connection successful\n');

    // Query all table counts
    console.log('Checking table counts...\n');

    const results = await pool.query(`
      SELECT
        'ipos' as table_name,
        COUNT(*) as record_count
      FROM ipos
      UNION ALL
      SELECT
        'ipo_financials' as table_name,
        COUNT(*) as record_count
      FROM ipo_financials
      UNION ALL
      SELECT
        'financial_data' as table_name,
        COUNT(*) as record_count
      FROM financial_data
      UNION ALL
      SELECT
        'subscriptions' as table_name,
        COUNT(*) as record_count
      FROM subscriptions
      UNION ALL
      SELECT
        'subscription_data' as table_name,
        COUNT(*) as record_count
      FROM subscription_data
      UNION ALL
      SELECT
        'gmp_records' as table_name,
        COUNT(*) as record_count
      FROM gmp_records
      UNION ALL
      SELECT
        'gmp_tracking' as table_name,
        COUNT(*) as record_count
      FROM gmp_tracking
      UNION ALL
      SELECT
        'gmp_history' as table_name,
        COUNT(*) as record_count
      FROM gmp_history
      UNION ALL
      SELECT
        'scraper_logs' as table_name,
        COUNT(*) as record_count
      FROM scraper_logs
      UNION ALL
      SELECT
        'listing_performance' as table_name,
        COUNT(*) as record_count
      FROM listing_performance
      UNION ALL
      SELECT
        'ipo_reviews' as table_name,
        COUNT(*) as record_count
      FROM ipo_reviews
      ORDER BY table_name;
    `);

    console.log('TABLE COUNTS:');
    console.log('-'.repeat(50));
    for (const row of results.rows) {
      const r = row as { table_name: string; record_count: string };
      console.log(`${r.table_name.padEnd(30)} ${r.record_count.padStart(10)}`);
    }
    console.log('-'.repeat(50));
    console.log('');

    // Check IPO data with embedded GMP/subscription
    const ipoSample = await pool.query(`
      SELECT
        id,
        company_name,
        slug,
        status,
        category,
        CASE WHEN gmp_price IS NOT NULL THEN 'YES' ELSE 'NO' END as has_gmp_embedded,
        CASE WHEN subscription_total IS NOT NULL THEN 'YES' ELSE 'NO' END as has_subscription_embedded,
        gmp_price,
        subscription_total
      FROM ipos
      ORDER BY created_at DESC
      LIMIT 5
    `);

    console.log('SAMPLE IPO RECORDS (Latest 5):');
    console.log('-'.repeat(70));
    for (const row of ipoSample.rows) {
      const r = row as any;
      console.log(`${r.company_name} (${r.slug})`);
      console.log(`  Status: ${r.status} | Category: ${r.category}`);
      console.log(`  GMP Embedded: ${r.has_gmp_embedded} (${r.gmp_price || 'NULL'})`);
      console.log(`  Subscription Embedded: ${r.has_subscription_embedded} (${r.subscription_total || 'NULL'})`);
      console.log('');
    }
    console.log('-'.repeat(70));
    console.log('');

    // Summary
    const totals = results.rows.reduce((acc, row) => {
      const r = row as { table_name: string; record_count: string };
      acc[r.table_name] = parseInt(r.record_count);
      return acc;
    }, {} as Record<string, number>);

    console.log('SUMMARY:');
    console.log('-'.repeat(50));
    console.log(`Total IPOs: ${totals['ipos'] || 0}`);
    console.log(`IPOs with financials (ipo_financials): ${totals['ipo_financials'] || 0}`);
    console.log(`IPOs with financials (financial_data): ${totals['financial_data'] || 0}`);
    console.log(`Subscription records (subscriptions): ${totals['subscriptions'] || 0}`);
    console.log(`Subscription records (subscription_data): ${totals['subscription_data'] || 0}`);
    console.log(`GMP records (gmp_records): ${totals['gmp_records'] || 0}`);
    console.log(`GMP records (gmp_tracking): ${totals['gmp_tracking'] || 0}`);
    console.log(`GMP records (gmp_history): ${totals['gmp_history'] || 0}`);
    console.log(`Scraper logs: ${totals['scraper_logs'] || 0}`);
    console.log('-'.repeat(50));
    console.log('');

    // Recommendations
    console.log('RECOMMENDATIONS:');
    console.log('-'.repeat(50));
    if (totals['ipos'] === 0) {
      console.log('⚠️  No IPOs found! Run: npm run seed:database');
    } else if (totals['ipos'] < 50) {
      console.log('⚠️  Few IPOs found. Consider running: npm run scrape:historical');
    } else {
      console.log('✓ IPO data populated');
    }

    if (totals['ipo_financials'] === 0 && totals['financial_data'] === 0) {
      console.log('⚠️  No financial data! Run: npm run seed:database (no scraper exists)');
    } else {
      console.log('✓ Financial data populated');
    }

    const totalSubscriptions = (totals['subscriptions'] || 0) + (totals['subscription_data'] || 0);
    if (totalSubscriptions === 0) {
      console.log('⚠️  No subscription data! Run scrapers: cd scraper && npm run start:all');
    } else {
      console.log('✓ Subscription data populated');
    }

    const totalGMP = (totals['gmp_records'] || 0) + (totals['gmp_tracking'] || 0) + (totals['gmp_history'] || 0);
    if (totalGMP === 0) {
      console.log('ℹ️  No GMP records in GMP tables (check ipos table for embedded GMP data)');
    } else {
      console.log('✓ GMP records populated');
    }
    console.log('-'.repeat(50));
    console.log('');

    process.exit(0);

  } catch (error) {
    console.error('\n❌ Database check failed:');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDataState();
