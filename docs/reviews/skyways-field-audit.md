# Skyways Air Services IPO — per-field source audit

Owner-driven audit, started 2026-08-27. One IPO, every field the detail page renders.
Owner picks an option per field; decisions are recorded here; implementation follows as one batch.

- IPO: **Skyways Air Services Ltd.** — slug `skyways-air-services-ltd`, id `8340f7fc-9bec-4c4e-94a1-4a7502d4b706`, NSE `SKYWAYS`, mainboard, open 24 Aug 2026, close 27 Aug 2026.
- Page: https://ipodhan.com/ipos/skyways-air-services-ltd (snapshot 2026-08-27 20:55 IST).
- Truth source: DRHP + RHP PDFs fetched fresh (URL + SHA-256 recorded in §2).

## 0. Standing decisions (owner)

| # | Date | Decision |
|---|------|----------|
| D1 | 2026-08-27 | Scope = Skyways only; every rendered field incl. derived values and the status badge. |
| D2 | 2026-08-27 | DRHP/RHP fetched fresh, URL + hash recorded; values quoted with page numbers. |
| D3 | 2026-08-27 | Decisions are recorded per field; code changes ship as ONE planned batch afterwards. |
| D4 | 2026-08-27 | **PDF retention:** prospectus PDFs for new IPOs are kept on disk for **7 days after `close_date`**, then the files are deleted. Extracted data and `documents` rows (URL, type, hash) stay. *(Assumption: retention is measured from close_date, not download date; if an IPO's close_date moves, the clock moves with it.)* |

## 1. Root cause summary (verified 2026-08-27)

Two pipelines, both failed for Skyways:

1. **Document discovery** (`scraper/src/scripts/backfill-primary-source-documents.ts`, enabled in prod via `ENABLE_PRIMARY_SOURCE_DISCOVERY`, 24 h cadence): ran 25 Aug and 26 Aug; both times `fetchNSEIssueInfo(SKYWAYS) timed out after 15000ms — skipping` (no retry, 15 s hard cap). Same batch: Annu/ABH/Sumax got docs; Skyways/Hy-Tech/Symbiotec/Madhur got none. Only 3 of 63 IPOs opened in Aug 2026 have any document row.
2. **Extraction**: never runs in prod. All 129 `documents` rows are `extraction_status = PENDING` (incl. 16 RHPs). `drhp-orchestrator.ts` has zero callers; `ENABLE_DRHP_EXTRACTION` never set; `drhp-downloader.ts` queries non-existent endpoints (`nseindia.com/api/ipo-drhp`, `bseindia.com/api/ipo-drhp`, `sebi.gov.in/api/drhp-filings`).

Consequence: `ipo_details`, `financial_data`, `anchor_investors`, `peer_companies`, `documents`, `ipo_scores`, `ipo_reviews`, `listing_performance` all 0 rows for Skyways → 8 sections show "Awaiting data".

Prod lineage (`field_sources`): 18 fields have a recorded source, all NSE / BSE / CHITTORGARH, none DRHP.

Other verified defects seen on this IPO:
- Status badge "Open Now" at 20:55 IST on close day. `status-updater-service.ts` is date-only and uses the UTC date → flips to CLOSED at 05:30 IST next day; bidding actually closes 17:00 IST. `data_conflicts` logs NSE "OPEN" vs Chittorgarh "CLOSED" every 30 min; NSE wins by priority.
- `issueSize`: NSE 5,828,000,000 vs BSE 4,082,536,800 every cycle, labelled `AUTO_RESOLVED_VALUES_CONVERGED` (they did not converge).
- `isin`: `field_sources` says CHITTORGARH, value is null.
- `gmp_records` has 203 rows (latest 44.00 / 31.88%) but `ipos.gmp*` columns are null; page reads `gmp_records` directly so it still renders.
- `scraper_steps` table absent in prod (migration 0033 / T-340 not applied).

## 2. Documents obtained

_(pending — RHP/DRHP fetch running)_

## 3. Field-by-field audit

Legend — **Src** = what actually wrote the value in prod (`field_sources` row, or code path); **RHP** = value in the RHP (page no.), ⏳ = extraction pending; **Rec** = my recommendation, options lettered; **Owner** = your pick (blank = not yet decided).

Fields are grouped into decision units (one unit = one turn). 290 rendered entries collapse into 36 units because entries in a unit share one source and one fix.

### Unit 1 — Status badge ("Open Now")
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Open Now" at 20:55 IST on close day | `ipos.status` = NSE (conf 100). Chittorgarh says CLOSED every cycle; NSE outranks it. `status-updater-service.ts` is date-only + UTC date, flips at 05:30 IST next day. | RHP gives close date 27 Aug + bid closing time (page ⏳) | Status is derived, not a PDF field. The bug is the flip rule, not the source. |

**Rec:** (a) **flip to CLOSED at 17:00 IST on close_date** (IST-aware state machine; also stop letting NSE's stale "OPEN" beat a date-derived CLOSED in the conflict resolver); (b) keep date-only but use IST midnight (still wrong 7 h/day); (c) leave as-is. Recommend **(a)**.
**Owner:** —

### Unit 2 — Company name / symbol / segment / offering type (header)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Skyways Air Services Ltd." · SKYWAYS (NSE) · MAINBOARD · IPO | NSE (conf 100/95) via `field_sources` | ⏳ (legal name on cover) | NSE listing page is a fine primary for identity; matrix order ADMIN>NSE>BSE>DRHP. |

**Rec:** (a) **keep NSE as primary**; RHP fills CIN/legal name in `ipo_details` (Unit 30); (b) make DRHP primary for name. Recommend **(a)** — the exchange record is authoritative and exists before the RHP.
**Owner:** —

### Unit 3 — Price band (₹131–₹138)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹131 – ₹138 | NSE (conf 95), set 20 Aug | ⏳ (RHP / price-band advertisement) | Price band is NOT in the DRHP; it appears in the RHP / price-band ad. Matrix ADMIN>NSE>BSE>DRHP — correct order. |

**Rec:** (a) **keep NSE primary; add RHP as verifier** (raise a conflict if RHP band ≠ NSE band); (b) no change. Recommend **(a)**.
**Owner:** —

### Unit 4 — Lot size (100) and Min. Investment (₹13,800)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| 100 shares · ₹13,800 = 100 × ₹138 (derived in page) | `lotSize` = BSE (conf 90), 23 Aug | ⏳ | Matrix ADMIN>BSE>NSE>DRHP. Min investment is computed, never stored. |

**Rec:** (a) **keep; add RHP cross-check**; (b) store min_investment in `ipo_details` from RHP. Recommend **(a)** — derived is safer than a second stored copy.
**Owner:** —

### Unit 5 — Issue size (₹582.80 Cr)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹582.80 Cr | NSE (conf 100). BSE says 4,082,536,800 (₹408.25 Cr) every cycle; conflict auto-labelled "converged". | ⏳ (fresh + OFS at upper band) | Matrix ADMIN>NSE>BSE>CHITTORGARH. RHP never consulted. NSE vs BSE differ by ₹174 Cr. |

**Rec:** (a) **RHP / price-band ad primary for issue size at upper band, NSE second**, and fix the resolver so a 30 % gap is never marked "converged"; (b) keep NSE, fix only the resolver label; (c) show both. Recommend **(a)**.
**Owner:** —

### Unit 6 — Face value (₹10)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹10 | NSE (conf 100) | ⏳ | Matrix ADMIN>NSE>BSE>CHITTORGARH; DRHP not listed although it is the canonical source. |

**Rec:** (a) **add DRHP to the source list as verifier**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 7 — Open / Close dates
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| 24 Aug – 27 Aug 2026 | NSE (conf 100) | ⏳ (RHP cover / price-band ad) | DRHP has no dates; RHP does. Matrix excludes DRHP correctly. |

**Rec:** (a) **keep NSE; RHP verifier**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 8 — Allotment / Refund / Credit / Listing dates (timeline + details table)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Allotment 28 Aug, Listing 1 Sept; Refunds & Credit-of-shares rows **blank** | allotment/listing = NSE (conf 100). Refund + credit dates live in `ipo_details` (0 rows) → blank. | ⏳ (RHP "tentative timeline" table lists all five) | `ipo_details` is filled only by DRHP/RHP extraction, which never runs. |

**Rec:** (a) **extract the full tentative-timeline table from the RHP into `ipo_details`** (basis, refund, credit, listing); (b) scrape from Chittorgarh instead. Recommend **(a)**.
**Owner:** —

### Unit 9 — Registrar (Bigshare) and allotment-check link
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Bigshare, link healthy | NSE (conf 100) → `registrar_id` resolved | ⏳ | Fine. |

**Rec:** (a) **keep**; RHP as verifier only. Recommend **(a)**.
**Owner:** —

### Unit 10 — Lead managers
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Holani Consultants, Shannon Advisors (`ipos.lead_managers`) | NSE (conf 100) | ⏳ | Matrix lists DRHP first, but DRHP never runs, so NSE filled it. A second copy `ipo_details.lead_managers` exists and is empty (two data paths — drift risk). |

**Rec:** (a) **RHP primary (as the matrix already says), NSE fallback; remove the duplicate `ipo_details.lead_managers` path**; (b) keep NSE only. Recommend **(a)**.
**Owner:** —

### Unit 11 — Listing exchanges (NSE, BSE)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| NSE, BSE | CHITTORGARH (conf 80) | ⏳ | RHP cover states it; aggregator used because no primary path. |

**Rec:** (a) **RHP primary, Chittorgarh fallback**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 12 — ISIN (not shown)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| hidden (null) | `field_sources` says CHITTORGARH conf 80 — but the value is null (a source row was written for an empty value) | ⏳ (RHP cover / "Terms of the Offer") | Nothing that runs reads the RHP. |

**Rec:** (a) **RHP primary; fix the writer so a null value never records a source**; (b) leave hidden until listing. Recommend **(a)**.
**Owner:** —

### Unit 13 — GMP (₹44, +31.9%) + GMP history chart
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹44 (+31.9%), 30-day chart, min/max/avg | `gmp_records` from INVESTORGAIN_GMP (203 rows). `ipos.gmp*` columns null — page reads `gmp_records` directly. | n/a — grey market is not in any filing | Not a PDF field. |

**Rec:** (a) **keep; either drop the dead `ipos.gmp*` columns or make the writer fill them** (one, not both); (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 14 — Subscription (71.25x; QIB/NII/Retail; bNII/sNII; shares bid/offered)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Overall 71x + trend chart. Category / heat-map views **unreachable** (`showAdvanced` never passed). | `subscriptions` table, NSE (30-min). | n/a (live data) | Not a PDF field. |

**Rec:** (a) **enable the category breakdown views** (data already there: QIB 139.69x, NII 87.24x, Retail 25.40x); (b) leave overall only. Recommend **(a)**.
**Owner:** —

### Unit 15 — Lot Details table (Retail min/max, S-HNI, B-HNI)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Computed from lot × band (`computeBidTiers`) | derived | ⏳ (RHP bid-lot / maximum-bid rules) | Derived from regulatory caps; correct as long as Units 3–4 are right. |

**Rec:** (a) **keep derived**; (b) store from RHP. Recommend **(a)**.
**Owner:** —

### Unit 16 — Issue structure (fresh vs OFS, shares offered) — SECTION MISSING
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Awaiting data" | `ipo_details.fresh_issue / ofs_issue` empty; matrix `fresh_issue_size` = ADMIN>NSE>DRHP>BSE but the NSE scraper does not emit it | ⏳ (RHP cover + "The Offer" table) | Extraction never runs (§1). |

**Rec:** (a) **RHP extraction fills it** (cover table is deterministic); (b) Chittorgarh fallback. Recommend **(a)** with (b) as fallback.
**Owner:** —

### Unit 17 — Category reservation (QIB/NII/Retail/Employee shares + %, anchor portion) — SECTION MISSING
Same root cause as Unit 16 (`ipo_details.*_shares_offered`). RHP ⏳. **Rec:** (a) RHP extraction. **Owner:** —

### Unit 18 — Objects of the issue — SECTION MISSING
`ipos.objectives` null; matrix ADMIN>DRHP>CHITTORGARH. RHP ⏳ ("Objects of the Offer" table). **Rec:** (a) RHP extraction (table with ₹ amounts), Chittorgarh fallback. **Owner:** —

### Unit 19 — Company overview / description / industry / sector — SECTION MISSING
`companyDescription`, `industry`, `sector` all null. `sector` is starved by the phantom `data.sector` field (#242); `industry`/description declare DRHP first. RHP ⏳ ("Our Business"). **Rec:** (a) RHP extraction for description + industry; fix #242 for sector from NSE. **Owner:** —

### Unit 20 — Financials (revenue/PAT/net worth/EBITDA ×3 FY, KPIs, ratios: EPS, P/E, RoNW, D/E, ROCE, P/B, market cap) — SECTIONS MISSING (Financial charts + KPI highlights)
`financial_data` 0 rows; matrix declares DRHP first for every one of these. RHP ⏳ ("Summary of Financial Information" + "Basis for Offer Price"). **Rec:** (a) RHP extraction — the existing pdfplumber extractor (C3b, 144 IPOs in June) proves it is deterministic; wire it. **Owner:** —

### Unit 21 — Promoter holding pre/post — SECTION MISSING
`financial_data.promoter_holding_*` empty. RHP ⏳ ("Capital Structure"). **Rec:** (a) RHP extraction. **Owner:** —

### Unit 22 — Anchor investors — SECTION MISSING
`anchor_investors` 0 rows. Source is NOT the RHP — it is the exchange "Anchor allocation report" PDF (discovery already knows the type `ANCHOR_ALLOCATION_REPORT`). Skyways' was never discovered (timeout). **Rec:** (a) fix discovery (Unit 33) + extract the anchor report. **Owner:** —

### Unit 23 — Peer comparison — SECTION MISSING
`peer_companies` 0 rows; RHP ⏳ ("Basis for Offer Price — comparison with listed peers"). **Rec:** (a) RHP extraction (peer table with P/E, EPS, RoNW). **Owner:** —

### Unit 24 — Documents list (RHP/DRHP/addenda links) — SECTION MISSING
`documents` 0 rows for Skyways; discovery timed out twice. Tonight's manual fetch found 8 filings (DRHP, RHP, corrigendum, 2 addenda, price-band ad, abridged prospectus, SEBI DRHP). **Rec:** (a) fix discovery (Unit 33) so these links appear on day one. **Owner:** —

### Unit 25 — IPODhan score / verdict — SECTION MISSING
`ipo_scores` 0 rows; computed from financials + subscription + GMP. Blocked by Unit 20. **Rec:** (a) unblock via Unit 20; no separate fix. **Owner:** —

### Unit 26 — Broker reviews / recommendation summary — SECTION MISSING
`ipo_reviews` 0 rows for every IPO (no writer runs). Not a PDF field. **Rec:** (a) decide separately whether to build a review scraper; (b) drop it from the "Awaiting data" strip so the page stops promising it. Recommend **(b)** now. **Owner:** —

### Unit 27 — Company contact (address/phone/email/compliance officer) — SECTION MISSING
`ipo_details.company_*` empty. RHP ⏳ (cover page). **Rec:** (a) RHP extraction. **Owner:** —

### Unit 28 — Listing performance (listing price, gain) — not applicable yet
Renders only when LISTED; writer `listing-performance-updater.ts` runs on cadence. **Rec:** (a) no change; re-check on 1 Sept. **Owner:** —

### Unit 29 — Allotment checker card
Renders only when CLOSED/LISTED — hidden tonight because status is still OPEN (Unit 1). **Rec:** fixed by Unit 1. **Owner:** —

### Unit 30 — CIN / legal name / registered office (`ipo_details`)
Not shown today; RHP ⏳. **Rec:** (a) include in RHP extraction (cover page). **Owner:** —

### Unit 31 — Lot calculator (embedded)
Derived from band + lot; fine. **Rec:** keep. **Owner:** —

### Unit 32 — Affiliate section
Not data. Skip. **Owner:** —

### Unit 33 — PIPELINE: document discovery reliability (root cause A)
15 s cap, no retry, 24 h cadence → 3/63 hit rate in Aug. **Rec:** (a) **retry 3× with backoff; fall back to BSE + SEBI + Chittorgarh links; run on the 30-min cycle for OPEN/UPCOMING IPOs with 0 docs**; (b) raise timeout only. Recommend **(a)**.
**Owner:** —

### Unit 34 — PIPELINE: extraction wiring (root cause B)
Nothing moves `documents` from PENDING. **Rec:** (a) **run the existing pdfplumber extractor on every new RHP row inside the prod cycle behind `ENABLE_DRHP_EXTRACTION`, one IPO per cycle, retention per D4**; (b) keep manual endpoint only. Recommend **(a)**.
**Owner:** —

### Unit 35 — PIPELINE: "Awaiting data" strip
Lists 8 sections; one (broker reviews) can never fill. **Rec:** (a) list only sections a running writer can fill. **Owner:** —

### Unit 36 — PIPELINE: dead schema / drift found on the way
`scraper_steps` absent in prod (migration 0033 not applied); `ipos.gmp*` and `ipos.price_band_*` dead columns; duplicate lead-manager path. **Rec:** (a) apply 0033 (and find out why the deploy assert passed); prune in the batch. **Owner:** —
