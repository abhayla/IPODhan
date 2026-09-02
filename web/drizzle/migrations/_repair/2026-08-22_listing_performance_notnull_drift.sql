-- journaled as 0041_journal_drift_repair_backport.sql (T-405, #256)
-- Repair: listing_performance NOT NULL drift (GitHub #139)
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Production's `drizzle.__drizzle_migrations` table is EMPTY (0 rows, verified
-- 2026-08-22). The whole journaled migration chain was never applied there; the
-- schema was stood up by an early `db:push`-style path and has drifted since.
--
-- The specific drift that broke #139: `0010_medical_viper.sql` drops the NOT NULL
-- on listing_performance.{ipo_id,listing_price,issue_price,listing_gain_percent}.
-- It never ran, so prod still enforces NOT NULL on columns that
-- `packages/shared/src/db/schema.ts` (the schema SSOT) declares nullable. Every
-- listing-performance upsert that had no day-1 price failed with SQLSTATE 23502 —
-- 243 of 243, every cycle, for seven weeks.
--
-- This file realigns the DATABASE to the SSOT. It is NOT journaled, and it is NOT
-- in `_gated/`: those two directories mean different things here.
--   * `_gated/`  = destructive / type-changing DDL, owner sign-off required.
--   * `_repair/` = idempotent, non-destructive drift repair, safe to re-run.
-- Running the full journal against prod instead would replay 14 migrations
-- (including CREATE TABLE) against a live database — far more dangerous than this.
--
-- SAFETY
-- ------
-- DROP NOT NULL only LOOSENS a constraint: no row is read, rewritten, or deleted,
-- and no existing value changes. It takes a brief ACCESS EXCLUSIVE lock on a
-- 143-row table (sub-millisecond). Re-running it is a no-op.
--
-- ROLLBACK
-- --------
--   ALTER TABLE listing_performance ALTER COLUMN listing_price SET NOT NULL;
-- ...and likewise per column. This only succeeds while no NULL exists in the
-- column. After this repair the application-side guard in
-- `scraper/src/scrapers/listing-performance-plan.ts` skips any record without a
-- real listing price, so NULLs should not accumulate — but verify before rolling
-- back:  SELECT count(*) FROM listing_performance WHERE listing_price IS NULL;
--
-- APPLY
-- -----
--   psql -h 127.0.0.1 -U ipodhan_app -d ipodhan \
--     -f web/drizzle/migrations/_repair/2026-08-22_listing_performance_notnull_drift.sql
-- (run on-box or through an SSH tunnel; see .claude/rules/drizzle-migration-gated-ddl.md)

BEGIN;

ALTER TABLE "listing_performance" ALTER COLUMN "listing_price"        DROP NOT NULL;
ALTER TABLE "listing_performance" ALTER COLUMN "issue_price"          DROP NOT NULL;
ALTER TABLE "listing_performance" ALTER COLUMN "listing_gain_percent" DROP NOT NULL;

-- schema.ts declares ipo_id nullable too (it carries .unique() + a FK, not NOT NULL).
ALTER TABLE "listing_performance" ALTER COLUMN "ipo_id"               DROP NOT NULL;

COMMIT;

-- Read-back (expect four rows, all is_nullable = YES):
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'listing_performance'
--     AND column_name IN ('ipo_id','listing_price','issue_price','listing_gain_percent')
--   ORDER BY column_name;
