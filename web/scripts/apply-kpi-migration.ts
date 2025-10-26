/**
 * Apply KPI Fields Migration
 * Story 11.11: Add market_cap, pre_ipo_eps, post_ipo_eps, ronw to financial_data
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

async function applyMigration() {
  const pool = new Pool({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
  });

  try {
    console.log('🔄 Applying KPI fields migration...');

    const result = await pool.query(`
      ALTER TABLE "financial_data"
      ADD COLUMN IF NOT EXISTS "market_cap" numeric(15, 2),
      ADD COLUMN IF NOT EXISTS "pre_ipo_eps" numeric(10, 2),
      ADD COLUMN IF NOT EXISTS "post_ipo_eps" numeric(10, 2),
      ADD COLUMN IF NOT EXISTS "ronw" numeric(5, 2);
    `);

    console.log('✅ Migration applied successfully!');

    // Verify the columns exist
    const verification = await pool.query(`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'financial_data'
      AND column_name IN ('market_cap', 'pre_ipo_eps', 'post_ipo_eps', 'ronw')
      ORDER BY column_name;
    `);

    console.log('\n📊 Verification - New columns:');
    verification.rows.forEach((row) => {
      console.log(
        `  ${row.column_name}: ${row.data_type}(${row.numeric_precision},${row.numeric_scale})`
      );
    });

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

applyMigration();
