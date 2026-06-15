-- ============================================================================
-- GATED / UNAPPLIED — B2 / G14: widen GMP integer columns to numeric(10,2) so
-- fractional GMP / rates are no longer truncated by Math.round.
-- DO NOT run without Abhay's approval (§GATE). ALTER TYPE rewrites the table.
--
-- COUPLING NOTE: numeric columns come back as STRING in drizzle/pg, so applying
-- this MUST land together with the web rendering changes (Stage C) that parse the
-- GMP value, and with removing `Math.round(gmp)` in
-- scraper/src/services/data-persister.ts. Until then `gmp` stays integer in
-- schema.ts to keep the web build green. See PROGRESS B2 note.
-- ============================================================================

ALTER TABLE gmp_records
  ALTER COLUMN gmp                    TYPE numeric(10,2) USING gmp::numeric,
  ALTER COLUMN expected_listing_price TYPE numeric(10,2) USING expected_listing_price::numeric,
  ALTER COLUMN subject_rate           TYPE numeric(10,2) USING subject_rate::numeric,
  ALTER COLUMN kostak_rate            TYPE numeric(10,2) USING kostak_rate::numeric;
