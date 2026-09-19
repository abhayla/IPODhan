# Item 3 / slice S1a — the one resolver: `resolveFieldSourcePolicy`, read by the plan generator and the walk

Status: DONE 2026-09-17 PRs #745 proof 2026-09-17 22:2x cycle

Stage 3 ("one source table", plan v2 §2). Ledger: `docs/design/stage-3-ledger.md`. Gate:
`node scripts/check-stage3-dod.mjs --slice S1a`.

## Purpose

After this ships, one function answers "which sources, in which order, for this field, table, IPO
type (and IPO)", the plan generator and the walk call it and nothing else, and every plan row records
which configuration produced its ranks.

## Serves

- §2.3.5 (effective priority = the first layer that answers, resolved once per walk and recorded);
  plan v2 §2 ("three layers, one resolver"); §4b finding 10 (the resolver returns ranks and origin
  only; `capable` is the loader's job); finding 11 (reuse the DOC map from S0c).

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/config/field-manifest-loader.ts` `loadFieldManifest()` (parses + capability cross-check) | layer 1 read; the resolver never re-validates |
| `scraper/src/services/field-plan-generator.ts` — `resolveIpoTypeKey(ipo)` (78-83), `generateFieldPlan(ipo, …, manifest)` reading `entry.rank[typeKey]` (113-142: `rank1Source..rank3Source`, `manifestVersion: manifest.version`) | the generator keeps `resolveIpoTypeKey`; its rank lookup becomes one `resolveFieldSourcePolicy` call per field |
| `scraper/src/services/field-plan-walk-deps.ts` `manifestFieldEntry(tableName, fieldName)` (104-107), `manifestDocumentType` (145) and the fetcher map keyed by manifest source | unchanged by this slice — there is no `buildFieldPlanWalkDeps` in this file; production wiring builds `FieldPlanWalkDeps` inline at the `document-cycle.ts` call site and leaves `resolvePolicy` undefined, so it falls to `field-plan-walk.ts`'s own `defaultResolvePolicy` (wraps `resolveFieldSourcePolicy`) — the ONE place the default lives, corrected here after S1a review MAJOR-2 found this row describing a function that does not exist |
| `scraper/src/services/field-plan-walk.ts` — the ask order is built from the PLAN ROW's rank columns today: `attemptOneField` (430-433) and `tryProvisional` (688-691) read `plan.rank1Source..rank3Source`; `NO_FETCHER_REGISTERED` (477); `mapManifestSourceToScraperSource` re-export (769) | both rank lists come from ONE `resolvePolicy({table, column, ipoType, ipoId})` call per field per walk (`policy.ranks`); the plan row's rank columns are no longer the driver (they stay the generator's record; S2 reconciles them) |
| `scraper/src/config/field-source-codes.ts` (S0c) | the DOC→DRHP map the walk's agreement check already uses; unchanged by this slice (the resolver imports nothing from it) |
| `packages/shared/src/db/schema.ts` `ipoFieldPlan` (1698), `rank1_source` (1720), `manifest_version` (1754) | where origin is recorded; see Schema |
| `packages/shared/src/repositories/ipo-field-plan-repository.ts` insert (`ON CONFLICT … DO UPDATE` since item 3 slice S7, #732 — re-ranks a non-SUPPLIED row on a strict version increase; was `DO NOTHING` when this slice was written) | one new column in the insert list; S2 (occasional backfill) and S7 (every generator cycle, from here on) both handle re-ranking |
| `scraper/src/config/feature-flags.ts` `ENABLE_FIELD_PLAN` (266), `ENABLE_FIELD_PLAN_WALK` (356) | no new flag: the resolver is a pure read; generator and walk are already flagged |
| `scraper/tests/unit/services/field-plan-generator.test.ts`, `field-plan-walk*.test.ts`, `tests/integration/field-plan-generation-wiring.integration.test.ts`, `field-plan-walk-resume.integration.test.ts` (in pr-gate run list, pr-gate.yml:782-800) | extend; the integration tests prove the wiring end to end |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/config/field-source-policy.ts` | NEW (module: config) | `resolveFieldSourcePolicy({table, column, ipoType, ipoId?}, deps)`; layer 1 only in this slice (layer 2 arrives in S4 behind the same signature; layer 3 stays the walk's existing `field_protection_metadata` skip, §2.7) |
| `scraper/src/services/field-plan-generator.ts` | exists | rank lookup replaced by the resolver; `manifestVersion` and the new `policy_origin` written from `policy.origin` |
| `scraper/src/services/field-plan-walk.ts` (`field-plan-walk-deps.ts` untouched — see the reuse row above) | exist | ask order = `policy.ranks` from one resolver call per field per walk (both `attemptOneField` and `tryProvisional`); `resolvePolicy` defaults to `defaultResolvePolicy` (wraps `resolveFieldSourcePolicy`) in `field-plan-walk.ts` itself, the one place production wiring's undefined dep falls back to; `policy_origin` recorded with the outcome via a typed `RecordOutcomeCallParams` (S1a review CRITICAL-1); one log line per field `policy origin=registry:2 ranks=DOC,CHITTORGARH`; when `policy.ranks` differs from the row's rank columns, log `policy ranks differ from plan row` once per field, no write (S2 reconciles) |
| `packages/shared/src/db/schema.ts` + migration | exists | `ipo_field_plan.policy_origin varchar(64) NULL` (e.g. `registry:2`, later `override:<id>`) — see Schema |
| `packages/shared/src/repositories/ipo-field-plan-repository.ts` | exists | insert list + row mapper carry `policy_origin` |
| tests listed above | exist | extended (see Tests) |

## Schema

```ts
// packages/shared/src/db/schema.ts, inside ipoFieldPlan (line 1698+)
policyOrigin: varchar('policy_origin', { length: 64 }),   // 'registry:<version>' | 'override:<id>' | null (pre-S1a rows)
```
`npm run db:generate` → `ALTER TABLE "ipo_field_plan" ADD COLUMN "policy_origin" varchar(64);`
Additive, journaled (not `_gated/`). Prod has no `ipo_field_plan` table until #713's migrations land
in the Saturday release; this migration is journaled after them.

## Interfaces

```ts
// scraper/src/config/field-source-policy.ts
export interface PolicyQuery { table: string; column: string; ipoType: IpoTypeKey; ipoId?: string }
export interface FieldSourcePolicy {
  ranks: SourceCode[];                       // e.g. ['DOC','CHITTORGARH']; ADMIN never listed (layer 3)
  documentType?: FieldManifestEntry['documentType'];  // the manifest row's ONE document type (measured 2026-09-17 on the 190-row
                                             // manifest: RHP on 103 rows, PRICE_BAND_AD on 52, absent on 35). There is NO per-field
                                             // document-type ORDER anywhere in the data (field-manifest-schema.ts:45 is a single enum);
                                             // precedence among document types stays the writer's incomingDocumentOutranksStored rule
                                             // and the doc fetcher's family order. Absent -> undefined (DOC cannot answer: the fetcher's
                                             // existing CHECK_FAILED 'no documentType in manifest' path is unchanged).
  origin: { kind: 'registry'; version: number } | { kind: 'override'; id: string; expiresAt: string };
  na: boolean;                               // field does not apply to this offering type
}
export interface PolicyDeps { manifest?: FieldManifest /* default loadFieldManifest() */; overrides?: OverrideReader /* S4 */ }
export function resolveFieldSourcePolicy(q: PolicyQuery, deps?: PolicyDeps): FieldSourcePolicy;   // throws on an unknown table.column
export function policyOriginString(o: FieldSourcePolicy['origin']): string;                     // 'registry:2' | 'override:<id>'
```
Worked example: `resolveFieldSourcePolicy({table:'ipos', column:'issue_size', ipoType:'MAINBOARD'})` →
`{ranks:['DOC','CHITTORGARH'], documentType:'PRICE_BAND_AD', origin:{kind:'registry',version:2}, na:false}` (the manifest row `ipos.issue_size` carries `documentType: "PRICE_BAND_AD"` and `rank.MAINBOARD: ["DOC","CHITTORGARH"]`).
`na` is true when the manifest row has no `rank` entry for the query's `ipoType` (the generator's existing skip rule, field-plan-generator.ts:88-93); then `ranks` is `[]`. Layer 2 (`overrides`) is accepted and ignored in this slice.

## Feature flag

None new. Generator behind `ENABLE_FIELD_PLAN`, walk behind `ENABLE_FIELD_PLAN_WALK` (both true on
staging). Rollback is the flag pair, unchanged.

## Tests

### Failing test first

1. `scraper/tests/unit/config/field-source-policy.test.ts` (NEW): red by absence; asserts the
   worked example (including `documentType: 'PRICE_BAND_AD'`), a row with no `documentType` yields `undefined`,
   `na` + `ranks: []` for an IPO type the row does not rank, SME_BSE never returns NSE for `ipos.lot_size`, unknown field throws.
2. `field-plan-generator.test.ts`: a generated row carries `policyOrigin: 'registry:2'` — red today
   (no such column/field).
3. `field-plan-walk` unit: the walk asks sources in the resolver's order when the resolver is
   stubbed to a swapped order (CHITTORGARH before DOC while the plan row says DOC, CHITTORGARH) — red
   today (the walk builds its ask order from the plan row's rank columns, field-plan-walk.ts:430-433).
4. `tests/integration/field-plan-generation-wiring.integration.test.ts`: the inserted row has
   `policy_origin = 'registry:2'` on ipodhan_test — red today.
Tiers: unit + integration (already in the pr-gate run list).

## Detection

Registry entry `docs/reviews/detection-checks/pull_plan_origin.json` (NEW,
`notCoveredByThisManifest` until S6 implements it in the floor): every non-terminal plan row at the
current manifest version carries a non-null `policy_origin`. Consumer: per-cycle failure reading.

## Staging proof

After the window deploy + a manual wake: `select policy_origin, count(*) from ipo_field_plan group by
1` on ipodhan_staging shows `registry:2` for every row planned this cycle (older rows null until S2);
walk log line `policy origin=registry:2` for `ipos.issue_size` of a named live IPO;
`walk-proof.mjs --expect-db ipodhan_staging` ≥3 MATCH, 0 mismatch.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S1a-1 | `cd scraper && npx vitest run tests/unit/config/field-source-policy.test.ts tests/unit/services/field-plan-generator.test.ts` | exit 0 | local |
| S1a-2 | `git grep -c "resolveFieldSourcePolicy" HEAD -- scraper/src/services/field-plan-generator.ts scraper/src/services/field-plan-walk-deps.ts scraper/src/services/field-plan-walk.ts` | regex: `(?s)(.*:[1-9].*){2}` | local |
| S1a-3 | `git grep -c "policy_origin" HEAD -- packages/shared/src/db/schema.ts` | regex: `:[1-9]$` | local |
| S1a-4 | `node scripts/ci/check-migration-journal.mjs` | exit 0 | local |
| S1a-5 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/field-plan-generation-wiring.integration.test.ts` | exit 0 | test-db |
| S1a-6 | `node scripts/ops/walk-proof.mjs --expect-db ipodhan_staging` | regex: `MATCH.*[3-9]` | staging |
| S1a-7 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from ipo_field_plan where policy_origin is null and manifest_version = 2 and state <> 'SUPPLIED'" --expect-db ipodhan_staging` | line: `n=0` | staging |

test-db rows: `DATABASE_URL` names `ipodhan_test` AND `REDIS_URL=redis://localhost:6379`.

## Rollback

Revert the code commit; the added column is additive and stays (nullable, harmless). Flags unchanged.

## Tier, budget and cost

Tier A (schema migration + the walk's read path). `Budget: 60 min wall-clock, 120 tool calls`.
Review: Opus with mutation tests (swap the stubbed order → the walk must follow; drop the origin →
the integration test must fail). Why Opus: a migration and the walk's ask order on every field.
Builder: Sonnet.

### Dependencies

Needs S0b (version 2 manifest, 190 rows) and S0c (source-code map). S1b builds on the interface.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |

## Known gaps

- Layer 2 (overrides) is a stub parameter here; S4 fills it. The signature is fixed now so S4 needs
  no caller change (finding 6: "S4 needs only S1b's interface").
- The walk still has no NSE/REG fetcher; `NO_FETCHER_REGISTERED` behaviour is S6's.
- The doc fetcher keeps its own `manifestDocumentType` lookup (field-plan-walk-deps.ts:145); routing it
  through `policy.documentType` is a follow-up after S1b, not this slice.
- The walk does not rewrite the plan row's rank columns when the policy differs from them; it logs the
  difference once per field and S2 reconciles (#731).
- Card correction 2026-09-17 17:5x IST: the earlier `documentTypeOrder: DocumentType[]` interface and its
  five-type worked example described data that does not exist; replaced by the manifest's single `documentType`.
