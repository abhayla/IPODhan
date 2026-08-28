# Skyways Air Services Limited — IPO document extraction

Compiled 2026-08-27. Currency unit throughout is **Rs in lakhs** unless stated otherwise (100 lakhs = 1 crore).

---

## 1. Documents obtained (provenance)

| # | Document | URL actually used | HTTP | Bytes | Pages | SHA-256 |
|---|---|---|---|---|---|---|
| 1 | **RHP** dated 11-Aug-2026 | https://r2.skyways-air.in/RHP-Skyways.pdf | 200 | 46,922,851 | 644 | b4971a1aa3ef27ccb9375622081b4abf9b03e4646e8b725ae4971930742500b1 |
| 2 | **DRHP** dated 30-Jun-2025 | https://skyways-air.in/DRHP_Skyways%20Final.pdf | 200 | 18,652,653 | 564 | 78b3a4537ccc713267231e1e2351692f2b33ed6d3ee5abaeeffc821158d76f30 |
| 3 | **Corrigendum to RHP** dated 12-Aug-2026 | https://r2.skyways-air.in/Corrigendum-of-RHP-Skyways.pdf | 200 | 1,391,575 | 2 | d3a6094a2a23371ec38432ec9a34ec91def2b2d3cecf6546fd375ff45e2dee1c |
| 4 | **Price Band Advertisement** (pub. 14-Aug-2026) | https://r2.skyways-air.in/Price-Band-Advertisement.pdf | 200 | 6,585,368 | 10 | 1f413a9e2c06d4da2aacacb7a385cd29426722c4e7f47ae0d8093b3d6c4a580b |
| 5 | **Abridged Prospectus** | https://r2.skyways-air.in/Abrigded-Prospectus.pdf | 200 | 594,360 | 8 | ec6202c6a4dcfd7cbec099577e2ebaf4de0a8c1223a72daf298f8fcece2a20e8 |
| 6 | **First Addendum to RHP** dated 24-Aug-2026 | https://r2.skyways-air.in/Skyways-Air-Services-Limited-Addendum.pdf | 200 | 1,625,685 | 2 | 971b265a1d22ee9350d2c353585953c5cbae1f41bb5812906f1f8eee2b38dea1 |
| 7 | **Second Addendum to RHP** dated 26-Aug-2026 | https://r2.skyways-air.in/Skyways-Air-Services-Limited-Second-Addendum.pdf | 200 | 1,063,542 | 2 | f2a2663b246469a00cd115e4be3982e8a5457cb5ad29e6d328381e70794c4bce |
| 8 | SEBI-hosted file (UNUSABLE) | https://www.sebi.gov.in/sebi_data/attachdocs/jul-2025/1751527808198_842.pdf | 200 | 2,349,031 | n/a | 290ed3cfabc167be6b2b3a9adf6b439e034233611caf1c62c5dbe01147ccd799 |

All primary documents came from the **company's own host** (skyways-air.in / r2.skyways-air.in), which is one of the RHP's officially named hosting sites.

### Sources tried and what happened

| Source | Result |
|---|---|
| **NSE** nseindia.com cookie warmup + /api/corporates-offer-documents | **FAILED.** Warmup GET returned **403** (bot protection); the API returned **404** with a bot-challenge script body. No cookie warmup succeeded from this environment. |
| **SEBI** sebi.gov.in DRHP attachment | **PARTIAL FAILURE.** Downloaded (HTTP 200, 2.3 MB) but **structurally unreadable** — pdftotext reports 20 pages with zero text; PyMuPDF reports 0 pages. Not the full 564-page DRHP. Superseded by source #2. |
| **BSE** bseindia.com IPO pages | Not needed — the company host served every document. |
| **Company site** skyways-air.in/investors/ | **WORKED.** Sole successful source; served RHP, DRHP, corrigendum, price band ad, abridged prospectus, both addenda. |
| **BRLM sites** (holaniconsultants.co.in etc.) | Not needed. |
| Chittorgarh | Used only as an initial locator lead in web search; **no file downloaded from it**. |

---

## 2. CRITICAL READING NOTE — why the RHP alone cannot answer the price questions

The RHP is dated **11 August 2026**, which is **before** the price band was fixed. Consequently **every price-dependent value in the RHP is printed as a blank placeholder `[•]`** — the price band, issue size in rupees, lot size, minimum application value, P/E at floor/cap, post-offer NAV, post-offer capital, post-offer promoter %, market capitalisation, and the entire offer-expenses table.

Those values were fixed by the **Price Band Advertisement published 14 August 2026** (document #4). Where a figure below comes from that advertisement rather than the RHP it is labelled **[PBA]**. Anyone extracting from the RHP PDF alone will get `[•]` for all of these — that is a property of the document, not a failure of extraction.

Two further updates matter:

- The **Corrigendum (12-Aug-2026)** moved the **Bid/Offer Closing Date from Wed 26-Aug-2026 to Thu 27-Aug-2026**, because 26 August was a bank holiday in Mumbai. It shifted the whole downstream timetable by one to two days. The RHP body still prints the old dates.
- **Addenda 1 and 2** (24 and 26 Aug 2026) add litigation/regulatory disclosures only; they change **no** offer term.

---

## 3. Extracted values

Page references: `PDF p.N` = Nth page of the PDF file; `(printed p.M)` = the page number printed on that page. The RHP's printed numbering runs about 2 behind the PDF page index.

### 3.1 Company identity

| Field | RHP value | RHP page | DRHP value if different | Notes |
|---|---|---|---|---|
| Exact legal name | **Skyways Air Services Limited** | PDF p.1 (cover) | same | Incorporated 21-Dec-1984 as "Skyways Air Services Private Limited"; converted to public limited, fresh COI **05-May-2025** |
| CIN | **U74899DL1984PLC019666** | PDF p.1 | same | |
| Registered & corporate office | **RZ 128-129A, Mahipalpur Extension NH-8, New Delhi, Delhi, India, 110037** | PDF p.1; PDF p.79 (printed 77) | same | Also the Head Office per the Abridged Prospectus |
| Website | **www.skyways-air.in** | PDF p.1 | same | |
| Email | **cs@skyways-group.com** | PDF p.1 | same | |
| Phone | **+91 9910791501** | PDF p.1 | same | |
| Company Secretary & Compliance Officer | **Mr. Hitesh Kumar**, ACS No. 33286 | PDF p.80 (printed 78) | same | cs@skyways-group.com, +91 9910791501 |
| Chief Financial Officer | **Himanshu Chhabra** (also Whole-Time Director), appointed CFO 30-May-2025 | PDF p.355 / p.359 | — | Named in "Our Management", not in General Information |

### 3.2 Issue size and structure

| Field | RHP value | RHP page | DRHP value if different | Notes |
|---|---|---|---|---|
| Total offer (shares) | **Up to 4,22,31,600 Equity Shares** of FV Rs 10 | PDF p.1; p.72 (printed 70) | **Up to 4,62,51,000** | DRHP total was larger |
| Fresh issue (shares) | **Up to 2,88,98,300** | PDF p.1; p.72 | **Up to 3,29,17,700** | Reduced by exactly 40,19,326 shares via the pre-IPO placement |
| Offer for sale (shares) | **Up to 1,33,33,300** | PDF p.1; p.72 | same | Unchanged between DRHP and RHP |
| **Total offer size (Rs)** | `[•]` in RHP → **Rs 55,323.40 lakhs at floor Rs 131 / Rs 58,279.61 lakhs at cap Rs 138** | RHP p.72 = `[•]`; **[PBA]** p.1 | — | ≈ **Rs 553.23 cr – Rs 582.80 cr**; headline ≈ **Rs 582.80 crore** at cap |
| Fresh issue (Rs) | `[•]` → **Rs 37,856.77 lakhs (floor) / Rs 39,879.65 lakhs (cap)** | **[PBA]** p.1 | — | ≈ Rs 398.80 cr at cap |
| Offer for sale (Rs) | `[•]` → **Rs 17,466.62 lakhs (floor) / Rs 18,399.95 lakhs (cap)** | **[PBA]** p.1 | — | ≈ Rs 184.00 cr at cap |
| Face value | **Rs 10 per Equity Share** | PDF p.1 | same | |
| Price band | `[•]` in RHP → **Rs 131 to Rs 138 per Equity Share** | **[PBA]** p.1 | — | Floor = 13.10× FV; Cap = 13.80× FV |
| Lot size (minimum bid lot) | `[•]` in RHP → **100 Equity Shares**, and in multiples of 100 thereafter | RHP p.577 = `[•]`; **[PBA]** p.1 | — | Minimum retail application = 100 × Rs 138 = **Rs 13,800** at cap |
| Employee discount | **None** | — | — | **There is no Employee Reservation Portion** in this offer, hence no employee discount. Verified absent from both "The Offer" (p.72) and "Offer Structure" (p.575–577) |
| Pre-IPO placement | **40,19,326 shares at Rs 120 each = Rs 4,823.19 lakhs** | PDF p.1 footnote; p.91 | Not in DRHP | Proceeds parked in FD receipts, earmarked for General Corporate Purposes; did not exceed 20% of the fresh issue |
| Selling shareholders | Yashpal Sharma up to **71,20,690**; Tarun Sharma up to **24,60,000** (Promoter Selling Shareholders); Himanshu Chhabra up to **18,66,000**; Rohit Sehgal up to **18,86,610** (Other Selling Shareholders) | PDF p.1; p.72–73 | same | Weighted average cost of acquisition = **NIL** for all four |

### 3.3 Dates (tentative timeline)

| Event | RHP value (as filed) | RHP page | Operative date (Corrigendum / PBA) | Notes |
|---|---|---|---|---|
| Anchor Investor Bid/Offer Period | "one Working Day prior to the Bid/Offer Opening Date" (no calendar date in body) | PDF p.1; p.571 | **Friday, 21 August 2026** | Explicit date on the RHP cover and in the PBA |
| Bid/Offer Opens | **Monday, 24 August 2026** | PDF p.1; p.571 (printed 569) | Monday, 24 August 2026 (unchanged) | |
| Bid/Offer Closes | Wednesday, 26 August 2026 | PDF p.1; p.571 | **Thursday, 27 August 2026** | **CHANGED by Corrigendum** — 26 Aug was a Mumbai bank holiday. UPI mandate cut-off 5:00 p.m. on 27 Aug |
| Finalisation of Basis of Allotment | On or about Thursday, 27 August 2026 | PDF p.571 | **On or about Friday, 28 August 2026** | |
| Initiation of refunds / unblocking of ASBA funds | On or about Friday, 28 August 2026 | PDF p.571 | **On or about Monday, 31 August 2026** | |
| Credit of Equity Shares to demat accounts | On or about Friday, 28 August 2026 | PDF p.571 | **On or about Monday, 31 August 2026** | |
| Commencement of trading (listing) | On or about Monday, 31 August 2026 | PDF p.571 | **On or about Tuesday, 1 September 2026** | |

### 3.4 Listing

| Field | RHP value | RHP page | Notes |
|---|---|---|---|
| Listing exchanges | **BSE Limited and National Stock Exchange of India Limited** | PDF p.1 (cover) | Main Board |
| Designated Stock Exchange | **BSE Limited** | PDF p.1 | Confirmed again in the PBA |
| ISIN | **INE0PX301025** | PDF p.534 (printed ~532); PDF p.570 (printed ~568) | Printed twice: "The ISIN of our Company is ISIN-INE0PX301025" |

### 3.5 Offer intermediaries

| Field | RHP value | RHP page | Notes |
|---|---|---|---|
| BRLM 1 | **Holani Consultants Private Limited** — 401-405 & 416-418, 4th Floor, Soni Paris Point, Jai Singh Highway, Bani Park, Jaipur 302016 | PDF p.81 (printed 79) | SEBI Reg. **INM000012467**; contact Mrs. Payal Jain; ipo@holaniconsultants.co.in |
| BRLM 2 | **Shannon Advisors Private Limited** — 902, 9th Floor, New Delhi House, Barakhamba Road, New Delhi 110001 | PDF p.81 | SEBI Reg. **INM000013174**; contact Mr. Pavan Kumar Agrawal; pavan@shannon.co.in |
| BRLM 3 | **Dolat Finserv Private Limited** — 301-308, Bhagwati House, A/19, Veera Desai Road, Andheri (W), Mumbai 400058 | PDF p.81 | SEBI Reg. **INM000012643**; contact Mr. Souvik Chatterjee; skyways.ipo@dolatfinserv.com |
| Registrar | **Bigshare Services Private Limited** — S6-2, 6th Floor, Pinnacle Business Park, Mahakali Caves Road, next to Ahura Centre, Andheri (East), Mumbai 400093 | PDF p.81 | SEBI Reg. **INR000001385**; contact Mr. Vinayak Morbale; ipo@bigshareonline.com; +91 22-6263 8200 |
| Legal counsel | **Chir Amrit Legal LLP**, 6th Floor, Unique Destination, Tonk Road, Jaipur 302015; contact Ms. Harsha Totuka | PDF p.83 (printed 81) | Listed as **Legal Advisor to the Company**. **No separately-labelled legal counsel to the BRLMs is named** |
| Statutory & Peer Review Auditor | **M/s Bhagi Bhardwaj Gaur & Co., Chartered Accountants** — 2952-53/2, Sangtrashan, Paharganj, New Delhi 110055 | PDF p.83 | **FRN 007895N**; Peer Review No. **020641** |
| Independent CA (certificates) | **S.K. Singla & Associates, Chartered Accountants** | PDF p.1 footnote; KPI notes | Certifies WACA, KPIs, issue expenses — a **different firm** from the statutory auditor |
| Sponsor Banks | **Axis Bank Limited** and **HDFC Bank Limited** | PDF p.84–85 (printed 82–83) | Both named as sponsor banks |
| Escrow Collection Bank / Refund Bank | **Axis Bank Limited** (MWBC Delhi, Pusa Road, New Delhi) | PDF p.84–85 | SEBI Reg. INBI00000017 |
| Public Offer Account Bank | **HDFC Bank Limited** (FIG-OPS, Kanjurmarg East, Mumbai 400042) | PDF p.84–85 | SEBI Reg. INBI00000063 |
| Syndicate Members | **Holani Consultants Private Limited** (SEBI Reg. INZ000299835); **Nikunj Stock Brokers Limited**, A-92 G.F. Left Portion, Kamla Nagar, New Delhi 110007 (SEBI Reg. INZ000169335) | PDF p.83 (printed 81) | |
| Monitoring Agency | **CRISIL Ratings Limited**, Crisil House, Lightbridge IT Park, Saki Vihar Road, Andheri East, Mumbai 400072 | PDF p.87 (printed 85) | SEBI Reg. IN/CRA/001/1999 |

### 3.6 Promoters and promoter shareholding

| Field | RHP value | RHP page | Notes |
|---|---|---|---|
| Promoters | **Mr. Yashpal Sharma** and **Mr. Tarun Sharma** | PDF p.1; p.360 (printed 358) | Both individuals; no corporate promoter. They are brothers |
| Yashpal Sharma — pre-issue | **5,41,41,448 shares = 46.49%** | PDF p.105 (printed 103) | Chairman & Managing Director |
| Tarun Sharma — pre-issue | **3,80,18,004 shares = 32.65%** | PDF p.105 | Whole-Time Director |
| **Total promoter pre-issue** | **9,21,59,452 shares = 79.14%** | PDF p.105; p.360 | None of the promoters' shares are pledged |
| **Total promoter post-issue** | `[•]` in RHP — **NOT STATED in any obtained document** | PDF p.105 = `[•]` | **DERIVED, not quoted: ≈ 56.82%** = (9,21,59,452 − 95,80,690 sold) ÷ 14,53,43,544 post-issue shares. Treat as computed |
| Promoter Group holding | **Nil** — promoter group members hold no equity shares as on the RHP date | PDF p.105 | |
| Promoter Group composition | 12 body corporates (incl. Zeal Global Services Ltd, VIAGEM Aviation Pvt Ltd, Pradhaan Air Express Pvt Ltd, ZIV Logistics and Shipping Pvt Ltd, Teleport Commerce IN Pvt Ltd, Sky Cargo Airport Service Pvt Ltd); 8 firms; 1 LLP (iTiger Supply Chain LLP); 10 trusts; 3 HUFs (Yashpal Sharma HUF, Tarun Sharma HUF, Sharad Sharma HUF); plus immediate relatives | PDF p.364–365 (printed 362–363) | **Caveat:** the natural-persons relative table's columns are misaligned by text extraction; individual name→relationship pairings are **not reliably verified**. Entity lists are reliable |
| Other notable shareholders (pre-issue) | Rohit Sehgal 46,65,206 (4.01%); Himanshu Chhabra 40,18,429 (3.45%); Rajiv Gul Hariramani 15,69,004 (1.35%); Shashank Mohan Jain / Samir Jain 12,50,000 (1.07%) | PDF p.105; Abridged Prospectus §5 | Sehgal, Chhabra and Hariramani are Directors |

### 3.7 Category reservation

Verified internally consistent: 2,10,80,000 + 63,51,600 + 1,48,00,000 = **4,22,31,600** = total offer.

| Category | Shares | % of offer | RHP page | Notes |
|---|---|---|---|---|
| **QIB Portion** | Not more than **2,10,80,000** | **Not more than 50%** | PDF p.72 (printed 70); p.575–577 | |
| — Anchor Investor Portion | Up to **1,26,48,000** | 60% of QIB portion | PDF p.72 | Discretionary. Up to 40% of the anchor portion reserved: 33.33% domestic Mutual Funds, 6.67% Life Insurance & Pension Funds |
| — Net QIB Portion (if anchor fully subscribed) | Up to **84,32,000** | — | PDF p.72 | |
| — — Mutual Fund Portion (5% of Net QIB) | At least **4,21,000** *(as printed)* | 5% of Net QIB | PDF p.72 | Exact 5% arithmetic = 4,21,600; the RHP prints a rounded 4,21,000 |
| — — Balance of QIB Portion | Up to **80,11,000** *(as printed)* | — | PDF p.72 | Arithmetic residual = 80,10,400; the RHP prints 80,11,000 |
| **Non-Institutional Portion (NII)** | Not less than **63,51,600** | **Not less than 15%** | PDF p.72; p.575 | |
| — sNII (one-third; bids > Rs 2.00 lakh up to Rs 10.00 lakh) | **21,17,200** | one-third of NII | PDF p.72 | 21,17,200 + 42,34,400 = 63,51,600 exactly |
| — bNII (two-thirds; bids > Rs 10.00 lakh) | **42,34,400** | two-thirds of NII | PDF p.72 | Under-subscription in either sub-category may spill to the other |
| **Retail Portion (RIB)** | Not less than **1,48,00,000** | **Not less than 35%** | PDF p.72; p.575 | |
| Employee reservation | **None** | — | — | No employee portion exists in this offer |

**Important extraction caveat:** in the raw `pdftotext -layout` dump of PDF p.72 the value column is offset **one row below** its label. The mapping above is the corrected alignment, confirmed by three independent arithmetic checks (categories sum exactly to the total offer; anchor = 60% of QIB exactly; NII thirds sum exactly to NII). A naive read of that page mis-assigns every figure.

### 3.8 Objects of the issue

| # | Object | Amount (Rs lakhs) | Rs crore | RHP page | Notes |
|---|---|---|---|---|---|
| 1 | Repayment / pre-payment, in full or part, of certain outstanding borrowings of the Company and its subsidiary **Forin Container Line Private Limited** | **21,678.67** | 216.79 | PDF p.111–113 (printed 109–111) | Entire amount scheduled for FY 2026-27 |
| 2 | Funding **incremental working capital** requirements of the Company | **13,000.00** | 130.00 | PDF p.111–113 | Split: 8,000.00 in FY 2026-27; 5,000.00 in FY 2027-28 |
| 3 | **General Corporate Purposes** | `[•]` (capped at 25% of gross fresh-issue proceeds) | — | PDF p.111–113 | Balance of net proceeds. The Rs 4,823.19 lakh pre-IPO placement is earmarked here |
| — | **Total / Net Proceeds** | `[•]` | — | PDF p.111 | Gross proceeds, offer expenses and net proceeds are all `[•]` in the RHP |

- **No capex object and no inorganic-growth/acquisition object** — the objects are only debt repayment, working capital and GCP.
- The Company receives **no proceeds from the Offer for Sale**; those go to the selling shareholders net of their share of expenses and taxes.
- The offer-expenses table is **entirely `[•]`**. One concrete figure: **Rs 363.29 lakhs of issue expenses incurred up to 15-July-2026** (certified by S.K. Singla & Associates, certificate dated 23-July-2026), PDF p.128–129.
- Selling commission rates: Retail **0.20%** of amount allotted; NII **0.15%**; SCSB processing fee Rs 10 per valid application, capped at Rs 10.00 lakhs.

### 3.9 Key financials (restated consolidated, Rs in lakhs)

**Fiscal years covered by the RHP: FY2024, FY2025, FY2026 (years ended 31 March). There is NO stub/interim period in the RHP** — the latest period is full-year FY2026.

| Metric | FY2026 | FY2025 | FY2024 | RHP page | Notes |
|---|---|---|---|---|---|
| Revenue from operations | **2,81,289.89** | 2,24,782.49 | 1,28,911.01 | PDF p.480 (printed 478); p.491 (printed 489) | ≈ Rs 2,812.90 cr in FY26. 3-yr CAGR 47.72% |
| Other income | 2,677.18 | 2,317.00 | 2,769.58 | PDF p.491 | |
| **Total income** | **2,83,967.07** | 2,27,099.49 | 1,31,680.59 | PDF p.491 | |
| **EBITDA** | **12,564.86** | 8,648.86 | 4,834.42 | PDF p.480; p.475 | CAGR 61.22% |
| EBITDA margin | 4.47% | 3.85% | 3.75% | PDF p.480 | |
| Finance costs | 4,807.64 | 2,881.38 | 1,877.40 | PDF p.491 | |
| Depreciation & amortisation | 1,666.16 | 1,369.83 | 888.55 | PDF p.491 | |
| Profit before tax | **8,768.24** | 6,714.65 | 4,838.05 | PDF p.491 | FY26 is after an exceptional item of 84.11 |
| **PAT (profit for the year)** | **6,352.38** | 4,813.97 | 3,449.35 | PDF p.491; p.480 | ≈ Rs 63.52 cr in FY26. CAGR 35.71% |
| PAT margin | 2.26% | 2.14% | 2.68% | PDF p.480 | |
| PAT attributable to parent | 4,100.88 | 3,916.86 | 3,125.00 | PDF p.475 (printed 473) | Differs from total PAT due to non-controlling interests |
| **Net worth** | **33,264.21** | 24,714.05 | 15,425.78 | PDF p.475; p.515 | Ties exactly to Total Shareholders' Funds in the capitalisation statement |
| Equity share capital | 11,644.52 | 11,242.59 | 1,043.65 | Abridged Prospectus §6 | |
| **Total borrowings** | **62,405.68** | 55,843.14 | 35,733.53 | PDF p.515 (printed 513) | FY26 split: short-term 51,616.78 + unsecured current 71.24 + secured non-current 10,717.66 |
| **EPS basic (post-bonus)** | **3.56** | 3.71 | 2.99 | PDF p.133 (printed 131) | Weighted average EPS **3.52** |
| **EPS diluted (post-bonus)** | **3.56** | 3.71 | 2.99 | PDF p.133 | Basic = diluted in all three years |
| **RoNW** | **12.33%** | 15.85% | 20.26% | PDF p.134 (printed 132) | Weighted average RoNW **14.83%** |
| **NAV per share (post-bonus)** | **28.91** | 23.40 | 14.78 | PDF p.134; p.475 | Rs per share, FV Rs 10 |
| **Debt / equity (times)** | **1.26** | 1.42 | 1.92 | **[PBA]** p.2 | Also 1.88 as Total Borrowings ÷ Shareholders' Funds in the capitalisation statement (PDF p.515) — a slightly different definition |
| **RoCE** | **18.11%** | 14.61% | 15.57% | PDF p.480 | EBIT ÷ capital employed |
| RoE | 14.15% | 19.52% | 22.37% | PDF p.480 | |
| Current ratio (times) | 1.20 | 1.17 | 1.11 | Abridged Prospectus §7 | |
| Cash flow from operations | 11,361.60 | 201.05 | (904.17) | Abridged Prospectus §6 | |
| Contingent liabilities & commitments | 28,908.02 (86.90% of net worth) | — | — | **[PBA]** p.2 | As of 31-Mar-2026 |
| Working capital gap | 31,107.09 | 23,705.89 | 24,265.23 | **[PBA]** p.2 | 86.23% / 100.00% / 82.62% funded through borrowings |

**Valuation metrics (all `[•]` in the RHP; sourced from the Price Band Advertisement):**

| Metric | Value | Source | Notes |
|---|---|---|---|
| **P/E at floor price (Rs 131)** | **36.80×** | **[PBA]** p.1 | On FY2026 diluted EPS of 3.56 |
| **P/E at cap price (Rs 138)** | **38.76×** | **[PBA]** p.1 | On FY2026 diluted EPS |
| **Industry peer average P/E** | **491×** | **[PBA]** p.1; RHP PDF p.134 | RHP prints composite **491**, highest **1,548**, lowest **54** |
| **Market cap at cap price (Rs 138)** | **Rs 2,00,574.09 lakhs = Rs 2,005.74 crore** | **[PBA]** p.1 | On 14,53,43,544 post-offer shares |
| Market cap at floor price (Rs 131) | Rs 1,90,400.04 lakhs = Rs 1,904.00 crore | **[PBA]** p.1 | |
| Weighted average RoNW, last 3 FYs | 14.83% | **[PBA]** p.1 | |

**Listed peer group comparison** (RHP PDF p.135, printed 133; peer P/E computed on NSE closing price as of 10-July-2026 ÷ FY26 diluted EPS):

| Company | FV (Rs) | Revenue from ops FY26 (Rs lakhs) | Basic EPS | Diluted EPS | NAV/share (Rs) | P/E | RoNW |
|---|---|---|---|---|---|---|---|
| **Skyways Air Services Ltd** | 10 | 2,81,289.89 | 3.56 | 3.56 | 28.91 | `[•]` in RHP → **38.76× at cap** | 12.33% |
| Delhivery Ltd | 1 | 10,50,830.70 | 2.04 | 2.00 | 129.40 | **260** | 1.58% |
| TVS Supply Chain Solutions Ltd | 1 | 11,00,297 | 2.59 | 2.59 | 46.09 | **54** | 5.62% |
| Mahindra Logistics Ltd | 10 | 6,99,930 | 0.25 | 0.25 | 130.57 | **1,548** | 0.19% |
| Shadowfax Technologies Ltd | 10 | 4,20,244 | 2.22 | 2.18 | 34.04 | **104** | 6.40% |

**Segment revenue (Rs lakhs)** — from [PBA] p.1:

| Segment | FY2026 | % of rev | FY2025 | % | FY2024 | % |
|---|---|---|---|---|---|---|
| Air Cargo Services | 2,16,639.87 | 77.02% | 1,64,076.56 | 72.99% | 1,02,099.98 | 79.20% |
| Ocean Cargo Services | 42,260.32 | 15.02% | 39,450.06 | 17.55% | 16,495.76 | 12.80% |
| Express Cargo & Parcel | 16,277.96 | 5.79% | 14,123.41 | 6.28% | 5,882.79 | 4.56% |
| **Total** | **2,75,178.15** | **97.83%** | 2,17,650.03 | 96.82% | 1,24,478.53 | 96.56% |

**DRHP financial difference (material):** the DRHP covered **FY2022, FY2023, FY2024 plus a nine-month stub ended 31-Dec-2024** (stub EPS Rs 5.84), verified at DRHP PDF p.134. Between DRHP and RHP the company rolled the base years forward two full fiscals and **dropped the stub period entirely**. Any record keyed to the DRHP's "latest period" needs updating from the Dec-2024 stub to full FY2026.

### 3.10 Business

| Field | RHP value | RHP page | Notes |
|---|---|---|---|
| Business description | "Established in 1984, Skyways Air Services Limited (SASL) is a long-standing participant of India's air freight forwarding and logistics sector. Our Company is consistently ranked No. 1 'Air Freight Forwarder' in terms of AWBs generation by World ACD for the last four calendar years 2025, 2024, 2023 and 2022. We are actively engaged in providing a comprehensive suite of services, including air freight forwarding, ocean freight forwarding, trucking, warehousing, custom broking, technology-driven express cargo and parcel delivery and a wide range of Value-Added Services (VAS)." | PDF p.252 (printed 250) | Began as a Custom House Agent (now Customs Broker) |
| Industry / sector | **Logistics — air freight forwarding** (multimodal: air, ocean, trucking, warehousing, customs broking, express cargo) | PDF p.252; p.153 (printed 151) | |
| Operating segments | Air Cargo, Ocean Cargo, Express Cargo & Parcel, Trucking, Value Added Services, Warehousing, E-commerce & Other Retail | Abridged Prospectus §1 | |
| Number of employees | **1,193** total group employee base as at FY2026 end (FY25: 1,163; FY24: 950) | PDF p.290 (printed 288) | **Conflicting figures exist in the document:** the Human Resources section (PDF p.291) states **320 employees** for the standalone company as of 30-June-2026 plus 33 on contract; a passage on PDF p.262 refers to "our workforce of over 400 employees". All three appear verbatim; 1,193 is the consolidated group KPI |
| Key strengths (headlines) | 1. Experienced Promoters; 2. Comprehensive range of logistics solutions; 3. Broad network of partners that enhances reach; 4. Long-standing business relationships with clientele; 5. Strong collaboration with a diverse and wide-ranging customer base; 6. Information Technology and its infrastructure driving operational effectiveness | PDF p.259 (printed 257) | |
| Strategies (headlines) | 1. Keep growing and strengthening the scope of current business operations; 2. Increase the development of infrastructure; 3. Strengthen and enhance connections with customers; 4. Improve and strengthen technological abilities (software and hardware); 5. Venture into rapidly developing global markets; 6. Diversification of service portfolio | PDF p.263 (printed 261); Abridged Prospectus §1 | Strategies 5–6 confirmed via the Abridged Prospectus |
| Scale / reach | 6 continents; 12 Indian states including 1 UT; **9,504** customers served FY26; **83,923.81 tonnes** air cargo handled FY26; **28,275 TEU** ocean containers FY26; relationships with **56 airlines**; 1,204 pin codes for express cargo; 31 PUD centres; 5 warehouses | PDF p.290; **[PBA]** p.1–2 | Overseas subsidiaries generated ~11.29% of total revenue in FY26 |
| Customer concentration | Top 5 customers = 14.04% (FY26), 8.03% (FY25), 7.96% (FY24) of revenue from operations | Abridged Prospectus §1 | |
| Supplier concentration | Top 5 suppliers = 36.01% (FY26), 31.20% (FY25), 38.29% (FY24) of cost of service | **[PBA]** p.2 | Top 10 = 49.00% / 46.93% / 54.31% |
| Geographic concentration | Asia 85.51% of total revenue FY26; Europe 5.92%; North America 5.85%; South America 2.63%; Oceania 0.05%; Africa 0.04% | **[PBA]** p.2 | |

### 3.11 Capital structure

| Field | RHP value | RHP page | Notes |
|---|---|---|---|
| Authorised share capital | **16,20,00,000 Equity Shares of Rs 10 each = Rs 16,200.00 lakhs** | PDF p.91 (printed 89) | Rs 162.00 crore |
| Issued/subscribed/paid-up **before** the offer | **11,64,45,244 Equity Shares of Rs 10 each = Rs 11,644.52 lakhs** | PDF p.91; p.72 | |
| Paid-up **after** the offer | `[•]` in RHP → **14,53,43,544 Equity Shares** | RHP p.91 = `[•]`; **[PBA]** p.1 | 11,64,45,244 + 2,88,98,300 fresh issue = 14,53,43,544 — arithmetic confirms the PBA figure |
| Securities premium before the offer | Rs 9,952.95 lakhs | PDF p.515 (printed 513) | After the offer: `[•]` |
| Total capitalisation (pre-offer) | Rs 95,669.89 lakhs (borrowings 62,405.68 + shareholders' funds 33,264.21) | PDF p.515 | |
| Minimum promoters' contribution / lock-in table | `[•]` — entirely blank | PDF p.108 (printed 106) | "To be updated at the Prospectus stage" |

### 3.12 Risk factors and document size

| Field | Value | Notes |
|---|---|---|
| Number of numbered risk factors | **72** | Numbered 1 to 72 with no gaps. Risk #1: "Our 100% dependency on carriers for cargo transportation..."; Risk #72: "Future issuances or sales of the Equity Shares could dilute your shareholding..." |
| Risk Factors section span | RHP **printed pages 29–69** = **PDF pages 31–71** = **41 pages** | Followed immediately by "SECTION III — INTRODUCTION" on PDF p.72 |
| **Total RHP pages** | **644** | |
| **Total DRHP pages** | **564** | |

Top risks highlighted in the Price Band Advertisement: 100% dependency on third-party carriers; supplier concentration; geographic concentration (Asia 85.51%); an **FIR alleging criminal breach of trust, cheating, fraud and corruption** against the Company, its material subsidiary Brace Port Logistics Limited and seven other parties; revenue growth sustainability; high working capital requirements; contingent liabilities Rs 28,908.02 lakhs; litigation; regulatory compliance (including suspension and subsequent restoration of the AEO-LO certificate); dependence on air cargo; contracted container capacity utilisation.

Litigation summary (PBA p.2): against the Company — 1 criminal, 2 statutory/regulatory and 9 tax proceedings aggregating Rs 3,752.49 lakhs; against subsidiaries — 2 criminal, 2 statutory/regulatory and 29 tax cases aggregating Rs 640.72 lakhs; initiated by the Company and subsidiaries — 10 criminal and 2 civil proceedings involving Rs 1,588.59 lakhs.

---

## 4. Fields NOT found

| Field | Status |
|---|---|
| **Post-issue promoter shareholding %** | `[•]` in the RHP; not stated in the corrigendum, price band advertisement, abridged prospectus or either addendum. The **≈56.82%** shown above is **my arithmetic**, not a document value |
| **Total assets** | Not reliably extractable. The Restated Consolidated Financial Information chapter (PDF p.374–474, ~100 pages) has **no text layer** — its tables are images. The one balance-sheet table in MD&A (PDF p.482) has scrambled row/column alignment. Not requested in the brief, but flagged since net worth and borrowings had to be sourced from elsewhere |
| **Full restated balance sheet, cash flow statement and notes** | Same cause as above — would need OCR of PDF p.374–474 |
| **Legal counsel to the BRLMs** | No separately-labelled BRLM counsel appears in General Information; only Chir Amrit Legal LLP as counsel to the Company |
| **Anchor Investor Bid date in the RHP body** | RHP p.571 states only the rule ("one Working Day prior"); the calendar date 21-Aug-2026 appears on the RHP cover and in the PBA |
| Gross/net proceeds, GCP amount, offer-expenses breakup, post-offer NAV, post-offer securities premium | All `[•]` in the RHP by design (fixed at the Prospectus stage) |
| Promoter-group individual name→relationship pairings | Table columns misaligned by text extraction; entity lists reliable, individual pairings not |

---

## 5. Working files

Scratchpad: `C:\Users\itsab\AppData\Local\Temp\claude\D--Abhay-Ventures-IPODhan\9439fb40-bfcd-4557-8e1e-82583140a43c\scratchpad\`

- `pdfs/` — all eight downloaded PDFs
- `rhp.txt` (2.35 MB), `drhp.txt` (1.93 MB), `abr.txt`, `Price-Band-Advertisement.txt` — `pdftotext -layout` dumps, pages separated by form-feed
- `pg.py` — helper: `python pg.py rhp.txt <start> <end>` prints those PDF pages
- `corr_small_p*.png`, `pba_p*.png`, `ad1_p*.png`, `ad2_p*.png` — rendered images of the scanned newspaper documents (these have no usable text layer; the corrigendum additionally has a broken font encoding that yields mojibake, so it must be read as an image)
