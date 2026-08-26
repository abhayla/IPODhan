-- One-shot cleanup: resolve noise-shaped rows in data_conflicts (T-331 P2-6)
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Round-7 review sampled data_conflicts and found 2,555 unresolved rows are
-- 86% noise: 2,205 have an empty value2 (one side genuinely had no data --
-- not a disagreement) and 99 have value1 == value2 after normalization (a
-- false "conflict" between two identical values). These rows predate the
-- T-331 write-time guard added to DataConflictsRepository.logConflict /
-- upsertConflict (packages/shared/src/repositories/data-conflicts-repository.ts)
-- -- the guard stops NEW noise rows from being written, but does not touch
-- rows already sitting unresolved in the table. This script closes those.
--
-- WHAT IT DOES
-- ------------
-- Marks each noise-shaped UNRESOLVED row RESOLVED with resolution_reason =
-- 'NOISE' and resolved_by = 'SYSTEM_CLEANUP_T331', so the audit trail still
-- shows why the row closed (never a silent DELETE -- these are historical
-- records of what the scraper actually observed). The cross-source
-- disagreement monitor (scraper/src/services/cross-source-disagreement-monitor.ts)
-- already filters on `resolved_at IS NULL`, so once this runs the alert
-- channel's unresolved set contains only genuine disagreements.
--
-- "Empty" mirrors the write-time guard's isEmptyConflictValue(): NULL, empty
-- string, or the literal string 'null' (JSON.stringify(null) -- these
-- columns store JSON-stringified values, see data-consolidation-service.ts
-- logConflict()).
--
-- "value1 == value2" is compared as the raw stored TEXT (both columns hold
-- the same JSON.stringify() encoding of their respective values, so a raw
-- string-equality check here is equivalent to the write-time guard's
-- comparison -- no separate normalization step is needed at cleanup time).
--
-- SAFETY
-- ------
-- UPDATE only -- no row is deleted. Only rows where resolved_at IS NULL are
-- touched (an already-resolved row is left untouched, regardless of its
-- value1/value2 shape -- its resolution already happened and its history
-- should not be rewritten). Re-running this script is idempotent: once a row
-- is resolved, the `resolved_at IS NULL` predicate no longer matches it.
--
-- ROLLBACK
-- --------
-- There is no automatic rollback -- these rows are being marked resolved,
-- not deleted, so the data survives. To manually re-open a specific row:
--   UPDATE data_conflicts
--   SET resolved_at = NULL, resolved_by = NULL, resolution_reason = NULL
--   WHERE id = '<id>';
--
-- APPLY (deploy wave -- NOT run by this task)
-- ---------------------------------------------
--   psql -h 127.0.0.1 -U ipodhan_app -d ipodhan \
--     -f scripts/ops/2026-08-27_resolve_data_conflicts_noise.sql
-- (run on-box or through an SSH tunnel; see .claude/rules/drizzle-migration-gated-ddl.md
-- for the same on-box-only discipline used for _gated/ migrations)

BEGIN;

UPDATE data_conflicts
SET
  resolved_at = now(),
  resolved_by = 'SYSTEM_CLEANUP_T331',
  resolution_reason = 'NOISE'
WHERE
  resolved_at IS NULL
  AND (
    -- empty value2: NULL, empty string, or JSON.stringify(null)
    value2 IS NULL OR value2 = '' OR value2 = 'null'
    -- empty value1 (rarer, but the same non-disagreement shape)
    OR value1 IS NULL OR value1 = '' OR value1 = 'null'
    -- identical stored values -- a false conflict, not a real disagreement
    OR value1 = value2
  );

COMMIT;

-- Read-back (expect 0 rows -- no unresolved noise-shaped row should remain):
--   SELECT count(*) FROM data_conflicts
--   WHERE resolved_at IS NULL
--     AND (value2 IS NULL OR value2 = '' OR value2 = 'null'
--          OR value1 IS NULL OR value1 = '' OR value1 = 'null'
--          OR value1 = value2);
--
-- Expected before/after counts (for the deploy log):
--   SELECT count(*) FROM data_conflicts WHERE resolved_at IS NULL;  -- before: ~2,555
--   -- after running this script: ~350 (the genuine unresolved disagreements)
