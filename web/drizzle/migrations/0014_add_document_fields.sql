-- Add BASIS_OF_ALLOTMENT enum value
ALTER TYPE "public"."document_type" ADD VALUE IF NOT EXISTS 'BASIS_OF_ALLOTMENT';

-- Add new columns to documents table
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "media_type" varchar(20) DEFAULT 'PDF' NOT NULL;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sequence_number" integer DEFAULT 1 NOT NULL;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;

-- Drop old url unique constraint if exists
ALTER TABLE "documents" DROP CONSTRAINT IF EXISTS "documents_url_unique";

-- Add composite unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_doc_per_ipo'
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "unique_doc_per_ipo" UNIQUE("ipo_id","type","media_type","exchange","sequence_number");
  END IF;
END $$;

-- Re-add url unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_url'
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "unique_url" UNIQUE("url");
  END IF;
END $$;
