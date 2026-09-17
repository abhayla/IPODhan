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
| `scraper/config/field-manifest.json` `capability` map with `reason` per source; loader cross-check (every ranked source capable) | the capability answer. **CORRECTION K1 (measured against origin/main e0f6fc06):** S1a's resolver does NOT expose the capability map — `FieldSourcePolicy` returned exactly `{ranks, documentType?, origin, na}`. The writer must NOT load the manifest separately (a second config read on the write path is a second source of truth). S1c therefore EXTENDS the resolver, where the manifest entry is already in hand, with `incapable: Readonly<Record<string, string>>` (source code -> the manifest's stated reason), returned on BOTH return paths including the `na: true` early return — an N/A field still has a capability map. Existing callers destructure named fields and are unaffected. |
| `data-consolidation-service.ts` conflict recording and the existing skip/refusal logging | the refusal writes through the SAME conflict path with a new `resolutionReason`; no second logger. **CORRECTION K3:** the line numbers above were pre-S1b. Post-S1b (origin/main e0f6fc06) the untracked refusal lives at ~:1501, the priority decision at ~:2325, same-source refresh at ~:2372. The conflict method is `this.dataConflictsRepository.upsertConflict({ipoId, tableName, rowKey, fieldName, source1, value1, source2, value2, resolvedSource, resolutionReason, severity})`, called at :2198, :2281 and :2581; the `TERMINAL_STATUS_KEPT` call at :2281 is the shape S1c copies. |
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

No schema change. **CORRECTION K3 (measured):** `data_conflicts.resolution_reason` is
`varchar(100)` free text (`packages/shared/src/db/schema.ts:1558`), NOT an enum — so the card's
"if it is an enum, add the value by migration" clause does not trigger and this slice ships no
migration.

## Interfaces

**CORRECTION K2 (measured):** there is NO `SkipReason` union in `data-consolidation-service.ts`
(the only `skipReason` is a local field at :2236). The invented type is deleted. A refusal returns
the EXISTING result-object shape with `conflictReason`, following the `untracked_existing_value_kept`
refusal at :1501-1515:

```ts
// data-consolidation-service.ts — the refusal return, same shape as every other refusal
return {
  fieldName,
  finalValue: storedValue ?? null,     // the stored value is kept, untouched — null for an empty slot
  chosenSource: existingSource ?? incomingSource,
  hadConflict: true,
  conflictSeverity: 'WARNING',
  conflictReason: 'REJECTED_INCAPABLE_SOURCE',
  rejectedSources: [{ source: incomingSource, value: incomingValue, reason: 'REJECTED_INCAPABLE_SOURCE' }],
};
```

```ts
// field-source-policy.ts — the resolver gains the capability map (K1)
incapable: Readonly<Record<string, string>>;   // manifest source code -> capability reason
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
- S1b's `isTimeBased` still accepts and ignores `tableName` — a flipped field's time-based-ness is
  still decided by the legacy matrix, so the four-function signature is uniform but only three of
  the four functions actually consult the resolver.
- S1b DoD row S1b-3 greps the ranking literal out of the writer file ONLY — it proves RELOCATION,
  not PRESERVATION. A stronger row asserts the literal exists exactly once in
  `field-priority-matrix.ts`.
- No flipped field marks a DOCUMENT source `capable:false` in today's manifest, so the manifest-code
  mapping (`writerSourceToManifestCode`, `DRHP` -> `DOC`) cannot be discriminated on live data. Test
  (xv) pins it by extending ONE row's capability map through a module mock and driving the real
  writer; if a flipped field later marks a document code incapable, replace that mock with the real
  row.
