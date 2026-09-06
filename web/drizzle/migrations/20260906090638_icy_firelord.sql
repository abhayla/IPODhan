-- Snapshot-gap repair, not a real schema change for the nine ADD COLUMNs below.
--
-- 0048_ipo_valuation_share_legs.sql and 0049_ipo_details_ad_fields.sql were
-- both hand-committed (journal entry added, SQL written) without running
-- `drizzle-kit generate`, so neither has a meta/00NN_snapshot.json. The last
-- real snapshot on disk was meta/0047_snapshot.json. Running `db:generate`
-- with the new document_fetch_state index in schema.ts therefore diffs
-- against 0047 and re-emits all nine columns 0048+0049 already added on
-- prod/staging, alongside the one real new statement (the CREATE INDEX).
--
-- Every ADD COLUMN below is turned into ADD COLUMN IF NOT EXISTS (matching
-- 0048/0049's own idempotent style) so this migration is a no-op on any
-- database that already has 0048/0049 applied, and only does real work
-- (backfilling the columns) on a database that does not — e.g. a fresh
-- ipodhan_test. This migration also writes the snapshot file 0048+0049 never
-- did, so this is the last time this class of drift can appear.
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "bid_windows" jsonb;--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "promoter_shares_held" bigint;--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "sebi_regulation_cited" varchar(32);--> statement-breakpoint
ALTER TABLE "ipo_details" ADD COLUMN IF NOT EXISTS "promoter_group_transactions_since_drhp" jsonb;--> statement-breakpoint
ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "fresh_shares_at_floor" bigint;--> statement-breakpoint
ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "fresh_shares_at_cap" bigint;--> statement-breakpoint
ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "ofs_shares" bigint;--> statement-breakpoint
ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "total_shares_at_floor" bigint;--> statement-breakpoint
ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "total_shares_at_cap" bigint;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_document_fetch_state_ipo_last_attempt" ON "document_fetch_state" USING btree ("ipo_id","last_attempt_at");
