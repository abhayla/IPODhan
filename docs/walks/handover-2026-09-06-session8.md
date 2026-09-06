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
