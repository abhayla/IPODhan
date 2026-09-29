# Contract 3: finish release 1 and prepare the owner's deploy word

**Executor:** /goal (unattended-capable; owner may be away)   ·   **Created:** 2026-09-29
**Source:** the owner decision walk of 2026-09-29 (10 decisions + 1 follow-up), logged in
`docs/contracts/.run/owner-decisions-2026-09-29.md`; spec rows OD-139 (confirmed), OD-140, OD-141, OD-142 in
`docs/design/data-sourcing-pull-model.md` §0.0.1; contract 2's brief `docs/contracts/.run/contract-2-release-brief.md`.

**Mission.** Make release 1 deployable in the 2026-09-30 21:00-23:30 IST window, or say plainly that it
slides to 2026-10-01. **Phase 1** (release 1): triage today's NEW nightly-floor failures, fix the stalled
post-listing price job (#1310) and prove it on staging, run the admin-save proof on staging as a labelled
test owner, narrow the pm2 TZ check and set TZ on the notifier (owner-approved VPS edit), land the spec PR
with the owner's new decisions, then refresh the pre-deploy brief and write `READY FOR OWNER DEPLOY WORD`
or `RELEASE SLIDES TO 2026-10-01`. **Phase 2** (next release): build and review OD-141 (#1287), OD-142 /
§9.2 item 18 and OD-140 (#1305) to PR-ready, merged only after the release is cut. The run never deploys
production and never cuts the release branch: that is the owner's word.

**The /goal line (paste this in a fresh window; never the bare path):**

```
/goal Complete Phase 1 and Phase 2 of docs/contracts/2026-09-29-contract-3-release-1-finish.md. Complete ONLY when the last line of docs/contracts/.run/contract-3-release-1-finish-PROGRESS.md is "CONTRACT 3 COMPLETE", the log holds exactly one of "READY FOR OWNER DEPLOY WORD" or "RELEASE SLIDES TO 2026-10-01" written after every Phase 1 item has a DONE, PARKED or SKIPPED line, and every Phase 2 item has a PR-READY, DONE or PARKED line. Reading or complying with the contract is not completion. Waiting on a staging window, a price run or the owner is neither completion nor impossibility.
```

---

## §0 Start of run (in this order)

1. **One goal session at a time (run-discipline A3).** Read the last line of every
   `docs/contracts/.run/*-PROGRESS.md` in every worktree (`git worktree list`). Contract 2's log ends
   `CONTRACT 2 COMPLETE` (finished). If any OTHER log's last line is not a run-end line (`... DONE`,
   `ALL ITEMS CLOSED`, `CONTRACT n COMPLETE`), write one line to `docs/contracts/.run/owner-questions-2026-09-29.md`
   and stop building.
2. **The spec PR worktree.** `D:\Abhay\Ventures\IPODhan-IPODhan-owner-walk-0929` (branch
   `docs/owner-walk-2026-09-29`) holds UNCOMMITTED owner-approved edits: OD-139 confirmed, OD-140, OD-141,
   OD-142 plus their section text in `docs/design/data-sourcing-pull-model.md`, `EXPECT.decisions` 139 -> 142
   in `scripts/ops/build-plan-board.mjs`, this contract, and the decisions log. Item C5 lands it. Never
   `git checkout --`/`restore`/`stash` there.
3. Run `~/.claude/tools/wt-sweep.ps1 -Repo D:/Abhay/Ventures/IPODhan` in report mode and log what it says.
   Contract 2's leftover `IPODhan-IPODhan-c2-*` trees hold only CRLF noise or regenerated board files (board
   v110 is published): remove each merged one with `wt-rm.ps1`, never by hand. Do not touch `d-1255`/`d-1256`
   (their PRs #1307/#1260 merged; remove only if `wt-rm.ps1` reports merged and clean).

## §0.1 Worktree isolation

- **Never edit, build, test or run anything in the main checkout** `D:\Abhay\Ventures\IPODhan`. Its tree
  lags origin/main; its `@ipodhan/shared` junction is shared by every worktree. (The main checkout holds an
  uncommitted `CLAUDE.md` fix from 2026-09-29; item C5 carries it, see there.)
- Every change runs in its own worktree: `~/.claude/tools/wt-new.ps1 -Repo D:/Abhay/Ventures/IPODhan
  -Name IPODhan-c3-<item> -Branch <type>/<item>-<slug> -Purpose "<item>: <one line>" -TtlHours 48`, removed
  the same session its PR merges, only by `~/.claude/tools/wt-rm.ps1 -Path <tree>`.
- Read code from origin/main: `git fetch -q origin main` then `MSYS_NO_PATHCONV=1 git show
  refs/remotes/origin/main:<path>`.
- Never `git stash`, `git checkout -- <file>`, `git restore` on uncommitted work, `--no-verify`,
  `core.hooksPath`, `HUSKY=0`.

## §0.2 Idempotency preflight

Before building any item:
1. `gh issue view N --comments`; `gh pr list --state all --search "#N"`;
   `git log refs/remotes/origin/main --oneline -E --grep "#N([^0-9]|$)"`.
2. Re-read the code the item names on origin/main. Already there -> `SKIPPED (already on main: <sha>)`.
3. Grep the spec by every key term of the item (spec-first R1) and read the OD rows it cites.

## §0.3 Progress log

`docs/contracts/.run/contract-3-release-1-finish-PROGRESS.md` (gitignored). First line: slug, branch, start
time, this contract's path, the mission line. Stamp every line with `date '+%Y-%m-%d %H:%M IST'` read in the
same command (the laptop clock is IST; never `TZ=Asia/Kolkata date`, which printed UTC under Git Bash on
2026-09-29). At most 2 lines per entry; types STAGE, PROGRESS, DEFECT, EVENT, DECISION, RECOVERY, PARKED,
BLOCKER, DONE, PROOF, PROOF-OWED, PR-READY. Append before moving on. Special lines: one of
`READY FOR OWNER DEPLOY WORD` / `RELEASE SLIDES TO 2026-10-01` (C6), and last `CONTRACT 3 COMPLETE`.

## Scope boundary

- **In scope:** code under `web/`, `packages/shared/`, `scraper/`, `scripts/`; docs under `docs/`; staging
  reads; the staging test-owner account (C3); ONE VPS change: `TZ=UTC` in the notifier's pm2 env (C4).
- **Goal type:** bug-fix loop (#1310, floor triage) + proof runs + feature builds to PR-ready (Phase 2).
- **OUT of scope, hard:**
  - **Production:** no deploy, no `release/prod-*` branch, no prod DB write, no prod read beyond
    `node scripts/ops/collect-board-facts.mjs`. The deploy is the owner's word on the C6 brief.
  - **The VPS, except C4:** no config change, no ad-hoc run, no test on the box (production-host rule).
  - **#1313 (superuser password):** owner decision 1 = defer rotation AND the `TEST_DATABASE_URL` switch
    until after the release. Do not rotate, do not edit `.env`. Every brief forbids printing any line that
    contains a connection URL (memory `never-print-a-connection-url`); redact `postgres://` and `postgresql://`.
  - **#1308, #1298:** accepted as named open issues riding the release (owner decision 8). Do not fix.
  - **Hand-edited data:** no typed `UPDATE`/`INSERT`/`DELETE` anywhere. Data changes only through a
    productized tool (dry run default, `--apply`, guard), on `ipodhan_staging` only.
  - Anything labelled `parked` other than #1287 and #1305 (Phase 2 unparks them); the ~46 `deferred` issues.

## Context to read first

- `docs/contracts/.run/owner-decisions-2026-09-29.md` (the 10 decisions + follow-up this contract executes).
- `docs/contracts/.run/contract-2-release-brief.md` (sections (a)-(g); C6 refreshes it).
- `docs/design/data-sourcing-pull-model.md`: OD-29, OD-54, OD-38/OD-132 (price job), OD-104/OD-113/OD-114
  (accounts), OD-106/OD-117/OD-141 + §9.2 item 28(a), §2.8 + §9.2 item 18 + OD-142, OD-110/OD-119/OD-140 +
  §9.2 items 4 and 14, OD-133/OD-135/OD-138 (release scope, proofs).
- Issue #1310 body (RCA, evidence, 4-part fix); `scraper/src/scheduler/post-listing-price-wake.ts`
  (`PRICE_JOB_DEADLINE_MS` line 43, exit rule line 166); `docs/reviews/failure-classes/listed-rotation-stall.json`.
- `web/scripts/create-owner-admin.ts` (usage header; refuses a second owner; password from env/stdin, never
  printed); `web/lib/admin-accounts/`; migration `web/drizzle/migrations/20260928181816_admin_accounts.sql`.
- `scripts/audit-detection-floor.mjs` lines 1640-1665 (`h_pm2_env_tz`); `scripts/ops/floor-delta.mjs`,
  `scripts/ops/failure-delta.mjs`.
- `docs/ops/prod-ops-recipes.md` §2 (state reads), §3 (deploy), §14 (staging windows and the button).
- `.claude/rules/{defect-fix-contract, staging-is-the-release-gate, spec-verified-recommendations,
  signal-ownership, ist-timezone, recurrence-detection-gate, supervisor-verification}.md`;
  `~/.claude/rules/{run-discipline, spec-first}.md`.
- `docs/contracts/2026-09-28-contract-2-finish-line-and-admin.md` (house conventions repeated here).

## Pre-made design decisions (the run must NOT pause on these)

1. **Order:** C0 -> C1 and C2 in parallel (different files) -> C3 once staging serves the C1 fix or at 09:30
   IST 2026-09-30, whichever is first -> C4 -> C5 -> C6 -> C6 at 20:15 IST 2026-09-30 -> Phase 2. Phase 2
   work may START while Phase 1 waits on a window; it never merges before `RELEASE CUT` (decision 12).
2. **Release timing (owner decision 9):** target window 2026-09-30 21:00-23:30 IST. The run writes
   `READY FOR OWNER DEPLOY WORD` only if ALL hold at 20:15 IST: (a) #1310's fix is on staging and at least 12
   post-listing price wakes since then show `updated > 0` with a changing candidate front (C1 proof);
   (b) C3's admin proof is DONE; (c) every other change in the bundle has been on staging since at least
   2026-09-29 21:30 IST; (d) C0 found no NEW floor failure that the C6 brief cannot name as accepted or
   fixed. Otherwise write `RELEASE SLIDES TO 2026-10-01` naming the failed condition, and re-evaluate the
   same gate at 20:15 IST 2026-10-01 (one re-evaluation, then PARK the release decision to the owner).
3. **Staging deploys:** VPS cron windows 13:30 and 21:30 IST, or `scripts/ops/deploy-staging-now.sh`
   (cap 2 per day, each with a logged reason). For C1: if merged by 21:15 IST 2026-09-29 it rides tonight's
   21:30 window; else the 13:30 window 2026-09-30; if not merged by 13:15, use the button by 16:00 at the
   latest; not on staging by 16:00 -> condition 2(a) fails and the release slides.
4. **Builders:** at most 2 at once, never on the same files. Sonnet by default; Opus only with a
   `Why Opus: <reason>` line. Every brief carries `Budget: <N> min wall-clock, <M> tool calls`,
   `Report: evidence-table`, `Class:` and `Proof:` lines, `Core:` for new work, the spec section(s), the
   reviewer's checklist (B4), "never modify the main checkout", and "never print a line containing a
   connection URL".
5. **Review tier:** Tier B (Sonnet, diff-only) for C0 fixes, C1 and C2 unless they touch the admin write path,
   auth, a migration or the scraper write path -> Tier A (fresh Opus, adversarial, mutation tests on every
   guard). Tier C for docs (C5). At most 2 review rounds, then PARK.
6. **Local CI before every push (B3), mirroring the PR gate:** web `cd web && npm run lint:ci && npx tsc
   --noEmit` + touched vitest files; scraper touched vitest files, `npm run type-check:scripts`,
   `node scripts/ci/check-scraper-src-types.mjs`; shared `cd packages/shared && npx tsc`; every PR the `run:`
   lines of the `detection-change-gate` job in `.github/workflows/pr-gate.yml`; a docs-only PR every `run:`
   line of `.github/workflows/docs-gate.yml`. Before any push that touches a counted artefact (OD rows,
   migrations, board text) run the FULL web and scraper unit suites once (memory
   `hardcoded-counts-break-far-from-the-change`). Output to a log file, tail only.
7. **Merges:** only `node scripts/ops/merge-if-current.mjs <PR> > /dev/null 2>&1 && gh pr merge <PR> --squash`.
   Zero CI runs on a PR means CONFLICTING: rebase it.
8. **Staging reads:** tunnel `bash scripts/ops/db-tunnel.sh start` (standing approval 2026-07-02), stopped
   when no read is pending. Read sessions set `default_transaction_read_only=on`, `timezone=UTC`, and check
   `current_database() = 'ipodhan_staging'`. Role `ipodhan_app`, never `postgres`.
9. **Owner questions (run-discipline A2):** never AskUserQuestion. A choice the spec settles is built to the
   spec. A SPEC CHANGE, production, any VPS change beyond C4, or anything destructive goes to
   `docs/contracts/.run/owner-questions-2026-09-29.md` with a recommendation and a `Spec basis:` line; the
   run continues with the next item.
10. **Findings:** proven findings -> `docs/design/findings.json` (next free F-id) with a citing spec line;
    defect classes -> `docs/reviews/failure-classes/<slug>.json` + `node scripts/build-detection-registry.mjs`;
    batched into ONE docs PR per phase (B5), except what a code PR's detection gate needs.
11. **Board:** republish `docs/design/board/index.html` to https://claude.ai/artifact/NohBg52m7AUjS8kTDMxxKM
    (always with `url`) only on a stage crossing: the C1 staging deploy, the C6 verdict line.
12. **Phase 2 merge hold:** Phase 2 PRs are built, reviewed and left open with the label `next-release`
    until the PROGRESS log (written by the owner's deploy session) holds `RELEASE CUT <sha>`, or the owner
    writes "merge phase 2" in `owner-questions-2026-09-29.md`. Then merge in C/P order through decision 7.
    Reason: a merge before the cut adds unsoaked code to release 1.
13. **Time:** every human-read time IST, every stored time UTC (`ist-timezone.md` bind rules).

## The PARK rule (run-discipline A1)

PARK an item when: (a) two fix or review rounds failed; (b) it is blocked outside this contract; (c) it
needs an owner decision the spec does not cover. Parking, same turn: label the issue `parked` with the
evidence and what is left, write `PARKED (<item>): <what is left>`, move on. A second red of the same class
first gets an independent reviewer (global rule), and the third round is built around its findings.

## Phase 1: release 1

### C0. Triage today's NEW nightly-floor failures (signal-ownership R4: new beats queued work)
- **Input:** the 2026-09-29 floor delta: NEW failing checks `a_b_min_application`, `j_segment_not_null`,
  `m_live_ipo_has_state`, `m_upcoming_missing_price_band_tracking`; NEW entities under `a_b_live_conflict`
  (Eventions, Green Asia Impex, VANS ELECTROENGINEERINGS, Vishal Nirmiti), `g_repeated_warn`
  (`extraction_blocked=11`), `l_nse_status_crosscheck` (A-One Steels India, Moneyview, Papadmalji Agro
  Foods), `m_blocked_all_age` (Dove Soft, PESHWA WHEAT, Vama Wovenfab).
- **Do:** for each NEW check id: resolve to identities (which rows, which IPOs) with a staging read; search
  for an existing issue (`gh issue list --search "<check id>"`) and the failure-class registry; file an
  issue if none (R2: "known" needs a number). Classify each: (i) a defect in code that ships in release 1 ->
  it becomes a condition 2(d) item: fix it in this contract if its RCA is clear and the fix is Tier B size,
  else name it in the C6 brief for the owner to accept or hold; (ii) data an admin fixes through the queue
  (OD-134) -> comment and label `admin-queue`; (iii) a check defect (false positive) -> fix the check.
  Measure both slots: the floor runs on prod data; check whether each also fails on staging.
- **Acceptance:** one line per NEW check id and per NEW entity group naming its issue number and class
  (i/ii/iii). `DONE C0` only when every one has a number.

### C1. #1310 the post-listing price job stops starving (defect-fix contract)
- **RCA (from #1310):** the job orders candidates by `current_price_updated_at ASC NULLS FIRST` and stops at
  a 3-minute deadline; about 58 never-priceable rows (49 no price, about 9 NSE timeout/empty quote) are
  never stamped, so they lead every run and the deadline hits before a priceable row; the exit rule
  `summary.refused.length > 0 && priced === 0 ? 1 : 0` then exits 1 with only an info log.
- **Class:** `listed-rotation-stall` (2nd write path, so a mechanism is due): any deadline-bounded walk that
  sorts by a success-only timestamp. Before the fix, grep every scheduler/wake under `scraper/src/scheduler/`
  and `scraper/src/services/` for the same shape (a deadline + an ORDER BY on a success-only stamp) and list
  each in the PR body with covered / not affected + why.
- **Failing test first:** a unit test on the real wake function where the first N candidates never price
  and the rest do; red before the change (0 priced), green after (priceable rows reached within the deadline).
- **Fix:** (1) a last-attempt timestamp stamped on EVERY outcome (priced, no price, refused, timeout) and
  used for ordering; a migration if a column is needed (Tier A then, per decision 5), else reuse an existing
  attempt column if one exists (read the schema first); (2) no exit 1 while `notReached > 0`; every non-zero
  exit prints its reason at warn level (signal-ownership R6); (3) detection: a floor check that fails when
  the same candidate set is walked with 0 priced for 3 runs in a row, registered under
  `docs/reviews/detection-checks/`; (4) bump the `listed-rotation-stall` failure class with this occurrence.
- **Proof:** after staging serves it, read the price wake summaries (`~/.pm2/logs/` on the box via the §2
  read recipes, or the wake's own log lines): at least 12 wakes with `updated > 0`, and the first candidate
  ids differ between consecutive wakes. Record `PROOF:` with the counts, or `PROOF-OWED` and condition 2(a)
  fails.
- **Acceptance:** DONE with PR, test names, review verdict, staging sha, PROOF line.

### C2. Narrow `h_pm2_env_tz` (owner decision 2)
- **Do:** `scripts/audit-detection-floor.mjs` checks TZ only on IPODhan's own pm2 processes (names starting
  `ipodhan-`) and `notifier`; firekaro-api and pm2-logrotate are out of scope (another project's app and a
  pm2 module). A test asserts the exact set checked and that a missing TZ on `notifier` still FAILS
  (mutation: remove notifier from the set -> the test goes red). Update the check's registry entry under
  `docs/reviews/detection-checks/` with the narrowed scope and the owner decision date.
- **Acceptance:** DONE with PR; the next nightly floor line for `h_pm2_env_tz` read after C4 (PROOF or
  PROOF-OWED). Close #1115 with the decision when both C2 and C4 are DONE.

### C3. Admin-save proof on staging as a labelled test owner (owner decision 7 + follow-up)
- **Core:** a real login saves a value on staging and the value survives a reload and the next scraper
  cycle. **Proof:** the steps below with DB read-back.
- **Preflight:** read-only on `ipodhan_staging`: `SELECT count(*), count(*) FILTER (WHERE is_owner) FROM
  admin_users`. If an owner already exists: do not create one; write an owner question and PARK C3.
- **Account:** generate a 24+ character random password in the shell, write it ONLY to the gitignored repo
  root `.env` as `STAGING_TEST_OWNER_PASSWORD` (append; never print it, never echo the line), then run
  `create-owner-admin.ts` with `ADMIN_OWNER_PASSWORD` from that variable, `--name "IPODhan staging test owner"`,
  `--email staging-test-owner@ipodhan.invalid`, `--phone +910000000000`, dry run first, then `--apply`,
  against `ipodhan_staging` through the tunnel (the script asserts `current_database()`; it refuses
  `ipodhan` without `--allow-prod`: never pass `--allow-prod`). This account is KEPT on staging (the owner
  slot cannot be freed; production gets the owner's real account through the runbook).
- **Reach the staging web:** find the staging web port read-only (`pm2 jlist` name + `PORT` in
  `/var/www/ipodhan/shared/env/staging/web.env`, key name only, never the file's URL values) and any staging
  `server_name` in `/etc/nginx/sites-enabled/` (read-only). Use a public staging hostname if one exists
  (it also proves the Cloudflare/cookie path); else an SSH local forward to that port and say in the brief
  that the Cloudflare path is unproven.
- **Drive (Playwright, GIF `c3-admin-proof.gif`, screenshots desktop + 390 px):** log in; open one
  UPCOMING or OPEN IPO; save one typed value with a note on a non-identifier field; edit one admin list
  (§9.2 item 8: add one lead manager row, then remove it with a reason); open `/admin/conflicts` and click
  one item through to its field. After each save: reload and see the value, then a read-only DB read of the
  value, its protection row and its audit row (`e2e-persistence-verification`). After the next staging
  scraper cycle, read the value again: still the admin value.
- **Restore:** put the edited field back to its original value through the editor (itself a save, audited).
- **Acceptance:** DONE with the GIF path, the read-back rows (ids, no secrets), and the post-cycle read.

### C4. TZ=UTC on the notifier's pm2 env (owner-approved VPS change, decision 2)
- **Before:** read-only: `pm2 jlist` entry for `notifier` (status, `TZ` present?), and how it is started
  (an ecosystem file under `/root/notifier/` or a `pm2 start` line). Log both.
- **Do:** add `TZ=UTC` to the notifier's own ecosystem/env config (not a one-off shell export), then
  `pm2 restart notifier --update-env` (or `pm2 reload <ecosystem> --only notifier --update-env`), then
  `pm2 save`. Not between 08:50 and 09:10 IST (the 09:00 digest) and not inside 21:00-23:30 IST.
- **After:** `pm2 jlist` shows `TZ=UTC` for notifier and status online; the notifier's own health endpoint
  or its last log lines show no start error. Do NOT send a test notification unless it is the gateway's
  documented health check.
- **Rollback (written in the log BEFORE the change):** remove the line, restart with `--update-env`.
- **Acceptance:** DONE with before/after lines. No other VPS change.

### C5. Land the spec PR from the owner walk
- **Do:** in `IPODhan-IPODhan-owner-walk-0929`, commit (docs only): the spec rows and text (OD-139 confirmed,
  OD-140, OD-141, OD-142), `EXPECT.decisions = 142`, and this contract file. Do NOT commit
  `docs/contracts/.run/`. Regenerate what the docs gate needs (`node docs/design/generate-rule-index.mjs
  --apply` if an indexed paragraph changed; `node scripts/ops/build-plan-board.mjs`), run every `run:` line of
  `docs-gate.yml`, then the full web + scraper unit suites once (counted artefacts). Open the PR, merge via
  decision 7. Carry the main checkout's `CLAUDE.md` fix (scraper `--source` values; admin editing partly
  built; no hard-coded pattern counts): re-apply the same edits in this worktree's `CLAUDE.md` from
  `git -C D:/Abhay/Ventures/IPODhan diff CLAUDE.md`, include in this docs PR; do not touch the main checkout.
- **Acceptance:** DONE with PR and merge sha; `grep -c "^| OD-14[012] |"` on origin/main's spec = 3.

### C6. Pre-deploy brief refresh + verdict (deploy-window R6)
- **At 20:15 IST 2026-09-30,** rewrite `docs/contracts/.run/contract-2-release-brief.md` as
  `docs/contracts/.run/release-1-brief-2026-09-30.md`: (a) done + proof lines (C0-C5 and contract 2's);
  (b) cost since 2026-09-29 19:00 IST: PRs, review rounds, CI runs, staging deploys, tokens if known;
  (c) what the owner will see live, including the admin screens and that the staging owner is a test
  identity; (d) every PROOF-OWED line; (e) the release runbook from `docs/ops/prod-ops-recipes.md` §3 with the
  cut sha, migrations prod is behind (`node scripts/ops/collect-board-facts.mjs`), the owner's REAL prod
  admin account step (`create-owner-admin.ts ... --apply --allow-prod`, run by the owner), the #97 seed and
  #94 removal from contract 2's runbook, and a rollback plan that states what happens to the database after
  36+ migrations (read §3; if it has no DB rollback, say so plainly); (f) free disk % and release count;
  (g) named open issues riding: #1308, #1298 (accepted by the owner 2026-09-29), #1313 (rotation deferred),
  every C0 class-(i) item not fixed, and the admin-route auth fix as INCLUDED (prod exposed until deploy);
  (h) the four gate conditions of decision 2, each with its evidence line; (i) DEPLOY or DEFER.
- **Then** write exactly one line: `READY FOR OWNER DEPLOY WORD` (all four conditions hold) or
  `RELEASE SLIDES TO 2026-10-01: <failed condition>`. Republish the board.
- **Acceptance:** the brief exists with (a)-(i); the verdict line written after it.

## Phase 2: next release (build + review to PR-ready; merge per decision 12)

### P1. OD-141: only the top-ranked stating exchange releases an admin value (#1287, unparked)
- Read #1287's three review rounds first; the third round is built around their findings (global rule).
  Spec: OD-106, OD-117, OD-141, §9.2 item 28(a). Tests: NSE moves -> released with an alert; BSE-only move
  -> NOT released, a queue disagreement appears; an admin EMPTY value follows the same rule. Tier A (admin
  write path). Acceptance: `PR-READY` (reviewed, green, labelled `next-release`) or PARKED.

### P2. OD-142 + §9.2 item 18: values after a type/segment correction
- A still-applicable field whose rank-1 source changed keeps its value and is queued "source no longer
  first" until the new rank-1 source answers; a field the corrected type makes not-applicable disappears
  from the page (item 18 as written; the 2026-09-29 code keeps it, so this is a code gap, not a decision).
  Test with the §2.8 Mopshop shape (FPO/MAINBOARD -> IPO/SME). Tier A. Acceptance: `PR-READY` or PARKED.

### P3. OD-140: admin-only edit route for non-IPO rows (§9.2 item 4, #1305, unparked)
- `/admin/ipos/<slug>/edit` renders the same editor component as the IPO detail page for any row whose
  offering type is not IPO; admin-only (server-side session check, the 2026-09-24 auth-hole class); public
  404/notice unchanged; the §9.2 item 14 Edit link points non-IPO rows here. Test: an OFS row edit saves and
  reads back; an anonymous request gets 401/redirect. Tier A (auth). Acceptance: `PR-READY` or PARKED.

## Verification gates

| Gate | Rule (loads transitively) | Fires when |
|---|---|---|
| Supervisor verification | `supervisor-verification.md`: re-run the builder's gate, read the diff; for UI drive the page | every builder return; C3; P3 |
| Blind test verification | `independent-test-verification.md` | any test verdict |
| Output plausibility | `output-plausibility-verification.md`: a reader-visible value is domain-sane | C1 (prices), C3, P2 |
| Persistence verification | `e2e-persistence-verification.md`: reload + DB read-back, then after a scraper cycle | C3, P1, P2, P3 |
| Defect-fix contract | `.claude/rules/defect-fix-contract.md` (item 5 as narrowed by OD-138) | C0 class (i), C1 |
| Signal ownership | `.claude/rules/signal-ownership.md` R1, R2, R4, R6 | C0, C1 |
| Static gates | decision 6 | every push |

Evidence handoff: browser-automation artefacts may land in the primary checkout; copy them into the run's
worktree evidence dir and `ls`-confirm before handing paths to a verifier.

## Failure-recovery budget

- **Per item:** 2 fix or review rounds, then PARK (independent reviewer before a third round of the same class).
- **Tool hangs:** 3 recovery cycles (retry; close and reopen the tool; restart the dev server by PID), then
  PARK and continue. Kill by PID only; a kill pattern never matches its own command line.
- **Laptop memory:** under 0.5 GB free -> one builder, no background watcher.
- **Hard halt ONLY for:** a missing credential, an OS permission denial, a contradiction inside this
  contract, or a `wt-rm.ps1` proof mismatch. Context size is not a halt: write a continuation note, go on.

## Commit and push policy

- One PR per item; docs batched per phase (C5 carries the walk's docs; one findings PR at run end).
- Conventional Commits; PR body: motivation, approach, test plan, `Class:`/`Proof:` lines, the detection
  change or the exact `No detection change: <reason>` line, the review tier.
- Branches from origin/main in their own worktree; never push to `main`.
- Do not stage: `docs/contracts/.run/`, `scraper/scripts/state/`, `scripts/state/`, any `.env*`,
  `scripts/fix-test-category-fields.ps1`, the root `*-rerun.png` files, `D*_pr1128.diff`, line-ending-only
  changes to generated aggregates.

## Definition of Done (verbs are load-bearing)

- [ ] **C0-C6:** every one has exactly one terminal PROGRESS line: `DONE` (with its PR, review verdict and a
      `PROOF:` or `PROOF-OWED:` line), `PARKED` (issue labelled with evidence) or `SKIPPED (already on main)`.
- [ ] **C0:** EVERY NEW check id and NEW entity group from the 2026-09-29 delta has an issue number and a
      class (i/ii/iii) on its line. All of them, not a sample.
- [ ] **C1:** the fix is merged AND on staging, the class sweep is listed in the PR, and the proof line
      names wake counts and changing candidate ids, or the verdict line says the release slides because of it.
- [ ] **Exactly one** of `READY FOR OWNER DEPLOY WORD` / `RELEASE SLIDES TO 2026-10-01: <reason>` is written,
      after the brief with sections (a)-(i) exists.
- [ ] **P1-P3:** each has `PR-READY` (open, green, reviewed, labelled `next-release`), `DONE` (merged after
      `RELEASE CUT`), or `PARKED`.
- [ ] No production action; no VPS change except C4; no data changed except C3's account and saves through
      the app, and productized tools on staging after a logged dry run.
- [ ] Findings and failure classes from the run are merged in one batched docs PR.
- [ ] Run-end SUMMARY (DONE / PENDING / BLOCKED / PARKED / NEXT) in PROGRESS; the last line is
      `CONTRACT 3 COMPLETE`.

## Guardrails (hard stops)

- No production deploy, release branch or prod write. No VPS change beyond C4. No hand-edited data.
- No password rotation, no `.env` edit except appending `STAGING_TEST_OWNER_PASSWORD` (C3).
- Never print a secret or a line containing a connection URL; never pass `--allow-prod`.
- No spec departure without the owner (decision 9). No AskUserQuestion. No recurring cron in the session.
- No new runtime dependency unless the item cannot be built without it; record why in the PR.
- No merge of a Phase 2 PR before `RELEASE CUT` (decision 12).

## Final report (in the run-end docs PR, summarised in PROGRESS)

- Per item: terminal line with PR, tests, review, proof or proof owed.
- The brief path and its verdict line; the four gate conditions with evidence.
- PARKED list with what each waits for; owner questions raised, each with its recommendation.
- LEARNINGS TO FOLD BACK (proposals only, routed per `learnings-routing.md`).
- DONE / PENDING / BLOCKED / PARKED / NEXT, where NEXT names the owner's deploy word, then the Phase 2
  merges, then #1313 (rotation + `TEST_DATABASE_URL` -> `ipodhan_app`), #1308, #1298.

## Authorization trail (owner, 2026-09-29 walk)

| # | Fork | Decision | Why |
|---|---|---|---|
| 1 | #1313 superuser password | Defer rotation + test-URL switch until after the release | owner's call; the role is localhost-only |
| 2 | Q1 pm2 TZ | TZ on notifier (VPS edit approved) + narrow the check | notifier stamps the times the owner reads |
| 3 | Q3 non-IPO rows | OD-140 admin-only route, Phase B | no public page exists to host the editor |
| 4 | Q4 OD-106 | OD-141 only the top-ranked stating exchange releases | never re-show a date the admin rejected |
| 5 | Q5 item 18 | OD-142 keep + queue "source no longer first" | a correction never blanks a live page |
| 6 | #1310 | Fix before the release | exact RCA; avoids shipping a job that fails every 15 min |
| 7 | Admin proof | The run drives it as a labelled test owner on staging, kept | owner's time; prod owner is real |
| 8 | #1308, #1298 | Accepted as named open issues | no observed leak; 0 POSTPONED rows |
| 9 | Deploy date | 2026-09-30 window if the gates hold, else 2026-10-01 | closes the prod auth hole a day sooner |
| 10 | OD-139 | Confirmed as written | fires only on a genuinely new offer |

## References (load transitively)

- `.claude/rules/{defect-fix-contract, staging-is-the-release-gate, spec-verified-recommendations, signal-ownership, ist-timezone, recurrence-detection-gate, supervisor-verification}.md`
- `~/.claude/rules/{run-discipline, spec-first, status-artifact}.md`
- `docs/design/data-sourcing-pull-model.md`, `docs/design/findings.json`, `docs/ops/prod-ops-recipes.md`
- `docs/contracts/2026-09-28-contract-2-finish-line-and-admin.md` (house conventions)
