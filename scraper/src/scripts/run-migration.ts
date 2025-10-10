/**
 * Script to run database migrations
 * Story: 7.6b - Infrastructure for Alternative Data Sources
 */

import 'dotenv/config';
import { pool } from '@ipodhan/shared';
import logger from '../utils/logger.js';
import { sql } from 'drizzle-orm';

async function runMigration() {
  const client = await pool.connect();

  try {
    logger.info('Starting database migration for GMP columns');

    // Add GMP columns if they don't exist
    await client.query(`
      ALTER TABLE ipos
        ADD COLUMN IF NOT EXISTS gmp DECIMAL(10, 2),
        ADD COLUMN IF NOT EXISTS gmp_percentage DECIMAL(5, 2),
        ADD COLUMN IF NOT EXISTS gmp_updated_at TIMESTAMP;
    `);

    logger.info('GMP columns added successfully');

    // Create index on gmp_updated_at
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ipos_gmp_updated_at ON ipos(gmp_updated_at);
    `);

    logger.info('Index created successfully');

    // Add comments to columns
    await client.query(`
      COMMENT ON COLUMN ipos.gmp IS 'Grey Market Premium in INR';
    `);

    await client.query(`
      COMMENT ON COLUMN ipos.gmp_percentage IS 'GMP as percentage of issue price';
    `);

    await client.query(`
      COMMENT ON COLUMN ipos.gmp_updated_at IS 'Last time GMP data was updated';
    `);

    logger.info('Column comments added successfully');
    logger.info('Migration completed successfully');

  } catch (error) {
    logger.error('Migration failed', { error });
    throw error;
  } finally {
    client.release();
  }
}

runMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
