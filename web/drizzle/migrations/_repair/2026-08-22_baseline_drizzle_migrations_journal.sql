-- Repair: baseline drizzle.__drizzle_migrations (T-267, follows GitHub #139 / PR #146)
--
-- WHY THIS FILE EXISTS
-- --------------------
-- `drizzle.__drizzle_migrations` on prod is EMPTY (0 rows, verified 2026-08-22
-- alongside T-264's independent review). The journaled migration chain in
-- `web/drizzle/migrations/meta/_journal.json` (14 entries, idx 0-13) was never
-- applied there -- the schema was originally stood up by an early `db:push`-
-- style path and every subsequent journaled migration's *effect* was applied
-- by hand over time, never through `drizzle-kit migrate`. Every entry's
-- effect has been spot-checked present in prod (columns/constraints from the
-- newest entries, incl. the out-of-order idx=12 `0021_add_promoter_holding_
-- fields` and the listing_performance NOT NULL drift PR #146 already fixed).
--
-- Because the table is empty, drizzle-kit's own migrate() logic (which only
-- compares `MAX(created_at)` in this table against each candidate migration's
-- journal `when`) would treat EVERY journaled entry as new and attempt to
-- replay all 14 -- including `CREATE TABLE` statements -- against a live
-- database whose tables already exist. That is exactly the danger the sibling
-- `_repair/2026-08-22_listing_performance_notnull_drift.sql` file already
-- called out for the full journal. This file performs the safe alternative:
-- record that everything already-applied IS applied, by INSERTing baseline
-- rows for each journaled entry (metadata only -- no DDL, no data touched),
-- so a subsequent `drizzle-kit migrate` only picks up genuinely NEW entries
-- added after this baseline.
--
-- This is the missing half of the T-267 fix: the Linux deploy pipeline
-- (`scripts/deploy-linux.sh`) never ran `drizzle-kit migrate` at all (unlike
-- the retired Windows `deploy.yml`, which ran it with `continue-on-error:
-- true` -- silently swallowing exactly this kind of drift). T-267 wires
-- `drizzle-kit migrate` + a migrations-applied assert (`scripts/assert-
-- migrations-applied.sh`) into every deploy going forward; this baseline is
-- the one-time repair that makes turning that on safe instead of destructive.
--
-- `_repair/` vs `_gated/` (see `web/drizzle/migrations/_gated/README.md` and
-- `.claude/rules/drizzle-migration-gated-ddl.md`): `_gated/` = destructive /
-- type-changing DDL, owner sign-off required before each apply. `_repair/` =
-- idempotent, non-destructive drift repair, safe to re-run, applied directly.
-- This file touches ONLY the bookkeeping table drizzle-kit itself owns; it
-- changes no application schema and no application data.
--
-- SAFETY
-- ------
-- Every INSERT below is guarded by `WHERE NOT EXISTS (... created_at = ...)`,
-- so re-running this file is a no-op the second time. No table other than
-- `drizzle.__drizzle_migrations` is touched. The `hash` column is metadata
-- only -- drizzle-kit's migrate() never compares it, only `created_at` decides
-- what counts as "already applied" -- so the tag-derived placeholder used here
-- is safe; it does not need to reproduce drizzle-kit's own hash algorithm.
--
-- ROLLBACK
-- --------
--   DELETE FROM drizzle.__drizzle_migrations WHERE hash LIKE 'baseline:%';
-- This only removes the baseline bookkeeping rows; it cannot and does not
-- touch application schema or data.
--
-- APPLY
-- -----
--   psql "$DATABASE_URL" \
--     -f web/drizzle/migrations/_repair/2026-08-22_baseline_drizzle_migrations_journal.sql
-- (run on-box or through an SSH tunnel; see .claude/rules/drizzle-migration-gated-ddl.md)
-- Apply to EVERY slot (staging AND prod) before their deploy pipeline starts
-- running `drizzle-kit migrate` for real, or the same "replay everything"
-- danger applies to staging's own migrations table.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "drizzle";

CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- One row per journaled entry in meta/_journal.json (idx 0-13). `created_at`
-- values are each entry's `when` field verbatim; `hash` is a readable
-- baseline marker (tag-derived), not drizzle-kit's own hash -- see SAFETY.
INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT v.hash, v.created_at FROM (VALUES
  ('baseline:0000_initial_schema',                 1759688075682::bigint),
  ('baseline:0001_whole_doctor_octopus',            1759838892557::bigint),
  ('baseline:0002_wet_chimera',                     1759843736695::bigint),
  ('baseline:0003_dark_dorian_gray',                1759860444398::bigint),
  ('baseline:0004_tired_quasar',                    1759985418678::bigint),
  ('baseline:0005_short_the_initiative',            1760253198826::bigint),
  ('baseline:0006_secret_supreme_intelligence',     1760288836584::bigint),
  ('baseline:0007_ancient_roulette',                1760465685716::bigint),
  ('baseline:0008_empty_redwing',                   1760507421223::bigint),
  ('baseline:0009_far_northstar',                   1760714842531::bigint),
  ('baseline:0010_medical_viper',                   1760777063408::bigint),
  ('baseline:0011_naive_fixer',                     1760849220186::bigint),
  ('baseline:0021_add_promoter_holding_fields',     1729930000000::bigint),
  ('baseline:0013_square_zaran',                    1761833097516::bigint)
) AS v(hash, created_at)
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations" existing
  WHERE existing.created_at = v.created_at
);

COMMIT;

-- Read-back (expect 14 rows, MAX(created_at) = 1761833097516):
--   SELECT count(*), max(created_at) FROM drizzle.__drizzle_migrations;
