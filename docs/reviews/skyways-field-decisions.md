# Skyways IPO — per-field decision table (owner edits the last column)

Companion to `skyways-field-audit.md` (§3 has the reasoning per unit). Edit **Final value (owner)** in place; the implementation batch will be built from that column. Units 1–2 were already approved in chat.

Columns: **Page shows** = live page 2026-08-27 · **DRHP** = 30 Jun 2025 filing · **RHP+** = RHP 11 Aug 2026 + Corrigendum + Price Band Ad · **NSE / BSE** = what each exchange reports (BSE from `GetMkt_ISSUE_BBS_IPO?IPO_NO=7903`, live 2026-08-27) · **Recommended** = my pick · ★ = recommended option.

| # | Field | Page shows | DRHP | RHP+ (latest filing) | NSE | BSE | Recommended value → primary source | Options (★ = recommended) | Final value (owner) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Status | OPEN | — | close 27 Aug, 5 pm | OPEN | "L" (live) | **CLOSED from 17:00 IST on close_date** → computed from dates, not scraped | (a) recorded | (a) CLOSED from 17:00 IST on close_date — approved 2026-08-27 |
| 2 | Name / symbol | Skyways Air Services Ltd. / SKYWAYS | Skyways Air Services Limited | same + CIN U74899DL1984PLC019666 | Skyways Air Services Ltd. / SKYWAYS | SKYWAYS AIR SERVICES LIMITED / SKYWAYS / scrip 4757 | display name **NSE**; legal name + CIN **RHP** | (a) recorded | (a) NSE display name; RHP legal name + CIN — approved 2026-08-27 |
| 3 | Price band | ₹131–138 | — (`[•]`) | ₹131–138 (PBA) | 131–138 | 131.00–138.00 | **₹131–138** → NSE, BSE + PBA as verifiers | ★a NSE + verifiers · b no change |  |
| 4 | Lot / min investment | 100 / ₹13,800 | — | 100 / ₹13,800 (PBA) | n/c (BSE won) | Market_Lot 100, Min_Bid 100, tick 1.00 | **100** → BSE (as today), NSE verifier; min investment stays derived | ★a keep · b store from RHP |  |
| 5 | Issue size | ₹582.80 Cr | 4,62,51,000 sh, no ₹ | ₹582.80 Cr at cap = 4,22,31,600 sh | ₹5,82,80,00,000 | 29,583,600 sh (**net of anchor**) → ₹408.25 Cr | **₹582.80 Cr (gross, at cap)** → PBA/RHP primary, NSE second; resolver must know BSE reports NET offer | ★a filing primary + resolver fix · b keep NSE, fix label · c show both |  |
| 6 | Face value | ₹10 | ₹10 | ₹10 | 10 | 10.00 | **₹10** → NSE, DRHP verifier | ★a add DRHP verifier · b leave |  |
| 7 | Open / close | 24–27 Aug | — | 24 Aug / **27 Aug** (Corrigendum; RHP body says 26) | 23 / 26 Aug on 20 Aug (**both a day early**), later corrected to 24 / 27 | 24 Aug / 27 Aug | **24–27 Aug** → BSE + latest filing; NSE demoted for dates (it was wrong for 5 days) | ★a BSE primary, filing verifier, NSE third · b keep NSE |  |
| 8 | Allotment / refund / credit / listing | 28 Aug / — / — / 1 Sep | — | 28 Aug / 31 Aug / 31 Aug / 1 Sep | 28 Aug / — / — / 1 Sep | — (not in core API) | **28 / 31 / 31 Aug / 1 Sep** → latest filing (Corrigendum) into `ipo_details`; NSE for the two it has | ★a extract timeline from filing · b Chittorgarh |  |
| 9 | Registrar | Bigshare | Bigshare | Bigshare, INR000001385 | Bigshare Services Private Limited | Bigshare Services Private Limited | **Bigshare** → NSE (as today) | ★a keep |  |
| 10 | Lead managers | Holani, Shannon | n/c | **Holani, Shannon, Dolat Finserv** | Holani, Shannon | BRLM Holani; Co-BRLM **Shannon + Dolat** (our scraper drops the 2nd co-BRLM) | **all 3** → BSE API (fix co-BRLM parsing), RHP verifier; remove dup `ipo_details.lead_managers` | ★a BSE-fixed + RHP verifier · b RHP primary · c keep NSE |  |
| 11 | Listing exchanges | NSE, BSE | BSE + NSE | BSE + NSE; designated **BSE** | — | — (implicit) | **NSE, BSE; designated BSE** → RHP; Chittorgarh fallback | ★a RHP · b leave |  |
| 12 | ISIN | hidden | n/c | INE0PX301025 | — (pre-listing) | — | **INE0PX301025** → RHP; NSE after listing | ★a RHP + fix null-source writer · b hide until listing |  |
| 13 | GMP | ₹44 (+31.9 %) | — | — | — | — | **₹44** → InvestorGain (as today); drop dead `ipos.gmp*` cols | ★a keep + prune · b leave |  |
| 14 | Subscription | 71.25x overall | — | — | 71.25x; QIB 139.69 / NII 87.24 / Retail 25.40 | ISBID_Detail=1 (bid data exists) | **show category breakdown** → NSE (as today) | ★a enable views · b leave |  |
| 15 | Lot details table | tiers | — | Retail ≤ ₹2 L, sNII ₹2–10 L, bNII > ₹10 L | — | Max NII qty 21,151,600 | **derived** (as today) | ★a keep · b store |  |
| 16 | Fresh / OFS | missing | 3,29,17,700 / 1,33,33,300 | **2,88,98,300 / 1,33,33,300** (₹398.80 / ₹184.00 Cr) | — | — | **RHP values** → RHP extraction; Chittorgarh fallback | ★a RHP · b Chittorgarh |  |
| 17 | Category reservation | missing | n/c | QIB ≤ 2,10,80,000 (anchor 1,26,48,000) / NII ≥ 63,51,600 / Retail ≥ 1,48,00,000; no employee | — | net 29,583,600 = total − anchor (consistent) | **RHP values**, checksum categories = total | ★a RHP · b Chittorgarh |  |
| 18 | Objects | missing | n/c | Debt ₹216.79 Cr; WC ₹130.00 Cr; GCP `[•]` | — | — | **RHP values** | ★a RHP · b Chittorgarh |  |
| 19 | Description / industry / sector | missing | same business | Logistics — air freight forwarding; est. 1984; No.1 by AWBs | — (sector field phantom, #242) | — | **RHP** for description + industry; fix #242 for NSE sector | ★a · b Chittorgarh |  |
| 20 | Financials / KPIs | missing | FY22–24 + Dec-24 stub (stub EPS 5.84) | FY24–26, no stub: Rev 2,81,289.89 L; PAT 6,352.38 L; NW 33,264.21 L; EPS 3.56; RoNW 12.33 %; D/E 1.26; P/E 38.76×; mcap ₹2,005.74 Cr | — | — | **RHP+ values (latest filing, never DRHP when RHP exists)** | ★a wire extractor · b Chittorgarh |  |
| 21 | Promoter holding | missing | pre-placement (differs) | pre 79.14 %; post `[•]` (≈56.82 % computed) | — | — | **79.14 % pre; post shown as "computed ≈56.8 %"** | ★a RHP · b Chittorgarh |  |
| 22 | Anchor investors | missing | — | — (separate exchange report) | — | Anchor_Details "" (empty tonight) | **exchange anchor report** → BSE/NSE PDF once published | ★a discovery + extract · b leave |  |
| 23 | Peers | missing | n/c | Delhivery, TVS SCS, Mahindra Logistics, Shadowfax (P/E 260 / 54 / 1,548 / 104) | — | — | **RHP table** | ★a RHP · b Chittorgarh |  |
| 24 | Documents | missing | — | 7 filings on company host | timed out ×2 | **direct links**: RHP, Corrigendum, Addendum zip, Price Band Ad | **BSE API links as primary discovery**, NSE + company host fallback | ★a BSE-first discovery · b NSE-only with retries |  |
| 25 | IPODhan score | missing | — | — | — | — | computed once #20 lands | ★a via #20 |  |
| 26 | Broker reviews | missing | — | — | — | — | none exists | a build scraper · ★b drop from strip |  |
| 27 | Company contact | missing | same | RZ 128-129A Mahipalpur Ext, New Delhi 110037; cs@skyways-group.com; +91 9910791501; CO Hitesh Kumar | — | — | **RHP** | ★a RHP · b leave |  |
| 28 | Listing performance | n/a | — | — | after listing | after listing | no change | ★a |  |
| 29 | Allotment checker | hidden | — | — | — | — | fixed by #1 | ★a |  |
| 30 | CIN / legal name / office | not shown | same | as #27 + CIN | — | — | **RHP** | ★a RHP · b leave |  |
| 31 | Lot calculator | works | — | — | — | — | derived | ★a keep |  |
| 32 | Affiliate | — | — | — | — | — | — | skip |  |
| 33 | PIPELINE discovery | 3/63 IPOs have docs | — | — | 15 s timeouts | **API works, unblocked, has links** | **BSE API first**, NSE retry ×3, company-site + Chittorgarh fallback; every 30 min for doc-less OPEN/UPCOMING | ★a · b timeout only |  |
| 34 | PIPELINE extraction | 129 docs PENDING | — | — | — | — | run extractor in prod cycle behind flag, 1 IPO/cycle, D4 retention, read latest filing first | ★a · b manual only |  |
| 35 | "Awaiting data" strip | 8 sections | — | — | — | — | list only fillable sections | ★a · b leave |  |
| 36 | Schema drift | — | — | — | — | — | apply 0033; prune dead cols; single lead-manager path | ★a · b leave |  |
