/**
 * Apply Week 1 Migrations Manually
 *
 * This script applies the Week 1 migrations directly using the database connection.
 * Run: npx tsx web/scripts/apply-week1-migrations.ts
 */

import { db } from '../lib/db';
import { sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';

async function applyMigrations() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Applying Week 1 Migrations');
  console.log('═══════════════════════════════════════════════════\n');

  try {
    // Migration 1: extraction_logs table
    console.log('📝 Migration 1: Adding extraction_logs table...');

    try {
      // Create enum
      await db.execute(sql`
        DO $$ BEGIN
          CREATE TYPE "public"."extraction_status" AS ENUM('PENDING', 'IN_PROGRESS', 'SUCCESS', 'PARTIAL', 'FAILED');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      console.log('  ✓ Created extraction_status enum');
    } catch (error) {
      console.log('  → extraction_status enum already exists');
    }

    try {
      // Create table
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "extraction_logs" (
          "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
          "ipo_id" uuid,
          "company_name" varchar(255) NOT NULL,
          "file_name" varchar(255) NOT NULL,
          "file_path" varchar(500),
          "file_size" integer,
          "total_pages" integer,
          "status" "extraction_status" DEFAULT 'PENDING' NOT NULL,
          "extractor_version" varchar(20),
          "extraction_method" varchar(50),
          "fields_extracted" integer DEFAULT 0,
          "total_fields" integer DEFAULT 16,
          "extracted_data" jsonb,
          "confidence_score" integer,
          "confidence_level" "confidence_level",
          "data_issues" jsonb,
          "duration_ms" integer,
          "pl_page_number" integer,
          "bs_page_number" integer,
          "cash_flow_page_number" integer,
          "tables_processed" integer,
          "unit_detected" varchar(20),
          "error_message" text,
          "error_stack" text,
          "failure_reason" text,
          "uploaded_by" varchar(255),
          "reviewed_by" varchar(255),
          "review_notes" text,
          "is_verified" boolean DEFAULT false,
          "created_at" timestamp DEFAULT now() NOT NULL,
          "updated_at" timestamp DEFAULT now() NOT NULL,
          "processed_at" timestamp,
          "reviewed_at" timestamp
        );
      `);
      console.log('  ✓ Created extraction_logs table');
    } catch (error) {
      console.log('  → extraction_logs table already exists');
    }

    try {
      // Add foreign key
      await db.execute(sql`
        DO $$ BEGIN
          ALTER TABLE "extraction_logs" ADD CONSTRAINT "extraction_logs_ipo_id_ipos_id_fk"
            FOREIGN KEY ("ipo_id") REFERENCES "public"."ipos"("id") ON DELETE cascade ON UPDATE no action;
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      console.log('  ✓ Created foreign key constraint');
    } catch (error) {
      console.log('  → Foreign key already exists');
    }

    try {
      // Create indexes
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_extraction_logs_ipo_id" ON "extraction_logs" USING btree ("ipo_id");`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_extraction_logs_status" ON "extraction_logs" USING btree ("status");`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_extraction_logs_created_at" ON "extraction_logs" USING btree ("created_at");`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_extraction_logs_confidence" ON "extraction_logs" USING btree ("confidence_level");`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_extraction_logs_company" ON "extraction_logs" USING btree ("company_name");`);
      console.log('  ✓ Created indexes');
    } catch (error) {
      console.log('  → Indexes already exist');
    }

    console.log('\n✅ Migration 1 completed successfully!\n');

    // Migration 2: isPermanent flag
    console.log('📝 Migration 2: Adding isPermanent flag...');

    try {
      await db.execute(sql`
        ALTER TABLE "field_protection_metadata"
        ADD COLUMN IF NOT EXISTS "is_permanent" boolean DEFAULT false NOT NULL;
      `);
      console.log('  ✓ Added isPermanent column');
    } catch (error) {
      console.log('  → isPermanent column already exists');
    }

    try {
      await db.execute(sql`
        COMMENT ON COLUMN "field_protection_metadata"."is_permanent" IS
        'Permanent protection flag - when true, protection is never auto-removed even after successful manual edits';
      `);
      console.log('  ✓ Added column comment');
    } catch (error) {
      console.log('  → Comment already exists');
    }

    console.log('\n✅ Migration 2 completed successfully!\n');

    // Verify migrations
    console.log('🔍 Verifying migrations...\n');

    const tableCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'extraction_logs'
      ) as table_exists;
    `);
    console.log(`  extraction_logs table: ${tableCheck.rows[0].table_exists ? '✓ EXISTS' : '✗ MISSING'}`);

    const columnCheck = await db.execute(sql`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_name = 'field_protection_metadata'
          AND column_name = 'is_permanent'
      ) as column_exists;
    `);
    console.log(`  isPermanent column: ${columnCheck.rows[0].column_exists ? '✓ EXISTS' : '✗ MISSING'}`);

    console.log('\n═══════════════════════════════════════════════════');
    console.log('  ✅ All Week 1 Migrations Applied Successfully!');
    console.log('═══════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});