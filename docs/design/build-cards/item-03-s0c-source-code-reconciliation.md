# Item 3 / slice S0c — one mapping from manifest source codes to writer sources (DOC, REG, IG, API_FALLBACK)

Status: DONE 2026-09-17 PRs #741 proof 2026-09-17 15:33 cycle

Stage 3 ("one source table", plan v2 §4b finding 3). Ledger: `docs/design/stage-3-ledger.md`. Gate:
`node scripts/check-stage3-dod.mjs --slice S0c`.

## Purpose

After this ships, every source code the manifest can rank has exactly one, tested mapping to the
source the writer stores in `field_sources.source` plus the document-type constraint that travels with
it, in one module that the walk, the generator's self-check and (in S1) the writer all import.

## Serves

- Plan v2 §4b finding 3: the spec ranks `REG` 21 times and `IG` 3 times; `sourceCodeSchema` has
  `REG` and the document types but not `IG`/`API_FALLBACK`; the writer's `ScraperSource`
  (`packages/shared/src/db/types.ts:68`: `'ADMIN'|'DRHP'|'NSE'|'BSE'|'MONEYCONTROL'|'CHITTORGARH'|
  'INVESTORGAIN_GMP'|'API_FALLBACK'`) has neither `DOC` nor `REG`. A price-band-advertisement write
  arrives labelled `DRHP` with its type in `data_lineage.docType`
  (`data-consolidation-service.ts:791`).
- Finding 11 (reuse): `mapManifestSourceToScraperSource` (`field-plan-walk.ts:765-766`) is the one
  existing map (`DOC`→`DRHP`, identity otherwise) — it becomes the single map, moved, not copied.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/services/field-plan-walk.ts:758-766` `mapManifestSourceToScraperSource` and its use at 790 | the map; move the function to the new config module and re-export it from the walk so the 3 existing tests keep importing it |
| `scraper/src/config/field-manifest-schema.ts` `sourceCodeSchema` | add `INVESTORGAIN_GMP` is already there; add `IG` is NOT the fix — the generator (S0b) emits `INVESTORGAIN_GMP`; add `API_FALLBACK` so a manifest may rank it |
| `packages/shared/src/db/types.ts:68` `ScraperSource` (and the duplicate unions at `packages/shared/src/types/types.ts:73`, `scraper/src/config/field-priority-matrix.ts:9`, `field-extraction-failures-repository.ts:20`) | add `'REG'` to each union — measured four copies; the slice lists all four in the PR body and a unit test asserts they are equal sets |
| `scraper/src/services/filing-persister.ts` "SOURCE ENUM NOTE" + `scraperSourceForDocType` (always `'DRHP'`) | unchanged: document writes keep arriving as `DRHP` + `docType`; the map encodes that |
| `docs/design/field-source-resolution.spec.mjs` source labels (R-155: `CG`, `MC`, `IG`, `REG`, `DOC`, `ADMIN`) | the manifest-side vocabulary the generator translates; this slice owns the translation table |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/config/field-source-codes.ts` | NEW (module: config) | `MANIFEST_TO_WRITER: Record<SourceCode, {writerSource: ScraperSource; docTypes?: DocType[]}>` covering `DOC`→`DRHP` (docTypes: the manifest row's `documentType` order), `DRHP/RHP/PROSPECTUS/CORRIGENDUM/PRICE_BAND_AD`→`DRHP` with the single docType, `REG`→`REG`, `INVESTORGAIN_GMP`→`INVESTORGAIN_GMP`, `API_FALLBACK`→`API_FALLBACK`, `NSE/BSE/CHITTORGARH/MONEYCONTROL/ADMIN`→ identity; `mapManifestSourceToScraperSource` moved here; `writerSourceToManifestCode(source, docType?)` inverse |
| `scraper/src/services/field-plan-walk.ts` | exists | line 765 body replaced by `export { mapManifestSourceToScraperSource } from '../config/field-source-codes.js'` |
| `scraper/src/config/field-manifest-schema.ts` | exists | `sourceCodeSchema` gains `API_FALLBACK`; no refine: `MANIFEST_TO_WRITER` is typed `Record<ManifestSourceCode, …>`, so a code without an entry fails `tsc`, and the unit test iterates `sourceCodeSchema.options` |
| the two pure-TS `ScraperSource` unions (`db/types.ts`, `field-priority-matrix.ts`) | exist | `'REG'` added |
| `scraper/tests/unit/config/field-source-codes.test.ts` | NEW | every `sourceCodeSchema` value maps; inverse round-trips; `DOC` maps to `DRHP`; the two pure-TS unions are equal sets; `ScraperSourceValue` (pg-enum-backed) asserted a SUBSET of the writer union, not required equal (S0d closes the gap) |
| `packages/shared/src/db/schema.ts` | exists | NO change in this slice — `field_sources.source` (schema.ts:1483) is `scraperSourceEnum('source')`, a real pg enum (schema.ts:121: `ADMIN\|DRHP\|NSE\|BSE\|API_FALLBACK\|MONEYCONTROL\|CHITTORGARH`), also typing `data_conflicts.source1`/`source2`/`resolved_source` (schema.ts:1549-1555). Line 501's `varchar('source', ...)` is a DIFFERENT table (`gmp_records`) — this card's earlier "varchar" claim was wrong. Widening this enum to add `INVESTORGAIN_GMP`/`REG` is a migration: **slice S0d** (Tier A, issue #740), landing before S1a. |

## Schema

No schema change (see the last Files row; a pg enum would make this a different slice).

## Interfaces

```ts
// scraper/src/config/field-source-codes.ts
export type ManifestSourceCode = z.infer<typeof sourceCodeSchema>;
export const MANIFEST_TO_WRITER: Readonly<Record<ManifestSourceCode, { writerSource: ScraperSource; docTypes?: DocumentType[] }>>;
export function mapManifestSourceToScraperSource(code: string): ScraperSource;          // moved from field-plan-walk.ts:765
export function writerSourceToManifestCode(source: ScraperSource, docType?: string): ManifestSourceCode;
```

## Feature flag

None: a mapping table with no behaviour change until S1 reads it (the walk's behaviour is unchanged
because the moved function returns the same values).

## Tests

### Failing test first

`scraper/tests/unit/config/field-source-codes.test.ts` (NEW) is red by absence; the union-equality
assertion is red on b0fafc6b (`REG` missing from all four). `field-manifest-schema` test: a manifest
ranking `API_FALLBACK` is refused today and accepted after. Tier: unit.

## Detection

`No detection change: a pure mapping module with a unit test; the writer does not read it until S1b`.

## Staging proof

Not applicable (no runtime behaviour change). The next staging cycle after the window deploy runs the
walk with the moved map: `walk-proof.mjs --expect-db ipodhan_staging` still ≥3 MATCH, 0 mismatch.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S0c-1 | `cd scraper && npx vitest run tests/unit/config/field-source-codes.test.ts` | exit 0 | local |
| S0c-2 | `git grep -c "mapManifestSourceToScraperSource" HEAD -- scraper/src/config/field-source-codes.ts` | regex: `:[1-9][0-9]*$` | local |
| S0c-3 | `git grep -n "manifestSource === 'DOC' ? 'DRHP'" HEAD -- scraper/src/services/field-plan-walk.ts` | exit 1 | local |
| S0c-4 | `git grep -c "'REG'" HEAD -- packages/shared/src/db/types.ts scraper/src/config/field-priority-matrix.ts` | regex: `(?s)(.*:[1-9].*){2}` | local |
| S0c-5 | `cd scraper && npx vitest run tests/unit/services/field-plan-walk` | exit 0 | local |
| S0c-6 | `git grep -c "'REG'" HEAD -- packages/shared/src/types/types.ts web/lib/db/types.ts` | exit 1 | local |
| S0c-7 | `git grep -c "'REG'" HEAD -- packages/shared/src/repositories/field-extraction-failures-repository.ts packages/shared/src/db/schema.ts` | exit 1 | local |

## Rollback

Revert the commit; no data written.

## Tier, budget and cost

Tier B. `Budget: 30 min wall-clock, 60 tool calls`. Review: Sonnet diff-only. Builder: Sonnet.

### Dependencies

None hard; lands before S0b's 190-row manifest can rank `REG`/`API_FALLBACK`. S1a imports it.

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

| Design section | Rule ids |
|---|---|
| §1.1 | R-155 |

## Known gaps

- `IG` and `CG` are spec labels, not manifest codes; the generator (S0b) emits `INVESTORGAIN_GMP` and
  `CHITTORGARH`. This slice does not add `IG`/`CG` to the schema.
- Registrar (`REG`) has no fetcher in the walk (`field-plan-walk-deps.ts`); ranking it is legal after
  this slice, asking it is S6's `NO_FETCHER` case, and building the fetcher is a follow-up after the
  stage (plan §4 last paragraph names NSE first).
- The pg enum `scraper_source` (schema.ts:121) lacks `INVESTORGAIN_GMP` and `REG` — it types
  `field_sources.source` (schema.ts:1483) and `data_conflicts.source1`/`source2`/`resolved_source`
  (schema.ts:1549-1555). Widening it is a DB migration, out of scope for this Tier B slice. **Slice
  S0d** (Tier A, issue #740) must land before S1a, which will need the writer to persist `REG`/
  `INVESTORGAIN_GMP` rows through these columns.
