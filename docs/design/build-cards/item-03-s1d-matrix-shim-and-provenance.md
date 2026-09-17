# Item 3 / slice S1d — the matrix keeps normalization and validation only; a logged shim for fields with no policy row; provenance names the configuration

Stage 3 ("one source table", plan v2 §2 bullets 4-5 and §4b finding 4). Ledger:
`docs/design/stage-3-ledger.md`. Gate: `node scripts/check-stage3-dod.mjs --slice S1d`.

## Purpose

After this ships, `field-priority-matrix.ts` no longer decides order for any field that has a policy
row, a field with no row falls back to its matrix `sources` through one logged shim (once per cycle
per field), every `field_sources` row written under the policy stores which configuration produced it,
and the 22 genuinely dead snake_case keys are gone. NOT 27: of the 27 snake_case keys measured on origin/main 2026-09-18, FIVE (`open_date`, `close_date`, `lot_size`, `gmp_price`, `company_description`) have a camelCase sibling in the matrix and are asserted by the existing W-49 regression test `scraper/tests/unit/config/field-priority-matrix-camelcase-siblings.test.ts`. Deleting them was measured to break 3 tests in that file (including its "found at least one snake/camel sibling pair" sanity check). They STAY.

## Serves

- Plan v2 §2 bullets 4-5; §4b finding 4 (deleting every `sources` array would drop live fields
  such as GMP to the default order — GMP is written by `data-persister.ts` ~1758-1775, which never
  calls the child-row consolidator; the "no `sources:` key remains" test moves to S6).
- §7.6 "provenance names the configuration"; R-158 (retired fields never written — inherited from
  the old item-03 card, whose 27-dead-key measurement this slice executes).

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/src/config/field-priority-matrix.ts` — `FIELD_PRIORITY_MATRIX` (129-800, 77-78 keys; 27 with an underscore, re-measured 2026-09-18 on origin/main: 78 total keys, 27 snake_case, of which 22 are deletable and 5 have camelCase siblings that must stay), `getFieldRules` (906), `generatePriorityMatrixSummary` (976) | delete the 22 deletable keys (Group C's 16 live fields get their manifest row from S0b, so no minimal TS entry is needed — verify each of the 16 is in the 190-row manifest before deleting); `sources` arrays STAY on the remaining rows as the shim source |
| `data-consolidation-service.ts` `dataLineage` on `field_sources` (791; schema 1491 `data_lineage jsonb`) | provenance: add `policyOrigin` to the lineage object for policy-path writes |
| `packages/shared/src/db/schema.ts:1465-1520` `fieldSources` | no column change; `data_lineage` is jsonb |
| the old card's detection idea matrix-manifest-drift.json (never built, never committed) | superseded by S6's `PULL-POLICY`; not created |
| EIGHT `field-priority-matrix-*.test.ts` files already exist under `scraper/tests/unit/config/` (camelcase-siblings, conflict-convergence, filing-source, gmp, identifiers, lot-floor, policy-same-source-refresh, price-band) | EXTEND the nearest existing file; a plain `field-priority-matrix.test.ts` does not exist, but do NOT add a parallel file for an assertion one of these already owns. `camelcase-siblings` already owns the sibling-pair assertions |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/src/config/field-priority-matrix.ts` | exists | 22 dead keys deleted (named in the test; the 5 with camelCase siblings STAY — see Purpose); `getSourcePriority`/`isTimeBased`/`allowsSameSourceRefresh` for a field WITH a policy row delegate to the resolver regardless of flip state once `ENABLE_POLICY_WRITER` is on (S1b limited this to flipped groups; this slice widens to "has a row" while the `flipped` list still controls which groups' WRITE decisions change — a non-flipped field with a row logs `policy-shadow` with both answers and keeps the matrix decision); a field with NO row uses `rules.sources` and logs `policy-shim field=<table.column>` once per process |
| `scraper/src/services/data-consolidation-service.ts` | exists | `dataLineage.policyOrigin = policyOriginString(policy.origin)` on every write decided by the policy |
| `scraper/tests/unit/config/field-priority-matrix.test.ts` (NEW) | exists/NEW | the 27 keys absent; the 5 Group-A camelCase siblings unchanged; a row-less field (`gmpRecords.gmp` until it has a row) logs the shim once and keeps its matrix order; a field with a row returns the resolver's order |
| `tests/integration/field-sources-row-key-provenance.integration.test.ts` | exists | a policy-path write on ipodhan_test stores `data_lineage->>'policyOrigin' = 'registry:2'` |

## Schema

No schema change (`data_lineage` is jsonb).

## Interfaces

No new exports. Log lines (structured, via the scraper's pino logger): `policy-shim` (field, reason
`no manifest row`), `policy-shadow` (field, matrixOrder, policyOrder) — both once per process per field.

## Feature flag

`ENABLE_POLICY_WRITER` (S1b). The key deletions are unconditional (none of the 27 was reachable).

## Tests

### Failing test first

(1) the 27 keys are present today → red; (2) shim log once per field → red by absence; (3) a
policy-path write carries `policyOrigin` in lineage → red on ipodhan_test today. Tier: unit +
integration (both already in the pr-gate run list).

## Detection

`No detection change: PULL-POLICY and PULL-WRITE-POLICY (S6) cover matrix-vs-policy drift and provenance origin; the shim log is counted by S6's active-override report`.

## Staging proof

Next wake: `select data_lineage->>'policyOrigin', count(*) from field_sources where updated_at > now()
- interval '1 hour' group by 1` shows `registry:2` for the flipped group's fields; the cycle log has
`policy-shim` lines only for fields that genuinely have no row (list read and recorded in the ledger,
expected: `gmp_records.*` and any class-C/I field the writer touches); `walk-proof.mjs` unchanged.

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S1d-1 | `cd scraper && npx vitest run tests/unit/config/field-priority-matrix.test.ts` | exit 0 | local |
| S1d-2 | `git grep -c -E "^  (revenue_fy[123]|profit_fy[123]|peer_companies|roe_percentage|roce_percentage|pb_ratio|fresh_issue_size|offer_for_sale_size|issue_price|min_investment|total_subscription|retail_subscription|qib_subscription|nii_subscription|gmp_percentage|expected_listing_price|listing_price|listing_gain_percentage):" HEAD -- scraper/src/config/field-priority-matrix.ts` | exit 1 | local |
| S1d-2b | `cd scraper && npx vitest run tests/unit/config/field-priority-matrix-camelcase-siblings.test.ts` | exit 0 (the 5 keys WITH camelCase siblings must survive the deletion) | local |
| S1d-3 | `git grep -c "policyOrigin" HEAD -- scraper/src/services/data-consolidation-service.ts` | regex: `^[1-9]` | local |
| S1d-4 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/field-sources-row-key-provenance.integration.test.ts` | exit 0 | test-db |
| S1d-5 | `node scripts/check-stage3-dod.mjs --sql "select count(*) as n from field_sources where data_lineage->>'policyOrigin' like 'registry:%' and updated_at > now() - interval '1 day'" --expect-db ipodhan_staging` | regex: `n=[1-9]` | staging |

## Rollback

Revert; the deletions were unreachable keys; lineage additions are extra jsonb keys and harmless.

## Tier, budget and cost

Tier A (deletes + write-path provenance). `Budget: 60 min wall-clock, 120 tool calls`. Review:
Opus, mutation: reintroduce one dead key (test must fail), remove the shim log (test must fail). Why
Opus: 27 deletions in the file that decides every write. Builder: Sonnet.

### Dependencies

Needs S1b (resolver in the writer) and S0b (manifest rows for Group C's 16 fields).

## Rules implemented

| Design section | Rule ids |
|---|---|
| §1.12 | R-158 |

## Known gaps

- `ipo_financials` is an orphaned table (old item-03 card, Group B); untouched, still a product
  question.
- `listingExchange` (singular) provenance rows (224 measured 2026-09-09, old card §7.3 item 8): NOT
  repaired here; a separate Tier A repair slice after the stage (`scraper/scripts/repair-*.ts` via
  `openRepairDb`, dry-run default). Recorded so it is not lost with the old card.
- The `sources` arrays remain on the matrix rows as the shim; S6 asserts none remain once every
  writable field has a row.
