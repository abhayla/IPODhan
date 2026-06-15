-- ============================================================================
-- GATED / UNAPPLIED — B4 / G13: dedup gmp_records, then add a UNIQUE constraint
-- on (ipo_id, timestamp, source) so re-runs stop inserting near-duplicate rows.
-- DO NOT run without Abhay's approval (§GATE). The DELETE is destructive.
-- Pairs with `createGMPRecord` using onConflict-do-nothing once this is applied.
-- ============================================================================

-- 1) Collapse exact duplicates, keeping a single physical row per key.
DELETE FROM gmp_records a
USING gmp_records b
WHERE a.ctid < b.ctid
  AND a.ipo_id    = b.ipo_id
  AND a.timestamp = b.timestamp
  AND a.source    = b.source;

-- 2) Enforce uniqueness going forward.
ALTER TABLE gmp_records
  ADD CONSTRAINT uq_gmp_records_ipo_ts_source UNIQUE (ipo_id, timestamp, source);
