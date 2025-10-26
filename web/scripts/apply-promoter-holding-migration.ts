/**
 * Script to apply promoter holding migration
 * Story 11.9
 */

import { db } from '../lib/db/index.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

async function applyMigration() {
  console.log('Applying promoter holding migration...');

  try {
    // Read the migration SQL file
    const migrationPath = path.join(process.cwd(), 'drizzle', 'migrations', '0021_add_promoter_holding_fields.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    // Execute the SQL
    await db.execute(sql.raw(migrationSQL));

    console.log('✓ Migration applied successfully!');

    // Verify the columns were added
    const result = await db.execute(sql`
      SELECT column_name, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_name = 'financial_data'
      AND column_name IN ('promoter_holding_pre_issue', 'promoter_holding_post_issue')
      ORDER BY column_name;
    `);

    console.log('\n✓ Verification:');
    console.log(result.rows);

  } catch (error) {
    console.error('✗ Migration failed:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

applyMigration();
