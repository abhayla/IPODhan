# Data sourcing: the pull model

> ### Status — NOT SAFE TO BUILD FROM
>
> Reviewed 2026-09-08 by four independent passes (author, IPO domain, engineering, verification
> model). **55 raw findings, consolidated to 40 tracked items; 14 critical.** Status per finding is
> in `findings.json`, which is the register — not this document. As of the last check, **11 critical
> findings are OPEN**.
>
> **Sections §0, Appendix A.0 and A.3 survive review. §1.2.1, §2, §3, §4 and §6 are being re-cut.**
> Do not implement from those sections.
>
> **Scope (owner, 2026-09-08): phase 1 is open and upcoming IPOs only — 19 today, all plain `IPO`,
> mainboard or SME.** No closed IPO is touched. Closed IPOs follow afterwards, one at a time, newest
> close date first. This scope removes 8 of the 40 findings, which reopen for phase 2.
>
> Run `node docs/design/check-design-consistency.mjs --gate` before trusting any count in here.
Author: this session, 2026-09-08. Origin: owner comment O-8 in `docs/ops/work-tracker.md`.

Abhay's requirement, in his words: *"almost ninety percent of our data should come from the offer
documents. These are the primary source. All those websites are only for verification. They are not
the source of the data."*

Every number in this document was measured during this session against the production database
through the read-only tunnel, or read out of the named file. Nothing is carried forward from an
earlier note. Where a measured number differs from an earlier one, the measured one is used and the
difference is stated.

---

## 0. What is true today, measured

### 0.1 Where the data actually comes from

`field_sources` on production, 2026-09-08 ~14:48 IST. This is the provenance table: one row per
(IPO, table, field), holding which source last wrote it.

| Source | Records | Share |
|---|---:|---:|
| Chittorgarh (website) | 4,635 | 69.8% |
| BSE | 801 | 12.1% |
| **Offer documents** (`DRHP` slot) | **595** | **9.0%** |
| NSE | 393 | 5.9% |
| Moneycontrol (website) | 206 | 3.1% |
| Admin (manual) | 8 | 0.1% |
| **Total** | **6,638** | |

**The target is 100% of the fields the offer document prints** (owner, 2026-09-08 — see §2.1.1).
Not a blended share: every field the document carries comes from the document, and each exception is
named. Measured on the best-covered IPO on production, that set is 56 fields and 47 of them come
from the document today (84%); on the typical IPO it is zero.

**But that single number hides the real diagnosis.** Split the same table by which table the field
lives in:

| Table the field belongs to | Provenance rows | From documents | Share |
|---|---:|---:|---:|
| `ipos` — the core row | 6,216 | 173 | **2.8%** |
| `financial_data` | 160 | 160 | 100% |
| `ipo_details` | 143 | 143 | 100% |
| `ipo_risk_factors` | 26 | 26 | 100% |
| `financial_statements` | 25 | 25 | 100% |
| `documents` | 24 | 24 | 100% |
| `ipo_intermediaries` | 22 | 22 | 100% |
| `ipo_valuation` | 14 | 14 | 100% |
| `promoters` | 7 | 7 | 100% |
| `peer_companies` | 1 | 1 | 100% |

Every table except `ipos` is **already 100% document-sourced**, because only the document path ever
writes them. Inside `ipos`, Chittorgarh alone holds 74.6% and the document holds 2.8%.

So this is not a ranking problem and never really was. **Where the document path runs, it already
wins everything it touches. It runs on 27 of 327 IPOs.** The problem is reach, and the pull model is
the fix for reach.

### 0.2 The headline fields, document against website

Same table, same moment. Every one of these six is printed on the front page of the offer document.

| Field | From documents | From websites (CG + MC) | From exchanges (NSE + BSE) |
|---|---:|---:|---:|
| Issue size | 4 | 221 | 56 |
| Price band (min / max) | 2 | 154 | 128 |
| Lot size | 2 | 157 | 52 |
| Lead managers | 2 | 224 | 63 |
| Registrar | 1 | 222 | 66 |
| ISIN | 13 | 233 | 43 |

### 0.3 Why the priority list does not fix this

The offer document has ALREADY outranked the websites for issue size since 9db4529d merged this
morning (O-5). It still supplied that value 4 times against 277. The reason is structural, and it is
the whole point of this design:

> The write path is PUSH. Each scraper wakes on its own schedule, scrapes whatever it can see, and
> calls `DataConsolidationOrchestrator.consolidatedUpsertIPO(scrapedIPO, source, confidence)` with
> exactly ONE source at a time. That function compares the arriving value against the stored one,
> looks both up in `field-priority-matrix.ts`, and keeps the higher-ranked one
> (`data-consolidation-service.ts`, reason `SOURCE_PRIORITY`).

A ranking can only decide a contest between sources that both turned up. If the document extractor
never runs for an IPO, the document's value never enters the comparison and its rank is irrelevant.
**The websites are not winning an argument. They are the only source that showed up.**

### 0.4 How little of the document path reaches an IPO

| Measure | Count | Of 327 IPOs |
|---|---:|---:|
| IPOs on production | 327 | 100% |
| IPOs with any document stored | 116 | 35% |
| IPOs with any document extracted | 27 | 8.3% |
| IPOs with any document-sourced field | 27 | 8.3% |

Documents by type and extraction status (`documents`, 256 rows):

| Group | COMPLETED | PENDING | FAILED | MANUAL_REVIEW |
|---|---:|---:|---:|---:|
| Types the extractor understands (DRHP, RHP, PROSPECTUS, PRICE_BAND_AD) | 60 | **91** | 4 | 0 |
| Anchor allocation report (its own extractor) | 2 | 7 | 2 | 12 |
| Types with **no extractor at all** | 0 | **78** | 0 | 0 |

The 78 with no extractor: ratios / basis-for-offer-price 32, security parameters 23, sample
application forms 14, bidding centres 8, basis-of-allotment advertisement 1.

**176 of 256 stored documents have never been opened. 91 of those are types we can already read.**

### 0.5 The three hard limits this design must live inside

Read out of the code this session:

- `CYCLE_BUDGET.EXTRACTIONS_PER_CYCLE = 1` (`document-state-machine.ts`), with the runtime spawn
  budget `DEFAULT_MAX_SPAWNS_PER_CYCLE = 3` filings plus
  `DEFAULT_ANCHOR_MAX_SPAWNS_PER_CYCLE = 1` anchor (`filing-auto-persist.ts`).
- `EXTRACT_TIMEOUT_MS = 10 * 60 * 1000` — ten minutes per document, inside a
  `DEFAULT_WAKE_BUDGET_MS = 20 * 60 * 1000` wake shared with everything else.
- `LIVE_WINDOW_DAYS_AFTER_LISTING = 10` — an IPO listed more than ten days ago gets **no document
  state rows at all**.

That last one is the migration blocker, and it is bigger than it looks:

| Bucket | IPOs |
|---|---:|
| UPCOMING / OPEN / CLOSED (document work allowed) | 76 |
| LISTED within 10 days (document work allowed) | 23 |
| **LISTED more than 10 days ago (no document work at all)** | **228** |

**70% of the site's IPOs sit structurally outside the document path.** And their PDFs are gone:
`document-store.ts` purges an IPO's directory at `close_date + DEFAULT_RETENTION_DAYS (7)`, with a
hard ceiling of `DEFAULT_MAX_RETENTION_DAYS = 30` and `DEFAULT_MAX_STORE_GB = 5`. The database rows
and the source URLs survive; the files do not.

### 0.6 The matrix has forgotten two thirds of the site

Built from `packages/shared/src/db/schema.ts` (35 tables, 574 real columns), the live API responses,
and the repositories `web/app/ipos/[slug]/page.tsx` loads — deliberately NOT from the priority
matrix, so a field the matrix forgot still appears.

| | Count |
|---|---:|
| Publishable columns across the 18 published tables | 307 |
| **Populated on production — this mapping's scope** | **194** |
| Entirely empty on production | 113 |
| Distinct keys in `field-priority-matrix.ts` | 77 |
| **Populated published fields the matrix covers** | **64** |
| **Populated published fields with NO matrix entry** | **130** |

Two thirds of what the site publishes has no source ranking at all. That includes everything the
document work of the last month created — `ipo_valuation` (17 live fields), `financial_statements`
(11), `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`,
`documents.filing_date` — and all 23 live `ipo_details` fields. For 130 fields there is no argument
for the document to win.

Also: 13 of the 77 matrix keys are dead duplicates in the wrong case (`close_date` beside
`closeDate`, `lot_size` beside `lotSize`, `revenue_fy1` beside `revenueFy2022`). Consolidation
writes camelCase, so the snake_case entries match nothing and never have.

### 0.7 Verification exists; nothing consumes it

`data_conflicts` holds 31,014 rows on production. **2,398 are unresolved**, including all 578
`leadManagers` conflicts and 495 of the `faceValue` ones. We already detect that two sources
disagree and we already write it down. What does not exist is any path from that row back to the
IPO's own document to settle it. The nightly audit reads our own rows; the reverse sweep
(`scripts/audit-reverse-sweep.mjs`) checks whether an IPO exists at all, not whether its values are
right.

### 0.8 Money is stored in four different units

Measured, not read off a comment:

| Table and field | Unit actually stored | Evidence (min / median / max) |
|---|---|---|
| `ipos.issue_size` | **rupees** | 50,000 / 563,500,800 / 106,030,000,000 |
| `ipo_details.fresh_issue`, `ofs_issue` | **rupees** | 600,000,000 / — / 7,329,740,000 |
| `ipo_valuation.mcap_at_floor/cap` | **rupees** | 17,014,000,000 / — / 78,581,730,000 |
| `financial_data.*` (market cap, net worth, income, EBITDA, …) | **crore** | market cap 40.46 / 172.17 / 50,095.75 |
| `anchor_investors.total_amount_raised` | **crore** | 12.81 / — / 216.00 |
| `financial_statements.revenue / total_income / ebitda / pat / net_worth / op_cash_flow` | **whatever the document printed**, tagged per row by the `unit` column | 55 rows MILLION, 10 rows LAKH |

Four units, six tables, one concept. `financial_statements` does not normalise at all — it stores
the document's own unit and leaves the conversion to whoever reads it.

### 0.9 A live defect this design has to fix, not merely describe

`financial_data` has hard-coded `*Fy2022`, `*Fy2023`, `*Fy2024` columns. Annu Projects Limited's
offer document reports five fiscal years, FY2022 through FY2026, and all five are already in our
`financial_statements` table. The two newest have nowhere to go.

Checked against the live site this session
(`GET https://ipodhan.com/api/ipos/annu-projects-ltd/financials`): the newest total income
ipodhan.com publishes is **FY2024, ₹155.42 crore**. The document says **FY2026, ₹244.59 crore**.
We hold the right number and publish one two years out of date.

---

## 1. The field mapping

### 1.1 How to read it

All 194 populated published fields are here. **§1 gives the reasoning per group; Appendix A gives the
implementable per-field table with per-type variations, and where the two differ Appendix A wins.** Each falls into one of six classes, and the class
decides whether a source ranking is even meaningful:

| Class | Meaning | Ranking |
|---|---|---|
| **D** | The offer document prints it | 1 document · 2 exchange · 3 website |
| **T** | The bidding timetable — **named exception E-1** (§1.2.1) | 1 NSE · 2 BSE · 3 website; document is not a source |
| **X** | Other live or exchange-governed data (subscription, demand graph) | 1 exchange · 2 website · 3 document |
| **W** | Neither document nor exchange publishes it (grey market) | website only |
| **M** | Market data after listing | 1 exchange · 2 website |
| **C** | We compute it; it has no external source | formula + named inputs, no ranking |
| **I** | Our own pipeline produces it (bookkeeping) | writer named, no ranking |

Class counts across the 194, computed from the field list rather than estimated:
**D 117 · T 12 · X 13 · M 4 · W 1 · C 11 · I 36 = 194** (authoritative count, from the generated
spec in Appendix A — an earlier estimate in this section was slightly off and Appendix A wins). The
pull loop walks the D, T, X, W and M fields — **147 of the 194**. The 12 T fields are the named
exception E-1 (§1.2.1) and are the only fields excluded from the 100% rule. The 11 C fields are recomputed after their inputs settle. The 33 I fields are written by
the pipeline itself and are never sourced.

**Document type order inside rank 1**, inherited from 9db4529d: for price-dependent fields
`PRICE_BAND_AD / CORRIGENDUM > RHP > PROSPECTUS > DRHP`; for final post-issue facts
`PROSPECTUS > CORRIGENDUM > PRICE_BAND_AD > RHP > DRHP`. A newer document can heal an older one; an
older draft can never overwrite a final advertisement.

Source labels: `DOC` = the IPO's own offer document, best available type · `NSE` · `BSE` ·
`CG` = Chittorgarh · `MC` = Moneycontrol · `IG` = InvestorGain (grey market) · `REG` = the
registrar's own site · `ADMIN` = manual, always above every rank.

`rows` = production population measured this session. `unit` — `keep` means no change; **`→ Cr`**
marks an O-2 conversion. "Doc §" cites `docs/reviews/wp-c-extraction-contract.md` §1 groups A–F
where that contract already names the section; new rows extend it in the same shape.

### 1.2 `ipos` — the core row (32 live fields)

| # | Field | rows | Cls | 1 | 2 | 3 | Unit | Doc § | Check before write | Verify against / disagreement means | Exceptions by type |
|---|---|---:|---|---|---|---|---|---|---|---|---|
| 1 | `symbol` | 259 | D | DOC | NSE | BSE | keep | E7 cover | `^[A-Z0-9&-]{1,20}$`; matches the exchange's symbol for the same ISIN | NSE + BSE. Disagreement = re-read the cover. | SME/BSE: BSE is rank 2, NSE absent |
| 2 | `company_name` | 327 | D | DOC | NSE | BSE | keep | cover | legal-name form (ends Limited/Ltd); normalised name matches the exchange's ±1 token | CG, MC. Disagreement on the legal suffix is not a conflict; a different entity is. | — |
| 3 | `issue_size` | 327 | D | DOC | BSE | CG | **→ Cr** | A5+A6 | `fresh + OFS = total ±0.5%`; `shares_at_cap × cap ≈ total ±0.5%`; > ₹1 cr and < ₹50,000 cr | CG, MC, BSE. Disagreement = re-read A5/A6 from the PBA, never adopt the website number. | Rights/OFS/NCD: no PBA — rank 1 becomes the offer letter, rank 2 BSE |
| 4 | `lot_size` | 266 | D | DOC | BSE | NSE | keep | A3 | `lot × floor ≥ ₹10,000` mainboard; `≥ ₹1,00,000` SME (2 lots × ₹50k floor, SEBI 2025) | NSE, BSE, CG. | **SME: minimum application is 2 lots since SEBI's 2025 rule** — the check is on `2 × lot × floor`, which is what caused the Qualiance false alarm |
| 5 | `open_date` | 327 | **T** | **NSE** | **BSE** | CG | keep | B2 | `open ≤ close`; within 90 days of the RHP filing date | the other exchange, then CG. **The document is NOT a verification source** — see §1.2.1 | **Named exception E-1 (§1.2.1).** Owner decision 2026-09-08. |
| 6 | `close_date` | 327 | **T** | **NSE** | **BSE** | CG | keep | B2 | `close ≥ open`; `close ≤ open + 10` working days | as 5 | **Named exception E-1** |
| 7 | `listing_date` | 266 | **T** | **NSE** | **BSE** | CG | keep | B6 | `listing > close`; `listing ≤ close + 3` working days (T+3) | as 5 | **Named exception E-1** |
| 8 | `status` | 327 | **T** | **NSE** | **BSE** | CG | keep | — | must be a legal transition (UPCOMING→OPEN→CLOSED→LISTED); never regresses without an ADMIN row | our own date arithmetic. A status contradicting the dates is a conflict. | **Named exception E-1.** WITHDRAWN / POSTPONED only from the exchange or ADMIN |
| 9 | `registrar` | 267 | D | DOC | BSE | CG | keep | E3 | resolves to a row in `registrars` by name or SEBI reg no. | CG, MC. Disagreement = re-read E3. | — |
| 10 | `registrar_id` | 267 | **C** | — | — | — | keep | — | FK resolved from field 9 | derived; never sourced | — |
| 11 | `rating_override` | 327 | **I** | ADMIN | — | — | keep | — | boolean, admin-only | — | — |
| 12 | `slug` | 327 | **C** | — | — | — | keep | — | `generateIPOSlug(company_name)`; unique; old slug written to `ipo_slug_redirects` | — | — |
| 13 | `sector` | 196 | D | DOC | CG | MC | keep | F1 | non-empty, from the fixed sector list | CG. | — |
| 14 | `price_range_min` | 300 | D | DOC | NSE | BSE | keep | A1 | `floor < cap`; `cap ≤ 1.2 × floor` mainboard, `≤ 1.4 ×` SME; `floor ≥ face_value` | NSE, BSE, CG. Disagreement = re-read the PBA cover. | Fixed-price issues: floor = cap; the ratio check is skipped |
| 15 | `price_range_max` | 300 | D | DOC | NSE | BSE | keep | A1 | as 14 | as 14 | as 14 |
| 16 | `last_scraped_at` | 327 | **I** | — | — | — | keep | — | pipeline clock, UTC | — | — |
| 17 | `listing_exchanges` | 327 | **T** | **NSE** | **BSE** | CG | keep | A15 | non-empty subset of {NSE, BSE}; an SME row may not claim both unless both confirm | the other exchange | **Named exception E-1.** Also **the only field that distinguishes SME-on-NSE from SME-on-BSE** — `ipos.exchange` is NULL on all 327 rows and `bse_scrip_code` on 0 of 327 |
| 18 | `face_value` | 327 | D | DOC | BSE | NSE | keep | A2 | one of {1,2,5,10}; `floor ≥ face_value` | CG. | — |
| 19 | `allotment_date` | 239 | **T** | **NSE** | **BSE** | CG | keep | B3 | `> close`, `< listing` | as 5 | **Named exception E-1** — it moves whenever the window moves |
| 20 | `company_description` | 159 | D | DOC | CG | MC | keep | F1 | ≤ 1,200 chars; no boilerplate ("The company was incorporated…" alone fails) | CG. | — |
| 21 | `lead_managers` | 231 | D | DOC | BSE | CG | keep | E1 | non-empty array; each name resolves or is recorded as new; count matches `bse_payload_lead_manager_count` when present | BSE, CG. **578 unresolved conflicts today** — this field is the re-read loop's first customer. | — |
| 22 | `isin` | 150 | D | DOC | NSE | BSE | keep | E7 | `^INE[A-Z0-9]{9}$`; check digit valid | NSE, BSE. | Pre-listing an ISIN may not exist yet → `NOT_AVAILABLE_YET`, not a failure |
| 23 | `segment` | 321 | D | DOC | NSE | BSE | keep | A15 | MAINBOARD or SME; must agree with the lot-value check in field 4 | NSE, BSE, CG. | — |
| 24 | `offering_type` | 327 | D | DOC | BSE | CG | keep | A11 | one of the 14 enum values; `IPO` requires a DRHP or RHP to exist | BSE `IR_flag`, CG. A corporate action mis-typed as an IPO is the Mopshop/Sarda class. | **No matrix entry today** despite being the field that decides whether a row belongs on the site at all |
| 25 | `scraper_locked` | 327 | **I** | ADMIN | — | — | keep | — | admin-only | — | — |
| 26 | `last_manual_edit_at` | 87 | **I** | — | — | — | keep | — | set by the admin write path | — | — |
| 27 | `objectives` | 137 | D | DOC | CG | MC | **→ Cr** | F4 | sum of objects + GCP ≈ net proceeds ±1%; GCP ≤ 25% of gross | CG. | Rights/OFS: no objects section; expect empty, not a gap |
| 28 | `bse_ipo_no` | 10 | **I** | BSE | — | — | keep | — | integer from the BSE payload | — | BSE-listed only |
| 29 | `bse_payload_lead_manager_count` | 10 | **I** | BSE | — | — | keep | — | integer; used only as the cross-check in field 21 | — | BSE-listed only |
| 30 | `company_website` | 30 | D | DOC | CG | — | keep | E7 | resolves over HTTPS; same registered domain as the filing | — | — |
| 31 | `verifier_url` | 213 | **I** | — | — | — | keep | — | our own audit pointer | — | — |
| 32 | `cin` | 27 | D | DOC | — | — | keep | E7 | `^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$` | MCA lookup (not built). No second source exists — a document-only field. | — |

### 1.2.1 Named exception E-1 — the bidding timetable stays on the exchanges

**Owner decision, 2026-09-08: "keep those five on the exchange, as a written, named exception to the
100% rule. For these fields, make NSE and BSE as first and second source."**

This is the ONLY standing exception to the 100% rule in §2.1.1. It is written here, named, and
counted — never applied silently.

**Source order for every field in E-1:** round 1 **NSE**, round 2 **BSE**, round 3 Chittorgarh.
The offer document is not a source for these fields at any round.

**Why.** The price band advertisement does print an indicative timetable, so by the letter of the
100% rule these would be document fields. But the advertisement is printed once and **is never
reissued when a company extends its bidding window.** NSE and BSE update the same day; the PDF does
not. Sourcing these from the document would publish a stale close date on a live IPO — the single
most damaging error this site can make, and the reason the W-117 rule exists.

**The fields in E-1 — twelve.** The owner named five and then directed (2026-09-08): *"list the
full timetable family for me to see and understand. Apply the same rule to all the timetable
fields."* The full family, established by walking every date- and schedule-like field among the 194
and testing each against one question — **does this value change when the bidding window changes?**

| # | Field | Contract § | Rows | Source today | Effect of E-1 |
|---|---|---|---:|---|---|
| 1 | `anchor_investors.bid_date` | B1 | 2 | document (no provenance row) | **flips to exchange-first** |
| 2 | `ipos.open_date` | B2 | 289 | 236 web · 50 exch · 3 doc | already exchange-first; websites demoted to round 3 |
| 3 | `ipos.close_date` | B2 | 289 | 237 web · 49 exch · 3 doc | as 2 |
| 4 | `ipos.allotment_date` | B3 | 289 | 234 web · 49 exch · 6 doc | **6 document values flip** |
| 5 | `ipo_details.basis_of_allotment_date` | B3 | 3 | 3 doc (100%) | **flips** |
| 6 | `ipo_details.initiation_of_refunds_date` | B4 | 7 | 7 doc (100%) | **flips** |
| 7 | `ipo_details.credit_of_shares_date` | B5 | 3 | 3 doc (100%) | **flips** |
| 8 | `ipos.listing_date` | B6 | 289 | 238 web · 51 exch · 0 doc | already exchange-first |
| 9 | `anchor_investors.lock_in_50_percent_date` | — | 2 | document (no provenance row) | **flips** — it is allotment + 30 days, so it moves with field 4 |
| 10 | `anchor_investors.lock_in_remaining_date` | — | 2 | document (no provenance row) | **flips** — allotment + 90 days |
| 11 | `ipos.status` | — | 289 | 230 web · 56 exch · 3 doc | named by the owner; position in the timetable |
| 12 | `ipos.listing_exchanges` | A15 | 208 | 161 web · 23 exch · 24 doc | named by the owner; **24 document values flip** |

**Deliberately NOT in E-1, and why.** Two fields sit in the same printed table but cannot go stale,
because they hold a **time of day rather than a date**: when a window is extended the date moves,
5 PM is still 5 PM.

| Field | § | Rows | Reason it stays document-first |
|---|---|---:|---|
| `ipo_details.upi_cutoff_time` | B7 | 9, all document | clock time, not a date |
| `ipo_details.bid_windows` | B8 | 10, all document | per-investor-class clock windows, not dates |

Three more date fields stay document-owned because they record history rather than schedule:
`documents.filing_date` (26 rows — the RoC filing date never moves, and the document-type healing
rule in §6.2 depends on it), `brlm_track_record.as_of_date`, and `ipo_details.designated_exchange`
(a structural fact of the offer, not a schedule item).

Adding the two clock-time fields to E-1 would cost nothing operationally, but it would put fields in
the exception list that the exception's own reason does not cover — which is how an exception list
becomes a dumping ground. E-1 is held to exactly the fields that can go stale. If the owner would
rather they be included for consistency, it is a two-row change here.

**On SME.** The order is NSE then BSE as instructed. For a single-exchange IPO the absent exchange
simply has no payload and answers `NOT_PRINTED` at zero cost — an SME-on-BSE IPO therefore resolves
on BSE in round 2, and an SME-on-NSE IPO on NSE in round 1. No separate rule is needed; the existing
per-type source resolution in §2.2 handles it. Measured population: 106 SME-on-BSE, 61 SME-on-NSE.

**The document is deliberately NOT a verification source for E-1 fields.** A printed date and an
extended date legitimately differ, so comparing them would generate a permanent stream of false
disagreements and bury the real ones. Verification for E-1 is the other exchange, plus our own date
arithmetic (`open ≤ close < allotment < refund ≤ credit < listing`, and `listing ≤ close + 3`
working days).

**E-1 is counted, not hidden.** Check 4.3b reports the twelve E-1 fields as a fixed, named exclusion
alongside the round-1 yield, so "100% of document-owned fields" is always read against a visible
list of what was excluded and why. If that list ever grows without a decision recorded here, check
4.6 alarms.

### 1.3 `ipo_details` — issue mechanics (23 live fields)

Every field here is class **D**: the offer document is the only place these are printed in full.
Rank 2 is the exchange circular where one exists, rank 3 Chittorgarh's detail page.
**None of the 23 has a matrix entry today.** `ipo_details` exists for only 20 of 327 IPOs.

| # | Field | rows | 1 | 2 | 3 | Unit | Doc § | Check | Verify / disagreement | Exceptions |
|---|---|---:|---|---|---|---|---|---|---|---|
| 33 | `company_description` | 9 | DOC | CG | MC | keep | F1 | ≤ 1,200 chars | CG | duplicate of `ipos.company_description`; §5.5 says which one wins |
| 34 | `issue_type` | 15 | DOC | BSE | CG | keep | A11 | BOOK_BUILDING / FIXED_PRICE / HYBRID; FIXED_PRICE requires floor = cap | CG | SME is commonly FIXED_PRICE — not an anomaly |
| 35 | `fresh_issue` | 8 | DOC | BSE | CG | **→ Cr** | A5 | `fresh + OFS = issue_size ±0.5%` | CG | OFS-only: legitimately 0, not missing |
| 36 | `ofs_issue` | 4 | DOC | BSE | CG | **→ Cr** | A6 | as 35 | CG | fresh-only: legitimately 0 |
| 37 | `face_value` | 14 | DOC | BSE | — | keep | A2 | equals `ipos.face_value` | `ipos.face_value` — a mismatch is an internal conflict, not a source conflict | — |
| 38 | `basis_of_allotment_date` | 3 | **NSE** | **BSE** | CG | keep | B3 | `> close < listing` | the other exchange | class **T**, **named exception E-1** |
| 39 | `initiation_of_refunds_date` | 7 | **NSE** | **BSE** | CG | keep | B4 | `≥ allotment` | the other exchange | class **T**, **named exception E-1** |
| 40 | `credit_of_shares_date` | 3 | **NSE** | **BSE** | CG | keep | B5 | `≥ refunds`, `≤ listing` | the other exchange | class **T**, **named exception E-1** |
| 41 | `exchanges` | 20 | DOC | NSE | BSE | keep | A15 | equals `ipos.listing_exchanges` | internal | — |
| 42 | `data_source` | 20 | **I** | — | — | keep | — | our own label | — | — |
| 43 | `last_verified_at` | 20 | **I** | — | — | keep | — | pipeline clock | — | — |
| 44 | `compliance_officer` | 10 | DOC | — | — | keep | E4 | non-empty person name | none — document-only | — |
| 45 | `compliance_officer_phone` | 5 | DOC | — | — | keep | E4 | Indian phone form | none | — |
| 46 | `compliance_officer_email` | 8 | DOC | — | — | keep | E4 | email form; domain matches the company website | none | — |
| 47 | `upi_cutoff_time` | 9 | DOC | NSE | — | keep | B7 | time-of-day on the close date | NSE circular | — |
| 48 | `designated_exchange` | 8 | DOC | NSE | BSE | keep | A14 | one of {NSE, BSE}; must be in `listing_exchanges` | internal | SME-on-BSE: always BSE |
| 49 | `lot_multiple` | 8 | DOC | BSE | — | keep | A3 | positive integer; `lot_multiple × lot × floor` is the true minimum | BSE | **SME: 2 since the 2025 rule** — this is the field that records it, rather than doubling `lot_size` |
| 50 | `allocation_pct` | 6 | DOC | NSE | — | keep | A13 | QIB + NII + retail ≤ 100; book-built QIB ≥ 50 (≥ 75 where the regulation is cited) | NSE circular | Fixed-price SME: different split, check relaxed to ≤ 100 only |
| 51 | `pre_ipo_placement` | 5 | DOC | — | — | keep | D6 | boolean | none | absent for Rights/OFS |
| 52 | `bid_windows` | 10 | DOC | NSE | — | keep | B8 | each window inside open..close | NSE | — |
| 53 | `promoter_shares_held` | 1 | DOC | — | — | keep | D2 | `≤ total pre-issue shares` | none | — |
| 54 | `sebi_regulation_cited` | 6 | DOC | — | — | keep | A12 | matches `Reg \d+\(\d+\)` | none | — |
| 55 | `promoter_group_transactions_since_drhp` | 3 | DOC | — | — | keep | D7 | array; empty is a valid answer and must be stored as empty, not null | none | only meaningful when a DRHP preceded the RHP |

### 1.4 `financial_data` — the legacy financial row (26 live fields)

All class **D**, rank 1 DOC, rank 2 CG, rank 3 MC. All already stored in **crore** — this table is
the unit the rest of the database should move to, not away from.

**This whole table is on notice.** Its `*Fy2022/23/24` columns are hard-coded fiscal years, and
§0.9 shows that costs us the two newest years on a live IPO. §5.2 proposes `financial_statements`
becomes the source of truth and `financial_data` becomes a derived view of its three newest years.

| # | Fields | rows | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|
| 56–58 | `revenue_fy2022/23/24` | 3 / 11 / 22 | crore (keep) | C1 | ≥ 0; years consecutive; unit line found in the document and applied | CG detail page. Disagreement = re-read the restated P&L. |
| 59–61 | `profit_fy2022/23/24` | 4 / 126 / 155 | crore (keep) | C1 | sign consistent with the Risk Factors table when both are present | CG |
| 62 | `net_worth` | 160 | crore (keep) | C2 | `= reserves + share capital ±1%` | CG |
| 63 | `pe_ratio` | 135 | ratio (keep) | A9 | `= cap ÷ post-issue EPS ±1%`; loss-making → null with reason, never 0 | CG. A PE where EPS ≤ 0 is a defect, not a disagreement. |
| 64 | `eps` | 149 | ₹/share (keep) | C6 | sign matches PAT | CG |
| 65 | `roe` | 123 | % (keep) | — | −100 ≤ x ≤ 100 outside a loss year | CG |
| 66 | `debt_to_equity` | 115 | ratio (keep) | — | 0 ≤ x ≤ 50 | CG |
| 67 | `reserves_and_surplus` | 140 | crore (keep) | C2 | with 62 | CG |
| 68 | `total_assets` | 144 | crore (keep) | C2 | `≥ net_worth` | CG |
| 69 | `total_borrowing` | 133 | crore (keep) | C2 | `≤ total_assets` | CG |
| 70–71 | `promoter_holding_pre/post_issue` | 140 / 136 | % (keep) | D8 | `post < pre` when there is a fresh issue; `post = pre × pre_shares ÷ (pre_shares + fresh) ±1%` | CG |
| 72 | `market_cap` | 142 | crore (keep) | A8 | `= post-issue shares × cap ±0.5%` | CG. Must agree with `ipo_valuation.mcap_at_cap` after that field's unit conversion — today they are in different units (§0.8). |
| 73–74 | `pre_ipo_eps`, `post_ipo_eps` | 140 / 133 | ₹/share (keep) | C6 | `post ≤ pre` when fresh shares are issued | CG |
| 75 | `ronw` | 138 | % (keep) | A10 | matches `ipo_valuation.ronw_weighted_3y` within 1pp, or the difference is explained (single-year vs weighted) | CG |
| 76–78 | `ebitda_fy2022/23/24` | 2 / 120 / 148 | crore (keep) | C1 | `≤ total_income` | CG |
| 79–81 | `total_income_fy2022/23/24` | 3 / 126 / 153 | crore (keep) | C1 | `≥ revenue` | CG |

### 1.5 `financial_statements` — the per-year financial rows (11 live fields)

All class **D**. **Six of the eleven have Chittorgarh at rank 2 and Moneycontrol at rank 3** — CG's
detail page carries a restated per-fiscal-year "Company Financials" table
(`scraper/src/scrapers/chittorgarh-detail-fields.ts`, `getTableById(html,'financialTable')`) giving
revenue, total income, EBITDA and PAT per year plus the fiscal years themselves. The five that stay
document-only are `basis`, `unit`, `eps_basic`, `eps_diluted` and `op_cash_flow` — CG prints a single
pre/post-issue EPS pair and no basis, unit or cash-flow line. **Appendix A is authoritative for the
per-field ranks.** A field here that the document cannot supply stays null — there is nowhere else
to go, and that is the correct answer, not a failure.

**This table should become the source of truth for financials** (§5.2), which makes its unit
handling the single most important unit decision in this design.

| # | Field | rows | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|
| 82 | `fiscal_year` | 83 | keep | C1 | read from the statement header, never assumed; consecutive within the IPO | the header itself — a non-consecutive set fails the whole group |
| 83 | `basis` | 83 | keep | C8 | RESTATED or STANDALONE, read from the header | — |
| 84 | `unit` | 83 | **see below** | C7 | MILLION / LAKH / CRORE, read from the document's own unit line | — |
| 85 | `revenue` | 65 | **→ Cr** | C1 | ≥ 0 | `financial_data.revenue_fy*` for the overlapping years, after conversion |
| 86 | `total_income` | 63 | **→ Cr** | C1 | `≥ revenue` | as 85 |
| 87 | `ebitda` | 53 | **→ Cr** | C1 | `≤ total_income` | as 85 |
| 88 | `pat` | 67 | **→ Cr** | C1 | sign consistent with EPS | as 85 |
| 89 | `net_worth` | 54 | **→ Cr** | C2 | positive unless the document shows accumulated losses | as 85 |
| 90 | `eps_basic` | 52 | ₹/share (keep) | C6 | sign matches PAT | CG |
| 91 | `eps_diluted` | 12 | ₹/share (keep) | C6 | `|diluted| ≤ |basic|` | CG |
| 92 | `op_cash_flow` | 12 | **→ Cr** | C3 | same year set as C1 | none |

**The `unit` column decision.** Today the amounts are stored raw (55 rows MILLION, 10 LAKH) and the
`unit` column tells the reader what to do. That is a trap: any query that forgets to join on `unit`
is wrong by 10× or 100×. Under O-2 the amounts are **converted to crore on write** and `unit` is
kept as a record of what the document printed, not as an instruction to the reader. Renaming it
`source_unit` in the same migration makes that unambiguous.

### 1.6 `ipo_valuation` — the price-band advertisement table (17 live fields)

All class **D**, **document-only** (rank 1 DOC, no rank 2 or 3 — no website prints shares-at-floor).
`pricing_event` distinguishes the PBA row from the Prospectus row, so both are kept and the newer
event wins on read.

| # | Field | rows | Unit | Doc § | Check | Notes |
|---|---|---:|---|---|---|---|
| 93 | `pricing_event` | 14 | keep | — | PRICE_BAND_AD or PROSPECTUS | the row key; never overwritten across events |
| 94–95 | `price_floor`, `price_cap` | 10 / 10 | ₹/share (keep) | A1 | `floor < cap`; equal `ipos.price_range_min/max` | an internal mismatch is a defect, not a source conflict |
| 96–97 | `shares_at_floor / _cap` | 6 / 6 | count (keep) | A7 | `shares_floor > shares_cap`; `shares × price ≈ fresh amount ±0.5%` | |
| 98–99 | `mcap_at_floor / _cap` | 4 / 4 | **→ Cr** | A8 | `mcap_floor < mcap_cap`; `= post-issue shares × price ±0.5%` | **stored in rupees today** while `financial_data.market_cap` is in crore |
| 100–101 | `pe_at_floor / _cap` | 3 / 3 | ratio (keep) | A9 | null with `pe_not_ascertainable_reason` when loss-making — never 0 | the reason column is 0% populated, so today "not ascertainable" is indistinguishable from "not extracted" |
| 102 | `ronw_weighted_3y` | 12 | % (keep) | A10 | 3 years present and weighted per the document's footnote | |
| 103–104 | `face_value_multiple_floor / _cap` | 8 / 8 | **C** | A4 | `= price ÷ face_value ±0.01` | computed, not extracted — check it against the printed value when the document prints one |
| 105–106 | `fresh_shares_at_floor / _cap` | 6 / 6 | count (keep) | A7 | `fresh + OFS = total` at the same price point | |
| 107 | `ofs_shares` | 7 | count (keep) | A7 | as 105 | 0 for a fresh-only issue |
| 108–109 | `total_shares_at_floor / _cap` | 5 / 6 | count (keep) | A7 | `= fresh + OFS` at that price point | |

### 1.7 The remaining document tables (fields 110–137)

| # | Table.field | rows | Cls | 1 | 2 | 3 | Unit | Doc § | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|---|---|---|---|
| 110 | `promoters.name` | 27 | D | DOC | — | — | keep | D1 | non-empty; matches a name in the shareholding table | none |
| 111 | `promoters.waca` | 5 | D | DOC | — | — | ₹/share keep | D3 | `cap ÷ WACA` equals the printed multiple ±1%; a nil WACA (bonus) is null with reason `bonus_nil`, never 0 | none |
| 112 | `promoters.is_promoter_group` | 27 | D | DOC | — | — | keep | D1 | boolean from the table it was read in | none |
| 113 | `ipo_intermediaries.role` | 161 | D | DOC | BSE | — | keep | E1–E6 | one of the 7 enum roles | BSE payload for BRLM and registrar |
| 114 | `ipo_intermediaries.name` | 161 | D | DOC | BSE | CG | keep | E1–E6 | non-empty | BSE, CG. Must reconcile with `ipos.lead_managers` for the BRLM rows. |
| 115 | `ipo_risk_factors.seq` | 2130 | D | DOC | — | — | keep | F2 | consecutive from 1; unique per IPO | none |
| 116 | `ipo_risk_factors.heading` | 2130 | D | DOC | — | — | keep | F2 | ≥ 20 headings for a mainboard IPO; unique | none |
| 117–120 | `brlm_track_record.*` | 2 each | D | DOC | — | — | counts keep | E2 | `closed_below ≤ issues_3y`; `as_of_date ≤ RHP filing date` | none |
| 121 | `peer_companies.company_name` | 326 | D | DOC | CG | — | keep | C9 | non-empty | CG |
| 122 | `peer_companies.is_listed` | 326 | D | DOC | CG | — | keep | C9 | boolean | CG |
| 123 | `peer_companies.pe_ratio` | 307 | D | DOC | CG | — | ratio keep | C9 | > 0 or null; never 0 for a profitable peer | CG |
| 124–125 | `peer_companies.eps`, `diluted_eps` | 321 / 256 | D | DOC | CG | — | ₹ keep | C9 | `|diluted| ≤ |basic|` | CG |
| 126 | `peer_companies.ronw` | 321 | D | DOC | CG | — | % keep | C9 | −100..100 | CG |
| 127 | `peer_companies.nav` | 316 | D | DOC | CG | — | ₹ keep | C9 | > 0 | CG |
| 128 | `peer_companies.pbv_ratio` | 5 | D | DOC | CG | — | ratio keep | C9 | `= price ÷ NAV ±1%` | CG |
| 129–130 | `peer_companies.data_source`, `last_updated` | 326 | I | — | — | — | keep | — | pipeline | — |
| 131 | `anchor_investors.bid_date` | 2 | **T** | **NSE** | **BSE** | CG | keep | B1 | `< open_date` | the other exchange. **Named exception E-1 (§1.2.1)** |
| 132 | `anchor_investors.total_shares_offered` | 2 | D | DOC | — | — | count keep | — | `= Σ investor_list.shares ±0` | internal |
| 133 | `anchor_investors.total_amount_raised` | 2 | D | DOC | — | — | crore (keep) | — | `= Σ investor_list.amount ±0.5%`; `= shares × cap ±0.5%` | internal |
| 134 | `anchor_investors.anchor_investors_count` | 2 | D | DOC | — | — | keep | — | `= len(investor_list)` | internal |
| 135–136 | `anchor_investors.lock_in_*_date` | 2 each | **T** | **NSE** | **BSE** | CG | keep | — | 50% date ≈ allotment + 30d; remaining ≈ +90d — **recomputed whenever allotment_date moves** | internal date arithmetic. **Named exception E-1** — they move with field 4 |
| 137 | `anchor_investors.investor_list` | 2 | D | DOC | — | — | amounts **→ Cr** | — | Σ `percent_of_issue` ≤ 100 | internal |

### 1.8 `documents` — the filing register (15 live fields)

Class **I** throughout except `filing_date`. These describe our own handling of a PDF, and the pull
loop reads them rather than sourcing them.

| # | Field | rows | Cls | Written by | Check |
|---|---|---:|---|---|---|
| 138 | `type` | 256 | I | the classifier (`document-classifier.ts`) | one of the 15 enum types; a misclassification is what makes an old draft outrank a final ad, so this is a **Tier A** field |
| 139–140 | `title`, `url` | 256 | I | discovery | URL is absolute and on an allowed host |
| 141 | `file_size` | 93 | I | download | > 0; under the store cap |
| 142 | `uploaded_at` | 256 | I | download | UTC |
| 143 | `exchange` | 256 | I | discovery | NSE / BSE / BOTH |
| 144–146 | `media_type`, `sequence_number`, `is_active` | 256 | I | discovery | only one active row per (IPO, type) |
| 147–150 | `extraction_status`, `extracted_at`, `extraction_error`, `retry_count` | 256 / 62 / 18 / 256 | I | extraction | `retry_count` bounded by §3.4 |
| 151 | `sha256` | 115 | I | download | 64 hex; identity of the file for the re-read loop |
| 152 | `filing_date` | 24 | **D** | DOC cover, rank 2 BSE payload | `< open_date`; **this is the field the document-type healing rule depends on**, and it is populated on only 24 of 256 documents |

### 1.9 Live market data (fields 153–184)

| # | Table.field | rows | Cls | 1 | 2 | 3 | Unit | Check | Verify / disagreement |
|---|---|---:|---|---|---|---|---|---|---|
| 153 | `subscriptions.timestamp` | 27,489 | I | — | — | — | keep | UTC, monotonic per IPO | — |
| 154–157 | `subscriptions.qib / nii / retail / total_subscription` | 27,489 | **X** | NSE | BSE | CG | × keep | 0 ≤ x ≤ 5,000; `total ≈ Σ categories` weighted by shares offered ±2% | CG. Newest wins (`timeBased`). The document never prints these. |
| 158–160 | `employee`, `b_nii`, `s_nii` | 3,693 / 2,075 / 2,075 | **X** | NSE | BSE | — | × keep | `bNII + sNII ≈ nii` ±2% | — |
| 161–162 | `total_shares_bid`, `shares_offered` | 2,349 | **X** | NSE | BSE | — | count keep | `shares_offered` equals the document's `shares_at_cap` ±0.5% — **the one place the document verifies the exchange** | DOC. A disagreement here means the price band moved or our extraction is wrong. |
| 163 | `scope` | 126 | I | — | — | — | keep | BSE_ONLY / NSE_ONLY / CONSOLIDATED | — |
| 164–166 | `gmp_records.timestamp / gmp / source` | 8,369 | **W** | IG | CG | — | ₹/share keep | `|gmp| ≤ 3 × cap`; newest wins | the two grey-market sources against each other. No document, ever. |
| 167 | `gmp_records.gmp_percentage` | 8,365 | **C** | — | — | — | % | `= gmp ÷ cap × 100 ±0.1` | recomputed, never taken from the site |
| 168 | `listing_performance.listing_price` | 237 | **M** | NSE | BSE | CG | ₹ keep | > 0; within ±90% of issue price or flagged | CG |
| 169 | `listing_performance.issue_price` | 237 | **C** | — | — | — | ₹ | `= ipos.price_range_max` at listing | internal mismatch is a defect |
| 170 | `listing_gain_percent` | 237 | **C** | — | — | — | % | `= (listing − issue) ÷ issue × 100 ±0.01` | recomputed |
| 171–172 | `current_price`, `current_gain_percent` | 237 | **M / C** | NSE | BSE | — | ₹ / % | price > 0; gain recomputed | CG |
| 173 | `last_updated` | 237 | I | — | — | — | keep | pipeline clock | — |
| 174–175 | `current_price_bse / _nse` | 177 / 136 | **M** | BSE / NSE | — | — | ₹ keep | the two differ by < 5% during market hours or one is stale | each other |
| 176–178 | `symbol`, `company_name`, `listing_date` | 235 / 237 / 237 | **C** | — | — | — | keep | copies of `ipos.*`; must equal them | internal |
| 179 | `data_source` | 237 | I | — | — | — | keep | pipeline label | — |
| 180–184 | `ipo_demand_graph.timestamp / price_point / is_cut_off / cumulative_quantity / exchange` | 245 | **X** | NSE | BSE | — | keep | `price_point` inside the band or `is_cut_off`; quantity monotonic | the other exchange |

### 1.10 `registrars` — reference data (fields 185–194)

Class **D** for the identity fields, rank 1 DOC (§E3 prints the registrar's name, SEBI registration
number and address), rank 2 the registrar's own website (`REG`), rank 3 Chittorgarh. This is
per-registrar reference data, not per-IPO, so it is refreshed on the reference cadence (§2.6), not
in the per-IPO walk.

| # | Field | rows | Cls | 1 | 2 | 3 | Check |
|---|---|---:|---|---|---|---|---|
| 185–186 | `name`, `short_name` | 19 | D | DOC | REG | CG | non-empty; unique |
| 187–188 | `email`, `phone` | 15 | D | DOC | REG | — | contact form valid |
| 189 | `website` | 19 | D | REG | DOC | — | resolves over HTTPS |
| 190 | `allotment_check_url` | 14 | **I** | REG | — | — | resolves; **the only field here with a live health check** |
| 191 | `address` | 15 | D | DOC | REG | — | non-empty |
| 192 | `active` | 19 | **I** | ADMIN | — | — | boolean |
| 193–194 | `allotment_url_healthy`, `allotment_url_checked_at` | 19 / 14 | **I** | — | — | — | our own probe |

### 1.11 Exceptions by IPO type, gathered

Written once here rather than duplicated into every row.

| Type | Population today | Exceptions that apply |
|---|---:|---|
| **Mainboard IPO** | 99 | The base case. Full document set; both exchanges available as rank 2 and 3. |
| **SME on BSE** | 106 | `listing_exchanges = ["BSE"]`. **NSE cannot be rank 2 or 3 for any field** — there is no NSE payload. Minimum application is **2 lots** (SEBI 2025), recorded in `ipo_details.lot_multiple`, so the lot-value check is `2 × lot × floor ≥ ₹1,00,000`; applying the mainboard check is what produced the Qualiance false alarm. Commonly FIXED_PRICE, so the `cap ≤ 1.2 × floor` check is skipped and floor = cap is expected. Designated exchange is always BSE. |
| **SME on NSE** | 61 | Mirror image: `listing_exchanges = ["NSE"]`, **BSE cannot be rank 2 or 3**. Same 2-lot rule. |
| **SME on both** | 5 | Unusual for SME. Treat as mainboard for ranking, but flag for review — this is more likely a data error than a genuine dual listing, and §4 gives it a check. |
| **Rights issue** | 8 | No DRHP, no price band advertisement, no anchor round, no lot size in the IPO sense. Rank 1 is the letter of offer; where no document type exists for it, rank 1 falls to BSE. Fields 93–109, 131–137 are `NOT_APPLICABLE`, not gaps. |
| **OFS** | 19 | No fresh issue: field 35 is legitimately 0 and `issue_size = ofs_issue`. No objects of the offer (field 27 empty is correct). No DRHP stage. |
| **NCD** | 7 | Debt. Price band, EPS, PE, promoter holding and peer comparison are all `NOT_APPLICABLE`. Its own prospectus is rank 1 for coupon, tenor and rating — **none of which we currently store**, which is a gap this design surfaces rather than closes. |
| **INVITS / REITS** | 5 | `segment` is NULL for all 5 today. Unit-based, not share-based; lot size and face value do not apply in the same sense. Out of the pull model's first release — say so explicitly rather than letting them fail every check. |
| **BUYBACK / TENDER** | 17 | Corporate actions, not offerings. They should arguably not be on an IPO site at all (the Mopshop / Sarda class). Field 24 `offering_type` is the guard; §4.6 gives it a check. |
| **FPO** | **0 today** | The brief asked for follow-on offers. **There are none on production.** The rule is written and not exercised: no draft prospectus stage, so rank 1 is the RHP or prospectus directly; everything else follows mainboard. Because no row exercises it, it carries a higher risk of being wrong than any other line in this table. |

---

## 2. How we go and get it — the pull loop

**Scope: phase 1 only.** 19 IPOs, status OPEN or UPCOMING, all `offering_type = 'IPO'`, mainboard or
SME (measured 2026-09-08). No closed IPO is read or written. Closed IPOs follow afterwards, one at a
time, newest close date first — that is section 6, and none of it is specified here.

Every claim below about how the system behaves today carries the file and line it was read from.
Anything not cited is a proposal, not a fact. That rule exists because the first draft of this
section asserted seven things about our own code that were false, and an implementer who trusted
them would have built the wrong thing.

### 2.1 What runs, and when

Discovery already runs four times a day — 08:30, 11:00, 14:00, 17:30 IST
(`scraper/src/scheduler/due-step-cycle.ts:15`). The pull walk runs in those same four slots, plus
whenever a document for a phase-1 IPO reaches `EXTRACTED`. It does not run on every wake.

Live figures — subscription, demand graph, grey-market premium — keep running on every in-hours wake,
but only for OPEN IPOs. Measured: **6 OPEN, 13 UPCOMING**. So the expensive walk touches 19 IPOs four
times a day, and the cheap live poll touches 6.

### 2.2 The process this has to survive, which the first draft ignored

The scraper is **one pm2 process, not a cluster**, started
`--no-autorestart --cron-restart="*/30 * * * *"` (`scripts/deploy-linux.sh:681-682`). Three facts
follow, and together they set the shape of everything below:

1. **`cron-restart` on a running process is a restart, not a skip.** A walk still running at the
   thirty-minute boundary is killed.
2. **The worst-case extraction pass is 30 minutes** — `DEFAULT_MAX_SPAWNS_PER_CYCLE = 3`
   (`filing-auto-persist.ts:500`) × `EXTRACT_TIMEOUT_MS = 10 min` (`filing-auto-persist.ts:166`) —
   against a 30-minute cron. So being killed mid-walk is not an edge case. **It is the normal
   operating state.**
3. **Extraction is `spawnSync`** (`filing-auto-persist.ts:170`), which blocks the event loop, so the
   signal handler that releases locks (`document-cycle.ts:84-128`) cannot run during it. The process
   is killed outright and `FILING_EXTRACTION_LOCK_KEY` stays held for its full 45-minute TTL
   (`filing-auto-persist.ts:500-551`) — costing the next two wakes their extraction slot.

**Therefore the walk commits one field at a time and is resumable from any point.** No multi-IPO
batch held in memory and flushed at the end; no four-pass sequence that only makes sense if it
completes. Each field's outcome is written before the next field is attempted. A kill loses at most
the field in flight.

This replaces the first draft's four sequential passes per IPO, which were exactly the wrong shape
for a process on a thirty-minute drumbeat.

### 2.3 Where the loop records what it asked

The loop needs somewhere to record *what was asked and what came back*, because `field_sources`
records only successful writes — a field never attempted and a field attempted and failed look
identical in it, both absent.

One new table, `ipo_field_plan`, one row per (IPO, table, field):

| Column | Purpose |
|---|---|
| `ipo_id`, `table_name`, `field_name` | the key |
| `rank1_source`, `rank2_source`, `rank3_source` | resolved for this IPO's type, so an SME-on-BSE IPO never lists NSE |
| `state` | `PENDING` · `SUPPLIED` · `NOT_PRINTED` · `NOT_AVAILABLE_YET` · `CHECK_FAILED` · `EXHAUSTED` |
| `chosen_source`, `chosen_rank`, `chosen_document_id`, `chosen_document_type`, `chosen_sha256`, `chosen_page` | what won, and **on what evidence** — this is what makes §2.5 work |
| `attempts`, `last_attempt_at`, `next_due_at` | per-field backoff |
| `claimed_at`, `claim_token` | so a killed walk's in-flight row is reclaimable, mirroring `isStaleInProgress` (`document-state-machine.ts:730`) |
| `verify_due_at`, `verify_state`, `verify_source`, `verify_value`, `disagreement_count` | §3's state, scheduled rather than accidental |
| `manifest_version` | so the plan is reconciled when the manifest changes, never regenerated per cycle |

**The plan row is written from the *result* of the write, never in parallel with it.**
`consolidatedUpsertIPO` returns `skipped: true, skipReason: 'LOCK_NOT_ACQUIRED'`
(`data-consolidation-orchestrator.ts:137-139`) when it cannot take its per-slug lock — silently. A
plan row marked `SUPPLIED` against a write that was dropped is a false-clean state that every check
downstream would read as success. So: a skipped return leaves the row `PENDING` with `attempts`
untouched.

### 2.4 What the loop does, per field

```
for each IPO in phase 1, at each of the four slots:
  for each field in the plan, in dependency order:

    if an admin protection row exists for this field  -> skip; do not store a state (§2.7)

    for rank in 1, 2, 3:
        answer = ask(source[rank])
        SUPPLIED   -> value passes its §1 check: write it, record the evidence, stop
        CHECK_FAILED / EXTRACT_FAILED -> record the named check or cause, try the next rank
        NOT_PRINTED       -> this source never carries it: try the next rank, no retry, no error
        NOT_AVAILABLE_YET -> it will exist but does not yet: try the next rank for a
                             PROVISIONAL value, and keep the field due so rank 1 reclaims it

    all three ranks failed -> state = EXHAUSTED, and see §2.6
```

### 2.5 When a supplied value is asked for again

The first draft said a correct value is frozen and never re-asked. That is wrong, and it was the
single worst error in the document: a draft prospectus filed in July gives an internally consistent
issue size that passes its check and freezes; the September RHP prints the final, larger number; the
site publishes the July figure for the life of the IPO.

**The rule is not "don't re-ask a correct value". It is "don't re-ask while the evidence still
holds".**

> A field is not re-asked while `chosen_document_id` is still the best available document, of the
> highest-precedence type, for that field.

When a document reaches `EXTRACTED` that outranks the stored one — a higher-precedence type, or the
same type with a newer `filing_date` — every plan row whose `chosen_document_id` it supersedes goes
`SUPPLIED → PENDING` in the same transaction, with `superseded_by` recorded. The next slot re-asks
those fields and the newer document wins.

**Precondition, and it is not optional.** The design cannot inherit this from the September 8th
merge. `decideSupersession` is *specified and unit-tested but explicitly not wired* — the code says
so itself: *"NOT YET CALLED BY THE RUNNER, and deliberately so"*
(`document-state-machine.ts:15-23`), and there is no non-test caller anywhere in `scraper/src`. It
orders by `filing_date`, which is populated on **24 of 256 documents**. So wiring supersession, and
backfilling `filing_date`, are both prerequisites of the pull loop, not parts of it.

### 2.6 When all three sources fail

The first draft said: write null with a reason, never leave a stale value. **That is deleted, for
two reasons.**

It is not implementable through the writer this design keeps. When the incoming value is null and a
value is stored, `consolidatedUpsertIPO` returns the stored value with reason `NO_INCOMING_VALUE`
and logs nothing (`data-consolidation-service.ts:1063-1080`). A null cannot pass through it. The
plan would record `EXHAUSTED` while the stale value kept serving — a silent divergence between what
we believe and what the site shows.

And it is dangerous even if it worked. Any check that is wrong for a class of IPO would delete that
class's correct data. That is not hypothetical: the first draft's `face_value ∈ {1,2,5,10}` is wrong
for an NCD at ₹1,000, and `listing ≤ close + 3 working days` is wrong for anything that listed
before December 2023.

**The rule instead:**

> A field that currently holds a value which passed its check is never blanked. `EXHAUSTED` marks
> the plan row, not the data. A field that has never held a value stays absent.

An `EXHAUSTED` row on a live IPO is a visible gap with an owner (§4), not an edit.

### 2.7 Admin overrides

An admin value outranks everything. The first draft stored the field as `NOT_APPLICABLE`, which made
the override a one-way door: clear it, and the field is frozen out of the loop forever, invisibly.

`NOT_APPLICABLE` is **derived, not stored** — the walk checks for a live protection row each time it
reaches the field. Clearing the override returns the field to the loop automatically.

### 2.8 When the plan itself is wrong

The ranks are resolved per IPO type. If the type is corrected, the ranks are wrong and nothing in the
first draft rebuilt them.

**Measured: no IPO has ever had a committed type change** — across all 327 rows, no stored previous
value of `offering_type` or `segment` differs from the current one. But **a wrong type that is later
corrected has happened**: Mopshop Distribution Ltd was stored `FPO` on Moneycontrol's word against
Chittorgarh's `IPO`, logged the same disagreement 24 times, and was corrected by hand to `IPO`/`SME`.

So `offering_type`, `segment` and `listing_exchanges` are **plan-invalidating fields**: a write to
any of them drops and rebuilds that IPO's plan rows, keeping values whose rank-1 source is unchanged.

**Phase-1 precondition:** 3 of the 19 IPOs have `segment = NULL` (BSE-only, UPCOMING). No rank set
can be resolved for them, because SME and mainboard carry different lot-value checks. They must be
resolved before the walk runs on them.

### 2.9 Statuses outside the three the first draft named

The first draft's tiers covered UPCOMING, OPEN, CLOSED and LISTED. The enum has six
(`packages/shared/src/db/schema.ts`, `ipoStatusEnum`). A phase-1 IPO can become either of the other
two at any time:

- **POSTPONED** — stays in scope at the four-slot cadence. Its terms will be re-advertised, so its
  document-sourced fields are invalidated when the next filing arrives (§2.5).
- **WITHDRAWN** — terminal. The walk stops, existing values are kept, GMP and subscription polling
  stop, and the IPO leaves the §4 denominators.

### 2.10 What this needs that does not exist yet

Stated plainly, because the first draft buried the largest piece of work inside a sentence saying
nothing changes.

`consolidatedUpsertIPO` consolidates **`tableName: 'ipos'` only**
(`data-consolidation-orchestrator.ts:187`). The eight child tables — `ipo_details`,
`financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`,
`ipo_intermediaries`, `peer_companies` — are written by `persistFilingExtraction` through their own
repositories, with no priority resolution and no `field_sources` rows. That is *why* they measure as
100% document-sourced: nothing else writes them.

**162 of the 194 fields therefore have no consolidated writer at all.** Extending the consolidation
contract to those eight tables is a first-class piece of work and a hard prerequisite of the walk —
without it, the loop has nowhere to write 84% of what it extracts.

---

## 3. What happens when sources disagree — the re-read loop

### 3.1 Why this cannot be left to chance

We already detect disagreements: `data_conflicts` holds 31,014 rows, **2,398 unresolved**, including
all 578 `leadManagers` conflicts and 495 of the `faceValue` ones. Nothing consumes them.

But a conflict row is only written when a *second* source arrives and disagrees. Under §2.4 a
supplied field is not re-asked, so no second value is produced, so no conflict is written — the
first draft's re-read loop could never have fired on exactly the fields it was meant to protect.

**So verification is scheduled, not accidental.** `verify_due_at` on the plan row: every supplied
field on a phase-1 IPO is checked against its rank-2 source at least weekly, and the fields with
standing conflict counts — `leadManagers`, `faceValue`, `registrar` — every slot.

### 3.2 What happens on a disagreement

```
1. re-fetch the winning document's bytes and re-hash them
2. re-extract only this field, at the recorded page first
3. write an extraction receipt: sha256 computed now, extractor run id, page, timestamp
4. compare:
     same value, check passes -> the document is confirmed; mark the other source
                                 wrong for this field; resolve the conflict
     different, check passes  -> the first extraction was wrong; write the correction
     different, check fails   -> leave the stored value; do not adopt the other source
5. still disagreeing after the bound -> unresolved_disagreement, and it becomes visible (§3.4)
```

**The website's number is never adopted.** That is the whole instruction behind this design.

**But that claim is only safe if the re-read really happened.** If the file is gone and the
re-download fails, an implementation could fall back to the cached extraction, return the same wrong
number, and record "verified against the document" — confirming a wrong value forever and then
defending it against the source that was right. **That is why step 3 exists: a re-read counts only
if it produced a receipt with a hash computed from bytes on disk during this cycle.** No receipt, no
verification.

### 3.3 What stops it looping

| Bound | Value |
|---|---|
| Re-reads per (IPO, field, document `sha256`) | **2** — a third attempt on the same bytes cannot give a different answer |
| Re-reads per document per day | **1** — all of a document's disputed fields are re-read together |
| Re-reads per IPO per slot | **1** |
| Reset | a new `sha256`, or a higher-precedence document type |

Keying on the bytes rather than a retry counter is what makes "we already tried this" a fact about
the evidence instead of a number someone can reset.

### 3.4 Where an unresolved disagreement ends up

`unresolved_disagreement` on the plan row; a line in the nightly report with both values and both
sources, by IPO and field name; and — for a phase-1 IPO — a GitHub issue, because a live IPO with a
disputed price band is a user-facing defect.

---

## 4. How we would know it worked

**The rule this section is built on.** The old version of it opened by warning that a check counting
all-time rows can never alarm on a collapse — and then made the same mistake one level down, by
using ratios whose *denominators* are produced by the machinery under test. If a document type
mis-resolved, fewer fields counted as document-owned, the denominator shrank, and the score went
**up**. The worse the extraction, the better the number.

So every check below obeys four rules:

1. **A named denominator floor, asserted first.** A ratio whose denominator moved more than 5%
   overnight reports UNVERIFIABLE, never PASS.
2. **A type-independent denominator.** What the document *should* print for this offering type — a
   fixed constant — never what the document that happened to resolve says it prints.
3. **An id, an emitting script, and a line in the nightly report** that the existing delta consumer
   reads. A line in a process log is not detection.
4. **Failures resolve to identities.** Never "12 failed" — always which IPO and which field.

| id | What it asks | Healthy | Alarms when |
|---|---|---|---|
| `PULL-PLAN` | plan rows per IPO = the committed manifest, and the manifest hash is unchanged | equal | any mismatch, or a manifest hash that moved without a commit |
| `PULL-WALK` | every phase-1 IPO walked this slot | 19 of 19 | fewer than all, twice running — **and separately, phase-1 count ≥ 1** |
| `PULL-YIELD` | of the fields the offer document should print for a mainboard/SME IPO, how many round 1 supplied | rising toward 100% | falls, **or the denominator moves more than 5% overnight** |
| `PULL-EXCUSED` | `NOT_PRINTED` count per (IPO, document type), NEW vs yesterday by name | stable | a document's excused set grows at all — this is what catches a mis-resolved type |
| `PULL-EXHAUST` | `EXHAUSTED` rows by (IPO, field, reason), NEW vs GONE vs SAME | shrinking | any NEW one on a phase-1 IPO |
| `PULL-NOBLANK` | fields that went from a value to absent this slot | **0** | any non-zero — this is the guard on §2.6 |
| `PULL-WRITE` | plan rows marked `SUPPLIED` whose write returned `skipped` | **0** | any non-zero |
| `PULL-FROZEN` | `SUPPLIED` rows whose `chosen_document_id` has been superseded | **0** | any non-zero — the guard on §2.5 |
| `PULL-ADMIN` | fields skipped for admin reasons with no live protection row | **0** | any non-zero — the guard on §2.7 |
| `PULL-TYPE` | plan rows whose resolved ranks do not match the IPO's current type; IPOs with a null segment | 0 / 0 | any non-zero |
| `E1-SOURCE` | for the twelve E-1 fields, `field_sources.source` is never `DRHP` | true | any E-1 field written by the document path — **asserts the outcome, not the declared intent** |
| `REREAD-RECEIPT` | re-reads with a receipt hashed this cycle ÷ re-reads recorded | 1.0 | below 1.0 — the guard on §3.2 |
| `REREAD-VERDICT` | share of re-reads ending `verified_against_document` over 7 days | below 0.95 | at or above 0.95 — a source that is never wrong is a source never actually consulted |
| `REREAD-LATENCY` | oldest actionable disagreement with no re-read attempt | under 48 h | over 48 h, listed by IPO and field |
| `CHECK-ROSTER` | every id above appears in tonight's report | all present | any missing — **a check that crashed must not read as "no findings"** |

`CHECK-ROSTER` exists because the current delta consumer parses only PASS and FAIL: a check that
throws vanishes from the output and is reported as GONE, printed as "no new findings", exit 0. A
check that dies would otherwise look like an improvement.

**None of this is evidence until it has run against real data.** The first proof is a staging slot
whose log line names a counter that moved — `PULL-YIELD` rising and `PULL-EXHAUST` falling on the
same night. A passing unit test is not proof, and neither is a clean read taken immediately after a
repair.

---

## 5. The open comments, answered inside the design

### 5.1 O-1 — when the pull runs, and why

**Measured position.** The process still wakes every 30 minutes on production (`*/30`). Discovery
already runs only at the four IST slots under `ENABLE_DUE_STEP_SCHEDULER`, which is on in both
environments. What still walks every wake is document processing, protected per document by a 15
minute backoff doubling to a 6 hour cap. Abhay's read is fair: the visible behaviour is unchanged.

**The design's answer.** The wake stays at 30 minutes; what runs inside it becomes conditional:

- Outside market hours **and** outside the four discovery slots, the wake does nothing but the
  cheap liveness write. No document queue walk, no HTTP.
- The pull walk runs **on the four discovery slots and on state changes**, not on a clock.
- Only genuinely live figures — subscription, demand graph, GMP — run on every in-hours wake, and
  only for OPEN or UPCOMING IPOs. Measured now: **6 OPEN and 10 UPCOMING, 16 of 327**. Subscription
  and demand-graph polling narrows further to the 6 OPEN ones.
- The backlog tier gets its own nightly window.

**Why not simply lengthen the wake.** Subscription and grey-market numbers move through the day and
are the most-read figures on the site during a live issue; an hourly floor would make them stale by
up to an hour at exactly the moment they matter. Making the wake cheap when there is nothing to do
gets the cost saving without that cost.

**What is still owed to Abhay:** a target number. The design works at any wake interval; if he wants
hourly, only the live-figure row above changes.

### 5.2 O-2 — money in crore

**The measurement makes the case stronger than the original comment did.** §0.8: four units, six
tables, one concept, and `financial_statements` does not normalise at all.

**Convert to crore (`numeric(14,2)`, storing 999.99 not 9,999,999,999.99):**

| Table | Fields | Today |
|---|---|---|
| `ipos` | `issue_size` | rupees |
| `ipo_details` | `fresh_issue`, `ofs_issue` | rupees |
| `ipo_valuation` | `mcap_at_floor`, `mcap_at_cap` | rupees |
| `financial_statements` | `revenue`, `total_income`, `ebitda`, `pat`, `net_worth`, `op_cash_flow` | raw MILLION or LAKH |
| `anchor_investors` | `total_amount_raised`, and the amounts inside `investor_list` | crore already — becomes the reference |
| `ipos` | `objectives` amounts (JSON) | mixed |
| `financial_data` | all money columns | crore already — the reference |

**Do NOT convert** (§O-2's own list, confirmed against the measured data): per-share prices
(`price_range_min/max`, `price_floor/cap`, `face_value`, `listing_price`, `issue_price`,
`current_price*`, `gmp`, all EPS and NAV), percentages and ratios (`roe`, `ronw`, `pe_ratio`,
`debt_to_equity`, `*_gain_percent`, `promoter_holding_*`), subscription multiples, and every share
count (`shares_at_*`, `total_shares_bid`, `shares_offered`, `promoter_shares_held`, `lot_size`).
Converting those makes them harder to read, not easier.

**`financial_statements.unit` becomes a record, not an instruction.** Amounts are converted on write;
the column is renamed `source_unit` and kept for provenance. Any query that forgets to join it is
then merely missing context rather than wrong by 10×.

**Honest cost.** This changes what the public API returns for those fields. It touches every page
that formats money, the audit checks, and the provenance rows already written. It is its own change
with its own staging proof and its own release — not a rider on the pull model. Doing it *before*
the migration in §6 is cheaper, because the migration rewrites those rows anyway.

**And the thing worth fixing at the same time (§0.9).** `financial_data`'s hard-coded FY columns are
already publishing a two-year-old figure for a live IPO. The design's position: `financial_statements`
becomes the source of truth for financials, and `financial_data` becomes a derived projection of its
three most recent fiscal years. That removes the hard-coding, fixes Annu Projects, and gives the
unit conversion one place to happen instead of two.

### 5.3 O-3 — one bad field must not discard the row, and must not loop

Answered structurally rather than by a patch, because the pull model makes it fall out:

- **The unit of work is the field, not the document.** `ipo_field_plan` has one row per field, and a
  `CHECK_FAILED` on `fresh_issue` marks that one row. Rentomojo's lead managers, dates, registrar and
  ISIN are written regardless. Nothing is all-or-nothing any more.
- **A failed field falls to the next rank** (§2.5) and, failing that, is written null with a reason
  (§2.8). "Keep that field blank, and get that field from other sources" is precisely the fallback
  rule.
- **The loop is bounded by bytes, not by counter** (§3.4): at most 2 attempts per `sha256`, 1
  re-read per document per day, reset only on genuinely new evidence. Seven re-extractions of the
  same PDF becomes impossible by construction, not by a retry limit someone remembers to set.
- **In the meantime**, the cheap version of this — pre-validating each field against its column
  width before the write and dropping only the offenders — is worth doing on its own, ahead of the
  pull model. It is small, it is reversible, and it stops today's bleeding. It is not a substitute
  for the above.

### 5.4 O-4 — the unextracted backlog, drained without starving a live IPO

**Re-measured this session: 176 unextracted, not 172.** The three causes hold:

| Cause | Documents | The design's answer |
|---|---:|---|
| No extractor exists for the type | 78 | Build two: the **ratios / basis-for-offer-price** document (32 pending — it carries the KPIs, the WACA and the peer set, all rank-1 document fields in §1) and the **basis-of-allotment advertisement** (1, carries the final allotment). **Deliberately leave unread:** sample application forms (14), bidding centres (8), security parameters (23) — and say so in the manifest, so they report as `NOT_APPLICABLE` rather than as a backlog forever. |
| Budget of 3 filings per cycle | 91 | Demand-ordered allocation (§2.7) plus the **backlog tier's own nightly window** (§2.3). The live tier keeps absolute priority, so a live IPO can never queue behind history. This converts 91 already-downloaded documents into data with no new parsing code — the single biggest win here. |
| 10-minute extraction cap | the Skyways class | A separate, longer budget for large or scanned documents, run in the backlog window only, where a 40-minute extraction costs nothing. The live path keeps its 10-minute cap so it cannot blow the wake budget. |

O-4 is already marked APPROVED by the owner, so this section is the *how*, not a request.

### 5.5 O-5 — the document outranks websites: what is inherited and what remains

Merged this morning as 9db4529d. The design inherits all of it: `DRHP` directly after `ADMIN` on
every field the extraction contract says a filing carries; a newer document heals an older one;
document types ranked so an old draft cannot overwrite a final advertisement; timeline dates
deliberately keeping the exchanges first (W-117).

**What remains after it, and why the ranking alone was never going to be enough:**

1. **130 of 194 published fields still have no ranking at all** (§0.6). O-5 raised the document on
   the fields the matrix knows about; the matrix does not know about two thirds of the site.
2. **The staging-cycle proof for 9db4529d is still owed.** It is listed at 90%, not 100%, for that
   reason.
3. **Nothing re-sources the existing rows.** The flip changes who wins the *next* write. 91% of
   today's data was written before it. That is §6.
4. **The duplicate-key problem** (§0.6): 13 matrix keys in snake_case match nothing. They should be
   deleted in the same change that builds the plan, or they will quietly look like coverage.

### 5.6 O-7 — where a language model is genuinely needed, and where it is not

Treated as a constraint the design obeys, per Abhay's conditions: the model never writes a value, it
proposes one with the page number and the exact sentence; every arithmetic check must still pass; a
website disagreement sends it back to the document, never to the website's number; model-sourced
values are marked in provenance so their accuracy is measurable and the whole thing can be switched
off; deterministic extraction is always tried first.

Stated per field group, which is what the brief asked for:

| Field group | Deterministic extraction is enough? | Why |
|---|---|---|
| A Issue terms (price band, lot, face value, issue size, share counts, market cap) | **Yes** | Printed on the cover in fixed labelled forms, with arithmetic that cross-checks itself. Never needs a model. |
| B Timeline | **Yes** | A labelled table. And the exchanges outrank the document here anyway. |
| C Financials (P&L, cash flow, EPS, unit, basis) | **Yes for the tables**, no for the unit line when it is set in prose | `pdfplumber` reads a column-aligned restated statement reliably. The one weak point is the "₹ in million" line when it appears as a sentence rather than a header — and getting that wrong is a 10× error, so it is the single best candidate for a model *proposal* checked against magnitude bounds. |
| D Promoter and WACA | **Mostly** | Two labelled tables. The exception is the footnote defining how the multiple was weighted, which is prose. |
| E Intermediaries, CIN, registered office | **Yes** | Labelled lines with strict formats (CIN has a regex, SEBI registration numbers have a form). |
| F1 Business description | **No — genuine model case** | It is a paragraph. There is no deterministic way to pick the right one, and today we take it from Chittorgarh instead (159 rows), which is exactly the substitution O-8 objects to. |
| F2 Risk factors (headings) | **Yes for headings**, no for summarising bodies | Numbered headings are a regex. We store `seq` and `heading` only, so no model is needed for what we publish today. |
| F4 Objects of the offer | **Yes** | A table with amounts that must sum to net proceeds. |
| F5 Litigation | **No — model case, if we ever publish it** | Prose summary. Not published today; out of scope. |
| Scanned documents with no text layer | **No — OCR, then deterministic** | Not a language-model problem. Recorded as `NEEDS_OCR` and left. |

So: of the **121** document-sourced (class D) fields, **two** are genuine model candidates — the
business description, and the unit line as a proposal-with-check. Everything else is deterministic.
That is the honest answer to "last stretch only": the last stretch is small, and we should not reach
for it until the deterministic 119 are actually being read.

---

## 6. Migration: re-sourcing 91% of the data from its own documents

### 6.1 What we are actually facing

| | |
|---|---:|
| Field values sourced from websites today | 4,841 of 6,638 (72.9%) |
| Plus exchanges | 6,035 of 6,638 (90.9%) |
| IPOs with any document-sourced field | 27 of 327 |
| **IPOs whose PDFs are already purged from disk** | **every IPO closed more than 7 days ago** |
| **IPOs the state machine will not touch at all** | **228 (LISTED > 10 days)** |

The migration is therefore not "re-run the extractor". For most rows it is **re-download, then
re-extract, then re-source** — and the re-download may fail, because we are asking an exchange
archive for a PDF filed months ago.

### 6.2 The precondition already established

A re-extraction must resolve a **real document type**. If a re-extracted document arrives with an
unknown or defaulted type, the document-type ranking degrades to newest-write-wins and an old draft
can overwrite a final price band advertisement. That risk was found in the O-5 review and it applies
with far more force here, where we would be re-extracting hundreds of old documents at once.

**Concretely: `documents.filing_date` is populated on 24 of 256 rows** (§1.8, field 152). The healing
rule leans on it. Backfilling `filing_date` from the document covers is a prerequisite of the
migration, not a part of it.

### 6.3 The order

Six stages, each gated on the previous, each proven on staging first.

| Stage | What | Gate before the next |
|---|---|---|
| **M0** | Backfill `documents.filing_date` and re-verify `documents.type` for all 256 rows. No field writes. | filing_date ≥ 95% populated; 0 documents with an unresolvable type |
| **M1** | Probe re-download for all purged documents. Write nothing; just record whether each URL still serves the file. | a measured table of recoverable vs lost, by IPO tier — **this is the number that decides whether the rest is even possible, and I cannot predict it** |
| **M2** | Drain the 91 readable PENDING documents (§5.4). Live and recent tiers only. | 4.3 rank-1 reach rises; 4.11 backlog falls; 0 regressions in the nightly floor |
| **M3** | Re-source the **live and recent tiers** (99 IPOs) field by field from their own documents, through the normal pull loop. | document share of `field_sources` for those IPOs > 60%; every §1 check passing; no field silently blanked |
| **M4** | The units change (§5.2), applied to both the already-migrated and remaining rows, with the magnitude gate 4.7. | every money field in band; the public API shape change released deliberately |
| **M5** | The backlog tier (228 IPOs), nightly window, in reverse chronological order — most recent first, because those are the ones people still read. | monotonic progress; live tier never starved (4.12) |

M3 is where the 90% target is actually won or lost for the IPOs that matter. M5 is a long tail that
may never complete, and the design should not pretend otherwise.

### 6.4 What could go wrong

| Risk | Likelihood | What it costs | Mitigation |
|---|---|---|---|
| **Old PDFs are no longer downloadable** | Likely for the oldest rows | M5 partially impossible; the 90% target is only reachable on IPOs from here forward | M1 measures it before anything is committed. If most are lost, say so and set the target on *new* IPOs only. |
| A re-extraction writes a **wrong** value over a correct website value | Medium | Live wrong data, on pages people read | Every §1 check must pass before the write; a disagreement triggers a re-read, not an adoption; staging-first per stage; the whole thing is reversible per stage because `field_sources` records the previous value and source |
| A mis-typed document overwrites a final value with a draft | Medium without M0 | The exact class the O-5 review caught | M0 is a hard gate; the ranking refuses to write from a document whose type is unresolved |
| The backlog drain starves live IPOs | Medium | The user-visible IPO is the one that goes stale | Tiering (§2.3) plus check 4.12 |
| The unit change ships half-applied | Low, high impact | Figures wrong by 10⁷ on live pages | Gate 4.7 blocks on a single out-of-band row; the conversion is one migration, not a per-table drip |
| `ipo_field_plan` becomes stale relative to the schema | Medium over time | Fields silently drop out of the walk | The plan is generated from schema plus manifest at run time, and check 4.1 alarms when the count changes without a type change |
| We build the loop and the document still cannot be read | Medium | The pull model faithfully reports 176 gaps | This is the correct failure. A visible gap is the point; §5.4 is what closes it. |

---

## 7. Cost, sequence, and what I am not sure about

### 7.1 Sequence

| # | Piece | Depends on | Tier | Rough size |
|---|---|---|---|---|
| 1 | Field manifest: which of the 194 each document type prints | — | B | small — it is §1 turned into data |
| 2 | Matrix cleanup: delete the 13 dead snake_case keys, add the 130 missing fields | 1 | B | medium, mechanical |
| 3 | Per-field validation before write (the cheap half of O-3) | — | B | small, ships on its own, worth doing first |
| 4 | `ipo_field_plan` table + generator | 1, 2 | **A** | medium |
| 5 | The pull walk over the plan | 4 | **A** | large — this is the core |
| 6 | Tiering and demand-ordered budgets (O-4) | 5 | **A** | medium |
| 7 | The two missing extractors (ratios, basis-of-allotment ad) | — | B | medium each, independent |
| 8 | The re-read loop | 5 | **A** | medium |
| 9 | The verification checks in §4 | 5, 8 | B | medium — but nothing above is proven without it |
| 10 | Unit conversion (O-2) + `financial_data` becomes derived | 9 | **A** | large, own release |
| 11 | Migration M0–M5 | all | **A** | long-running |

Items 3 and 7 are genuinely independent and could start immediately without prejudging the rest.
Everything from 4 onward is one design and should not be half-built.

### 7.2 What is reversible and what is not

- **Reversible:** items 1, 2, 3, 7, 9 — additive, behind flags, no data rewritten.
- **Reversible with effort:** items 4, 5, 6, 8 — new writer, but `field_sources` records the previous
  value and source for every field, so a bad batch can be rolled back per field.
- **Not cleanly reversible:** item 10, the unit conversion, once the public API has served the new
  shape; and item 11 from M3 onward, once website-sourced values have been overwritten. Both need
  the staging proof to be real, not a green test.

### 7.3 What I am not sure about, plainly

1. **Whether the old PDFs are still downloadable.** M1 exists because I do not know, and the answer
   decides whether the 90% target applies to the whole site or only to IPOs from here forward. I
   would not promise the number before M1 reports.
2. **Whether `ipo_field_plan` should be a new table or columns on `field_sources`.** I have argued
   for the table. It is a real decision with a maintenance cost either way, and I would revisit it
   with the code in front of me.
3. **The FPO rules are unexercised.** Zero rows on production. They are written from the general
   pattern and have a higher chance of being wrong than anything else in §1.11.
4. ~~The target metric~~ **RESOLVED by the owner, 2026-09-08: the target is 100%, per field, not a
   blended average** (§2.1.1). I had proposed 90% of a chosen denominator; that was the wrong shape,
   because a blended percentage lets the worst fields hide inside a good average and nobody has to
   name which ones. The rule is: if the offer document prints the field, the offer document supplies
   it, and **every fall-through to round 2 or 3 is a named exception with a reason** (§2.5) rather
   than an accepted residue.

   The measured context that remains useful:

   | | Value | Source |
   |---|---:|---|
   | Document-owned fields on a real mainboard IPO (Deepa Jewellers) | 56 of 61 tracked | `field_sources`, this session |
   | Of those, supplied by the document today | 47 (**84%**) | same |
   | Fields it currently loses to a website **that the document prints** | 9 — company name, lead managers, lot size, registrar, symbol, price band low/high, segment, offering type | same |
   | Fields that can never be document-owned | 5 — open date, close date, listing date, status, listing exchange | the W-117 rule (§1.2) |

   So 100% is reachable on the document-owned set; the 5 excluded fields are excluded by our own
   deliberate decision, not by a shortfall. **What still needs the owner's word is whether those 5
   stay excluded** — see item 7.
5. **Whether `financial_data` should become derived or be dropped.** Deriving it keeps the API stable
   and fixes Annu Projects. Dropping it is cleaner and breaks the public shape. I have proposed
   deriving; I hold that loosely.
6. **The cost in wall-clock of M5.** 228 IPOs × re-download + extract, at one nightly window and the
   current extraction speed, is weeks. I have not modelled it properly and I would not want the
   estimate quoted.

7. ~~The timeline fields~~ **RESOLVED by the owner, 2026-09-08.** They stay on the exchanges as
   named exception E-1, NSE first and BSE second, and the owner then directed that the rule apply to
   the **full timetable family**, not only the five he first named. E-1 is now **twelve fields**
   (§1.2.1), established by testing every date- and schedule-like field among the 194 against one
   question: does this value change when the bidding window changes?

   The three I had missed are all in `anchor_investors` — the anchor bidding date and the two
   lock-in expiry dates, which are computed off the allotment date and are therefore wrong by
   exactly the amount the allotment date moves.

   **Two judgement calls I made inside that instruction, both flagged rather than silent:**
   `upi_cutoff_time` and `bid_windows` are in the same printed table but hold a **time of day, not a
   date** — when a window is extended the date moves and 5 PM is still 5 PM. I left them
   document-first, because putting fields in an exception list that the exception's reason does not
   cover is how such a list becomes a dumping ground. A two-row change if the owner prefers
   consistency over precision here.

8. **A data-hygiene defect found while doing this, not yet fixed.** `field_sources` holds two
   different keys for the same concept: `ipos.listingExchange` (224 rows) and `ipos.listingExchanges`
   (208 rows). Only the plural matches a real column; the singular writes provenance for a column
   that does not exist. Any per-field report on that concept is currently split across two names.
   Small, but it belongs in the matrix cleanup (§7.1 item 2) rather than being left to be
   rediscovered.

---

## 8. Definition of done for this document

Abhay has read §1 (the mapping), §2 (the pull loop), §3 (the re-read loop), §4 (verification),
§5 (O-1 to O-5 and O-7), §6 (migration) and §7 (cost and doubts), and said it is right — or named
what is wrong.

Then implementation is a separate decision, taken after this is agreed, with its own contracts,
tiers and budgets.

**The one thing that needs his answer before implementation can be scoped:** §7.3 item 4 — what "90%
from the offer documents" is a percentage *of*.

---

## Appendix A — the complete per-field source resolution (all 194 fields, all IPO types)

**This appendix is the implementable form of §1 and, where they differ, it wins.** §1 explains the
reasoning per group; some of its rows resolve a whole table in one sentence ("all of `financial_data`
is rank 1 DOC, rank 2 Chittorgarh, rank 3 Moneycontrol"), which is readable but not something code
can be built from. Every one of the 194 fields below carries its own three sources, its own per-type
variation, and — where there is no rank 2 or 3 — the reason there is none, so a blank is never
mistaken for an omission.

Generated from a single specification and **checked field-for-field against production**: 194 in the
spec, 194 populated on production, zero difference in either direction. That check is what makes this
appendix trustworthy rather than merely long, and it must be re-run whenever a field is added.

### A.0 The verification this appendix passed

Reviewed three times on 2026-09-08 at the owner's insistence. Each pass found real defects that
reading the document would not have shown. The current state:

| Check | Result |
|---|---|
| Every spec field exists on production, and every populated production field is in the spec | **194 = 194, zero difference either way** |
| Sourced fields with fewer than three sources that give **no reason** | **0** |
| Fields where SME silently loses a source mainboard has | **0** |
| Exchange-specific values fetchable for a venue the stock is not listed on | **0** |

**Mainboard source depth, stated plainly rather than claimed complete:**

| | Fields |
|---|---:|
| Three sources | **113** |
| Two sources, reason stated (§A.3 group 6) | 5 |
| One source, reason stated (§A.3 groups 1–5) | 35 |
| No source — computed (class C) or written by our own pipeline (class I) | 41 |
| **Total** | **194** |

**Not every sourced field has three, and they never will.** 40 of them have fewer because a
second publisher does not exist, or publishes a *different* number that would be wrong to substitute
— every one is listed with its reason in **§A.3**. Claiming three sources for the anchor investor
list or for share counts at the floor price would mean inventing one.

**Three rounds of defects this review caught.** All were in versions already committed, and none was
visible by reading the document:

1. **28 SME fields silently had only two sources.** The resolver deleted the absent exchange and left
   a hole instead of promoting the next real source, so `ipos.symbol` on a BSE-listed SME read
   `DOC · BSE · —` when the answer is `DOC · BSE · CG`. Measured on production, **Chittorgarh covers
   167 of 172 SME IPOs (97%, 3,272 rows) while BSE has written data for only 8** — so the dash was
   discarding SME's most reliable non-document source. Fixed by resolving from an ordered **pool**:
   ranks are the first three sources the IPO type actually has, so a hole cannot appear while a real
   source remains.

2. **An NSE price could be fetched for a stock that does not trade on NSE.** `current_price_nse` on a
   BSE-only SME fell through to Chittorgarh instead of being N/A. Now N/A in both directions.

3. **I asserted "no website publishes a restated financial statement". That was false, and our own
   scraper disproves it.** `scraper/src/scrapers/chittorgarh-detail-fields.ts` reads Chittorgarh's
   restated "Company Financials" table (`getTableById(html, 'financialTable')`) and extracts revenue,
   total income, EBITDA and PAT **per fiscal year**, plus the fiscal years themselves. Six
   `financial_statements` fields had been marked document-only on the strength of my assumption; they
   now carry Chittorgarh at rank 2 and Moneycontrol at rank 3. The five that remain document-only —
   `basis`, `unit`, `eps_basic`, `eps_diluted`, `op_cash_flow` — are the ones Chittorgarh genuinely
   does not print. Three `ipo_valuation` fields were corrected the same way: the price floor and cap
   are the same numbers as `ipos.price_range_min/max` and are published by both exchanges, and the
   market cap at the cap price is the single market-cap figure Chittorgarh prints.

   Mainboard fields with three sources went **68 → 103 → 112** across the three passes.

**Class counts (authoritative, superseding the estimate in §1.1): D 117 · T 12 · X 13 · M 4 · W 1 ·
C 11 · I 36 = 194.** Of these, **55 fields have no rank 2 at all** — the reason is stated on each row
and is almost always "no website or exchange publishes this" (CIN, the promoter tables, risk
factors, the anchor book, the valuation table). That is a finished answer, not a gap.

**Reading the columns.** `R1/R2/R3` are the mainboard IPO order. `SME-BSE` and `SME-NSE` give the
resolved order for those two types, where the absent exchange is dropped rather than left as a dead
rank. `N/A` means the field does not exist for that offering type and is not a gap to chase.

**The SME document-type order is different, and this matters.** Measured on production, SME IPOs have
**zero PRICE_BAND_AD documents** (mainboard has 12) and one DRHP (mainboard has 18); their document
set is dominated by the prospectus (64). So for SME the rank-1 document order is
**PROSPECTUS > RHP > CORRIGENDUM > DRHP**, not the mainboard's
**PRICE_BAND_AD > CORRIGENDUM > RHP > PROSPECTUS > DRHP**. For 173 SME IPOs — over half the site —
the price band, share counts and market cap come from the prospectus. The earlier draft assumed the
advertisement existed everywhere; it does not.

### A.1 The 194 fields

| # | Field | Cls | R1 | R2 | R3 | SME-BSE | SME-NSE | Doc § | Note / why no lower rank |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `ipos.symbol` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 cover |  |
| 2 | `ipos.company_name` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | cover |  |
| 3 | `ipos.issue_size` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A5+A6 |  |
| 4 | `ipos.lot_size` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A3 |  |
| 5 | `ipos.open_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 6 | `ipos.close_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 7 | `ipos.listing_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 8 | `ipos.status` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 9 | `ipos.registrar` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | E3 |  |
| 10 | `ipos.registrar_id` | C | — | — | — | — · — · — | — · — · — | — | computed: FK resolved from registrar |
| 11 | `ipos.rating_override` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 12 | `ipos.slug` | C | — | — | — | — · — · — | — · — · — | — | computed: generateIPOSlug(company_name) |
| 13 | `ipos.sector` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | F1 |  |
| 14 | `ipos.price_range_min` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 15 | `ipos.price_range_max` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 16 | `ipos.last_scraped_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 17 | `ipos.listing_exchanges` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 18 | `ipos.face_value` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A2 |  |
| 19 | `ipos.allotment_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 20 | `ipos.company_description` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | F1 |  |
| 21 | `ipos.lead_managers` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | E1 |  |
| 22 | `ipos.isin` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 |  |
| 23 | `ipos.segment` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 24 | `ipos.offering_type` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A11 |  |
| 25 | `ipos.scraper_locked` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 26 | `ipos.last_manual_edit_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 27 | `ipos.objectives` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | F4 |  |
| 28 | `ipos.bse_ipo_no` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload identifier |
| 29 | `ipos.bse_payload_lead_manager_count` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload cross-check only |
| 30 | `ipos.company_website` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | E7 |  |
| 31 | `ipos.verifier_url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 32 | `ipos.cin` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | E7 | no rank 2: no website or exchange publishes the CIN |
| 33 | `ipo_details.company_description` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | F1 |  |
| 34 | `ipo_details.issue_type` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A11 |  |
| 35 | `ipo_details.fresh_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A5 |  |
| 36 | `ipo_details.ofs_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A6 |  |
| 37 | `ipo_details.face_value` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A2 |  |
| 38 | `ipo_details.basis_of_allotment_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 39 | `ipo_details.initiation_of_refunds_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 40 | `ipo_details.credit_of_shares_date` | T | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | **E-1** (§1.2.1) |
| 41 | `ipo_details.exchanges` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 42 | `ipo_details.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 43 | `ipo_details.last_verified_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 44 | `ipo_details.compliance_officer` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | E4 | no rank 2: named only in the filing |
| 45 | `ipo_details.compliance_officer_phone` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | E4 | no rank 2: named only in the filing |
| 46 | `ipo_details.compliance_officer_email` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | E4 | no rank 2: named only in the filing |
| 47 | `ipo_details.upi_cutoff_time` | D | DOC | NSE | CG | DOC · CG · MC | DOC · NSE · CG | B7 | clock time, not a date — deliberately NOT in E-1 |
| 48 | `ipo_details.designated_exchange` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A14 |  |
| 49 | `ipo_details.lot_multiple` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | A3 |  |
| 50 | `ipo_details.allocation_pct` | D | DOC | NSE | CG | DOC · CG · MC | DOC · NSE · CG | A13 |  |
| 51 | `ipo_details.pre_ipo_placement` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | D6 | no rank 2: disclosure exists only in the filing |
| 52 | `ipo_details.bid_windows` | D | DOC | NSE | CG | DOC · CG · MC | DOC · NSE · CG | B8 | clock windows, not dates — deliberately NOT in E-1 |
| 53 | `ipo_details.promoter_shares_held` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | D2 | no rank 2: capital-structure table only |
| 54 | `ipo_details.sebi_regulation_cited` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A12 | no rank 2: printed only on the advertisement |
| 55 | `ipo_details.promoter_group_transactions_since_drhp` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | D7 | no rank 2: disclosure exists only in the filing |
| 56 | `financial_data.revenue_fy2022` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 57 | `financial_data.revenue_fy2023` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 58 | `financial_data.revenue_fy2024` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 59 | `financial_data.profit_fy2022` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 60 | `financial_data.profit_fy2023` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 61 | `financial_data.profit_fy2024` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 62 | `financial_data.net_worth` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C2 |  |
| 63 | `financial_data.pe_ratio` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A9 |  |
| 64 | `financial_data.eps` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C6 |  |
| 65 | `financial_data.roe` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | — |  |
| 66 | `financial_data.debt_to_equity` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | — |  |
| 67 | `financial_data.reserves_and_surplus` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C2 |  |
| 68 | `financial_data.total_assets` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C2 |  |
| 69 | `financial_data.total_borrowing` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C2 |  |
| 70 | `financial_data.promoter_holding_pre_issue` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | D8 |  |
| 71 | `financial_data.promoter_holding_post_issue` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | D8 |  |
| 72 | `financial_data.market_cap` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A8 |  |
| 73 | `financial_data.pre_ipo_eps` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C6 |  |
| 74 | `financial_data.post_ipo_eps` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C6 |  |
| 75 | `financial_data.ronw` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A10 |  |
| 76 | `financial_data.ebitda_fy2022` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 77 | `financial_data.ebitda_fy2023` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 78 | `financial_data.ebitda_fy2024` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 79 | `financial_data.total_income_fy2022` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 80 | `financial_data.total_income_fy2023` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 81 | `financial_data.total_income_fy2024` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 |  |
| 82 | `financial_statements.fiscal_year` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 | CG restated table carries this per fiscal year |
| 83 | `financial_statements.revenue` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 | CG restated table carries this per fiscal year |
| 84 | `financial_statements.total_income` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 | CG restated table carries this per fiscal year |
| 85 | `financial_statements.ebitda` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 | CG restated table carries this per fiscal year |
| 86 | `financial_statements.pat` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C1 | CG restated table carries this per fiscal year |
| 87 | `financial_statements.net_worth` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C2 | CG gives the most-recent year only, not the full series |
| 88 | `financial_statements.basis` | D | DOC | — | — | DOC · — · — | DOC · — · — | C8 | no rank 2: CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement |
| 89 | `financial_statements.unit` | D | DOC | — | — | DOC · — · — | DOC · — · — | C7 | no rank 2: CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement |
| 90 | `financial_statements.eps_basic` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement |
| 91 | `financial_statements.eps_diluted` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement |
| 92 | `financial_statements.op_cash_flow` | D | DOC | — | — | DOC · — · — | DOC · — · — | C3 | no rank 2: CG prints a single pre/post-issue EPS pair and no basis/unit/cash-flow line; the per-fiscal-year basic-vs-diluted split exists only in the restated statement |
| 93 | `ipo_valuation.price_floor` | D | DOC | NSE | BSE | DOC · BSE · — | DOC · NSE · — | A1 | same number as ipos.price_range_min |
| 94 | `ipo_valuation.price_cap` | D | DOC | NSE | BSE | DOC · BSE · — | DOC · NSE · — | A1 | same number as ipos.price_range_max |
| 95 | `ipo_valuation.mcap_at_cap` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A8 | CG prints a single market cap, which is the at-cap figure |
| 96 | `ipo_valuation.pe_at_cap` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | A9 | CG prints a single post-issue P/E, which is the at-cap figure (same logic as mcap_at_cap) |
| 97 | `ipo_valuation.mcap_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A8 | no rank 2: CG prints only ONE market cap (the at-cap one); no website prints the value at the floor price |
| 98 | `ipo_valuation.pe_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: CG prints only ONE P/E (post-issue, at cap); no website prints the value at the floor price |
| 99 | `ipo_valuation.ronw_weighted_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | A10 | no rank 2: CG prints a single-year RoNW; the 3-year WEIGHTED average is a different metric and appears only in the advertisement |
| 100 | `ipo_valuation.pricing_event` | I | DOC | — | — | DOC · — · — | DOC · — · — | — | no rank 2: not a sourced value - it records WHICH document produced the row (PRICE_BAND_AD vs PROSPECTUS) |
| 101 | `ipo_valuation.shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 102 | `ipo_valuation.shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 103 | `ipo_valuation.fresh_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 104 | `ipo_valuation.fresh_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 105 | `ipo_valuation.ofs_shares` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 106 | `ipo_valuation.total_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 107 | `ipo_valuation.total_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 108 | `ipo_valuation.face_value_multiple_floor` | C | — | — | — | — · — · — | — · — · — | — | computed: price_floor ÷ face_value |
| 109 | `ipo_valuation.face_value_multiple_cap` | C | — | — | — | — · — · — | — · — · — | — | computed: price_cap ÷ face_value |
| 110 | `promoters.name` | D | DOC | — | — | DOC · — · — | DOC · — · — | D1 | no rank 2: capital-structure table only |
| 111 | `promoters.waca` | D | DOC | — | — | DOC · — · — | DOC · — · — | D3 | no rank 2: basis-for-offer-price table only |
| 112 | `promoters.is_promoter_group` | D | DOC | — | — | DOC · — · — | DOC · — · — | D1 | no rank 2: capital-structure table only |
| 113 | `ipo_intermediaries.role` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | E1–E6 |  |
| 114 | `ipo_intermediaries.name` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · MC | E1–E6 |  |
| 115 | `ipo_risk_factors.seq` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 116 | `ipo_risk_factors.heading` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 117 | `brlm_track_record.brlm_name` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 118 | `brlm_track_record.as_of_date` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: historical, never moves |
| 119 | `brlm_track_record.issues_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 120 | `brlm_track_record.closed_below_issue_price` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 121 | `peer_companies.company_name` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 122 | `peer_companies.is_listed` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 123 | `peer_companies.pe_ratio` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 124 | `peer_companies.eps` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 125 | `peer_companies.diluted_eps` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 126 | `peer_companies.ronw` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 127 | `peer_companies.nav` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 128 | `peer_companies.pbv_ratio` | D | DOC | CG | MC | DOC · CG · MC | DOC · CG · MC | C9 |  |
| 129 | `peer_companies.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 130 | `peer_companies.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 131 | `anchor_investors.bid_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 132 | `anchor_investors.total_shares_offered` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 133 | `anchor_investors.total_amount_raised` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 134 | `anchor_investors.anchor_investors_count` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 135 | `anchor_investors.investor_list` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 136 | `anchor_investors.lock_in_50_percent_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 137 | `anchor_investors.lock_in_remaining_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 138 | `documents.type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 139 | `documents.title` | I | — | — | — | — · — · — | — · — · — | — |  |
| 140 | `documents.url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 141 | `documents.file_size` | I | — | — | — | — · — · — | — · — · — | — |  |
| 142 | `documents.uploaded_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 143 | `documents.exchange` | I | — | — | — | — · — · — | — · — · — | — |  |
| 144 | `documents.media_type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 145 | `documents.sequence_number` | I | — | — | — | — · — · — | — · — · — | — |  |
| 146 | `documents.is_active` | I | — | — | — | — · — · — | — · — · — | — |  |
| 147 | `documents.extraction_status` | I | — | — | — | — · — · — | — · — · — | — |  |
| 148 | `documents.extracted_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 149 | `documents.extraction_error` | I | — | — | — | — · — · — | — · — · — | — |  |
| 150 | `documents.retry_count` | I | — | — | — | — · — · — | — · — · — | — |  |
| 151 | `documents.sha256` | I | — | — | — | — · — · — | — · — · — | — |  |
| 152 | `documents.filing_date` | D | DOC | BSE | — | DOC · BSE · — | DOC · — · — | B9 | historical — never moves; the doc-type healing rule depends on it |
| 153 | `subscriptions.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 154 | `subscriptions.qib_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 155 | `subscriptions.nii_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 156 | `subscriptions.retail_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 157 | `subscriptions.total_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 158 | `subscriptions.employee_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 159 | `subscriptions.b_nii_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 160 | `subscriptions.s_nii_subscription` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 161 | `subscriptions.total_shares_bid` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 162 | `subscriptions.shares_offered` | X | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: no document can carry a live figure |
| 163 | `subscriptions.scope` | I | — | — | — | — · — · — | — · — · — | — |  |
| 164 | `gmp_records.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 165 | `gmp_records.gmp` | W | IG | CG | MC | IG · CG · MC | IG · CG · MC | — | no rank 2: grey market has no official source, ever |
| 166 | `gmp_records.source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 167 | `gmp_records.gmp_percentage` | C | — | — | — | — · — · — | — · — · — | — | computed: gmp ÷ price_range_max × 100 |
| 168 | `listing_performance.listing_price` | M | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: post-listing market data |
| 169 | `listing_performance.issue_price` | C | — | — | — | — · — · — | — · — · — | — | computed: ipos.price_range_max at listing |
| 170 | `listing_performance.listing_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (listing − issue) ÷ issue × 100 |
| 171 | `listing_performance.current_price` | M | NSE | BSE | CG | BSE · CG · MC | NSE · CG · MC | — | no rank 2: post-listing market data |
| 172 | `listing_performance.current_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (current − issue) ÷ issue × 100 |
| 173 | `listing_performance.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 174 | `listing_performance.current_price_bse` | M | BSE | CG | MC | BSE · CG · MC | N/A · N/A · N/A | — | no rank 2: BSE quote by definition |
| 175 | `listing_performance.current_price_nse` | M | NSE | CG | MC | N/A · N/A · N/A | NSE · CG · MC | — | no rank 2: NSE quote by definition |
| 176 | `listing_performance.symbol` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.symbol |
| 177 | `listing_performance.company_name` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.company_name |
| 178 | `listing_performance.listing_date` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.listing_date (E-1 sourced) |
| 179 | `listing_performance.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 180 | `ipo_demand_graph.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 181 | `ipo_demand_graph.price_point` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it |
| 182 | `ipo_demand_graph.is_cut_off` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it |
| 183 | `ipo_demand_graph.cumulative_quantity` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it |
| 184 | `ipo_demand_graph.exchange` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it |
| 185 | `registrars.name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 186 | `registrars.short_name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 187 | `registrars.email` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 188 | `registrars.phone` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 189 | `registrars.website` | D | REG | DOC | CG | REG · DOC · CG | REG · DOC · CG | E3 | the registrar itself is authoritative for its own URL |
| 190 | `registrars.allotment_check_url` | I | REG | — | — | REG · — · — | REG · — · — | — | no rank 2: the registrar owns this URL |
| 191 | `registrars.address` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 192 | `registrars.active` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 193 | `registrars.allotment_url_healthy` | I | — | — | — | — · — · — | — · — · — | — |  |
| 194 | `registrars.allotment_url_checked_at` | I | — | — | — | — · — · — | — · — · — | — |  |

### A.3 Every field with fewer than three sources, and exactly why

Of the fields that are sourced at all, 40 have fewer than three. **None of them is an omission.** Each is here
because a second or third publisher of that fact does not exist, or exists but publishes a
*different* number that would be wrong to substitute. Grouped by reason.

#### Group 1 — the value exists only at a specific price point (11 fields, 1 source)

`ipo_valuation`: `shares_at_floor`, `shares_at_cap`, `fresh_shares_at_floor`, `fresh_shares_at_cap`,
`ofs_shares`, `total_shares_at_floor`, `total_shares_at_cap`, `mcap_at_floor`, `pe_at_floor`,
`ronw_weighted_3y`, and `pricing_event`.

Websites publish the issue size in rupees and a single market cap and P/E. **They never publish the
share split at the floor price versus the cap price** — that table exists only in the price band
advertisement. Substituting a website's single figure would silently answer a different question:
Chittorgarh's one market cap is the at-cap figure, so it can serve `mcap_at_cap` (and does, at rank
2) but there is nothing at all for `mcap_at_floor`. Same for P/E. `ronw_weighted_3y` is a
three-year *weighted* average; Chittorgarh prints a single-year RoNW, which is a different metric
that happens to share a name. `pricing_event` is not sourced at all — it records which document
produced the row.

#### Group 2 — disclosures that exist only in a filing (13 fields, 1 source)

- `promoters.name`, `promoters.waca`, `promoters.is_promoter_group` — the capital-structure and
  weighted-average-cost-of-acquisition tables. Verified: our Chittorgarh scraper extracts promoter
  *holding percentages* but no promoter names or acquisition costs.
- `ipo_risk_factors.seq`, `ipo_risk_factors.heading` — risk factors are a regulatory disclosure. No
  aggregator republishes them.
- `financial_statements.basis`, `unit`, `eps_basic`, `eps_diluted`, `op_cash_flow` — Chittorgarh
  *does* publish the restated figures (that correction is recorded in A.0), but it prints a single
  pre/post-issue EPS pair rather than the per-fiscal-year basic-versus-diluted split, and gives no
  reporting basis, no unit line and no cash-flow row.
- `ipo_details.compliance_officer`, `compliance_officer_phone`, `compliance_officer_email` — named
  only in the filing's General Information section.

#### Group 3 — the exchange filing IS the only publisher (4 fields, 1 source)

`anchor_investors.total_shares_offered`, `total_amount_raised`, `anchor_investors_count`,
`investor_list`.

The anchor allocation report is itself an exchange filing. There is no second publisher of the
anchor book — a website that carried it would be copying the same circular, which makes it a mirror,
not an independent source.

#### Group 4 — a candidate second source exists but is unverified (4 fields, 1 source)

`brlm_track_record.brlm_name`, `as_of_date`, `issues_3y`, `closed_below_issue_price`.

Printed in the advertisement. **Chittorgarh has lead-manager performance pages** (the scraper already
follows `/lead-manager/<slug>/` links) that might serve as rank 2. We have never fetched or parsed
them, so promoting them to a rank would be asserting something unverified. Listed here as a
candidate to test in migration stage M1, not claimed as a source.

#### Group 5 — the field IS one party's own record (5 fields, 1 source)

- `ipos.rating_override`, `ipos.scraper_locked`, `registrars.active` — admin flags. No external
  source exists by design.
- `ipos.bse_ipo_no`, `ipos.bse_payload_lead_manager_count` — BSE's own internal identifiers, used
  only as cross-checks. NSE has no equivalent.
- `registrars.allotment_check_url` — the registrar owns this URL. A third party's copy would be a
  stale mirror, and this field already has its own health probe.

#### Group 6 — genuinely two sources, and there is no third (5 fields, 2 sources)

- `ipo_demand_graph.price_point`, `is_cut_off`, `cumulative_quantity`, `exchange` — NSE then BSE. A
  live bid book exists nowhere else: no document can carry it and no website republishes it.
- `documents.filing_date` — the document cover, then the BSE payload. NSE does not expose a filing
  date in a form we can read.

#### What this means for the 100% rule

None of these 40 weakens it. The 100% rule (§2.1.1) is about **round 1 supplying every field the
offer document prints**. 24 of these 40 are document-owned with no fallback, which makes round 1 the
*only* round — the rule applies to them most strictly of all. The remaining 16 are exchange-owned,
admin-owned or registrar-owned facts that were never in the document's scope.


### A.2 Offering-type coverage

How many of the 194 fields apply to each offering type. A high `N/A` count is correct, not a
shortfall: a buyback has no price band, no anchor book and no peer comparison.

| Offering type | IPOs on prod | Fields N/A | Fields with a live resolution |
|---|---:|---:|---:|
| FPO | 0 | 0 | 194 |
| RIGHTS | 8 | 34 | 160 |
| OFS | 19 | 34 | 160 |
| NCD | 7 | 74 | 120 |
| INVITS | 3 | 77 | 117 |
| REITS | 2 | 77 | 117 |
| TENDER | 16 | 96 | 98 |
| BUYBACK | 1 | 96 | 98 |


**FPO shows 194 applicable and 0 N/A because it follows mainboard exactly, minus the draft-prospectus
stage. There are zero FPO rows on production, so none of it has ever been exercised — it is the least
trustworthy column in this appendix and is flagged as such in §7.3 item 3.**

**OFS and BUYBACK (20 IPOs) have never had a single provenance row written**, so for them this
appendix describes an intention rather than a correction of existing behaviour.

