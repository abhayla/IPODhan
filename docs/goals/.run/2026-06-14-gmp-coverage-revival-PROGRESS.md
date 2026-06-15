# PROGRESS — GMP coverage revival (`/goal` run)

**Branch:** `feat/gmp-coverage-revival` · **Started:** 2026-06-14 · **Baseline:** gmp_records 152 rows / 3 IPOs / newest 2026-06-12; 22 OPEN/UPCOMING IPOs; tunnel `localhost:15432` live.

## §0.2 Preflight
- Clean first run: no prior `feat/gmp-coverage-revival` branch, no `.run` ledger, none of G1–G23 committed. Pre-fix baseline commits present (`6969fa4e`, `07470243`).
- Skipped (already covered): _none yet_.

## Stage A — revive + harden pipeline (G1–G9)
| Task | Status | SHA | Notes |
|---|---|---|---|
| A1 scheduler job (flag OFF) + lock | **DONE** | 94699b75 | job-level lock (sibling pattern); per-IPO `ipo:${slug}` lock → DEFERRED note |
| A2 SME category fetch | **DONE** | c79d6a25 | fetch ipo+sme, merge+dedupe by id |
| A3 shared name-normalizer + ≥30-name JS↔SQL test | **DONE** | b5ffab6d | shared util; 34-name agreement test green via tunnel; caught+fixed re-export bug |
| A4 parse-rate guard (<50% → fail) | **DONE** | c79d6a25 | isParseRateHealthy + parseGMP <b>-drift fallback |
| A5 success accounting | **DONE** | c79d6a25 | computeGMPRunOutcome; **deviation** ↓ |
| A6 timestamp year-boundary | **DONE** | c79d6a25 | deterministic, Dec→Jan rollback, now injectable |
| A7 priority-matrix INVESTORGAIN_GMP | **DONE** | 1deeafd5 | primary GMP source, ranked above Chittorgarh |
| A8 backfill run (AC1) | **DONE** | (data op) | ran via tunnel + name-match ON; 16 created/1 skipped/0 failed |

### Stage A COMPLETE (9/9) — AC1 result
- **Coverage: 3 → 17 distinct IPOs with gmp_records (5.6×); newest 2026-06-12 → 2026-06-14.** Verified by independent DB read-back via tunnel (rows 160→176).
- **AC1 = 16/16 (100%)** of InvestorGain-listed current IPOs *present in our DB* now have a fresh GMP row. Listed-but-unmatched: **"Advit Jewels"** (gmp 91) — **absent from `ipos` table entirely** (never ingested), so cannot have GMP regardless → upstream ingestion gap, NOT a GMP-match failure. `TODO`: IPO ingestion misses some SME IPOs (Advit Jewels).
- **Backfill infra finding (recorded):** the shared `db` pool uses individual `DATABASE_HOST`/`DATABASE_PORT` params when set (overrides DATABASE_URL). To route a scraper run through the tunnel you MUST set `DATABASE_HOST=localhost DATABASE_PORT=15432` (not just DATABASE_URL). Direct prod 5432 is firewalled. Run cmd: `cd scraper && DATABASE_HOST=localhost DATABASE_PORT=15432 ENABLE_GMP_NAME_MATCH=true npm run start:gmp`.

**A5 deviation (recorded per dod-verbs.md):** contract §2.6 says `success = failed===0 && processed>0` AND "all-skipped → success=false". Those conflict when `processed` includes skipped. Implemented the version that satisfies the stated TEST outcomes: `processed = created+skipped+blocked`, `success = failed===0 && created>0`. An all-skipped run → success=false. ✅

**Verified (G-INDEPENDENT):** TDD red→green for every task; +32 new scraper unit tests green; true-baseline diff proves **0 regressions** (25 pre-existing non-GMP scraper failures unchanged — see DEFERRED). No `console.*` added. 2 pre-existing tsc errors in unchanged `isGMPProtected` confirmed not mine.

**Stage A fully done.** Next: Stage B (schema — apply additive `gmp_percentage`; author destructive migrations UNAPPLIED) then Stage C (honest rendering + docs + Playwright). Tunnel note: single queries occasionally time out mid-session; restart with `ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189` if it drops.

## Stage B — schema consolidation (G10–G14)
| Task | Status | SHA | Notes |
|---|---|---|---|
| B1 add gmp_percentage (additive, apply prod) | **DONE** | (this commit) | schema.ts numeric(10,2); **APPLIED to prod** (ADD COLUMN IF NOT EXISTS) + read-back ✅; createGMPRecord stores source % with isFinite guard (4 tests); matrix entry already had INVESTORGAIN_GMP |
| B2 int→numeric ALTER (authored, UNAPPLIED) | **PARTIAL** | (this commit) | migration authored in `_gated/B2_gmp_int_to_numeric.sql` (UNAPPLIED). schema.ts int→numeric type change + Math.round removal **DEFERRED to co-land with Stage C** — numeric returns string in drizzle, so the web rendering must change in lock-step to keep the build green. Recorded deviation. |
| B3 drop orphans (authored, UNAPPLIED) | **DONE** | (this commit) | `_gated/B3_gmp_drop_orphans.sql` (DROP gmp_history, gmp_tracking, matview gmp_current) — UNAPPLIED |
| B4 UNIQUE+dedup (authored, UNAPPLIED) | **DONE** | (this commit) | `_gated/B4_gmp_unique_dedup.sql` (dedup + UNIQUE(ipo_id,timestamp,source)) UNAPPLIED; gmp-repository.create now onConflictDoNothing + returns existing row on skip (forward-ready) |
| B5 fix broken recorded_at index migration | **DONE** | (this commit) | `0002_add_performance_indexes.sql`: recorded_at→timestamp on both subscriptions + gmp_records indexes (column never existed) |

**B1 deviation (recorded):** store the source's own `gmpPercentage` (InvestorGain `~gmp_percent_calc`) rather than recomputing `gmp/issue_price*100` — it's supplied directly (no extra IPO read, never diverges from the reported gmp), guarded by isFinite. **db:generate is BLOCKED** by pre-existing `extraction_status` enum drift (interactive prompt; unrelated to GMP) → migrations hand-authored; gated ones isolated in `_gated/` so `drizzle-kit migrate` won't auto-apply them. The additive gmp_percentage was applied to prod by direct ALTER (idempotent) + read-back, not via migrate.

## Stage C — honest rendering + docs + tests (G15–G23)
| Task | Status | SHA | Notes |
|---|---|---|---|
| C1 staleness label | pending | | |
| C2 zero≠missing | **DONE** | (this commit) | web ipo-repository:1576 `gmp ?? null` (was `\|\| null` collapsing a real 0); sibling-swept (rating-calculator `gmp\|\|0` are math defaults, not display bugs) |
| C3 delete fake Math.random GMP | **DONE** | (this commit) | deleted the test-only fabrication harness: /api/live-updates route + /test/live-updates page + LiveGMPTicker/HotRightNow/MarketPulse/LiveSubscriptionTracker/ViewerCount + use-live-updates hook + websocket/client (only consumer was the test page). 0 real source type errors |
| C4 honest bands | pending | | |
| C5 plausibility guard | **DONE** | (this commit) | isFinite guard on gmp/issuePrice*100 in page.tsx + gmp/latest/route.ts (NaN/Infinity → null/0) |
| C6 docs source correction | **DONE** | e1343a20 | Chittorgarh→InvestorGain in SCRAPING_STRATEGY + screen-db-mapping; fixed verification SQL recorded_at→timestamp; only a cross-ref link to Chittorgarh-as-scraper kept |
| C7 component + e2e tests | pending | | |

## §GATE (needs Abhay)
- [ ] Apply orphan-DROP migration to prod
- [ ] Apply int→numeric ALTER to prod
- [ ] Apply UNIQUE+dedup migration to prod
- [ ] Enable `ENABLE_GMP_SCHEDULED_JOB` + deploy to activate 6h job
- [ ] Merge draft PR to main

## Deferrals
_none yet_
