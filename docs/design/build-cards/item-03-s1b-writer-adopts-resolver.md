# Item 3 / slice S1b — the writer decides from the resolver: tableName threaded, untracked rule redefined, reconciliation groups as config, MAINBOARD rule on create

Status: DONE 2026-09-17 PRs #746 proof 2026-09-17 22:2x cycle

Stage 3 ("one source table", plan v2 §2 and §4b findings 1, 2, 5, 8, 10). Ledger:
`docs/design/stage-3-ledger.md`. Gate: `node scripts/check-stage3-dod.mjs --slice S1b`.

## Purpose

After this ships, `data-consolidation-service.ts` decides every conflict for a field in a flipped
reconciliation group from `resolveFieldSourcePolicy(...).ranks` keyed by table AND column, a ranked
source may replace a value with no provenance, and the flip is a validated config list of groups —
so swapping rank 1 and rank 2 of `ipos.issue_size` changes what the writer accepts without a code
change.

## Serves

- OD-5, OD-44 (§6.6: groups flip together, open and upcoming first, two clean cycles, per-field
  rollback), §7.6 (reconciliation groups are configuration — R-142); plan v2 §2 bullet 3.
- §4b finding 1: `getFieldRules(fieldName)` (`field-priority-matrix.ts:906`) takes a bare camelCase
  column; the writer's priority calls at `data-consolidation-service.ts:2268-2269` never pass
  `input.tableName`; column names collide across tables.
- Finding 2: `outranksUntrackedValue` (`:382-386`) requires `rank < sources.length - 1`; with two
  ranks CHITTORGARH could no longer heal a provenance-less value (the 27 staging rows, the #728 prod
  class).
- Finding 5: `allowsSameSourceRefresh` falls back to `rules.sources` (`field-priority-matrix.ts:945`);
  the price-band document-precedence branch (`:2330`, `incomingDocumentOutranksStored`) depends on it.
- Finding 8: on create, segment/listing_exchanges are themselves manifest fields → resolve with
  MAINBOARD and re-resolve next wake; identity fields always use the MAINBOARD list.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/services/data-consolidation-service.ts` — `outranksUntrackedValue` (382-386), `getFieldRules` uses (1055, 1166), the priority decision (2268-2269), doc precedence (2330), `input.tableName`/`rowKey` already in scope at every call site (119-121, 161-162, 845, 1157) | thread `tableName`+`rowKey` into the four decision functions; no new data has to be plumbed |
| `scraper/src/config/field-priority-matrix.ts` — `getFieldRules` (906), `getSourcePriority` (923), `isTimeBased` (931), `allowsSameSourceRefresh` (942), `incomingDocumentOutranksStored` (878) | the four functions gain `(fieldName, tableName?)` and consult the resolver FIRST when the field's group is flipped; the matrix object stays (S1d shrinks it) |
| `scraper/src/config/field-source-policy.ts` (NEW in S1a) + `scraper/src/config/field-source-codes.ts` (NEW in S0c) | the ranks and the writer-source map |
| `scraper/src/config/feature-flags.ts` `slotAwareFlagDefault` (64-84) | the new flag's staging-on default |
| `scraper/src/config/field-manifest-loader.ts` + `-schema.ts` | validation pattern for the new `switchover.json` |
| `docs/design/data-sourcing-pull-model.md:2864-2868` | the group definitions (issue size, fresh issue, OFS, price band, lot size move together) |
| `scraper/tests/helpers/consolidation-result-fixture.ts` (typed fixture, stage 2) | unit tests build inputs from the shared factory, never hand-typed objects |
| `scraper/tests/unit/services/data-consolidation-service*.test.ts`, `tests/integration/child-row-consolidation-financials.integration.test.ts` | extend |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/config/switchover.ts` (NEW) + `scraper/config/switchover.json` (NEW) | NEW | `{ "version": 1, "groups": { "issue-size": ["ipos.issue_size","ipo_details.fresh_issue","ipo_details.ofs_issue","ipos.price_range_min","ipos.price_range_max","ipos.lot_size"], … }, "flipped": ["issue-size"], "identityFields": ["ipos.segment","ipos.listing_exchanges"] }`; zod schema; every field named must exist in the manifest; a field may belong to one group only; validated at process start next to the manifest |
| `scraper/src/services/data-consolidation-service.ts` | exists | (1) `tableName`/`rowKey` threaded into `outranksUntrackedValue`, `getSourcePriority`, `isTimeBased`, `allowsSameSourceRefresh` calls; (2) for a field in a flipped group: priority from `policy.ranks` (ADMIN first by a fixed invariant, then ranks); untracked rule = "ranked in `policy.ranks` may replace an untracked value"; (3) create path: `ipoType` = MAINBOARD when segment unknown; identity fields always MAINBOARD; (4) unflipped fields keep today's matrix path byte-for-byte |
| `scraper/src/config/field-priority-matrix.ts` | exists | the four functions accept `tableName?`; when the field's group is flipped they delegate to the resolver; `rules.sources` fallback in `allowsSameSourceRefresh` (945) replaced by the resolver for flipped fields |
| `scraper/src/index.ts` | exists | `validateSwitchoverAtStartup()` beside the manifest check (616-622) |
| tests (see Tests) | exist/NEW | |

## Schema

No schema change.

## Interfaces

```ts
// scraper/src/config/switchover.ts
export interface Switchover { version: 1; groups: Record<string, string[]>; flipped: string[]; identityFields: string[] }
export function loadSwitchover(path?: string): Switchover;              // throws on invalid
export function groupOf(table: string, column: string): string | null;
export function isFlipped(table: string, column: string): boolean;
// field-priority-matrix.ts — signatures widen, callers unchanged where they pass one arg
export function getSourcePriority(fieldName: string, source: ScraperSource, tableName?: string): number;
export function isTimeBased(fieldName: string, tableName?: string): boolean;
export function allowsSameSourceRefresh(fieldName: string, source: ScraperSource, tableName?: string): boolean;
```

## Feature flag

`ENABLE_POLICY_WRITER` (NEW, `slotAwareFlagDefault`: staging ON when unset, prod/local OFF). Off:
the writer is byte-for-byte today's behaviour. On: flipped groups decide from the resolver. Per-field
rollback (OD-44) = remove the group from `switchover.json` `flipped` and deploy it (config-deploy
is the follow-up above).

## Tests

### Failing test first (all on the REAL consolidator via the shared fixture factory)

1. `data-consolidation-service.policy.test.ts` (NEW, unit): incoming DOC `issue_size` against stored
   CHITTORGARH wins; incoming CHITTORGARH against untracked stored value wins under two-rank policy
   (red today: `outranksUntrackedValue` returns false at `sources.length-1`); `ipo_details.face_value`
   and `ipos.face_value` resolve to different rank lists (red today: no table in the key); an E-1
   field (`ipos.open_date`) never accepts a document value; a create with unknown segment resolves
   MAINBOARD.
2. `switchover.test.ts` (NEW): a group naming a field not in the manifest is refused; a field in two
   groups is refused.
3. `allowsSameSourceRefresh` with `tableName`: a flipped field returns from policy ranks, not
   `rules.sources` (red today).
4. Integration (`child-row-consolidation-financials.integration.test.ts` extended): the `ipos.issue_size`
   write decision on ipodhan_test with the flag on matches the policy.
Tier: unit + integration.

## Detection

`No detection change: the writer-vs-policy audit (PULL-WRITE-POLICY) is specified and built in S6, after every writable field has a policy row`.
Registry entry for it is added in S6, not here (a paper check would fail case 79 of the floor test).

## Staging proof

`walk-proof.mjs --expect-db ipodhan_staging`: ≥3 IPOs MATCH, 0 mismatches, chosen source for
`issue_size` never BSE; `data_conflicts` rows for `issue_size` written in that wake = 0; TWO clean
consecutive wakes for the `issue-size` group (OD-44) read by IPO and group. Swap Test path 1 (S5)
re-run here: after the config deploy with swapped ranks, the writer accepts CHITTORGARH over the
stored DOC value for one named IPO; then swapped back.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S1b-1 | `cd scraper && npx vitest run tests/unit/services/data-consolidation-service.policy.test.ts tests/unit/config/switchover.test.ts` | exit 0 | local |
| S1b-2 | `git grep -n "getSourcePriority(fieldName, existingSource)" HEAD -- scraper/src/services/data-consolidation-service.ts` | exit 1 | local |
| S1b-3 | `git grep -c "sources.length - 1" HEAD -- scraper/src/services/data-consolidation-service.ts` (expect exit 1) **and** `git grep -c "sources.length - 1" HEAD -- scraper/src/config/field-priority-matrix.ts` (expect `1`) | writer: exit 1; matrix: `1` | local |
| S1b-4 | `git grep -c "rules.sameSourceRefreshSources ?? rules.sources" HEAD -- scraper/src/config/field-priority-matrix.ts` | exit 1 | local |
| S1b-5 | `node -e "const s=require('./scraper/config/switchover.json');console.log('flipped='+s.flipped.join(','));process.exit(s.flipped.includes('issue-size')?0:1)"` | line: `flipped=issue-size` | local |
| S1b-6 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/child-row-consolidation-financials.integration.test.ts` | exit 0 | test-db |
| S1b-7 | `node scripts/ops/walk-proof.mjs --expect-db ipodhan_staging` | regex: `mismatch(es)?[=: ]+0` | staging |
| S1b-8 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from field_sources where table_name='ipos' and field_name='issueSize' and source='BSE' and updated_at > now() - interval '1 day'" --expect-db ipodhan_staging` | line: `n=0` | staging |

## Rollback

Flag off (`ENABLE_POLICY_WRITER=false` in the staging env) restores today's decisions immediately at
the next wake; per-group rollback via `switchover.json` + S5. Values already written under the policy
are provenance-tracked (`field_sources`) and are re-decided by the next wake; nothing is deleted.

## Tier, budget and cost

Tier A (the write path of every field in a flipped group). `Budget: 60 min wall-clock, 120 tool
calls`. Review: Opus, adversarial, mutation tests on each of the four decision functions (flip the
untracked rule, drop `tableName`, swap ranks, blank `flipped`). Why Opus: this is the writer that
publishes issue size; a wrong decision is a wrong number on the page. Builder: Sonnet (may need a
second round; budget covers one re-brief).

### Dependencies

Needs S1a (resolver) and S0c (source map). S1c, S1d and S4 build on this interface.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |
| §7.6 | R-142 |

## Card corrections

Decided by the supervisor after measuring this card against 0abf8a37 (S1a merged); landed as a
docs hunk in the S1b build PR.

- **C1.** NEW `scraper/src/config/field-name-case.ts`: re-exports `columnToCamelCase` from
  `@ipodhan/shared/utils/duplicate-ipo-merge` and exports its inverse `fieldNameToColumn(fieldName:
  string): string` (camel->snake: each uppercase letter -> `_` + lowercase; digits and existing
  underscores untouched). The walk's private `toCamelFieldName` was DELETED and replaced by the
  import (one concept, one place; no third copy). The writer converts its camel `fieldName` to the
  resolver's snake `column` with `fieldNameToColumn` at the four decision sites.
- **C2.** NEW test `scraper/tests/unit/config/field-name-case.test.ts`: for EVERY key of the real
  `scraper/config/field-manifest.json` (190; asserts the count equals
  `Object.keys(manifest.fields).length`, no hard-coded subset), splits `table.column`, asserts
  `fieldNameToColumn(columnToCamelCase(column)) === column`.
- **C3.** `scraper/config/switchover.json` ships INSIDE the release (a committed file under
  `scraper/config/`, like `field-manifest.json` before S5). It is NOT config-deployed and NOT
  symlinked by S5 (`deploy-config.sh` copies only `field-manifest.json`). Known gaps below gains:
  "config-deploy of switchover.json = follow-up (extend deploy-config.sh, separate Tier A PR);
  until then a flip is a code deploy." The Feature-flag paragraph's rollback sentence is reworded
  accordingly (above).
- **C4.** Card line numbers refreshed to the ones actually measured on 0abf8a37: `field-priority-
  matrix.ts` 879/907/924/932/943/946; `data-consolidation-service.ts` 382-386/1448/2268/2292/
  2315/2330; `index.ts` 617/1624.
- **C5.** `switchover.json` validation rules stay as originally specified (every named field
  exists in the manifest; a field in at most one group; `flipped` names existing groups;
  `identityFields` exist in the manifest). Addition: the loader throws with the offending key
  named in the error message (see `switchover.ts`'s `loadSwitchover`).

## Known gaps

- Only the `issue-size` group is flipped in this slice. Other groups are flipped one per config
  deploy after two clean cycles each (OD-44); the ledger records each flip.
- GMP writes (`data-persister.ts` ~1758-1775) bypass the child-row consolidator and are untouched
  until S1d's shim statement and a later item.
- config-deploy of switchover.json = follow-up (extend deploy-config.sh, separate Tier A PR);
  until then a flip is a code deploy (C3).
- `isTimeBased(fieldName, tableName)` accepts a `tableName` parameter it ignores — no flipped
  field is time-based today. Honour it when a time-based field joins a group (S1c/S1d);
  review round 1 (MINOR-3), 2026-09-17.
