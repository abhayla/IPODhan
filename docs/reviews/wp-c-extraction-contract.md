# WP C — extraction contract (stage 5 of the test ladder), part 2

Part 1 is `price-band-ad-field-inventory.md` (54 fields, what the DB has today). This part says,
for each field group: **which document and section carries it, how it is extracted, and the
arithmetic check that must pass before the value may be written.** Fixture IPO: Purple Style Labs
(RHP filed 24 Aug 2026, PBA 2 Sep 2026, Prospectus expected ~4 Sep 2026). A field with no passing
check is written as `null` with `field_sources.reason = 'check_failed'`, never as a guess (E3/E9).

Precedence per field: PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP (lifecycle plan §1).
Every write carries `field_sources.source` and the page number it came from.

## 1. Where each group lives, and how it is read

| Group | Document | Section (RHP TOC name) | Method | Arithmetic / plausibility check |
|---|---|---|---|---|
| A Issue terms | PBA / RHP cover | cover page + "The Offer" | regex over page text (cover is always text) | floor < cap; cap ≤ 1.2×floor mainboard (≤1.4× SME); lot × floor ≥ ₹10,000 mainboard; shares_at_floor × floor ≈ fresh_issue_amt ±0.5% |
| A7/A8 shares & market cap at floor/cap | PBA | table "details of the Fresh Issue and post-issue market capitalisation" | pdfplumber table, 2 price columns | shares_floor > shares_cap; mcap_floor < mcap_cap; mcap = post_issue_shares × price ±0.5% |
| A13 allocation % | RHP | "The Offer" / "Offer Structure" | regex on "not less than X%", "not more than Y%" | QIB+NII+Retail ≤ 100; book-built: QIB ≥ 50 or 75 |
| B Timeline | PBA / RHP | "Indicative timetable" / "Bid/Offer programme" | table or "Event … on or about DATE" regex | anchor < open ≤ close < allotment < refund ≤ credit < listing; listing ≤ close + 3 working days (T+3) |
| B9 filing dates | BSE API / RHP cover | cover: "Dated <date>" | regex; BSE payload field when present | RHP date < open date |
| C1–C2 P&L, 3 FYs | RHP | "Restated Consolidated Statement of Profit and Loss" (fall back to "Summary of Financial Information") | existing `extract_financials_pdf.py` column-aligned rows; fiscal years read from the header row, never assumed | years are consecutive; revenue ≥ 0; unit line ("₹ in million/lakhs/crore") found and applied; PAT sign consistent with the Risk Factors table when both present |
| C3 op cash flow | RHP | "Restated Consolidated Statement of Cash Flows" row "Net cash (used in)/generated from operating activities" | same extractor, new row pattern | 3 years, same year set as C1 |
| C4 DSCR, C5 rent, C6 EPS | RHP | Risk Factors tables + "Other Financial Information" | row-pattern extractor | DSCR = EBITDA-ish / debt service per the footnote; EPS sign = PAT sign |
| C7 unit, C8 basis | RHP | table header line | regex | required for any C write |
| C9 KPIs | RHP | "Basis for Offer Price" → KPI table | table extraction | KPI names from the RHP verbatim; numeric cells only |
| D Promoter & WACA | RHP / PBA | "Basis for Offer Price" → "Weighted average cost of acquisition" tables | table extraction, 2 tables (promoter; 1y/18m/3y) | cap ÷ WACA = printed multiple ±1%; nil → null with reason 'bonus_nil' |
| D8 promoter holding pre/post | RHP | "Capital Structure" → shareholding table | table | post < pre when fresh issue; post = pre×pre_shares/(pre_shares+fresh) ±1% |
| E1/E2 BRLMs + track record | PBA / RHP | "General Information" (BRLMs) + PBA table "public issues in past 3 years" | BSE payload first (names, `#`-split); table for track record | track record: closed_below ≤ total; common issues counted once |
| E3–E7 intermediaries, CIN, office | RHP cover / "General Information" | regex on labelled lines | CIN matches `^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$` |
| F1 business description | RHP | "Summary of Business" first paragraph | text | ≤ 1,200 chars |
| F2 risk factors | RHP | "Risk Factors" numbered headings | heading regex `^\d{1,3}\.\s` per page in the section range | count ≥ 20 mainboard; headings unique; numbers consecutive |
| F3 concentration KPIs | RHP | inside F2 bodies | regex on "% of … GMV/revenue" | 0 < pct ≤ 100 |
| F4 objects with amounts | RHP | "Objects of the Offer" table | table | sum of objects + GCP ≈ net proceeds ±1%; GCP ≤ 25% of gross |
| F5 litigation notices | RHP | "Outstanding Litigation" summary table | table | counts only; no free text |

## 2. Document-shape edge cases (E4/E5) that the extractor must classify, not guess

- No text layer on the page (scanned): record `extraction_status = NEEDS_OCR`, do not write values. OCR is a later stage.
- Section header found but table parse fails the arithmetic check: write nothing for that table, log the check that failed, `extraction_status = PARTIAL`.
- `[•]` in any price-dependent cell: leave null, reason `not_priced_yet` (E3).
- Fiscal-year header not parseable: write nothing for the C group; never map to FY2022–2024 columns.

## 3. Fixture and expected output (stage 5 test)

- Input: the Purple Style Labs RHP and PBA PDFs discovered by the T-403 state machine (FOUND rows).
- Expected: `docs/reviews/fixtures/purple-style-labs-expected.json`, transcribed from the PBA
  (values in `price-band-ad-field-inventory.md` tables A–F). The test asserts every extracted
  field equals the expected value, and every arithmetic check in §1 passes. Any field not in
  the fixture must be `null` with a reason, never a value.
- Second fixture later: Skyways (superseded filings) for stage 7.

## 4. Schema this needs (Tier A, one migration, non-destructive)

From the inventory doc §"Schema changes": `financial_statements` (per fiscal year),
`ipo_valuation`, `promoters` + `promoter_acquisition_ranges`, `ipo_intermediaries`,
`brlm_track_record`, `ipo_risk_factors`; plus `ipos.cin`, `documents.filing_date`,
`ipo_details.designated_exchange / lot_multiple / allocation_pct / pre_ipo_placement`.
Existing `financial_data` FY2022–2024 columns stay until a gated drop; the new tables are the
write target for WP C.

## 5. Dispatch plan (after T-405 lands)

| Contract | Tier | Model | Budget | Scope |
|---|---|---|---|---|
| WP C-1 schema | A | Sonnet from §4 as spec | 60 min / 120 | migration + schema.ts + repositories, journal replay in CI green |
| WP C-2 extractor | A | Opus | 60 min / 120 | `extract_filing.py` per §1 with checks, fixture test from §3 |
| WP C-3 persist | A | Opus | 60 min / 120 | stage-6: write through `upsertIPO` precedence with `field_sources`, wire into the cycle behind `ENABLE_DRHP_EXTRACTION`-successor flag `ENABLE_FILING_EXTRACTION` (default OFF) |
