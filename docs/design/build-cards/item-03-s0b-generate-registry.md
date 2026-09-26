# Item 3 / slice S0b — generate the registry: manifest version 2 from the spec, CI refuses drift, resolved-plan diff as the review artifact

Status: DONE 2026-09-17 PRs #738 proof 2026-09-17 22:2x cycle

Stage 3 ("one source table", plan v2 §4). Ledger: `docs/design/stage-3-ledger.md`. Gate:
`node scripts/check-stage3-dod.mjs --slice S0b`.

## Purpose

After this ships, `scraper/config/field-manifest.json` is produced by one generator from the spec for
every sourced field (190 on b0fafc6b) and the three phase-1 IPO types, carries `version: 2`, cannot
drift from the generator without failing the PR gate, and every rank change is reviewed as "these N
fields now resolve differently", never as a JSON diff — and the manifest is validated at process start
on staging, which it is not today.

## Serves

- OD-5 / §2.3.5 (priority is configuration), §7.6 ("the manifest is never hand-edited; the generator
  is the only writer; CI refuses drift"; "a rank change is reviewed as a diff of the resolved plan").
- Plan v2 §4 S0b; §4b findings 6 (S2 needs version 2) and 12.
- Supervisor addition in plan §4b: staging env does not set `ENABLE_FIELD_MANIFEST`, so
  `validateFieldManifestAtStartup` (`scraper/src/index.ts:616-622`) is a no-op everywhere today.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/config/field-manifest.json` — 10 hand-written rows, `version: 1`, keys `table.column` | the generator must reproduce these 10 rows byte-for-byte in content (rank per type, capability with reasons, unit, na, documentType) before it emits the other 180 |
| `scraper/src/config/field-manifest-schema.ts` — `sourceCodeSchema` (13 codes), `fieldManifestEntrySchema` (`class`, `documentType`, `rank` record with `MAINBOARD` required, `capability` partial map, `na`, `unit`), `fieldManifestSchema` with `version: z.literal(1)` | the shape; `version` becomes `z.union([z.literal(1), z.literal(2)])` and the loader's capability cross-check (every ranked source capable) stays the validator |
| `scraper/src/config/field-manifest-loader.ts` — `loadFieldManifest(path)` | unchanged API; it is what CI, the generator's self-check and `validateFieldManifestAtStartup` call |
| `scraper/tests/unit/config/field-manifest-content.test.ts` and `field-manifest-loader.test.ts` | extend for version 2 and 190 rows; do not add a third manifest test file |
| `docs/design/field-source-resolution.spec.mjs` — `F`, `RESOLVE(f, type)`, `TYPES`, `pool()` (capability in), `o.na`, `o.doc`, `o.e1` | the ONLY input to the generator; S0a made it true first |
| `docs/design/generate-appendix-a.mjs` | the pattern for "generate + `--check`"; the manifest generator is a sibling under `scripts/` because CI runs it against the scraper config |
| `scripts/ci/check-migration-journal.mjs` + `scripts/tests/check-migration-journal.test.mjs` | the pattern for a CI drift check with a node:test that drives the real script as a subprocess |
| `.github/workflows/pr-gate.yml` `gate` job (line 42) | where the drift check runs; add one step, no new job |
| `scripts/assert-env-keys.sh` `SCRAPER_REQUIRED_KEYS` (line 72-95) and `$ROOT/shared/env/staging/scraper.env` (hand-provisioned, `deploy-linux.sh:30-44`) | `ENABLE_FIELD_MANIFEST=true` is added to the staging env by hand (owner-approved staging write, recorded in the ledger) and to the required-keys list |

### Changes

| Path | State | Change |
|---|---|---|
| `scripts/generate-field-manifest.mjs` | NEW | imports the spec; for each class D/T/X/W/M field emits `{class, documentType (from o.doc via the DOC-type map the spec already uses for Appendix A), documentSection, rank: {MAINBOARD, SME_BSE, SME_NSE} from RESOLVE with `—`/`N/A` removed and manifest codes (`CG`→`CHITTORGARH`, `IG`→`INVESTORGAIN_GMP`, `REG`, `DOC`), capability: every source in the pool → `{capable:true, reason}` and the spec's `CG_CANNOT`/capability exclusions → `{capable:false, reason}`, na, unit}`; writes `version: 2`, `generatedFrom`; `--check` exits 1 with the resolved-plan diff when the committed file differs; `--diff <base-sha>` prints "N fields resolve differently: table.column type: [old] → [new]" |
| `scripts/ci/check-field-manifest-current.mjs` | NEW | runs the generator in `--check` mode against the committed file and prints the resolved-plan diff vs `--base <sha>`; exit 1 on drift |
| `scripts/tests/check-field-manifest-current.test.mjs` | NEW | node:test: (1) committed manifest == generator output → exit 0; (2) a one-character hand edit to a temp copy → exit 1 naming the field; (3) the 10 existing rows are reproduced with identical rank/capability/unit/na |
| `scraper/src/config/field-manifest-schema.ts` | exists | `version: z.union([z.literal(1), z.literal(2)])`; `sourceCodeSchema` unchanged here (S0c reconciles codes) |
| `scraper/config/field-manifest.json` | exists | regenerated: 190 rows, `version: 2` |
| `.github/workflows/pr-gate.yml` | exists (workflow file — PR merges only :00–:05) | one step in `gate`: `node scripts/ci/check-field-manifest-current.mjs --base "${{ github.event.pull_request.base.sha }}"` |
| `scraper/src/index.ts` | exists | at the manifest-validation call (line ~1598) log one line `field-manifest: version=<v> fields=<n> sha256=<12 hex>` so every cycle log names the config it ran with |
| `scripts/assert-env-keys.sh` | exists | `ENABLE_FIELD_MANIFEST` added to `SCRAPER_REQUIRED_KEYS` |

## Schema

No schema change.

## Interfaces

```js
// scripts/generate-field-manifest.mjs
//   node scripts/generate-field-manifest.mjs --write            # rewrites scraper/config/field-manifest.json
//   node scripts/generate-field-manifest.mjs --check            # exit 1 + diff if the committed file differs
//   node scripts/generate-field-manifest.mjs --diff <base-sha>  # resolved-plan diff vs that sha's manifest
export function generateManifest(spec /* {F, RESOLVE} */): FieldManifest;          // pure
export function resolvedPlanDiff(a: FieldManifest, b: FieldManifest): Array<{field, type, from: string[], to: string[]}>;
```
Manifest row example (version 2, generated, `ipos.issue_size`): identical to today's row except
`"version": 2` at the top; a new row example, `financial_data.eps`:
```json
"financial_data.eps": { "class": "D", "documentType": "RHP", "documentSection": "C6",
  "rank": { "MAINBOARD": ["DOC","CHITTORGARH"], "SME_BSE": ["DOC","CHITTORGARH"], "SME_NSE": ["DOC","CHITTORGARH"] },
  "capability": { "DOC": {"capable": true, "reason": "restated financials table, C6"},
                  "CHITTORGARH": {"capable": true, "reason": "KPI block on the detail page (probe 2026-09-09)"} },
  "na": ["NCD","INVITS","REITS","TENDER","BUYBACK"], "unit": "rupee" }
```

## Feature flag

`ENABLE_FIELD_MANIFEST` (`feature-flags.ts:480`, plain `=== 'true'`). Today: unset on staging and
prod. This slice sets it `true` in the staging env only (hand edit of
`$ROOT/shared/env/staging/scraper.env`, logged), so the loader validates the 190-row file at every
staging wake. Prod stays unset until the S1 group proof holds (plan §6).

## Tests

### Failing test first

1. `scripts/tests/check-field-manifest-current.test.mjs` (NEW) case (3): on b0fafc6b the generator does not
   exist, so the test is red by absence; once written, it is red until the generator reproduces the
   10 rows exactly.
2. Case (2): the CI check must go red on a one-character hand edit — asserted with a temp copy.
3. `field-manifest-loader.test.ts`: `version: 2` accepted, `version: 3` refused.

Tier: unit (`scraper/tests/unit/config/`) for the loader/schema; `scripts/tests/` node:test for the
generator and CI check.

## Detection

Registry entry `docs/reviews/detection-checks/manifest_generator_drift.json` (NEW, section
`notCoveredByThisManifest`: it runs in CI, not the nightly floor) naming
`scripts/ci/check-field-manifest-current.mjs` (NEW) as the check and the PR gate as the consumer. Run
`node scripts/build-detection-registry.mjs` and commit the regenerated aggregate.

## Staging proof

Cycle log of the first staging wake after the window deploy prints
`field-manifest: version=2 fields=190 sha256=<hex>` and no `loadFieldManifest` throw; walk proof
unchanged (`node scripts/ops/walk-proof.mjs --expect-db ipodhan_staging` still ≥3 MATCH, 0 mismatch).

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S0b-1 | `node scripts/generate-field-manifest.mjs --check` | exit 0 | local |
| S0b-2 | `node -e "const m=require('./scraper/config/field-manifest.json');const n=Object.keys(m.fields).length;console.log('version='+m.version+' fields='+n);process.exit(m.version===2&&n===190?0:1)"` | line: `version=2 fields=190` | local |
| S0b-3 | `node --test scripts/tests/check-field-manifest-current.test.mjs` | exit 0 | local |
| S0b-4 | `cd scraper && npx vitest run tests/unit/config/field-manifest-loader.test.ts tests/unit/config/field-manifest-content.test.ts` | exit 0 | local |
| S0b-5 | `grep -c "check-field-manifest-current.mjs" .github/workflows/pr-gate.yml` | line: `1` | local |
| S0b-6 | `grep -c "ENABLE_FIELD_MANIFEST" scripts/assert-env-keys.sh` | regex: `^[1-9]` | local |
| S0b-7 | `ssh rfp-vps "grep -c '^ENABLE_FIELD_MANIFEST=true' /var/www/ipodhan/shared/env/staging/scraper.env"` | line: `1` | staging |
| S0b-8 | `ssh rfp-vps "grep -h 'field-manifest: version=2 fields=190' /var/log/ipodhan-scraper-wake-staging.log /var/www/ipodhan/current-staging/scraper/logs/*.log 2>/dev/null \| tail -1"` | regex: `version=2 fields=190 sha256=[0-9a-f]{12}` | staging |

## Rollback

Revert the commit (manifest back to the 10-row version 1 file; schema accepts both). Unset
`ENABLE_FIELD_MANIFEST` in the staging env if the loader refuses the file. No data was written.

## Tier, budget and cost

Tier B (ordinary code, CI green; the workflow-file hunk is one added step and merges only :00–:05).
`Budget: 30 min wall-clock, 60 tool calls`. Review: Sonnet, diff-only, 10 min. Builder: Sonnet.

### Dependencies

Needs S0a merged (the spec is the generator's only input). S2 depends on this slice (version 2).

## Rules implemented

<!-- hand-owned: not generated by apply-rule-ownership.mjs, see docs/design/apply-rule-ownership.mjs HAND_OWNED_MARKER -->

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |

## Known gaps

- Source codes `IG`/`API_FALLBACK` and the writer's missing `DOC`/`REG` are reconciled in S0c, which
  lands BEFORE this generator emits 190 rows in a PR that can merge (S0c may ship first if S0b's
  generator hits an unknown code; the ledger records the order actually taken).
- Fields whose class is D/T/X/W/M but whose resolved MAINBOARD rank list is empty after `N/A`
  filtering get NO row (the generator prints them); count recorded in the PR body.
