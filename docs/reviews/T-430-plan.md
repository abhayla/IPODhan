# T-430 plan — WP C-2 filing extractor (`extract_filing.py`)

Spec: `wp-c-extraction-contract.md` §1–§3. Fixture IPO: Purple Style Labs (RHP 24 Aug 2026,
PBA 2 Sep 2026). Both PDFs obtained by one live `DocumentDiscoveryRunner` run (BSE
`listing.bseindia.com/Download/PreAnchor/…`), stored under the gitignored
`.prospectus-acceptance/psl-1/`.

## What the two documents actually carry (read from the PDFs, not assumed)

The pre-issue **price band advertisement** is 4 pages of text-layer PDF and carries **almost the
whole A–F inventory**: cover block (A1–A16), the fresh-issue/market-cap table (A7/A8), the
indicative timetable (B1–B7), the Risk-to-Investors financial tables (C1/C3/C4/C5), Basis for
Issue Price EPS + P/E (C6), the WACA tables (D3–D5), the shareholding table (D8), the BRLM
track-record table (E2), the intermediaries block (E1/E3/E4/E7) and the concentration KPIs (F3).
So the PBA is the primary section-locator for groups A, B, D, E, F3, and for the C rows the ad
reprints. The **RHP** is used for the C group proper (restated P&L, via the existing
`extract_financials_pdf` core) and for the F2 risk-factor heading count.

## Per group: locator → method → check → fixture keys

| Group | Locator (regex anchor) | Method | Check | Fixture keys |
|---|---|---|---|---|
| A terms | cover block: `PRICE BAND: ₹ X TO ₹ Y`, `FACE VALUE OF ₹N`, `MINIMUM OF N EQUITY SHARES`, `AGGREGATING UP TO ₹A MILLION` | line regex over page text | `floor < cap`; `cap ≤ 1.2×floor`; `lot × floor ≥ 10,000`; `floor/face == printed multiple` | `price_band_floor`, `price_band_cap`, `face_value`, `lot_size`, `lot_multiple`, `floor_multiple_of_face`, `cap_multiple_of_face`, `fresh_issue_amount`, `ofs_amount`, `issue_structure` |
| A7/A8 | row `Fresh Issue …` + `Post-Issue market capitalization` under the two-price table | line regex (4 money tokens = floor shares, floor amt, cap shares, cap amt) | `shares_floor > shares_cap`; `mcap_floor < mcap_cap`; `shares × price ≈ amount ±0.5%` | `shares_at_floor`, `shares_at_cap`, `market_cap_at_floor`, `market_cap_at_cap` |
| A9/A10 | `PRICE TO EARNINGS RATIO IS NOT ASCERTAINABLE`, `WEIGHTED AVERAGE RETURN ON NET WORTH … (N%)` | regex | P/E → null reason `not_ascertainable_loss`; RoNW sign from parentheses | `pe_at_floor`, `pe_at_cap`, `weighted_average_ronw` |
| A12–A15 | `REGULATION 6(2)`, `NSE SHALL BE THE DESIGNATED STOCK EXCHANGE`, `QIB PORTION: NOT LESS THAN X%…` | regex | `qib+nii+retail ≤ 100`; book-built ⇒ `qib ≥ 50` | `book_building_regulation`, `designated_stock_exchange`, `qib_pct`, `nii_pct`, `retail_pct` |
| B timeline | `An indicative timetable`; per-event label + date on the same **or next** line (two-column newspaper layout splits "On or about" from the date) | label regex with a 1-line lookahead, date parsed to ISO | strict ordering `anchor < open ≤ close < allotment ≤ refund ≤ credit < listing`; `listing ≤ close + 5 days` | `anchor_bid_date`, `open_date`, `close_date`, `basis_of_allotment_date`, `refund_date`, `credit_date`, `listing_date`, `upi_cutoff_time` |
| B9 | cover `red herring prospectus dated <date>` | regex | `rhp_filing_date < open_date` | `rhp_filing_date` |
| C | PBA risk tables (`Profit/(Loss) after tax`, `Net cash used in operating activities`, `Debt service coverage ratio`, `Rent expenses`) + Basis-for-Issue-Price EPS rows; RHP → `extract_financials_pdf.extract_from_texts` | trailing-N money tokens aligned to fiscal years read from the `Fiscal 2026 2025 2024` header row | 3 consecutive years; same year set across rows; EPS sign == PAT sign; unit line found | `fiscal_years`, `unit`, `pat_by_fy`, `op_cash_flow_by_fy`, `dscr_by_fy`, `rent_by_fy`, `eps_basic_by_fy`, `eps_diluted_by_fy`, `financial_basis` |
| D | `Promoter` WACA row (`name shares waca nil`), `Last three years` row, shareholding table rows `Abhishek Agarwal …` | line regex / money tokens | `pre% > post%`; `cap ÷ waca_3y == printed multiple ±1%`; nil → null reason `bonus_nil` | `promoter_name`, `promoter_shares_held`, `promoter_waca`, `waca_last_1y`, `waca_last_3y`, `cap_multiple_last_3y`, `promoter_holding_pre_pct`, `promoter_holding_post_pct_at_cap`, `pre_ipo_placement` |
| E | intermediaries block: `SEBI Registration Number: INM…/INR…`; track-record table rows | regex + table row parse | `closed_below ≤ total`; per-BRLM sum ≥ total row minus common; CIN regex | `brlm_names`, `brlm_sebi_regs`, `registrar_name`, `registrar_sebi_reg`, `compliance_officer`, `cin`, `brlm_issues_3y_total`, `brlm_closed_below_total` |
| F | `WE ARE A …` cover paragraph; `contributed X%, …` concentration lines; RHP `Risk Factors` numbered headings | text / regex | description ≤ 1200 chars; `0 < pct ≤ 100`; risk count ≥ 20 (RHP) | `business_description`, `top10_brands_pct_fy2026`, `womenswear_pct_fy2026`, `mumbai_gmv_pct_fy2026`, `risk_factor_count` |

## Edge cases (§2)
`[•]` in a price-dependent cell → `null` + `not_priced_yet`. No text layer on any page →
`extraction_status = NEEDS_OCR`, no values. A check that fails → value `null`, reason
`check_failed:<check name>`, `extraction_status = PARTIAL`. Fiscal-year header unparseable → the
whole C group is skipped, never mapped onto assumed years.

## Reuse
`money_values`, `_normalize_numbers`, `detect_unit`, `extract_from_texts` are **imported** from
`extract_financials_pdf.py`, not copied.

## Tests
`tests/unit/scripts/extract-filing.test.ts`: runs the script on both stored PDFs (skipped with a
loud message when `.prospectus-acceptance/psl-1/` is absent), asserts every fixture key matches
and every emitted check passed; asserts a non-fixture field is null-with-reason. Plus three
offline negative tests on the check functions via a `--selftest` seam (category sum ≠ total →
check fails; `[•]` → `not_priced_yet`; empty text layer → `NEEDS_OCR`).
