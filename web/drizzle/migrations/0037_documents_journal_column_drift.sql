-- T-403 r5 (5): the eleven `documents` columns the journal never created.
--
-- WHY THIS EXISTS. Round-4's review asked for the T-403 integration tests to
-- write through `DocumentRepository.upsertDocument` and
-- `IPORepository.updateDocumentSourceHints` instead of raw SQL — the shared
-- write path is the thing worth proving, and a raw INSERT proves only that a
-- column accepts a value. Routing the test through the repository then failed
-- with `column "media_type" does not exist`, because `drizzle-kit migrate` from
-- empty builds `documents` with EIGHT of the nineteen columns `schema.ts`
-- declares (measured in `evidence/T-403/journal-schema-drift.json`).
--
-- So the raw SQL was never a shortcut: on a journal-built database the shared
-- writer CANNOT RUN AT ALL, because `upsertDocument` selects every declared
-- column. Production has been fine only because it was built from dumps plus
-- hand-applied `_repair/` files, which is precisely the kind of invisible
-- difference that makes a green CI meaningless. `scripts/run-document-discovery.ts`
-- documents the same wall in a code comment and works around it with its own
-- raw INSERT.
--
-- SCOPE. This repairs ONE table — `documents`, which T-403 owns and whose
-- `sha256` column 0035 adds. The wider drift (`ipos` gets 32 of 55 columns, a
-- NOT NULL `category` the model dropped) is untouched and stays an owner-level
-- schema-ownership decision, recorded in docs/reviews/T-403-plan.md.
--
-- SAFETY. Every statement is guarded and idempotent:
--   * `ADD COLUMN IF NOT EXISTS` with a DEFAULT — on Postgres 11+ this is a
--     catalogue-only change, no table rewrite, so it is safe on a large table.
--   * On production and staging every one of these already exists, so this
--     migration is a no-op there.
--   * The two UNIQUE constraints are added only when absent. If a database
--     somehow holds the columns without the constraint AND carries duplicate
--     rows, this fails loudly rather than silently skipping — which is the
--     correct outcome: duplicates under `unique_url` are a data defect.
--
-- ROLLBACK: `ALTER TABLE documents DROP COLUMN IF EXISTS <col>` for each column
-- below, plus `DROP CONSTRAINT IF EXISTS unique_doc_per_ipo, unique_url`. No
-- data is destroyed by this migration, so a rollback is only needed to undo it.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "media_type" varchar(20) DEFAULT 'PDF' NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "sequence_number" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_active" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "exchange" varchar(10);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extraction_status" varchar(50) DEFAULT 'PENDING';
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extraction_confidence" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extracted_at" timestamp;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "extraction_error" text;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "retry_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "created_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_exchange" ON "documents" ("exchange");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_documents_extraction_status" ON "documents" ("extraction_status");
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_doc_per_ipo'
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "unique_doc_per_ipo"
      UNIQUE ("ipo_id", "type", "media_type", "exchange", "sequence_number");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_url'
  ) THEN
    ALTER TABLE "documents" ADD CONSTRAINT "unique_url" UNIQUE ("url");
  END IF;
END $$;
