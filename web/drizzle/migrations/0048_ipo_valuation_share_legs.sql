-- W-88 A7: split the offer share count into its three legs.
--
-- `ipo_valuation.shares_at_floor/shares_at_cap` were populated from the
-- price-band ad's FRESH ISSUE row only. The ad also prints the offer-for-sale
-- share count and the total offer (fresh + OFS) at each price point, and those
-- had no column, so the persister filed them under skipped_no_column.
--
-- Additive only: five new nullable bigint columns. `shares_at_floor/at_cap`
-- keep their current meaning (the fresh leg) so no reader changes behaviour
-- when this migration lands; `fresh_shares_at_floor/at_cap` are the explicitly
-- named home going forward and are written with the same value.
--
-- `ADD COLUMN IF NOT EXISTS` makes each statement idempotent, so a re-run (or a
-- database already repaired out of band) is a no-op rather than an error.
-- Guarded on the table existing so an older baseline is skipped, not failed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'ipo_valuation') THEN
    ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "fresh_shares_at_floor" bigint;
    ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "fresh_shares_at_cap" bigint;
    ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "ofs_shares" bigint;
    ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "total_shares_at_floor" bigint;
    ALTER TABLE "ipo_valuation" ADD COLUMN IF NOT EXISTS "total_shares_at_cap" bigint;
  END IF;
END
$$;
