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
`money_values`, `_normalize_numbers`, `extract_from_texts` are **imported** from
`extract_financials_pdf.py`, not copied. `detect_unit` (the shared module's own unit detector,
which silently defaults to `"lakhs"` when no `"in <unit>"` line is found — a numeric-alignment
convenience, not a write-gate) is deliberately NOT used for the C7 unit field: `extract_filing.py`
runs its own explicit presence check (`_find_unit`) over the cover and every other page, and
writes `unit = null` (never a default) when no unit line exists — see the round-2 fix note below.

## Tests
`tests/unit/scripts/extract-filing.test.ts`: runs the script on both stored PDFs (skipped with a
loud message when `.prospectus-acceptance/psl-1/` is absent), asserts every fixture key matches
and every emitted check passed; asserts a non-fixture field is null-with-reason. Plus three
offline negative tests on the check functions via a `--selftest` seam (category sum ≠ total →
check fails; `[•]` → `not_priced_yet`; empty text layer → `NEEDS_OCR`).

## Result, and the one locator that does NOT work yet (honest gap)

Run on the real documents: **63 of 63** fields from the price band advertisement extract with
every check passing (`extraction_status = OK`), and all 63 match the hand-transcribed fixture.
The RHP path reads its fiscal years (2026/2025/2024), unit (millions), CIN and the restated P&L;
its PAT series `(2,853.99) / (1,883.83) / (477.10)` reproduces the advertisement's table exactly —
an independent cross-document agreement, not a self-check.

**`risk_factor_count` (F2) does not extract from this RHP.** The "Risk Factors" section-range
locator finds zero numbered headings, so the check fails and the field is emitted as
`null` with `check_failed: 0 < required 20`, and the RHP run is `PARTIAL`. That is the designed
behaviour for a locator that cannot prove its answer — but it IS a gap, not a pass: the RHP's risk
headings are not the `^\d{1,3}\.\s` shape the ad's are. Next contract (WP C-3) should take the
heading shape from the RHP's table of contents rather than from the advertisement's numbering.

## Round-2 fix wave (T-430 fleet/wp-c2-filing-extractor)

- **MAJOR-1 (C7 unit gate).** `pnl.get("unit")` from the shared extractor silently defaulted to
  `"lakhs"` whenever no `"in <unit>"` line matched — so a document that never states its unit
  would still emit every C-group money field, in the wrong scale, with a passing check. Fixed:
  `extract_filing.py` now does its own explicit `_find_unit()` presence check (cover + every
  page); when absent, `unit = null` (`unit_not_stated` check fails, `extraction_status =
  PARTIAL`), and every C-group money field (`pat_by_fy`, `op_cash_flow_by_fy`, `dscr_by_fy`,
  `rent_by_fy`, `eps_basic_by_fy`, `eps_diluted_by_fy`, `eps_sign_matches_pat`,
  `revenue_by_fy`, `total_income_by_fy`, `ebitda_by_fy`, `net_worth_by_fy`) is written `null`
  with reason `unit_unknown`, regardless of whether the underlying arithmetic check would have
  passed. Covered by a synthetic negative test (P&L table present, no unit line anywhere).
- **MAJOR-2 (mcap consistency).** Market cap at floor/cap was checked only for monotonicity
  (`mcap_floor < mcap_cap`) — a self-consistent-looking pair could still be arithmetically wrong
  against the same table's own share counts. Added `check_mcap_consistency`: the pre-issue share
  count implied by `mcap/price - shares_at_price` must agree at floor and at cap within ±0.5%.
  Mutation proof (mcap_cap × 1.01 on the real PSL fixture numbers: 46,035.12 → 46,495.47): the
  unmutated pair is consistent to ~0.00001% drift; after the mutation the combined
  `market_cap_ordering_and_consistency` check FAILS — implied pre-issue shares 68,235,000 (floor)
  vs 69,035,603 (mutated cap), a 1.16% drift, over the 0.5% tolerance. Covered by an offline
  synthetic test (`mcap consistency FAILS when mcap_cap disagrees with the floor-side implied
  share count`) and re-verified directly against the real fixture — recorded in the PR.
- **MINOR (T+3 working days).** `check_timeline`'s listing-after-close gate compared calendar
  days (`> 7`); replaced with a Mon–Fri working-day count (`_working_days_between`) and a `> 3`
  bound. Holidays are NOT modeled — the exchange holiday calendar is not available to this
  offline script — documented explicitly in the function's docstring rather than silently assumed
  correct. **Follow-up for WP C-3:** wire the real NSE/BSE trading-holiday calendar so this stops
  being a weekday-only approximation.
- **MINOR (D8 promoter dilution formula).** `check_holding_dilution` only asserted `post < pre`;
  now also recomputes `post = pre × pre_shares / (pre_shares + fresh)` (deriving `pre_shares` from
  the promoter's own held-share count and pre-issue %) whenever both the promoter's share count
  and the fresh-issue share count are available, within ±1%.
- **MINOR (fixture-test skip discipline).** `extract-filing.test.ts`'s PDF-fixture-dependent tests
  now call `ctx.skip()` when the gitignored PDFs or the `python` binary are absent, instead of a
  bare `return` after a `console.warn` — a silently-passed (green, zero-assertion) test is no
  longer indistinguishable from a real pass in CI/local runs without the fixture store.

### Named, not yet fixed — WP C-3 follow-ups

- **Heading consecutiveness.** F2's risk-factor-count locator (see the RHP gap noted above) does
  not check that the numbered headings it does find are *consecutive* (1, 2, 3, … with no gaps) —
  only that there are enough of them (`check_min_count`). A heading extractor that skips a
  section (OCR noise, a merged heading) would currently pass silently as long as the total count
  clears the floor. WP C-3 should add a `check_headings_consecutive` alongside `check_min_count`
  once the RHP-shaped heading locator (noted above) is built.
- **Per-page NEEDS_OCR.** `run()` classifies a document `NEEDS_OCR` only when NO page anywhere has
  a text layer (`not any((t or "").strip() for _i, t in page_texts)`). A real prospectus can be a
  text-layer PDF with a handful of SCANNED pages mixed in (a signature page, an annexure photocopy)
  — those pages currently read as empty text and simply fail to match any locator, with no signal
  that the miss is because the page has no text layer at all versus because the locator itself is
  wrong. WP C-3 should record a per-page `needs_ocr: bool[]` alongside the existing
  document-level `extraction_status`, so a field miss on a scanned page is distinguishable from a
  field miss on a text page the locator failed to match.
