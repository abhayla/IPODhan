import pg from 'pg';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config({ path: '.env.local' });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function applyMigration0006() {
  const client = await pool.connect();

  try {
    console.log('Applying migration 0006: FPO category and separate BSE/NSE prices...\n');

    // Check if FPO already exists
    const checkFPO = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'ipo_category' AND e.enumlabel = 'FPO'
      ) as exists
    `);

    if (!checkFPO.rows[0].exists) {
      console.log('Adding FPO to ipo_category enum...');
      await client.query(`ALTER TYPE "public"."ipo_category" ADD VALUE 'FPO'`);
      console.log('✅ FPO added to enum');
    } else {
      console.log('⚠️  FPO already exists in enum');
    }

    // Check if columns exist
    const checkColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'listing_performance'
      AND column_name IN ('current_price_bse', 'current_price_nse')
    `);

    const existingColumns = checkColumns.rows.map(r => r.column_name);

    if (!existingColumns.includes('current_price_bse')) {
      console.log('\nAdding current_price_bse column...');
      await client.query(`ALTER TABLE "listing_performance" ADD COLUMN "current_price_bse" integer`);
      console.log('✅ current_price_bse column added');
    } else {
      console.log('\n⚠️  current_price_bse already exists');
    }

    if (!existingColumns.includes('current_price_nse')) {
      console.log('Adding current_price_nse column...');
      await client.query(`ALTER TABLE "listing_performance" ADD COLUMN "current_price_nse" integer`);
      console.log('✅ current_price_nse column added');
    } else {
      console.log('⚠️  current_price_nse already exists');
    }

    // Migrate existing data
    console.log('\nMigrating existing data...');
    const result = await client.query(`
      UPDATE "listing_performance"
      SET
        "current_price_bse" = "current_price",
        "current_price_nse" = "current_price"
      WHERE "current_price" IS NOT NULL
        AND ("current_price_bse" IS NULL OR "current_price_nse" IS NULL)
    `);
    console.log(`✅ Migrated ${result.rowCount} rows`);

    // Add comments
    console.log('\nAdding column comments...');
    await client.query(`COMMENT ON COLUMN "listing_performance"."current_price_bse" IS 'Current trading price at BSE'`);
    await client.query(`COMMENT ON COLUMN "listing_performance"."current_price_nse" IS 'Current trading price at NSE'`);
    await client.query(`COMMENT ON COLUMN "listing_performance"."current_price" IS 'Deprecated: Use current_price_bse or current_price_nse. Kept for backward compatibility.'`);
    console.log('✅ Column comments added');

    console.log('\n✅ Migration 0006 completed successfully!');

  } catch (err) {
    console.error('\n❌ Migration failed:', err instanceof Error ? err.message : err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigration0006();
