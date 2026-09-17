# Item 3 / slice S1c — a value from a source the registry marks incapable is refused with a logged reason, never ranked last

Stage 3 ("one source table", plan v2 §2 bullet 3). Ledger: `docs/design/stage-3-ledger.md`. Gate:
`node scripts/check-stage3-dod.mjs --slice S1c`.

## Purpose

After this ships, an incoming BSE issue size (BSE is `capable:false` for `ipos.issue_size` in the
manifest) is refused by the writer with `REJECTED_INCAPABLE_SOURCE` and a `data_conflicts` row, so a
wrong-quantity value can never win by arriving first or by filling an empty slot.

## Serves

- §2.3.5 (capability decided by reality; priority only within capability); plan v2 §2 bullet 3 and
  §1 ("nobody may rank BSE first for issue size while BSE is measured 41 to 76 percent low"); #728
  (the prod class); OD-3 pattern (a retired/incapable source has zero ranks).

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/config/field-manifest.json` `capability` map with `reason` per source; loader cross-check (every ranked source capable) | the capability answer; the writer reads `capability[source].capable === false` through the manifest row (S1a's resolver exposes the row's capability map via `deps.manifest`, no new field on the policy — finding 10) |
| `data-consolidation-service.ts` conflict recording (`data_conflicts` insert path, `tableName`/`rowKey` at 161-162, 997) and the existing skip/refusal logging (1448-1470 `outranksUntrackedValue` refusal log) | the refusal writes through the SAME conflict path with a new `resolutionReason`; no second logger |
| `packages/shared/src/repositories/data-conflicts-repository.ts` + `tests/integration/data-conflicts-repository-hold.integration.test.ts` | the row shape and the integration harness |
| `scraper/src/utils/data-validation.ts` | untouched — capability is not validation |
| `scripts/lib/substance-checks.mjs` / `scripts/audit-detection-floor.mjs` | S6 adds the audit; this slice names it |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/services/data-consolidation-service.ts` | exists | before the priority decision for a flipped field (S1b path): if the manifest row marks `incomingSource` `capable:false`, return `{skipped:true, skipReason:'REJECTED_INCAPABLE_SOURCE'}`, write one `data_conflicts` row with `resolution_reason='REJECTED_INCAPABLE_SOURCE'` and the manifest's `capability.reason`, log at warn with ipoId/table/field/source; an incapable source is NEVER given a rank (no "rank last" fallback) |
| `scraper/tests/unit/services/data-consolidation-service.policy.test.ts` (NEW in S1b) | exists after S1b | new cases |
| `docs/reviews/failure-classes/incapable-source-value-accepted.json` | NEW | failure class row (T-487 layout), regenerate the aggregate |

## Schema

No schema change (`data_conflicts.resolution_reason` is free text — verify with `git grep -n
"resolutionReason" origin/main -- packages/shared/src/db/schema.ts`; if it is an enum, add the value
by migration and re-tier to include the migration).

## Interfaces

```ts
// data-consolidation-service.ts — one new skipReason literal on the existing union
type SkipReason = … | 'REJECTED_INCAPABLE_SOURCE';
```

## Feature flag

`ENABLE_POLICY_WRITER` (S1b) gates it: the refusal exists only on the policy path for flipped
groups. Off → today's behaviour.

## Tests

### Failing test first

On the real consolidator: incoming BSE `ipos.issue_size` against stored CHITTORGARH → skipped with
`REJECTED_INCAPABLE_SOURCE` and one `data_conflicts` row (red today: BSE is ranked and may win an
empty slot); incoming BSE against an EMPTY stored value → still refused (the "fill an empty slot"
mutation); incoming CHITTORGARH (capable) → unaffected. Integration on ipodhan_test: the conflict row
exists with the reason text. Tier: unit + integration.

## Detection

Failure-class row above plus S6's `PULL-WRITE-POLICY` (writer decisions equal policy, incl. "no
`field_sources` row for a (field, source) the manifest marks incapable"). This slice's PR body:
`No detection change: the audit check for incapable-source rows is built in S6 (PULL-WRITE-POLICY); the failure-class row is added here`.

## Staging proof

Next staging wake after the deploy: at least one log line `REJECTED_INCAPABLE_SOURCE
source=BSE table=ipos field=issueSize ipo=<slug>` (BSE runs every cycle and computes issue size for
every live IPO — `computeBSEIssueSize`, #728), one `data_conflicts` row per such IPO with that reason,
and zero new `field_sources` rows with `source='BSE'` for `issueSize` in that cycle.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S1c-1 | `cd scraper && npx vitest run tests/unit/services/data-consolidation-service.policy.test.ts` | exit 0 | local |
| S1c-2 | `git grep -c "REJECTED_INCAPABLE_SOURCE" HEAD -- scraper/src/services/data-consolidation-service.ts` | regex: `^[1-9]` | local |
| S1c-3 | `node scripts/build-detection-registry.mjs --check` | exit 0 | local |
| S1c-4 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/data-conflicts-repository-hold.integration.test.ts` | exit 0 | test-db |
| S1c-5 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from data_conflicts where resolution_reason='REJECTED_INCAPABLE_SOURCE' and created_at > now() - interval '1 day'" --expect-db ipodhan_staging` | regex: `n=[1-9]` | staging |
| S1c-6 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from field_sources where table_name='ipos' and field_name='issueSize' and source='BSE' and updated_at > now() - interval '6 hours'" --expect-db ipodhan_staging` | line: `n=0` | staging |

## Rollback

Flag off (S1b). Conflict rows written are records, not values; nothing to undo.

## Tier, budget and cost

Tier A (write path). `Budget: 30 min wall-clock, 60 tool calls` (half of S1b: a small addition on
S1b's path). Review: Opus, mutations "empty slot" and "capable source unaffected". Why Opus: this is
the guard that keeps the #728 class off the page. Builder: Sonnet.

### Dependencies

Needs S1b.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |

## Known gaps

- The BSE scraper still computes the wrong quantity (#728); this slice stops it being written, it
  does not fix the fetch. #728 stays open with the note "refused at the writer since S1c".
