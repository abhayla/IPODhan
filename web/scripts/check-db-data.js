// Quick script to check database data counts
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const { sql } = require('drizzle-orm');
require('dotenv/config');

async function checkDatabaseData() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool);

  try {
    console.log('📊 Checking database data...\n');

    // Check all tables
    const tables = [
      'ipos',
      'subscriptions',
      'gmp_records',
      'financial_data',
      'documents',
      'listing_performance',
      'market_holidays',
      'registrars',
      'peer_companies',
      'broker_affiliates',
      'affiliate_clicks',
      'scraper_logs',
    ];

    for (const table of tables) {
      try {
        const result = await db.execute(sql.raw(`SELECT COUNT(*) as count FROM ${table}`));
        const count = result.rows[0]?.count || 0;
        console.log(`${table.padEnd(25)} : ${count} records`);
      } catch (error) {
        console.log(`${table.padEnd(25)} : ERROR - ${error.message}`);
      }
    }

    // Check IPO status distribution
    console.log('\n📈 IPO Status Distribution:');
    try {
      const statusResult = await db.execute(sql.raw(`
        SELECT status, COUNT(*) as count
        FROM ipos
        GROUP BY status
        ORDER BY count DESC
      `));
      statusResult.rows.forEach(row => {
        console.log(`  ${row.status?.padEnd(15)} : ${row.count} IPOs`);
      });
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
    }

    // Check IPO category distribution
    console.log('\n📊 IPO Category Distribution:');
    try {
      const categoryResult = await db.execute(sql.raw(`
        SELECT category, COUNT(*) as count
        FROM ipos
        GROUP BY category
        ORDER BY count DESC
      `));
      categoryResult.rows.forEach(row => {
        console.log(`  ${row.category?.padEnd(15)} : ${row.count} IPOs`);
      });
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkDatabaseData().catch(console.error);
