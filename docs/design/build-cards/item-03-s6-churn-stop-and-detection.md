# Item 3 / slice S6 — stop the no-fetcher churn; three nightly checks (PULL-POLICY, PULL-WRITE-POLICY, PULL-PLAN-RANK); no `sources:` left in the matrix

Stage 3 ("one source table", plan v2 §4 S6 and §4b findings 4, 10, 11). Ledger:
`docs/design/stage-3-ledger.md`. Gate: `node scripts/check-stage3-dod.mjs --slice S6`.

## Purpose

After this ships, a ranked source with no fetcher is recorded once as `NO_FETCHER` and not re-asked
until a fetcher exists (165 rows churn `CHECK_FAILED` every staging cycle today), the nightly floor
proves each night that the manifest equals the spec, that the writer's decisions equal the policy,
and that plan rows equal the policy for their version, and the matrix carries no rank order at all.

## Serves

- Plan v2 §4 S6; §4b finding 4 (the "no `sources:` key remains" test lives here, after every
  writable field has a row); finding 10 (active-override report — delivered in S4's `PULL-OVERRIDES`
  PASS output; this slice adds the per-cycle `policy-shim` count so a row-less field is visible);
  finding 11 (reuse `normalizeChosen`/`areEquivalent` from the consolidator for the writer check).
- OD-42 ("a check nobody reads is no detection") and signal-ownership R3 (a same-day diffing consumer).

**Naming correction to plan v2:** `docs/reviews/detection-checks/pull_write.json` already exists
(`designId: PULL-WRITE`, "plan rows marked SUPPLIED whose write returned skipped", section
`notCoveredByThisManifest`). The plan's "PULL-WRITE (writer decisions equal policy)" is a DIFFERENT
check and gets its own id `pull_write_policy` / `PULL-WRITE-POLICY`; the existing `pull_write` is not
redefined. Likewise `pull_plan` exists (manifest hash unchanged) and `PULL-PLAN-RANK` is new.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/services/field-plan-walk.ts` `NO_FETCHER_REGISTERED` failure string (477) and the CHECK_FAILED/backoff states (499-647) | the new terminal-until-fetcher state is written by the same state machine; no parallel path |
| `scraper/src/services/field-plan-walk-deps.ts` fetcher map | "a fetcher exists" = a key in that map; the check is a lookup, not a config |
| `packages/shared/src/db/schema.ts` `ipoFieldPlan.state` (enum/varchar — read it) | add `NO_FETCHER` (if enum: migration; re-tier to A for that hunk) |
| `data-consolidation-service.ts` `normalizeChosen`, `areEquivalent` (docType precedence, stage 2) | `PULL-WRITE-POLICY` compares last night's `field_sources` rows against the policy with the writer's own equivalence, never a re-implementation |
| `scripts/audit-detection-floor.mjs` `record('<id>'` idiom; `scripts/tests/audit-detection-floor.test.mjs` (case 79: no paper checks) | three `record(` calls, each with a planted-violation test on ipodhan_test |
| `docs/reviews/detection-checks/pull_plan.json`, `pull_write.json`, `pull_walk.json`, `pull_yield.json` (all `notCoveredByThisManifest`) | unchanged in this slice; their build is the stage-4 §4-checks follow-up |
| `scripts/generate-field-manifest.mjs --check` (S0b) | `PULL-POLICY` shells out to it against the DEPLOYED file (`shared/config/<slot>/field-manifest.json`, S5) — manifest equals spec output for the deployed `CONFIG_SHA` |
| `scripts/ops/floor-delta.mjs` | the consumer; NEW ids appear as NEW the first night and are read by the morning gate |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/services/field-plan-walk.ts` | exists | when rank N's source has no fetcher: record `NO_FETCHER` once on the row (with the source), skip that rank, continue to rank N+1; the row is re-asked for that rank only when `walk-deps` registers the fetcher (a `fetchersVersion` string compared at walk time) |
| `scripts/audit-detection-floor.mjs` | exists | `record('pull_policy')`, `record('pull_write_policy')`, `record('pull_plan_rank')` |
| `docs/reviews/detection-checks/pull_policy.json` (NEW), `docs/reviews/detection-checks/pull_write_policy.json` (NEW), `docs/reviews/detection-checks/pull_plan_rank.json` (NEW) | NEW (section `checks`) | consumer: nightly floor-delta |
| `scraper/src/config/field-priority-matrix.ts` | exists | every remaining `sources:` array deleted; `FieldRules.sources` removed from the type; `generatePriorityMatrixSummary` reads the resolver |
| `scraper/tests/unit/config/field-priority-matrix.test.ts` (NEW in S1d) | exists after S1d | asserts `Object.values(FIELD_PRIORITY_MATRIX).every(r => !('sources' in r))` and that every field the writer can receive has a manifest row (else the test names it) |
| `scripts/tests/audit-detection-floor.test.mjs` | exists | three planted-violation cases |

## Schema

`NO_FETCHER` added to the plan-row state set (migration only if the column is a pg enum — verify
first; the card does not assume).

## Interfaces

No new exports. Floor output lines: `[PASS] pull_policy manifest sha256=<hex> equals spec at
CONFIG_SHA=<sha>`, `[PASS] pull_write_policy 0 of <n> sampled field_sources rows disagree with policy`,
`[PASS] pull_plan_rank 0 of <n> plan rows disagree with policy for their version`.

## Feature flag

None new; the walk change sits under `ENABLE_FIELD_PLAN_WALK`.

## Tests

### Failing test first

Walk unit: a row whose rank 1 has no fetcher is `NO_FETCHER` after one walk and NOT re-asked on the
second walk (red today: CHECK_FAILED + re-ask). Floor: each check red on a planted violation (a
hand-edited deployed manifest copy; a `field_sources` row whose source is below a capable higher
rank with a non-equivalent value; a plan row at version 2 with `rank2='BSE'`). Matrix: `sources` in any
rule → red today. Tier: unit + floor node:test on ipodhan_test.

## Detection

Three registry entries above, section `checks`, each with `record(` in the same PR. Regenerate the
aggregate.

## Staging proof

Next floor run (`scripts/audit-detection-floor.mjs` against staging) prints the three ids PASS by
name; `select state, count(*) from ipo_field_plan where table_name='subscriptions' group by 1` shows
`CHECK_FAILED` 0 and `NO_FETCHER` = the former 165 (or the count at that time, recorded); the cycle
after shows the same (no churn).

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S6-1 | `cd scraper && npx vitest run tests/unit/config/field-priority-matrix.test.ts tests/unit/services/field-plan-walk` | exit 0 | local |
| S6-2 | `git grep -c "sources:" HEAD -- scraper/src/config/field-priority-matrix.ts` | exit 1 | local |
| S6-3 | `grep -c -E "record\('pull_(policy|write_policy|plan_rank)'" scripts/audit-detection-floor.mjs` | line: `3` | local |
| S6-4 | `node scripts/build-detection-registry.mjs --check` | exit 0 | local |
| S6-5 | `node --test scripts/tests/audit-detection-floor.test.mjs` | exit 0 | test-db |
| S6-6 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan where table_name='subscriptions' and state='CHECK_FAILED'" --expect-db ipodhan_staging` | line: `n=0` | staging |
| S6-7 | `node scripts/audit-detection-floor.mjs --expect-db ipodhan_staging 2>&1 \| grep -cE "\[PASS\] pull_(policy|write_policy|plan_rank)"` | line: `3` | staging |

## Rollback

Revert the code; `NO_FETCHER` rows are re-asked by the previous walk logic (state unknown to it →
treated as CHECK_FAILED by the resume path — verify in review; if not, the revert includes a one-line
state reset via the repair-tool idiom).

## Tier, budget and cost

Tier B (checks + a walk state; the matrix deletion is of arrays the writer no longer reads after
S1d). `Budget: 30 min wall-clock, 60 tool calls`. Review: Sonnet diff-only; the three floor tests
are the mutation guard. Builder: Sonnet.

### Dependencies

Needs S1d (matrix shim) and S5 (deployed manifest path for `PULL-POLICY`); S4 for the override
report line. Last slice; then the Swap Test (both paths) closes the stage.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §7.6 | R-144 |

## Known gaps

- `PULL-PLAN`, `PULL-WALK`, `PULL-YIELD`, `PULL-WRITE` (existing registry ids) stay
  `notCoveredByThisManifest`; they are stage 4's work (hand-off follow-ups).
- The NSE fetcher does not exist; `NO_FETCHER` makes the gap visible and quiet, it does not fill it.
