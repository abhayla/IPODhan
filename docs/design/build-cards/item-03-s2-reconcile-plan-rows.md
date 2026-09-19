# Item 3 / slice S2 — reconcile plan rows on a manifest version bump (#731) and plan the SME rows the generator skips

Status: DONE 2026-09-18 PRs #757 proof 2026-09-19 board

Stage 3 ("one source table", plan v2 §4 S2 and §4b finding 13). Ledger: `docs/design/stage-3-ledger.md`.
Gate: `node scripts/check-stage3-dod.mjs --slice S2`.

## Purpose

After this ships, every non-terminal `ipo_field_plan` row whose `manifest_version` is older than the
registry's is re-ranked to the current policy by a productized, dry-run-default, schema-checked tool,
and SME IPOs have plan rows for the fields the version-1 manifest never planned for them.

## Serves

- #731: plan rows were never re-ranked when the manifest changes (`ON CONFLICT (ipo_id, table_name,
  row_key, field_name) DO NOTHING`, `ipo-field-plan-repository.ts:238` — this row describes the state
  at the time this slice was written); staging has 454 rows / 64 IPOs all at version 1 with 192
  issue-size-family rows carrying `rank2 = BSE` (hand-off state). Item 3 slice S7 (#732) later
  narrowed the `DO NOTHING` to `DO UPDATE`, so ORDINARY generator cycles now re-rank a non-SUPPLIED
  row in place on a version increase — this tool (S2) remains the one-time/occasional catch-up for
  rows that are stale RIGHT NOW (written before S7 shipped, or belonging to an IPO the generator has
  stopped cycling), not a duplicate of what S7 does per cycle going forward.
- §4b finding 13: the DB guard must be a schema check (table + `manifest_version` column present),
  and prod lacks the table until #713 lands.
- Defect-fix contract item 4 (existing bad rows repaired by a re-runnable tool) and item 5
  (`assert-repair-held.mjs --cycles 2`).

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/scripts/lib/repair-tool.ts` (`openRepairDb`, prod guard, `--expect-db`, idempotency) + `scripts/ci/require-repair-tool-module.mjs` (every `scraper/scripts/repair-*.ts` must use it) | the tool's skeleton; the file MUST be `scraper/scripts/repair-*.ts` (an `.mjs` evades the lint — old item-03 card correction 1) |
| `scraper/scripts/repair-provenance-for-absent-values.ts` (most recent repair tool; read it for the current idiom) | pattern |
| `scraper/src/config/field-source-policy.ts` (NEW in S1a) + `scraper/src/services/field-plan-generator.ts` `resolveIpoTypeKey` | the ranks a row must have at the current version |
| `packages/shared/src/repositories/ipo-field-plan-repository.ts` | add `updateRanksForVersion(rows)` next to the insert; the tool calls the repository, never raw SQL |
| `scripts/assert-repair-held.mjs` + `scripts/tests/assert-repair-held.test.mjs` | the two-cycle proof; add invariant `plan-rank2-never-bse-for-issue-size` |
| `tests/integration/ipo-field-plan-repository.integration.test.ts` | extend for the update path |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/scripts/repair-plan-rows-to-manifest-version.ts` | NEW | dry-run default; `--apply`; `--expect-db <name>` required; refuses unless `ipo_field_plan` and its `manifest_version` column exist (schema query, not a name check); refuses prod unless `--prod-has-migrated` AND the schema check passes; for each non-terminal row (`state <> 'SUPPLIED'`) with `manifest_version < current`: new ranks from the resolver for that IPO's type, `manifest_version`, `policy_origin` updated; SUPPLIED rows untouched; prints per-IPO, per-field before→after and counts; also INSERTS rows the current manifest plans for an IPO but the table lacks (the SME rows), through the repository insert |
| `packages/shared/src/repositories/ipo-field-plan-repository.ts` | exists | `updateRanksForVersion(rows)`; `listBelowVersion(version)` |
| `scraper/tests/unit/scripts/repair-plan-rows-to-manifest-version.test.ts` | NEW | dry-run writes nothing; schema-check refusal; prod refusal |
| `tests/integration/ipo-field-plan-repository.integration.test.ts` | exists | on ipodhan_test with the REAL repository: a version-1 row `(DOC, BSE, null)` becomes `(DOC, CHITTORGARH, null)` at version 2; a SUPPLIED row is untouched; an SME IPO gains its `subscriptions.*` rows |
| `scripts/assert-repair-held.mjs` | exists | invariant added |

## Schema

No schema change (uses S1a's `policy_origin`).

## Interfaces

```
npx tsx scraper/scripts/repair-plan-rows-to-manifest-version.ts --expect-db ipodhan_staging            # dry run, prints the plan
npx tsx scraper/scripts/repair-plan-rows-to-manifest-version.ts --expect-db ipodhan_staging --apply
  exit 0 done/dry; exit 1 refused (schema | expect-db | prod)
```

## Feature flag

None (an operator tool). The generator's SME planning fix (if the generator itself skips SME rows —
verify: `resolveIpoTypeKey` returns `SME_BSE`/`SME_NSE` and the manifest rows have those keys after
S0b, so the skip should vanish with S0b; if rows are still missing, the tool's insert covers them and
the card records why) sits behind the existing `ENABLE_FIELD_PLAN`.

## Tests

### Failing test first

The integration case "version-1 row with BSE at rank 2 becomes DOC, CHITTORGARH, null at version 2"
on the real repository is red by absence of the update method; the schema-check refusal is red by
absence. Tier: integration (pr-gate run list) + unit for the CLI guards.

## Detection

S6's `PULL-PLAN-RANK` (plan rows equal policy for their version) is the standing check; this PR:
`No detection change: PULL-PLAN-RANK is built in S6 and covers this class; the repair is proven by assert-repair-held --cycles 2`.

## Staging proof

Dry run output pasted in the PR; `--apply` on staging (owner-approved staging write, ledger line);
then `select rank2_source, count(*) from ipo_field_plan where field_name='issue_size' group by 1`
shows no `BSE`; `select count(*) from ipo_field_plan p join ipos i on i.id=p.ipo_id where i.segment='SME'
and p.table_name='subscriptions'` > 0; `node scripts/assert-repair-held.mjs
plan-rank2-never-bse-for-issue-size --cycles 2` PASS after two real wakes.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S2-1 | `cd scraper && npx vitest run tests/unit/scripts/repair-plan-rows-to-manifest-version.test.ts` | exit 0 | local |
| S2-2 | `node scripts/ci/require-repair-tool-module.mjs` | exit 0 | local |
| S2-3 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/ipo-field-plan-repository.integration.test.ts` | exit 0 | test-db |
| S2-4 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan where field_name='issue_size' and rank2_source='BSE' and state <> 'SUPPLIED'" --expect-db ipodhan_staging` | line: `n=0` | staging |
| S2-5 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan where manifest_version < 2 and state <> 'SUPPLIED'" --expect-db ipodhan_staging` | line: `n=0` | staging |
| S2-6 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan p join ipos i on i.id=p.ipo_id where i.segment='SME' and p.table_name='subscriptions'" --expect-db ipodhan_staging` | regex: `n=[1-9]` | staging |
| S2-7 | `node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/plan-rank2-never-bse-for-issue-size.mjs --cycles 2` | exit 0 | staging |

## Rollback

The tool is re-runnable and idempotent; rows carry `manifest_version`, so a bad re-rank is undone
by re-running against the previous registry version (S5 config deploy of the previous sha, then the
tool). SUPPLIED rows are never touched, so no supplied value is lost.

## Tier, budget and cost

Tier A (data repair on a live table). `Budget: 30 min wall-clock, 60 tool calls`. Review: Opus,
mutations: dry-run must write nothing; schema check must refuse a table without the column; SUPPLIED
rows untouched. Why Opus: a repair tool that can rewrite every plan row on staging and, after #713,
prod. Builder: Sonnet.

### Dependencies

Needs S0b (version 2) and S1a (resolver + `policy_origin`). Prod run only after #713's migrations
(Saturday release) and on the owner's word.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |

## Known gaps

- The 165 rows `CHECK_FAILED` every cycle (NSE has no fetcher) are not this slice's; S6 stops the churn.
