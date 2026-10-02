# Contract 5: data-path complete, staging soaked, owner told "ready for data testing"

**Executor:** in-session supervisor (Fable/Opus delivery lead), builders via `Agent` with `model` set per R5
**Created:** 2026-10-01 19:23 IST · **Target:** Sat 2026-10-04 · **Base:** origin/main 99dfedcf5
**Mission:** Land every reviewed PR in the queue, finish and prove every data-path item (a–e below), rebuild
`ipodhan_test`, deploy staging, soak one full scraper day, read the proofs and run the repair dry runs, then tell
the owner "ready for data testing" together with a known-data-issues list and how the test session works. Done =
that message sent with an evidence table. **No production deploy** (OD-146: production comes only after ALL work,
including the not-blocking list, is done and proven on staging, and only on the owner's word).

## §0.1 Worktree isolation
- The main checkout `D:\Abhay\Ventures\IPODhan` is READ-ONLY for this run and for every worker. Every task gets
  its own tree from `~/.claude/tools/wt-new.ps1` (`-Name c5-<issue>`), and the tree is removed with `wt-rm.ps1`
  the same session its PR merges or is parked.
- This contract lives in worktree `IPODhan-c5-contract` (branch `docs/contract-5-data-testing`). It rides the
  next batched docs PR (run-discipline B5). It is never edited once the run starts; changes go in a delta file.

## §0.2 Idempotency preflight (before each item)
1. Read `docs/design/pull-model-completion-state.md` and the issue/PR state (`gh pr view`, `gh issue view`).
2. Confirm on `refs/remotes/origin/main` (the explicit ref) whether the artefact already exists, using
   `git log refs/remotes/origin/main --grep '#NNNN'` plus a read of the named function. Merged = verify-only, skip.
3. Record every skip in the progress log and the final report.

## §0.3 Progress log
- `docs/contracts/.run/contract-5-data-testing-PROGRESS.md` in the `IPODhan-c5-contract` tree (gitignored).
- Entry format `[YYYY-MM-DD HH:MM IST] <STAGE|PROGRESS|DEFECT|EVENT|DECISION|RECOVERY|BLOCKER|PARKED|DONE> — ≤2 lines`.
  Stamp from `date` in the same step.
- Run-end summary: DONE / PENDING / BLOCKED / PARKED / NEXT.

## Scope boundary
- **In scope:** the five open PRs; issues #1419 #1421 #1420 #1417 #1296 #1380 #1179 #1354 #1173; the
  `ipodhan_test` rebuild; one staging deploy plus a soak; staging proofs; staging repair dry runs (`--apply` on
  staging only after the dry run is read); the known-data list; the readiness message.
- **Out of scope:** production (deploy, writes, repairs); the not-blocking list (#607 #613 #1149 #1156 #1208
  #1211 #1217 #1255 #1282 #1366 #1393 #1394 #1384 #1249 #1250 #1270 #1169 #1315 #1390 #1422 #1427 #1428 #1431
  #1215 #1243). That list starts only after the readiness message, and is still done before prod (OD-146).
  Also out: any new database, and any ad-hoc run on the VPS beyond deploy, staging soak and state reads.
- **Goal type:** merge queue + bug-fix loop + one Tier A feature (#1420) + staging proof.

## Context to read first
- **FIRST:** `D:\Abhay\Ventures\IPODhan-c5-contract\docs\contracts\.run\contract-5-data-testing-PROGRESS.md`.
  The authoring session already merged #1432, #1429 and #1426, proved #1419 real, and stopped four workers
  mid-task. Their worktrees and the caveats about them are listed there. Continue in that same progress file.
- `docs/design/data-sourcing-pull-model.md`: §0.0.1 OD rows (OD-153..OD-159 added 2026-10-01); §6 rule 4
  answer-state table; F-219 in `docs/design/findings.json`.
- `docs/design/pull-model-completion-state.md`: the release-gate inventory.
- Memory: `contract-4-handover-2026-10-01`, `answer-state-table-before-acting-on-a-reader`,
  `new-integration-file-must-join-ci-list`, `briefs-forbid-reading-env-files`, `code-detectors-parse-never-regex`,
  `merge-gate-rule`, `ipodhan-test-db-rebuild-recipe`, `hardcoded-counts-break-far-from-the-change`.
- `scraper/src/services/printed-number.ts` (for #1421); `scraper/src/config/stated-absence-reasons.json` (for #1420).
- `scraper/tests/test-utils/db.ts`: the ONLY DB access for tests. It refuses any DB except `ipodhan_test`.

## Pre-made decisions (the run does not pause on these)
1. **Merge order is fixed:** #1432 → #1429 → #1426 → #1414 → #1408. One at a time, each with
   `git fetch origin main && node scripts/ops/merge-if-current.mjs N > /dev/null 2>&1 && gh pr merge N --squash`.
   Exit 4 (stale) → rebase the branch in its own worktree, push, wait for green, retry. Any other failure STOPS the
   whole queue, with no skipping ahead. Diagnose it, fix it, then resume at the same PR.
2. **#1414 and #1407 share one `refused` list.** If #1414 conflicts with #1407's lot refusals, the rebase merges
   them into one combined list. It never keeps two lists.
3. **#1408 red:** read `gh run view --log-failed` first, then fix in its worktree (Sonnet, Tier B). If it is red on
   the same class after one fix, the second-occurrence rule applies: an independent reviewer looks before the
   third attempt.
4. **Data-path order:** a (#1419) → b (#1421) → c (#1420, after #1429 merged) → d (#1417) → e (#1296, #1380,
   #1179, #1354, #1173). a and b are VERIFY-FIRST. A failing walk-level test (a) or a real-page measurement (b)
   decides whether a fix exists at all. Not reproducible → close with the evidence. a and b may run in parallel
   with the merge queue, because they touch different files.
5. **#1420 is Tier A (Opus).** Its brief carries: the spec answer-state table (§6 rule 4) as the behaviour
   source; `ipos` columns written via the consolidated writer; clear + reason + plan reopen in ONE transaction,
   with the writer's own lock-time hold check; #1412's TS `emptySectionRuleId` switched to
   `stated-absence-reasons.json`; cross-field refusals decided per field; `refused_value` may be a list; an explicit
   EXTRACTOR_VERSION decision with its reason in the PR body. Mutation tests must kill "hold wiring always
   not-held" and "persister never calls the clear". Any answer state that the table does not name → owner question
   (AskUserQuestion, Spec basis inside), never a builder guess.
6. **#1417:** measure first (how many untyped Chittorgarh PDFs exist on staging, and what their cover pages say).
   Fix = type by the cover page; if the cover is unreadable, route to unknown. Never default to PROSPECTUS.
7. **Reviews:** Tier A (Opus, adversarial, mutations) for migrations, deletes, data restore, clearing (#1420,
   any repair `--apply`). Tier B (Sonnet, diff-only) otherwise. At most 2 rounds, then re-approach or park
   (run-discipline A1).
8. **Model routing:** Sonnet for clear briefs (#1408 fix, #1421, #1417, e-items); Opus for #1419 if real (walk +
   writer, multi-file) and for #1420. Every Opus brief carries `Why Opus:`.
9. **Staging deploy:** via the VPS-cron window (13:30 / 21:30 IST) or the manual button within its cap of
   2/day. The deploy carries everything merged through the data-path items. One full scraper day (the 14:00 and
   22:00 slots both run) before proofs are read.
10. **Board:** after every merge, publish the hook's render to https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM.
11. **Owner questions:** only for an answer state or behaviour the spec does not decide. Grep the spec by every
    key term first. One question per AskUserQuestion, `Spec basis:` inside it, and the answer written as an OD
    row in the spec the same turn.

## Every Agent brief carries (standing lines)
`Budget:` · `Class:` + `Proof:` (+ `Core:` for new work) · `Why Opus:` when opus · `Report: evidence-table` ·
spec section cited · "Never open, grep, cat or source GLOBAL.env or any .env file; use a worktree's
scraper/.env.test only through the test runner; if missing, cp it from another worktree without reading" ·
"never print a connection URL" · "never touch the main checkout" · "`&&` after every cd, never `;`" ·
"no *_ALLOW / FULL_SUITE_BUDGET overrides, no --no-verify, no git checkout/restore/stash (cp backups)" ·
"new scraper integration file → pr-gate.yml scraper-document-integration + run
`node scripts/ci/require-integration-test-coverage.mjs`; new scripts/tests file → a pr-gate step +
require-scripts-test-coverage" · "no new pg pools; scraper/tests/test-utils/db.ts only" · "Date objects to drizzle
timestamp ops, ISO strings to raw pg params; compare app-clock stamps with DB times via sql`now()`/readDatabaseNow"
· "run `npm run gate:local` before push; run the full web+scraper unit suites if you touched an OD row, migration
or counted list" · run-discipline B4 (a)–(d) · static detectors via the TS compiler API, fail closed.

## Stages and acceptance
- **S1 Merge queue:** all five PRs MERGED on origin/main, in order, each through the merge gate. Board published
  after each merge.
- **S2 Data path a–e:** each item either MERGED (failing test first, class-level fix, Tier A/B verdict PASS, CI
  green) or CLOSED-NOT-REAL (evidence in the issue) or PARKED (issue labelled `parked`, the reason, a tracker line).
- **S3 Test DB:** `ipodhan_test` rebuilt per the recipe; `npm run audit:schema-drift` style check shows 0 drifts
  against main's journal.
- **S4 Staging:** served sha = origin/main head that includes S1+S2 (read from the VPS, not typed); one full
  scraper day elapsed; proof lines read with identities:
  OD-21 flag ON on staging and its T+3/T+6 judgement visible; hide-row returns 410; CDN private headers
  (#1346 curl); postponed_at backfill dry run; `scraper/scripts/repair-create-provenance-1196.ts` dry run then
  `--apply` on staging; `scraper/scripts/repair-retire-orphan-peer-sources.ts` dry run then `--apply` on staging;
  `scripts/assert-repair-held.mjs --cycles 2` for each data repair.
- **S5 Readiness:** a known-data-issues list (each with an issue # or registry class; includes the twinkle-papers
  segment flag and the F-212/F-218 OD-152 gap), the test method (owner names IPOs → I show field values +
  sources + conflicts + page, read-only), and the message "ready for data testing".

## Failure budget
- 2 fix rounds per item, then park (A1). A second red of the same class → independent reviewer before the third
  attempt. A third red after that → escalate to the owner.
- A hung command is never re-run without a named cause. Polling more than twice = diagnose instead.
- Hard halt: any secret printed (ask the owner to rotate the same turn); any write aimed at prod; a main-checkout
  modification.

## Definition of Done (each box literal)
- [ ] #1432, #1429, #1426, #1414, #1408 are each MERGED on refs/remotes/origin/main, in that order.
- [ ] #1419, #1421, #1420, #1417, #1296, #1380, #1179, #1354, #1173 are EACH merged, closed-not-real with
      evidence, or parked with an issue label and reason. None is left untouched.
- [ ] `ipodhan_test` rebuilt; 0 schema drifts.
- [ ] Staging serves a sha containing every S1+S2 merge (measured), and one full scraper day has run on it.
- [ ] Every S4 proof read and recorded with identities (pass or fail named; a fail becomes an issue).
- [ ] Both repair scripts dry-run AND applied on staging; assert-repair-held passed for 2 cycles.
- [ ] Owner sent "ready for data testing" with the known-data list, the test method and an evidence table.
- [ ] No production deploy and no production write happened.

## Final report
Evidence table (claim | tool call this turn | result line), DONE/PENDING/BLOCKED/PARKED/NEXT, the skipped items,
learnings routed (lessons/memory/registry).
