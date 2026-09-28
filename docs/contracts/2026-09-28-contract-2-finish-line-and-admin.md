# Contract 2: finish line and the full admin feature

**Executor:** /goal (unattended-capable; owner may be away)   ·   **Created:** 2026-09-28
**Source:** `docs/contracts/plans/2026-09-28-finish-line-plan.md` and owner decisions OD-133 to OD-138 in
`docs/design/data-sourcing-pull-model.md` §0.0.1; spec §9 "Admin data editing" (28 items, OD-102 to OD-122).

**Mission.** Build, in code with tests, everything the first production release needs and then the rest
of the admin feature. **Phase A:** land the witness work (#1263), build the one shared admin write path,
the admin editor on the IPO page and the ordered admin queue (the 15 core §9 items), the OD-62 reason
codes, and the 7 release blockers; then write the pre-deploy brief and the line `READY FOR RELEASE`.
**Phase B:** build the other 13 §9 items in the same run; they ride the next release. The run never
waits for real-world data (OD-138): done means merged, tested, reviewed and on staging.

**The /goal line (paste this in a fresh window; never the bare path):**

```
/goal Build every Phase A and Phase B item in docs/contracts/2026-09-28-contract-2-finish-line-and-admin.md in code with tests, review and a staging deploy, never waiting for real-world data. Complete ONLY when the final line of docs/contracts/.run/contract-2-finish-line-admin-PROGRESS.md is "CONTRACT 2 COMPLETE", the log holds a "READY FOR RELEASE" line written after every Phase A item, and every listed item has a DONE or PARKED line. Reading or complying with the contract is not completion. Waiting on a staging window, a market event or the owner is neither completion nor impossibility.
```

---

## §0 Start of run (in this order)

1. **One goal session at a time (run-discipline A3).** Read the last line of every
   `docs/contracts/.run/*-PROGRESS.md` in every worktree (`git worktree list`). If any log's last line is
   not a run-end line (`... DONE`, `ALL ITEMS CLOSED`, `CONTRACT n COMPLETE`), another goal session may be
   running: write one line to `docs/contracts/.run/owner-questions-<date>.md` and stop building.
2. **Other sessions' work.** On 2026-09-28 another session owned: PR #1260 (`fix/1256-status-ladder-forward-only`,
   worktree `IPODhan-IPODhan-d-1256`) and worktree `IPODhan-IPODhan-d-1255` (`fix/1255-no-expiry-lock-alert`,
   no PR yet). Never edit, rebase, merge or remove them. Items B1 and B2 below wait for them (see Phase A).
3. Run `~/.claude/tools/wt-sweep.ps1 -Repo D:/Abhay/Ventures/IPODhan` in report mode and log what it says.

## §0.1 Worktree isolation

- **Never edit, build, test or run anything in the main checkout** `D:\Abhay\Ventures\IPODhan`. Its tree
  lags origin/main; its `@ipodhan/shared` junction is shared by every worktree.
- Every change runs in its own worktree: `~/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan
  -Name IPODhan-c2-<item> -Branch <type>/<item>-<slug> -Purpose "<item>: <one line>" -TtlHours 48`, removed
  the same session its PR merges, only by `~/.claude/tools/wt-rm.ps1 -Path <tree>` (it proves the main
  checkout's files and packages survived). Never `rm -rf`, never a bare `git worktree remove --force`.
- Read code from origin/main: `MSYS_NO_PATHCONV=1 git show refs/remotes/origin/main:<path>` after
  `git fetch -q origin main`.
- Never `git stash`, never `git checkout -- <file>` or `git restore` on uncommitted work, never
  `--no-verify`, never `core.hooksPath`/`HUSKY=0`.

## §0.2 Idempotency preflight

Before building any item:
1. Read its issue (`gh issue view N --comments`), `gh pr list --state all --search "<item or #N>"`, and
   `git log refs/remotes/origin/main --oneline -E --grep "#N([^0-9]|$)"`.
2. Re-read the code the item names on origin/main. If the work is already there, record
   `SKIPPED (already on main: <sha>)` and move on.
3. For §9 items, grep the spec by every key term of the item (spec-first R1) and read the OD rows it cites.

## §0.3 Progress log

`docs/contracts/.run/contract-2-finish-line-admin-PROGRESS.md` (gitignored). First line: slug, branch,
start time, this contract's path, the mission line. Stamp every line with `date '+%Y-%m-%d %H:%M IST'` read
in the same command. At most 2 lines per entry; types STAGE, PROGRESS, DEFECT, EVENT, DECISION, RECOVERY,
PARKED, BLOCKER, DONE, PROOF-OWED. Append before moving on. Two special lines: `READY FOR RELEASE`
(once, after Phase A's DoD holds) and, last, `CONTRACT 2 COMPLETE`.

## Scope boundary

- **In scope:** code under `web/`, `packages/shared/`, `scraper/`, `scripts/`, `.github/workflows/`; docs
  under `docs/` (spec OD rows and section text, findings, failure classes, build cards, board data).
- **Goal type:** feature build (admin §9) plus a bug-fix loop (release blockers).
- **OUT of scope, hard:**
  - **Production:** no deploy, no release branch, no prod DB write, no prod read beyond the board facts
    collector. The release is the owner's word after the brief.
  - **The VPS:** no config change, no ad-hoc run (production-host rule). Staging deploys only through
    the windows or `scripts/ops/deploy-staging-now.sh`.
  - **Hand-edited data:** no `UPDATE`/`INSERT`/`DELETE` typed by hand anywhere. Data changes happen only
    through a productized tool (dry run by default, `--apply`, ledger, prod guard), applied to
    `ipodhan_staging` only; the production application goes into the release runbook.
  - **Admin accounts:** the run builds account management and creates no real account (OD-104). The
    owner creates his at release.
  - The ~46 `deferred` issues and the test/CI-infra list in the plan's "What stops now": contract 3.
  - Anything labelled `parked`; the 56 `fixed-on-main` issues (the release closes them); global tooling (#607, #613).

## Context to read first

- `docs/contracts/plans/2026-09-28-finish-line-plan.md` (the plan this contract executes).
- `docs/design/data-sourcing-pull-model.md`: §9 (items 1-28), §2.4 (OD-103 amendment), §2.7 (ADMIN
  outranks every source), §9.3 (per-source panel), §9.4 (queue), OD-62, OD-63, OD-102 to OD-138.
- `docs/design/findings.json` F-168 to F-174 and F-196 (measured state of admin code and witnesses).
- Issue #1108 (admin build order, core proof) and #787 (S9 queue sizing: the conflicts page is 881 lines).
- Existing admin code: `web/app/admin/` (conflicts, edit, dynamic, login), `web/app/api/admin/`
  (update-field, update-field-record, conflicts, protection, ipos), `web/lib/auth/admin-auth.ts`.
- `.claude/rules/{defect-fix-contract, staging-is-the-release-gate, spec-verified-recommendations,
  ist-timezone, recurrence-detection-gate, supervisor-verification, human-approval-gates, owner-status-artifact}.md`.
- `~/.claude/rules/{run-discipline, spec-first}.md`; `docs/ops/prod-ops-recipes.md` (staging reads, §14 windows).
- `docs/contracts/2026-09-26-contract-1-code-fixes.md` (house conventions this contract repeats).

## Pre-made design decisions (the run must NOT pause on these)

1. **Order:** Phase A (A0, A1, A2, A3, A4, B1-B7 interleaved where files do not overlap), then the brief
   and `READY FOR RELEASE`, then Phase B in the order listed. An item blocked on another waits; the run
   takes the next one.
2. **Admin screens come from spec §9, no mockup gate.** §9 fixes the layout decisions (source panel per
   field, typed value with unit preview and note, stacked panel on a phone, reader line). The run builds
   to it and captures a screenshot of every admin screen, desktop and 390 px phone width, into
   `docs/contracts/.run/contract-2-screens/`; they go into the brief for the owner's G2 sign-off
   (`human-approval-gates.md`: G1 is waived by the owner's go on this contract, 2026-09-28).
3. **Done = code + tests + review + merged + on staging (OD-138).** After merge, trigger or wait for the
   next staging deploy; do not wait for a real-world event. If a staging reading is available at that
   moment, record it (`PROOF: ...`); otherwise write `PROOF-OWED (<item>): <the exact read that proves it>`
   and move on. Every PROOF-OWED line goes into the brief.
4. **One item = one PR,** unless two items share files and a class (then one PR naming both).
5. **Builders:** at most 2 at once, never on the same files. Sonnet by default; Opus only with a
   `Why Opus: <reason>` line (fuzzy spec, multi-file, shared write path, migration). Every brief carries
   `Budget: <N> min wall-clock, <M> tool calls`, `Report: evidence-table`, `Class:` and `Proof:` lines,
   `Core:` for new work, the spec section(s) it implements, the reviewer's checklist (B4), and "never
   modify the main checkout".
6. **Review tier:** Tier A (fresh Opus, adversarial, mutation tests on every guard) for the admin write
   path, auth, migrations, the scraper write path and deploy scripts; Tier B (Sonnet, diff-only) for
   other code; Tier C for docs. At most 2 review rounds, then PARK.
7. **Local CI before every push (B3), mirroring the PR's gate exactly:** web: `cd web && npm run lint:ci
   && npx tsc --noEmit` plus touched vitest files; scraper: touched vitest files, `npm run
   type-check:scripts`, `node scripts/ci/check-scraper-src-types.mjs`; shared: `cd packages/shared && npx
   tsc`; migrations: `node scripts/ci/check-migration-journal.mjs`, `node scripts/ci/check-migration-snapshot-chain.mjs`;
   every PR: the `run:` lines of the `detection-change-gate` job in `.github/workflows/pr-gate.yml`
   (registry, build-plan-board, render-board checks and tests). A docs-only PR runs every `run:` line
   of `.github/workflows/docs-gate.yml`. Output to a log file, tail only.
8. **OD rows:** every new OD row has 5 cells (`| OD-n | decision text | date | sections | where reflected |`),
   and `EXPECT.decisions` in `scripts/ops/build-plan-board.mjs` is bumped in the same PR (failure class
   `docs-only-gate-weaker-than-the-code-gate`). A spec edit that changes an indexed paragraph regenerates
   `docs/design/rules.json` (`node docs/design/generate-rule-index.mjs --apply`) and repoints any build
   card that claimed the retired rule id.
9. **Merges:** only `node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`.
   Zero CI runs on a PR means CONFLICTING: rebase it.
10. **Staging deploys:** VPS cron windows 13:30 and 21:30 IST, or `scripts/ops/deploy-staging-now.sh`
    (cap 2 per day, each with a logged reason). Batch merges before a window rather than spending the cap.
11. **Staging reads and data tools:** tunnel `bash scripts/ops/db-tunnel.sh start` (standing approval
    2026-07-02), stop it when no read is pending. Read sessions set `default_transaction_read_only=on`,
    `timezone=UTC`, and check `current_database() = 'ipodhan_staging'`. A data tool's `--apply` runs on
    staging only, after its dry run is logged.
12. **Owner questions (run-discipline A2):** never AskUserQuestion. A choice the spec settles is built
    to the spec. A SPEC CHANGE, a new behaviour the spec does not cover, production, a VPS change or
    anything destructive goes to `docs/contracts/.run/owner-questions-<date>.md` with a recommendation
    and a `Spec basis:` line, and the run continues with the next item.
13. **Findings and ledger:** proven findings go into `docs/design/findings.json` (next free id after
    F-197) with a citing line in the spec; defect classes into `docs/reviews/failure-classes/<slug>.json`;
    batched in one docs PR per phase.
14. **Board:** republish `docs/design/board/index.html` to https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM
    only when a stage crosses (item 36 verdict change, READY FOR RELEASE, a staging deploy that changes
    what staging serves). Always with `url`.
15. **Time:** every human-read time is IST, every stored time UTC (`ist-timezone.md` bind rules).
16. **Admin UI conventions:** reuse the existing admin shell (`web/app/admin/layout.tsx`) and auth
    (`web/lib/auth/admin-auth.ts`); every admin API route checks the session server-side (the 2026-09-24
    auth-hole class); source values never reach a public API or page (§9 item 24, OD-61).

## The PARK rule (run-discipline A1)

PARK an item when: (a) two fix or review rounds failed; (b) it is blocked by something outside this
contract; (c) it needs an owner decision the spec does not cover. Parking = the same turn: label the issue
`parked` (or open one) with the evidence and what is left, a `PARKED (<item>): <what is left>` line, move
on. Never retry a parked item. Waiting for real data is never a reason to park (decision 3).

## Phase A: release 1

### A0. Land the witness work (#1263)
- **Do:** PR #1263 (`fix/witness-every-answer`: every ranked answer stored as a witness; empty fields
  keep per-rank answers in `ipo_field_plan.answers`, OD-137). It is reviewed (Tier B PASS, Tier A MAJOR
  fixed). Rebase if needed (if OD-138 landed first, OD-137's row and `EXPECT.decisions` reconcile to 138),
  run decision 7's gates, merge.
- **Acceptance:** merged; PROOF or PROOF-OWED: `field_sources` rows with 2+ witnesses for 3 live IPOs,
  and `ipo_field_plan.answers` filled on an empty field (e.g. vishal-nirmiti-ltd price band).

### A1. OD-62 reason codes for missing values
- **Core:** a field no source supplied carries a reason code the queue can list. **Proof:** unit tests on
  the walk; staging count of plan rows with a reason code vs rows with no value.
- **Do:** spec OD-62 (codes SOURCE_UNREACHABLE, NOT_PUBLISHED_YET, EXTRACTION_FAILED, the rest of its
  list) plus OD-77 NOT_SOURCED and OD-123. Today `field_extraction_failures` holds 0 rows while 12,701
  plan rows hold no value (completion-state "Not on the numbered list"). Write the code where the walk
  records a no-value outcome.
- **Acceptance:** DONE line with PR; tests assert the exact code per no-value branch.

### A2. One shared admin write function (§9 items 3, 11, 12, 19, 20)
- **Core:** an admin save outranks every scraper and survives the next cycle. **Proof:** an integration
  test against `ipodhan_test` (localhost:15432 tunnel) that saves, runs the consolidator with a scraper
  value, and reads the admin value back.
- **Do:** one function used by every admin entry point: writes the value as source ADMIN (§2.7), the
  protection row and the audit row (fixes F-170), drops the detail-page cache key (F-171), writes child
  tables as well as `ipos` (F-169), runs the field's §1 check on a typed value (item 12, OD-108), refuses
  a save when the field changed after the editor opened (item 20), and a scraper at the same moment never
  wins (item 19). Fold in #1159 (400 on a bad value) and #1243 (admin paths still touching `ipo_reviews`).
- **Acceptance:** DONE; Tier A review passed; the old admin save routes call only this function.

### A3. Admin editor on the IPO page (§9 items 1, 2, 5, 6, 7, 10, 13, 17, 22, 24)
- **Core:** a logged-in admin sees each source's value for a field and saves a pick or a typed value.
  **Proof:** Playwright on the dev server against `ipodhan_test`: open an IPO, edit a field, reload, see it.
- **Do:** item 1 Edit control on the public IPO detail page (whole IPO and per section, admin only);
  item 2 per field every Appendix A source with its witness (value / abstained / failed cause /
  never asked, OD-137 answers for empty fields), the current source marked; item 5 derived fields
  read-only; item 6 admin accounts (OD-104: name, email, phone, Telegram id, email+password, owner-only
  management; no account created by the run); item 7 which fields are offered (OD-105 classes); item 10
  live at once; item 13 reader line ("From NSE, read <date>" / "Set by admin"); item 17 every IPO, every
  status; item 22 no re-scrape button; item 24 source values never reach a reader.
- **Acceptance:** DONE; screenshots per decision 2; supervisor drives the page (screenshot, ARIA,
  console, interact) before accepting.

### A4. Admin queue (OD-63, OD-136, §9.4)
- **Do:** `/admin/conflicts` becomes the data-quality queue: unresolved genuine conflicts (after the
  F-173 noise filters) plus every field with an OD-62 reason code, each linking to the field in the
  editor. Order per OD-136: UPCOMING, OPEN and CLOSED-not-listed IPOs for the fields the public page
  shows; then their other fields; then LISTED IPOs collapsed, newest listing first. Nothing hidden.
- **Acceptance:** DONE; a test asserts the ordering on fixture rows of all three groups; screenshots.

### B1-B7. Release blockers (bug-fix loop, defect-fix contract per item)
| Item | What | Note |
|---|---|---|
| B1 #1256 | Status date ladder moves status backwards | other session's PR #1260: wait for it to merge; if it is not merged 24 h after this run starts, write an owner question and continue |
| B2 #1255 | A no-expiry lock skips every wake silently | other session's worktree d-1255: same rule as B1 |
| B3 #1259 | Deploy proceeds while an old scraper run is live | deploy script; Tier A |
| B4 #97 | /affiliates: Zerodha only, real link from env `ZERODHA_AFFILIATE_URL`, no invented claims, AP disclosure | branch `fix/97-affiliates-zerodha-only` is built and verified (commits 8375e5aaa, 1dcddcd2f): open its PR, gates, merge; then run the seed on staging (dry run, `--apply`); production seed goes into the release runbook |
| B5 #94 | Dummy "Alpha/Beta Registrar" seed rows | build a removal tool (dry run default, ledger); apply on staging; production in the runbook |
| B6 #1115 | pm2-logrotate, firekaro-api, notifier have no TZ in their env | deploy-side ecosystem change only if it lives in this repo; if it is VPS-only config, owner question |
| B7 #620 | Document queue never drains (budgetExhausted every cycle) | measure first on staging (read-only); 2 rounds max, then PARK |

### A5. The admin-queue hand-off (OD-134)
These issues are admin work, not code: #453, #472, #561, #598, #684, #696, #979, #1179, #1196, #212, #241,
#1116, #903, #963, #721, #356. For each: confirm the field appears in the queue on staging (or would, by
the queue's filter), comment on the issue "Handled through the admin queue (OD-134): <field>, <IPO>", label
`admin-queue`, close it. If a field would NOT appear in the queue, that is a queue defect: fix it in A4.

### A6. Pre-deploy brief and READY FOR RELEASE
- **Do:** write `docs/contracts/.run/contract-2-release-brief.md` per the one-deploy-window rule R6:
  (a) done + proof lines; (b) cost: PRs, review rounds, CI runs, staging deploys; (c) what the owner will
  see live, with the screenshots; (d) every PROOF-OWED line; (e) the release runbook: migrations count
  prod is behind (from `node scripts/ops/collect-board-facts.mjs`), the production seed for #97, the
  #94 removal, admin account creation by the owner, the rollback command; (f) free disk % and release
  count; (g) DEPLOY/DEFER recommendation with reasons. Republish the board.
- **Acceptance:** the brief exists; PROGRESS gets `READY FOR RELEASE` only when every A0-A5 and B1-B7
  item has a DONE, PARKED or SKIPPED line.

## Phase B: the other 13 §9 items (next release)

Each is a feature item with its §9 text as the requirement: grep the spec, build, test, review, merge,
staging. Order by §9 item number: 4, 8, 9, 15, 23, 14, 18, 16, 26, 25, 27, 21, 28.
- **§9 item 4 (OD-119):** editing covers every IPO, including the 19 OFS rows the scraper skips (OD-53).
- **§9 item 8, lists (OD-107, F-174):** lead managers, promoters, peer companies: add, remove, edit rows.
- **§9 item 9:** a newer document after an admin save becomes a suggestion in the queue, never an overwrite.
- **§9 item 14 (OD-110):** editing appears only on the detail page; list/calendar/tracker pages read only.
- **§9 item 15 (OD-111):** create an IPO by hand (company name + identifiers).
- **§9 item 16 (OD-112):** alerts through the Notifier gateway to the one IPODhan Telegram chat (zero-dep
  client; `NOTIFIER_URL`/`NOTIFIER_KEY`; fail-open).
- **§9 item 18:** saving `offering_type`, `segment` and other plan-invalidating fields regenerates the plan.
- **§9 item 21 (OD-115):** full phone editing layout (the A3 screens already stack; this finishes it).
- **§9 item 23 (OD-116, OD-118):** hide a row (410), never delete.
- **§9 item 25:** dismissed suggestions and alerts do not repeat (OD-66, OD-93).
- **§9 item 26:** editing an identifier keeps the old one.
- **§9 item 27 (OD-120):** a relaunched IPO clears admin values as the spec says.
- **§9 item 28:** the round-2 review clarifications listed there.

## Verification gates

| Gate | Rule (loads transitively) | Fires when |
|---|---|---|
| Supervisor verification | `supervisor-verification.md`: re-run the builder's gate, read the diff; for UI drive the page | every builder return; every admin screen |
| Blind test verification | `independent-test-verification.md` | any test verdict |
| Output plausibility | `output-plausibility-verification.md`: a value a reader sees is domain-sane on the default path | A2, A3, B4 |
| Persistence verification | `e2e-persistence-verification.md`: a save is re-read after a reload and after a consolidator run | A2, A3, Phase B write items |
| Defect-fix contract | `.claude/rules/defect-fix-contract.md` (item 5 as narrowed by OD-138) | B1-B7 |
| Static gates | decision 7 | every push |

## Failure-recovery budget

- **Per item:** 2 fix or review rounds, then PARK. A second red of the same class gets an independent
  reviewer first (global rule), then the third round is built around its findings.
- **Tool hangs:** 3 recovery cycles, then PARK and continue. Kill processes by PID only.
- **Laptop memory:** if free memory is under 0.5 GB, run one builder, not two, and no background watcher.
- **Hard halt ONLY for:** a missing credential, an OS permission denial, a contradiction inside this
  contract, or a `wt-rm.ps1` proof mismatch. Context size is not a halt: write a continuation note and go on.

## Commit and push policy

- One PR per item (decision 4); docs batched per phase (B5), except OD rows that a code PR needs.
- Conventional Commits; the PR body carries motivation, approach, test plan, the `Spec deviation` block,
  `Class:`/`Proof:` lines, and the detection change or the exact `No detection change: <reason>` line.
- Branches from origin/main in their own worktree; merge only through decision 9. Never push to `main`.
- Do not stage: `docs/contracts/.run/`, `scraper/scripts/state/`, `scripts/state/`, any `.env*`,
  `scripts/fix-test-category-fields.ps1`, line-ending-only changes to generated aggregates.

## Definition of Done (verbs are load-bearing)

- [ ] **A0-A5 and B1-B7:** every one has exactly one terminal PROGRESS line: `DONE` (PR merged, tests
      green, review passed, deployed to staging, plus `PROOF:` or `PROOF-OWED:`), `PARKED` (issue labelled
      with evidence) or `SKIPPED (already on main)`. All of them, not a sample.
- [ ] **Every admin screen** built in A3/A4 has a desktop and a 390 px screenshot in
      `docs/contracts/.run/contract-2-screens/`, and the supervisor drove it (save, reload, value shown).
- [ ] **The 16 OD-134 issues** are each labelled `admin-queue` and closed with the comment, or reopened as a
      queue defect fixed in A4.
- [ ] **The release brief** exists with sections (a)-(g), every PROOF-OWED line listed, and `READY FOR
      RELEASE` is written after it.
- [ ] **Phase B:** every one of the 13 listed §9 items (4, 8, 9, 14, 15, 16, 18, 21, 23, 25, 26, 27, 28) has a
      DONE or PARKED line.
- [ ] No production action was taken; no data was changed except by a productized tool on staging after
      a logged dry run.
- [ ] `docs/design/pull-model-completion-state.md` item 36 verdict updated from the merged artefacts
      (measured on `refs/remotes/origin/main`, release-gate R5).
- [ ] Findings and failure classes from the run are merged in batched docs PRs.
- [ ] Run-end SUMMARY (DONE / PENDING / BLOCKED / PARKED / NEXT) in PROGRESS; the last line is
      `CONTRACT 2 COMPLETE`.

## Guardrails (hard stops)

- No production deploy, release branch or prod write. No VPS change. No hand-edited data.
- No new runtime dependency unless the item cannot be built without it; record why in the PR.
- No spec departure without the owner (decision 12).
- No synthetic data presented as real; fixtures for parsers come from real captured pages or documents.
- No AskUserQuestion; no recurring cron inside the session (run-discipline D4).
- Never touch another session's branch or worktree (§0 item 2).

## Final report (in the last batched docs PR, summarised in PROGRESS)

- Per item: terminal line with PR, tests, proof or proof owed.
- The release brief path and its DEPLOY/DEFER recommendation.
- PARKED list with what each waits for; owner questions raised, each with its recommendation.
- LEARNINGS TO FOLD BACK (proposals only, routed per `learnings-routing.md`).
- DONE / PENDING / BLOCKED / PARKED / NEXT, where NEXT names the release (owner's word) and contract 3
  (the deferred issues).

## Authorization trail (owner, 2026-09-28)

| Fork | Decision | Why |
|---|---|---|
| Finish line | Admin core, then ONE prod release (OD-133) | end the three-week prod drought with a reachable finish |
| Scraper vs admin | Two-test rule per field (OD-134) | easy-to-find data stays the scraper's; flaky or unfindable data goes to the admin |
| First-release admin scope | 15 core §9 items + queue (OD-135) | everything needed to fix a value |
| Queue order | Live IPOs first, nothing hidden (OD-136) | readers decide on live IPOs |
| Empty fields | Per-source answers on the plan row (OD-137) | the admin needs to know which source to chase |
| Proofs | Code + tests; never wait for real data (OD-138) | waiting on events kept items open for days |
| Contract scope | Finish line only; deferred issues are contract 3 | the release is not delayed by them |
| Admin in this contract | All 28 §9 items, core first; Phase B rides the next release | the whole feature from one run without holding the release |
| Affiliates | Zerodha only with the real link (owner answer, #97) | the only link proven real |
| Mockup gate | Waived; build from §9, screenshots for G2 in the brief | §9 already fixes the layout |
| Data writes | Productized tools on staging only; prod in the release runbook; no admin accounts created by the run | owner's go on the checkpoint |

## References (load transitively)

- `.claude/rules/{defect-fix-contract, staging-is-the-release-gate, spec-verified-recommendations, ist-timezone, recurrence-detection-gate, supervisor-verification, human-approval-gates, owner-status-artifact}.md`
- `~/.claude/rules/{run-discipline, spec-first, status-artifact}.md`
- `docs/contracts/plans/2026-09-28-finish-line-plan.md`, `docs/design/data-sourcing-pull-model.md`, `docs/design/findings.json`
- `docs/contracts/2026-09-26-contract-1-code-fixes.md` (house conventions), `docs/ops/prod-ops-recipes.md`
