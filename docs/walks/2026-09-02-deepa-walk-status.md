# DEEPA pipeline walk: stage status report

Plain-words status of the per-IPO pipeline walk on Deepa Jewellers (DEEPA). Updated after every step
verdict, one stage at a time (owner instruction 2026-09-02 23:41 IST). The detailed evidence, defect
rows (W-xx) and decisions (D-xx) live in `2026-09-02-deepa-pipeline-walk.md`; this file is the summary.

Last updated: 2026-09-03 01:12 IST. Branch `docs/deepa-walk-ledger`. Nothing deployed (D-09).

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
| 4 | F2 Moneycontrol | Moneycontrol's list page does not show DEEPA. Not a scraper defect. | None; noted as a coverage gap. | Closed as not applicable |
| 5 | G5 18 new columns from the ad | Needs database change W-09 (18 columns on the IPO table). | Owner approval of W-09, then migration + write. | Blocked on owner |
| 6 | I5 listing price, I6 PDF purge | Cannot run until DEEPA lists on 8 Sep and a week after close. | Run on those dates. | Not due |

## 3. After the fixes

1. Full scraper unit suite once, web unit suite once.
2. Cut the branch into pull requests as listed in the ledger section 6 (Tier A: write door, G4, step ledger, migrations 0044-0046; Tier B: the rest).
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
