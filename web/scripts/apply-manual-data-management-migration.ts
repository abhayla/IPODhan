#!/usr/bin/env tsx

/**
 * Script to apply manual data management migration (0017)
 * Adds field_protection_metadata table and IPO-level lock columns
 */

import { getDb } from '../lib/db/index.js';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';

async function applyMigration() {
  console.log('🚀 Applying Manual Data Management migration...\n');

  try {
    const db = await getDb();

    // Read the migration SQL file
    const migrationPath = path.join(
      process.cwd(),
      'drizzle',
      'migrations',
      '0017_add_manual_data_management.sql'
    );

    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    console.log('📄 Migration file loaded successfully');
    console.log('📝 Executing migration...\n');

    // Execute the migration
    await db.execute(sql.raw(migrationSQL));

    console.log('✅ Migration applied successfully!\n');
    console.log('Added:');
    console.log('  - field_protection_metadata table');
    console.log('  - ipos.scraper_locked column');
    console.log('  - ipos.scraper_lock_note column');
    console.log('  - ipos.last_manual_edit_at column');
    console.log('\n🎉 Manual Data Management system database schema is ready!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);

    // Check if it's a "column already exists" error (migration already applied)
    if (error instanceof Error && error.message.includes('already exists')) {
      console.log('\n⚠️  Migration appears to be already applied. Skipping...');
      process.exit(0);
    }

    process.exit(1);
  }
}

applyMigration();
