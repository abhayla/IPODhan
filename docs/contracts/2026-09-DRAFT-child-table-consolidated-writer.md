# Contract (DRAFT — not dispatched, owner approval required): the child-table consolidated writer

**Executor:** /goal (built-in autonomous run) · **Created:** 2026-09-09 · **Slug:** `child-table-consolidated-writer`
**Status:** **DRAFT — not dispatched, owner approval required.** No T-id is allocated. Nothing is written to the fleet bus.
**Mission:** Make a write to any of the eight child tables (`ipo_details`, `financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`, `peer_companies`) go through the same per-field priority resolution, `field_sources` provenance and `data_conflicts` detection that `ipos` already gets — which today is true of none of them. `consolidatedUpsertIPO` consolidates `tableName: 'ipos'` only (`scraper/src/services/data-consolidation-orchestrator.ts:187`), which is 32 of the 240 published fields; the other 208 are written by `persistFilingExtraction` straight through their own repositories with no priority resolution, no provenance and no conflict rows. Build item 1 of `docs/design/data-sourcing-pull-model.md` §7.1, first by owner decision OD-10, and the gate on every item from 5 onward. "Done" is the Definition of Done below, in full.

---

## §0.1 Worktree isolation

> **First action of the run, before §0.2 and any stage. Non-negotiable.**
>
> 1. From the primary checkout run `powershell -File $HOME/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan -Name childwriter -Branch feat/child-table-consolidated-writer -Base origin/main -Purpose "build item 1: child-table consolidated writer" -TtlHours 72`. If `wt-new.ps1` refuses a parameter, run it with `-?` once, map the parameters, retry once, and if it still fails fall back to `git fetch origin && git worktree add ../IPODhan-childwriter -b feat/child-table-consolidated-writer origin/main` plus a hand-written `.worktree-meta.json` carrying `{repo, name, branch, purpose, created, ttlHours}`.
> 2. Run every stage inside `D:\Abhay\Ventures\IPODhan-childwriter`. Assert `git rev-parse --show-toplevel` ends in `IPODhan-childwriter` before every stage; a mismatch is a hard halt.
> 3. Claim it: `export RUN_TOKEN=childwriter-$(date +%s)` and `printf '%s\n' "$RUN_TOKEN" > "$(git rev-parse --show-toplevel)/.run-active.lock"`. Release it as the run's final action, on success or on any halt.
> 4. **Never self-remove the worktree.** Removal is the owner's, via `~/.claude/tools/wt-rm.ps1`. A forced remove once followed Windows junctions into the main checkout and wiped 442 tracked files.

## §0.2 Idempotency preflight

> **First action after §0.1, before any stage.**
>
> 1. Read `docs/contracts/.run/child-table-consolidated-writer-PROGRESS.md` if it exists (a prior run of this contract), and `git log origin/main --oneline -30`.
> 2. Run the four commands that must be green before and after: `cd packages/shared && npx tsc`, then from the root `npm run test:unit`, `cd web && npm run lint:ci`, and `node docs/design/check-design-consistency.mjs --gate`. Record every exit code. If any is red at the start, that is the starting state, not a reason to halt — and it is NOT this run's job to fix an unrelated red.
> 3. For each stage below, check the progress file, the code and `git log` before doing it. If a stage's acceptance already holds — grep and read to confirm, never trust a progress line alone — SKIP it with a verify-only pass and record the skip.
> 4. Confirm the two repository copies are still in lockstep: `diff packages/shared/src/repositories/field-sources-repository.ts web/lib/repositories/field-sources-repository.ts`. The known difference is cosmetic. If it has grown, that is a finding to record before touching either.

## §0.3 Progress log

> Append-only, updated BEFORE moving on from each stage or event.
>
> 1. Location: `docs/contracts/.run/child-table-consolidated-writer-PROGRESS.md` (`.run/` is gitignored).
> 2. First line: slug · branch · worktree · start time · contract path · one-line mission.
> 3. Append a two-line entry at: stage start; stage done with its gate result; every defect found; every "not working" event and what was done about it; each review round and verdict; each blocker; the final result.
> 4. Format `[YYYY-MM-DD HH:MM] KEYWORD — summary`, where KEYWORD is one of STAGE, PROGRESS, DEFECT, EVENT, DECISION, REVIEW, BLOCKER, DONE. Timestamps come from `date` in the same command, never estimated — estimates drifted eighty minutes on 2026-09-05.
> 5. Run-end SUMMARY: DONE · PENDING (+reason) · BLOCKED (+why) · NEXT (action + owner).

---

## Scope boundary

- **In scope (may create and edit):** `packages/shared/src/db/schema.ts`, `packages/shared/src/repositories/field-sources-repository.ts` and the data-conflicts repository beside it, `web/lib/repositories/field-sources-repository.ts` (kept in lockstep), `scraper/src/services/data-consolidation-orchestrator.ts`, `scraper/src/services/data-consolidation-service.ts`, `scraper/src/services/filing-persister.ts`, `scraper/src/services/anchor-persister.ts`, `web/drizzle/migrations/**` (generated only), `scraper/tests/**`, `docs/reviews/detection-checks/**`, `docs/ops/prod-ops-recipes.md`.
- **Out of scope, HARD:** `scraper/src/scrapers/**` (no scraper behaviour changes here), `web/app/**`, `.github/**`, any change to `package.json` or a lockfile, any new dependency, `promoter_acquisition_ranges` and `brlm_track_record` (not among the eight named tables — they keep their current behaviour), any database write on production, any deploy, anything under `D:\Abhay\GetWorkDone` or `D:\Abhay\VibeCoding\5Wealths\`.
- **Goal type:** a Tier A code change behind a feature flag, with a schema migration.

## Context to read first

- `docs/design/build-cards/item-01-child-table-consolidated-writer.md` — **the specification.** Files, schema, interfaces, flag, tests, detection check, staging proof and rollback are all in it. This contract does not restate them; it makes them a run.
- `docs/design/data-sourcing-pull-model.md` §2.3 (why a plan row is written from the result of a write, never in parallel with it), §2.10, §7.1 (the sequence and why item 1 is first).
- `scraper/src/services/data-consolidation-orchestrator.ts` (`consolidatedUpsertIPO` at line 90; `tableName: 'ipos'` at line 187), `scraper/src/services/data-consolidation-service.ts` (`ConsolidateIPODataInput` at 96, `consolidateField` at 979, the open-conflict lookups at 836, 1237, 1555, 1624), `scraper/src/services/filing-persister.ts` (the five whole-row replace call sites and `trackField(tableName, 'rows')` at 646), `scraper/src/services/anchor-persister.ts` (line 540).
- `packages/shared/src/db/schema.ts` — `field_sources` at 1376-1421 including the unique constraint `unique_field_source_per_ipo` at 1414, and `data_conflicts` at 1428-1465.
- `.claude/rules/defect-fix-contract.md`, `.claude/rules/recurrence-detection-gate.md`, `.claude/rules/scraper-test-layout.md`, `.claude/rules/branching-model.md`.
- `docs/ops/prod-ops-recipes.md` §1 (tunnel) and §2 (reading staging state).

## Pre-made design decisions (the run must NOT pause on these)

1. **The key is widened, not replaced.** `field_sources` and `data_conflicts` each gain a `row_key varchar(200) NOT NULL DEFAULT ''`. Empty string is the singleton sentinel for every table with one row per IPO; it is NOT nullable, because two NULLs are not equal under a unique index and two empty strings are.
2. **The unique constraint is renamed as well as widened.** `unique_field_source_per_ipo` becomes `unique_field_source_per_ipo_row` on `(ipo_id, table_name, row_key, field_name)`. A constraint whose meaning changed but whose name did not is a trap for the next migration that only ALTERs.
3. **The natural key per table is the build card's**, not this run's to invent: `fiscalYear:basis` for `financial_statements`, `pricingEvent` for `ipo_valuation`, normalised company name for `promoters` and `peer_companies`, `role:normalizedName` for `ipo_intermediaries`, a heading hash for `ipo_risk_factors`, and `''` for `ipo_details` and `anchor_investors`.
4. **Dropping a unique constraint is destructive DDL.** The generated migration is split: the additive half (add column, add index) goes in the normal journal; the constraint swap goes in `web/drizzle/migrations/_gated/` and is applied by hand after the owner signs off. Adding a `_gated/` file to `meta/_journal.json` is what drops production columns; it is never done.
5. **The flag is `ENABLE_CHILD_TABLE_CONSOLIDATION`,** default OFF in every slot including local. It is turned on for staging only, by the owner, after the migration has been applied there.
6. **The old provenance write is deleted, not left running in parallel.** `trackField(tableName, 'rows')` writes one synthetic row per table and is superseded by per-field rows; leaving both would double-count every provenance report.
7. **If a decision genuinely is the owner's** — irreversible, outward-facing, or two valid builds with no best-practice winner — record it in the progress log with a recommendation, continue on the recommendation, and list it first in the final report. Do not halt an hour in.

## Stages

### Stage A: the schema, and a red test that proves the gap
- **Do:** write the failing test FIRST, against the real repository, not a re-implementation: two `financial_statements` rows for the same IPO and different fiscal years, each writing provenance for `revenue`. On today's code that either violates `unique_field_source_per_ipo` or silently overwrites one year's provenance with the other's. Watch it fail and record the exact failure. Then add `rowKey` to both tables in `packages/shared/src/db/schema.ts`, run `cd web && npm run db:generate`, review the SQL by eye, split it as decision 4 says, and apply the additive half locally with `npm run db:migrate`. Thread `rowKey` through `TrackFieldUpdateInput`, `FieldSourceRecord`, `trackFieldUpdate` and `findByField` in both repository copies.
- **Acceptance:** the new test is GREEN; `cd packages/shared && npx tsc` exits 0; `npm run test:unit` exits 0; `node scripts/ops/../../web/drizzle` is not touched by hand; the `_gated/` file exists and is NOT in `meta/_journal.json` (assert with grep, and record the grep output).

### Stage B: the writer
- **Do:** add `consolidatedUpsertChildRows(ipoId, tableName, rows, source, docType, preResolvedIPO?)` to the orchestrator per the card's interface. Thread `rowKey` through `consolidateField`, the seven `trackFieldSource` call sites and the `ConflictInfo` shape, and add `&& row.rowKey === rowKey` to the four open-conflict lookups — without that last change two fiscal-year rows disagreeing on `revenue` in one cycle each see the other's open conflict as their own.
- **Acceptance:** unit tests per `.claude/rules/scraper-test-layout.md` covering: one row per table for each of the eight; two rows of the same table disagreeing; a row whose natural key changes between cycles; and the `LOCK_NOT_ACQUIRED` skip leaving no provenance row behind. `npm run test:unit` exits 0.

### Stage C: the call sites
- **Do:** replace the five `replaceAllowed` whole-row-replace call sites in `filing-persister.ts` and the `createAnchorInvestors` call in `anchor-persister.ts` with calls to the new method. Delete `trackField(tableName, 'rows')`. Leave `promoter_acquisition_ranges` and `brlm_track_record` alone.
- **Acceptance:** `grep -rn "replaceAllowed\|trackField(" scraper/src` returns only the out-of-scope tables; `npm run test:unit` and `cd web && npm run lint:ci` both exit 0; the flag defaults OFF and the OFF path is proven by a test that asserts the old behaviour is unchanged when it is off.

### Stage D: the detection check
- **Do:** add a check under `docs/reviews/detection-checks/` per `.claude/rules/recurrence-detection-gate.md`, asserting on real data that no `(ipo_id, table_name, row_key, field_name)` appears twice in `field_sources` and that every child table with rows for an IPO has at least one per-field provenance row for that IPO. Regenerate the aggregate with `node scripts/build-detection-registry.mjs` and commit both the per-entry file and the regenerated aggregate.
- **Acceptance:** `node scripts/build-detection-registry.mjs --check` exits 0; the new check is run against the staging database through the tunnel and its output recorded; the `detection-change-gate` CI job passes.

### Stage E: the staging proof, then the PR
- **Do:** merge to `main` so staging deploys it, apply the `_gated/` constraint swap on staging by hand, ask the owner to turn the flag on for staging, then read a real scraper cycle. Open the PR to `main` with the six defect-fix-contract items in its body.
- **Acceptance:** the staging proof line below is READ, not predicted; the PR is open with CI green.

## Verification gates

| Gate | What it gates | Fires when |
|---|---|---|
| Supervisor verification | every worker return is reproduced at T0 — re-run the gate it claims, read the diff for scope creep | every dispatch |
| Independent review | a fresh reviewer, not the author, on the whole diff; Tier A so adversarial, with a mutation test on every new guard | before merge |
| Static gates | `cd packages/shared && npx tsc` · `npm run test:unit` · `cd web && npm run lint:ci` · `node scripts/build-detection-registry.mjs --check` — all on EXIT CODE, never on grepping output for the word "fail" | every stage end |
| Real-data proof | the staging cycle line below | before the release cut |

**Class:** all eight child tables, every IPO status and both segments, for rows already on production and rows the pipeline writes after the change. A fix that covers only the tables one live IPO happens to have is a defect in the fix.

**Proof:** one staging scraper cycle after the flag is on, showing per-field `field_sources` rows for a child table that previously had exactly one synthetic `rows` entry. The counter that must move, with the IPO chosen by the query rather than by hand:

```sql
-- pick the subject: a staging IPO that has financial_statements rows
select i.slug, i.id, count(fs.id) as fy_rows
  from ipos i join financial_statements fs on fs.ipo_id = i.id
 group by i.slug, i.id order by count(fs.id) desc limit 1;

-- the counter, before and after
select table_name, row_key, count(*)
  from field_sources
 where ipo_id = :id and table_name = 'financial_statements'
 group by table_name, row_key order by row_key;
```

Before: at most one row, `field_name = 'rows'`, `row_key = ''`. After: one row per field per fiscal
year, each with a non-empty `row_key` of the form `fiscalYear:basis`. Read it in the cycle AFTER the one that writes it, so a value that a later cycle overwrites is caught.

## Failure-recovery budget

- Ten attempts on a red gate, then log DEFECTED with the exact failing check and move to the next stage that does not depend on it. Never halt the run for one check.
- A migration that will not apply locally: read `web/drizzle/migrations/meta/_journal.json` and `docs/16-database/SCHEMA_MANAGEMENT.md` before the second attempt. Never edit the journal by hand.
- **Hard halt only for:** the worktree assertion failing, a write detected outside scope, a destructive DDL about to run on production, or a credential missing from `D:\Abhay\GLOBAL.env`. Context pressure is not a halt: write a continuation note and keep going.

## Commit + push policy

- One commit per stage; Conventional Commits (`feat(scraper):`, `feat(db):`, `test(scraper):`, `docs(reviews):`); the body says why, not what.
- Branch `feat/child-table-consolidated-writer` → push after each stage → one PR to `main`, opened not merged, until the owner says otherwise.
- **Never `--no-verify`.** The pre-commit runs a secret scan and the workflow ASCII check.
- Attribution footer on every commit and the PR body.

## Definition of Done

- [ ] **Widen** `field_sources` and `data_conflicts` with `row_key`, with the constraint swap in `_gated/` and NOT in the journal. Completeness bar: the additive migration is applied locally, `_gated/` is absent from `meta/_journal.json` (grep output recorded), and `npx tsc` in `packages/shared` exits 0.
- [ ] **Write** `consolidatedUpsertChildRows` and route all eight child tables through it. Completeness bar: `grep -rn "replaceAllowed" scraper/src` returns only `promoter_acquisition_ranges` and `brlm_track_record`.
- [ ] **Prove** the gap with a test that was RED first. Completeness bar: the pre-change failure is recorded verbatim in the progress log, and the same test is green after.
- [ ] **Cover** each of the eight tables plus the four cases in Stage B's acceptance with unit tests at the right tier. Completeness bar: `npm run test:unit` exits 0 and each of the twelve cases is a named test.
- [ ] **Add** the detection check and regenerate the registry. Completeness bar: `node scripts/build-detection-registry.mjs --check` exits 0 and the check has been run against staging with its output recorded.
- [ ] **Read** the staging proof line above on a real cycle after the flag is on. Completeness bar: the counter moved, quoted from the log, from the cycle after the writing one.
- [ ] **Open** the PR to `main` with the six defect-fix-contract items in the body, CI green, not merged.
- [ ] Run-end SUMMARY (DONE / PENDING / BLOCKED / NEXT) in the progress log and the final report.

## Guardrails (hard stops)

- No new dependency; no change to `package.json` or any lockfile.
- No destructive DDL on any slot without the owner's explicit word for that one statement; `_gated/` is never added to the journal.
- No production database write. No deploy. The VPS serves live traffic: reads only, and only those named in `docs/ops/prod-ops-recipes.md` §1–§2.
- No number typed from memory: measured this run and its source named, or generated by a gate.
- Gate on exit codes, never on grepping output for the word "fail" — PR #302 merged with a red gate because a script grepped for text.
- One prod deploy per project per day, in the evening window, and only from a frozen `release/prod-YYYY-MM-DD` branch. This run does not deploy.

## Final report

- Provisional items first: every decision recorded as the owner's, with the recommendation taken.
- Per stage: what changed, the gate output verbatim, commit SHAs.
- The staging proof line as read, with the cycle that carried it.
- Honest failures of the run.
- DONE / PENDING / BLOCKED / NEXT.

## Authorization trail

| Fork | Decision | Why |
|---|---|---|
| Widen the provenance key or add a parallel table | Widen, with `row_key NOT NULL DEFAULT ''` | One provenance table with one meaning; the sentinel keeps singleton tables working unchanged |
| Rename the unique constraint or keep the name | Rename to `unique_field_source_per_ipo_row` | A constraint whose meaning changed but whose name did not is a trap for the next ALTER-only migration |
| Ship the constraint swap in the journal or gate it | `_gated/`, applied by hand after sign-off | Adding destructive DDL to the journal is how production columns get dropped |
| Keep the old synthetic `rows` provenance write during transition | Delete it in the same change | Two provenance writers double-count every report that reads them |
| Flag default | OFF everywhere, including local | The OFF path must be provably unchanged before the ON path is trusted |

## References

- `docs/design/build-cards/item-01-child-table-consolidated-writer.md` (the specification), `docs/design/data-sourcing-pull-model.md`
- `.claude/rules/{defect-fix-contract, recurrence-detection-gate, scraper-test-layout, branching-model, supervisor-verification, independent-test-verification}.md`
- `docs/ops/prod-ops-recipes.md`, `docs/16-database/SCHEMA_MANAGEMENT.md`
- `~/.claude/tools/wt-new.ps1`, `~/.claude/tools/wt-rm.ps1`, `D:\Abhay\GLOBAL.env`
