# Stage 3 ledger — "one source table" (pull-model item 3, plan v2)

Plan: https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM (v2, section 4b carries the 13 review
corrections). Field table: https://claude.ai/artifact/Egtm7vyGRCuUZdnSPvNFB3. Owner "go" 2026-09-17
12:0x IST with D-1 (12 slices, Swap Test as acceptance), D-2 (override expiry 30 days), D-3 (a no-build
production config deploy may run in any evening window, owner-worded).

Cards: `docs/design/build-cards/item-03-s*.md`, one per slice. Gate: `node scripts/check-stage3-dod.mjs
--slice <id>` runs every card's Definition of Done row and prints PASS/FAIL per row; the supervisor runs
it (never a worker) and no slice is dispatched until the previous slice's run is all PASS.

## Rows (one per slice; a row is appended, never edited, except the status cell)

| Slice | Tier | Card | PR | Merged sha | Review verdict | Staging proof (identity, cycle) | Gate run (date, PASS/total) | Board | Status |
|---|---|---|---|---|---|---|---|---|---|
| STEP 1 | C | all 12 cards + this ledger + `scripts/check-stage3-dod.mjs` | #734 | ec6b8eb5 | | n/a (docs) | | item-03 | landed 2026-09-17 13:08 IST |
| S0a | C | item-03-s0a-spec-repair.md | #737 | a8ba7e2b | Tier C, none | | 2026-09-17 13:25 IST, 7/7 PASS | item-03 v13 | landed |
| S0b | B | item-03-s0b-generate-registry.md | #738 | 5f57aa66 | Tier B Sonnet + independent Opus review after 2nd occurrence | 2026-09-17 14:4x IST, 6/8 local PASS; staging rows S0b-7/S0b-8 tonight | item-03 v14 | merged, staging proof owed |
| S0c | B | item-03-s0c-source-code-reconciliation.md | #741 | c0a0d5a4 | Tier B Sonnet, PASS-with-minors (card overstated a .refine; corrected) | n/a (no runtime change) | 2026-09-17 15:33 IST, 7/7 PASS (supervisor, merged sha) | item-03 v15 | landed 2026-09-17 15:33 IST |
| S0d | A | item-03-s0d-scraper-source-enum.md | #742 | 8bb4bc7f | Tier A Opus x2 (round 1 FAIL: nine literal unions; round 2 PASS 6/6) | owed: S0d-7 after the 21:30 window | 2026-09-17 16:18 IST, 7/8 PASS (S0d-7 SKIP), supervisor, merged sha, ipodhan_test | item-03 v16 | merged, staging proof owed |
| S5 | A | item-03-s5-config-only-deploy.md | #743 | 888f9330 | Tier A Opus PASS, 3 MINOR (MINOR-3 seed guard fixed round 1; MINOR-1/2 accepted as known gaps) | owed: S5-5..S5-7 after the 21:30 window | 2026-09-17 17:31 IST, S5-3/S5-4 PASS on main; S5-1 by hand ALL PASS + CI; S5-2 CI ALL PASS (no symlinks on the laptop); supervisor, 888f9330 | item-03 v17 | merged, staging proof owed |
| S1a | A | item-03-s1a-resolver.md | | | | | | | queued |
| S1b | A | item-03-s1b-writer-adopts-resolver.md | | | | | | | queued |
| S1c | A | item-03-s1c-refuse-incapable.md | | | | | | | queued |
| S1d | A | item-03-s1d-matrix-shim-and-provenance.md | | | | | | | queued |
| S2 | A | item-03-s2-reconcile-plan-rows.md | | | | | | | queued |
| S3 | B | item-03-s3-live-test-real-writer.md | | | | | | | queued |
| S4 | A | item-03-s4-override-layer.md | | | | | | | queued |
| S6 | B | item-03-s6-churn-stop-and-detection.md | | | | | | | queued |
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
- Every merge: `node scripts/ops/merge-if-current.mjs <N>` exit 0, then `gh pr merge <N> --squash`;
  no pushes to main :50–:05; workflow-file PRs only :00–:05.
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
