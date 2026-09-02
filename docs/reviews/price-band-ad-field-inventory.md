# Price Band Advertisement → database field inventory (WP C extraction contract, part 1)

Owner ask (2026-09-02 09:14 IST): "Capture every detail the IPO prints in the newspaper, not just
what the PDF extractor pulls today. Save it in the database; we will show it on the IPO detail page."

Source used: the pre-issue advertisement for **Purple Style Labs Ltd (Pernia's Pop-Up Shop)**,
Economic Times Pune, 2 Sep 2026, 2 pages (owner photographed both). This ad is the
`PRICE_BAND_AD` document type in `ipo-document-lifecycle-plan.md` stage S1, and the same content
appears in the RHP "Basis for Issue Price" and "Risk Factors" sections. So every field below is
extractable from the RHP/PBA PDF, not only from a newspaper.

## What the extractor captures today

`scraper/scripts/extract_financials_pdf.py` emits exactly six metrics per fiscal year:
`revenue`, `totalIncome`, `profit`, `eps`, `ebitda`, `netWorth`. Nothing else. And it is CLI-only
(see `ipo-pipeline-stage-gap-analysis.md` §2).

## Field inventory

Legend for "DB": **Y** = column exists · **N** = no column · **partial** = column exists but shape is wrong.
"Filled today" = written by any production code path (not CLI scripts).

### A. Issue terms (ad top block)

| # | Field on the ad | Example value | DB column | DB | Filled today |
|---|---|---|---|---|---|
| A1 | Price band floor / cap | ₹546 / ₹575 | `ipos.priceRangeMin/Max` | Y | Y (NSE/BSE) |
| A2 | Face value | ₹10 | `ipos.faceValue` | Y | Y |
| A3 | Lot size + multiple | 26 / 26 | `ipos.lotSize` (no "multiple" column) | partial | Y |
| A4 | Floor and cap as multiples of face value | 54.6× / 57.5× | — | N (derivable) | — |
| A5 | Fresh issue amount | ₹6,800.00 mn | `ipo_details.freshIssue` | Y | N |
| A6 | Offer for sale amount | nil | `ipo_details.ofsIssue` | Y | N |
| A7 | Shares at floor / at cap (fresh, OFS, total) | 12,454,212 / 11,826,086 | — | N | — |
| A8 | Post-issue market cap at floor / at cap | ₹44,056.31 / ₹46,035.12 mn | `financial_data.marketCap` (single value) | partial | N |
| A9 | P/E at floor / cap, or "not ascertainable" + reason | not ascertainable (loss) | `financial_data.peRatio` (no reason/NA flag) | partial | N |
| A10 | Weighted average RoNW, 3 years | (147.14)% | `financial_data.ronw` (single, not weighted) | partial | N |
| A11 | Issue structure: fresh only / OFS / both | fresh only | `ipo_details.issueType` | Y | N |
| A12 | Book-building vs fixed price; SEBI regulation cited | Reg 6(2) | — | N | — |
| A13 | QIB / NII / retail allocation % | ≥75 / ≤15 / ≤10 | `ipo_details.qib/nii/retailSharesOffered` (shares, not %) | partial | N |
| A14 | Designated stock exchange | NSE | — | N | — |
| A15 | Listing exchanges | BSE + NSE main board | `ipos.listingExchanges` | Y | Y |
| A16 | Employee reservation / discount | none here | `ipo_details.employeeSharesOffered/Discount` | Y | N |

### B. Timeline (ad page 2, "Indicative timetable")

| # | Field | Example | DB column | DB | Filled today |
|---|---|---|---|---|---|
| B1 | Anchor bidding date | 28 Aug 2026 | `anchor_investors.bidDate` | Y | N |
| B2 | Open / close | 31 Aug / 2 Sep | `ipos.openDate/closeDate` | Y | Y |
| B3 | Basis of allotment | 3 Sep | `ipos.allotmentDate`, `ipo_details.basisOfAllotmentDate` | Y | N (from filings) |
| B4 | Refund / unblock | 4 Sep | `ipo_details.initiationOfRefundsDate` | Y | N |
| B5 | Credit to demat | 4 Sep | `ipo_details.creditOfSharesDate` | Y | N |
| B6 | Listing | 7 Sep | `ipos.listingDate` | Y | Y (scraper) |
| B7 | UPI mandate cut-off | 5 pm on close date | `ipo_details.upiCutoffTime` | Y | N |
| B8 | Bid submission windows per investor class | table of 6 rows | `ipo_details.ipoMarketTimings` (jsonb) | Y | N |
| B9 | RHP filing date with RoC; corrigendum date | 24 Aug / 25 Aug | `documents` has no `filing_date` | N | — |

### C. Financials and KPIs (risk section + basis for issue price)

| # | Field | Example (FY26/25/24) | DB column | DB | Filled today |
|---|---|---|---|---|---|
| C1 | Profit / (loss) after tax, 3 FYs | (2,853.99) / (1,883.83) / (477.10) | `financial_data.profitFy2022..2024` | **partial — hard-coded FY2022–2024 columns; this IPO reports FY2024–2026, so two of three years have nowhere to go** | N |
| C2 | Revenue / total income / EBITDA / net worth, 3 FYs | (in RHP) | same hard-coded FY columns | partial | N |
| C3 | Net cash used in operating activities, 3 FYs | (348.95) / (451.85) / (313.44) | — | N | — |
| C4 | Debt service coverage ratio, 3 FYs | 0.08 / 0.37 / 0.27 | — | N | — |
| C5 | Rent expense, 3 FYs | 847.83 / 482.95 / 350.07 | — | N | — |
| C6 | Basic / diluted EPS | negative | `financial_data.eps` (single) | partial | N |
| C7 | Reporting unit | ₹ million | — (implicit) | N | — |
| C8 | Restated vs standalone flag | restated consolidated | `peer_companies.financialStatementType` only | N | — |
| C9 | KPI table from Basis for Issue Price (GMV, orders, etc.) | on RHP p.117 | — | N | — |

### D. Promoter and cost of acquisition

| # | Field | Example | DB column | DB | Filled today |
|---|---|---|---|---|---|
| D1 | Promoter name(s) | Abhishek Agarwal | — (only holding %) | N | — |
| D2 | Promoter shares held | 19,100,000 | — | N | — |
| D3 | Promoter WACA | ₹8.52 | — | N | — |
| D4 | WACA of shares acquired in last 1 year | nil (bonus 30 Aug 2025) | — | N | — |
| D5 | WACA last 1y / 18m / 3y, cap as X times, price range | 1.45; 396.55×; nil–234.43 | — | N | — |
| D6 | Pre-IPO placement since DRHP: yes/no | no | — | N | — |
| D7 | Promoter-group transactions ≥1% since DRHP | none | — | N | — |
| D8 | Promoter holding pre / post issue % | (in RHP) | `financial_data.promoterHoldingPre/PostIssue` | Y | N |

### E. Intermediaries

| # | Field | Example | DB column | DB | Filled today |
|---|---|---|---|---|---|
| E1 | BRLMs with SEBI reg no., contact, grievance email | Axis Capital, IIFL Capital | `ipos.leadManagers` (text/json names only) | partial | Y (names) |
| E2 | BRLM track record: issues in 3 yrs, closed below issue price | 34/4, 32/10, common 19/5 | — | N | — |
| E3 | Registrar + SEBI reg no. | KFin Technologies INR000000221 | `ipos.registrar`, `registrars` table | Y | Y |
| E4 | Company secretary / compliance officer + contact | Gulshan Mumtaz Khan | `ipo_details.complianceOfficer*` | Y | N |
| E5 | Syndicate / sub-syndicate members | Emkay + 40 brokers | — | N | — |
| E6 | Sponsor banks, escrow bank, public issue account bank | Axis Bank, ICICI Bank | `ipo_details.sponsorBanks` only | partial | N |
| E7 | Registered office, CIN, website | Mumbai; U18204MH2015PLC267215 | `ipo_details.companyAddress*`; CIN **none** | partial | N |

### F. Business and risk narrative

| # | Field | Example | DB column | DB | Filled today |
|---|---|---|---|---|---|
| F1 | One-paragraph business description | "multi-brand luxury omni-channel…" | `ipos.companyDescription` | Y | Y (Chittorgarh) |
| F2 | Risk factors: numbered list with heading + body | 14 items on the ad; full list RHP p.16 | — | N | — |
| F3 | Concentration KPIs inside risks (top-10 brands %, womenswear %, city %) | 30.24%, 77.70%, 28.42% | — | N | — |
| F4 | Objects of the issue with amounts | lease liabilities, S&M, GCP | `ipos.objectives` (jsonb) | Y | N |
| F5 | Litigation / IP dispute notices | IP licence termination notice | — | N | — |

## Summary

| Bucket | Fields on the ad | Column exists | Filled in prod today |
|---|---|---|---|
| A Issue terms | 16 | 9 (4 partial) | 4 |
| B Timeline | 9 | 8 | 2 |
| C Financials | 9 | 3 (all partial) | 0 |
| D Promoter / WACA | 8 | 1 | 0 |
| E Intermediaries | 7 | 5 (3 partial) | 2 |
| F Narrative / risks | 5 | 2 | 1 |
| **Total** | **54** | **28** | **9** |

Nine of fifty-four fields the newspaper prints reach the database today, and only from exchange
JSON, never from a filing.

## Schema changes this implies (for the WP C migration, not yet approved)

1. **`financial_data` must be keyed by fiscal year**, not hard-coded FY2022–2024 columns. New table
   `financial_statements (ipo_id, fiscal_year, basis restated|standalone, unit, revenue, total_income,
   ebitda, pat, net_worth, eps_basic, eps_diluted, op_cash_flow, dscr, rent, …)` one row per year.
   The 2022–2024 columns become a view or are migrated then dropped (gated, D1-style).
2. **`ipo_valuation`** (one row per pricing event: PBA, final): shares at floor/cap, market cap at
   floor/cap, P/E at floor/cap or `not_ascertainable_reason`, weighted-avg RoNW, face-value multiples.
3. **`promoters`** (ipo_id, name, shares_held, waca, waca_last_year, is_promoter_group) and
   **`promoter_acquisition_ranges`** (period 1y/18m/3y, waca, cap_multiple, price_low, price_high).
4. **`ipo_intermediaries`** (ipo_id, role brlm|registrar|syndicate|sponsor_bank|escrow_bank|
   public_issue_bank, name, sebi_reg_no, contact_person, phone, email, grievance_email) replacing the
   free-text `ipos.leadManagers` and `ipo_details.sponsorBanks`.
5. **`brlm_track_record`** (brlm_name, as_of_date, issues_3y, closed_below_issue_price) — sourced per
   ad; it is the same table every ad prints.
6. **`ipo_risk_factors`** (ipo_id, seq, heading, body, kpis jsonb).
7. `ipos.cin`, `documents.filing_date`, `ipo_details.designated_exchange`, `ipo_details.lot_multiple`,
   `ipo_details.allocation_pct` jsonb, `ipo_details.pre_ipo_placement bool`.

Every new row carries a `field_sources` entry with `source = PRICE_BAND_AD | RHP | PROSPECTUS`
(lifecycle plan precedence), so a later Prospectus can overwrite a PBA value per field.

## What this changes in the staged test plan

Stage 5 (extract) now has a written contract: the 54 fields above, with this ad as the expected
output for Purple Style Labs. Stage 6 (persist) needs the schema above before it can be green.
Purple Style Labs closes 2 Sep and lists ~7 Sep, so its RHP, PBA and Prospectus all appear inside
one week — a better live test IPO than Skyways.
