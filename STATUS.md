# T-331 Status

Branch: `fleet/T-331-conflicts-noise-scheduler`
Worktree: `C:\Abhay\Ventures\IPODhan-T-331-t331`
Started: 2026-08-27

## Items (6 DoD groups)

- [x] P2-6: conflict-writer noise mechanism (reject empty/equal/dup at write time) + cleanup SQL (written, not run) + HIGH_VALUE count post-filter
- [x] P2-8: scheduler wire-or-retire (the recurrence) — either wire market-hours tiering into src/index.ts prod path, or delete scraper/src/scheduler/ + update rule
- [x] P2-11: pm2-logrotate install (live, reversible ops) + deploy-linux.sh FAILs if absent
- [ ] P2-9 + P3-4: nightly audit thresholds (fieldCompleteness <5% FAIL; content table 0-rows >30d FAIL named)
- [ ] P3-1/P3-2/P3-5/P3-7/P3-6: sector empty root-cause, Chittorgarh glyph strip, cron script chmod+x, segment NOT NULL, API_FALLBACK dead-source note

## Log

- 2026-08-27: worktree created off origin/main (f6fae8f), branch pushed setup starting.
- 2026-08-27: P2-6 done. `DataConflictsRepository.logConflict`/`upsertConflict` (packages/shared,
  mirrored to web/lib — two independent copies, not a re-export) now reject empty value1/value2
  (null/''/the literal 'null' JSON.stringify produces) and value1===value2 at write time, returning
  null instead of writing a noise row; `upsertConflict` auto-resolves a stale open row when a later
  cycle's input becomes noise-shaped (sources converged). This is a defense-in-depth chokepoint —
  existing upstream guards (T-309 missing-incoming, Case-2 areEquivalent) already prevent most of
  this from `consolidateField`, but the `implausibleIssueSize` path calls `logConflict` directly and
  bypassed them. Cleanup SQL written (not run) at
  scripts/ops/2026-08-27_resolve_data_conflicts_noise.sql — marks noise-shaped UNRESOLVED rows
  resolved (resolution_reason='NOISE'), never deletes. HIGH_VALUE count in
  cross-source-disagreement-monitor.ts was already computed after the `ne(source1,source2)` filter
  (T-286) — no change needed there. 15 new unit tests in
  scraper/tests/unit/repositories/data-conflicts-repository.test.ts, all green (50/50 total across
  the 4 related test files). tsc: no new errors introduced (verified no data-conflicts-repository.ts
  lines in either scraper or web tsc output).
- 2026-08-27: P2-8 done. Re-verified T-311's RETIRE decision (docs/scraper/scheduler-liveness.md) —
  scraper/src/scheduler/ (SchedulerService, the market-hours-tiered config.ts) is still correctly
  unwired from the live path; deploy-linux.sh only ever starts src/index.ts --source=all (confirmed
  by grep: zero 'scheduler/index' references, one canonical pm2-start command shape across
  restart_pm2/resume_scraper/rollback). Added scripts/tests/deploy-linux.test.sh case 16 — a standing
  automated assertion (greps the real deploy-linux.sh content) so a future regression that wires the
  scheduler tree into the live path fails this test, same shape as T-311's
  index-scheduler-jobs-wiring.test.ts. Along the way found + fixed a PRE-EXISTING bug (predates this
  task, present on origin/main f6fae8f): report_wired_jobs()'s `grep -q "await \${call}()"` stopped
  matching after T-340's step-ledger refactor changed the call site to
  `runStep(cycleId, 'x', triggerX)` (a callback reference) — cases 12/13 in deploy-linux.test.sh were
  silently failing on main already. Fixed the grep to match both call shapes; documented as a Boy
  Scout fix directly adjacent to the file I was already changing for case 16, not scope creep — it
  was blocking a clean read of "zero new test failures" for my own case 16 addition. Full
  deploy-linux.test.sh run: all 16 cases pass (was 13/16 before my report_wired_jobs fix, now 16/16).
  Added a "Round-8 re-verification" section to scheduler-liveness.md documenting the proof.
- 2026-08-27: P2-11 done. Ran scripts/ops/install-pm2-logrotate.sh LIVE on the box (SSH
  root@72.61.240.224, key firekaro_v6_vps) — pm2-logrotate installed and online, config confirmed
  via `pm2 conf pm2-logrotate` (max_size=50M retain=7 compress=true). Verified rotation: the
  pre-existing 261M ipodhan-scraper-out.log rotated to ipodhan-scraper-out__2026-08-27_03-45-55.log
  within one workerInterval (30s) of install, leaving a fresh 0-byte log. Promoted
  assert_pm2_logrotate_installed() in scripts/deploy-linux.sh from WARN to a hard FATAL/exit-1 gate
  now that the one-time hand-run step it was waiting on is done. Updated deploy-linux.test.sh cases
  11a/11b for the new exit-code + FATAL-line semantics. Full suite: 44/44 assertions pass.
