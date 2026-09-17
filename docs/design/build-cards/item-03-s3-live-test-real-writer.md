# Item 3 / slice S3 — the live walk test drives the real `DataConsolidationOrchestrator` against ipodhan_test (#732), in the pr-gate run list

Stage 3 ("one source table", plan v2 §4 S3 and §4b finding 9). Ledger: `docs/design/stage-3-ledger.md`.
Gate: `node scripts/check-stage3-dod.mjs --slice S3`.

## Purpose

After this ships, one integration test constructs the real consolidation orchestrator and the real
walk against ipodhan_test for one WIN and one LOST case, and CI runs it on every PR — so a
walk-to-writer contract bug is caught before a staging deploy, not after six rounds of them.

## Serves

- #732 and the lesson `stubbed-writer-hides-contract-bugs` (three contract bugs + two stub drifts hid
  behind a stubbed writer on 2026-09-16).
- §4b finding 9: pr-gate has a scraper integration job on an ephemeral test DB with an explicit,
  gated run list (`pr-gate.yml:661-800`; the list at 782-800). CI can run it.

## Files

### What already exists (reuse; do not write a second copy)

| Exists on origin/main | Reuse for |
|---|---|
| `scraper/tests/integration/field-plan-walk-resume.integration.test.ts` and `field-plan-generation-wiring.integration.test.ts` (real repository, in the run list) | the harness (DB setup, seeding, teardown) — the new test is a sibling using the same helpers |
| `scraper/tests/helpers/consolidation-result-fixture.ts` (typed fixture factory, stage 2) | stays for UNIT tests only; the new test uses none of it |
| `scraper/src/services/field-plan-walk-deps.ts` (builds the walk's deps incl. the consolidator) | the production wiring the test must call, not re-wire |
| `data-consolidation-service.ts` `DataConsolidationOrchestrator` (constructor deps: repositories, redis, logger) | constructed with the test DB pool and a real/in-memory redis the existing integration tests already use |
| `.github/workflows/pr-gate.yml` run list (782-800) | one added line |
| `scripts/tests/…integration-coverage-gate` (pr-gate.yml:938, "every file under scraper/tests/integration/ must be in the run list") | the gate that fails if the line is forgotten |

### Changes

| Path | State | Change |
|---|---|---|
| `scraper/tests/integration/field-plan-walk-real-writer.integration.test.ts` | NEW | seeds one IPO on ipodhan_test with plan rows for `ipos.issue_size` (policy DOC, CHITTORGARH); WIN: the walk supplies a CHITTORGARH value onto an untracked stored value → row SUPPLIED, `field_sources` row source CHITTORGARH, lineage `policyOrigin`; LOST: a stored DOC value, the walk supplies CHITTORGARH → row NOT supplied, `CHECK_FAILED`/LOST verdict per the walk's PASS 3 rule (`field-plan-walk.ts:607-613`), stored value unchanged. Asserts exact values, not `> 0` |
| `.github/workflows/pr-gate.yml` | exists (workflow file, merge :00–:05) | line `tests/integration/field-plan-walk-real-writer.integration.test.ts` appended to the run list |

## Schema

No schema change.

## Interfaces

No new exports.

## Feature flag

None; the test sets `ENABLE_POLICY_WRITER`, `ENABLE_FIELD_PLAN`, `ENABLE_FIELD_PLAN_WALK` explicitly
in its own env (the flags bake at import; the existing integration tests show the idiom).

## Tests

### Failing test first

The file is red by absence; the WIN case is the exact contract that broke in stage 2 (SUPPLIED
without reading `fieldResults`), so if any drift remains it stays red. Tier: integration.

## Detection

`No detection change: this slice IS a detection upgrade (a CI test on the real writer) and adds no audit check`.

## Staging proof

Not a runtime change. Proof = the CI job log of the merged PR showing the file in the run list and
`✓ field-plan-walk-real-writer` (job log read, not the badge; `gh run view <id> --log`).

### Definition of Done

| id | command | expect | env |
|---|---|---|---|
| S3-1 | `cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/field-plan-walk-real-writer.integration.test.ts` | regex: `Tests\s+2 passed` | test-db |
| S3-2 | `grep -c "field-plan-walk-real-writer.integration.test.ts" .github/workflows/pr-gate.yml` | line: `1` | local |
| S3-3 | `git grep -c "consolidation-result-fixture" HEAD -- scraper/tests/integration/field-plan-walk-real-writer.integration.test.ts` | exit 1 | local |
| S3-4 | `gh run list --workflow pr-gate.yml --branch main --limit 1 --json databaseId -q ".[0].databaseId" \| xargs -I{} gh run view {} --log \| grep -c "field-plan-walk-real-writer"` | regex: `^[1-9]` | local |

## Rollback

Revert; a test.

## Tier, budget and cost

Tier B. `Budget: 30 min wall-clock, 60 tool calls`. Review: Sonnet diff-only (does the test drive
the real orchestrator; are the assertions exact). Builder: Sonnet.

### Dependencies

Needs S1b/S1c (the policy write path) so the WIN/LOST cases exercise the new decisions; may be
written earlier against the matrix path and re-asserted after S1b.

## Rules implemented

| Design section | Rule ids |
|---|---|
| §2.3.5 | R-054 |

## Known gaps

- One IPO, one field. The corpus grows when the NSE fetcher lands (follow-up after the stage).
