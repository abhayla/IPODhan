-- D2 — DESTRUCTIVE: drop the legacy `ipos.exchange` column. Requires Abhay's
-- explicit sign-off. NOT journal-tracked; never auto-applied.
--
-- WHY
-- `ipos.exchange` is not declared in the SSOT (`packages/shared/src/db/schema.ts`
-- has no `exchange` field on `ipos`) and had exactly one reader/writer:
-- `web/scripts/fix-exchange-field.ts`, a one-off ISS-008 (Oct 2025) repair script.
-- ISS-008 has been closed for months and the script has been deleted in this
-- change — after that, nothing in the codebase reads or writes this column.
-- The live per-exchange listing data lives in `listing_exchanges` (per the SSOT
-- schema), so this column is a dead duplicate, not a second SSOT for the fact.
--
-- PRE-APPLY CHECK — run this first and DO NOT drop if it returns > 0 without
-- comparing against `listing_exchanges`:
--   SELECT count(*) FROM ipos WHERE exchange IS NOT NULL;
--
-- If the count is > 0, inspect which rows disagree with the SSOT before dropping:
--   SELECT slug, exchange FROM ipos WHERE exchange IS NOT NULL LIMIT 20;
--   -- compare each slug's `exchange` value against its rows in `listing_exchanges`
--   -- to confirm no fact is lost by the drop (i.e. every value here is either
--   -- redundant with listing_exchanges or itself stale/garbage from ISS-008).
--
-- READ-BACK (must return 0 rows):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'ipos' AND column_name = 'exchange';

BEGIN;

ALTER TABLE ipos DROP COLUMN IF EXISTS exchange;

COMMIT;
