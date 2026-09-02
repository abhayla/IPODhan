# Per-IPO pipeline walk — Deepa Jewellers (DEEPA), started 2026-09-02

Owner-driven, one step per turn, on screen. This file is the single record of the walk:
every step verdict, every defect found, every owner decision and suggestion, and every
follow-up that must be implemented after the walk. Append-only. Committed every turn.

Walk IPO: **Deepa Jewellers Limited**, symbol DEEPA, BSE IPO_NO 7922, scrip 4777, band
168/177, lot 84, open 2026-09-01, close 2026-09-03. (Purple Style Labs, PERNIASPOP, was used
for the first pass of B1-B2 only.)

Step list: `docs/reviews/ipo-pipeline-stage-gap-analysis.md` §6 is superseded for this walk
by the B-J list in §1 below. Environment is a one-time precondition, not a per-IPO step.

## 0. Precondition (once per machine, not per IPO)

```
ls node_modules/pino >/dev/null 2>&1 || npm install      # deps in the MAIN checkout
netstat -an | grep -q ":15432.*LISTEN"                    # ipodhan_test tunnel up
```
Probe convention: step probes live at `scraper/scripts/_walk-<step>-probe.ts`, run with
`npx tsx`, and are deleted after the step. Never a hand-made curl: the real scraper function
runs, plus a raw view of the same endpoint where the function hides it.

## 1. Step ledger

| Step | What | Verdict | Turn | Notes |
|---|---|---|---|---|
| B1 | Fetch BSE IPO board JSON | PASS | 17:40 | 22 board rows, 4 IPO. DEEPA row present, IR_flag IPO. |
| B2 | Fetch NSE current + all-upcoming lists | PASS | 18:02 | NSE reachable (no 403 today). DEEPA in both lists. |
| B3 | Parse candidate row (exchange fields) | **PASS** (18:45) | 18:35-18:45 | BSE: 10/10 parsers correct on raw detail (48 keys). NSE: fabricated faceValue=10 (W-02 root cause); fix dispatched (fix/nse-face-value-default). W-01 confirmed. |
| B4 | Classify offering type | **PASS** | 18:50 | IR_flag IPO -> IPO; symbol/name checks agree; segment MAINBOARD; keep-classification guard holds (TENDER not downgraded). Board sweep: 22/22 sane; W-13 noted. |
| B5 | Validate raw record | **PASS** (with gap W-14) | 18:55 | DEEPA valid on BSE and NSE inputs; production pipeline shouldCreate=true both. Mutations fire: lot=1, close<open, inverted band, 'rights issue' name -> auto-fix RIGHTS. Band-width 25% did NOT fire (W-14). |
| B6 | Identity match new vs existing | **PASS** | 19:05 | `resolveIpoRow` on ipodhan_test: exact name+symbol, 'Ltd', 'LTD.', typo 'Jewelers', symbol-with-wrong-name all resolve to the one DEEPA row (0b7e81cd); unknown company -> NEW. DEEPA row pre-exists from the 16:25 T-433 run: face_value 2, listing_exchanges [BSE] only (W-01 evidence for B7). |
| B7 | Write through `upsertIPO` (update + insert paths) | **FAIL** (19:25) | 19:00-19:25 | Prod flags read from the VPS: CONSOLIDATION=true, SOURCE_TRACKING=true, CONFLICT_DETECTION=true, PCT=100, BSE_API=true. Insert path OK (one row; exchanges merged). Update path: W-01 merge works on the consolidation path; W-02 write-side confirmed (NSE undefined becomes 10 via the orchestrator default; fixed code keeps 2); W-16 absent-overwrites-present; W-17 no provenance history; W-18 conflict persistence wrong. Fix dispatched (Opus, Tier A). |
| C1-C5 | Find filings (BSE detail, NSE detail, SEBI, fallback, classify) | pending | | |
| D1-D6 | Download, reject HTML, sha256 dedup, store, zero-call rerun, OCR route | pending | | |
| E1-E10 | Extract (by field-inventory group, IDs from price-band-ad-field-inventory.md) | pending | | E1 A+B terms/timeline; E2 category %; E3 financials/FY; E4 KPIs; E5 objects; E6 peers; E7 promoters+intermediaries; E8 risks/litigation; E9 arithmetic; E10 `[•]` |
| F1-F6 | Cross-verify vs Chittorgarh/Moneycontrol/InvestorGain; conflict rows; confidence | pending | | F4/F5 acceptance test = W-02 |
| G1-G5 | Persist via matrix, locks, upsertIPO, extracted tables, new columns | pending | | G5 blocked by W-09 migration |
| H1-H4 | Subscription, GMP, anchor, demand graph | pending | | W-03, W-04 |
| I1-I6 | Stage, due list, supersession, withdrawn, listing, purge | pending | | |
| J1-J3 | Cache, render, admin conflict view | pending | | |

## 2. Defects and observations found (W-nn)

| ID | Found at | What | Fix lives in | Status |
|---|---|---|---|---|
| W-01 | B1/B2 | `listingExchange`: BSE mapper writes "BSE", NSE mapper writes "NSE", last writer wins. DEEPA lists on both. Must be a merged list. | scraper mappers (`bse-api-scraper.ts`, `nse-api-client.ts`) + consolidation | B7 result: on the PRODUCTION path (consolidation on) the merge WORKS: DEEPA [BSE,NSE] survives an NSE update; fake insert NSE then BSE gives [NSE,BSE]. On the LEGACY path (flag off) the last writer overwrites ([BSE] became [NSE]). Closed as prod-correct; the legacy hazard is W-16. Earlier note: the merge into a list exists in `data-persister.ts` update path (`mergeListingExchanges`) but NOT in `data-consolidation-orchestrator.extractListingExchanges` (single value). Verify at B7 with a real write. |
| W-02 | B1/B2 | Face value conflict: BSE says 2, NSE says 10 for DEEPA. ROOT CAUSE (B3): NSE list payload has no face value; `transformIPOData` hard-codes `\|\| 10`. NSE's own issueInfo says "Rs. 2 per Equity Share". A fabricated value outranked BSE's correct one. | `nse-api-client.ts` transformIPOData + extractAdditionalNSEFields; tests | round 1 committed 52cc7789 (nse-api-client + legacy nse-scraper + 5 tests), reproduced 35/35 by Fable. Round 2 dispatched 18:41: same fabrication in `data-persister.ts:315` (insert path, LIVE in prod), `data-consolidation-orchestrator.ts:371`, `bse-scraper.ts` x2, `bse-detail-scraper.ts` x2, chittorgarh rights/debt adapter. Round 2 committed 89b4c2cc (7 sites, 12 tests, 73/73 reproduced by Fable). PR #277 open, CI pending. Verified on DEEPA's real NSE payload: missing -> undefined, issueInfo -> 2. Still the F4/F5 acceptance case (silent pick must become a conflict row). Note: `force-nse-scrape.ts` script still has a literal 10 (debug script, not a prod path). |
| W-03 | B1/B2 | Subscription rows from BSE (own book, 17:00) and NSE (consolidated, 18:02) stored under one name with no scope label | H1 writer + schema label | open |
| W-04 | B2 | NSE `sharesOffered` meaning differs per IPO (PSL: net-of-anchor at floor; DEEPA: full issue at cap) | H1 / E2 | open |
| W-05 | B2 | SME IPOs (Ashutosh Fibre, Shanti Inorganics): NSE gives no band → issueSize skipped; no Total row → subscription snapshot rejected | NSE client SME path (E11 in lifecycle plan) | open, matters for an SME walk |
| W-06 | B1/B2 | Discovery (B1/B2) and detail (C1) and subscription (H1) run inside ONE function per source; cannot run B1 alone | design note for the due-step refactor (S-02) | note |
| W-07 | B1 | Main checkout had no node_modules; every prior walk ran in a worktree | precondition §0; registry row `main-checkout-not-runnable` (bus, 2026-09-02) | done |
| W-08 | B1 | Probe outside the package fails on top-level await | convention §0 | done |
| W-10 | B3 | `fetchIPODetail('DEEPA')` returns companyName = symbol, openDate = closeDate = today, faceValue 10. Only callers are two backfill scripts (demand-graph, subscription), so prod is not writing it today, but it is a trap for C2. | `nse-api-client.ts` fetchIPODetail mapping | open |
| W-11 | B3 | Issue-size composition not reconcilable from exchange data: BSE shares 18,520,085; NSE text says fresh Rs 2,500 mn + OFS 11,848,340 shares incl. anchor 7,791,789. No arithmetic closes. Needs the RHP (E2/E9). | E2 category/structure extraction + E9 arithmetic | open |
| W-12 | B3 | POSITIVE: BSE detail carries 48 keys incl. Price_Band_Advertisement link, RHP zip (Prospectus_GID), IPO_Market_Timings, UPI cut-off, Syndicate_Member, Sponsor_Bank, Eligible_Banks, max bid qty per category, Rating, Security_Type. NSE issueInfo has 38 titled rows incl. Face Value, Issue Size text, max bid qty, registrar contact, ratios zip. Inventory fields A13/B7/B8/E5/E6 are obtainable from exchange JSON at B3/C1, not only from the PDF. | B3 mappers (extend), field inventory doc | open |
| W-13 | B4 | `detectOfferingTypeFromBSEIRFlag` returns null for BSE flags `BuyBack` (2 rows) and `CMN` (1 row); it knows `OTB` but not the literal `BuyBack`. No prod impact on the BSE API path (rows are filtered to IR_flag=IPO before mapping), but the post-scrape reclassifier gets null for these and cannot correct a polluted row. Also `detectOfferingType` defaults to 'IPO' when unknown (guess-a-value class, mitigated by the keep-classification guard). | `detect-offering-type.ts` + reclassify job | open, low |
| W-14 | B5 | Validation runs per SOURCE, on whatever fields that source has. BSE's JSON carries no segment (left undefined by design), so the SEBI band-width rule (mainboard <=20%, SME <=40%) never fires for BSE rows; NSE's list carries no lot size, so the lot-size rules never fire for NSE rows. A 25% band on a mainboard IPO from BSE passes today. Not a wrong value for DEEPA; a coverage hole. | design: validate the MERGED record after consolidation (spec §3 G1), not each source's partial view | open, spec item |
| W-15 | B6 | `findBySlug` caches a NULL result under `ipo:slug:<slug>` for 900 s (seen: `SET ipo:slug:something-else-ltd`). A miss followed within 15 min by an insert from another source could resolve stale-null; name/symbol lookups run first so risk is low, but negative caching of identity lookups is a duplicate-row hazard. | `ipo-repository.findBySlug` / BaseRepository negative-cache policy | open, low |
| W-16 | B7 | Absent-overwrites-present. (a) Legacy update path (when ENABLE_DATA_CONSOLIDATION is off) writes raw incoming data: an NSE update nulled `lead_managers` and replaced `listing_exchanges`; logged as "[LEGACY PATH] Reached unreachable code". (b) On the consolidation path, an incoming undefined for a field with NO `field_sources` row also nulled `lead_managers` (reproduced after clearing provenance). Prod rows written before source tracking existed have no provenance rows, so (b) is live. | `data-persister.ts` legacy block (must never write undefined over a value, or be removed); `data-consolidation-service.ts` per-field loop (undefined incoming must never win) | FIXED in d3ef1e88 (`buildNonDestructiveUpdate`, `mergeListingExchangesForSource`; `existingRowValue` threaded into `consolidateField`). 134/134 reproduced by Fable. Tier A review running. |
| W-17 | B7 | `field_sources.previous_value` / `previous_source` are always null on update (24 rows, all null) even when a value changed (face 2 to 10). No history, so "what did BSE say before NSE overwrote it" is unanswerable. `listingExchanges` is attributed to NSE alone although it is a merge of both. | `data-persister.ts` trackFieldUpdate call (pass previous), consolidation fieldResults | FIXED in d3ef1e88: persister-side re-track deleted (it overwrote the correct history with null and mis-attributed BSE values to NSE); consolidation service is the single field_sources writer; previous_value JSON-serialized. Live proof: faceValue prev=2 prevSource=BSE. Tier A review running. |
| W-18 | B7 | Conflict persistence is wrong both ways: face value 2 (BSE) vs 10 (NSE) was logged "CRITICAL CONFLICTS" but NO `data_conflicts` row exists for faceValue; two rows were written for `leadManagers` (identical values, INFO) and `listingExchanges` (a merge, not a conflict). The outcome of the same inputs also depends on the prior provenance state (2 became 10 in one run, 2 was kept in another). | `data-consolidation-service.ts` logConflict conditions, equality check, severity | FIXED in d3ef1e88: root cause of (i) was the W-17 mis-attribution tripping the same-source short-circuit; (ii) `areEquivalent` compared arrays by reference, now order-insensitive multiset; set-merge (listingExchanges) is Case 2b, not a conflict. Live proof: exactly one CRITICAL faceValue row for 2 vs 10. Tier A review running. Residue: `data-persister.ts` ~315 `faceValue \|\| 10` on the create path is still on THIS branch (PR #277 removes it on its own branch): expect a merge conflict in data-persister.ts at the end. |
| W-09 | inventory | 18 of 54 ad/RHP fields have no DB column; 44 of 54 never written by prod code | migration drafted in price-band-ad-field-inventory.md §"Schema changes"; not approved | open, blocks G5 |

## 3. Owner decisions (D-nn)

| ID | Time | Decision |
|---|---|---|
| D-01 | 17:24 | Environment is NOT a per-IPO step; precondition only. |
| D-02 | 17:35 | One step per turn; show process, output, pass/fail; fix in the scraper when it is a scraper defect; then next step. |
| D-03 | 17:56 | After every step answer 5 questions in order: issue? fixed? learned? prevention? output? |
| D-04 | 18:05 | Walk IPO = DEEPA for all stages from here. |
| D-05 | 18:11 | Every field on the photographed price-band ad (54-field inventory) is in scope for scraping; steps E1-E8 map to inventory groups A-F by ID. |
| D-06 | 18:20 | Walk continues as planned. Everything discussed/decided is written as a detailed SPEC now (`docs/specs/per-ipo-due-step-pipeline.md`); implementation only after the walk is complete. S-01..S-04 are NOT built during the walk. |
| D-07 | 18:45 | No worktree cleanup inside this walk. It is a separate task for another session (20 stale worktrees listed 18:41: 11 `IPODhan-*`, 8 under `D:\Abhay\wt`). From now on fixes for this walk are made in THIS checkout on the walk branch (ledger + fixes together), no new worktrees; `IPODhan-wt-nse-face` is removed with one command after PR #277 merges. |
| D-08 | 19:17 | Owner: build the IPO-tracking spec item (S-01, per-IPO step ledger + admin grid) NOW in parallel with the B7 fix. S-02 (due-step scheduling) stays deferred. Wiring of the ledger into `upsertIPO` and document jobs waits until W-16/17/18 land, to avoid two workers editing the same file. |
| D-09 | 19:24 | Fix and test LOCALLY only. No deploy of any walk output until the walk ends; everything deploys together at the end (PR #277 stays open and unmerged until then). No worktree cleanup work in this walk. |

## 4. Recommendations pending owner decision (S-nn)

| ID | Raised | Recommendation | Decision |
|---|---|---|---|
| S-01 | 18:14 | APPROVED 19:17 (D-08), build started. Per-IPO step ledger table (ipo_id × step_id: status NOT_DUE/DUE/DONE/FAILED/NOT_AVAILABLE_YET, last_run, attempts, next_due, source, evidence, error) + admin grid view. Generalises `document_fetch_state`. | pending |
| S-02 | 18:17 | Replace "all sources every 30 min" with "due steps per IPO": rare discovery; stage-driven document checks; live numbers only for OPEN IPOs in market hours; closed/listed go quiet. Reuses stage-reconciler + fetch-state machine. | pending |
| S-03 | 17:14 | Three-tier source model: filings = truth for static fields; exchange APIs = truth for live fields + document discovery; aggregators (Moneycontrol, Chittorgarh, InvestorGain) = verification only, except GMP where they are the source. | pending (owner stated the intent; formal yes pending) |
| S-04 | 18:05 | A static-field mismatch between sources is a visible conflict, never a silent pick. | pending |

## 5. Documentation due after the walk

- Worker lesson (18:43): the W-02 worker used `git stash` to prove red-then-green inside its own worktree. Harmless there, but `git stash` is forbidden by the session rule (cross-worker incident 2026-09-02). Briefs must say: prove red by checking out the parent commit of the source file, never stash.

- `how.md`: replace steps 1-11 with the B-J breakdown; add precondition; add the source-tier model once S-03 is decided.
- `docs/reviews/ipo-pipeline-stage-gap-analysis.md` §6: point to this file.
- Each open W-nn becomes a GitHub issue (or a T-id contract) at the end of the walk, with this file as evidence.
