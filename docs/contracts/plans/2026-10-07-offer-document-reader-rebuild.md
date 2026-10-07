# Offer-document reader rebuild: one generic pipeline instead of per-layout fixes

Status: APPROVED by the owner 2026-10-07 ("Rebuild, prove core first"); decision row OD-173 in
`docs/design/data-sourcing-pull-model.md` §0.0.1. LOCAL ONLY until the owner says the work is done
(owner rule 2026-10-04): no push, PR, merge to GitHub, deploy. Test DB = `ipodhan_test` only.
Branch: `test/drhp-step0-combined` (worktree `D:/Abhay/Ventures/IPODhan-IPODhan-drhp-step0`).
Handover + scratch tools: `D:/Abhay/Ventures/IPODhan-doc-cache/session-2026-10-07/`.

## Why (the loop we were in)

On 2026-10-07 the financial-statement reader needed three layout fixes (A one-line header, A2 wrapped header,
A3 peer guard), each sent back by review; reviews caught three wrong-value bugs (a note number as revenue, a
peer company's EBITDA, a ratio counted as EBITDA). Each rule fixed a few documents (A: 3 of 13 failing DRHPs,
A2: 6 of 11) and the next failures were new layouts again (a one-year KPI table preferred, a tax note taken as
the P&L, "Fiscal" on its own line). The readers are ~8,800 lines with ~240 hand-written text patterns. Coverage
rose (mainboard DRHPs reading revenue: 10 -> 18 of 21) but every new rule adds wrong-value risk.

## Two facts the current reader does not use (measured 2026-10-07, 24 documents)

1. **SEBI fixes the structure.** Every DRHP/RHP prints a TABLE OF CONTENTS with the mandated sections and page
   numbers. 20 of 24 located and verified on the first spike; the 4 misses are print variants ("TABLE OF
   CONTENT", "…" leaders, a section with no "restated" line, wrapped titles / "98 | Page" footers). PDF bookmarks
   are NOT usable: 13 of 24 have none, many others are file names.
2. **Every key number is printed several times** (SRIT EBITDA on ~10 pages, Deepa net worth on 4). A value can
   be accepted only when independent copies agree and accounting identities hold.

## The pipeline (one code path for every document of a type)

| Step | Does | Replaces |
|---|---|---|
| 1. Locate | Section map from the printed contents page + page-number offset + running headers: summary financials, restated financials, basis for offer price, capital structure, general information, objects, etc. | keyword scoring of pages per field |
| 2. Tables | Every table in a located section -> a grid (rows x columns) from word positions, once, one way | per-field re-parsing of text lines |
| 3. Interpret | One shared period-header parser (March 31 / "Fiscal YYYY" = fiscal year, other period ends = stub, dropped per D11) and ONE label dictionary with refusals ("EBITDA margin", "Debt to EBITDA", "%") (OD-172) | header logic in 4+ places, scattered label regexes |
| 4. Validate | Accept a value only if (a) >= 2 independent printed copies agree, or one copy on the restated statement passes the identities; (b) identities: revenue + other income = total income, assets = equity + liabilities, PAT <= total income; else store nothing and log why | plausibility checks only |
| 5. Save | Unchanged persister (fix S already hardened it) | - |

Rules kept: D11 (stub columns dropped; an unpairable header is not read), OD-172 (plain EBITDA), fail closed.

## Discipline that ends the loop

- Fixed answer-key set, scored automatically on every change: **wrong (must be 0)** and **found (must not drop)**,
  per field. Today: keys for 9 IPOs (NSE + 8) in `IPODhan-doc-cache/session-2026-10-07/keys/`; target 20-30
  mainboard DRHPs.
- Fast re-check: page-text + word-box cache, 24 documents in ~65 s
  (`session-2026-10-07/cache/cache-run.py`, proven identical to full PDF reads).
- Baseline to beat = the current reader with fixes A, S, A2, A3 (branch tip 7118a97b4).

## Steps (each ends with a measured proof; a failed proof stops the build around it)

1. **Core proof - section locator** -- PROVEN 2026-10-07: 24 of 24 DRHPs (incl. NSE DRHP + RHP) located and verified
   (the located PDF page opens with the section title). Handles "TABLE OF CONTENT", "…" leaders, wrapped titles,
   "98 | Page" footers, "SECTION V – FINANCIAL INFORMATION" without a "restated" line. Page offset = majority of
   (pdf index - printed page number), 300-650 votes per document (Jindal weakest: 37). Also finds the summary
   financials section where printed (6 documents). Spike: `session-2026-10-07/locate_spike.py`; results spike2.json.
2. Table grid for the located statement pages (P&L, balance sheet, cash flow) on the 24 documents; bar: every
   statement page yields a grid whose header resolves or is refused, never guessed. -- PROVEN 2026-10-07: 93
   statement pages found, 72 grids resolved, 21 refused with a reason (debt-reconciliation tables, scanned/OCR-only
   pages of Sonaselection and Swastika, Jindal spaced header letters, Orient two value columns per period, Runwal
   split brackets); keyed values 52 of 52 correct, 0 wrong; identities 40 hold, 0 fail, 8 not checkable. The OLD
   reader is wrong on 14 compared values (F-247: ARC standalone read instead of consolidated; LCC revenue 99.05 vs
   12,252.67). Open for step 3: classify mis-titled pages by row labels (LCC), garbled-font pages (Priority BS/CF),
   OCR word positions for scanned pages. Spike: `session-2026-10-07/rebuild/grid_spike.py`, report grid-report.md.
3. Shared interpreter + label dictionary; bar: on the answer-key set, wrong = 0 and found >= today's baseline.
   -- MET for statement fields 2026-10-07 (8 keyed documents, 382 keyed values): new 247 correct / 0 wrong / 135 missed
   vs today's reader 164 / 30 / 188. Revenue 46/0/0 (today 23/9/14), total income 46/0/0, PAT 46/0/0, EPS 72/0/4,
   total assets 8/0/0, reserves 6/0/2, op cash flow 23/0/7. Mutation tests: first-row-wins without the EPS
   continuing/discontinued guard writes 16 wrong (NSE 41.13 vs 41.62); net worth from equity rows writes 14 wrong
   (so net worth is NOT read from statements). NOT met for EBITDA, net worth, RoNW, total borrowing, rent: these are
   printed outside the three statements -> step 3b.
3b. Same locator + grid + dictionary for the other mandated sections that print them: "Other Financial Information"
   (accounting ratios: net worth, RoNW, EBITDA), KPI tables in "Basis for Offer Price", the capitalisation statement
   (total borrowings), notes (rent). Bar: those 5 families wrong = 0, found >= today's (EBITDA 23, net worth 20,
   borrowing 3, RoNW 6, rent 6). -- MET 2026-10-07: EBITDA 28/0/18, net worth 24/0/14, borrowing 3/0/3, RoNW 6/0/2,
   rent 18/0/0; ALL families 326 correct / 0 wrong / 56 missed vs today's reader 164 / 30 / 188 (382 keyed values,
   8 documents). Sources located by contents title: Other Financial Information, Basis for Offer Price, Capitalisation
   Statement, restated notes, and the Offer Document Summary (SEBI-mandated section of the same document; it is where
   the keys take Hero/ARC/Orient net worth and borrowings). Any two disagreeing printed values -> field refused (F-248).
   RISK: 11 wrong values were fixed while iterating against these same 8 keys, so 0 wrong is a TRAINING-SET result.
3c. BLIND HOLD-OUT (next): answer keys for 4 mainboard DRHPs the pipeline was never tuned on, built from the PDF by a
   worker that never sees pipeline output; bar: wrong = 0 on the hold-out. A wrong value there means the method is
   overfit -> fix the class, then a NEW hold-out (never re-score the same hold-out after tuning on it).
   -- HOLD-OUT 1 RESULT 2026-10-07 (Elevate, Tempsens, Varmora, Karamtara; 190 keyed values; keys built blind from PDFs):
   new 162 correct / 1 WRONG / 27 missed vs today's reader 111 / 0 / 79. Generalises, but NOT at 0 wrong:
   (a) Karamtara reserves: restated balance sheet p74/p283 prints Other equity FY2024 5,479.05 million, the Offer
   Document Summary p21 prints 5,473.87; the pipeline read only the statements and so missed the conflict (F-248 class)
   -> step 4 must compare ALL printed copies of every field before saving; (b) the "unread table" guard refused Elevate
   EBITDA over an "EBITDA %" row (a % row is never EBITDA, OD-172) -> the guard must apply the same label dictionary and
   refusals. Hold-out 1 is now USED; the next score is on hold-out 2 (four other unkeyed mainboard DRHPs).
4. Validation (copies + identities) -- BUILT 2026-10-07 in the spike: every printed copy of a field/period across all
   located sections is collected; agree -> value, one copy -> value only if its table's identities hold, disagree ->
   refused with copies listed; the unread-table guard reuses the label dictionary. Mutation tests bite (no copies check ->
   Karamtara reserves wrong; no dictionary in guard -> Elevate EBITDA refused). Also found: four spike regexes had a
   literal backspace byte where  was meant (written through a bash heredoc), so the peer skip and the OD-172 guard
   never ran; fixed. Tuning set now 346/0/36; hold-out 1 (used, info) 175/0/15.
   -- HOLD-OUT 2 (German Green, SRIT, Rentomojo, Symbiotec; blind keys with the strict all-sections conflict rule; scored
   with NO tuning): new 134 correct / 0 WRONG / 22 missed vs today's reader 69 / 0 / 87. Grey area: 14 German Green
   values the key left null as "conflict" (statement PAT vs a note labelling total comprehensive income "PAT"; statement
   basic EPS 49.27 per D8 vs a share-adjusted 7.91) - the pipeline saved the statement's values; unscored.
4. Validation (copies + identities) wired; bar: the 3 wrong-value classes from 2026-10-07 are rejected by
   construction (tests), wrong = 0, found >= baseline.
5. -- DONE 2026-10-07 (commits 629c08085..c76b0a6da, merged into test/drhp-step0-combined): modules section_locator.py,
   statement_grid.py, financial_labels.py, financial_copies.py, offer_doc_financials.py; extract_filing.py takes the
   financial fields from them (same output shapes, persister unchanged). Tier A review round fixed: quarter/half-year/
   9M headers never fiscal years; unit from the table's own header; PAT and total-borrowing identities for single
   copies; series years must be a SUBSET of the statement years; locator-failure reasons. Real reader scores: tuning
   303 correct / 0 wrong (today's reader 164 / 30); blind hold-out 2 134 / 0 (today 69 / 0). Test DB (reset, ipodhan_test):
   NSE DRHP 89/90, NSE RHP 88/90 (unchanged), AceVector DRHP 52 -> 58, Jindal DRHP 50 -> 61. 194 related tests pass.
   Not stored by design: part-year (stub) rows (financial_statements holds one row per fiscal year; D11); German
   Green net worth (no row labelled "Net worth"); values the document prints twice differently (F-248).
   Open: no single-copy identity for EBITDA, net worth, RoNW, rent, EPS, op cash flow; scanned statement pages
   (Sonaselection, Swastika) read no fiscal years so their section copies are dropped.
   Original step-5 text follows. Swap the new financial reader in behind the existing output shape; NSE DRHP 89/90 and RHP 88/90 in the test DB
   unchanged; then extend the same pipeline to other sections (capital structure / promoter tables, general
   information / lead managers, cover) in that order.
6. Only when the owner says the documents work: one GitHub PR, CI, staging run (owner rule).

Option kept for later (owner chose not now): a paid AI reader for sections the code cannot read, accepted only
if the value is printed on that page and passes step 4.

## Owner decisions that bind this plan
- 2026-10-03/04: local fix loop, subject = offer documents, fixes generic for all IPOs, ipodhan_test only.
- 2026-10-07: test on many IPOs of the same type (mainboard DRHPs); OD-172 plain EBITDA; OD-173 rebuild approach.
