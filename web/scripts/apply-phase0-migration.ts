#!/usr/bin/env tsx
/**
 * Apply Phase 0 Data Flow Architecture Migration
 * Manually applies the migration using existing database credentials
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: join(__dirname, '../.env.local') });

async function applyMigration() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'ipodhan',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully');

    // Read migration SQL
    const migrationPath = join(__dirname, '../drizzle/migrations/0027_data_flow_architecture_phase0.sql');
    const sql = readFileSync(migrationPath, 'utf-8');

    console.log('\n📄 Applying Phase 0 migration...');
    console.log('Migration file: 0027_data_flow_architecture_phase0.sql');
    console.log('Changes:');
    console.log('  - Enhance scraper_source enum (add ADMIN, DRHP)');
    console.log('  - Add extraction tracking to documents table');
    console.log('  - Create field_sources table');
    console.log('  - Create data_conflicts table');
    console.log('');

    // Execute migration
    await client.query(sql);

    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('📊 Verification:');

    // Verify enum values
    const enumResult = await client.query(`
      SELECT enumlabel
      FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')
      ORDER BY enumsortorder;
    `);
    console.log('  ✓ scraper_source enum values:', enumResult.rows.map(r => r.enumlabel).join(', '));

    // Verify documents table columns
    const docsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name LIKE 'extraction%'
      ORDER BY ordinal_position;
    `);
    console.log('  ✓ documents extraction columns:', docsResult.rows.map(r => r.column_name).join(', '));

    // Verify new tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name IN ('field_sources', 'data_conflicts')
      ORDER BY table_name;
    `);
    console.log('  ✓ New tables created:', tablesResult.rows.map(r => r.table_name).join(', '));

    // Count indexes
    const indexesResult = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_indexes
      WHERE tablename IN ('field_sources', 'data_conflicts');
    `);
    console.log(`  ✓ Indexes created: ${indexesResult.rows[0].count} total`);

    console.log('');
    console.log('🎉 Phase 0 foundation complete!');
    console.log('Next steps:');
    console.log('  1. Create FieldSourcesRepository');
    console.log('  2. Create DataConflictsRepository');
    console.log('  3. Implement data consolidation service');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
