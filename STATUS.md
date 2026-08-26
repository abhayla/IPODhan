# T-331 Status

Branch: `fleet/T-331-conflicts-noise-scheduler`
Worktree: `C:\Abhay\Ventures\IPODhan-T-331-t331`
Started: 2026-08-27

## Items (6 DoD groups)

- [x] P2-6: conflict-writer noise mechanism (reject empty/equal/dup at write time) + cleanup SQL (written, not run) + HIGH_VALUE count post-filter
- [ ] P2-8: scheduler wire-or-retire (the recurrence) — either wire market-hours tiering into src/index.ts prod path, or delete scraper/src/scheduler/ + update rule
- [ ] P2-11: pm2-logrotate install (live, reversible ops) + deploy-linux.sh FAILs if absent
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
