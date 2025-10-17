/**
 * List Database Tables
 * Story 10.5: Discover what tables exist
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { Pool } from 'pg';

const envPath = resolve(__dirname, '../.env.local');
config({ path: envPath });

const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  connectionTimeoutMillis: 5000,
});

async function listTables() {
  try {
    console.log('='.repeat(70));
    console.log('DATABASE TABLES LIST');
    console.log('='.repeat(70));
    console.log('');

    const result = await pool.query(`
      SELECT table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    console.log('TABLES IN PUBLIC SCHEMA:');
    console.log('-'.repeat(50));
    for (const row of result.rows) {
      console.log(`${row.table_name.padEnd(40)} ${row.table_type}`);
    }
    console.log('-'.repeat(50));
    console.log(`Total: ${result.rows.length} tables\n`);

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await pool.end();
    process.exit(1);
  }
}

listTables();
