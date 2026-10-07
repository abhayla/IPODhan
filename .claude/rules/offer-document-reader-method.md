# Scope: paths
paths:
  - "scraper/scripts/extract_filing.py"
  - "scraper/scripts/extract_financials_pdf.py"
  - "scraper/scripts/offer_doc_*.py"
  - "scraper/scripts/section_locator.py"
  - "scraper/scripts/statement_grid.py"
  - "scraper/scripts/financial_*.py"
  - "scraper/scripts/promoter_tables.py"
  - "scraper/scripts/page_furniture.py"
  - "scraper/scripts/general_information.py"
  - "scraper/scripts/cover_block.py"
  - "scraper/scripts/issuer_balance_rows.py"
  - "scraper/scripts/peer_*.py"
  - "scraper/tests/fixtures/offer-doc-truth/**"

# Offer-document reader: one generic pipeline, proven on answer keys, never per-layout patches

version: "1.0.0" (owner decisions OD-173 "Rebuild, prove core first" and 2026-10-07 "All three layers": the method
must be followed in every later session, enforced by a test gate, this rule and the offer-document-staging-test skill)

## Why this exists

On 2026-10-07 the reader needed three per-layout fixes in one day for one table heading; reviews caught three
wrong-value bugs in them (a note number saved as revenue, a peer company's EBITDA, a ratio counted as EBITDA), and
each rule fixed only a few documents. Scored against answer keys, the old page-guessing reader saved 30 wrong
financial values out of 194 it produced (LCC revenue 99.05 for 12,252.67; ARC standalone figures for consolidated,
F-247). The rebuilt pipeline scored 303 right / 0 wrong on the same keys and 134 / 0 on a blind set.

Plan and full history: `docs/contracts/plans/2026-10-07-offer-document-reader-rebuild.md` - read it before changing
any file this rule covers.

## The method (every section of the document goes through the same five steps)

1. **Locate** the section from the document's printed contents page (SEBI fixes the sections and their order);
   never by scoring pages for keywords. PDF bookmarks are not used (13 of 24 DRHPs have none).
2. **Clean** page furniture first (running heads, footers, page numbers incl. "85 | P a g e") by repetition across
   pages + position, never by a phrase list.
3. **Read tables as grids** from word positions; free-text blocks through the ONE shared line classifier and block
   grammar (name -> address -> contacts; out of order = refuse the block, never re-assign lines).
4. **Interpret** through one label dictionary per field family, with explicit refusals (OD-172: plain "EBITDA" beats
   "Operating EBITDA"; %, margin, ratio, "to", "/", per-share lines are never EBITDA).
5. **Validate** before saving: every printed copy of a field must agree (F-248: two well-formed copies that differ
   -> store nothing; OD-177: a copy failing its own format check is not a copy); single copies only where an
   identity holds or the spec allows it (OD-175/OD-176 for the one-year promoter cost). A missed value is acceptable;
   a wrong one is not.

## Rules for any change

- **R1 No per-layout patches.** A failing document is a sample of a class: find the step of the pipeline that
  misread it and fix that step for every document. A rule naming one company, one page or one phrase is a defect.
- **R2 The gate decides.** Run `python scraper/scripts/offer_doc_gate.py` before and after the change: wrong must stay
  0 on every answer-key set and found must not drop below `scraper/tests/fixtures/offer-doc-truth/baseline.json`.
  "NOT RUN" (cache missing) is not a pass - say so in the report. Update the baseline only when found goes UP.
- **R3 Blind sets are used once.** A change that touches extraction logic is proven on a NEW blind set: answer keys
  built from the PDFs by a worker that never sees reader output, scored cold, never tuned on. A set that has been
  scored is "used" (information only) forever after. Fetch new documents from staging (read-only) when needed.
- **R4 Two failed rounds -> independent review; a third failure -> park** (owner rules; run-discipline A1). Parked
  families keep today's reader; record the next approach in the plan.
- **R5 Ship per family.** A field family moves to the new reader only with 0 wrong on every set AND found >= today's
  reader; otherwise it stays on today's reader (record why).
- **R6 NSE is the safety check.** Every reader change ends with the test-DB proof (reset to an exact staging copy,
  real save into `ipodhan_test`): NSE DRHP 89/90 and NSE RHP 88/90 must not fall.
- **R7 Every owner answer is an OD row** in `docs/design/data-sourcing-pull-model.md`, every proven finding an F-id
  in `docs/design/findings.json` (and a failure-class file if it is a defect class), and the plan file is updated in
  the same step.
- **R8 Local only** until the owner says the documents work (owner rule 2026-10-04): no push, PR or deploy.

## CRITICAL RULES

- MUST read the plan file before editing any file in scope.
- MUST NOT add a rule for one document's layout; MUST fix the pipeline step for the class.
- MUST run the gate before and after; MUST report "NOT RUN" honestly; wrong > 0 blocks the change.
- MUST prove extraction changes on a new, never-scored blind set; MUST NOT tune on a scored set.
- MUST keep NSE DRHP 89/90 and RHP 88/90 in the test-DB proof.
