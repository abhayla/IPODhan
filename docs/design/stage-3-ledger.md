# Stage 3 ledger — "one source table" (pull-model item 3, plan v2)

Plan: https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM (v2, section 4b carries the 13 review
corrections). Field table: https://claude.ai/artifact/Egtm7vyGRCuUZdnSPvNFB3. Owner "go" 2026-09-17
12:0x IST with D-1 (12 slices, Swap Test as acceptance), D-2 (override expiry 30 days), D-3 (a no-build
production config deploy may run in any evening window, owner-worded).

Cards: `docs/design/build-cards/item-03-s*.md`, one per slice. Gate: `node scripts/check-stage3-dod.mjs
--slice <id>` runs every card's Definition of Done row and prints PASS/FAIL per row; the supervisor runs
it (never a worker) and no slice is dispatched until the previous slice's run is all PASS. Test-db
rows need `DATABASE_URL` naming `ipodhan_test` AND `REDIS_URL=redis://localhost:6379` (the
integration guard throws without it and vitest prints `Tests no tests`).

## Rows (one per slice; a row is appended, never edited, except the status cell)

| Slice | Tier | Card | PR | Merged sha | Review verdict | Staging proof (identity, cycle) | Gate run (date, PASS/total) | Board | Status |
|---|---|---|---|---|---|---|---|---|---|
| STEP 1 | C | all 12 cards + this ledger + `scripts/check-stage3-dod.mjs` | #734 | ec6b8eb5 | | n/a (docs) | | item-03 | landed 2026-09-17 13:08 IST |
| S0a | C | item-03-s0a-spec-repair.md | #737 | a8ba7e2b | Tier C, none | | 2026-09-17 13:25 IST, 7/7 PASS | item-03 v13 | landed |
| S0b | B | item-03-s0b-generate-registry.md | #738 | 5f57aa66 | Tier B Sonnet + independent Opus review after 2nd occurrence | 2026-09-17 22:2x IST: cycle start line `field-manifest: version=2 fields=190 sha256=a20b4dfe181e config_sha=release` (S0b-8); env line present (S0b-7) | 2026-09-17 14:4x IST, 6/8 local PASS; the two staging rows filled tonight | item-03 v14 | landed |
| S0c | B | item-03-s0c-source-code-reconciliation.md | #741 | c0a0d5a4 | Tier B Sonnet, PASS-with-minors (card overstated a .refine; corrected) | n/a (no runtime change) | 2026-09-17 15:33 IST, 7/7 PASS (supervisor, merged sha) | item-03 v15 | landed 2026-09-17 15:33 IST |
| S0d | A | item-03-s0d-scraper-source-enum.md | #742 | 8bb4bc7f | Tier A Opus x2 (round 1 FAIL: nine literal unions; round 2 PASS 6/6) | owed: S0d-7 after the 21:30 window | 2026-09-17 16:18 IST, 7/8 PASS (S0d-7 SKIP), supervisor, merged sha, ipodhan_test | item-03 v16 | merged, staging proof owed |
| S5 | A | item-03-s5-config-only-deploy.md | #743 | 888f9330 | Tier A Opus PASS, 3 MINOR (MINOR-3 seed guard fixed round 1; MINOR-1/2 accepted as known gaps) | BLOCKED by #748: deploy-config.sh cannot run from a release (no .git). Measured 2026-09-17 23:5x IST: S5-5 (symlink) and S5-6 (CONFIG_SHA=`release`) already PASS; only S5-7 (deploy-config.log line) fails, because only a real script run writes that log. Fix slice S5b | 2026-09-17 17:31 IST, S5-3/S5-4 PASS on main; S5-1 by hand ALL PASS + CI; S5-2 CI ALL PASS (no symlinks on the laptop); supervisor, 888f9330 | item-03 v17 | merged, staging proof owed |
| S5b | A | fix slice for #748 (no card; scope in the issue + PR #750) | #750 | pending | Tier A independent Opus: round 1 FAIL — 2 CRITICAL (nothing sets DEPLOY_CONFIG_REPO; the runbook still prescribed the command the new guard refuses, so the fix made the failure legible without making any path succeed) + 2 MAJOR (`git rev-parse --is-inside-work-tree` PRINTS false but EXITS 0, so a bare repo / .git dir passed the guard; the root-owned on-box checkout raises safe.directory exit 128, making the guard blame the variable the operator had already set, with stderr discarded). All four reproduced by the supervisor. Fix round 793e24ab: value-tested probe, a REPO_ROOT fallback chain (override -> own checkout -> /var/www/ipodhan/repo), git's own stderr in the refusal, `repo-root` exit tag | owed: one real run on the box appending to shared/config/deploy-config.log (this is S5-7, the ONLY S5 row that ever failed) | 2026-09-18 00:2x IST supervisor reproduced: suite 39 PASS / 0 FAIL; the DOCUMENTED command (no DEPLOY_CONFIG_REPO) run from a release-shaped tree with no .git above it exits 0 and deploys (`repo-root: using <default> (server default)` then `deployed: staging <sha> sha256 a20b4dfe181e`); bare repo and .git dir both refused with `(repo-root)`; dubious-ownership refusal shows git's own safe.directory text | item-03 v22 | in review |
| S1a | A | item-03-s1a-resolver.md | #745 | 0abf8a37 | Tier A Opus x2: round 1 FAIL (CRITICAL walk origin write no-op) -> fix c7ee046b -> round 2 PASS-with-MINORS | 2026-09-17 22:2x IST: the 16:45 UTC cycle wrote `manifest_version=2 rows=8778 with_origin=8778`; S1a-6 walk-proof 3 MATCH / 0 mismatches; S1a-7 n=0 after the card's RETIRED defect was corrected (no such enum value; corrected form `state <> 'SUPPLIED'`) | 2026-09-17 18:38 IST, S1a-1/2/4/5 PASS on main (S1a worktree detached at 0abf8a37, ipodhan_test); S1a-3 card regex defect fixed in the S1b PR | item-03 v18 | landed |
| S1b | A | item-03-s1b-writer-adopts-resolver.md | #746 | e0f6fc06 | Tier A Opus round 1 PASS-with-MINORS (MAJOR-1: two of four threaded decision sites unproven — both getSourcePriority calls and allowsSameSourceRefresh could be reverted with all 26 tests green) -> fix round b8def287 adds tests (viii)/(ix) through the real orchestrator; supervisor reproduced both mutations red (1400000000 vs 1500000000 at :2325-2326; 100 vs 150 at :2372) and restored clean; no round 2 (R9: remaining minors were comments/docs) | 2026-09-17 22:2x IST: `walk-proof.mjs --expect-db ipodhan_staging` -> at least one MATCH: 3, matches 3, mismatches 0; zero BSE-sourced issueSize rows since the 16:01:40 deploy (n=0) | 2026-09-17 20:2x IST, S1b-1..S1b-6 PASS reproduced by the supervisor (unit 28/28, broad 361/361, integration 5/5 on ipodhan_test, cards 531/0) | item-03 v19 | landed |
| S1c | A | item-03-s1c-refuse-incapable.md | #747 | 20df246e | Tier A independent Opus (the BUILDER self-reviewed and recommended merge — discarded, R4); all six mutations red incl. M2 (empty-slot #728 hole) and M3; 3 MINOR accepted | 2026-09-17 22:2x IST: 0 live refusal rows — NOT a pass by itself (nothing incapable was offered); the refusal path is proven by tests/integration/incapable-source-refusal.integration.test.ts, reproduced green AND red by the supervisor | S1c-1..S1c-6 PASS | item-03 v21 | landed |
| S1d | A | item-03-s1d-matrix-shim-and-provenance.md | #753 | a2c3bdeb | Tier A, reviewed; PR body flags one DoD deviation (S1d-2 grep now matches count=14 exit 0, not the brief's exit 1/count 0, because 14 of the 22 matrix keys are kept with reason; the camelcase-siblings test's own assertions are the accurate DoD) | S1d-5 re-run 2026-09-20 00:5x IST: `n=268` policyOrigin rows written in the last day | 2026-09-20, 5/6 PASS. S1d-1 FAILS AS WRITTEN: the card names `field-priority-matrix.test.ts`, which does not exist; the delivered file is `field-priority-matrix-shim-and-shadow.test.ts` (14/14 green when run). Card defect, not a code defect. S1d-2/2b/3/4 PASS (63/63, 16/16 real counts). The `--slice S1d` aggregate gate could NOT run: `check-stage3-dod.mjs` parses every card in the directory before filtering by slice, and crashes on a malformed expect cell (`FATAL: unrecognized expect grammar`) | item-03 | landed 2026-09-17 (row recorded 2026-09-20; the table had wrongly read `queued` for 2 days) |
| S2 | A | item-03-s2-reconcile-plan-rows.md | #757 | 286c26d4 | Tier A independent review round 1 FAIL (2 CRITICAL, 4 MAJOR, 2 MINOR) -> fix round. CRITICAL-1 untested CLI guards (extracted testable `run(deps)`, all 5 guard mutations proven RED then restored); CRITICAL-2 insert phase skipped production's candidate gate and would have inserted ~13,500 PENDING rows incl. 49 LISTED/CLOSED IPOs the pipeline never plans for (fixed by reusing `isInLiveWindow`, the same predicate guarding production's own generateFieldPlan); MAJOR-3 the card's own S2-7 command never ran (bare invariant name fell through to shell exec, exit 2 UNVERIFIABLE) — corrected on the card; MAJOR-5 key mismatch would silently duplicate the first child row carrying a real row_key; MAJOR-6 unbounded VALUES list chunked to 300. MINOR-7/8 accepted as known gaps | S2-5 `n=0`, S2-6 `n=324` re-run 2026-09-20 00:5x IST. S2-4 FAILS: `n=10`, expected `n=0` | 2026-09-20, 5/7 PASS, 1 FAIL, 1 still running. S2-1 27/27, S2-2 exit 0, S2-3 50/50 (real counts), S2-5 PASS, S2-6 PASS. **S2-4 FAIL is real**: 10 `issue_size` rows on staging still carry `rank2_source='BSE'`, all of them `state=SUPPLIED, manifest_version=1`. The repair tool leaves SUPPLIED rows untouched by design, so the card's unconditional `n=0` never accounted for that carve-out — a gap between the card's stated proof and the tool's intended behaviour. S2-7 (`assert-repair-held --cycles 2`) run 2026-09-20 00:16-00:53 IST: **HELD**, exit 0. Two distinct scraper cycles 30 min apart, violation count 0 at both: `cycle 1: count=0 at 2026-09-19T18:48:12Z`, `cycle 2: count=0 at 2026-09-19T19:18:36Z`. (Mid-run the staging tunnel dropped — three `marker read error: read ECONNRESET` lines — and the tool's own retry loop recovered; the supervisor wrongly recorded this row as UNVERIFIABLE at 00:38 after misreading a `ps | grep -c` noise match as a dead process, and corrected it on reading the log.) Caveat that still stands: the violation count starts at 0, so this proves "nothing reappeared across two real cycles", not "a repair restored a broken value" — weaker than a bare PASS reads. The `--slice S2` aggregate gate could not run (same parser crash as S1d) | item-03 | landed 2026-09-17 (row recorded 2026-09-20; the table had wrongly read `queued` for 2 days) |
| S3 | B | item-03-s3-live-test-real-writer.md | #756 | 9da8183b | Tier B | card records a proof at 2026-09-18 02:01 cycle | not re-run this session | item-03 | landed 2026-09-17 (row recorded 2026-09-20; the table had wrongly read `queued`) |
| S4 | A | item-03-s4-override-layer.md | #760 | 9c20b4d0 | Tier A | **proof owed** (card: "proof owed"; board: merged, proof owed) | not re-run this session | item-03 | landed 2026-09-17, staging proof OWED (row recorded 2026-09-20; the table had wrongly read `queued`) |
| S6 | B | item-03-s6-churn-stop-and-detection.md | #758 | 516ed8f4 | Tier B | **proof owed**, and the card records the DETECTION HALF ONLY — the churn-stop half needs a field_plan_state migration (#759: 165 rows go CHECK_FAILED every cycle) | not re-run this session | item-03 | landed 2026-09-17, PARTIAL + proof owed (row recorded 2026-09-20; the table had wrongly read `queued`) |
| Swap Test | — | plan §1 (both paths, zero supervisor code edits) | | | | | | | queued |

## Order and dependencies

S0a → S0b → S0c → S0d → S5 → S1a → S1b → S1c → S1d → S2 → S3 → S4 → S6. Hard edges: S2 needs S0b
(manifest version 2); S1a/S1b/S1c need S0d (enum); S4 needs S1a's resolver interface and S1b's writer
adoption; S5 needs nothing.
Acceptance for the stage: the Swap Test through both paths (registry PR + config deploy; override CLI)
on staging, run by the supervisor with zero code edits.

## Rules every stage 3 worker brief carries (so a card does not have to repeat them)

- Budget line, `Report: evidence-table`, `Class:`/`Proof:` (fix work) or `Core:`/`Proof:` (new work).
- "Do the work yourself; do not dispatch sub-agents."
- "Read code via `git show origin/main:<path>` or the PR head, never the main checkout's files"
  (the main checkout tree is days behind origin/main).
- Worktree ONLY via `~/.claude/tools/wt-new.ps1`; removal ONLY via `~/.claude/tools/wt-rm.ps1`;
  never `git worktree remove --force`, never `rm -rf`; never touch `D:/Abhay/Ventures/IPODhan`'s tree.
- The card's "What already exists" list is binding: extend those files; no parallel module for
  anything listed there. A reviewer finding "reused vs rewritten" is MAJOR.
- Failing test first on the REAL function (no re-implementation in the test); staging writes only
  through reviewed tools with `--expect-db ipodhan_staging`, never `--allow-prod`.
- Every merge: `node scripts/ops/merge-if-current.mjs <N>` exit 0, then `gh pr merge <N> --squash`,
  the moment review PASS + CI green (owner 2026-09-17: no merge slots during development).
- PR body carries either the detection-check change or the literal line
  `No detection change: <reason of 20+ characters>` (the recurrence gate greps it verbatim).
- Reviewers get no scratch worktree: read `gh pr diff`, run tests in the builder's worktree.
- `Readers:` — every file on origin/main that reads a file, key set, union or schema the slice
  regenerates or widens (from `git grep -ln`), listed with their tests in the DoD.
- The supervisor removes its own verify worktree (`wt-rm.ps1`) before dispatching a fix round on
  that branch (git refuses two worktrees on one branch).

## Landing checklist per slice (supervisor)

1. Review verdict recorded (tier per card); merge via merge-if-current.
2. Staging deploy in the next window (13:30 / 21:30 IST) or the capped button with a reason; wake by
   hand (≤4/day, marker line first); read the proof BY IDENTITY (IPO, field, cycle).
3. `node scripts/check-stage3-dod.mjs --slice <id> [--staging]` all PASS, run by the supervisor.
4. ONE `read_db get items/item-03` + ONE `write_db update` with `if_version` (full `slices` array).
5. Row above updated; one plain-words message to the owner with an evidence table.
6. If the same failure class is red twice after one fix round: no owner wait — dispatch an
   independent fresh-context reviewer (different model or instance, never the builder/fixer) with
   the class, both diffs and the evidence; accept/reject each finding with evidence; write the
   third brief around the findings; then inform the owner. A third red after that is the real stop
   (escalate).
