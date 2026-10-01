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
--   * Fail fast: SET LOCAL lock_timeout = '5s'. A blocked deploy errors out and
--     rolls back instead of queueing every gmp_records read behind the ALTER.
--   * Guarded: a column is altered only while its type is smallint, integer or
--     bigint (read from pg_attribute + format_type, which unlike
--     information_schema also sees columns the role has no privileges on).
--     A slot that already had B2 hand-applied (staging: numeric(10,2),
--     measured 2026-10-01) is a no-op - no table rewrite.
--   * One rewrite: every column that needs it goes into ONE ALTER TABLE, so the
--     table is rewritten once, not once per column.
--   * Lossless widening: every integer with |v| < 100,000,000 fits
--     numeric(10,2) exactly. A larger value makes the ALTER fail with
--     "numeric field overflow" and the migration (and deploy) stops; nothing is
--     rounded or truncated silently.
--   * Not destructive: no column, row or value is dropped.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
DO $$
DECLARE
  clauses text;
BEGIN
  SELECT string_agg(
           format('ALTER COLUMN %I TYPE numeric(10, 2) USING %I::numeric(10, 2)', a.attname, a.attname),
           ', ' ORDER BY a.attnum)
    INTO clauses
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.gmp_records')
     AND a.attname IN ('gmp', 'expected_listing_price', 'subject_rate', 'kostak_rate')
     AND NOT a.attisdropped
     AND a.attnum > 0
     AND format_type(a.atttypid, a.atttypmod) IN ('smallint', 'integer', 'bigint');
  IF clauses IS NOT NULL THEN
    EXECUTE 'ALTER TABLE "gmp_records" ' || clauses;
  END IF;
END $$;
