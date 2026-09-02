# DEEPA pipeline walk: stage status report

Plain-words status of the per-IPO pipeline walk on Deepa Jewellers (DEEPA). Updated after every step
verdict, one stage at a time (owner instruction 2026-09-02 23:41 IST). The detailed evidence, defect
rows (W-xx) and decisions (D-xx) live in `2026-09-02-deepa-pipeline-walk.md`; this file is the summary.

Last updated: 2026-09-02 23:52 IST. Branch `docs/deepa-walk-ledger`. Nothing deployed (D-09).

## 1. Stage scoreboard (52 steps)

| Stage | What it does | Passed | Not passed |
|---|---|---|---|
| B (7) Discover the IPO on BSE/NSE | fetch boards, parse, classify, validate, match, write | 7/7 | none |
| C (5) Find the filing documents | BSE/NSE links, SEBI search, company site, classify | 5/5 | none |
| D (6) Download and store PDFs | download, dedup, store, no re-download, text check | 5/6 | D6 |
| E (10) Extract from the filings | terms, categories, financials, KPIs, objects, peers, promoters, risks, arithmetic, placeholders | 10/10 | none |
| F (6) Cross-check with websites | Chittorgarh, Moneycontrol, InvestorGain, compare, conflicts, confidence | 5/6 | F2 (not a defect) |
| G (5) Merge and write | priority merge, admin lock, write door, persist filing data, new columns | 4/5 | G5 (owner approval) |
| H (4) Live data | subscription, GMP, anchors, demand graph | 4/4 | none |
| I (6) Lifecycle | stage, due list, supersession, withdrawn, listing, purge | 4/6 | I5, I6 (not due yet) |
| J (3) Site | cache, IPO page, admin conflicts | 3/3 | none |

## 2. Not passed: what it means and the plan, in fix order

| # | Step | In plain words | Plan | Status |
|---|---|---|---|---|
| 1 | D6 text check / OCR | Some exchanges publish the price-band ad as a scanned image with no readable text. Round 1 built a reader (92814b1a); round 2 (c39ec63a) split words apart: 3 -> 30 fields recovered. Still failing: offer-for-sale amount came out as 1.0 (OCR dropped a digit and the extractor emitted it without an arithmetic check), fresh issue amount and open date null (OCR digit noise in the table and in a date). | Round 3: gate every offer-table amount on the shares x price check; read fresh amount and OFS shares from the clean prose sentence when the table fails; tolerate one noise token in dates. Pass bar: band, face, lot, fresh 2,500, OFS 11,848,340, all three dates, 50/15/35, zero wrong values. | Round 3 running (started 23:52, 30-min budget) |
| 2 | I4 leftover (W-60) | I4 passes (4a96ab7d): WITHDRAWN/POSTPONED exist, exchange signals map to them, the site never downgrades them. Hole: the scraper's merge step can still overwrite WITHDRAWN with a later "Closed". | Guard in the consolidation service; a test proving WITHDRAWN survives a later "Closed". | Queued after D6 |
| 3 | G4 persist filing data | Seven fix rounds; the DEEPA page now shows the right issue size, financials, peers, promoters, documents. Last review said "not mergeable"; round 7 (1298065a) fixed those points. | Final fresh-context Tier A review of round 7. | Queued after item 2 |
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
