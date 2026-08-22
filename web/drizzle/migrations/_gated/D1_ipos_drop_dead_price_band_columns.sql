-- D1 (T-276) — DESTRUCTIVE: drop the dead `ipos.price_band_low` / `ipos.price_band_high`
-- columns. Requires Abhay's explicit sign-off. NOT journal-tracked; never auto-applied.
--
-- WHY
-- The live price band is `ipos.price_range_min` / `ipos.price_range_max` (the SSOT
-- `packages/shared/src/db/schema.ts` defines only those two). `price_band_low` /
-- `price_band_high` survive from an earlier schema, are absent from the SSOT, and are
-- written by nothing. Verified on prod 2026-08-22 via the tunnel:
--
--   select count(*), count(price_band_low), count(price_band_high) from ipos;
--   -- 328 | 0 | 0        <- 100% NULL on every row
--
-- Two names for one concept is not free: the same duplication in
-- `field-priority-matrix.ts` (`price_band_min` twin of `priceRangeMin`) is what left
-- `cross-source-disagreement-monitor.ts` filtering on a key that never appears in
-- `data_conflicts`, so the price-band alert could not fire. T-276 removed the matrix
-- twin; this file removes the column twin.
--
-- PRE-APPLY CHECK (must return 0 | 0, abort otherwise):
--   select count(price_band_low) as low_nonnull, count(price_band_high) as high_nonnull from ipos;
--
-- READ-BACK (must return 0 rows):
--   select column_name from information_schema.columns
--    where table_name = 'ipos' and column_name in ('price_band_low','price_band_high');
--
-- AFTER APPLYING: regenerate `web/drizzle/migrations/schema.ts` (the introspection
-- snapshot still declares `priceBandLow`/`priceBandHigh` as NOT NULL, which is already
-- false in prod) so `web/scripts/check-database-status.ts` stops referencing them.

BEGIN;

ALTER TABLE ipos DROP COLUMN IF EXISTS price_band_low;
ALTER TABLE ipos DROP COLUMN IF EXISTS price_band_high;

COMMIT;
