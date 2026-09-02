-- T-405 (#256) -- journals the two application-schema _repair/ files so a
-- fresh (or any partially-drifted) environment gets their fix through
-- `drizzle-kit migrate` instead of relying on someone finding and hand-running
-- the _repair/ script. Both are already no-ops on a journal-built database
-- (verified in evidence/T-405/) because the columns they touch already have
-- the correct shape from earlier journaled migrations there -- they matter for
-- OTHER environments (e.g. a partially-hand-patched staging) that may still
-- carry the original drift. Idempotent by construction (DROP NOT NULL only
-- loosens; the width widen is DO-guarded), so safe to journal.
--
-- The THIRD _repair/ file, 2026-08-22_baseline_drizzle_migrations_journal.sql,
-- is intentionally NOT journaled here: it inserts bookkeeping rows into
-- drizzle.__drizzle_migrations itself (marking pre-existing prod state as
-- "already applied") rather than changing application schema. Journaling a
-- migration that rewrites the migration-tracking table is a different kind of
-- operation, still a manual, environment-specific bootstrap step -- see that
-- file's own header for why.

-- Source: _repair/2026-08-22_listing_performance_notnull_drift.sql
-- (journaled as 0041, T-405)
ALTER TABLE "listing_performance" ALTER COLUMN "listing_price" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "issue_price" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "listing_gain_percent" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "listing_performance" ALTER COLUMN "ipo_id" DROP NOT NULL;
--> statement-breakpoint

-- Source: _repair/2026-08-28_ipos_registrar_width_drift.sql
-- (journaled as 0041, T-405)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ipos' AND column_name = 'registrar'
      AND data_type = 'character varying' AND character_maximum_length < 255
  ) THEN
    ALTER TABLE public.ipos ALTER COLUMN registrar TYPE varchar(255);
  END IF;
END $$;
