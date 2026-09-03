# DEEPA pipeline walk: stage status report

Plain-words status of the per-IPO pipeline walk on Deepa Jewellers (DEEPA). Updated after every step
verdict, one stage at a time (owner instruction 2026-09-02 23:41 IST). The detailed evidence, defect
rows (W-xx) and decisions (D-xx) live in `2026-09-02-deepa-pipeline-walk.md`; this file is the summary.

Last updated: 2026-09-03 15:50 IST (second session; the earlier "18:40" stamps above were the previous session's clock and are about 2 hours ahead of wall-clock). Branch `docs/deepa-walk-ledger`. Nothing deployed (D-09).

## 1. Stage scoreboard (52 steps)

| Stage | What it does | Passed | Not passed |
|---|---|---|---|
| B (7) Discover the IPO on BSE/NSE | fetch boards, parse, classify, validate, match, write | 7/7 | none |
| C (5) Find the filing documents | BSE/NSE links, SEBI search, company site, classify | 5/5 | none |
| D (6) Download and store PDFs | download, dedup, store, no re-download, text check | 6/6 | none |
| E (10) Extract from the filings | terms, categories, financials, KPIs, objects, peers, promoters, risks, arithmetic, placeholders | 10/10 | none |
| F (6) Cross-check with websites | Chittorgarh, Moneycontrol, InvestorGain, compare, conflicts, confidence | 5/6 | F2 (not a defect) |
| G (5) Merge and write | priority merge, admin lock, write door, persist filing data, new columns | 5/5 | none (page sections await your mockup approval) |
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
| 5 | G5 remaining ad fields | Done. Everything on the ad that has a home is now stored: 82 risk factors, RHP filing date, 18 syndicate members (migration 0047 adds the sub-syndicate role), promoter cost ranges. Litigation notices: parser present, none on DEEPA's ad. | Page sections (W-75) once you approve the mockup. | **PASS** 09:25 |
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
- 2026-09-03 08:58: W-73 closed (live-proven). W-74 parser sections running.
- 2026-09-03 09:10: IPO page mockup (W-75) published for owner approval.
- 2026-09-03 09:20: W-74 done and reproduced. W-76 (SUB_SYNDICATE enum, migration 0047) running. W-77 opened (column-aware text, after the walk).
- 2026-09-03 09:25: W-76 done (9de4828c, migration 0047). G5 PASS. Serial queue continues with the tooling rows (W-04, W-54, W-44, W-20, W-14, W-19).
- 2026-09-03 09:35: W-04 fixed (0aa8237d): the merge step no longer rejects a correct issue size when NSE's share count is net of anchors. W-54 (blank anchor names) running.
- 2026-09-03 09:45: W-54 fixed (f90fc53a; red proven by Fable). W-44 running.
- 2026-09-03 09:55: W-44 fixed (9314b3c7). W-20 running.
- 2026-09-03 10:05: W-20 fixed (9909d3c5; production confirmed on NODE_ENV=production). W-14 (validate the merged record) running, strict tier.
- 2026-09-03 10:15: W-14 fixed (17c6dcfd): a 25% band from BSE on a mainboard IPO is now caught on the merged record and kept out, with a conflict row. Strict review running.
- 2026-09-03 10:32: W-14 review: guard sound, but the provenance table could record a value that was kept out. Round 2 moves the check ahead of both write doors.
- 2026-09-03 10:45: W-14 round 2 landed (1200fc00, 76 tests reproduced). Review round 2 running. W-78 opened: the scraper's type check has 90 old errors (same class as the web lint baseline, separate PR).
- 2026-09-03 10:52: W-14 review 2: earlier holes closed, one new one (conflict row names the same source twice, a banned shape). Round 3 running. W-79 opened: make the conflicts table itself refuse that shape.
- 2026-09-03 11:00: W-14 closed (59a7f6b5; three rounds, two strict reviews). W-79 (conflicts table refuses same-source rows) running; W-19 after it.
- 2026-09-03 11:10: W-79 fixed (a7aa991e): the conflicts table now refuses same-source rows at the repository. W-19 (migration generator) running, last item in the queue.
- 2026-09-03 11:20: W-19 fixed (e3866d01): the migration generator works again and cannot overwrite the baseline. The whole tooling queue is closed. Final suites running. Known, owner-gated: 11 precision mismatches on the test DB from the gated GMP/listing migrations.
- 2026-09-03 11:30: final suites green (shared 216, web 2,383, scraper 2,354). Owner corrected W-75: no new page; plan rewritten as additions to the existing sections; nothing built until approved.
- 2026-09-03 11:45: owner asked to see the real page with the additions before approving. Building on the branch; production before-picture captured (wrong issue size and face value, eight 'awaiting data' sections). Nothing deploys.
- 2026-09-03 12:20: the real page with the additions is built on the branch (e63a3a95) and verified locally by Fable. Before/after pictures for the owner: https://claude.ai/code/artifact/637544e6-7692-4c47-9d08-74bad670168a. Four data defects visible on it (W-80 heading cut, W-81 garbled anchor names, W-82 CIN missing, W-83 lowercase company name) are being fixed one at a time before final approval. Nothing deployed.
- 2026-09-03 12:40: W-83 fixed (b836563b). Important: the lowercase-name bug is in production code today; prod rows are spared only by a thin condition that the next deploy would remove, so this fix must ship together with the branch (it does: same PR). W-80 (heading cut) running.
- 2026-09-03 13:00: W-80 fixed and verified live (82 full headings). Owner's page feedback recorded as W-85/W-86/W-87 (page) and W-88 (remaining ad fields). W-81 anchor names running.
- 2026-09-03 13:20: W-81: the anchor report's own text layer is damaged (a bad OCR layer inside the exchange's PDF), so names cannot be read correctly from it; word order fixed, and a quality gate now refuses to publish a garbled anchor list. DEEPA's anchor names will show as 'not available' until W-89 (OCR with word positions, or the exchange's own list) lands. W-82 running.
- 2026-09-03 13:40: W-82 round 1 done (column map swept); the CIN still needs a second small round because two more layers drop unknown fields. Also found: the valuation table's 'Equity shares offered' row is the fresh-issue count, not the total; it will be relabelled with the page changes and split properly under W-88.
- 2026-09-03 14:05: W-82 closed (CIN on the row). The three approved page changes (minimum investment computed + valuation relabel, lead managers to the bottom, document labels by type) are being built.
- 2026-09-03 14:40: the three approved page changes are done and verified (49bcdf8e); the before/after page is refreshed with the second run. W-90 opened (ratios file typed as a price-band ad). W-88 (remaining ad fields, incl. migration 0048 for fresh/OFS/total share counts) running.
- 2026-09-03 15:40: W-88 items 1-3 done and verified (share legs, banks, compliance contact); third page run shown at the same link. W-88b (bid windows + three small columns via migration 0049) running. Deploy bundle now includes migrations 0048 and 0049.
- 2026-09-03 16:35: W-88 complete (bid windows, regulation, promoter shares held, promoter-group transactions; migration 0049). Fourth page run at the same link. Left: W-89 anchor names (next), W-90 ratios file type, W-92 rupee glyph.
- 2026-09-03 17:20: W-89: names are now read from the page pixels when the text layer is damaged; on DEEPA that gives 3 of 15 fully right, so the list stays unpublished (totals shown) and the quality gate is being tightened so partial garbage can never publish (W-89b running).
- 2026-09-03 17:45: W-89b done: the anchor-name quality gate now catches OCR fragments, so a partly garbled list can never publish. W-90 (ratios file type) and W-92 (rupee glyph) running together as the last two small items.
- 2026-09-03 18:40: owner approved the page. W-90 and W-92 done. Other-IPO page and phone width checked; PR checks green. Final suites running. Gap review delivered to the owner.
- 2026-09-03 15:50 (new session): the final suites are green everywhere except one scraper directory that crashed the test runner on this laptop; that is fixed (W-96, forks pool, 1,021 tests pass in one run). Two CI defects found and fixed in the same commit (513d3b83): the DEPLOY WORKFLOW FILE HAD BEEN UNPARSEABLE SINCE 2 SEP (W-95; every push created a 0-second failed run and the section 6c deploy would have failed at start) and the manual test workflow could not install (W-94). The pre-commit check now parses every workflow file. ci.yml on the branch: green. Next: W-93 (tunnel keeper script), then S-02 wiring on the test DB.
- 2026-09-03 15:58: W-93 done (15edbffa): the DB tunnel keeper is now a committed dev tool (`scripts/dev-db-tunnel.ps1`, README line). Item 3 started: wiring the extract and persist steps into the scraper's own document cycle, on the test DB only, behind a new default-off flag so the coming deploy changes nothing in production; the proof run will be on Rays of Belief, a second mainboard IPO with no data on the test DB yet.
