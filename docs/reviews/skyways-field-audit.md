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

## 2. Documents obtained (2026-08-27, all HTTP 200, from the company's own host — NSE 403/404 bot-blocked, SEBI copy unreadable)

| Document | URL | Pages | SHA-256 |
|---|---|---|---|
| RHP (11 Aug 2026) | https://r2.skyways-air.in/RHP-Skyways.pdf | 644 | b4971a1aa3ef27ccb9375622081b4abf9b03e4646e8b725ae4971930742500b1 |
| DRHP (30 Jun 2025) | https://skyways-air.in/DRHP_Skyways%20Final.pdf | 564 | 78b3a4537ccc713267231e1e2351692f2b33ed6d3ee5abaeeffc821158d76f30 |
| Corrigendum to RHP (12 Aug) | https://r2.skyways-air.in/Corrigendum-of-RHP-Skyways.pdf | 2 | d3a6094a2a23371ec38432ec9a34ec91def2b2d3cecf6546fd375ff45e2dee1c |
| Price Band Advertisement (14 Aug) | https://r2.skyways-air.in/Price-Band-Advertisement.pdf | 10 | 1f413a9e2c06d4da2aacacb7a385cd29426722c4e7f47ae0d8093b3d6c4a580b |
| Abridged Prospectus | https://r2.skyways-air.in/Abrigded-Prospectus.pdf | 8 | ec6202c6a4dcfd7cbec099577e2ebaf4de0a8c1223a72daf298f8fcece2a20e8 |
| Addendum 1 (24 Aug) | https://r2.skyways-air.in/Skyways-Air-Services-Limited-Addendum.pdf | 2 | 971b265a1d22ee9350d2c353585953c5cbae1f41bb5812906f1f8eee2b38dea1 |
| Addendum 2 (26 Aug) | https://r2.skyways-air.in/Skyways-Air-Services-Limited-Second-Addendum.pdf | 2 | f2a2663b246469a00cd115e4be3982e8a5457cb5ad29e6d328381e70794c4bce |

**Three document facts that change the design:**
1. The RHP is filed BEFORE pricing: price band, issue size in ₹, lot size, P/E, market cap, post-issue capital and post-issue promoter % are all `[•]` in it. They are fixed in the **Price Band Advertisement** (a scanned newspaper PDF, no text layer). An extractor that reads only the RHP must not treat `[•]` as failure.
2. The **Corrigendum** moved close 26→27 Aug (Mumbai bank holiday) and shifted allotment/refund/credit/listing to 28 Aug / 31 Aug / 31 Aug / 1 Sep. The RHP body still prints the old dates — dates must be read from the latest filing, never the RHP alone.
3. The 100-page Restated Financials chapter has **no text layer** (images); the MD&A and Basis-for-Offer-Price sections carry the same numbers as text.

Full extraction (page-referenced): `docs/reviews/skyways-rhp-values.md`.

## 3. Field-by-field audit

Legend — **Src** = what actually wrote the value in prod (`field_sources` row, or code path); **RHP** = value in the latest filing (RHP / Corrigendum / Price Band Ad, with page no.); **Rec** = my recommendation, options lettered; **Owner** = your pick (blank = not yet decided).

Fields are grouped into decision units (one unit = one turn). 290 rendered entries collapse into 36 units because entries in a unit share one source and one fix.

### Unit 1 — Status badge ("Open Now")
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Open Now" at 20:55 IST on close day | `ipos.status` = NSE (conf 100). Chittorgarh says CLOSED every cycle; NSE outranks it. `status-updater-service.ts` is date-only + UTC date, flips at 05:30 IST next day. | Close Thu 27 Aug (Corrigendum p.1); UPI mandate cut-off 5:00 pm | Status is derived, not a PDF field. The bug is the flip rule, not the source. |

**Rec:** (a) **flip to CLOSED at 17:00 IST on close_date** (IST-aware state machine; also stop letting NSE's stale "OPEN" beat a date-derived CLOSED in the conflict resolver); (b) keep date-only but use IST midnight (still wrong 7 h/day); (c) leave as-is. Recommend **(a)**.
**Owner:** (a) — approved 2026-08-27 22:01 IST

### Unit 2 — Company name / symbol / segment / offering type (header)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Skyways Air Services Ltd." · SKYWAYS (NSE) · MAINBOARD · IPO | NSE (conf 100/95) via `field_sources` | "Skyways Air Services Limited", CIN U74899DL1984PLC019666 (RHP p.1) | NSE listing page is a fine primary for identity; matrix order ADMIN>NSE>BSE>DRHP. |

**Rec:** (a) **keep NSE as primary**; RHP fills CIN/legal name in `ipo_details` (Unit 30); (b) make DRHP primary for name. Recommend **(a)** — the exchange record is authoritative and exists before the RHP.
**Owner:** (a) — approved 2026-08-27 22:15 IST

### Unit 3 — Price band (₹131–₹138)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹131 – ₹138 | NSE (conf 95), set 20 Aug | `[•]` in RHP; **₹131–₹138** (Price Band Ad p.1) — MATCHES page | Price band is NOT in the DRHP; it appears in the RHP / price-band ad. Matrix ADMIN>NSE>BSE>DRHP — correct order. |

**Rec:** (a) **keep NSE primary; add RHP as verifier** (raise a conflict if RHP band ≠ NSE band); (b) no change. Recommend **(a)**.
**Owner:** —

### Unit 4 — Lot size (100) and Min. Investment (₹13,800)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| 100 shares · ₹13,800 = 100 × ₹138 (derived in page) | `lotSize` = BSE (conf 90), 23 Aug | `[•]` in RHP; **100 shares**, min ₹13,800 (Price Band Ad p.1) — MATCHES | Matrix ADMIN>BSE>NSE>DRHP. Min investment is computed, never stored. |

**Rec:** (a) **keep; add RHP cross-check**; (b) store min_investment in `ipo_details` from RHP. Recommend **(a)** — derived is safer than a second stored copy.
**Owner:** —

### Unit 5 — Issue size (₹582.80 Cr)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹582.80 Cr | NSE (conf 100). BSE says 4,082,536,800 (₹408.25 Cr) every cycle; conflict auto-labelled "converged". | `[•]` in RHP; **₹582.80 Cr at cap** = fresh ₹398.80 Cr + OFS ₹184.00 Cr; 4,22,31,600 shares (PBA p.1, RHP p.72) — MATCHES NSE. BSE's 4,082,536,800 = 2,95,83,600 shares × 138 = offer NET of the 1,26,48,000 anchor portion — a different definition, not a wrong number | Matrix ADMIN>NSE>BSE>CHITTORGARH. RHP never consulted. NSE vs BSE differ by ₹174 Cr. |

**Rec:** (a) **RHP / price-band ad primary for issue size at upper band, NSE second**, and fix the resolver so a 30 % gap is never marked "converged"; (b) keep NSE, fix only the resolver label; (c) show both. Recommend **(a)**.
**Owner:** —

### Unit 6 — Face value (₹10)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| ₹10 | NSE (conf 100) | **₹10** (RHP p.1) — MATCHES | Matrix ADMIN>NSE>BSE>CHITTORGARH; DRHP not listed although it is the canonical source. |

**Rec:** (a) **add DRHP to the source list as verifier**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 7 — Open / Close dates
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| 24 Aug – 27 Aug 2026 | NSE (conf 100) | Open Mon 24 Aug (RHP p.1); close **27 Aug per Corrigendum** (RHP body says 26 Aug) — MATCHES page | DRHP has no dates; RHP does. Matrix excludes DRHP correctly. |

**Rec:** (a) **keep NSE; RHP verifier**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 8 — Allotment / Refund / Credit / Listing dates (timeline + details table)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Allotment 28 Aug, Listing 1 Sept; Refunds & Credit-of-shares rows **blank** | allotment/listing = NSE (conf 100). Refund + credit dates live in `ipo_details` (0 rows) → blank. | Per Corrigendum: basis 28 Aug · refunds **31 Aug** · credit **31 Aug** · listing 1 Sep (RHP p.571 has the stale pre-corrigendum dates) — allotment/listing MATCH; refund/credit MISSING on page | `ipo_details` is filled only by DRHP/RHP extraction, which never runs. |

**Rec:** (a) **extract the full tentative-timeline table from the RHP into `ipo_details`** (basis, refund, credit, listing); (b) scrape from Chittorgarh instead. Recommend **(a)**.
**Owner:** —

### Unit 9 — Registrar (Bigshare) and allotment-check link
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Bigshare, link healthy | NSE (conf 100) → `registrar_id` resolved | Bigshare Services Pvt Ltd, SEBI INR000001385 (RHP p.81) — MATCHES | Fine. |

**Rec:** (a) **keep**; RHP as verifier only. Recommend **(a)**.
**Owner:** —

### Unit 10 — Lead managers
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| Holani Consultants, Shannon Advisors (`ipos.lead_managers`) | NSE (conf 100) | **THREE** BRLMs: Holani Consultants, Shannon Advisors, **Dolat Finserv** (RHP p.81) — page is MISSING one | Matrix lists DRHP first, but DRHP never runs, so NSE filled it. A second copy `ipo_details.lead_managers` exists and is empty (two data paths — drift risk). |

**Rec:** (a) **RHP primary (as the matrix already says), NSE fallback; remove the duplicate `ipo_details.lead_managers` path**; (b) keep NSE only. Recommend **(a)**.
**Owner:** —

### Unit 11 — Listing exchanges (NSE, BSE)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| NSE, BSE | CHITTORGARH (conf 80) | BSE + NSE, designated exchange **BSE** (RHP p.1) — MATCHES; "designated exchange" not stored | RHP cover states it; aggregator used because no primary path. |

**Rec:** (a) **RHP primary, Chittorgarh fallback**; (b) leave. Recommend **(a)**.
**Owner:** —

### Unit 12 — ISIN (not shown)
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| hidden (null) | `field_sources` says CHITTORGARH conf 80 — but the value is null (a source row was written for an empty value) | **INE0PX301025** (RHP p.534, p.570) — page hides it | Nothing that runs reads the RHP. |

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
| Computed from lot × band (`computeBidTiers`) | derived | Retail ≤ ₹2 lakh, sNII ₹2–10 lakh, bNII > ₹10 lakh (RHP p.575–577) — page table MATCHES | Derived from regulatory caps; correct as long as Units 3–4 are right. |

**Rec:** (a) **keep derived**; (b) store from RHP. Recommend **(a)**.
**Owner:** —

### Unit 16 — Issue structure (fresh vs OFS, shares offered) — SECTION MISSING
| Page shows | Src | RHP | Why not PDF |
|---|---|---|---|
| "Awaiting data" | `ipo_details.fresh_issue / ofs_issue` empty; matrix `fresh_issue_size` = ADMIN>NSE>DRHP>BSE but the NSE scraper does not emit it | Fresh 2,88,98,300 sh (₹398.80 Cr) + OFS 1,33,33,300 sh (₹184.00 Cr) = 4,22,31,600 (RHP p.72; PBA p.1). DRHP had fresh 3,29,17,700 — cut by the 40,19,326-share pre-IPO placement @ ₹120 | Extraction never runs (§1). |

**Rec:** (a) **RHP extraction fills it** (cover table is deterministic); (b) Chittorgarh fallback. Recommend **(a)** with (b) as fallback.
**Owner:** —

### Unit 17 — Category reservation (QIB/NII/Retail/Employee shares + %, anchor portion) — SECTION MISSING
Same root cause as Unit 16 (`ipo_details.*_shares_offered`). RHP p.72: QIB ≤ 2,10,80,000 (50 %) incl. anchor 1,26,48,000; NII ≥ 63,51,600 (15 %: sNII 21,17,200 / bNII 42,34,400); Retail ≥ 1,48,00,000 (35 %); **no employee reservation**. (pdftotext shifts this table one row — the extractor must checksum: categories must sum to the total.) **Rec:** (a) RHP extraction. **Owner:** —

### Unit 18 — Objects of the issue — SECTION MISSING
`ipos.objectives` null; matrix ADMIN>DRHP>CHITTORGARH. RHP p.111–113: (1) repay borrowings of Company + Forin Container Line ₹216.79 Cr; (2) working capital ₹130.00 Cr; (3) GCP `[•]` (≤25 %). No capex object. **Rec:** (a) RHP extraction (table with ₹ amounts), Chittorgarh fallback. **Owner:** —

### Unit 19 — Company overview / description / industry / sector — SECTION MISSING
`companyDescription`, `industry`, `sector` all null. `sector` is starved by the phantom `data.sector` field (#242); `industry`/description declare DRHP first. RHP p.252: est. 1984, No. 1 air freight forwarder by AWBs (World ACD, 2022–25); air/ocean/trucking/warehousing/customs/express. Industry: **Logistics — air freight forwarding**. Employees: 1,193 group (RHP p.290) — RHP also prints 320 standalone and "over 400"; the extractor must pick the KPI figure. **Rec:** (a) RHP extraction for description + industry; fix #242 for sector from NSE. **Owner:** —

### Unit 20 — Financials (revenue/PAT/net worth/EBITDA ×3 FY, KPIs, ratios: EPS, P/E, RoNW, D/E, ROCE, P/B, market cap) — SECTIONS MISSING (Financial charts + KPI highlights)
`financial_data` 0 rows; matrix declares DRHP first for every one of these. RHP p.475/480/491 (₹ lakh): Revenue FY26 2,81,289.89 / FY25 2,24,782.49 / FY24 1,28,911.01; EBITDA 12,564.86; PAT 6,352.38 / 4,813.97 / 3,449.35; Net worth 33,264.21; Borrowings 62,405.68; EPS 3.56; RoNW 12.33 %; NAV 28.91; D/E 1.26; RoCE 18.11 %. P/E **36.80× floor / 38.76× cap**, industry avg 491×, market cap **₹2,005.74 Cr** at cap (PBA p.1). **RHP covers FY24–26 with NO stub; DRHP covered FY22–24 + Dec-24 stub** — the extractor must key on the latest filing, not the DRHP. **Rec:** (a) RHP extraction — the existing pdfplumber extractor (C3b, 144 IPOs in June) proves it is deterministic; wire it. **Owner:** —

### Unit 21 — Promoter holding pre/post — SECTION MISSING
`financial_data.promoter_holding_*` empty. Pre-issue **79.14 %** (Yashpal Sharma 46.49 % + Tarun Sharma 32.65 %, RHP p.105). Post-issue `[•]` in every filing — derivable ≈ 56.82 % ((9,21,59,452 − 95,80,690 sold) ÷ 14,53,43,544); must be labelled "computed" on the page. **Rec:** (a) RHP extraction. **Owner:** —

### Unit 22 — Anchor investors — SECTION MISSING
`anchor_investors` 0 rows. Source is NOT the RHP — it is the exchange "Anchor allocation report" PDF (discovery already knows the type `ANCHOR_ALLOCATION_REPORT`). Skyways' was never discovered (timeout). **Rec:** (a) fix discovery (Unit 33) + extract the anchor report. **Owner:** —

### Unit 23 — Peer comparison — SECTION MISSING
`peer_companies` 0 rows; RHP p.135: Delhivery (P/E 260, RoNW 1.58 %), TVS Supply Chain (54, 5.62 %), Mahindra Logistics (1,548, 0.19 %), Shadowfax (104, 6.40 %). **Rec:** (a) RHP extraction (peer table with P/E, EPS, RoNW). **Owner:** —

### Unit 24 — Documents list (RHP/DRHP/addenda links) — SECTION MISSING
`documents` 0 rows for Skyways; discovery timed out twice. Tonight's manual fetch found 8 filings (DRHP, RHP, corrigendum, 2 addenda, price-band ad, abridged prospectus, SEBI DRHP). **Rec:** (a) fix discovery (Unit 33) so these links appear on day one. **Owner:** —

### Unit 25 — IPODhan score / verdict — SECTION MISSING
`ipo_scores` 0 rows; computed from financials + subscription + GMP. Blocked by Unit 20. **Rec:** (a) unblock via Unit 20; no separate fix. **Owner:** —

### Unit 26 — Broker reviews / recommendation summary — SECTION MISSING
`ipo_reviews` 0 rows for every IPO (no writer runs). Not a PDF field. **Rec:** (a) decide separately whether to build a review scraper; (b) drop it from the "Awaiting data" strip so the page stops promising it. Recommend **(b)** now. **Owner:** —

### Unit 27 — Company contact (address/phone/email/compliance officer) — SECTION MISSING
`ipo_details.company_*` empty. Same values as Unit 30 (RHP p.1, p.80). **Rec:** (a) RHP extraction. **Owner:** —

### Unit 28 — Listing performance (listing price, gain) — not applicable yet
Renders only when LISTED; writer `listing-performance-updater.ts` runs on cadence. **Rec:** (a) no change; re-check on 1 Sept. **Owner:** —

### Unit 29 — Allotment checker card
Renders only when CLOSED/LISTED — hidden tonight because status is still OPEN (Unit 1). **Rec:** fixed by Unit 1. **Owner:** —

### Unit 30 — CIN / legal name / registered office (`ipo_details`)
RHP p.1/p.80: legal name Skyways Air Services Limited; CIN U74899DL1984PLC019666; RZ 128-129A Mahipalpur Extension NH-8, New Delhi 110037; cs@skyways-group.com; +91 9910791501; Compliance Officer Hitesh Kumar (ACS 33286); CFO Himanshu Chhabra. **Rec:** (a) include in RHP extraction (cover page). **Owner:** —

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
## 4. Source comparison per unit (owner's decision table)

Values as each source actually reports them for Skyways, 2026-08-27. **NSE** = what our NSE scraper wrote / logged in `field_sources` + `data_conflicts`; **BSE** = BSE JSON API `GetMkt_ISSUE_BBS_IPO?IPO_NO=7903` fetched live tonight plus what our BSE scraper logged; **DRHP** = 30 Jun 2025 filing; **RHP+** = RHP 11 Aug 2026 + Corrigendum + Price Band Ad (the latest filing wins). "—" = source does not carry the field. "n/c" = not checked in this audit.

| # | Field | Page shows | DRHP | RHP+ (latest filing) | NSE | BSE | Recommended value → primary source | Options (★ = recommended) |
|---|---|---|---|---|---|---|---|---|
| 1 | Status | OPEN | — | close 27 Aug, 5 pm | OPEN | "L" (live) | **CLOSED from 17:00 IST on close_date** → computed from dates, not scraped | (a) recorded |
| 2 | Name / symbol | Skyways Air Services Ltd. / SKYWAYS | Skyways Air Services Limited | same + CIN U74899DL1984PLC019666 | Skyways Air Services Ltd. / SKYWAYS | SKYWAYS AIR SERVICES LIMITED / SKYWAYS / scrip 4757 | display name **NSE**; legal name + CIN **RHP** | (a) recorded |
| 3 | Price band | ₹131–138 | — (`[•]`) | ₹131–138 (PBA) | 131–138 | 131.00–138.00 | **₹131–138** → NSE, BSE + PBA as verifiers | ★a NSE + verifiers · b no change |
| 4 | Lot / min investment | 100 / ₹13,800 | — | 100 / ₹13,800 (PBA) | n/c (BSE won) | Market_Lot 100, Min_Bid 100, tick 1.00 | **100** → BSE (as today), NSE verifier; min investment stays derived | ★a keep · b store from RHP |
| 5 | Issue size | ₹582.80 Cr | 4,62,51,000 sh, no ₹ | ₹582.80 Cr at cap = 4,22,31,600 sh | ₹5,82,80,00,000 | 29,583,600 sh (**net of anchor**) → ₹408.25 Cr | **₹582.80 Cr (gross, at cap)** → PBA/RHP primary, NSE second; resolver must know BSE reports NET offer | ★a filing primary + resolver fix · b keep NSE, fix label · c show both |
| 6 | Face value | ₹10 | ₹10 | ₹10 | 10 | 10.00 | **₹10** → NSE, DRHP verifier | ★a add DRHP verifier · b leave |
| 7 | Open / close | 24–27 Aug | — | 24 Aug / **27 Aug** (Corrigendum; RHP body says 26) | 23 / 26 Aug on 20 Aug (**both a day early**), later corrected to 24 / 27 | 24 Aug / 27 Aug | **24–27 Aug** → BSE + latest filing; NSE demoted for dates (it was wrong for 5 days) | ★a BSE primary, filing verifier, NSE third · b keep NSE |
| 8 | Allotment / refund / credit / listing | 28 Aug / — / — / 1 Sep | — | 28 Aug / 31 Aug / 31 Aug / 1 Sep | 28 Aug / — / — / 1 Sep | — (not in core API) | **28 / 31 / 31 Aug / 1 Sep** → latest filing (Corrigendum) into `ipo_details`; NSE for the two it has | ★a extract timeline from filing · b Chittorgarh |
| 9 | Registrar | Bigshare | Bigshare | Bigshare, INR000001385 | Bigshare Services Private Limited | Bigshare Services Private Limited | **Bigshare** → NSE (as today) | ★a keep |
| 10 | Lead managers | Holani, Shannon | n/c | **Holani, Shannon, Dolat Finserv** | Holani, Shannon | BRLM Holani; Co-BRLM **Shannon + Dolat** (our scraper drops the 2nd co-BRLM) | **all 3** → BSE API (fix co-BRLM parsing), RHP verifier; remove dup `ipo_details.lead_managers` | ★a BSE-fixed + RHP verifier · b RHP primary · c keep NSE |
| 11 | Listing exchanges | NSE, BSE | BSE + NSE | BSE + NSE; designated **BSE** | — | — (implicit) | **NSE, BSE; designated BSE** → RHP; Chittorgarh fallback | ★a RHP · b leave |
| 12 | ISIN | hidden | n/c | INE0PX301025 | — (pre-listing) | — | **INE0PX301025** → RHP; NSE after listing | ★a RHP + fix null-source writer · b hide until listing |
| 13 | GMP | ₹44 (+31.9 %) | — | — | — | — | **₹44** → InvestorGain (as today); drop dead `ipos.gmp*` cols | ★a keep + prune · b leave |
| 14 | Subscription | 71.25x overall | — | — | 71.25x; QIB 139.69 / NII 87.24 / Retail 25.40 | ISBID_Detail=1 (bid data exists) | **show category breakdown** → NSE (as today) | ★a enable views · b leave |
| 15 | Lot details table | tiers | — | Retail ≤ ₹2 L, sNII ₹2–10 L, bNII > ₹10 L | — | Max NII qty 21,151,600 | **derived** (as today) | ★a keep · b store |
| 16 | Fresh / OFS | missing | 3,29,17,700 / 1,33,33,300 | **2,88,98,300 / 1,33,33,300** (₹398.80 / ₹184.00 Cr) | — | — | **RHP values** → RHP extraction; Chittorgarh fallback | ★a RHP · b Chittorgarh |
| 17 | Category reservation | missing | n/c | QIB ≤ 2,10,80,000 (anchor 1,26,48,000) / NII ≥ 63,51,600 / Retail ≥ 1,48,00,000; no employee | — | net 29,583,600 = total − anchor (consistent) | **RHP values**, checksum categories = total | ★a RHP · b Chittorgarh |
| 18 | Objects | missing | n/c | Debt ₹216.79 Cr; WC ₹130.00 Cr; GCP `[•]` | — | — | **RHP values** | ★a RHP · b Chittorgarh |
| 19 | Description / industry / sector | missing | same business | Logistics — air freight forwarding; est. 1984; No.1 by AWBs | — (sector field phantom, #242) | — | **RHP** for description + industry; fix #242 for NSE sector | ★a · b Chittorgarh |
| 20 | Financials / KPIs | missing | FY22–24 + Dec-24 stub (stub EPS 5.84) | FY24–26, no stub: Rev 2,81,289.89 L; PAT 6,352.38 L; NW 33,264.21 L; EPS 3.56; RoNW 12.33 %; D/E 1.26; P/E 38.76×; mcap ₹2,005.74 Cr | — | — | **RHP+ values (latest filing, never DRHP when RHP exists)** | ★a wire extractor · b Chittorgarh |
| 21 | Promoter holding | missing | pre-placement (differs) | pre 79.14 %; post `[•]` (≈56.82 % computed) | — | — | **79.14 % pre; post shown as "computed ≈56.8 %"** | ★a RHP · b Chittorgarh |
| 22 | Anchor investors | missing | — | — (separate exchange report) | — | Anchor_Details "" (empty tonight) | **exchange anchor report** → BSE/NSE PDF once published | ★a discovery + extract · b leave |
| 23 | Peers | missing | n/c | Delhivery, TVS SCS, Mahindra Logistics, Shadowfax (P/E 260 / 54 / 1,548 / 104) | — | — | **RHP table** | ★a RHP · b Chittorgarh |
| 24 | Documents | missing | — | 7 filings on company host | timed out ×2 | **direct links**: RHP, Corrigendum, Addendum zip, Price Band Ad | **BSE API links as primary discovery**, NSE + company host fallback | ★a BSE-first discovery · b NSE-only with retries |
| 25 | IPODhan score | missing | — | — | — | — | computed once #20 lands | ★a via #20 |
| 26 | Broker reviews | missing | — | — | — | — | none exists | a build scraper · ★b drop from strip |
| 27 | Company contact | missing | same | RZ 128-129A Mahipalpur Ext, New Delhi 110037; cs@skyways-group.com; +91 9910791501; CO Hitesh Kumar | — | — | **RHP** | ★a RHP · b leave |
| 28 | Listing performance | n/a | — | — | after listing | after listing | no change | ★a |
| 29 | Allotment checker | hidden | — | — | — | — | fixed by #1 | ★a |
| 30 | CIN / legal name / office | not shown | same | as #27 + CIN | — | — | **RHP** | ★a RHP · b leave |
| 31 | Lot calculator | works | — | — | — | — | derived | ★a keep |
| 32 | Affiliate | — | — | — | — | — | — | skip |
| 33 | PIPELINE discovery | 3/63 IPOs have docs | — | — | 15 s timeouts | **API works, unblocked, has links** | **BSE API first**, NSE retry ×3, company-site + Chittorgarh fallback; every 30 min for doc-less OPEN/UPCOMING | ★a · b timeout only |
| 34 | PIPELINE extraction | 129 docs PENDING | — | — | — | — | run extractor in prod cycle behind flag, 1 IPO/cycle, D4 retention, read latest filing first | ★a · b manual only |
| 35 | "Awaiting data" strip | 8 sections | — | — | — | — | list only fillable sections | ★a · b leave |
| 36 | Schema drift | — | — | — | — | — | apply 0033; prune dead cols; single lead-manager path | ★a · b leave |

**New finding from this table:** NSE reported open/close as **23 / 26 Aug on 20 Aug** — a day early on both — and only corrected by 25 Aug. BSE and Chittorgarh had 24 / 27 from the start. That is the T-327 NSE date-drift class again, live on this IPO. Hence Unit 7 now recommends BSE as the date primary.
