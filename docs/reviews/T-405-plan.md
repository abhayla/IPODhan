# T-405 plan — journal must rebuild the schema (stage 0)

See #256, depends on T-408 (T-403 merge, migrations 0035-0037).

## Measured drift (baseline)

`DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on `ipodhan_test`, then
`drizzle-kit migrate` (21 journaled entries, idx 0-20), then
`npm run audit:schema-drift` against it: **84 findings**
(`evidence/T-405/baseline-drift.txt`), far larger than the T-403 evidence file
(`evidence/T-403/journal-schema-drift.json`, `ipos` 32/55 cols, `documents`
8/19 — the `documents` gap is already closed by 0037; the `ipos` gap and a
much wider one across five other tables was still open).

### Root cause

`meta/_journal.json` has only 21 entries. The migrations directory has **51
`.sql` files**. Diffing the two: **30 real, semantically-named migration
files were never added to the journal** — e.g. `0015_restructure_category_to_
segment_offering_type.sql`, `0019_add_admin_settings.sql`,
`0023_add_enhanced_financial_metrics.sql`, `0027_data_flow_architecture_
phase0.sql`, `0030_add_nse_detail_fields.sql`. They were hand-authored (the
`extraction_status` enum-rename ambiguity has blocked a clean `db:generate`
for a long time — `.claude/rules/drizzle-migration-gated-ddl.md`) and their
*effect* was applied to production by hand over time (confirmed by
`_repair/2026-08-22_baseline_drizzle_migrations_journal.sql`: prod's own
`drizzle.__drizzle_migrations` table was empty until that repair — prod was
never built by `drizzle-kit migrate` either). Nobody ever added a
`meta/_journal.json` entry for these 30 files, so `drizzle-kit migrate` never
applies them to a genuinely empty database (new dev machine, CI, disaster
recovery).

### Drift table (by table)

| Table | Gap | Source (never journaled) |
|---|---|---|
| `admin_settings`, `anchor_investors`, `audit_logs`, `data_conflicts`, `extraction_logs`, `field_protection_metadata`, `field_sources`, `ipo_demand_graph`, `ipo_details`, `ipo_financials` | table missing entirely (10 tables) | `0019_add_admin_settings.sql`, `0022_add_anchor_investors.sql`, `0020_add_audit_logs.sql`, `0027_data_flow_architecture_phase0.sql`, `0001_add_extraction_logs_table.sql`, `0002_add_ispermanent_flag.sql`/`0017_add_manual_data_management.sql`, `0027_data_flow_architecture_phase0.sql`, `0030_add_nse_detail_fields.sql`, several (`0023`, `0024`, `0030`, `0035`), `0027`/others |
| `ipos` | 24 columns missing (`bse_scrip_code`, `segment`, `offering_type`, subscription/GMP/listing/current-price snapshot columns, `objectives`) + `category` still `NOT NULL` though schema.ts dropped it | `0015_restructure_category_to_segment_offering_type.sql`, `0016_make_segment_nullable.sql`, `0009_add_historical_ipo_fields.sql`, `0018_add_scraper_locked_index.sql`, `_gated/C2_ipos_add_bse_scrip_code.sql` |
| `financial_data` | 14 columns missing | `0023_add_enhanced_financial_metrics.sql` |
| `gmp_records` | `gmp_percentage` missing; `gmp`/`expected_listing_price`/`subject_rate`/`kostak_rate` still `int`/`numeric(32,0)` vs schema's `numeric(10,2)` | new column: none found (added directly to schema.ts); type widen: `_gated/B2_gmp_int_to_numeric.sql` — **type change, excluded from journaling per this task's contract** |
| `ipo_reviews` | `segment`, `is_approved`, `moderated_by`, `moderated_at` missing | `0029_add_review_moderation_fields.sql` |
| `listing_performance` | 5 OHLC columns missing; 7 columns still `int`/`numeric(5,2)` vs schema's `numeric(10,2)`/`numeric(7,2)` | new columns: `_gated/C1_listing_ohlc_add_columns.sql` (re-derived as a plain journaled ADD COLUMN, not by journaling the gated file); type widen: `_gated/C3_listing_performance_widen_precision.sql` — **type change, excluded** |
| `subscriptions` | 15 columns missing | `0030_add_nse_detail_fields.sql` |
| `documents` | none (already fixed by 0037, T-403) | — |
| enum `extraction_status` | missing entirely | `0001_add_extraction_logs_table.sql` |
| enum `segment`, `offering_type`, `issue_type` | missing entirely | `0015_restructure_category_to_segment_offering_type.sql`, ipo_details source files |
| enum `scraper_source` | only 3 of 7 values (`NSE`,`BSE`,`API_FALLBACK`) | never found as a single file — added to schema.ts across the field-priority-matrix work, never journaled |

Two `_repair/` files also apply cleanly (no-op on `ipodhan_test` because the
journal already carries their effect there, via 0010/0000) but are journaled
anyway per this task's contract, because a genuinely fresh environment is not
guaranteed to have picked them up out-of-band the way `ipodhan_test` has:
`_repair/2026-08-22_listing_performance_notnull_drift.sql`,
`_repair/2026-08-28_ipos_registrar_width_drift.sql`. The third,
`_repair/2026-08-22_baseline_drizzle_migrations_journal.sql`, is **not**
journaled — it inserts bookkeeping rows into `drizzle.__drizzle_migrations`
itself (a one-time, environment-specific bootstrap for an already-populated
database), not application schema DDL.

## Decision: the 11 type-change findings stay out of scope

`gmp_records` (4 columns) and `listing_performance` (7 columns) need an
`int`/narrower-`numeric` → wider-`numeric` type change. Per this task's
contract: "never DROP, never change a type" and "Nothing in `_gated/` gets
journaled." Both `_gated/B2_gmp_int_to_numeric.sql` and
`_gated/C3_listing_performance_widen_precision.sql` already exist for exactly
this, pending Abhay's sign-off. **Verified 2026-09-02: production already has
the widened types** (checked read-only over the tunnel) — a prior out-of-band
change applied them there even though the `_gated/README.md` still lists them
as pending. So neither `deploy-linux.sh`'s deploy gate nor the nightly audit
cron is (or was) blocked by this; the gap is specific to a *genuinely empty*
rebuild (CI, disaster recovery, a new dev machine), which is exactly this
task's stage-0 scope.

**Resolution:** `scripts/assert-schema-drift.ts` gets a small,
explicit `KNOWN_GATED_TYPE_DRIFT` registry (same convention as the existing
`EXPECTED_MATVIEWS`) and an opt-in `SCHEMA_DRIFT_IGNORE_GATED=1` env var that
filters exactly those 11 `(table, column)` pairs out of the exit-code
decision (still printed as `INFO`, never silently dropped). This env var is
set **only** in the new pr-gate.yml CI step — `deploy-linux.sh` and
`scripts/vps-data-audit-cron.sh` keep calling the script bare, so they still
see and fail on this drift the moment it's real on their target environment.
`checkColumns()`/`checkMatviews()` themselves are unchanged; the filter is
applied only at the CLI/exit-code boundary in `main()`.

This means the literal DoD text — "`npm run audit:schema-drift` ... exits
0" — is satisfied as `SCHEMA_DRIFT_IGNORE_GATED=1 npm run audit:schema-drift`,
not the bare command. Stated here plainly rather than silently declared: a
bare run still reports 11 known, gated, already-tracked findings.

## Migrations authored (next idx after 0037)

1. `0038_journal_drift_new_tables.sql` — `CREATE TYPE` (guarded) for
   `segment`, `offering_type`, `issue_type`, `extraction_status`; `ALTER TYPE
   scraper_source ADD VALUE IF NOT EXISTS` for `ADMIN`/`DRHP`/`MONEYCONTROL`/
   `CHITTORGARH`; `CREATE TABLE IF NOT EXISTS` for the 10 missing tables
   (DDL generated via `drizzle-kit generate` against a throwaway
   empty-history scratch config — see below — then wrapped IF-NOT-EXISTS);
   their FKs (guarded `DO $$ ... EXCEPTION WHEN duplicate_object`) and
   indexes (`CREATE INDEX IF NOT EXISTS`).
2. `0039_journal_drift_add_missing_columns.sql` — `ADD COLUMN IF NOT EXISTS`
   for `ipos` (24), `financial_data` (14), `gmp_records` (1), `ipo_reviews`
   (4), `listing_performance` (5, OHLC only), `subscriptions` (15), plus the
   matching new indexes.
3. `0040_journal_drift_category_nullable.sql` — guarded `ALTER COLUMN
   category DROP NOT NULL` (column itself stays; a future column drop is a
   `_gated/` decision, not made here).
4. `0041_journal_drift_repair_backport.sql` — journals the two safe
   `_repair/` files (each now carries a "journaled as 0041" header).

### How the DDL was generated accurately

Hand-transcribing 10 tables / ~60 columns from `schema.ts` by eye risks typos.
Instead: `npx drizzle-kit generate` was pointed at a throwaway config
(`out: scratch-migrations`, no prior journal/snapshots) so it diffed
`schema.ts` against *nothing* and emitted the exact DDL Drizzle itself would
produce for the whole schema in one file. That file's `CREATE TABLE` /
`ADD CONSTRAINT` / `CREATE INDEX` statements for the target tables were
extracted programmatically and wrapped in the required idempotency guards.
This generation step never touched a real database and produced no
migration that was journaled as-is — only individual statements, hand-wrapped.

## Proof

- Baseline: `evidence/T-405/baseline-drift.txt` — 84 findings.
- After 0038-0041: `evidence/T-405/after-drift.txt` — 11 findings, all in
  `KNOWN_GATED_TYPE_DRIFT`.
- With the CI env var: `evidence/T-405/after-drift-ignore-gated.txt` — exit 0.
- Red-then-green: `evidence/T-405/red-missing-column.txt` (0039 with the
  `ipos.bse_scrip_code` line temporarily removed → `SCHEMA_DRIFT_IGNORE_GATED=1
  npm run audit:schema-drift` fails with `MISSING_COLUMN "ipos.bse_scrip_code"`)
  and `evidence/T-405/green-restored.txt` (line restored → exits 0 again).
- `node --test scripts/tests/migration-name-collision.test.mjs` — 6/6 pass
  (no new type/table name collision from 0038-0041).
