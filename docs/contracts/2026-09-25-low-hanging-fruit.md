# Contract: close the low-hanging IPODhan work (non-data, small, known cause)

**Executor:** /goal (owner-present session)   ·   **Created:** 2026-09-25
**Mechanics:** read `docs/contracts/2026-09-25-finish-remaining-items.md` and follow its §0 (one goal session at a time,
worktrees via `wt-new.ps1`/`wt-rm.ps1`, `git show origin/main:` reads, and merges ONLY as
`node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`), its owner-delegation block, its
verification rules, and `~/.claude/rules/run-discipline.md`. Production is never touched.

**Mission.** Close the small, known-cause, NON-DATA work, and finish the two event-bound proofs plus the one scheduler defect.

**Owner decisions for this contract (2026-09-25, AskUserQuestion Q1–Q5):**
- **Q1 scope.** EXCLUDE anything whose fix needs checking IPO data values or IPO identity against real sources. That work
  belongs to a separate data-testing session.
- **Q2 size rule.** A piece is in scope only when all of these hold: the cause is already known from the issue; the fix fits one
  PR under about 300 changed lines; it needs no DB migration; and it needs no production action. If it grows beyond that, or
  fails 2 review rounds, label the issue `deferred`, add a one-line comment saying why, and move to the next one.
- **Q3 partial items.** Do the controlled staging proofs for items 6 and 19, and attempt the item 7 fix (#943) under the size
  rule.
- **Q4.** Merge #1040 (CI secret scan) and then #1037 (local pre-push gate) FIRST.
- **Q5.** Work the pre-screened list below in order. You may ADD any other open non-data issue that clearly meets the size rule.

**The /goal line (type it in the new window; never the bare path):**

```
/goal Close the low-hanging work in docs/contracts/2026-09-25-low-hanging-fruit.md. Complete ONLY when the final line of docs/contracts/.run/low-hanging-PROGRESS.md is "LOW-HANGING DONE" and every issue in the contract's lists is either closed (merged fix, or verified already fixed with evidence in a comment) or open with the `deferred` label and a one-line reason comment, and items 6, 7 and 19 each read BUILT or keep an open `parked`/`deferred` issue. Reading or complying with the contract is not completion.
```

**Progress log:** `docs/contracts/.run/low-hanging-PROGRESS.md`. Stamp every line from `date` (IST). Its last line is
`LOW-HANGING DONE`, and the line before it summarises CLOSED / DEFERRED / PARKED.

---

## Step 1: merge the two reviewed PRs (both passed Tier A)
1. #1040 (CI secret scan): rebase if main moved, wait for green CI, merge through the gate.
2. #1037 (local pre-push gate): the same.

From here on, every push runs the local gate. If either PR causes a false block, revert that PR, note it, label its follow-up
`deferred`, and continue.

## Step 2: verify and close what is already fixed (cheap, no code)
For each issue:
- Confirm the fix is on `refs/remotes/origin/main` (commit, PR, or a staging proof line in the ledger).
- Comment with the evidence, then close.
- If it is NOT actually fixed, move it to Step 4 when it's small, or label it `deferred`.

| Issue | Likely fixed by |
|---|---|
| #1016 | #1021 (E-1 fields refused, not thrown, on the document path) |
| #806 | streaming-cap proof passed about 02:00 IST 2026-09-25 (PROGRESS of the previous run) |
| #893 | item 3 Swap Test passed; row 3 BUILT |
| #759 | #957 / F-152 (structural gap is definitive) |
| #731 | #967 / #1005 re-rank; check that the manifest-version re-rank now happens |
| #722 | #1004 (F-166 IST parse for BSE) |
| #729 | the round-5 `DEPLOY_SLOT` fix in `scraper-wake.sh` |
| #717 | item 17 BUILT (closed-IPO job consumes PROSPECTUS) |
| #716 | ledger: RATIOS excluded from extraction by design; close as by-design with the ledger citation |

## Step 3: the three partial items (spec §2.1 OD-19, §2.5 OD-91, §2.3.3.3 OD-92)
- **Item 19 (#1032).** Controlled staging proof.
  - Pick two TRUE duplicate rows on ipodhan_staging: same CIN, or the merge gate's own eligibility PASS.
  - Merge them with the gated tool (the merge log is written).
  - Then `--unmerge` that merge.
  - Read back that every row is restored, by id.
  - Staging only, with the owner's tunnel OK for today. No true duplicate → keep #1032 parked.
- **Item 6 (#1034).** Controlled staging proof: re-admit or re-queue a stored LATER-type real document for one IPO whose fields
  hold receipted values from an earlier document. Read back that the fields reopen and the later document wins by rank (OD-91),
  by id.
- **Item 7 (#943).**
  - The cause is in the issue: the slot stamp is written only when NSE and BSE both succeed.
  - Fix under the size rule, with a failing test first.
  - Proof: one manual staging data run where a source fails still closes the slot once, and no re-run follows on the next wake.
  - If the fix grows (more than one PR, a migration, a scheduler redesign), label it `deferred` with the reason; item 7 stays
    PARTIAL.
- **Ledger.** Update each row in ONE batched ledger PR, then republish the board.

## Step 4: small fixes, in this order (pre-screened; re-check each against the size rule first)
Batch tiny related ones into one PR where noted. Each PR carries:
- a failing test first;
- `Class:` and `Proof:` lines in the brief;
- the literal `No detection change: <reason>` line, or a real detection change.

| # | What (one line) | Note |
|---|---|---|
| #1007 + #804 | `deploy-linux.sh` failure path calls undefined functions; a comment/fatal contradiction at :701 | one PR; `bash scripts/tests/*.sh` covers deploy |
| #751 | `deploy-config.sh` staging daily cap resets every release (STATE_DIR inside the release) | move state outside the release dir |
| #976 | merge-tool VERIFY compares numeric values as text | numeric compare in `verifyMergeReadback` |
| #996 | a chain merge deletes the earlier merge's `ipo_merge_log` row | exclude `ipo_merge_log` from the child delete |
| #1003 | merge paths that skip the eligibility gate (unused raw-SQL `dryRun:false` path, 3 old scripts) | remove or route through the gate |
| #936 | detection check "two slots ago" computed as one slot ago | test the window |
| #947 | nightly audit UNVERIFIABLE when a table's migration isn't applied | generalise #945's `isMigration…Applied` helper |
| #897 | `e_verdict_leak_sweep` false positive on the public IPO rating | exempt the rating route per the issue |
| #995 | failing integration test "Rays of Belief keys split" on ipodhan_test | fix the test or the code per its RCA |
| #1006 | ipodhan_test migration drift (0058–0061 applied by hand) | record the rows or rebuild ipodhan_test per the memory recipe; TEST DB only |
| #839 + #754 + #727 | timing assertions in 2 web integration tests; wrong field literals in T-520; missing PASS 3 summary tests | one tests-only PR |
| #821 + #810 + #905 | check-stage3-dod crash on an unrelated card; check-build-cards misreads `!docs/**`; apply-rule-ownership deletes hand-written sections | one or two tooling PRs |
| #987 | price job follow-ups (as-of before listing; guard.reason type narrowing) | small |
| #1033 | admin corrigendum ACCEPT writes `field_sources.updated_at` 5h30m behind | bind the ISO string (IST rule) |
| #755 | web field-sources repository REPLACES `data_lineage` on conflict | port #753's merge fix |
| #715 | repair tools fall back to localhost:6379 when `REDIS_URL` is unset | fail closed instead |
| #719 | staging wake wrapper can't read the Redis lock TTL and proceeds fail-open | fix the read |
| #954 | `/api/ipos/[slug]/demand-graph` returns 500 on every IPO with demand data | fix on main; prod waits for a release |
| #890 | 22 scraper type errors that no CI job sees | fix the errors; add a CI type-check only if it stays small |

**Stretch, only if everything above is done and it still meets the size rule:** #959 (extraction-failure backoff is a timed
re-read), #749 (a deploy mid-cycle leaves `scraper:cycle` locked).

## Explicitly OUT of scope
- **Data values and identity (Q1):** #728, #938, #963, #772, #771, #802, #903, #928, #1002, #1015, #979, #733, #735, #736, #819,
  #818, #721, and the nightly-audit data FAILs.
- **Tough (Q2):** #951, #908, #886, #884, #762, #807, #832, #869, #933, #932, #983, #975, #752, #748, #740 (migration), #881
  (owner call).
- **Production:** #713, #805, #825, and any production deploy or production write.

## Rules that matter most here
- **At most 2 builders at once,** never on the same files. Tier B review by default; Tier A only for hooks, migrations,
  data repairs and deploy scripts.
- **Keep generated files out of feature PRs.** Findings, decisions and ledger lines go in one batched docs PR near the end.
- **Owner delegation stands:** decide spec-conformant choices, record them as OD rows, and bring only a SPEC CHANGE to the
  owner.
- **Staging manual caps:** 2 deploys and 4 wakes a day. Today's owner-raised caps (3 / 6) applied to 2026-09-25 only.
- **Never:** `git stash`, `git checkout --`, `--no-verify`, `rm -rf` on a worktree, or `;` before `gh pr merge` (the global
  hook refuses it).

## Definition of Done
- [ ] #1040 and #1037 merged (or reverted with a `deferred` note).
- [ ] Every Step 2 issue: closed with an evidence comment, or moved.
- [ ] Items 6, 7, 19: BUILT with a `Staging proof:` line, or an open `parked`/`deferred` issue stating what is left.
- [ ] Every Step 4 issue: closed by a merged PR, or open with `deferred` and a one-line reason.
- [ ] One batched ledger PR; the board republished if a verdict changed.
- [ ] PROGRESS ends with a CLOSED / DEFERRED / PARKED summary, then `LOW-HANGING DONE`.
