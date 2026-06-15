-- ============================================================================
-- GATED / UNAPPLIED — B3 / G12: drop orphan GMP tables. Destructive.
-- gmp_records is the canonical GMP model. gmp_history + gmp_tracking are empty
-- orphans (not in schema.ts, no code refs); gmp_current matview reads the empty
-- gmp_tracking. DO NOT run without Abhay's approval (§GATE).
-- Apply via the tunnel, then read back that the tables/view are gone.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS gmp_current;
DROP TABLE IF EXISTS gmp_history;
DROP TABLE IF EXISTS gmp_tracking;
