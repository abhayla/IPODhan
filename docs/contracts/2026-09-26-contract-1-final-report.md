# Contract 1 — Code Fixes — Final Report

Source: `docs/contracts/.run/contract-1-code-fixes-PROGRESS.md` (read-only), cross-checked issue-by-issue against GitHub (`gh issue list -R abhayla/IPODhan --state all`) on 2026-09-28. Times below are as logged in PROGRESS, IST throughout (`ist-timezone.md`).

## 1. Headline counts

| Status | Count | Meaning |
|---|---|---|
| DONE | 63 | merged, staging-proved or CI-proved, issue closed or labelled `fixed-on-main` |
| DONE-proof | 1 | same as DONE — staging proof was read as a separate step after merge (#640) |
| SKIPPED | 8 | re-read on origin/main before building and found already fixed; no code change made |
| PARKED | 15 | 2 fix/review rounds failed, or the proof needs a real-world event that has not happened, or an owner decision is pending — see §4 |
| MOVED TO CONTRACT 2 | 2 | in scope for the release-gate contract (admin editing), not this one |
| MOVED TO DATA CONTRACT | 1 | the remaining work is a row repair, not code |
| **Total issue ids** | **90** | 89 from the contract's six theme tables + #979 (surfaced mid-run, folded into the data hand-off) |

No mismatch against the audit script's expected split (DONE 63, DONE-proof 1, SKIPPED 8, PARKED 15, MOVED TO CONTRACT 2: 2, MOVED TO DATA CONTRACT: 1 = 90).

**Step 0** (the nightly floor runs every registered check): DONE — PR #1117 (ecd8eb64) merged 2026-09-26 07:45 IST; the 2026-09-27 03:45 IST prod floor reported `check_roster` PASS (91 declared checks all reported) and floor-delta `MISSING (0)` (PROGRESS line 2026-09-27 10:57 IST).

## 2. Per theme

### T2 — Wrong or missing values (19)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #394 ipos.sector is an empty string on every row (prod and staging) — sector filter has no real data | DONE | #1122 | #343 #73 PR #1122 (+OD-126 #1124) proof: staging sector filled 21->31 in first cycle after 483ccbf8; 10 CHITTORGARH rows 03:22:28-03:23:11 UTC e.g. runwal-enterprises-ltd 'Real Estate related services', moneyview-ltd 'Financial Technology ( | OPEN (fixed-on-main) |
| #343 sector has no live source after #339: build a real sector writer (Chittorgarh detail-page… | DONE | #1122 | #343 #73 PR #1122 (+OD-126 #1124) proof: staging sector filled 21->31 in first cycle after 483ccbf8; 10 CHITTORGARH rows 03:22:28-03:23:11 UTC e.g. runwal-enterprises-ltd 'Real Estate related services', moneyview-ltd 'Financial Technology ( | OPEN (enhancement,fixed-on-main) |
| #73 #69 residual: deterministic sector VALUE source (matrix entry shipped; value still… | DONE | #1122 | #343 #73 PR #1122 (+OD-126 #1124) proof: staging sector filled 21->31 in first cycle after 483ccbf8; 10 CHITTORGARH rows 03:22:28-03:23:11 UTC e.g. runwal-enterprises-ltd 'Real Estate related services', moneyview-ltd 'Financial Technology ( | OPEN (bug,fixed-on-main) |
| #70 Systemic: 142/167 (85%) genuine IPOs stuck at status=CLOSED with null listing_date — never… | DONE | #1239 | PR #1239 eb79f637 / staging: glass-wall listing_date 2026-09-16, lumino 2026-09-03 (were NULL), source CHITTORGARH 18:55-56Z / issue CLOSED; the CLOSED->LISTED advance (5 rows: glass-wall, jindal-supreme, lumino, vama-wovenfab, veegaland) i | CLOSED (bug,fixed-on-main) |
| #72 #70 residual: extend CLOSED→LISTED listing coverage (older FYs + null-identifier IPOs) | DONE | #1239 | no code: PR #1239 (#70) + the existing date ladder / staging: the 5 rows (glass-wall, jindal-supreme, lumino, vama-wovenfab, veegaland) LISTED at 19:15Z; 0 CLOSED with a past listing date; the remaining 64 NULL-date rows are data contract / | CLOSED (bug) |
| #36 B1: listing_performance 0/91 — NSE past-issues feed lacks listing price + SME source gap | SKIPPED | — | already fixed: staging listing_performance 262 SCRAPER rows, 258/275 LISTED covered) issue: fixed-on-main | OPEN (fixed-on-main) |
| #938 listing_exchanges wrong for the NSE IPO: stored [BSE, NSE], lists on BSE only | PARKED | — | fix merged + on staging; proof owed: a data slot writing listingExchanges under the new code (none yet) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #454 An IPO row can carry a published issue size with zero field_sources rows — the ipos write… | PARKED | — | fix merged + on staging; proof owed: the first real '[LEGACY PATH] … non-destructive fallback' firing (0 so far) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (bug,parked,fixed-on-main) |
| #349 Live pipeline did not refresh Karamtara's issue_size after the issuer cut the IPO from… | DONE | #1128 | PR #1128 16977a31 / proof: prod nightly floor 2026-09-27 carries a c_upcoming_source_drift line (UNVERIFIABLE on this run) - the check now reports every night / issue CLOSED | CLOSED (bug) |
| #963 parseNSEDate turns a missing NSE date into today's date, so a dateless IPO is stored as… | PARKED | — | fix merged + on staging; proof owed: NSE serving a blank-date row ('left absent (#963)' line; 0 so far) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked) |
| #951 Consolidated IPO save writes fields the caller never claimed (overwrites stored… | DONE | #1120 | PR #1120 9d6512f1 / staging proof: dual-listed IPOs rescraped 18:45-18:54Z (moneyview-ltd, runwal-enterprises, a-one-steels, others) all keep exchanges ['NSE','BSE'] after the partial write / issue CLOSED | CLOSED |
| #1074 leadManagers field_sources upsert targets 3 columns but the unique key has 4 (row_key): ON… | DONE | #1118 | PR #1118 e01126e6 / staging proof: 'Failed to record discovered lead managers' warnings 18 -> 0; 3/7 named rows now carry lead_managers + leadManagers field_sources (bench-mark-infotech, green-asia-impex, himalayan-solar); remaining 4 not y | CLOSED (bug) |
| #721 Lot-size Rule 9 (exact SEBI window) never fires for payloads without a segment; only the… | PARKED | — | fix merged + on staging; proof owed: a real LOT_ECONOMICS_IMPOSSIBLE case (0 since deploy) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (bug,parked) |
| #928 OD-69 CIN differ: same name+slug, different CIN silently fails create every cycle (no row,… | PARKED | — | fix merged + on staging; proof owed: a real same-name separate offering minted <slug>-<year> (0 today) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #903 IPO identity: stop the same IPO becoming two rows, and stop two offerings becoming one… | PARKED | — | : OD-130 part merged in #1231 (proof tracked on #928); S4 (missing company_id data), S5 (type guard cannot fire) and the OD-85 source-key scenarios are outside the built scope / issue #903 OPEN, label parked | OPEN (parked) |
| #553 STAGING: duplicate IPO rows on ipodhan_staging - the unbound copy has no documents (NOT… | SKIPPED | — | already fixed: #520 3ffc9e19 2026-09-10; ARCIL pair pinned in #1123; duplicate rows -> data contract) issue: fixed-on-main | OPEN (fixed-on-main) |
| #356 NSE/BSE discovery (unrestricted, 4x/day) did not create Karamtara Engineering on prod for 4… | PARKED | — | : reader gap closed by #354; staging 47 rows/14d none NSE/BSE-first; prod 09-04..07 logs rotated, payloads never captured; needs a fresh NSE/BSE-first event. | OPEN (bug,parked) |
| #222 backlog: wire ipo_details.issue_type writer (Chittorgarh detail-page fetch) | SKIPPED | — | already fixed: 61391a9c #569; staging issue_type 267/267 filled, last CG 2026-09-25 18:45 UTC) issue: fixed-on-main | OPEN (enhancement,fixed-on-main) |
| #818 Admin queue is 28,120 open items across 268 IPOs — above what one person clears; pipeline… | DONE | #1127 | PR #1127 a4eabd41 / staging proof: unresolved data_conflicts created after the deploy: 8 issueSize + 3 companyName, 0 on lastScrapedAt/updatedAt, every money value <= 2 decimals / issue CLOSED | CLOSED |

### T3 — Document pipeline: fetch, extract, retry (20)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #632 Nightly floor m_blocked_all_age: four documents BLOCKED_ALL for up to 158 h (Fly-Hi… | DONE | #1200 | PR #1200 0537a47e / staging proof: BLOCKED_ALL 482 -> 474; of 59 fetch-state rows updated after the deploy, 21 chains now record NSE not_carried and move on to SEBI/company/verifier, 15 settled by an exchange that answered, 1 genuine EXCHAN | CLOSED |
| #583 Recurrence of #396: spawnSync nice ETIMEDOUT, now hard-blocked at retryCount 10 - and #396… | DONE | #1190 | PR #1190 de8ab5a0 / staging proof: moneyview-ltd PRICE_BAND_AD d2fd7c2d was MANUAL_REVIEW rc 10 'blocked_after_10_attempts@extract_filing.py@2026-09-03'; after the 2026-09-26 extractor version it was re-attempted and is now COMPLETED rc 0 ( | CLOSED |
| #1046 OCR step crashes deterministically (rapidocr ONNXRuntimeError 'inference failed') on 2 real… | DONE | #1195 | PR #1195 2a9d9f4f / staging proof: runwal-enterprises-ltd PRICE_BAND_AD e4f521b0, previously FAILED HARD_FAILURE in the OCR step on every retry (rc 4), is now COMPLETED (updated 2026-09-27 02:54:17Z) after the OCR memory fix. The other 3 do | CLOSED (bug,deferred) |
| #620 Document step never drains its queue: budgetExhausted on every prod cycle, 3-22 items left… | MOVED TO CONTRACT 2 | — | owner decision: the fix ships with item 7 (contract 2); issue OPEN | OPEN (bug) |
| #545 staging: RHP and DRHP extraction writes no promoters and no peer_companies - only… | PARKED | — | fix merged + on staging; proof owed: moneyview/acevector RHP re-read under the reserved re-read slot (#1254); ~2-6 days (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #606 Peer table: a two-level header maps child columns by the LABEL's index, so every PRASOLCHEM… | DONE | #1133 | PR #1133 (9a25aa56) proof: real PRASOLCHEM fixture — strict xfail now passes (eps_basic col 7, eps_diluted col 10), CMP false-relocation case pinned; no staging path until #605 wires the peer extractor issue: fixed-on-main | OPEN (bug,fixed-on-main) |
| #502 Extractor emits duplicate risk-factor rows with empty bodies (14 surplus rows on staging) | DONE | #1135 | PR #1135 / staging proof: risk-factor rows written after the deploy for 6 IPOs: 271/291 carry a non-empty body (baseline 0/4,751), 0 duplicate headings across the 6 IPOs / issue CLOSED | CLOSED |
| #503 Table rows are being scraped into ipo_risk_factors.heading (prasol-chemicals-ltd,… | DONE | #1135 | PR #1135 / staging proof: same: 271/291 new risk-factor rows carry a body, 0 duplicate headings across 6 IPOs / issue CLOSED | CLOSED |
| #347 Anchor allocation report rejected: printed % vs computed share disagree (8.55% vs 5.43%)… | DONE | #1136 | PR #1136 / staging proof: runwal-enterprises-ltd ANCHOR_ALLOCATION_REPORT COMPLETED 2026-09-26T21:24:19Z with 10 anchor_investors rows (shares + amount populated); the 3 MANUAL_REVIEW + 1 FAILED anchor docs since the deploy each carry a nam | CLOSED (bug) |
| #409 anchor-deterministic-refusal: Kanohar Electricals Limited (staging) | DONE | #1136 | PR #1136 / staging proof: same anchor run: runwal-enterprises-ltd 10 anchor_investors rows written after the deploy; refused docs carry named causes / issue CLOSED | CLOSED (nightly-audit) |
| #771 issuer_ratio_yield FAIL: 6 of 6 prospectus-family documents extracted since 2026-09-16… | PARKED | — | fix merged + on staging; proof owed: an RHP/DRHP re-read at @2026-09-27 writing a ratio or a named refusal (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (bug,parked,fixed-on-main) |
| #634 A retry loop that discards its own failure causes: ten attempts retain one reason, and the… | DONE | #1157 | PR #1157 55869579 / staging proof: document_extraction_attempts: 3 rows written after the deploy, each with a real cause (w45_disagreement, anchor 0-rows); ck_documents_extraction_status present / issue CLOSED | CLOSED (bug) |
| #676 extraction_status enum and documents.extraction_status values have drifted | DONE | #1157 | PR #1157 55869579 / staging proof: document_extraction_attempts: 3 rows written after the deploy, each with a real cause (w45_disagreement, anchor 0-rows); ck_documents_extraction_status present / issue CLOSED | CLOSED (bug) |
| #959 Extraction-failure backoff is a timed re-read of a stored document (filing-auto-persist… | PARKED | — | fix merged + on staging; proof owed: the other 2 legacy HARD_FAILURE rows parked (1 of 3 parked 09-28) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,deferred,fixed-on-main) |
| #365 capture a real NSE OFS payload and verify the parse before enabling on prod | PARKED | — | (open, label parked) / NSE category=ofs live fetch = {} (no OFS book since 09-07, >2 working days); next-round plan on issue | OPEN (parked) |
| #932 Closed-IPO job: a stage change is inferred from listing_date, so a late status flip can be… | DONE | #1134 | PR #1134 11309d8b / staging proof: closed-IPO job slot 1320 ran after the deploy ('run complete' 18:25:38Z) and filled status_at_attempt on 30 rows (LISTED/CLOSED) / issue CLOSED | CLOSED |
| #777 S5 note: the claim query's re-open trigger was already broken when it was dead code —… | MOVED TO CONTRACT 2 | — | owner decision: guidance for item 6's re-open work; issue OPEN | OPEN (enhancement) |
| #648 F-101 residual: a writer that keys every provenance row '' is indistinguishable from one… | DONE | #1168 | PR #1168 484218a9 / staging proof: staging wake log 'Anchor auto-persist summary for this cycle (W-168)' after the deploy carries markerWriteFailed:0 - the counter is wired and emitting / issue CLOSED | CLOSED |
| #695 report-82 reader: FY2026-27 returns the identical page for every page number, so the reader… | DONE | #1130 | PR #1130 (5b48f67c) proof: live FY2026-27 report-82 read mainboard 2 pages/96 rows, SME 2 pages/179 rows, 'stopped on: no new rows after dedupe' (was 200 requests + throw) issue: closed (dev tooling) | CLOSED (bug) |
| #933 Document PDFs outlive OD-32's retention: RHP read 2026-09-11 still on the staging disk… | PARKED | — | fix merged + on staging; proof owed: a real WITHDRAWN/POSTPONED purge candidate (0 purged so far) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked) |

### T4 — Scheduler, deploy and ops safety (13)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #624 A deploy kills the running scraper cycle and later wakes exit on the held scraper:cycle… | DONE | #1152 | PR #1152 154fb18f / staging proof: 28 scheduled cycles completed after the 16:06Z deploy (e.g. 16:45Z, 16:56Z wake-complete inside ceiling), 0 lock-blocked lines / issue CLOSED | CLOSED (bug) |
| #348 Nightly audit cron runs the PREVIOUS night's script: bash parses run_audit before the… | DONE | #1148 | PR #1148 802e6a11 / run headers: 09-26/27 6 steps, 09-28 'checked out: 71c00e55 … (7 audit steps in this script)' + 8 steps (same-night re-exec) / issue CLOSED | CLOSED (bug,fixed-on-main) |
| #707 scraper-wake: no detection for repeated wake-skipped lines (stale lock can block wakes for… | DONE | #1144 | PR #1144 + #1224 / prod floor 09-28: the two wake-log checks [UNVERIFIABLE] 'log file not present' (FAIL on 09-27) / issue CLOSED | CLOSED (nightly-audit,fixed-on-main) |
| #698 assert-repair-held counts every scraper start as a cycle: three deploy restarts tonight… | DONE | #1146 | PR #1146 3f6986b8 / staging proof: scraper_steps.trigger column present; 28 rows trigger=schedule + 14 trigger=deploy since the deploy / issue CLOSED | CLOSED (bug) |
| #151 prod+staging share one Redis instance with no slot-namespaced cache keys (cross-slot data… | DONE | #1155 | PR #1155 05e1e182 / staging wake log: before the deploy, unprefixed lock:resource:scraper:cycle/live x8 each; after (a5810299), staging:lock:resource:scraper:cycle/live and 0 unprefixed / issue CLOSED | CLOSED (bug,fixed-on-main) |
| #752 deploy-config.sh: three pre-existing holes in repo-root/lineage resolution (GIT_DIR bypass,… | DONE | #1145 | PR #1145 56f15452 / no staging surface: deploy-config.sh is a manual ops tool no deploy calls (staging deploy 36346241620 log: no deploy-config line, 0 credential URLs); proof = the 151-check suite in CI + the server origin classified as al | CLOSED (bug,fixed-on-main) |
| #568 C:/Program Files/Git/api/version is edge-cached for a year, so every served-sha read… | DONE | #1153 | PR #1153 47cc2a60 / staging proof: curl -sI staging /api/version -> HTTP/1.1 200 OK, content-type application/json / issue CLOSED | CLOSED |
| #640 A script that forgets DATABASE_NAME connects to PRODUCTION, silently, as the superuser | DONE-proof | #1139 | PR #1139 c309fe1b on staging (deploy run 36228462148 success) / proof: /api/health on staging 127.0.0.1:3012 -> database connected true 3ms at 08:08:27Z; scraper cycle 58579fd6 14 steps 08:06:56Z, wake-complete, lock released; 0 DATABASE_NA | OPEN (bug,fixed-on-main) |
| #481 openRepairDb times out anonymously when only DATABASE_URL is set — initPool ignores it, and… | DONE | #1141 | PR #1141 (89fbf3a5) / proof: unit mutation test + Tier B PASS (laptop tooling, no staging surface) / issue CLOSED | CLOSED |
| #240 Decide: retire or fix the dead API_FALLBACK scraper source (round-7 P3-6) | DONE | #1140 | PR #1140 826d1261 / proof: prod nightly floor 2026-09-27 j_dead_source_retire_by fires with identities: MONEYCONTROL and DOCUMENTS DEGRADED 7 consecutive cycles, no retire-by date (tracked as #1223, owner Q7) / issue CLOSED | CLOSED |
| #881 Windows-era tooling: retire the .ps1 scripts and their runbooks together, or keep them… | DONE | #1143 | PR #1143 a2d2924a / proof: 0 refs to 6 retired names, Tier A PASS / issue CLOSED (housekeeping, no prod surface) | CLOSED |
| #630 unattended-upgrades restarts the self-hosted Actions runner mid-deploy — it killed one… | DONE | #1219 | PR #1219 d288af3d / staging proof: staging window deploy run 36304814329 (d3a1dce4, 08:00Z) logs '==> Checking for orphan release debris from a previous killed deploy (#630)' and 'orphan-cleanup: backfilled completion marker' for 20260926-1 | CLOSED (bug) |
| #719 Staging wake wrapper cannot read the Redis cycle lock TTL and proceeds fail-open on every… | DONE | #1252 | PR #1252 b5de26ea / staging wake log: NOAUTH lock warnings 4 in the hour before the deploy -> 0 after; post-deploy wakes read 'lock … is free' (20:15Z data, 20:20Z live) / issue CLOSED | CLOSED (bug,deferred,fixed-on-main) |

### T5 — Repair-tool safety, code only (7)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #386 Migrate the 25 pre-T-490 repair/backfill tools onto scripts/lib/repair-tool.ts (dated… | DONE | #1147 | PR #1147 8bc5aca8 (+ earlier migrations) / proof: git grep repair-tool-exempt on origin/main -> only lib/repair-tool.ts; lint 55 checked OK / issue CLOSED (per-tool staging dry run not done: contract read-only) | CLOSED |
| #422 repair-source-trust-batch-t292: hard-coded corrections are stale — would NULL Priority… | DONE | #1164 | PR #1164 a6b5026a / staging: read-only dry run of t292 -> 0 rows would be corrected, 18 SKIPs (terminal-status rows: mopshop and priority-jewels LISTED, suryo and travels CLOSED) / issue CLOSED | CLOSED |
| #457 Repair ledgers record which rows changed but not what they held — a changed-id list is not… | DONE | #1175 | PR #1175 4f4e77eb / no staging surface (ledgers are written only on --apply, forbidden here): proven by the CI integration test on real Postgres (repair-ledger-guarded-requeue: before NOT_EXTRACTABLE / after PENDING, raced rows untouched) / | CLOSED (bug) |
| #671 refresh-registrar-urls-t300.ts writes registrars under --apply with no openRepairDb guard… | DONE | #1147 | PR #1147 8bc5aca8 / proof: 36/36 red-first all 15 tools, guard-order mutation 2 fail, 133/133, lint OK 0 exemptions, Tier A PASS / issue CLOSED (laptop tooling, no runtime caller); wider class #1150 | CLOSED (bug) |
| #1051 Two more ungated ipos-row delete paths (name-pollution repair loser merge,… | DONE | #1151 | PR #1151 0fffc363 / proof: 10/10 red-first unit, gate-force mutation fails, CI integration on ipodhan_test (merge-log + redirect + refusal + unmerge + idempotent), ratchet 53->52, Tier A round 2 logic sound; 0 duplicate groups live / issue  | CLOSED (bug,deferred) |
| #715 Repair tools fall back to localhost:6379 for cache invalidation when REDIS_URL is unset:… | DONE | #1070 | PR #1070 (df6cacba) proof: gate self-test 13/13 red-on-unguarded, gate OK on repo, repair-tool 109 + scripts 1032 tests pass; 3 tools migrated, 22 baselined with reasons issue: closed (dev tooling) | CLOSED (bug,deferred) |
| #1054 repair-issue-size-od74 integration test may hit the same DB-wide test-isolation class as #1045 | DONE | #1059 | PR #1059 dd0ad75f / proof: CI integration repair-issue-size-od74 4 tests pass (47/47 files), 190/190 unit, Tier B PASS / issue CLOSED (dev tooling, no staging surface) | CLOSED (deferred) |

### T7 — Reader-facing web (7)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #57 Home page IPO tables not wrapped in AsyncErrorBoundary (temp-disabled due to webpack error) | DONE | #1167 | PR #1167 a324e4af / staging proof: staging home page 200 OK / issue CLOSED | CLOSED (bug) |
| #98 Landing summary metrics are FABRICATED (60/40 gain split, 25%/15% hardcoded) on mainboard +… | DONE | #1163 | PR #1163 62bd4cc8 / staging proof: /mainboard-ipos 200 rendering real total '3 IPOs', /sme-ipos 200; fabricated fields gone / issue CLOSED | CLOSED |
| #975 web: freeze a DELISTED IPO page with a notice (OD-38 -> OD-8 mechanism) | PARKED | — | fix merged + on staging; proof owed: a real WITHDRAWN/DELISTED row on staging (0 today) (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #983 Delisting detection for the post-listing price job (split from #972) | PARKED | — | fix merged + on staging; proof owed: the 09-28+ price-job runs (Mon-Fri 09:15-15:30 IST) logging the delisting reading (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #551 three modules invalidate IPO caches and each clears a different, partly wrong key set -… | DONE | #1188 | PR #1188 6dd21490 / staging proof: moneyview-ltd: DB row updated_at 18:45:20.878Z matches /api/ipos/moneyview-ltd on staging field-for-field (no stale cached detail after the write) / issue CLOSED | CLOSED |
| #58 Mainboard 'Recently Listed' cards don't show listing-gain % (generic IPOCardEnhanced) | SKIPPED | #1162 | (already met) / PR #1162 closed unmerged (IPOCardEnhanced renders on no page; MultiSelectCard imported nowhere) / proof: ListingIndexClient gainCell = OD-124 rule; staging /mainboard-ipos payload carries Karamtara 38.58 / issue CLOSED; owne | CLOSED (bug) |
| #167 Populate IPO Reviews/Scores/Anchor Investors feature (currently de-navved, code exists but… | DONE | #1189 | PR #1189 04568436 / staging a5810299: the review pages 308 to the list pages (200), the review APIs 404, an admin route 401 unauthenticated / issue CLOSED | CLOSED (fixed-on-main) |

### T6 — Tests and CI coverage (23)

| Issue | Status | PR | Proof / what is left (from PROGRESS) | GitHub state |
|---|---|---|---|---|
| #109 42 pre-existing failing unit tests in 8 files (found by the installed test-pipeline,… | SKIPPED | — | (already met) / CI unit suites on main green: web 2743 pass/19 skip, shared 498, scraper 5669; the 8 named files 237/237 / issue CLOSED | CLOSED |
| #252 scraper integration tier is broken on main (12 files fail against an empty ipodhan_test) —… | DONE | #1209 | PR #1209 a716ecc0 / proof: cross-file fixture race fixed (fileParallelism false), 53/54 run + 1 reasoned exclusion, CI integration job 2m26s green; Tier B PASS / issue CLOSED | CLOSED (bug,tests) |
| #507 11 of 17 scraper integration tests run nowhere — pr-gate's integration job is an… | SKIPPED | — | (already met) / require-integration-test-coverage.mjs on main (3 refs in pr-gate.yml) -> 'every scraper integration test file is run by CI or excluded' / issue CLOSED | CLOSED |
| #575 phase-1-e2e.test.ts fails: all 5 cases; test IPO ids are not UUIDs | DONE | #1194 | PR #1194 b5b59963 / proof: CI 6 tests (5 pass, 1 todo -> #1196) 800ms in scraper-document-integration; Tier B r1 fixed / issue CLOSED | CLOSED (deferred) |
| #616 28 of 51 test files under scripts/tests/ are never run by CI - they pass by not being in… | DONE | #1174 | #681 #1158 / PR #1174 734ec024 / proof: CI green 730bb00fc 8/8; require-scripts-test-coverage + check-ci-step-install-order (T-570) pass on main; 34 files wired, 6 excluded with issues (#1173,#1176,#1177,#1178,#1181,#1182) / issues CLOSED ( | CLOSED |
| #681 23 scripts/tests files are named by no workflow and never run in CI (wire-or-retire) | DONE | #1174 | #681 #1158 / PR #1174 734ec024 / proof: CI green 730bb00fc 8/8; require-scripts-test-coverage + check-ci-step-install-order (T-570) pass on main; 34 files wired, 6 excluded with issues (#1173,#1176,#1177,#1178,#1181,#1182) / issues CLOSED ( | CLOSED |
| #832 The web-integration baseline still has 25 entries, and the owner's release-cut rule… | DONE | — | PRs #1212 b12293c3 + #1218 467e1de8 / proof: web-integration baseline 25 -> 14, 11 passing entries removed, every remaining entry cites #1215 (real orphan-migration defect) or #1217 (12 triaged, not root-caused); baseline test 20/20, CI gre | CLOSED |
| #754 data-consolidation-document-outranks-websites.test.ts (T-520) asserts field literals that… | DONE | #1184 | PR #1184 7791a46a / proof: guard test 3/3 local + CI green 8162ec747; test-only, no staging surface; dead keys -> #1186 / issue CLOSED | CLOSED (bug,deferred) |
| #631 101 optional members across 8 *Deps interfaces — the compiler cannot tell you a production… | DONE | #1202 | PR #1202 a9542757 / proof: 4 enumerating deps tests 9/9 (supervisor re-run), mutation red, CI green 8acd0d63; test-only / issue CLOSED | CLOSED (bug) |
| #635 'redis as never' in filing-persist-deps hides a dual-package Redis type mismatch on the… | DONE | #1185 | PR #1185 20b7ed44 / staging proof: 0 redis-error lines in the staging scraper log spanning the deploy / issue CLOSED | CLOSED (bug) |
| #392 Pre-existing: importing @ipodhan/shared/db together with a src/utils import that pulls… | DONE | #1198 | fix PR #1198 b323cbab + regression test PR #1199 76efe692 / proof: test red on pre-#1198 main, green after (supervisor re-run pass 1), CI green 38dd94d6 / issue CLOSED | CLOSED |
| #434 scraper/scripts: 23 legacy tools excluded from the new type-check gate carry real type errors | DONE | #1198 | PR #1198 b323cbab / proof: scripts type-check exclude 23->0, src baseline 87->63, all pr-gate scripts/ci checks exit 0 locally, CI green 52bc8bb3; Tier A; revived operator tools declared / issue CLOSED | CLOSED |
| #890 scraper/src has 22 type errors no CI job sees; the scripts type-check shows them only when… | DONE | #1183 | PR #1183 f26e622e / proof: pr-gate scraper/src tsc shrink-only baseline (87) green on 62c4624c9; CI-only, no staging surface / issue CLOSED | CLOSED (bug,deferred) |
| #886 drizzle's snapshot chain is BROKEN at 0050: the next generated migration re-creates… | DONE | #1203 | PR #1203 8166ae2a / proof: dry drizzle-kit generate 8113B spurious DDL -> 'No schema changes'; chain rule head-sorts-last red->green 17/17; Tier A PASS (bin.cjs name-sort, migrator journal-only); CI green 91b1a2f5 / issue CLOSED | CLOSED (bug) |
| #501 Migration journal has two idx/when pairs running backwards in time (#442 class) | SKIPPED | #1197 | (already met on main since 2026-09-06, MONOTONIC_CHECK_FROM_IDX=33, pr-gate 274-275) + PR #1197 adae4b0b IST messages merged / issue CLOSED | CLOSED |
| #665 audit:schema-drift compares columns only; hand-applied indexes and constraints… | DONE | #1204 | PR #1204 / 09-28 run step 5: 'INFO: 38 known (#665) undeclared index/constraint finding(s), tracked in config/schema-drift-undeclared-baseline.json' / issue CLOSED | CLOSED (bug,deferred,fixed-on-main) |
| #196 G-K: standing mutation job — a guard that survives deletion with a green suite is not a guard | DONE | #1210 | PR #1210 50e8e858 / proof: sweep 8/8 CAUGHT (incl. #1207 registry fix), self-test PASS x2 on Windows after r2, CI green 57bee5e7 / issue CLOSED | CLOSED |
| #195 G-J: alert-channel quality — standing signal:noise measurement + synthetic-alert drill | PARKED | — | fix merged + on staging; proof owed: the 2026-10-01 03:45 IST audit step 8 (J2 drill, Thursday only); J1 proven 09-28 (owner 09-28: proofs arrive over time) / issue OPEN labelled parked | OPEN (parked,fixed-on-main) |
| #469 Design traceability mode 1: a card can drop a rule it implements and stay green, if any… | DONE | — | recorded above; staging proof read 22:3x: NOT YET #583 (6 rows unchanged, updated_at 09-25), #1046 (4 docs unchanged), #648, #933, #676/#634 behaviour; PARTIAL #545 (zero-promoter IPOs 59->43, peers near-absent; waits 03:45 floor) -> re-rea | CLOSED |
| #258 Stage-isolated test harness for the IPO pipeline (stages 0-9) | DONE | #1214 | PR #1214 174ce56a / proof: stages 0-9 all have isolated harness tests; supervisor re-run 47 pass/2 skip (named gaps: no real SME NSE payload, no full RHP PDF), provenance 0 new, CI green 12db5174 / issue CLOSED | CLOSED |
| #1106 20 build cards have a hand-written rules block with no generator marker;… | DONE | #1192 | PR #1192 c3b8ac6f / proof: apply-rule-ownership exit 0, 0 REFUSED (supervisor re-run), tests 6/6, build cards 41 OK; tooling-only / issue CLOSED | CLOSED (deferred) |
| #819 a_b_min_application FAIL 2026-09-20 is NEW: #736's NULL-segment cause is fixed, so the… | SKIPPED | — | (already met: failing identity no longer exists) / nightly floor a_b_min_application PASS on 09-24/09-25/09-26 (VPS floor files, read-only) + live staging run PASS 0 violations over 21 oracle rows / 34 live IPOs / issue CLOSED completed | CLOSED |
| #573 bse-scraper.integration.test.ts fails: 3 'Data Discrepancy Handling' cases red | DONE | #1191 | PR #1191 0aa80215 / proof: file 5/3 -> 8/8, now run by pr-gate integration job, CI green 17d4ae172, Tier B PASS; test-only / issue CLOSED | CLOSED (deferred) |
## 3. PARKED — the signal that will prove each one

| Issue | Waits for |
|---|---|
| #195 | the 2026-10-01 03:45 IST audit step 8 (J2 drill, Thursday only); J1 proven 09-28 |
| #356 | a fresh NSE/BSE-first discovery event (staging: 47 rows/14 days, none NSE/BSE-first; prod 09-04..09-07 logs rotated, payloads never captured) |
| #365 | a live NSE OFS book (category=ofs fetch returns {} — none since 09-07, over the 2-working-day PARK threshold) |
| #454 | the first real '[LEGACY PATH] … non-destructive fallback' firing (0 so far) |
| #545 | moneyview/acevector RHP re-read under the reserved re-read slot (#1254); ~2-6 days |
| #721 | a real LOT_ECONOMICS_IMPOSSIBLE case (0 since deploy) |
| #771 | an RHP/DRHP re-read at @2026-09-27 writing a ratio or a named refusal |
| #903 | S4 (needs company_id data that does not exist), S5 (the type-guard scenario cannot fire on real data) and the OD-85 source-key scenarios — outside what OD-130 (merged in #1231) built; proof tracked on #928 |
| #928 | a real same-name separate offering minted <slug>-<year> (0 today) |
| #933 | a real WITHDRAWN/POSTPONED purge candidate (0 purged so far) |
| #938 | a data slot writing listingExchanges under the new code (none yet) |
| #959 | the other 2 legacy HARD_FAILURE rows parked (1 of 3 parked 09-28) |
| #963 | NSE serving a blank-date row ('left absent (#963)' line; 0 so far) |
| #975 | a real WITHDRAWN/DELISTED row on staging (0 today) |
| #983 | the 09-28+ price-job runs (Mon-Fri 09:15-15:30 IST) logging the delisting reading |
## 4. SKIPPED (already fixed on main before this run)

#36, #58, #109, #222, #501, #507, #553, #819 — each re-read against origin/main or staging in the §0.2 preflight before any builder was dispatched; the fix already existed (an earlier PR, or the data had moved since the inventory was written). No code change made; issues closed with the reading that proved it.

## 5. Found along the way

Deferred / follow-up issues filed during the run (not in the 90-item scope; not required for contract 1 completion). Listed for contract 2 / data-contract triage.

| Issue | State | Labels | Title |
|---|---|---|---|
| #1113 | CLOSED |  | Nightly floor: a crashed check is recorded under its function name, so its registered id reads as never-run (check_roster) |
| #1114 | OPEN |  | Nightly floor g_freshness_per_type: newest OFS row 109 days old, RIGHTS and NCD 36 days (ceiling 21) |
| #1115 | OPEN |  | Nightly floor h_pm2_env_tz: pm2-logrotate, firekaro-api and notifier have no TZ in their environment |
| #1116 | OPEN |  | Nightly floor m_document_type_classifier: two documents stored as RHP classify as PROSPECTUS |
| #1125 | OPEN |  | Owner decision: the slug of a genuinely separate second IPO row with the same name (blocks #928 completion) |
| #1142 | OPEN | parked | DB-default lint: close the cast/alias/intermediate-variable bypasses + hard-coded connection targets (#640 remainder) |
| #1149 | OPEN | deferred | Audit cron self-re-exec: alert on a failing pre-exec fetch; test must not touch global git config (#348 review minors) |
| #1150 | OPEN | deferred | DB-writing scripts outside the repair-tool lint's filename pattern have no openRepairDb prod guard (#671 remainder) |
| #1154 | OPEN | deferred | Name-pollution repair: dry-run/apply eligibility can differ; rename-then-merge untested on real rows (#1051 review minors) |
| #1156 | OPEN | deferred | Wake wrapper session sweep: test the refusal guard, clear traps before sweeping, make sweep lines detectable (#624 review minors) |
| #1158 | CLOSED | deferred | scripts/tests/field-plan-slot.test.mjs test 432 fails on main and no CI job runs it |
| #1159 | OPEN | deferred | Extraction status/attempt writes: log swallowed failures, 400 on bad admin value, tighten outcome type, state attempts growth bound (#676/#634 review minors) |
| #1160 | OPEN | deferred | board-owed-guard marks a merge owed when the merge command did not run (gate-refused && gh pr merge) |
| #1165 | OPEN | deferred | Document peer-table figures are never persisted: extractor returns printed text, persister numOrNull accepts numbers only |
| #1166 | OPEN | deferred | Document peers: names-only sets can add but never remove a peer; provenance written for rows kept from Chittorgarh (#545 review minors) |
| #1169 | OPEN | deferred | Other components still disabled by a stale 'TEMP webpack error' comment (Toaster in layout, AffiliateCTAWrapper on home) |
| #1173 | OPEN | deferred | audit-ipo-coverage.mjs subRows query is missing 3 columns its substance predicates read (face_value, authoritative_issue_price, company_website) |
| #1176 | OPEN | deferred | Schema drift: migrations build gmp_records numeric columns as numeric(32,0) while schema.ts declares numeric(10,2) |
| #1177 | OPEN | deferred | assert-migrations-applied.test.sh fails 2 cases in CI (DB exactly at / ahead of newest journaled migration) |
| #1178 | OPEN | deferred | audit-findings-to-issues.test.mjs case 56 fails in CI: LIVE run expected to write issues-sync-state.json |
| #1179 | OPEN |  | issuer_ratio_yield: a fixed-reader prospectus with no current_ratio and no accepted reason (tracking) |
| #1180 | OPEN | deferred | T-570 install-order check does not follow scripts a test spawns (spawnSync(process.execPath, [SCRIPT])) |
| #1181 | OPEN | deferred | check-build-cards-status.test.mjs fails 3 cases on the CI runner (git subprocess / real-gate cases) |
| #1182 | OPEN | deferred | check-dod-root-resolution.test.mjs fails 1 case on the CI runner (ENOENT on a planted build-card fixture from a non-checkout cwd) |
| #1186 | OPEN | deferred | 13 field-priority-matrix keys are snake_case and never looked up: their per-field source rules have never applied in production |
| #1187 | OPEN |  | Sweep: db/redis handle cast 'as never' on ordinary repository constructors (class of #635) |
| #1193 | CLOSED | deferred | CI: fail a PR whose deleted files are still referenced by a non-doc file |
| #1196 | OPEN | deferred | companyName has no field_sources provenance on 47 of 396 staging IPOs (all 6 recent ones created by Chittorgarh discovery) |
| #1201 | OPEN | deferred | SME documents: BSE is never asked, although the spec's SME order is NSE then BSE (29 BSE-only SME IPOs have no exchange source) |
| #1207 | CLOSED |  | Mutation-guard sweep GAP: memory_guard's __cause__ walk (#1046) is deletable with a green suite |
| #1208 | OPEN | bug,tests | phase-1-e2e test 5 failed once under a 15-min fully-serial local integration run (not reproducible standalone) |
| #1211 | OPEN |  | web-integration: ipo-details-category-reservation p95<50ms assertion fails over SSH-tunneled local DB, not confirmed on CI |
| #1215 | OPEN |  | ipo_reviews.category is a live NOT-NULL column, orphaned from schema.ts and the migration journal (blocks every review insert) |
| #1217 | OPEN |  | Round-2 web-integration baseline triage: 12 unresolved failure signatures needing individual RCA |
| #1220 | CLOSED | bug | deploy-linux.test.sh: full suite dies silently near its end (repro: right after whatever runs last before appended cases) - likely 29d/29e's deliberately-unkilled sleep 30 fixtures |
| #1221 | OPEN | deferred | Prod floor 2026-09-27 NEW: g_repeated_warn - 'extraction_blocked=7' (PARTIAL) x45 in 24h |
| #1222 | OPEN | deferred | Prod floor 2026-09-27 NEW: listed_rotation_stall - Karamtara Engineering and Axiom Gas Engineering stuck >24h |
| #1223 | OPEN | deferred | Prod floor: MONEYCONTROL and DOCUMENTS sources DEGRADED 7 consecutive cycles with no retire-by decision (j_dead_source_retire_by) |
| #1228 | CLOSED | deferred | Pull-model field walk has no mapping for ipos.listingDate from NSE/BSE/CHITTORGARH (NO_MAPPING gap every attempt) |
| #1229 | CLOSED | deferred | Date sanitizer runs on the partial consolidation result, so it nulls a valid listing_date whose open_date is stored but not in this update |
| #1233 | OPEN | deferred | OD-129 board half: the offer document's listing sentence should decide ipos.segment (board), not only listing_exchanges |
| #1235 | OPEN | deferred | Identity: the same-name multi-match HOLD fires before the segment/offering-type filter and even when ISIN/symbol would bind the record |
| #1236 | OPEN | deferred | OD-129 fallback door: a failed provenance lookup lets a feed widen a document-held listing set, and it is not self-corrected |
| #1240 | OPEN | deferred | Field walk: no walk-level test that refusedDateFields becomes DATE_REFUSED_REASON and skips the reopened-loss branch |
| #1241 | OPEN | deferred | Deploy switchover: cron-launched scraper runs are invisible to the idle wait and pm2 stop, and the deploy releases their cycle locks |
| #1242 | OPEN | deferred | #151 follow-ups: spawn-check blind spots, a staging rollback clears prod's legacy cache in the mixed window, aliased Redis constructor |
| #1243 | OPEN | deferred | OD-125 leftover: two admin paths still read/write ipo_reviews after the review feature was retired |
| #1245 | OPEN | deferred | #959 follow-ups: an uncounted attempt when the IN_PROGRESS stamp write fails; a w45 row not re-read when its counterpart document changes |
| #1246 | OPEN | deferred | #545 follow-ups: SME covers that parse almost nothing; NOT_PRINTED used for reader misses; the plan row does not show the empty reason |
| #1247 | OPEN | deferred | #771 follow-ups: version re-reads take ~2 weeks behind new documents; per-type version floors are a second version system; a refusal keeps an old value |
| #1248 | OPEN | deferred | Repair ledgers are written under evidence/ inside the worktree, where a worktree cleanup deletes them |
| #1249 | OPEN | deferred | Repair tools write cached tables with no cache invalidation (reopen-stale-doc-nay, risk-factor-heading-hash, zip-member-documents) |
| #1250 | OPEN | deferred | 30 row-changing repair tools write no ledger at all (no rollback artifact) |
| #1253 | OPEN | deferred | Fallback door follow-ups: 3 copies of the E-1 rule, a ledger flag wrong after a failed provenance commit, no degenerate price-band guard |
| #1255 | OPEN | deferred | #719 follow-ups: a no-expiry lock skips every wake silently; runbook REDIS_CLI_DB tip is wrong; build_release exports the web env (REDIS_URL with password) into the deploy shell |
| #1256 | OPEN | deferred | Status date ladder moves status BACKWARDS without an ADMIN row (CLOSED→OPEN Veegaland, OPEN→UPCOMING Jindal Supreme) |
## 6. MOVED TO CONTRACT 2 and MOVED TO DATA CONTRACT

| Issue | Moved to | Why |
|---|---|---|
| #620 | Contract 2 | The fix ships with item 7 (document-step budget exhaustion), which is contract 2 scope by the owner's own order (issues first, admin editing and item 7's remainder after) |
| #777 | Contract 2 | Folded into #932's re-open-trigger fix as guidance; the remaining substance is item 6's re-open work, contract 2 scope |
| #979 | Data contract | 8-10 old CLOSED IPOs carry a non-capable issue_size with no capable source to repair from; owner already decided OD-123 (apply NOT_SOURCED) — this is a row write, not code |

## 7. NEXT

**Contract 2 (release gate):**
- Item 36, admin data editing (#1108, spec §9, OD-102..OD-121) — not started; this is the release-gate feature.
- Item 7's remainder (document-step budget exhaustion, #620) and #777's item-6 re-open guidance.
- #787 (named in the contract's scope boundary as contract-2 work, not read this session).
- Swap Test path 2, S6 floor wiring, board-from-data — named in the contract's scope boundary as out of contract 1.

**Data contract (row repairs, dry-run only in this contract):**
- #979 / OD-123 (NOT_SOURCED for 8-10 old CLOSED IPOs with no capable issue_size source).
- 37 provenance rows with no stored value (OD-131 cleanup: 20 issueSize, 13 listingDate, 2 priceRangeMin, 2 priceRangeMax) — PR #1227 stops new ones; the 37 existing rows need a delete-if-no-value repair tool, per `docs/contracts/.run/contract-1-data-handoff.md`.
- The 56-64 CLOSED IPOs with a NULL listing_date that #72's fix did not reach (#70/#72 advanced 5 rows on staging; the data hand-off measured a 56-row superset of older CLOSED rows — the exact filter needs re-deriving from the issue's null-identifier / older-FY criteria, not the broader net measured here).
- #454's provenance backlog: 10+ rows (Maruti Interior, Muthoot Fincotp, Stanbik Agro, Shipwaves Online, Western Overseas, Dhanwel Hybrid Seeds, Travels & Rentals, Power Finance Corp, and more) missing field_sources for a published issue_size; the write path is fixed going forward (PR #1251), this is the backlog.
- The full pre-moved and moved-during-run item list, each with its dry-run output, is in `docs/contracts/.run/contract-1-data-handoff.md` (19 items: #696, #453, #561, #212, #684, #598, #472, #1002, #241, #94, #97, #979, #553, #938, #72, #454, #1196, #1074, #1215).
- 6 open owner questions from this contract (Q1 #938, Q2 #928/#903, Q3 #70, Q5 #983 SPEC CHANGE, Q6 #195, Q7 #1223) should be resolved before their PARKED items can close; recommendations are on file in the referenced PROGRESS lines.

## 8. Process note

The last line of `contract-1-code-fixes-PROGRESS.md` as of this report is a PARKED entry timestamped 2026-09-28 08:32 IST, not the literal `CONTRACT 1 COMPLETE` marker the contract's Definition of Done requires. 63 DONE + 1 DONE-proof + 8 SKIPPED = 72 of 90 issue ids are closed or fixed-on-main; 2 are MOVED TO CONTRACT 2; 1 is MOVED TO DATA CONTRACT; 15 remain PARKED (6 behind open owner questions, the rest behind a real-world event or a 2-round review failure). This report is a read-only accounting of `PROGRESS` and does not edit it (task boundary: this worktree may read but not write that file) — writing the literal `CONTRACT 1 COMPLETE` line is the run session's own next step, once the remaining PARKED items are resolved or accepted as final.
