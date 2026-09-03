# DEEPA pipeline walk: stage status report

Plain-words status of the per-IPO pipeline walk on Deepa Jewellers (DEEPA). Updated after every step
verdict, one stage at a time (owner instruction 2026-09-02 23:41 IST). The detailed evidence, defect
rows (W-xx) and decisions (D-xx) live in `2026-09-02-deepa-pipeline-walk.md`; this file is the summary.

Last updated: 2026-09-03 08:50 IST. Branch `docs/deepa-walk-ledger`. Nothing deployed (D-09).

## 1. Stage scoreboard (52 steps)

| Stage | What it does | Passed | Not passed |
|---|---|---|---|
| B (7) Discover the IPO on BSE/NSE | fetch boards, parse, classify, validate, match, write | 7/7 | none |
| C (5) Find the filing documents | BSE/NSE links, SEBI search, company site, classify | 5/5 | none |
| D (6) Download and store PDFs | download, dedup, store, no re-download, text check | 6/6 | none |
| E (10) Extract from the filings | terms, categories, financials, KPIs, objects, peers, promoters, risks, arithmetic, placeholders | 10/10 | none |
| F (6) Cross-check with websites | Chittorgarh, Moneycontrol, InvestorGain, compare, conflicts, confidence | 5/6 | F2 (not a defect) |
| G (5) Merge and write | priority merge, admin lock, write door, persist filing data, new columns | 4/5 | G5 (owner approval) |
| H (4) Live data | subscription, GMP, anchors, demand graph | 4/4 | none |
| I (6) Lifecycle | stage, due list, supersession, withdrawn, listing, purge | 4/6 | I5, I6 (not due yet) |
| J (3) Site | cache, IPO page, admin conflicts | 3/3 | none |

## 2. Not passed: what it means and the plan, in fix order

| # | Step | In plain words | Plan | Status |
|---|---|---|---|---|
| 1 | D6 text check / OCR | Scanned ads had no reader at all. Four rounds built one: rapidocr reader with confidence gate (92814b1a), word splitting (c39ec63a), extractor safe against OCR digit damage with prose fallback and arithmetic gates (91164725), column-splice cut on prose (87b4ed07). | Done. Fable's own live run on the scanned DEEPA ad: 27 oracle-checked fields correct, 0 wrong numbers or dates, description true but first sentence only (the text copy outranks it). VPS needs `pip install rapidocr-onnxruntime pypdfium2` in the deploy bundle. | **PASS** 00:17 |
| 2 | I4 leftover (W-60) | Closed (f3fda19b). Strict review verdict: MERGEABLE; both mutation tests killed. | None. | **PASS** 00:35 |
| 3 | G4 persist filing data | Nine rounds in total. Final state: every table the persister writes honours admin field protection and the row lock; issue size is written only when both legs are known; refusal exits are tested at script level; two strict reviews, the second one MERGEABLE with all 6 mutations caught; the three minor edges closed in round 9 (5bcf03bd). Fable's live run on DEEPA with production flags: consolidation handled the write, no fallback, no critical conflict, 9 tables written, issue size 459.72 Cr. | Done. | **PASS** 01:12 |
| 3a | Suite fallout (W-68..W-71) | The first branch-wide scraper run found four groups the per-file runs could not see: a new local-timezone date conversion in the NSE client (real bug, same class as an old production incident); 8 document-discovery tests pinning the old chain before the company-website rung was added; 40 wiring tests whose schema mock lacks the new status enum; and a write-ratchet that scans gitignored leftover files on this laptop. | One at a time: timezone (done 19ec9636: the code was already correct, the checker's pattern was a false alarm; a four-timezone test now proves it) -> discovery tests (done b41cb971: 7 stale expectations updated, 1 real regression fixed: a SEBI outage was retried once per IPO instead of once per run) -> wiring mock (done 5bbfaeab, 89/89) -> SEBI search failure must not count as 'not listed' (done 8b7ac1a0; also stopped a thrown network error from aborting the whole run) -> ratchet reads git (done 3d1fa6df). Final scraper run by directory in progress. Then the scraper suite again by directory. | **DONE** 02:28: scraper 2,314 pass / 6 skipped / 0 fail (by directory); shared 206/206; web 2,383 pass |
| 4 | F2 Moneycontrol | Moneycontrol's list page does not show DEEPA. Not a scraper defect. | None; noted as a coverage gap. | Closed as not applicable |
| 5 | G5 remaining ad fields | Correction: the columns already exist (migration 0042 on main), so no approval is needed. What is missing is writing three of them (risk factors, promoter acquisition ranges, RHP filing date) and parsing two sections (syndicate members, litigation notices). The IPO page shows only about a third of the stored fields. | W-73 persister writers (next serial fix), W-74 parser sections, W-75 page sections after a mockup you approve. | Open, unblocked |
| 6 | I5 listing price, I6 PDF purge | Cannot run until DEEPA lists on 8 Sep and a week after close. | Run on those dates. | Not due |

## 3. After the fixes

1. Branch-wide suites (final, 02:28): scraper 2,314 pass by directory, shared 206, web 2,383. Earlier note: shared 206/206 (after fixing two stale tests that asserted WITHDRAWN was invalid, 7e782b05); web 2,383 pass / 17 skipped; scraper: the Node process crashes with a segmentation fault mid-suite (twice), so the suite is being run directory by directory to find the crashing file. Not a test failure; a native-module crash.
2. Draft PR #278 holds the whole branch as the review container. Cutting it into smaller PRs by file set (Tier A write door + migrations; Tier B scraper; docs) is the owner's call because the commits interleave.
3. Deploy everything together with owner approval (D-09).

## 4. Change log of this report

- 2026-09-02 23:41: created. F6 PASS (23:27), I4 PASS with W-60 (23:30), E5/E8/H4/G4/J2 rows corrected to the landed commits.
- 2026-09-02 23:52: D6 round 2 landed (c39ec63a, 16 pytest reproduced, 30/70 fields live) but NOT a pass: ofs_amount wrong (1.0), fresh amount + open date null. Fable read the raw OCR text and diagnosed; round 3 dispatched.
- 2026-09-03 00:05: D6 round 3 landed and reproduced by Fable (23 vitest, live run 27/27 numeric+date fields correct, 0 wrong). Only the spliced business description remains; round 4 dispatched.
- 2026-09-03 00:17: D6 PASS after round 4 (87b4ed07), reproduced by Fable (25 vitest, live run 27/27 correct). Step ledger D6/F6/I4 = DONE. Next in order: W-60 (I4 consolidation guard).
- 2026-09-03 00:25: step ledger backfill needed DATABASE_* tunnel vars (root .env points at the VPS); backfill script now prints the pg cause (dea73837). W-60 fix dispatched.
- 2026-09-03 00:30: W-60 fixed (f3fda19b, 53 tests reproduced). Worker used git stash against the brief (no damage; registry bumped). Tier A review of G4 round 7 + W-60 dispatched.
- 2026-09-03 00:40: Tier A review: W-60 MERGEABLE, G4 round 7 NOT MERGEABLE (C1 valuation protection discarded, C2 anchor path ignores scraper_locked, M1 red RHP test, M2 wiring untested). Round 8 dispatched; detection RCA written.
- 2026-09-03 00:52: G4 round 8 landed (cf662143; W-63..W-66 + two sibling gates), 79 tests reproduced. Review round 2 dispatched.
- 2026-09-03 00:58: G4 review round 2: MERGEABLE (6/6 mutations killed). Round 9 dispatched for the 3 minors.
- 2026-09-03 01:12: G4 PASS (round 9 5bcf03bd, 82 tests reproduced, live run with prod flags clean). Step ledger G4=DONE. Branch-wide suites running (final pre-PR run).
- 2026-09-03 01:32: suites: shared green after test fix, web green, scraper suite segfaults mid-run (exit 139) -> per-directory bisect running.
- 2026-09-03 01:42: scraper per-directory run: 52 failures in 4 groups (W-68..W-71); serial fixes started with the timezone one.
- 2026-09-03 01:50: W-68 closed (false alarm, test-proven). W-70 discovery-chain reconciliation running.
- 2026-09-03 02:00: W-70 done (b41cb971, 66 tests reproduced). New W-72 from that work. W-71 wiring mock running.
- 2026-09-03 02:08: W-71 done (5bbfaeab). W-72 running.
- 2026-09-03 02:15: W-72 done (8b7ac1a0, 68 tests reproduced). W-69 ratchet running, last in the queue.
- 2026-09-03 02:20: W-69 done (3d1fa6df). All suite fallout fixed. Final scraper per-directory run started. Ledger section 6b (revised end of walk) written.
- 2026-09-03 02:28: final scraper run green (2,314 pass). Walk fixes complete. Branch pushed as backup; PR cut is the next step.
- 2026-09-03 02:32: branch pushed; draft PR #278 opened as the review container (split by file set is the owner's call). Deploy waits for owner approval (D-09).
- 2026-09-03 08:40: W-09 was stale (0042 already has the schema); replaced by W-73/W-74/W-75. Owner: W-56 lint errors in a separate PR later.
- 2026-09-03 08:50: W-73 round 1 (3e896798): writers + gates; also found and closed an unprotected whole-row write of promoter acquisition ranges. Round 2 (wiring into the CLI) running.
