# Contract: finish every pending pull-model build item

**Executor:** /goal (owner-present session, Fable supervising)   ·   **Created:** 2026-09-24
**Mission:** take every item that `docs/design/pull-model-completion-state.md` lists as **PARTIAL**
to **BUILT** on `main`, proven on staging, in the spec's dependency order. The owner's words of
2026-09-24: *"Let's first complete all the items that are pending … then we will come back and fine
tune the IPO work … it has been consuming a lot of our time and effort and tokens."*

"Done" means that every row of that document reads **BUILT**, and its evidence cell carries a real
`Staging proof:` line. The only exception is a row listed in this contract's PROGRESS log as
`BLOCKED-OWNER`, with the question already asked. Production is never touched.

**The /goal line (type this in the new session's window; never the bare path):**

```
/goal Finish every PARTIAL item in docs/design/pull-model-completion-state.md following docs/contracts/2026-09-24-finish-pending-build-items.md. Complete ONLY when the final line of docs/contracts/.run/finish-pending-items-PROGRESS.md is "ALL ITEMS COMPLETE" and every item row on origin/main reads BUILT with a "Staging proof:" line, or appears in the PROGRESS log as BLOCKED-OWNER with its question asked. Reading or complying with the contract is not completion. Waiting on the owner or on a staging window is neither completion nor impossibility.
```

---

## §0.1 Worktree isolation (IPODhan mechanics, not the generic ones)

> **First action, before §0.2 and any stage.** Never edit, test or run git-mutating commands in the
> main checkout `D:/Abhay/Ventures/IPODhan`. Its tree is shared and lags origin/main; read origin/main
> with `MSYS_NO_PATHCONV=1 git show origin/main:<path>`.
>
> 1. **One worktree per PR.** Create it ONLY with
>    `powershell -NoProfile -File C:/Users/itsab/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan -Name IPODhan-<slug> -Branch <type>/<slug> -Purpose "<why>"`.
> 2. **Remove it the same session its PR merges.** Remove it ONLY with
>    `powershell -NoProfile -File C:/Users/itsab/.claude/tools/wt-rm.ps1 -Path D:/Abhay/Ventures/IPODhan-<slug>`.
>    NEVER use `rm -rf` or `git worktree remove --force`, because node_modules junctions wiped the main
>    checkout twice. The tool prints the main checkout's file counts, and a mismatch stops the run.
> 3. **Forbidden:** `git stash`, `git checkout -- <file>` or `git restore` on uncommitted work,
>    `--no-verify`, `core.hooksPath=`, and force-push to main.

## §0.2 Idempotency preflight

> 1. **The ledger is** `docs/design/pull-model-completion-state.md`, read from origin/main. It has the
>    per-item verdict, the evidence, the "Remaining work, in order" section, and the size/tier table.
>    The spec is `docs/design/data-sourcing-pull-model.md`: the single source of truth, with §7.1's
>    dependency column and §0.0.1's OD rows.
> 2. **For every item:** confirm the claimed artefact exists on `refs/remotes/origin/main`
>    (`staging-is-the-release-gate.md` R5). Then `gh issue view` its issues. Then build only the missing
>    delta. Every card that says DONE is a claim until the artefact is found.
> 3. **Record every skip.** Items 1, 2, 4, 5, 8, 13, 15, 16, 18, 20, 24, 30, 31, 33, 34 and 35 are
>    BUILT today. Verify them only; don't build them.

## §0.3 Progress log

> 1. **Location:** `docs/contracts/.run/finish-pending-items-PROGRESS.md`. It's gitignored; create it
>    if it's missing.
> 2. **First line:** slug · start time (from `date`, IST) · contract path · mission.
> 3. **Entries:** append a ≤2-line entry at each item start, PR opened, review verdict, merge, staging
>    proof read, defect, owner question, block and completion.
> 4. **Entry format:** `[YYYY-MM-DD HH:MM IST] <STAGE|PROGRESS|DEFECT|DECISION|BLOCKER|DONE> — <summary>`.
>    Stamp every entry from `date` in the same step; never type a time.
> 5. **Final line:** `ALL ITEMS COMPLETE`, written only when the Definition of Done holds. Otherwise the
>    last entry is the run-end SUMMARY: DONE / PENDING / BLOCKED / NEXT.

---

## Scope boundary

- **In scope:** the 13 PARTIAL items below, their issues, specs, cards, tests, and the
  completion-state rows and board they change.
- **Out of scope, deferred by the owner on 2026-09-24 ("come back to the issues that are haunting
  us" later).** Don't work these. If one blocks an item, log `BLOCKER` and continue:
  - #928: CIN-differ create fails.
  - #932: stage change inferred from listing_date.
  - #933: PDF retention overrun.
  - #936: "two slots ago" check.
  - #938: listing_exchanges wrong for the NSE IPO.
  - #947: audit UNVERIFIABLE on unmigrated prod.
  - #951: the shared consolidated save writes unclaimed fields.
  - Any IPO-by-IPO data tuning.
- **Never:** a production deploy or any prod write; ad-hoc runs on the VPS (reading logs and state
  only); installing WSL or Docker; creating a database. Staging writes only for a named proof or repair.

## Context to read first (in this order)

1. `C:/Users/itsab/.claude/projects/D--Abhay-Ventures-IPODhan/memory/MEMORY.md`, especially these entries:
   - "Stop means stop"
   - "Spec first, by key terms"
   - "Merge gate rule"
   - "Main checkout tree is stale"
   - "Absence that looks like a value"
   - "Detection gate line must be verbatim"
   - "Token budget for lanes"
   - "Manual staging wakes"
2. `docs/design/pull-model-completion-state.md` (origin/main): the ledger.
3. The spec: §7.1 (the items and "Depends on"), §0.0.1 (OD rows), §1.11, and the section each item owns.
4. `.claude/rules/`: `spec-verified-recommendations.md`, `staging-is-the-release-gate.md`,
   `defect-fix-contract.md`, `stuck-means-zoom-out.md`, `owner-status-artifact.md`,
   `recurrence-detection-gate.md`, `supervisor-verification.md`.
5. Each item's build card, `docs/design/build-cards/item-NN-*.md`.

## Pre-made decisions (the run must NOT pause on these)

1. **Order.** Spec-stated dependencies first: 9←6; 10←6,9; 17←6,7,10; 11←10; 19←1; 21←1,6. Inside a
   wave, work the unblocked items. At most **two builders at once**, never two on the same files; the
   owner's token rule. No reader or supervision cron faster than hourly.
2. **Models.** Builders: Sonnet for a clear brief, Opus for a fuzzy or multi-file one (the brief
   carries a `Why Opus:` line). Reviewers: Tier A = fresh Opus, adversarial, mutation tests; Tier B =
   Sonnet, diff only; Tier C = none. Every brief also carries:
   - `Budget: <N> min, <M> tool calls`
   - `Report: evidence-table`
   - `Core:` / `Proof:` for new work, or `Class:` / `Proof:` for fixes
   - a citation of the spec section it implements
3. **T-568 rule, learned 2026-09-24.** When the spec states a call budget or a column list, the brief
   requires tests that COUNT the calls and ASSERT the exact written columns, red first. Never narrow
   a broad existing path with a flag. Build the narrow path, and never write through the whole-row
   consolidated save for a partial payload (#951).
4. **Merging.** Every merge goes through
   `node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`.
   - Wait for CI keyed on `status!="COMPLETED"`; a conclusion of `""` means still running.
   - The PR body carries the literal line `No detection change: <reason 20+ chars>` (no backticks),
     or a real detection change.
   - Merges to main are pre-approved; production is not.
5. **Staging proof.**
   - Staging deploys in the 13:30 / 21:30 IST windows. The manual staging wake has the owner's
     standing approval, capped at 4 a day with the reason logged.
   - Proof is a read-only read of `/var/log/ipodhan-scraper-wake-staging.log` on `rfp-vps`, filtered
     with `grep` and analysed on the laptop.
   - Write `Staging proof:` ONLY for a proof that passed. The board counts that literal as proven. A
     failed proof is written as `Staging check (<date>, FAILED): …`.
   - A missing log line is not a missing event. Grep the code for what emits the line first (F-151).
6. **Opening the DB tunnel** (localhost:15432 to the staging/test DB) needs the owner's word each
   time. Ask once, in one line, with the reason. Every other item continues meanwhile.
7. **Second red of the same class:** send it to an independent reviewer, then do a reviewed third
   round. A third red makes the item `BLOCKED-OWNER` with the reviews attached. Then continue with
   other items.
8. **Owner questions.** One at a time, through AskUserQuestion. Each carries a `Spec basis:` line (the
   hook enforces it), a recommendation, and real rows in the previews. Never ask what the spec
   already decides. Write every answer into the spec as an OD row before or with the code.
9. **Board.** Republish it (`Artifact publish` with the url below) only when a verdict changes, a
   deploy changes what staging serves, or a decision lands. Otherwise
   `rm -f ~/.claude/.board-owed.ipodhan` with the reason.
   Board: https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM
10. **Findings.** Any finding proven on real data goes into `docs/design/findings.json` as the next
    F-id (F-153 onward), with a citing line in the spec. If it's a defect class, it also goes into
    `docs/reviews/failure-classes/<slug>.json`, and you re-run `node scripts/build-detection-registry.mjs`.
    Same turn.
11. **Stop.** If the owner says stop, or says "no new work", finish only what is in flight, list what
    is open, and stop. Don't read it as a question.

## Stages

### Stage 0: housekeeping (small)
- **PR #952** (docs; F-151 = #943 mechanism, F-152 = structural failures on a backoff timer):
  1. Rebase it if main moved.
  2. Re-run the docs gates:
     - `node docs/design/check-design-consistency.mjs` (24/24)
     - `node scripts/ci/check-design-traceability.mjs --base origin/main`
     - `node scripts/build-detection-registry.mjs --check`
     - `node scripts/ops/build-plan-board.mjs --check`
     - `node scripts/ops/render-board.mjs --check`
  3. Merge.
  4. Remove the worktree `D:/Abhay/Ventures/IPODhan-IPODhan-staging-check-935`.
- **Owner question for PR #949** (item 7 S4, parked as a draft after 4 review rounds; read its last
  comment). It needs one decision:
  - (a) create new IPOs only from the NSE list, which states the segment, and leave BSE-only
    newcomers to the 14:00 data job; or
  - (b) leave all new-row creation to the data job, so the check only updates rows that exist.
  Recommend (a). Spec basis: OD-87, §2.1. Ask once; then finish #949 per the answer with a Tier A
  review.

### Stage 1: unblocked items (spec-stated deps met)
- **Item 7, scheduler (Tier A).**
  - (1) **#943 / F-151.** Remove the elapsed-time retry ladder (`RETRY_MINUTES`,
    `scraper/src/services/document-state-machine.ts:465-477`). Why: §2.1's row "The timed backoff
    retry is removed … not true today", and OD-21. Then:
    - A document is attempted once per OD-19 slot, and again only on a stage change or a new
      document (§2.5, OD-56).
    - "Slot complete" means every candidate was attempted once in the slot.
    - **Corrected 2026-09-24 (Tier A review of #957):** the closed-IPO job never reads a document (§6.1, `closed-ipo-job.ts`), so the LISTED document backlog stays with the data-slot document cycle. Per OD-56 / §2.5.1 a LISTED row is attempted once after the IPO enters LISTED and again only when a new document appears; rows already attempted are not candidates, so they do not hold the slot open.
    - F-152 in the same PR or a sibling PR: structural field-walk failures (NO_MAPPING,
      NO_DOCUMENT_PROVENANCE) are definitive, not transient. That means no backoff
      (`ipo-field-plan-repository.ts:106-107`).
    - Proof: a staging night where each slot logs `complete` once, with no continuation wakes. The
      class filter is the wake log's `incomplete` streak.
  - (2) **#949 S4** per the Stage 0 answer.
  - (3) **S5 post-listing price** (OD-29, OD-54, §2.1, §2.3.x delisting; finding F-150):
    - NSE via `/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolData&marketType=N&series=<S>&symbol=<X>`
      with the nse-api-client session warm-up. The series is the stock's real trading series: EQ,
      or SM/ST for SME.
    - BSE via `getScripHeaderData`.
    - Writes `ipos.current_price` + `current_price_updated_at` only, every 15 minutes in market
      hours, for 90 days after listing.
    - A 404 is not delisting evidence. Delisting needs three consecutive "no such symbol" answers.
    - Core proof first: 3 listed stocks, both exchanges, printed.
  - (4) Staging proofs for S1–S5.
- **Item 22, document handling and download limits (Tier A):** per its card.
- **Item 14, BSE share count to rupees (#728):** verification first (`staging-is-the-release-gate.md` R3).
- **Item 19, merge tool second routing (#807):** route the surviving raw-SQL merge tool through the
  shared path, and write a merge log before.
- **Item 3, S6 churn-stop (#759) and the Swap Test:** per the item 3 card and the completion-state notes.
- **Item 12, identity remainder:**
  - The #945 staging proof, which needs the tunnel (decision 6):
    `scraper/scripts/backfill-ipo-source-keys.ts --expect-db ipodhan_staging`, dry run, then
    `--apply` on staging, then read one cycle's `[OD-85]` bind lines.
  - The Rays of Belief duplicate merge on staging.
  - The S3 renames.
- **Item 32, status line residual:** per its card. #818 (item 35's actionable-split residual) is
  small, Tier C.

### Stage 2: item 6, pull walk completion
- **#762**, the re-queue path for parked plan rows: 12,480 rows in non-terminal states.
- *Inferred, not spec-stated:* item 9 can't run over parked rows, so this goes first.

### Stage 3: item 9, the re-read loop
- §2.5.1 triggers 3–7. Depends on 6 (spec-stated).

### Stage 4: item 10, the §4 verification checks
- The unbuilt checks, each a named script with a registry entry. Depends on 6 and 9.

### Stage 5: item 17, closed-IPO job completion
- Staging proof of a real 22:00 night: DONE / PARTIAL with cause classes.
- Depends on 6, 7 and 10.

### Stage 6: item 11, crore conversion (OD-20)
- Own release, Tier A. Depends on 10.

### Any time: item 21, the read side
- The remaining halves, per the card.
- The staleness threshold needs an owner decision: ask per decision 8.

## Verification gates

- **Supervisor verification** (`supervisor-verification.md`): re-run every worker's claimed gate
  yourself and read the diff. A worker's "green" is a claim, not proof.
- **Independent review:** by tier, as in decision 2. A reviewer's verdict is required before merging
  Tier A/B.
- **Static gates, by tree touched:**
  - scraper: `cd <wt>/scraper && npx vitest run <files>` (copy the CI invocation), plus
    `npm run type-check:scripts` if you touched `scraper/scripts`.
  - web: `cd <wt>/web && npx tsc --noEmit && npm run lint:ci`.
  - scripts: `node --test <file>`.
  - docs: the Stage 0 gate set.
- **Real-data proof** (`defect-fix-contract.md` item 5): a staging cycle line naming the counter that
  moved. For a data repair, `scripts/assert-repair-held.mjs <invariant> --cycles 2`.
- **Evidence table:** every turn that claims done / merged / proven ends with
  `| Claim | Evidence (tool call this turn) |`.

## Failure-recovery budget

- **Per item:** two fix rounds, then an independent review, then one reviewed round, then
  `BLOCKED-OWNER`, and move on. Never halt the run for one item.
- **Hard halt conditions only:** a destructive-operation need; a production need; a missing credential.

## Commit + push policy

- One PR per logical change: under ~400 lines, Conventional Commits.
- Branch off origin/main; squash-merge through the merge gate.
- Never stage `scraper/scripts/state/`, `scripts/state/`, or `scripts/fix-test-category-fields.ps1`
  in the main checkout (the owner's untracked files).

## Definition of Done

- [ ] Every PARTIAL row in `docs/design/pull-model-completion-state.md` on origin/main is **BUILT**
      with a passing `Staging proof:` line, or is logged `BLOCKED-OWNER` with its question asked.
- [ ] Every merged PR passed its tier's review and CI; zero production deploys.
- [ ] Every owner answer is an OD row in the spec; every proven finding is an F-id.
- [ ] The board is republished at the last verdict change.
- [ ] PROGRESS ends with `ALL ITEMS COMPLETE`, or a DONE / PENDING / BLOCKED / NEXT summary.

## Authorization trail

| Fork | Decision | Why |
|---|---|---|
| Items first vs IPO fine-tuning | Items first; the tuning issues are listed out of scope | Owner, 2026-09-24 |
| Contract now vs a new session drafting it | Contract written in the session that holds the context | Owner: "whichever way is fine" |
| #949 S4 new-row creation | Asked at Stage 0, recommend (a) | A genuine fork after 4 review rounds |
| Production | Never in this run | `staging-is-the-release-gate.md` R1 |

## References

- `.claude/rules/` in the repo, and `C:/Users/itsab/.claude/rules/` (`spec-first.md`, `status-artifact.md`).
- The handover: `.claude/tasks/handover-2026-09-24.md`.
