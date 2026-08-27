# IPO document lifecycle — which filing exists when, where to get it, what it fills

Owner ask (2026-08-27 23:59 IST): "depending on the time and stage of the IPO, documents will be available; based on that the right doc should be downloaded, read and data updated — list all scenarios and plan for them."

Precedence (verified, SEBI ICDR): **Prospectus > RHP + Corrigendum + Addenda + Price Band Advertisement > DRHP.** A later filing supersedes an earlier one *for the fields it carries*; it never blanks a field it does not carry.

Timeline notation: T = open date; T+n in working days.

## 1. Stage scenarios

| # | Stage (when) | Filings that exist | Fetch from (in order) | Fields filled / refreshed | Confidence tag written to `field_sources` |
|---|---|---|---|---|---|
| S0 | **DRHP filed** (months before; IPO not yet on exchange IPO boards) | DRHP; SEBI observation letter (later) | SEBI public-issues listing → company investor page → Chittorgarh "DRHP" link | legal name, CIN, registered office, promoters + pre-issue %, business description, industry, objects (amounts may be `[•]`), financials for the DRHP's FYs, peers, risk-factor count, BRLMs, registrar | `DRHP` (provisional — every number can change in the RHP) |
| S1 | **RHP filed with RoC** (T−7 … T−3) | RHP; Price Band Advertisement (T−5 … T−3); sometimes Corrigendum | **BSE `GetMkt_ISSUE_BBS_IPO?IPO_NO=`** (has RHP, PBA, corrigendum, addendum links + band, lot, FV, tick, timings, 3 BRLMs) → NSE `ipo-detail` issueInfo (retry ×3) → company host → Chittorgarh | everything from S0 refreshed to RHP values; **fresh/OFS shares, category reservation, objects with ₹, timeline dates, FY set rolls forward (Skyways: FY22–24+stub → FY24–26)**; from PBA: band, lot, min investment, ₹ issue size at floor/cap, P/E floor/cap, market cap, KPI table | `RHP` for RHP fields; `PRICE_BAND_AD` for price-dependent fields; `[•]` in RHP ⇒ "not yet priced", never an error |
| S2 | **Anchor day** (T−1) | Anchor allocation report; security parameters pre/post-anchor; possibly Addendum | BSE `Anchor_Details` → NSE issueInfo ("Anchor Allocation Report") → BRLM site | anchor investors (names, shares, ₹, %), net offer after anchor, MF/insurer sub-portions | `ANCHOR_REPORT` |
| S3 | **Open** (T … T+2/3) | Addenda (litigation/regulatory updates); Corrigendum if dates move (Skyways: close 26→27 Aug) | BSE `Addendum`/`Corrigendum` fields → NSE → company host | dates re-read from the newest Corrigendum; addenda stored as documents (no field change unless they amend offer terms); live subscription/GMP are NOT filings (NSE/BSE/InvestorGain as today) | `CORRIGENDUM` outranks `RHP` for dates |
| S4 | **Closed → basis of allotment** (close … T+1) | Basis-of-allotment advertisement / registrar report; **final Prospectus** filed with RoC (close … T+2) | BSE `Prospectus_GID` changes to Prospectus / NSE issueInfo "Prospectus" → registrar → company host | **final price**; issue size at final price; post-issue promoter %; post-issue paid-up capital; allotment ratios per category; oversubscription; all price-dependent KPIs recomputed at final price; GCP amount; offer expenses | `PROSPECTUS` (final) — highest; overwrites RHP/PBA values for every field it carries |
| S5 | **Listing** (T+3) | Listing circular (exchange); ISIN active | NSE quote API / BSE scrip page (as today via `listing-performance-updater`) | listing price, gain, `bse_scrip_code`, ISIN confirmed | `NSE`/`BSE` live |
| S6 | **Post-listing** (T+3 … T+10) | nothing new for our fields | — | status LISTED; **delete local PDFs 7 days after `close_date` (D4)**; keep `documents` rows + extracted data; lock-in / results out of scope | — |

## 2. Edge scenarios the job must handle

| # | Scenario | Behaviour |
|---|---|---|
| E1 | IPO first seen by us **after** it opened (late discovery, common for SME) | Run S0→S3 catch-up in one pass, newest filing first; never let an older filing overwrite a newer one (compare filing dates, not fetch order) |
| E2 | Filing **superseded** (Corrigendum after RHP; Prospectus after RHP; 2nd Addendum) | Insert a new `documents` row with `sequence_number+1`; set `is_active=false` on the superseded one; re-extract only the fields the new filing carries; log old→new per field in `field_sources.previous_value` |
| E3 | RHP prints `[•]` for a price-dependent field | Leave the field untouched; mark extraction PARTIAL with reason "not priced yet"; the PBA/Prospectus fills it later. Never write 0 or null over an existing value |
| E4 | Document is a **scanned image** (Price Band Ad, Corrigendum with broken fonts) | Text layer empty ⇒ OCR path (tesseract) for the 1–2 pages that matter; if OCR confidence < threshold, keep the exchange-API value (BSE/NSE band, dates) and flag for admin |
| E5 | Chapter has **no text layer** (Skyways restated financials, 100 pages) | Read the MD&A / Basis-for-Offer-Price duplicates; if a value exists in neither, leave null and record `missing_in_filing` — no guessing |
| E6 | Source **bot-blocked / timeout** (NSE 403 / 15 s) | Fallback chain BSE → NSE (retry ×3, backoff) → company host (from RHP cover "website") → Chittorgarh; a doc-less OPEN/UPCOMING IPO is retried every 30-min cycle, not once a day |
| E7 | **Same document type on both exchanges** (BSE and NSE host the RHP) | Dedup by SHA-256, not URL; store one row, keep both URLs in lineage |
| E8 | **Dates change** (Corrigendum) after we wrote them from NSE | Filing-derived dates outrank scraper dates; a mismatch raises a CRITICAL conflict, never "converged" |
| E9 | Filing table **mis-parses** (pdftotext shifts the category table one row) | Every extracted table carries an arithmetic check (categories sum to total; anchor = 60 % of QIB; fresh + OFS = total); a failed check discards that table's values and flags the doc |
| E10 | IPO **withdrawn / postponed** | Exchange status flips (BSE `Status`, NSE); set status WITHDRAWN/POSTPONED, keep documents, stop fetch schedule, delete PDFs per D4 from the withdrawal date |
| E11 | **SME** IPO (NSE Emerge / BSE SME) | Same stages; NSE needs `series=SME`; BSE SME uses the same IPO API; SME RHPs are smaller and more often scanned — OCR path expected more often |
| E12 | DRHP exists but **no RHP yet** for months (SEBI observation pending) | Show DRHP-sourced fields with a visible "from DRHP — may change" badge; do not compute P/E or market cap (no price) |
| E13 | **Backfill of existing IPOs** (129 documents PENDING today; 3/63 August IPOs have any doc) | One-time catch-up job runs S0→S5 for every IPO with status ≠ LISTED older than 10 days is skipped (PDFs gone), LISTED within 10 days gets Prospectus only; budget 1 IPO per cycle so the 30-min scrape is never starved |
| E14 | Our own **type classifier** mislabels (today: "Prospectus" → RHP; Price Band Ad → ADDENDUM) | Fix the classifier: `PROSPECTUS` only when the title lacks "red herring"/"draft"; add `PRICE_BAND_AD` and `CORRIGENDUM` enum values; regression test on the Skyways BSE payload |

## 3. What is due at each stage — extends the existing `stage-reconciler`

`scraper/src/scheduler/stage-reconciler.ts` already derives `UPCOMING | PRE_OPEN | OPEN | CLOSED | LISTED` and lists due-but-missing fetch kinds (currently §GATE-off, dry-run). The plan extends it rather than adding a second machine:

- New `FetchKind`s: `DOC_DRHP`, `DOC_RHP`, `DOC_PRICE_BAND_AD`, `DOC_CORRIGENDUM`, `DOC_ANCHOR_REPORT`, `DOC_PROSPECTUS`, `EXTRACT_<same>`.
- Due map: UPCOMING → DRHP; PRE_OPEN → RHP, PBA, anchor report; OPEN → corrigendum/addenda re-check every cycle; CLOSED → Prospectus (re-check every cycle until found or T+5); LISTED → nothing new; +7 days after close → `PURGE_PDFS`.
- "Missing" = no active `documents` row of that type, or one whose `extraction_status ≠ DONE`.
- Activation stays the owner's §GATE (`ENABLE_STAGE_RECONCILER`, `ENABLE_DRHP_EXTRACTION`), per `owner-gated-feature-flags.md`.

## 4. Implementation plan (replaces WP2/WP4 of `skyways-implementation-plan-draft.md`)

| WP | Deliverable | Test (red → green) | Detection upgrade (nightly audit) |
|---|---|---|---|
| A | **Discovery, BSE-first**: consume the BSE core API per IPO_NO (all links, all 3 BRLMs, tick, timings); NSE with retry ×3; company-host + Chittorgarh fallback; classifier fix (E14); SHA-256 dedup (E7); every 30-min cycle for doc-less OPEN/UPCOMING | Skyways BSE payload fixture → 4 docs typed RHP/CORRIGENDUM/ADDENDUM/PRICE_BAND_AD + 3 BRLMs; timeout fixture → retried, then falls back | FAIL if any OPEN IPO has 0 active documents; FAIL if BRLM count < BSE payload |
| B | **Stage reconciler extension** (§3) + `PURGE_PDFS` step with `PROSPECTUS_RETENTION_DAYS=7` (D4) | stage→due-kind table; purge deletes dir dated close+8, keeps close+6 | WARN on any document PENDING > 48 h; FAIL if an IPO listed > 3 days has RHP but empty `financial_data` |
| C | **Extractor wired into the cycle** (1 IPO per cycle, flag-gated): precedence Prospectus > Corrigendum > PBA > RHP > DRHP per field; `[•]` handling (E3); arithmetic checks (E9); OCR path (E4); supersession (E2); writes `ipo_details`, `financial_data`, `peer_companies`, objectives, ISIN, lead managers, timeline, promoter holding, contact | Skyways RHP/Corrigendum/PBA text fixtures → exact values in `skyways-rhp-values.md`; category-table shift fixture → discarded + flagged | as B; plus FAIL if a Prospectus exists and any price-dependent field still carries `PRICE_BAND_AD` source after 48 h |
| D | **Resolver rules**: filing-derived dates/issue size outrank scrapers; BSE issue size is net-of-anchor (convert before compare); status CLOSED from 17:00 IST; > 5 % gap never "converged" | Skyways numbers reconcile; 30 % gap → CRITICAL | FAIL if any IPO OPEN past 17:00 IST on close_date |
| E | **Page + schema**: subscription breakdown views; "Awaiting data" lists only fillable sections; DRHP-provisional badge (E12); `computed` badge for derived promoter %; migration 0033; prune dead columns; single lead-manager path; null-value never records a source | component tests | audit check that every rendered filing field has a `field_sources` row with a non-null value |
| F | **Backfill** (E13) run once after A–D land, 1 IPO/cycle, then the Skyways page re-audited: target = every Skyways unit's Final value shows on the page | re-run this audit on the next closing IPO | recurrence table = 0 |

Order A → B → C → D → E → F. One PR each (< 400 lines), Sonnet implementer for A/B/D/E (clear spec + tests), Opus for C (multi-file design), Opus fresh-context review on all, Fable verifies + lands. Production flags stay OFF until the owner flips them (§GATE); backfill F runs only after that.

## 5. Skyways today (2026-08-28) mapped onto the stages

S0 ✔ DRHP (30 Jun 2025) · S1 ✔ RHP 11 Aug + PBA 14 Aug + Corrigendum 12 Aug · S2 ✔ anchor day 21 Aug (report not yet fetched) · S3 ✔ Addenda 24 + 26 Aug · **S4 ← now**: basis of allotment 28 Aug, Prospectus expected 28–31 Aug (not published at 23:50 IST 27 Aug) · S5 listing 1 Sep · S6 purge PDFs 3 Sep.
