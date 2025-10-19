/**
 * Apply migration script for Story 11.8
 * Adds document table enhancements for multi-format document support
 */

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/index.js';

async function applyMigration() {
  console.log('Starting migration 0014_add_document_fields...');

  try {
    // Add BASIS_OF_ALLOTMENT enum value
    console.log('1. Adding BASIS_OF_ALLOTMENT to document_type enum...');
    await db.execute(sql`
      ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'BASIS_OF_ALLOTMENT'
    `);

    // Add new columns
    console.log('2. Adding media_type column...');
    await db.execute(sql`
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "media_type" varchar(20) DEFAULT 'PDF' NOT NULL
    `);

    console.log('3. Adding sequence_number column...');
    await db.execute(sql`
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sequence_number" integer DEFAULT 1 NOT NULL
    `);

    console.log('4. Adding is_active column...');
    await db.execute(sql`
      ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL
    `);

    // Drop old url unique constraint if exists
    console.log('5. Dropping old url unique constraint...');
    await db.execute(sql`
      ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_url_unique"
    `);

    // Add composite unique constraint
    console.log('6. Adding composite unique constraint...');
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'unique_doc_per_ipo'
        ) THEN
          ALTER TABLE "documents" ADD CONSTRAINT "unique_doc_per_ipo"
            UNIQUE("ipo_id","type","media_type","exchange","sequence_number");
        END IF;
      END $$
    `);

    // Re-add url unique constraint
    console.log('7. Re-adding url unique constraint...');
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'unique_url'
        ) THEN
          ALTER TABLE "documents" ADD CONSTRAINT "unique_url" UNIQUE("url");
        END IF;
      END $$
    `);

    console.log('✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
