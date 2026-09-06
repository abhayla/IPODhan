# Handover, 2026-09-06 session 8 (Fable 5.1 architect; Sonnet implements, Opus/Sonnet review)

Read in order: this file; the last 40 lines of `docs/walks/2026-09-02-deepa-pipeline-walk.md`; `docs/ops/prod-ops-recipes.md`
(the living ops runbook, owner rule 20:52 IST); `docs/ops/branching-model.md`; memory `feedback-record-ops-recipes`,
`feedback-report-in-features-not-ids`, `prod-deploy-2026-09-06-approval` (DONE).

## What happened tonight (feature terms)
- **Production release 2026-09-06 is live** (f9b67d0a, 21:02 IST, run 34042205589, tag `prod-2026-09-06`, one deploy today).
  Verified: served sha three ways, web x2, first two prod cycles extractionFailed 0, prod-verify sweep 31/31, audit:data
  legacy reds only. Rollback stays `-f ref=d38b72aa` on the same release branch.
- **Share-count issue sizes repaired on prod for Shanti Inorganics and Ashutosh Fibre** (guarded write, RETURNING-checked,
  Redis keys dropped; edge cache expired by 21:20). Template: `docs/ops/templates/repair-row-template.cjs`.
- **Redis DB assert lines** added to prod (`=0`) and staging (`=1`) scraper.env with `.bak-20260906-dsnassert` backups.
- **Listed-company document rotation fixed for real** (#328 -> main 644fe043): the discovery pass ran out of time before the
  LISTED tier every cycle, so the earlier stamp fixes never executed. Now up to `listedCap` LISTED rows are reserved when the
  budget trips (mirrors the purge slot). Proven on staging: 21:40 cycle stamped ESDS + Priority Jewels, 21:45 cycle stamped
  Lumino + Kwick Forensic. Audit `listed_rotation_stall` gained a stale-visit shape (due rows, MAX(last_attempt_at) > 24 h).
- **Nightly detection-floor audit repaired**: it had crashed every night since 09-04 at the lead-manager count check
  (`array_length` on a jsonb column), skipping every later check; fixed in #328.
- **Audit age checks were 5.5 h early** (pools without `timezone=UTC` + no 1114 UTC parser, DB default tz Asia/Calcutta,
  VPS clock IST): `scripts/lib/pg-utc.mjs` now used by all four DB-touching scripts with a runtime assert; proven on
  staging data (blocked-age 56.8 h -> 51.4 h). PR #329 (see the ledger for merge status).

## Open, owner-gated (do not act without the word)
1. **26 prod rows carry a share count as issue_size** (`docs/reviews/issue-size-repair-candidates-2026-09-06.csv`). Five are
   September mainboard rows visible now (ESDS 757 Cr shown as 1.76 Cr; Lumino; Priority Jewels; Annu Projects; Purple Style
   Labs / Pernia, which LISTS 09-07 and shows 1.25 Cr). Recommendation: a productized backfill that re-derives issue_size
   from a source for rows below the segment floor (shares x cap is wrong for at least 7 of the 26). Alternative on the
   owner's word: guarded manual write of the five September rows with shares x cap. The nightly detection-floor audit has
   flagged the class every night inside the always-red alert.
2. **SME auto-persist flip**: tomorrow, owner present.
3. **gh + token on the VPS** for nightly audit -> GitHub issues (recurrence loop parts 2-4).
4. **Legacy-row repair** (59 degenerate bands, 2 issue_size 0, 2 registrar pollution, 1 date order) plus item 1.
5. Five untracked owner PowerShell scripts in `scripts/` (log rotation etc.): not mine, left alone.

## Proofs still to read
- Staging long cycle (22:15 IST or later) budget-exhausted line must carry `listedProcessedAfterBudget 2` (short post-deploy
  cycles did not trip the budget, so the reservation itself is unit-proven only).
- First prod extractor spawn on the new release at `ni=10` (`ps -o ni= -p <pid>`, pid from pgrep, never a self-matching pattern).
- Nightly audit 03:45 IST on main: detection-floor runs end to end, session assert passes, ages sane, `c_issue_size_floor`
  still red (item 1 above).
- ESDS RHP extraction on staging times out at 10 min ("spawnSync nice ETIMEDOUT", retryCount 5, one from the 24 h floor).

## Tomorrow's release (`release/prod-2026-09-07`)
Everything on main since f9b67d0a: DRHP never emits a band; dead scheduler removed; detection gate + failure-class
registry; one extractor per box; anchor subtotals; listed rotation (three rounds); migration snapshot repair + fetch-state
index + journal lint (one journaled migration runs on deploy); write-ratchet; listed-slot reservation + audit crash fix;
audit UTC pools. Cut per `docs/ops/branching-model.md` after a full local pass on the candidate sha and the 19:00 staging
read; Rule 6 brief at 20:30; window 21:00-23:30; rollback `-f ref=f9b67d0a`.

## Rules in force (unchanged) + tonight's lessons
Feature terms, never W-ids; one deploy/day; worktrees via wt-new/wt-rm (tree path is `IPODhan-<name>` prefixed by the
tool; forward slashes from bash); no `git stash`; Budget line + model on every Agent brief; supervision tick at :13/:43.
Lessons: (1) every new or changed audit check runs once against real data before merge (a unit-tested predicate proved
nothing about the SQL around it and a crash hid three nights of checks); (2) `listedSkippedUnenriched` cannot fall unless
rows complete, the rotation proof is the spread of `last_attempt_at`; (3) ad-hoc pg readers parse naive timestamps as
laptop-local (5.5 h early), read `::text` or install the 1114 parser; (4) md-only pushes to main do not deploy staging.

## Update 23:35 IST (after the owner's "fix the pending items" and "test-architect audit" directives)
Merged to main since the first version of this file (all on `release/prod-2026-09-07`'s candidate line):
- #331 source-backed issue_size backfill; RUN ON PROD: 22 rows corrected from Chittorgarh (ESDS 720 Cr, Pernia 680 Cr,
  Stallion 199 Cr, ICICI Pru AMC 10,603 Cr, two former zeros, twelve Dec-2025 SME rows); floor check on prod 23 -> 2
  (Nirbhay Colours, Piyush: no Chittorgarh page; need a second source). Above-floor wrong-unit rows (Windlas 47 Cr for a
  401 Cr issue, AAA, Induss, Banganga, Sanmitra) are a different class: NO OWNER YET.
- #332 coverage audit substance query selects `segment` (floor + lot-band checks were inert): proven on staging (21 / 14).
- #333 extraction timeout = hard failure + every document status write invalidates `documents:<ipoId>`: merged BEFORE its
  staging proof (contract item 5 amended: merge is how the proof is obtained when staging is the only bench; the release
  cut is the gate). PROOF OWED: first staging cycle on 3c11ba12 (23:45 IST) should park the ESDS RHP with HARD_FAILURE:2;
  on prod the Skyways RHP + prospectus burn ~20 min per cycle until tomorrow's deploy.
- #330 nightly findings -> GitHub issues (5 commits, Opus x3): first night 2026-09-07 03:45 runs DRY-RUN; read
  `/root/data-audit-ipodhan/state/run-2026-09-07.log` for `ISSUES-DRY-RUN` + the planned actions; go live only on the
  owner's word with `touch /root/data-audit-ipodhan/state/issues-live`.
- Process: `.claude/rules/defect-fix-contract.md` (project) + global standing rule in `~/.claude/CLAUDE.md`; user hook
  `~/.claude/hooks/agent-fix-contract-required.py` live (Class:/Proof: on fix briefs; log at
  `~/.claude/hooks/.fix-contract.log`; escape `AGENT_FIX_CONTRACT_ALLOW=1`).
In flight at 23:35: `fix/review-gaps-scraper` (backfill drops cache keys itself when REDIS_URL is reachable; two t299
repair scripts pin UTC; substance-plausibility column coverage; registry rows) and `fix/admin-documents-cache-key` (web
admin editor used the wrong documents cache key). Then the independent review-of-the-reviews (owner 23:05).

## Owner decisions still open
1. Write-ratchet baseline says "never add an entry"; the corrective backfill was baselined. Recommend a documented
   exception category "corrective backfills (dry-run default, guarded UPDATE, RETURNING)"; alternative: route through the
   persister.
2. Flip the nightly issue sync live after reading the first dry-run log.
3. SME auto-persist flip (owner present); larger prospectus volume then meets the new 24 h timeout floor.
4. Owner of the two unmatched rows and the above-floor wrong-unit rows (second source: NSE/BSE issue size).
5. `c_issue_size_consistency` compares total issue size with `subscriptions.shares_offered` (the NET public offer), so
   anchor-heavy issues always diverge (11 on prod, unchanged by the repair): redesign or retire.

## Update 00:05 IST 2026-09-07 (after the comprehensive review and the independent review-of-the-reviews)
Merged since 23:35: #334 (web admin routes invalidate through the shared key helpers; unknown tables warn). In flight:
#335 `fix/review-gaps-scraper` (rounds 1-4 landed: backfill drops its own cache keys, t299 + two discovery scripts pin
UTC/parser, substance-plausibility evaluates real rows with a schema-backed column test, above-floor recheck mode with
`--overwrite-above-floor` requiring `--slug`; round 5 in progress: FAIL-level `m_extraction_stuck` check for
MANUAL_REVIEW/EXTRACT_FAILED/HARD_FAILURE > 48 h, live-mode refusal when the state dir is missing, reset-document and
retype-ratios scripts invalidate the documents cache, full cache-key set on repair writes). Hook: log capped + redacted (round 4).

### Release `release/prod-2026-09-07`: NO-GO until these five proofs are read (second reviewer's list, accepted)
1. Timeout fix on staging: no ESDS/Skyways retry on consecutive cycles (00:15 / 00:45 cycles) and, tomorrow, a
   `HARD_FAILURE:2` line after the next timeout (ESDS RHP not due before ~01:26 IST).
2. `m_extraction_stuck` merged and seen on staging (PASS line at 00:2x IST). DONE.
3. Index `idx_document_fetch_state_ipo_last_attempt` present on staging: READ 00:02 IST (present; prod has 33 migrations,
   staging 34, the deploy applies the 34th).
4. #335 MERGED 00:25 IST (seven rounds, Tier B x2 PASS; real-data gates read). DONE.
5. 03:45 cron log: `ISSUES-DRY-RUN` + the planned action list, with `/root/data-audit-ipodhan/state` present.
Then: full local pass on the candidate sha, cut the branch, Rule 6 brief at 20:30, window 21:00-23:30, rollback
`-f ref=f9b67d0a`.

### Owner decisions (added)
6. What `issue_size` means on the site: total (fresh + OFS, Chittorgarh's figure) or fresh only. Eight production rows
   diverge by that definition (Meesho 3,085 vs 5,421 Cr, Wakefit, Aequs, Nephrocare, Gujarat Kidney, Exato, Ravelcare,
   Phychem); three are plain wrong units (Windlas 47 -> 402 Cr, CMS Info Systems 168 -> 1,100 Cr, AAA 33.7 -> 10 Cr) and
   can be written with `--recheck-above-floor --apply --overwrite-above-floor --slug ... --allow-prod` on the owner's word.

## Update 00:20 IST 2026-09-07
- Three above-floor wrong-unit rows written on prod with the reviewed tool (Windlas 402 Cr, CMS Info Systems 1,100 Cr,
  AAA Technologies 10 Cr); the eight definitional rows (fresh vs total incl. OFS) wait for the owner's definition (item 6).
- OWNER QUESTION 00:12 ("did anyone verify the 30-minute window against the cadence decision?"): no, a review miss.
  Findings: the document cycle runs on every wake with no weekday/holiday gate (Sunday cycles made 105-115 network
  calls); its budgets (discovery + a separate 25-min extraction budget) exceed the 30-min wake and the 25-min cycle lock,
  so wakes can overlap. Recommendation given and accepted for build: keep the 30-min wake; one 20-min wake budget shared
  by discovery + extraction + reservations with the lock TTL above it; calendar gate (Sunday/holidays: live issues only);
  `m_cycle_overrun` detection check; "checked against the cadence decision" added to the review checklist. Build in
  progress in worktree `IPODhan-cadence` (branch `fix/document-cycle-cadence`), NOT for the 09-07 release; next bundle
  after a staging soak. Reviewer brief must cite the 2026-09-03 decision (ledger 13:44 IST line).

## Update 00:27 IST 2026-09-07: what is left for the release cut
Proofs owed: 1b (HARD_FAILURE:2 for the ESDS RHP on staging after ~01:26 IST; monitor armed in session 8, otherwise
read `grep -h af03ab82 ~/.pm2/logs/ipodhan-scraper-staging-out.log | grep RHP | tail`) and 5 (03:45 IST cron log with
`ISSUES-DRY-RUN` + planned actions, state dir present). Then: full local pass on the candidate sha (main as of the read),
cut `release/prod-2026-09-07`, Rule 6 brief 20:30, deploy window 21:00-23:30, rollback `-f ref=f9b67d0a`.
Not in the release: the cadence conformance build (`IPODhan-cadence`, in progress; review against the 2026-09-03 decision).
Scraper tsc baseline is now 88 (main, after #333 changed the shared package) — not 87.
