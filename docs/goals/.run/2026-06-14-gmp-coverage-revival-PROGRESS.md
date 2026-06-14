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
| A3 shared name-normalizer + ≥30-name JS↔SQL test | pending | | needs DB (integration tier); JS + SQL normalizers diverge-risk identified |
| A4 parse-rate guard (<50% → fail) | **DONE** | c79d6a25 | isParseRateHealthy + parseGMP <b>-drift fallback |
| A5 success accounting | **DONE** | c79d6a25 | computeGMPRunOutcome; **deviation** ↓ |
| A6 timestamp year-boundary | **DONE** | c79d6a25 | deterministic, Dec→Jan rollback, now injectable |
| A7 priority-matrix INVESTORGAIN_GMP | **DONE** | 1deeafd5 | primary GMP source, ranked above Chittorgarh |
| A8 backfill run (AC1) | pending | | needs A3 + live InvestorGain fetch + tunnel write (additive, allowed) |

**A5 deviation (recorded per dod-verbs.md):** contract §2.6 says `success = failed===0 && processed>0` AND "all-skipped → success=false". Those conflict when `processed` includes skipped. Implemented the version that satisfies the stated TEST outcomes: `processed = created+skipped+blocked`, `success = failed===0 && created>0`. An all-skipped run → success=false. ✅

**Verified (G-INDEPENDENT):** TDD red→green for every task; +32 new scraper unit tests green; true-baseline diff proves **0 regressions** (25 pre-existing non-GMP scraper failures unchanged — see DEFERRED). No `console.*` added. 2 pre-existing tsc errors in unchanged `isGMPProtected` confirmed not mine.

**NOT yet done in Stage A:** A3 (normalizer JS↔SQL agreement — integration test, needs tunnel DB), A8 (backfill — runs live scraper + writes prod additively; gives AC1 coverage number). Both need a follow-up turn.

## Stage B — schema consolidation (G10–G14)
| Task | Status | SHA | Notes |
|---|---|---|---|
| B1 add gmp_percentage (additive, apply prod) | pending | | |
| B2 int→numeric ALTER (authored, UNAPPLIED) | pending | | |
| B3 drop orphans (authored, UNAPPLIED) | pending | | |
| B4 UNIQUE+dedup (authored, UNAPPLIED) | pending | | |
| B5 fix broken recorded_at index migration | pending | | |

## Stage C — honest rendering + docs + tests (G15–G23)
| Task | Status | SHA | Notes |
|---|---|---|---|
| C1 staleness label | pending | | |
| C2 zero≠missing | pending | | |
| C3 delete fake Math.random GMP | pending | | |
| C4 honest bands | pending | | |
| C5 plausibility guard | pending | | |
| C6 docs source correction | pending | | |
| C7 component + e2e tests | pending | | |

## §GATE (needs Abhay)
- [ ] Apply orphan-DROP migration to prod
- [ ] Apply int→numeric ALTER to prod
- [ ] Apply UNIQUE+dedup migration to prod
- [ ] Enable `ENABLE_GMP_SCHEDULED_JOB` + deploy to activate 6h job
- [ ] Merge draft PR to main

## Deferrals
_none yet_
