---
name: drizzle-migration-gated-ddl
description: >
  IPODhan's three-part Drizzle convention — db:push for ephemeral CI, drizzle-kit migrate for
  prod, and a _gated/ subdir for destructive DDL that drizzle-kit migrate must NEVER auto-apply.
  Keeps a type-change or drop from silently running on prod without owner sign-off.
globs: ["web/drizzle/**", "web/drizzle.config.ts", ".github/workflows/*.yml"]
version: "1.0.0"
synthesized: true
private: false
---

# Drizzle Migrations & Gated Destructive DDL

## Part A — db:push for ephemeral, drizzle-kit migrate for prod

Two different Drizzle commands, two different contexts. Do not cross them.

- **Ephemeral / CI / test DBs** use `npm run db:push` (= `drizzle-kit push`) — pushes the
  schema directly, no migration files. `.github/workflows/test.yml` runs `npm run db:push`
  against the throwaway `postgres:16` service container before integration tests. Fine to
  drop/recreate; nothing is journal-tracked.
- **Production** uses `npx drizzle-kit migrate`. This applies ONLY the migrations recorded in
  `meta/_journal.json`, in order. Two pipelines exist:
  - `.github/workflows/deploy.yml` (legacy Windows, retired path) had a "Run database
    migrations" step with `continue-on-error: true` — this SILENTLY swallowed a migrate
    failure. `drizzle.__drizzle_migrations` sitting at 0 rows in prod for the app's whole life,
    undetected, traces directly to this step's failure being ignored (T-267, GitHub #139).
  - `scripts/deploy-linux.sh` (active pipeline, T-242 M3+) runs `drizzle-kit migrate` as step 7
    and immediately follows it with `scripts/assert-migrations-applied.sh` — which FAILS THE
    DEPLOY LOUDLY (blocks the flip) if the target DB's newest applied migration timestamp is
    older than the newest journaled one. This is the fix for the swallowed-failure class above:
    a migration gap is now a blocked deploy, never a silent drift.

- MUST NOT run `drizzle-kit push` against production — it bypasses the journal and can drop
  columns. Prod is migrate-only.
- MUST NOT reintroduce `continue-on-error` (or equivalent silent-swallow) around a migration
  step — a failed/no-op migrate MUST fail the deploy, not degrade to "schema may already be
  current" (that exact assumption is what let #139 run silently for seven weeks).

## Part B — schema SSOT and migration output location

Per `web/drizzle.config.ts`: the schema SSOT is `../packages/shared/src/db/schema.ts`
(`schema:` field) and generated migrations emit into `./drizzle/migrations` (`out:` field),
`dialect: 'postgresql'`, `strict: true`. Edit the schema in `packages/shared`, generate from
`web/`. Never hand-edit a journal-tracked migration after it has been applied.

## Part C — destructive DDL is PARKED in _gated/, applied manually

Type-changing or destructive DDL is authored but intentionally UNAPPLIED. It lives in
`web/drizzle/migrations/_gated/` — a subdirectory deliberately kept OUT of
`meta/_journal.json` so `drizzle-kit migrate` (which only applies journaled entries) NEVER
auto-runs it. See `web/drizzle/migrations/_gated/README.md`. Current gated files, applied in
THIS order only after the owner's explicit sign-off:

1. `B3_gmp_drop_orphans.sql` — drops orphan `gmp_history`, `gmp_tracking`, matview `gmp_current`.
2. `B4_gmp_unique_dedup.sql` — dedup, then `UNIQUE(ipo_id, timestamp, source)`.
3. `B2_gmp_int_to_numeric.sql` — widens `gmp`/`expected_listing_price`/`subject_rate`/`kostak_rate` int → numeric(10,2).

- MUST apply each gated file manually via the SSH tunnel (`localhost:15432`), in the README
  order, ONLY after owner sign-off, WITH a read-back verifying the change.
- MUST NOT add `_gated/` files to `meta/_journal.json` to "make them apply" — that defeats
  the gate. They are folded into the journal only when deliberately promoted, recording the
  forked numbering.
- Note: the journal is mid-drift (a pre-existing `extraction_status` enum mismatch blocks a
  clean `db:generate`), which is why these are hand-authored rather than generated.

## Part D — _repair/ for non-destructive, idempotent drift repair

`web/drizzle/migrations/_repair/` holds a second kind of unjournaled file, distinct from
`_gated/`: idempotent, non-destructive repairs to bring a live DB back in line with the schema
SSOT — safe to re-run, no owner sign-off gate. Every file documents its own SAFETY and ROLLBACK
in a header comment and is applied directly (via SSH + `psql -f`), same as `_gated/` files, but
without the sign-off step `_gated/` requires.

- `2026-08-22_listing_performance_notnull_drift.sql` (#139/PR #146) — drops a NOT NULL drift on
  `listing_performance` that blocked every scraper upsert for seven weeks.
- `2026-08-22_baseline_drizzle_migrations_journal.sql` (T-267) — INSERTs baseline rows into
  `drizzle.__drizzle_migrations` for every already-applied journaled entry (metadata only, no
  schema/data change), so `drizzle-kit migrate` stops treating a genuinely-current DB as needing
  its whole 14-entry journal replayed from scratch. Applied to BOTH `ipodhan` (prod) and
  `ipodhan_staging` before the assert in Part A above could safely go live — without this
  baseline, `drizzle-kit migrate` against an empty `__drizzle_migrations` table would attempt to
  replay every `CREATE TABLE`, erroring immediately.

- `_gated/` = destructive / type-changing DDL, owner sign-off required before each apply.
- `_repair/` = idempotent, non-destructive drift repair (guard every INSERT/UPDATE with a
  `WHERE NOT EXISTS`-style check so a second run is a no-op), applied directly, no sign-off gate.
- MUST NOT put destructive DDL in `_repair/` to skip the sign-off gate — that defeats Part C.

## CRITICAL RULES

- MUST use `db:push` only for ephemeral/CI DBs and `drizzle-kit migrate` for production; never push to prod.
- MUST keep all destructive / type-changing DDL in `web/drizzle/migrations/_gated/`, OUT of `meta/_journal.json`.
- MUST apply gated files manually in README order via `localhost:15432`, only after owner sign-off, with a read-back.
- MUST treat `packages/shared/src/db/schema.ts` as the schema SSOT; migrations emit to `web/drizzle/migrations` per `drizzle.config.ts`.
- MUST let `scripts/deploy-linux.sh`'s migrations-applied assert (`scripts/assert-migrations-applied.sh`) fail the deploy loudly on any gap between the journal and the target DB — MUST NOT wrap the migrate step in `continue-on-error` or an equivalent silent-swallow.
- MUST keep non-destructive drift repairs in `web/drizzle/migrations/_repair/`, idempotent and directly applicable (no sign-off gate); destructive repairs still go through `_gated/`.
