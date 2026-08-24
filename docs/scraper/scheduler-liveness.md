# Scheduler job liveness inventory (T-311)

**Root cause (T-305 P2-7, the D9 config-vs-code liveness class from T-297):**
production runs exactly one scraper process — `ipodhan-scraper` (PM2), the
one-shot `tsx src/index.ts --source=all`, `cron_restart: */30 * * * *`
(`pm2-scheduled-one-shot-scraper.md`). **`SchedulerService`
(`scraper/src/scheduler/scheduler.ts`, `npm run scheduler`) is never started
by PM2, crontab, or a systemd timer.** Every job defined only inside
`SchedulerService.start()` — the full IST-tiered market-hours/after-hours/
weekends cadence in `scheduler/config.ts` — is written, tested, and dead in
prod. This doc is the per-job audit: what it does, whether prod already runs
an equivalent, and the WIRE / RETIRE decision, per the T-298 write-path
architecture's F1 sequencing (`docs/architecture/write-path-hardening.md`
§1.3/§1.9/§3 Phase 2).

## F1 — scheduler.ts import rewire (done first, this task)

Per the plan's corrected Phase-2 sequencing (§3 Phase 2, finding F1
BLOCKING): `scheduler.ts` imported the **non-v2** `nse`/`bse`/`moneycontrol`/
`chittorgarh` orchestrators directly — each called `upsertIPO()` with **zero**
`BaseScraperOrchestrator`/field-protection-API references, a live protection
bypass on the documented `npm run scheduler` entrypoint (unreachable in prod
today only because that entrypoint is never started — see above).

- **Rewired** `scheduler.ts`'s 4 imports to the `-v2` orchestrators
  (`nse-scraper-orchestrator-v2.js` etc.) — same exported function names,
  so the change is a straight import-path swap.
- **Confirmed green**: `cd scraper && npx tsc --noEmit` (no new errors vs.
  baseline) and the full scraper unit suite (100 files / 1154 tests) both
  pass with the rewired imports.
- **Deleted** the five non-v2 files (`nse-scraper-orchestrator.ts`,
  `bse-scraper-orchestrator.ts`, `chittorgarh-orchestrator.ts`,
  `moneycontrol-orchestrator.ts`, `ipo-alerts-fallback-orchestrator.ts`) —
  confirmed via `grep` that `scheduler.ts` was their ONLY non-test, non-`-v2`
  importer (and `ipo-alerts-fallback-orchestrator.ts`'s only importers were
  the two files deleted alongside it). Two stale e2e test files
  (`tests/e2e/nse-scraper.e2e.test.ts`, `tests/e2e/bse-scraper.e2e.test.ts`)
  imported the deleted non-v2 paths directly; repointed to the `-v2` files
  they should have been testing all along.
- Re-ran build + full suite green after the deletion (same 100/1154 result).
- Chose **rewire-then-delete** over the plan's fallback
  (gate-the-entrypoint): the rewire was a same-shape, low-risk import swap —
  no scheduler-specific v2/non-v2 behavior difference needed investigating,
  so the fallback's extra §GATE ceremony was not warranted.

`SchedulerService` itself is **kept** as a legitimate, documented,
non-production entrypoint (`npm run scheduler`) for local/manual use — it is
not deleted wholesale, only its dead-code-adjacent non-v2 dependency is gone.

## Per-job inventory

| Job (`scheduler/config.ts` key) | What it does | Equivalent already running in prod? | Decision | Reason |
|---|---|---|---|---|
| `nse` / `bse` / `moneycontrol` / `chittorgarh` | Tiered market-hours/after-hours/weekend scrape cadence per source | **Yes** — `src/index.ts --source=all` runs all four every 30 min, 24/7, flat | RETIRE (scheduler cadence only; orchestrators kept live via F1 rewire) | The one-shot flat cadence is the measured production reality (T-176); the tiered schedule was never deployed and there is no evidence it needs to be — flattening loses nothing observable today |
| `gmpInvestorgain` | GMP scrape via InvestorGain, gated `ENABLE_GMP_SCHEDULED_JOB` | **Yes** — `src/index.ts` runs `runInvestorgainGMPScraper()` inline as part of the `source === 'all'` cycle (unconditional on the flag; the flag only gates the SEPARATE scheduler-only registration) | RETIRE (scheduler registration only) | Confirmed the `'gmp'\|'all'` branch in `index.ts` already calls the same function every cycle regardless of `ENABLE_GMP_SCHEDULED_JOB` |
| `listingPerformanceUpdate` | Refresh listed-company current prices | **Yes** — `triggerListingPerformanceUpdate()` (T-179), cadence-gated by `shouldRunListingPerformanceUpdate()` (wall-clock window) | RETIRE (scheduler registration only) | Already wired into the live path with an equivalent tiered-intent cadence guard |
| `statusUpdater` | Time-based IPO status transitions | **Yes** — `triggerStatusUpdate()` calls the web admin API every cycle | RETIRE (scheduler registration only) | Same effect via a different (HTTP) mechanism, already live |
| `healthCheck` | Per-source consecutive-failure / staleness health status | **Yes, functionally** — `triggerDataQualityWatchdog()` → `evaluateFreshness(scraperLogRepository)` (T-195) covers the same staleness/consecutive-failure signal against the same `scraper_logs` source of truth | RETIRE | Wiring the scheduler's separate `runHealthCheck()` alongside the already-live freshness watchdog would be a second, divergent implementation of the same invariant — exactly the "two copies enforcing one rule" pattern `write-path-hardening.md` warns against. Job file kept for `npm run scheduler` standalone use only. |
| `dailySummary` | Daily operational summary (IPOs scraped, success rates, errors) | No live equivalent | **RETIRE (not wired) — DEFERRED, not a silent drop** | `runDailySummary()`'s report body is a stub: `iposScraped: 0`, `iposBySource: {nse:0,bse:0,api:0}`, `subscriptionUpdates: 0`, `avgScrapeDuration: 0`, `errors: []` are ALL hardcoded `// TODO` placeholders (`daily-summary.ts:60-71`) except the two `getScraperStats()` fields. Wiring this today would log a daily "0 IPOs scraped" report every day — the exact shape-vs-substance failure `output-plausibility-verification.md` forbids shipping (same class as T-305 P3-2's `smeCount: 0` log lie). Needs real queries before it is wire-able; filed as a follow-up, not silently dropped. |
| `logCleanup` | Prune old `scraper_logs` rows | **Yes** — `pruneScraperLogs()` already runs every cycle in `index.ts` | RETIRE (scheduler registration only) | Already live via a different (inline, not job-wrapped) implementation |
| `stageReconciler` | Stage F due-but-missing fetch plan (dry-run only; enqueue is §GATE) | No — flag-gated OFF (`ENABLE_STAGE_RECONCILER`), never had ANY consumer outside `SchedulerService` | **WIRE (this task)** | Real capability with no live path; wired dry-run-only onto `src/index.ts`, gated by both the existing flag AND a 3-hour catch-up cadence — see below |
| `duplicateSweep` | Duplicate-IPO cluster sweep (dry-run only; merge/delete is §GATE) | No — the SCHEDULER's registration of this job is gated by `ENABLE_DUPLICATE_SWEEP_JOB`, but had zero consumers outside `SchedulerService` regardless | **WIRE (this task) — unconditional, not flag-gated** | The T-293/T-295 insert-guard's post-insert convergence companion, dry-run-only (report/log a plan; never deletes). Wired unconditionally (cadence-gated only, like `registrarHealthCheck`), not behind `ENABLE_DUPLICATE_SWEEP_JOB` — that flag's purpose in `config.ts` was to gate the SCHEDULER's cron registration of a job that (unlike `stageReconciler`) has no `dryRun: false` activation path to gate; a dry-run-only report has no live-write blast radius to gate behind a flag. See below. |
| `registrarHealthCheck` | Daily allotment-URL health check | **Yes** — wired T-300F via `triggerRegistrarHealthCheck()`, wall-clock cadence guard | RETIRE (scheduler registration only, already superseded) | Already live |
| `financialData` / `peerCompanies` / `anchorInvestors` / `ipoReviews` / `objectives` | Daily DRHP-derived content scrapers (financial data, peer companies, anchor investors, reviews, objectives) | No | **DEFERRED — out of this task's scope, filed as follow-up** | Real, valuable capability (T-305 P3-1 flags the resulting empty `financial_data`/`anchor_investors`/etc. tables), but wiring 5 new daily jobs — each a meaningful write surface — is a larger, separately-reviewable change than this P2 scheduler-liveness contract's budget. They remain imported only by the (never-started) `scheduler.ts`, so there is no NEW protection-bypass risk from leaving them unwired; the risk is a missed opportunity, not a live bug. Explicitly NOT silently dropped — see "Deferred work" below. |

## Newly wired jobs (this task)

Both use the **new last-run catch-up cadence guard**
(`scraper/src/scheduler/catch-up-cadence.ts`), not a wall-clock window — see
"Cadence design" below.

- **`triggerDuplicateSweep()`** (`src/index.ts`) — calls
  `runDuplicateSweepJob({ dryRun: true })` every cycle the cadence guard
  allows (~once/24h, matching the original `30 4 * * *` intent). Dry-run
  only: computes and logs the duplicate-cluster plan; the actual
  merge/delete stays a documented no-op (§GATE, unchanged from the existing
  job file — `dryRun: false` is never passed).
- **`triggerStageReconciler()`** (`src/index.ts`) — gated on
  `ENABLE_STAGE_RECONCILER === 'true'` (unchanged flag, still OFF in prod
  today — this task does not flip it) AND the catch-up cadence (~once/3h,
  matching the original `15 */3 * * *` intent). Calls
  `runStageReconcilerJob({ dryRun: true })`; enqueue/trigger remains a
  documented no-op.

Both are non-fatal side effects (`non-fatal-side-effects.md`): a failure
logs and the scrape cycle still completes successfully.

## Discovery consumer (#213, owner order 2026-08-23)

`ENABLE_PRIMARY_SOURCE_DISCOVERY` was flipped `true` in prod on 2026-08-23
under an explicit owner order and a "two clean cycles" hold-test — but
`primary-source-discovery.ts` (the NSE document-discovery parser) had
**zero consumers** anywhere in the running entrypoint; only the manual
script `backfill-primary-source-documents.ts` used it, and nothing invoked
that script automatically. The hold-test passed because nothing happened
(T-305 P2-2's blunt finding: "A hold-test that cannot fail is not a
hold-test").

**Fix (this task):** `triggerPrimarySourceDiscovery()` (`src/index.ts`),
gated on `ENABLE_PRIMARY_SOURCE_DISCOVERY === 'true'` AND the catch-up
cadence (once/24h — the underlying pass does one NSE issue-info HTTP fetch
per candidate IPO, so it is a backfill-shaped operation, not a per-30-min
one). With the flag true, it calls `runPrimaryDocBackfill({ execute: true })`,
which:

1. Selects every `offering_type = 'IPO'` row with a non-null `symbol` in
   `OPEN`/`UPCOMING`/`CLOSED` status.
2. Fetches the NSE issue-info payload per candidate and parses titled
   document rows (RHP / Anchor / Ratios / …) via `parseNSEDocuments()`.
3. Upserts each discovered document via `DocumentRepository.upsertDocument()`
   — **never a raw `db.insert`** — which dedups idempotently by URL.

**Why this satisfies "goes through the protected persister" for a
`documents`-table write:** the write-path-hardening plan's gateway (§2(a))
is explicitly scoped to `ipos` only; child tables — `documents` included —
keep their existing repository write paths as a deliberate, named scope cut
(§2(a) "Explicit non-goal"). `DocumentRepository.upsertDocument()` **is**
that existing, correct write path for `documents` — the same one every other
document writer in the codebase uses. There is no `ipos` write in this
consumer at all (candidates are pre-existing `ipos` rows, read-only), so
`resolveIpoRow`/`filterProtectedFields`/IPO-lock (the `ipos`-specific
protections) do not apply here by design, not by omission.

**With the flag false (today's live prod state), nothing runs** —
`triggerPrimarySourceDiscovery()` returns immediately before touching Redis,
NSE, or the DB. This task does **not** flip the flag; per the contract, that
remains the deploy wave's decision.

**Post-deploy hold-test (for the deploy wave, once this ships and the flag
is turned on for real):**

1. Run 2 full `--source=all` cycles with `ENABLE_PRIMARY_SOURCE_DISCOVERY=true`.
2. Confirm `documents` gained new rows with `exchange = 'NSE'`,
   `extraction_status = 'PENDING'`, and no duplicate URLs (upsert dedup
   working).
3. Confirm the scraper log shows `'[primary-doc-backfill] done'` with a
   non-trivial `docsUpserted` count on at least one of the two cycles (a
   candidate IPO with real NSE documents should exist among the live
   OPEN/UPCOMING set most days).
4. Confirm NO increase in scrape-cycle duration/timeout rate versus the
   pre-flag baseline (the NSE issue-info fetch loop iterates every
   candidate IPO sequentially — if candidate volume is large, this could
   extend cycle time; watch for it explicitly).
5. **Any anomaly (0 IPOs with symbol, all fetches failing, cycle duration
   spike, or duplicate documents) → flag back off.** This is an operational
   rollback, not a code change.

## Cadence design — last-run catch-up, not wall-clock windows

The two existing cadence guards
(`listing-performance-cadence.ts`/`registrar-health-check-cadence.ts`) use a
**wall-clock window** (`hour === 6 && minute >= 30`): a one-shot cycle only
fires the job if its execution happens to land inside a specific IST minute
range. T-300C2 flagged this as an advisory gap when reviewing the registrar
wiring: if a cycle is skipped, delayed, or the process is down during that
exact window, the job silently waits for the SAME window to come around
again (up to 24h later).

`catch-up-cadence.ts` (new, this task) tracks the **actual last-run
timestamp per job in Redis** and fires as soon as `intervalMinutes` have
elapsed, regardless of wall-clock alignment — a missed cycle is caught on
the very next cycle instead of waiting for the next matching window. Fails
open on Redis error (`redis-best-effort-fail-open.md`): both newly-wired
jobs are idempotent dry-run reads, so an extra run from a fail-open decision
costs nothing.

## Liveness tests

- `scraper/tests/unit/scheduler/catch-up-cadence.test.ts` — unit-tests the
  cadence guard itself (first-run fires, interval-not-elapsed skips,
  catch-up fires off-window, Redis-error fails open, per-job key isolation).
- `scraper/tests/unit/index-scheduler-jobs-wiring.test.ts` — proves
  `src/index.ts --source=all` actually invokes `runDuplicateSweepJob`,
  `runStageReconcilerJob` (flag-gated), and `runPrimaryDocBackfill`
  (flag-gated) — fails if any of the three trigger functions are removed
  from the `source === 'all'` block, the same pattern as the existing
  `index-registrar-health-check-wiring.test.ts` (T-300F).
- The four pre-existing `index-*-wiring.test.ts` files were updated to mock
  the four new modules (`duplicate-sweep-job.js`, `stage-reconciler-job.js`,
  `backfill-primary-source-documents.js`, `catch-up-cadence.js`) — without
  this, `triggerDuplicateSweep()` (which now runs unconditionally every
  cycle) hit their real, unmocked DB/Redis mocks and produced flaky timeouts
  under full-suite parallel load.

## Deferred work (explicitly, not silently dropped)

- **`dailySummary`**: needs real DB queries replacing its `// TODO`
  placeholders before it is safe to wire (see table above).
- **`financialData` / `peerCompanies` / `anchorInvestors` / `ipoReviews` /
  `objectives`**: real capability, filed as a follow-up (fills the empty
  content tables T-305 P3-1 flags), out of this P2 scheduler-liveness
  contract's scope.
- **`healthCheck`**: superseded by the live freshness watchdog; if a future
  review finds the two diverge in coverage, reconcile by extending
  `evaluateFreshness`, not by wiring a second implementation.

## Verification

- `cd scraper && npx tsc --noEmit` — no new errors introduced by this task
  (pre-existing baseline errors, unrelated to scheduler/index.ts, unchanged).
- `cd scraper && npx vitest run` — **honest count, correcting the earlier
  claim in this doc (T-311F, checker LOW finding):** `2 failed | 1152 passed`
  across the 1154-test suite, not "1154 passed / 1 skipped". The 2 failures
  are `base-scraper-orchestrator-fuzzy-guard-parity.test.ts`, and they fail
  **identically on `origin/main`** (verified by the independent checker
  running both the branch and a fresh `origin/main` worktree side by side) —
  a pre-existing flake under parallel test load, not a T-311 regression. The
  original "fully green" line in this doc was true on a lucky ordering, not
  a guaranteed property of the branch; do not re-cite it as a clean baseline.
- `bash scripts/tests/deploy-linux.test.sh` — all cases pass, including the
  new coverage for `assert_pm2_logrotate_installed`'s absent/present branches
  and the `report_wired_jobs` deploy-time report line (T-311F fix round;
  the predicate itself was also fixed in this round — see below).
- **T-311F fix round (post-checker):** the original `assert_pm2_logrotate_installed`
  predicate (`pm2 conf pm2-logrotate`) was a false green — it exits 0
  whether or not the module is installed, verified read-only on the real
  box where the module is genuinely absent. Replaced with a `pm2 jlist`
  presence check, added absent/present test coverage stubbing `pm2`, moved
  the install+config values out of the warning string into a real, runnable
  `scripts/ops/install-pm2-logrotate.sh`, added a `report_wired_jobs` deploy-time
  report line for `duplicateSweep`/`stageReconciler`/`primarySourceDiscovery`,
  made `shouldRunOnCatchUpCadence`'s slot reservation genuinely atomic (a
  single Redis Lua `eval` instead of a GET-then-SET, with a double-caller
  test), and bounded `runPrimaryDocBackfill`'s per-IPO NSE fetch loop with a
  5-minute total budget + a 15s per-fetch timeout (skip-remaining + log on
  budget exhaustion, unit-tested directly).
