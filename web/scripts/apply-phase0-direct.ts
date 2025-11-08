#!/usr/bin/env tsx
/**
 * Direct Phase 0 Migration - Non-Interactive
 * Applies schema changes directly without Drizzle prompts
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { join } from 'path';

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
    await client.connect();
    console.log('✅ Connected to database\n');

    // STEP 1: Create scraper_source enum
    console.log('📝 Step 1: Creating scraper_source enum...');
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'scraper_source') THEN
          CREATE TYPE scraper_source AS ENUM (
            'ADMIN',
            'DRHP',
            'NSE',
            'BSE',
            'API_FALLBACK',
            'MONEYCONTROL',
            'CHITTORGARH'
          );
          RAISE NOTICE 'Created scraper_source enum';
        ELSE
          -- Enum exists, add missing values
          IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ADMIN' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')) THEN
            ALTER TYPE scraper_source ADD VALUE 'ADMIN';
            RAISE NOTICE 'Added ADMIN to scraper_source enum';
          END IF;

          IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DRHP' AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')) THEN
            ALTER TYPE scraper_source ADD VALUE 'DRHP';
            RAISE NOTICE 'Added DRHP to scraper_source enum';
          END IF;
        END IF;
      END $$;
    `);
    console.log('✅ scraper_source enum ready\n');

    // STEP 2: Add extraction fields to documents table
    console.log('📝 Step 2: Adding extraction fields to documents table...');
    await client.query(`
      ALTER TABLE documents
      ADD COLUMN IF NOT EXISTS extraction_status VARCHAR(50) DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS extraction_confidence NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS extraction_error TEXT,
      ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0 NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_documents_extraction_status ON documents(extraction_status);
    `);
    console.log('✅ Documents table updated\n');

    // STEP 3: Create field_sources table
    console.log('📝 Step 3: Creating field_sources table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS field_sources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
        table_name VARCHAR(100) NOT NULL,
        field_name VARCHAR(100) NOT NULL,
        source scraper_source NOT NULL,
        confidence INTEGER DEFAULT 100 NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
        previous_value TEXT,
        previous_source scraper_source,
        data_lineage JSONB,
        updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW() NOT NULL,
        CONSTRAINT unique_field_source_per_ipo UNIQUE(ipo_id, table_name, field_name)
      );

      CREATE INDEX IF NOT EXISTS idx_field_sources_ipo_id ON field_sources(ipo_id);
      CREATE INDEX IF NOT EXISTS idx_field_sources_table_name ON field_sources(table_name);
      CREATE INDEX IF NOT EXISTS idx_field_sources_field_name ON field_sources(field_name);
      CREATE INDEX IF NOT EXISTS idx_field_sources_source ON field_sources(source);
      CREATE INDEX IF NOT EXISTS idx_field_sources_ipo_table_field ON field_sources(ipo_id, table_name, field_name);
    `);
    console.log('✅ field_sources table created\n');

    // STEP 4: Create data_conflicts table
    console.log('📝 Step 4: Creating data_conflicts table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS data_conflicts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ipo_id UUID NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
        table_name VARCHAR(100) NOT NULL,
        field_name VARCHAR(100) NOT NULL,
        source1 scraper_source NOT NULL,
        value1 TEXT,
        source2 scraper_source NOT NULL,
        value2 TEXT,
        resolved_source scraper_source,
        resolution_reason VARCHAR(100),
        severity VARCHAR(20) DEFAULT 'INFO' NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
        admin_note TEXT,
        resolved_at TIMESTAMP,
        resolved_by VARCHAR(255),
        detected_at TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at TIMESTAMP DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_data_conflicts_ipo_id ON data_conflicts(ipo_id);
      CREATE INDEX IF NOT EXISTS idx_data_conflicts_field_name ON data_conflicts(field_name);
      CREATE INDEX IF NOT EXISTS idx_data_conflicts_severity ON data_conflicts(severity);
      CREATE INDEX IF NOT EXISTS idx_data_conflicts_detected_at ON data_conflicts(detected_at DESC);
      CREATE INDEX IF NOT EXISTS idx_data_conflicts_unresolved ON data_conflicts(resolved_at) WHERE resolved_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_data_conflicts_ipo_unresolved ON data_conflicts(ipo_id, resolved_at);
    `);
    console.log('✅ data_conflicts table created\n');

    // VERIFICATION
    console.log('🔍 Verification:');

    const enumCheck = await client.query(`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = (SELECT oid FROM pg_type WHERE typname = 'scraper_source')
      ORDER BY enumsortorder;
    `);
    console.log(`  ✓ scraper_source values: ${enumCheck.rows.map(r => r.enumlabel).join(', ')}`);

    const docsCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'documents' AND column_name LIKE 'extraction%'
      ORDER BY ordinal_position;
    `);
    console.log(`  ✓ documents extraction columns: ${docsCheck.rows.map(r => r.column_name).join(', ')}`);

    const tablesCheck = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('field_sources', 'data_conflicts')
      ORDER BY table_name;
    `);
    console.log(`  ✓ New tables: ${tablesCheck.rows.map(r => r.table_name).join(', ')}`);

    const indexesCheck = await client.query(`
      SELECT COUNT(*) as count FROM pg_indexes
      WHERE tablename IN ('field_sources', 'data_conflicts');
    `);
    console.log(`  ✓ Indexes created: ${indexesCheck.rows[0].count}\n`);

    console.log('🎉 Phase 0 Database Migration Complete!');
    console.log('\n📋 What Changed:');
    console.log('  1. Created scraper_source enum (ADMIN, DRHP, NSE, BSE, etc.)');
    console.log('  2. Added extraction tracking to documents table (5 columns)');
    console.log('  3. Created field_sources table for audit trail');
    console.log('  4. Created data_conflicts table for conflict logging');
    console.log('\n🚀 Next Steps:');
    console.log('  - Create FieldSourcesRepository');
    console.log('  - Create DataConflictsRepository');
    console.log('  - Implement data consolidation service');
    console.log('  - Build admin conflict dashboard');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    console.error('\nTroubleshooting:');
    console.error('  1. Check database credentials in .env.local');
    console.error('  2. Ensure PostgreSQL is running');
    console.error('  3. Verify database "ipodhan" exists');
    process.exit(1);
  } finally {
    await client.end();
  }
}

applyMigration();
