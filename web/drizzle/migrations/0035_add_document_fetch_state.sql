-- T-403 WP B: per-(IPO, document type) fetch state + the three document types
-- the classifier fix needs.
--
-- Hand-authored (not `drizzle-kit generate`) for the same reason as 0032, 0033
-- and 0034: the journal is still blocked by a pre-existing, unrelated
-- `extraction_status` enum-rename prompt documented in
-- .claude/rules/drizzle-migration-gated-ddl.md. This migration does not touch
-- that column.
--
-- NON-DESTRUCTIVE by construction, which is why it belongs in the journal and
-- NOT in `_gated/`: it only CREATEs a new table and APPENDs enum values. No
-- column is dropped, retyped or backfilled, so it needs no owner sign-off gate.
-- Every statement is idempotent (IF NOT EXISTS), so a re-run is a no-op.
--
-- NOTE ON ENUM VALUES: `ALTER TYPE ... ADD VALUE` cannot run inside a
-- transaction block in PostgreSQL < 12; this project targets PostgreSQL 16,
-- where it can, so drizzle-kit's transactional apply is safe. The new values are
-- APPENDED (no ordering dependency anywhere in the code) so no type rewrite and
-- no table rewrite is triggered — the statement is O(1) regardless of table size.

-- BSE's IPO_NO, the key its core document API is addressed by. Remembered rather
-- than re-derived, because IPO_HomePageDetail lists only LIVE and FORTHCOMING
-- issues: verified 2026-08-28, Skyways (IPO_NO 7903) was already off the board the
-- day after it closed — exactly when its final Prospectus becomes due. Nullable
-- ADD COLUMN, so no table rewrite and no backfill.
ALTER TABLE "ipos" ADD COLUMN IF NOT EXISTS "bse_ipo_no" integer;
--> statement-breakpoint

ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'PRICE_BAND_AD';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'CORRIGENDUM';
--> statement-breakpoint
ALTER TYPE "document_type" ADD VALUE IF NOT EXISTS 'BASIS_OF_ALLOTMENT_AD';
--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "document_fetch_state" AS ENUM (
    'WANTED',
    'NOT_YET_FILED',
    'FOUND',
    'EXTRACTED',
    'EXTRACT_FAILED',
    'BLOCKED_ALL',
    'SUPERSEDED',
    'NOT_APPLICABLE'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_fetch_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ipo_id" uuid NOT NULL REFERENCES "ipos"("id") ON DELETE CASCADE,
	"doc_type" "document_type" NOT NULL,
	"state" "document_fetch_state" DEFAULT 'WANTED' NOT NULL,
	-- SET NULL, not CASCADE: purging a documents row must not erase the memory
	-- that we already looked for this filing and found it.
	"document_id" uuid REFERENCES "documents"("id") ON DELETE SET NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_retry_at" timestamp,
	"last_attempt" jsonb,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"blocked_since_at" timestamp,
	"extracted_at" timestamp,
	"extractor_version" varchar(50),
	-- Supersession is decided by the date printed ON the document, never by fetch
	-- order (lifecycle-plan E1/E8).
	"filing_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_doc_fetch_state_per_ipo_type" UNIQUE ("ipo_id","doc_type")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_fetch_state_state" ON "document_fetch_state" USING btree ("state");
--> statement-breakpoint
-- The cycle's hot query: "which rows are due to be retried now?"
CREATE INDEX IF NOT EXISTS "idx_document_fetch_state_next_retry" ON "document_fetch_state" USING btree ("state","next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_fetch_state_ipo" ON "document_fetch_state" USING btree ("ipo_id");
