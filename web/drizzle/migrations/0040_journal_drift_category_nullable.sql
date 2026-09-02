-- T-405 (#256) -- stage 0: the NOT NULL `category` column the journal creates
-- but schema.ts dropped.
--
-- `ipos.category` (enum ipo_category: MAINBOARD/SME/RIGHTS/NCD/FPO) was
-- 0000_initial_schema's original segmentation column, declared NOT NULL.
-- 0015_restructure_category_to_segment_offering_type replaced it with the two
-- columns 0038/0039 add (segment, offering_type) -- but that migration was
-- never journaled (same root cause as 0038/0039), so a journal-built database
-- still has `category` and still enforces NOT NULL on it. Since schema.ts no
-- longer declares this column at all, Drizzle's generated INSERT never sets
-- it, and every insert through the app's write path fails NOT NULL on a
-- column the code does not know exists.
--
-- This migration ONLY loosens the constraint (DROP NOT NULL) so writes stop
-- failing. It deliberately does NOT drop the column itself -- column drops are
-- destructive and, per this task's contract, require an owner-approved
-- _gated/ migration (parked as a follow-up, matching the precedent of
-- _gated/D1_ipos_drop_dead_price_band_columns.sql). Guarded so it is a no-op
-- if `category` does not exist or is already nullable.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ipos' AND column_name = 'category'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "ipos" ALTER COLUMN "category" DROP NOT NULL;
  END IF;
END $$;
