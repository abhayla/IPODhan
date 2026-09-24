# Item 3 / slice S4 — the override layer: `field_source_overrides`, resolver layer 2, the CLI, and the PULL-OVERRIDES check

Status: DONE 2026-09-18 PRs #760 proof owed (board: merged, proof owed)

Stage 3 ("one source table", plan v2 §2 layer 2 and §4 S4). Ledger: `docs/design/stage-3-ledger.md`.
Gate: `node scripts/check-stage3-dod.mjs --slice S4`.

## Purpose

After this ships, the owner or supervisor can change a field's rank order for one IPO or all IPOs
with one command, it takes effect at the next wake with no deploy, it is validated before it is
stored, it expires (30 days by default, owner D-2), and the nightly floor lists every active override
and fails on an expired or invalid one.

## Serves

- §2.3.5 layers, R-055 (an override is validated before it takes effect: capable sources only, S-05
  honoured, refused and logged never partially applied); OD-51; plan v2 §2 table row 2; §4b finding
  10 (an active-override report distinct from the fail-on-expired check). Owner D-2: expiry 30 days.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/config/field-source-policy.ts` (NEW in S1a: `deps.overrides` parameter reserved) | layer 2 plugs in; callers unchanged |
| `scraper/src/config/field-manifest-loader.ts` capability cross-check; `docs/specs/per-ipo-due-step-pipeline.md` S-05 (E-1 fields may not rank the document; the 10 E-1 fields are `o.e1` in the spec and class T in the manifest) | the same validation reused by the CLI and the resolver |
| `scraper/scripts/lib/repair-tool.ts` (`openRepairDb`, `--expect-db`, prod guard) | the CLI's DB access and guards (it writes rows, so it is a repair-class tool under `scraper/scripts/`) |
| `packages/shared/src/db/schema.ts` `fieldProtectionMetadata` (1312) | the model for a per-IPO, per-field row with `set_by`; layer 3 stays untouched |
| `scripts/audit-detection-floor.mjs` + `docs/reviews/detection-checks/*.json` + `scripts/build-detection-registry.mjs` | the floor check and its registry entry |
| `scripts/ops/floor-delta.mjs` | the consumer (NEW/GONE/SAME by id) — no new consumer |

### Changes

| Path | State | Change |
|---|---|---|
| `packages/shared/src/db/schema.ts` + migration | exists | table `field_source_overrides` (see Schema) |
| `packages/shared/src/repositories/field-source-overrides-repository.ts` | NEW | `listActive(now)`, `set(row)`, `expire(id)`, `findFor(table, column, ipoId|null)` |
| `scraper/src/config/field-source-policy.ts` (NEW in S1a) | exists after S1a | layer 2: an active, unexpired override for (table, column, ipoId) beats one for (table, column, null) beats the registry; `origin = {kind:'override', id, expiresAt}`; expired rows are ignored (never deleted by the resolver) |
| `scraper/scripts/field-source-override.ts` | NEW | `set --table ipos --column issue_size [--ipo <slug|id>] --ranks CHITTORGARH,DOC --reason "…" [--expires-in-days 30] --expect-db <db> [--apply]`; `list`; `expire <id>`; validation: every rank capable per the manifest, E-1 field may not rank DOC/any document type, ranks distinct, reason ≥ 20 chars; refused → exit 1 with the reason, nothing stored |
| `scripts/audit-detection-floor.mjs` | exists | `record('pull_overrides', …)`: FAIL on any active override that is expired-but-unexpired-flag, or invalid against the CURRENT manifest (a registry change can invalidate an override); PASS lists every active override by id/field/ipo/expiry |
| `docs/reviews/detection-checks/pull_overrides.json` | NEW (section `checks`) | consumer: nightly floor-delta |
| tests (Tests) | NEW/exist | |

## Schema

```ts
export const fieldSourceOverrides = pgTable('field_source_overrides', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: varchar('table_name', { length: 64 }).notNull(),
  fieldName: varchar('field_name', { length: 64 }).notNull(),        // manifest column name (snake_case), as the manifest keys it
  ipoId: uuid('ipo_id').references(() => ipos.id, { onDelete: 'cascade' }),   // null = all IPOs
  rank1Source: varchar('rank1_source', { length: 32 }).notNull(),
  rank2Source: varchar('rank2_source', { length: 32 }),
  rank3Source: varchar('rank3_source', { length: 32 }),
  reason: text('reason').notNull(),
  setBy: varchar('set_by', { length: 64 }).notNull(),
  setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  expiredAt: timestamp('expired_at', { withTimezone: true }),          // set by `expire`, never deleted
}, (t) => ({ active: index('idx_fso_active').on(t.tableName, t.fieldName, t.ipoId, t.expiresAt) }));
```
Additive, journaled. Prod: journaled after #713's migrations; applied in the Saturday release only if
the slice is merged and proven by Friday's pre-deploy brief (plan §6).

## Interfaces

```
npx tsx scraper/scripts/field-source-override.ts set --table ipos --column issue_size --ranks CHITTORGARH,DOC --reason "swap test path 2 (owner go 2026-09-17)" --expect-db ipodhan_staging --apply
npx tsx scraper/scripts/field-source-override.ts list --expect-db ipodhan_staging
npx tsx scraper/scripts/field-source-override.ts expire <id> --expect-db ipodhan_staging --apply
```
Resolver: unchanged signature; `origin.kind === 'override'` when layer 2 answered.

## Feature flag

`ENABLE_POLICY_WRITER` (S1b) gates writer use; the walk/generator read layer 2 whenever the table
exists (a missing table = layer 2 absent, logged once, never a crash: prod before its migration).

## Tests

### Failing test first

Unit (`field-source-override.test.ts`, `field-source-policy.test.ts`): an override naming an
incapable source (BSE for issue_size) is refused; an override ranking DOC on `ipos.open_date` (E-1) is
refused; an expired override is ignored by the resolver; an ipo-scoped override beats a global one.
Integration (`field-source-overrides-repository.integration.test.ts`, added to the pr-gate run list):
set → resolver returns override origin on ipodhan_test; expire → registry origin again. Tier: unit +
integration. Floor: `scripts/tests/audit-detection-floor.test.mjs` case for `pull_overrides` red on a
planted expired row.

## Detection

`pull_overrides` (NEW, `section: checks`, `record('pull_overrides'` lands in the same PR). Registry
regenerated (`node scripts/build-detection-registry.mjs`).

## Staging proof

**Swap Test, path 2 (corrected 2026-09-24, #893)**: the original wording checked one field with no
regard to its plan row's state, and missed that `upsertGeneratedRows`'s old
`manifest_version < EXCLUDED.manifest_version` guard never fires for an override (an override never
bumps the manifest version, by design — §2.3.5 "no deploy, no version bump") — so the swap silently
never reached an already-planned row. Corrected procedure, run INSIDE an OD-19 data slot boundary
(00:00 / 08:00 / 14:00 IST — a wake outside a slot proves nothing, since the plan pass runs on the
slot cadence, not on demand):

1. **Non-SUPPLIED case first.** Pick a field whose plan row is NOT yet `SUPPLIED` for a named IPO
   (`select ... from ipo_field_plan where field_name=... and state <> 'SUPPLIED'`). `set` swaps DOC
   and CHITTORGARH for `ipos.issue_size` on staging (all IPOs); wake inside the next OD-19 slot; the
   row now shows `rank1_source='CHITTORGARH'`, `policy_origin='override:<id>'`, `manifest_version`
   UNCHANGED from before the swap — the version-unaware re-rank (#893) is the thing under test, so a
   version bump between reads would hide a regression back to the old guard.
2. **SUPPLIED case, checked separately.** Pick a different field whose plan row IS already
   `SUPPLIED` for a named IPO, and whose `chosen_source` is the source the override is about to
   demote. After the same `set` + wake, the row is REOPENED (`state='PENDING'`, `policy_origin =
   'override:<id>'`, rank list narrowed to sources above the old `chosen_source`) — `chosen_source`
   itself is untouched until a higher-ranked source actually answers. A SUPPLIED row whose
   `chosen_source` is still rank1 under the new order stays SUPPLIED and unchanged (OD-73 negative
   case) — check one of those too, on a third field, to prove the reopen is not indiscriminate.
3. Walk log `policy origin=override:<id>` for the named IPO; a write for that IPO carries
   `data_lineage.policyOrigin='override:<id>'`.
4. `expire <id>`; wake inside the NEXT OD-19 slot; both rows show `registry:<v>` again (the
   non-SUPPLIED row's ranks revert; the reopened row, if by then re-settled, is left as whatever
   source actually supplied it).

Read by identity (row id, ipo slug, field name) and recorded in the ledger — never a bare row count.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S4-1 | `cd scraper && npx vitest run tests/unit/scripts/field-source-override.test.ts tests/unit/config/field-source-policy.test.ts` | exit 0 | local |
| S4-2 | `node scripts/ci/check-migration-journal.mjs` | exit 0 | local |
| S4-3 | `node scripts/build-detection-registry.mjs --check` | exit 0 | local |
| S4-4 | `grep -c "record('pull_overrides'" scripts/audit-detection-floor.mjs` | regex: `^[1-9]` | local |
| S4-5 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/field-source-overrides-repository.integration.test.ts` | exit 0 | test-db |
| S4-6 | `npx tsx scraper/scripts/field-source-override.ts set --table ipos --column issue_size --ranks BSE,DOC --reason "dod: incapable must be refused" --expect-db ipodhan_staging` | exit 1 | staging |
| S4-7 | `npx tsx scraper/scripts/field-source-override.ts list --expect-db ipodhan_staging` | exit 0 | staging |
| S4-8 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan where policy_origin like 'override:%'" --expect-db ipodhan_staging` | regex: `n=\d+` | staging |

## Rollback

`expire <id>` (one command, logged, the row stays as history). The migration is additive; reverting
the code leaves an unused table.

## Tier, budget and cost

Tier A (migration + a write path that changes what the writer accepts, from a CLI). `Budget: 60 min
wall-clock, 120 tool calls`. Review: Opus, mutations: skip validation → refused test must fail;
ignore expiry → resolver test must fail; global beats ipo-scoped → precedence test must fail. Why
Opus: a same-day production knob on the writer with no PR in front of it. Builder: Sonnet.

### Dependencies

Needs S1a's resolver signature and S1b's writer adoption. Nothing depends on it except the Swap Test.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054, R-055 |

## Known gaps

- No admin UI for overrides; the CLI is the interface (design §7.6 chose git + CLI over a UI).
- An override on a field in an unflipped group changes the plan/walk order but not the writer's
  decision until that group flips (S1b `flipped`); the `list` output says so per row.
