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
- **Production** uses `npx drizzle-kit migrate` (the "Run database migrations" step in
  `.github/workflows/deploy.yml`, `continue-on-error: true` because the schema may already be
  current). This applies ONLY the migrations recorded in `meta/_journal.json`, in order.

- MUST NOT run `drizzle-kit push` against production — it bypasses the journal and can drop
  columns. Prod is migrate-only.

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

## CRITICAL RULES

- MUST use `db:push` only for ephemeral/CI DBs and `drizzle-kit migrate` for production; never push to prod.
- MUST keep all destructive / type-changing DDL in `web/drizzle/migrations/_gated/`, OUT of `meta/_journal.json`.
- MUST apply gated files manually in README order via `localhost:15432`, only after owner sign-off, with a read-back.
- MUST treat `packages/shared/src/db/schema.ts` as the schema SSOT; migrations emit to `web/drizzle/migrations` per `drizzle.config.ts`.
