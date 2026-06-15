# GOAL — Revive & harden the GMP pipeline (coverage 1% → ≥95% of listed-current IPOs), consolidate schema, render GMP honestly

**Type:** Autonomous **build + fix + migration** contract (run via `/goal`). Execute end-to-end with
**zero user input**. Every design decision is pre-made below — do not pause to ask; make the call the
contract specifies and keep going until the Definition of Done is fully met.

**Owner:** Abhay · **Created:** 2026-06-14 · **Scope:** `scraper/`, `packages/shared/`, `web/`, `docs/` in `D:\Abhay\VibeCoding\IPODhan` ONLY
**Invocation:** `/goal docs/goals/2026-06-14-gmp-coverage-revival.md`
**Companion:** monitoring runs from a separate session (author/monitor) — see `docs/goals/.run/2026-06-14-gmp-coverage-revival-PROGRESS.md`.

---

## 0. Mission

IPODhan's GMP (Grey Market Premium) is a core value prop but is **structurally broken at ~1% coverage**
(3 of 307 IPOs; newest `gmp_records` row `2026-06-12`, frozen). The web app reads `gmp_records`
exclusively; its writer (`runInvestorgainGMPScraper`) is **not registered in the in-app scheduler** and
matches only the same 3 IPOs (date-only matching, no SME, near-duplicate inserts); the schema/docs
describe **three conflicting designs** (`gmp_records` live; `gmp_history` + `gmp_tracking` orphan/empty);
and the UI shows stale GMP as current. **Done = GMP flows, matches the majority of current IPOs, is stored
with full fidelity in ONE canonical table (`gmp_records`), and is rendered with an honest "as of <date>"
staleness label — all PROVEN by tests + read-only prod-DB queries, with NO prod deploy and NO destructive
prod DDL.** This is a fix-and-harden of an existing pipeline, not a greenfield build.

---

## 0.2 PREFLIGHT — read the coverage state FIRST (idempotency · NO duplication)

**This is the first action of the run, before ANY stage. Non-negotiable.** A parallel session (the monitor,
or a prior `/goal` run) may already have implemented part of this contract. This contract must be **safe to
run at any time without redoing finished work.**

1. **Read the GMP state ledger** (this project has no single gap-doc; reconstruct it from these SSOTs):
   - `memory` note `gmp-coverage-root-cause.md` (root cause + the G1–G23 inventory reference);
   - this contract's own §7 Definition of Done checkboxes if a prior run edited them;
   - `docs/goals/.run/2026-06-14-gmp-coverage-revival-PROGRESS.md` if it exists (the run's own ledger — create it on first run, keep it current).
2. **For every task below, check `git log` + the actual code before building it.** Scan
   `git log --oneline -25 | grep -iE "gmp|investorgain"` and the `feat/gmp-coverage-revival` branch. If a task's
   change is already committed (grep/read to confirm — do NOT trust a checkbox blindly), **SKIP the build**,
   do a verify-only pass, and move on. If partially done, build only the missing delta. If absent, build it.
3. **Re-measure live coverage** via the tunnel before Stage A and after each stage (query in §1) so progress
   is measured against real data, not assumptions.
4. **Record every skip** in the final report's "skipped (already covered)" list.

This makes the contract idempotent: a re-run after partial progress produces only the remaining delta.

---

## 1. Context you need (read first)

**Target stack:** Next.js 15 web (`web/`, dev port 3000), ESM scraper (`scraper/`, tsx), shared package
(`packages/shared/`). DB is **prod Postgres reached through the SSH tunnel at `localhost:15432`**
(`web/.env.local`). `psql` is NOT installed — use `node`+`pg`. If the tunnel is down, re-establish:
`ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189`.

| Thing | Path / import | Why it matters |
|---|---|---|
| GMP orchestrator (active, v2) | `scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts` | fetch→match→persist; `matchIPOByDates` (~:77), name-match gate (~:295), success calc (~:403) |
| GMP fetch+parse | `scraper/src/scrapers/investorgain-gmp-scraper.ts` | `parseGMP` (~:70, `<b>`-coupled), `parseGMPTimestamp` (~:98, year-assuming), category hardcoded `'ipo'` (~:162,230) |
| GMP write path | `scraper/src/services/data-persister.ts` | `createGMPRecord` (~:525), `Math.round(gmp)` (~:539), JS normalizer (~:163) |
| Name-match SQL | `packages/shared/src/repositories/ipo-repository.ts` | `findByNormalizedName` SQL normalizer (~:315) — MUST agree with the JS one |
| GMP repository (writer) | `packages/shared/src/repositories/gmp-repository.ts` | raw `db.insert(gmpRecords)` (~:115) |
| Scheduler | `scraper/src/scheduler/scheduler.ts`, `scraper/src/scheduler/config.ts` | NO GMP job today; Chittorgarh job (~:167 / config:70) writes `ipos.gmp`, not `gmp_records` |
| Field priority matrix | `scraper/src/config/field-priority-matrix.ts` | GMP entries (~:358) lack `INVESTORGAIN_GMP` source |
| Feature flags | `scraper/src/config/feature-flags.ts` | `ENABLE_GMP_NAME_MATCH` (on in prod since `07470243`); gate new behavior here |
| Schema SSOT | `packages/shared/src/db/schema.ts` | `gmpRecords` (~:342, `gmp` is `integer`, no `gmp_percentage`); orphans `gmp_history`/`gmp_tracking` NOT defined here |
| Web GMP read | `web/lib/repositories/ipo-repository.ts` | detail join (~:290) + listings latest (~:1517); `gmp || null` bug (~:1576) |
| Web GMP UI | `web/components/ipo/KeyMetricsCards.tsx` (~:50,120), `web/components/ipo/charts/GMPHistoryChart/{index,utils}.tsx`, `web/components/ipo/GMPChart.tsx`, `web/components/listings/IPOListingsTable.tsx` (~:60,215) | render surfaces; no staleness label; `utils.ts:76` fabricated ±10% bands |
| Fake-data GMP | `web/app/api/live-updates/route.ts` (~:89), `web/components/live/LiveGMPTicker.tsx`, `web/components/dashboard/HotRightNow.tsx` | `Math.random()` GMP — quarantine/delete (test-route only today) |
| Plausibility div | `web/app/ipos/[slug]/page.tsx` (~:201), `web/app/api/ipos/[slug]/gmp/latest/route.ts` (~:162) | `gmp/issuePrice*100` unguarded → `NaN`/`Infinity` |
| Docs | `docs/08-scraping/SCRAPING_STRATEGY.md`, `docs/16-database/screen-database-mapping-subscription-gmp.md`, `docs/08-scraping/verification_queries/11_related_tables.sql` (~:179-188 wrong `recorded_at`) | stale source attribution (Chittorgarh→InvestorGain) + wrong-column query |

**Coverage query (read-only, via tunnel — the AC1 measuring stick).** Run before Stage A and after each stage:
```js
// node web -e ... using web/.env.local DATABASE_URL, pg.Client to localhost:15432
//   listed_current = InvestorGain-listed current IPOs the run fetched this session
//   matched = distinct ipo_id in gmp_records with timestamp in this run's window
//   coverage = matched / listed_current ; ALSO log listed-but-unmatched names verbatim (no silent drop)
SELECT count(*)::int rows, count(distinct ipo_id)::int ipos, max(timestamp)::text newest FROM gmp_records;
SELECT count(*)::int n FROM ipos WHERE status IN ('OPEN','UPCOMING');  -- baseline: 22
```

**Gotchas:**
- **CWD trap:** root `package.json` proxies only `dev`/`dev:scraper`/`lint`/`build`/`test:unit`; everything
  else runs from `web/`; scraper tests run from `scraper/` with the right tier config (`.claude/rules/scraper-test-layout.md`).
- **Schema SSOT:** edit ONLY `packages/shared/src/db/schema.ts`; `web/lib/db/schema.ts` is a STALE legacy copy — never touch.
- **Shared build first:** `cd packages/shared && npx tsc` before web/scraper builds; CI verifies `dist/db/schema.d.ts`.
- **Write path:** all GMP writes route through `data-persister.ts`; never raw Drizzle/`ipoRepository.update()` from a scraper.
- **Baseline (2026-06-14):** `gmp_records` 150 rows / 3 IPOs / newest 2026-06-12; 22 OPEN/UPCOMING IPOs; 3 GMP tables in DB.

---

## 2. STAGE A — Revive coverage + harden the pipeline (issues G1–G9) · mostly additive

**File(s):** the scraper files in §1 (edit). **Keep untouched:** `web/`, `packages/shared/src/db/schema.ts`
(Stage B owns schema), the Chittorgarh path.

### Pre-made design decisions (do NOT deviate)
1. **TDD red-first (Rule G-TDD).** For EVERY task below, write the failing test FIRST in the correct tier
   (`scraper/tests/unit/scrapers/investorgain-gmp*.test.ts`; integration only if it needs DB+Redis), then fix to green.
2. **Scheduler job is authored in CODE only; activation is GATED.** Register an InvestorGain GMP job in
   `scheduler.ts` + `config.ts` at **every 6 hours** (`0 */6 * * *`), behind a `feature-flags.ts` flag
   `ENABLE_GMP_SCHEDULED_JOB` (default OFF). Acquire the Redis lock `ipo:${slug}` (`scraper/src/utils/distributed-lock.ts`)
   in the orchestrator; Redis-down → log warn + continue. **Do NOT enable the flag in prod / deploy / restart PM2** — that is Abhay's (GATE-D).
3. **Fetch SME too.** Call the InvestorGain report for `'ipo'` AND `'sme'` (or `'all'`) in
   `investorgain-gmp-scraper.ts`; merge results. Test asserts SME rows are fetched and matched.
4. **One canonical name-normalizer.** Extract the normalization to a single shared function used by BOTH the
   JS path (`data-persister.ts`) and asserted against the SQL path (`ipo-repository.ts`). Add a test that runs a
   **≥30-name fixture** (multi-suffix `Pvt Ltd`/`Limited`/`Inc`, punctuation, `& `, SME names) through BOTH and
   FAILS on any divergence. Reconcile until identical.
5. **Parse resilience + loud failure.** Harden `parseGMP` to tolerate markup drift; add a **parse-rate guard**:
   if <50% of fetched rows yield a GMP value, log `error` (pino, object-first) and the run reports failure
   (no silent skip). Test simulates a markup change and asserts failure is raised.
6. **Correct success accounting.** `gmpsProcessed` = created+skipped+blocked; `success = gmpsFailed === 0 && gmpsProcessed > 0`.
   Unit-test BOTH: an all-skipped run → `success=false` (+ logs skip count); an all-created run → `success=true`.
7. **Timestamp correctness.** Stop assuming current year in `parseGMPTimestamp`; preserve the source date and
   handle the Dec→Jan boundary. Unit-test a 31-Dec / 1-Jan fixture.
8. **Register GMP in the priority matrix.** Add/extend `FIELD_PRIORITY_MATRIX` GMP entries to include
   `INVESTORGAIN_GMP` as a source with `timeBased:true`, `ignoreDRHP:true`, and `validation:{min,max}` range
   (reject absurd GMP — e.g. |gmp| within a sane bound). Keep the write through `data-persister`.
9. **Backfill run (additive writes allowed).** After A1–A8 are green, run the scraper against prod via tunnel
   (`cd scraper && npm run start:gmp`) to populate coverage; capture before/after counts for AC1.

### Stage A acceptance (run the §5 gate sweep before committing)
- AC1 met: ≥95% of InvestorGain-listed current IPOs have a fresh `gmp_records` row; listed-but-unmatched names logged.
- AC2 (normalizer agreement test), AC3 (parse-rate guard), AC4 (success metric) all green.
- Scraper unit tier green; `cd scraper && npx vitest run tests/unit/scrapers/`. No `console.*` in `scraper/src/**` (pino only).
- **Gate sweep:** static → persistence read-back (DB via tunnel) → independent verify. All green or DEFERRED-with-reason.

---

## 3. STAGE B — Consolidate the schema to one canonical `gmp_records` (G10–G14) · destructive steps GATED

**File(s):** `packages/shared/src/db/schema.ts` (edit), `web/drizzle/` migrations (generate), `data-persister.ts` (edit).
**Keep untouched:** any non-GMP table.

### Pre-made design decisions (do NOT deviate)
1. **Canonical table = `gmp_records`** (where the data already is). Do NOT pivot to `gmp_tracking` (rejected).
2. **ADD COLUMN `gmp_percentage numeric(10,2)` to `gmp_records`** (additive — MAY apply on prod). Populate it in
   `createGMPRecord` (compute from `gmp / issue_price * 100` with an `isFinite` guard, else null). Register in the matrix.
3. **int→numeric ALTER (GATED — author migration, do NOT apply to prod).** Change `gmp`,
   `expected_listing_price`, `subject_rate`, `kostak_rate` from `integer` to `numeric(10,2)`; remove `Math.round`
   in `data-persister.ts:539`. Generate the migration via `npm run db:generate`, review SQL, **leave UNAPPLIED** — append to GATE list.
4. **Drop orphans (GATED — author migration, do NOT apply).** `DROP` `gmp_history`, `gmp_tracking`, and matview
   `gmp_current`; reconcile `schema.ts` so `npm run db:generate` is clean afterward. UNAPPLIED — append to GATE list.
5. **Dedup + UNIQUE (GATED).** Author a migration adding `UNIQUE(ipo_id, timestamp, source)` to `gmp_records`
   (preceded by a dedup step), and add `onConflict do nothing` to `createGMPRecord`. UNAPPLIED — append to GATE list.
6. **Fix the broken index migration (additive file fix).** Repair/remove the `gmp_records(recorded_at)` index in
   `0002_add_performance_indexes.sql` (column is `timestamp`); note the forked migration numbering in the final report.

### Stage B acceptance
- AC5: `gmp_records` (+`gmp_percentage`, numeric typing in schema.ts) is the SOLE GMP model in the SSOT;
  `cd web && npm run db:generate` shows NO unexpected `gmp_records` diff; orphan-DROP + int→numeric + UNIQUE
  migrations exist as files and are **UNAPPLIED**; `cd packages/shared && npx tsc` emits `dist/db/schema.d.ts`.
- **Gate sweep:** static → (additive ADD COLUMN applied + DB read-back confirms column) → independent verify.

---

## 4. STAGE C — Render GMP honestly + fix docs + tests (G15–G23)

**File(s):** the web + docs files in §1 (edit). **Keep untouched:** the scraper (Stage A owns it).

### Pre-made design decisions (do NOT deviate)
1. **Staleness label (G15).** Every real GMP surface (header `KeyMetricsCards`, GMP tab `GMPChart`, SSR
   `GMPHistoryChart`) renders **"as of <record timestamp>"** sourced from the record's `timestamp`. Component test asserts it reflects the record date.
2. **Zero ≠ missing (G16).** `web/lib/repositories/ipo-repository.ts:1576` → `gmp: gmpRecord?.gmp ?? null` (stop collapsing a real `0` to `'-'`). Test both 0 and null.
3. **Delete fake GMP (G17).** Remove `Math.random()` GMP from `LiveGMPTicker.tsx`, `HotRightNow.tsx`, and the
   `/api/live-updates` GMP fields (or delete the dead test-only route). No fabricated data ships (Rule G-HONESTY).
4. **Honest bands (G18).** Remove the ±10% "confidence bands" in `charts/GMPHistoryChart/utils.ts:76` (or relabel as a
   non-statistical "±10% illustrative range"). No analytical veneer on a hardcoded multiplier.
5. **Plausibility guard (G19).** Wrap `gmp/issuePrice*100` in `isFinite` (substitute null) in `page.tsx:201` and
   `gmp/latest/route.ts:162`. Add a default-path test asserting rendered GMP% is finite and within **−50%…+200%** (AC7).
6. **Docs truth (G20/G21/G22).** In `SCRAPING_STRATEGY.md`, `screen-database-mapping-subscription-gmp.md`, and matrix
   comments, correct the live GMP source **Chittorgarh→InvestorGain**. Fix `verification_queries/11_related_tables.sql:179-188`
   `recorded_at`→`timestamp`. Update `verification_queries/README.md` coverage note + `P0-2…SUMMARY.md` scheduler status.
7. **Complete tests (G23).** Component tests for staleness/zero/plausibility; one Playwright e2e for the GMP tab on an IPO with GMP data (use the readiness signal, never a fixed sleep — `.claude/rules/e2e-readiness-signal.md`).

### Stage C acceptance
- AC6 (staleness label + zero renders as 0), AC7 (finite, in-range %), AC8 (docs: zero Chittorgarh-as-source refs;
  query 11 runs clean) all green.
- **Gate sweep:** static → UI screenshot/ARIA/console on the GMP tab → cross-page GMP consumer sweep → independent verify.

---

## 5. Verification gates (IPODhan-adapted standing rules — load-bearing, not decorative)

> **All rules in `.claude/rules/` are operative for this run.** The ones below are the load-bearing gates for an
> autonomous run; they are MANDATORY at every task AND every stage boundary. They are why this contract yields
> *proven-working*, not *claimed-working*, output. Do not soften or defer them.

**Static gates (per stage, from the right CWD):**
- root: `npm run lint && npm run build` · `cd packages/shared && npx tsc && test -f dist/db/schema.d.ts`
- `cd scraper && npx vitest run tests/unit/scrapers/` · `cd web && npx vitest run tests/unit`

**G-UI — UI screenshot verification** (Stage C only; per UI surface) — `supervisor-verification.md` "verify by driving it".
Self-heal: if dev server down, start `npm run dev` once in background (capture PID), wait for port 3000, then drive
**Playwright MCP**: `browser_navigate` → an IPO detail page with GMP → `browser_take_screenshot` + `browser_snapshot`
(ARIA) + `browser_console_messages`. PASS = (a) "as of <date>" label + GMP value visible; (b) present in ARIA; (c) no
NEW console errors. ≤3 iterations → `/fix-loop` → `/systematic-debugging`. MCP unavailable after recovery → "UI
verification skipped because <reason>", mark `completed (deferred — G-UI)`, never claim complete.

**G-PERSIST — write→persistence verification** (per scraper write + per applied additive migration) —
`e2e-persistence-verification.md`. Dialog/exit-code is NOT proof. Two signals: (1) the run's count/log reflects the
write; (2) **independent DB read-back via `node`+`pg` against `localhost:15432`** confirms the row/column shape+values.
For the backfill loop, sample per-batch, and end with a fresh coverage query (flushes nothing — it's the source of truth).

**G-INDEPENDENT — post-stage independent verification** (ALWAYS fires) — `independent-test-verification.md` +
`supervisor-verification.md`. After a stage is otherwise green, re-verify with FRESH eyes: reproduce the gate
(re-run the exact lint/test/coverage command — never trust a reported exit code) AND inspect substance
(`output-plausibility-verification.md`): is the GMP value/coverage domain-sane on the DEFAULT path? Sibling-sweep the
same output class. 3 reconcile cycles → `/systematic-debugging`; unresolved → log DEFERRED, proceed with state noted.

**Behavioral rules (from `.claude/rules/claude-behavior.md`):** Rule 15 (test failures → skills, no ad-hoc retry),
Rule 17 (root cause over patch), Rule 20 (epistemic honesty — no fake data; surface `**Assumption:**`/`**Unverified:**`),
Rule 23 (standing directive — keep going through the full DoD; context-budget anxiety is NOT a stop).

**Failure-recovery budget:** per-task ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`) → DEFER the
task + continue, do not halt the run. MCP hang: 3 cycles (wait+retry → `browser_close`+re-navigate → kill+restart dev
server) → DEFER. **Hard-halt ONLY:** `npm install` failure; a contradiction inside THIS contract; an irrecoverable
build break after the full budget; OS permission denial; missing tunnel/credential. Context-budget anxiety is NOT a
halt — hand off via a one-line continuation note in the PROGRESS file, never fake-complete.

---

## 6. Commit + push

- **Branch:** `feat/gmp-coverage-revival` (create if absent). **NEVER commit to `main`.**
- **Commits:** conventional, scoped, one logical change each — e.g. `feat(scraper): schedule InvestorGain GMP job + SME + lock`,
  `fix(scraper): correct GMP success accounting + parse-rate guard`, `feat(shared): add gmp_records.gmp_percentage`,
  `chore(db): author (unapplied) GMP orphan-drop + int→numeric migrations`, `fix(web): GMP staleness label + zero-vs-null + plausibility guard`, `docs(scraping): correct GMP source to InvestorGain; fix verification query`.
- **Stage explicitly** — name files; NEVER `git add -A` (the tree may hold unrelated untracked items). Co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Push the BRANCH and open a DRAFT PR** (`gh pr create --draft`). **Do NOT merge.** Do NOT push `main`. Do NOT run `deploy.yml`/PM2.
- Keep `docs/goals/.run/2026-06-14-gmp-coverage-revival-PROGRESS.md` current (per-task status + SHAs) for the monitor.

---

## 7. Definition of Done (all MUST be true)

**Pipeline / coverage (Stage A):**
- [ ] InvestorGain GMP scheduler job authored (flag OFF) + Redis lock; SME category fetched; one shared name-normalizer with a passing ≥30-name JS↔SQL agreement test.
- [ ] Parse-rate guard raises failure on <50% parse; success metric correct for all-skipped AND all-created; timestamp year-boundary test passes.
- [ ] GMP registered in `FIELD_PRIORITY_MATRIX` (`INVESTORGAIN_GMP` source + range validation).
- [ ] **AC1:** backfill run → ≥95% of InvestorGain-listed current IPOs have a fresh `gmp_records` row; unmatched names logged (read-only coverage query proves it — NOT exit code).

**Schema (Stage B):**
- [ ] `gmp_records` (+`gmp_percentage`, numeric typing) is the sole GMP model in `schema.ts`; `db:generate` clean.
- [ ] Additive `gmp_percentage` column applied to prod + read-back confirmed; `Math.round` removed.
- [ ] int→numeric, orphan-DROP, and UNIQUE+dedup migrations authored as files and **UNAPPLIED** (listed in §GATE).

**Web + docs (Stage C):**
- [ ] Staleness "as of <date>" on all GMP surfaces; zero renders as `0` not `'-'`; fake `Math.random()` GMP removed; bands honest.
- [ ] `isFinite` guard on GMP%; default-path test asserts GMP% finite + within −50%…+200%.
- [ ] Docs: zero "Chittorgarh = live GMP source" refs (InvestorGain named); `11_related_tables.sql` runs with no column error.

**Static gates:**
- [ ] `npm run lint && npm run build` pass; `packages/shared` compiles (`dist/db/schema.d.ts`); scraper + web unit tests green; structured `test-results/*.json` emitted.

**Verification gates (per stage):**
- [ ] G-PERSIST dual-signal on every write/applied-migration (UI/log AND DB read-back via tunnel).
- [ ] G-UI three-signal on every GMP UI surface (screenshot + ARIA + clean console) — Stage C.
- [ ] G-INDEPENDENT post-stage sweep passed (gate reproduced + substance plausibility on default path).

**Ship:**
- [ ] Conventional commits pushed to `feat/gmp-coverage-revival`; **draft PR open, NOT merged**.
- [ ] §GATE list populated; any deferrals logged in `docs/goals/.run/2026-06-14-gmp-coverage-revival-DEFERRED.md` with rule status + reason.

**§GATE — needs Abhay (run must STOP at these, author the artifact, log, continue):**
- [ ] Apply orphan-DROP migration to prod. · [ ] Apply int→numeric ALTER to prod. · [ ] Apply UNIQUE+dedup migration to prod.
- [ ] Enable `ENABLE_GMP_SCHEDULED_JOB` + deploy to activate the 6h job. · [ ] Merge the draft PR to `main`.

---

## 8. Final report (required on completion)

Produce a closing report containing: commit SHAs + per-stage gate results; AC1 coverage before/after (matched /
listed-current %, + the verbatim unmatched-names list); G-PERSIST verdict per write/migration (with the read-back
values); G-UI verdict per GMP surface + screenshot paths; G-INDEPENDENT result; the §GATE list of authored-but-unapplied
migrations + the deploy/merge items awaiting Abhay; DoD green/amber/red tally; "skipped (already covered)" list from the
§0.2 preflight; any DEFERRED entries with rule status + reason.

---

## 9. Guardrails (hard stops)

- **IPODhan repo only** (`scraper/`, `packages/shared/`, `web/`, `docs/`). NEVER write `D:\Abhay\VibeCoding\5Wealths\`;
  surface strategic items as `TODO(5W):` notes only.
- **No prod deploy / no PM2 / no `deploy.yml` / no remote restart.** Scheduler activation is GATED.
- **Prod DB = additive-only.** MAY run the scraper (writes rows) + apply `ADD COLUMN`/`CREATE INDEX IF NOT EXISTS`.
  MUST NOT apply `DROP TABLE`/`ALTER … TYPE`/`UNIQUE` to prod — author the migration, leave UNAPPLIED, add to §GATE.
- **Never merge to `main` / never push `main`.** Feature branch + draft PR only.
- **Schema SSOT = `packages/shared/src/db/schema.ts` only.** Never edit `web/lib/db/schema.ts` (stale legacy).
- **Write path:** all GMP writes through `data-persister.ts`; new fields registered in the priority matrix; new behavior behind a feature flag; racy writes take the Redis lock.
- **No new dependencies** unless this contract authorizes one. **No design reinvention** — reuse existing repositories/components.
- **Honesty:** no synthetic/fake data — remove fakery (the `Math.random()` GMP, the fake bands) rather than carry it forward.
- **Stop only on a true blocker** (§5 hard-halt list) or a §GATE item. Context-budget anxiety is NOT a blocker — hand off via the PROGRESS file, never fake-complete.

---

## Authorization trail

| # | Decision | Choice |
|---|---|---|
| 1 | Migration target (prod DDL safety) | **Additive-only on prod; destructive DDL authored-but-UNAPPLIED (gated)** |
| 2 | Canonical GMP table | **Keep `gmp_records`, fix in place; drop the 2 orphans (gated)** |
| 3 | Scope | **All 23 issues (G1–G23), phased A (pipeline) → B (schema) → C (web/docs/tests)** |
| 4 | Scheduler cadence | Every 6h (`0 */6 * * *`), flag OFF, activation gated (assumption — Abhay revisits at deploy) |
| 5 | Numeric typing | `gmp`/`%`/kostak → `numeric(10,2)` (widening; int→numeric ALTER gated) |
| 6 | Deploy / scheduler activation | GATED — Abhay deploys; run never activates in prod |
| 7 | Git policy | feat branch + draft PR; NEVER merge/push main |
| 8 | Verification model | IPODhan named rules (supervisor-/independent-/e2e-persistence/output-plausibility) adapted from FireKaro 24/25/26 |

---

## References (load transitively)

- `.claude/rules/claude-behavior.md` — rules 15, 17, 20, 23
- `.claude/rules/supervisor-verification.md` · `.claude/rules/independent-test-verification.md` — G-UI / G-INDEPENDENT
- `.claude/rules/e2e-persistence-verification.md` · `.claude/rules/e2e-readiness-signal.md` — G-PERSIST + e2e waits
- `.claude/rules/output-plausibility-verification.md` · `.claude/rules/dod-verbs.md` — substance + load-bearing DoD
- `.claude/rules/tdd-rule.md` — red-green-refactor
- `.claude/rules/scraper-write-path.md` · `.claude/rules/scraper-test-layout.md` · `.claude/rules/schema-imports.md` · `.claude/rules/shared-package-build.md` · `.claude/rules/structured-logging.md`
- `.claude/rules/web-data-access.md` · `.claude/rules/web-api-routes.md` · `.claude/rules/react-nextjs.md`
- `.claude/rules/git-collaboration.md` — branch/PR policy
- Skills the run drives: `/fix-loop`, `/systematic-debugging`, `/auto-verify`, `/tdd`, `/playwright`
```
```
