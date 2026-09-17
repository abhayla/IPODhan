# Item 3 / slice S0d — widen the `scraper_source` Postgres enum so the writer can store every ranked source (#740)

Stage 3 ("one source table", plan v2). Inserted 2026-09-17 after the S0c builder's stop-the-line. Ledger:
`docs/design/stage-3-ledger.md`. Gate: `node scripts/check-stage3-dod.mjs --slice S0d [--test-db] [--staging]`.

## Purpose

After this ships, every source code the manifest can rank (`REG`, `INVESTORGAIN_GMP` included) can be stored in
every enum-typed provenance column, and a TypeScript widening of the writer union without a matching migration is
red in CI.

## Serves

- #740: `pgEnum('scraper_source', [...])` (`packages/shared/src/db/schema.ts:121`) has seven values; manifest v2
  ranks `REG` on 6 fields and `INVESTORGAIN_GMP` on 1; the writer union gained `REG` in S0c (#741).
- Columns typed by the enum: `field_sources.source` / `previous_source` (schema.ts:1483/1488),
  `data_conflicts.source1` / `source2` / `resolved_source` (:1549-1555),
  `field_extraction_failures.rank_attempted` (:1621). S1b writes the first, S1c the second, the
  consolidator already writes the third (`data-consolidation-service.ts:1219`).
- Hard edge: S1a, S1b, S1c need this slice.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `web/drizzle/migrations/0010_extend_scraper_source_enum.sql`, `0038_journal_drift_new_tables.sql:67-73` | the exact statement shape: `ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS '<v>';` one per value, idempotent |
| `web/drizzle/migrations/meta/_journal.json` (idx 43 = `20260911033922_nice_baron_zemo`) + `npm run db:generate` from `web/` | the migration is GENERATED from the schema.ts edit, never hand-named; review the SQL it emits and keep only the two `ADD VALUE IF NOT EXISTS` lines if drizzle emits anything else |
| `scripts/tests/check-migration-journal.test.mjs`, `scripts/tests/migration-name-collision.test.mjs`, `web/tests/unit/db/migrations.test.ts` | the existing journal/name gates; they must stay green |
| `scripts/assert-schema-drift.ts` (`npm run audit:schema-drift`) | the real-data proof against `ipodhan_test` after `db:migrate` |
| `scraper/tests/unit/config/field-source-codes.test.ts` (S0c) `extractUnionMembers` + the ScraperSourceValue ⊂ union assertion | widen: `ScraperSourceValue` becomes EQUAL to the writer union, and a new assertion parses the `pgEnum('scraper_source', [...])` array from schema.ts and asserts it equals the writer union |
| `packages/shared/src/repositories/field-extraction-failures-repository.ts:20` `ScraperSourceValue` and its duplicate `web/lib/repositories/field-extraction-failures-repository.ts` | add `'INVESTORGAIN_GMP'` and `'REG'` to BOTH copies (the web copy is a duplicate the S0c review measured; do not delete it in this slice) |
| `docs/ops/prod-ops-recipes.md` | recipe line: enum widening is additive, needs no data backfill, cannot be rolled back by dropping a value (Postgres has no `DROP VALUE`); rollback = leave the value unused |

### Changes

| Path | State | Change |
|---|---|---|
| `packages/shared/src/db/schema.ts:121-129` | exists | add `'INVESTORGAIN_GMP'` and `'REG'` to the enum array (order: append at the end) |
| `web/drizzle/migrations/<generated>.sql` + `meta/_journal.json` + `meta/<snapshot>.json` | NEW (generated) | two `ALTER TYPE "scraper_source" ADD VALUE IF NOT EXISTS ...` statements; nothing destructive; not under `_gated/` |
| the two `ScraperSourceValue` copies | exist | + `'INVESTORGAIN_GMP'`, + `'REG'` |
| `scraper/tests/unit/config/field-source-codes.test.ts` | exists | subset assertion → equality; new assertion: pg enum array == writer union |
| `docs/ops/prod-ops-recipes.md` | exists | the recipe line above |

## Schema

Additive enum widening only. Postgres 16: `ADD VALUE IF NOT EXISTS` runs inside the drizzle migration transaction;
the new values are usable from the next transaction (nothing in the same migration uses them). No table rewrite,
no lock beyond the type.

## Interfaces

```
-- web/drizzle/migrations/20260917101006_clammy_titania.sql (additive; precedent 0010)
ALTER TYPE "public"."scraper_source" ADD VALUE IF NOT EXISTS 'INVESTORGAIN_GMP';
ALTER TYPE "public"."scraper_source" ADD VALUE IF NOT EXISTS 'REG';
-- after: enum_range(null::scraper_source) = ADMIN,DRHP,NSE,BSE,API_FALLBACK,MONEYCONTROL,CHITTORGARH,INVESTORGAIN_GMP,REG
-- TS: ScraperSource (db/types.ts) == ScraperSource (field-priority-matrix.ts) == ScraperSourceValue (both repositories) == the pgEnum array
```

## Feature flag

None. No code path writes `REG`/`INVESTORGAIN_GMP` into these columns until S1b/S1c; this slice only makes the
store able to hold them.

## Tests

### Failing test first

The new assertion in `field-source-codes.test.ts` (pg enum array == writer union) is red on origin/main after
#741 (`REG` in the union, absent from the enum); green after the schema.ts edit. The migration's proof is the
real-data run below, not a unit test.

## Detection

`No detection change: audit:schema-drift already compares schema.ts to the live database; the new unit test pins TS-union-vs-enum parity in CI`.

## Staging proof

After the next staging window deploy runs `db:migrate` (the deploy script applies journaled migrations):
`select enum_range(null::scraper_source)` through the tunnel on `ipodhan_staging` lists both values. Read by
identity: the enum's value list, the migration tag in `drizzle.__drizzle_migrations`.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S0d-1 | `cd scraper && npx vitest run tests/unit/config/field-source-codes.test.ts` | exit 0 | local |
| S0d-2 | `grep -c "'REG'" packages/shared/src/db/schema.ts packages/shared/src/repositories/field-extraction-failures-repository.ts web/lib/repositories/field-extraction-failures-repository.ts` | regex: `(?s)(.*:[1-9].*){3}` | local |
| S0d-3 | `grep -l "ADD VALUE IF NOT EXISTS 'REG'" web/drizzle/migrations/*.sql` | regex: `\.sql$` | local |
| S0d-4 | `node scripts/tests/check-migration-journal.test.mjs` | exit 0 | local |
| S0d-5 | `node scripts/tests/migration-name-collision.test.mjs` | exit 0 | local |
| S0d-6 | `node scripts/check-stage3-dod.mjs --sql "select array_to_string(enum_range(null::scraper_source), ',')" --expect-db ipodhan_test` | regex: `INVESTORGAIN_GMP.*REG\|REG.*INVESTORGAIN_GMP` | test-db |
| S0d-7 | `node scripts/check-stage3-dod.mjs --sql "select array_to_string(enum_range(null::scraper_source), ',')" --expect-db ipodhan_staging` | regex: `INVESTORGAIN_GMP.*REG\|REG.*INVESTORGAIN_GMP` | staging |
| S0d-8 | `cd scraper && npx vitest run tests/unit/config/field-source-codes.test.ts -t "literal"` | exit 0 | local |

## Rollback

Postgres cannot drop an enum value. Revert the code commit (schema.ts, unions, test); the two extra values stay in
the type, unused. No data is touched either way.

## Tier, budget and cost

Tier A (a migration that will run on production). `Budget: 30 min wall-clock, 60 tool calls`. Review: Opus,
adversarial — mutation: remove one `ADD VALUE` line and show S0d-3/S0d-6 go red; drop `REG` from one union copy
and show S0d-1 goes red. Why Opus: the migration rides the Saturday 2026-09-19 production release with #713; a
wrong or destructive statement there has no undo. Builder: Sonnet.

### Dependencies

Needs S0c (#741, the widened writer union). S1a, S1b, S1c need this slice. Production: the migration is applied
by the Saturday release together with #713's journaled migrations (owner decision in the Friday brief).

## Rules implemented

| Design section | Rule ids |
|---|---|
| §1.1 | R-155 |

## Known gaps

- `web/lib/repositories/field-extraction-failures-repository.ts` is a duplicate of the shared repository; folding it
  is a separate cleanup, not this slice.
- `data-consolidation-service.ts` and `scraper-metrics-tracker.ts` index `Record<ScraperSource, …>` non-exhaustively
  under `strict:false` (S0c review MINOR); harmless today, listed so it is not "forgotten".
