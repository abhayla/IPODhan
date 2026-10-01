-- #1176: promote _gated/B2_gmp_int_to_numeric.sql into the journal.
--
-- 0000_initial_schema created gmp_records.gmp / expected_listing_price /
-- subject_rate / kostak_rate as integer; schema.ts has declared numeric(10,2)
-- since B2/G14, but the widen lived only in _gated/B2 (hand-applied per slot),
-- so every journal-built database (CI replay, ipodhan_test, a fresh slot) kept
-- integer (reported by assert-schema-drift as numeric(32,0)) and rounded any
-- fractional GMP written to it.
--
-- Safe on every slot:
--   * Guarded: a column is altered only while it is still integer. A slot that
--     already had B2 hand-applied (staging: numeric(10,2), measured
--     2026-10-01) is a no-op - no table rewrite.
--   * Lossless widening: every integer with |v| < 100,000,000 fits
--     numeric(10,2) exactly. A larger value makes the ALTER fail with
--     "numeric field overflow" and the migration (and deploy) stops; nothing is
--     rounded or truncated silently.
--   * Not destructive: no column, row or value is dropped.
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['gmp', 'expected_listing_price', 'subject_rate', 'kostak_rate'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'gmp_records'
        AND column_name = col AND data_type = 'integer'
    ) THEN
      EXECUTE format(
        'ALTER TABLE "gmp_records" ALTER COLUMN %I TYPE numeric(10, 2) USING %I::numeric(10, 2)',
        col, col
      );
    END IF;
  END LOOP;
END $$;
