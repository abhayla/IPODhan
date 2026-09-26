-- #676 / #634 (spec §0.4 documents table rows 147-150, F-183), migration 0065.
-- Hand-trimmed from drizzle-kit's output to this migration's statements only.
-- 1. document_extraction_attempts: append-only, one row per FAILED / MANUAL_REVIEW attempt, so a
--    document at the retry ceiling keeps every cause, not just the last. Additive; no backfill
--    (earlier attempts were never recorded and cannot be reconstructed).
-- 2. ck_documents_extraction_status: the column's closed value set (DOCUMENT_EXTRACTION_STATUSES).
--    NOT VALID: enforced on every INSERT/UPDATE from now on, without scanning or rewriting existing
--    rows (the contract forbids data repair). Measured 2026-09-26 on ipodhan_staging: all 375 rows
--    are already inside the set. The nightly floor check d_extraction_status_declared reports any
--    old row outside it by identity.
CREATE TABLE IF NOT EXISTS "document_extraction_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" varchar(50) NOT NULL,
	"cause" text NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ck_document_extraction_attempts_outcome" CHECK ("document_extraction_attempts"."outcome" IN ('FAILED', 'MANUAL_REVIEW'))
);
--> statement-breakpoint
ALTER TABLE "document_extraction_attempts" ADD CONSTRAINT "document_extraction_attempts_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_extraction_attempts_document" ON "document_extraction_attempts" USING btree ("document_id","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "ck_documents_extraction_status" CHECK ("documents"."extraction_status" IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'MANUAL_REVIEW', 'NOT_EXTRACTABLE')) NOT VALID;
