-- Migration: Add Manual Data Management System (Phase 6)
-- Features: Field-level protection, IPO-level lock, auto-lock on edit
-- Date: 2025-10-22

-- Add IPO-level protection columns to ipos table
ALTER TABLE "ipos"
  ADD COLUMN "scraper_locked" boolean DEFAULT false,
  ADD COLUMN "scraper_lock_note" text,
  ADD COLUMN "last_manual_edit_at" timestamp;

-- Create field_protection_metadata table for field-level protection
CREATE TABLE IF NOT EXISTS "field_protection_metadata" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "table_name" varchar(100) NOT NULL,
  "field_name" varchar(100) NOT NULL,
  "ipo_id" uuid NOT NULL,
  "is_protected" boolean DEFAULT false NOT NULL,
  "auto_protected" boolean DEFAULT false NOT NULL,
  "manually_edited_at" timestamp,
  "manually_edited_by" varchar(255),
  "edit_note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "field_protection_metadata_ipo_id_ipos_id_fk"
    FOREIGN KEY ("ipo_id") REFERENCES "ipos"("id") ON DELETE cascade ON UPDATE no action
);

-- Create indexes for field_protection_metadata
CREATE INDEX IF NOT EXISTS "idx_field_protection_ipo_id" ON "field_protection_metadata" ("ipo_id");
CREATE INDEX IF NOT EXISTS "idx_field_protection_table_name" ON "field_protection_metadata" ("table_name");
CREATE INDEX IF NOT EXISTS "idx_field_protection_is_protected" ON "field_protection_metadata" ("is_protected");

-- Create unique constraint: one protection record per (table + field + IPO)
ALTER TABLE "field_protection_metadata"
  ADD CONSTRAINT "unique_field_per_ipo"
  UNIQUE ("table_name", "field_name", "ipo_id");

-- Comments for documentation
COMMENT ON TABLE "field_protection_metadata" IS 'Stores field-level protection flags to prevent scraper overwrites on manually edited data';
COMMENT ON COLUMN "ipos"."scraper_locked" IS 'Master lock - prevents all scraper updates to this IPO when true';
COMMENT ON COLUMN "ipos"."scraper_lock_note" IS 'Admin note explaining why IPO is locked from scraper updates';
COMMENT ON COLUMN "ipos"."last_manual_edit_at" IS 'Timestamp of last manual edit by admin on any field of this IPO';
COMMENT ON COLUMN "field_protection_metadata"."is_protected" IS 'When true, scraper cannot overwrite this field';
COMMENT ON COLUMN "field_protection_metadata"."auto_protected" IS 'When true, protection was automatically enabled after manual edit';
