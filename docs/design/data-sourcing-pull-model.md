# Data sourcing: the pull model

> ### Status — NOT SAFE TO BUILD FROM
>
> Reviewed 2026-09-08 by four independent passes (author, IPO domain, engineering, verification
> model). Status per finding is in `findings.json`, which is the register — not this document, and
> which is under active concurrent edit (F-41, F-42, F-43 were added by the owner/lead mid-session).
> As of the last check, **2 critical findings are OPEN (F-03, F-43)** — F-13, F-22, F-23, F-26, F-27
> and F-33 closed this session; F-39, F-40 (MAJOR), F-41, F-42 (MAJOR) also remain OPEN, all needing
> the owner or a live fetch. **Do not trust a finding count typed here — read `findings.json`.**
>
> **Sections §0, Appendix A.0 and A.3 survive review. §1.2.1, §2, §3, §4 and §6 are being re-cut.**
> Do not implement from those sections.
>
> **Scope (owner, 2026-09-08): phase 1 is open and upcoming IPOs only — 19 today, all plain `IPO`,
> mainboard or SME.** No closed IPO is touched. Closed IPOs follow afterwards, one at a time, newest
> close date first. This scope removes 8 of the 40 findings, which reopen for the closed-IPO work.
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

**240 published fields are here: 194 populated on production today, plus 46 published columns the
offer document prints but that hold no data at all today** (F-13 — scoping this mapping to only
what's already populated was backwards; a field is empty precisely because no document was ever read
for it). **§1 gives the reasoning per group; Appendix A gives the implementable per-field table with
per-type variations, and where the two differ Appendix A wins.** Each falls into one of six classes,
and the class decides whether a source ranking is even meaningful:

| Class | Meaning | Ranking |
|---|---|---|
| **D** | The offer document prints it | 1 document · 2 exchange · 3 website |
| **T** | The bidding timetable — **named exception E-1** (§1.2.1) | 1 NSE · 2 BSE · 3 website; document is not a source |
| **X** | Other live or exchange-governed data (subscription, demand graph) | 1 exchange · 2 website · 3 document |
| **W** | Neither document nor exchange publishes it (grey market) | website only |
| **M** | Market data after listing | 1 exchange · 2 website |
| **C** | We compute it; it has no external source | formula + named inputs, no ranking |
| **I** | Our own pipeline produces it (bookkeeping) | writer named, no ranking |

Class counts across the 240, computed from the field list rather than estimated:
**D 162 · T 10 · X 13 · M 4 · W 1 · C 13 · I 37 = 240** (authoritative count, from the generated
spec in Appendix A — an earlier estimate in this section was slightly off and Appendix A wins). The
pull loop walks the D, T, X, W and M fields — **190 of the 240**. The 10 T fields are the named
exception E-1 (§1.2.1) and are the only fields excluded from the 100% rule. The 13 C fields are
recomputed after their inputs settle (2 of them — the anchor lock-in dates — moved here from T,
F-22). The 37 I fields are written by the pipeline itself and are never sourced.

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

### 1.2.1 E-1 — the fields where the exchange wins, under the re-filing test (S-05)

**This is no longer an exception. It is an application of a rule.**

The owner confirmed the governing principle on 2026-09-08, and it lives in
`docs/specs/per-ipo-due-step-pipeline.md` **S-05** — the SSOT for source tiers. It is not restated
here; the one line that matters is:

> **The filing wins wherever a change to the fact forces a new filing. The exchange wins where it
> does not.**

Almost every fact obliges the issuer to re-file when it changes, so the document stays current by
construction and tier 1a is right. The bidding timetable is the one group where nothing is re-filed:
a price band advertisement is printed once and is **never reprinted when a window is extended**.

That reading removes the contradiction between this design and the approved source-tier spec (finding
F-43): S-03 stands untouched, and E-1 is what S-05 produces when applied to the timetable — not a
carve-out from it. The practical consequence is unchanged from the owner's original instruction:
**NSE first, BSE second, Chittorgarh third, and the document is not a source for these fields.**

**Source order for every field in E-1:** round 1 **NSE**, round 2 **BSE**, round 3 Chittorgarh.
The offer document is not a source for these fields at any round.

**Why.** The price band advertisement does print an indicative timetable, so by the letter of the
100% rule these would be document fields. But the advertisement is printed once and **is never
reissued when a company extends its bidding window.** NSE and BSE update the same day; the PDF does
not. Sourcing these from the document would publish a stale close date on a live IPO — the single
most damaging error this site can make, and the reason the W-117 rule exists.

**The fields in E-1 — ten.** The owner named five and then directed (2026-09-08): *"list the
full timetable family for me to see and understand. Apply the same rule to all the timetable
fields."* The full family, established by walking every date- and schedule-like field among the 194
fields known at the time and testing each against one question — **does this value change when the
bidding window changes?** Two of the twelve originally named here were removed 2026-09-08 closing
F-22: `anchor_investors.lock_in_50_percent_date` and `lock_in_remaining_date` are not independently
sourced at all — they are **derived** (`allotment_date + 30 / + 90 days`) and move automatically
whenever field 4 moves, so E-1 membership was never the right frame for them. See the note below the
table.

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
| 9 | `ipos.status` | — | 289 | 230 web · 56 exch · 3 doc | named by the owner; position in the timetable |
| 10 | `ipos.listing_exchanges` | A15 | 208 | 161 web · 23 exch · 24 doc | named by the owner; **24 document values flip** |

**Removed from E-1, F-22 (2026-09-08):** `anchor_investors.lock_in_50_percent_date` and
`lock_in_remaining_date` (contract § not applicable — these have no exchange or document filing of
their own). They are class **C**, computed as `allotment_date + 30 days` and `allotment_date + 90
days` per the SEBI circular — **that regulation reading is UNVERIFIED against the circular text**
and should be confirmed before this design is built from. Separately: **the live scraper does not
compute them this way today.** `scraper/src/scrapers/anchor-investors-scraper.ts:302` derives both
dates from the anchor **bid** date instead of the allotment date, which lands roughly a week early —
an existing production bug, tracked separately, not fixed by this design.

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

**E-1 is counted, not hidden.** Check 4.3b reports the ten E-1 fields as a fixed, named exclusion
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
| 135–136 | `anchor_investors.lock_in_*_date` | 2 each | **C** | — | — | — | keep | — | `= allotment_date + 30d / + 90d` (SEBI circular, **UNVERIFIED** against the circular text) | derived, not sourced — **reclassed out of E-1, F-22 (2026-09-08)**; the live scraper computes both from `bid_date` instead of `allotment_date` (`anchor-investors-scraper.ts:302`), ~1 week early — a production bug, tracked separately |
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

### 1.11.1 Retired source: Moneycontrol (owner decision, 2026-09-09)

**Moneycontrol is retired as a source.** It holds no rank in this design.

**What it actually served**, corrected — I stated "nine fields" from one grep of one file, which was
wrong. Across `moneycontrol-scraper.ts` and `moneycontrol-orchestrator-v2.ts` it produces about
**fifteen core fields plus four subscription figures**: allotment date, close date, company name,
ISIN, issue size, listing date, listing exchange, lot size, offering type, open date, price band low
and high, segment, status, symbol, and the QIB/NII/retail/total subscription multiples.
(`field_sources` also carries `faceValue` and `registrar` rows from Moneycontrol that neither file
maps today — pre-refactor writes.)

**The conclusion is unchanged, and it is the reason to retire it: for every one of those fields, the
offer document plus NSE plus BSE — or the document plus Chittorgarh — already fill the top three.**
Moneycontrol is fourth-best at everything and reaches a rank nowhere. Its ~180 provenance rows exist
only because the **push** model let it win by arriving first, not because it was preferred.

**Retirement is not deletion, and the order matters:**

1. **Now, in this design:** zero ranks, and no capability entry. The pull loop never asks it.
2. **Next:** stop scheduling the scraper. This is where the saving is — one fewer source fetched
   every aggregator run.
3. **Not done:** the `MONEYCONTROL` value stays in the `scraper_source` enum, and the ~180 existing
   provenance rows stay exactly as they are. **Those rows are the historical truth of where a value
   came from** — rewriting them would be falsifying provenance. They will be superseded naturally as
   the pull loop re-sources those fields from the document.
4. **Kept, and separate:** `moneycontrol-rss.ts` reads an IPO **news** feed, not IPO data. It is a
   different thing that happens to share a domain name and is untouched by this decision.

**What we lose:** nothing this design ranks. **What to watch:** if a field ever falls through all
three ranks on an IPO where Moneycontrol used to supply it, that is an `EXHAUSTED` row (§2.6) and it
is visible — it is not silence.

### 1.12 Retired fields — never write these (owner decision, 2026-09-08)

The public API returns **19 fields that are `null` on all 327 production IPOs**, and the `ipos` table
carries **6 more columns not even declared in `schema.ts`** — orphaned, unreachable from Drizzle,
readable only by raw SQL. Twenty-five in total.

**They are not gaps. They are duplicates of data that is already flowing**, and the live homes are
full while the mirrors are empty:

| The empty API fields | Where the data actually lives | Volume there | Source |
|---|---|---:|---|
| `subscriptionRetail` · `subscriptionHni` · `subscriptionQib` · `subscriptionTotal` | `subscriptions` | **27,514 rows · 111 IPOs** | NSE → BSE |
| `gmpPrice` · `gmpPercentageHistorical` · `gmpUpdatedAtHistorical` — and the orphans `gmp`, `gmp_percentage`, `gmp_updated_at` | `gmp_records` | **8,400 rows · 90 IPOs** | InvestorGain → Chittorgarh |
| `listingPriceHistorical` · `listingDateHistorical` · `listingGainPercentage` · `listingGainAmount` · `currentPrice` · `currentGainPercentage` · `currentGainAmount` · `currentPriceUpdatedAt` | `listing_performance` | **242 rows · 242 IPOs** | NSE/BSE for prices; the gains are computed |
| `historicalDataSource` · `historicalDataScrapedAt` | `listing_performance.data_source` / `last_updated` | — | our own pipeline |
| orphans `price_band_low` · `price_band_high` | `ipos.price_range_min/max` | 300 IPOs | DOC → NSE → BSE |
| orphan `exchange` | `ipos.listing_exchanges` | 327 IPOs | NSE → BSE (E-1) |

So `ipos.subscription_total` is null on all 327 IPOs while `subscriptions` holds 27,514 rows. Same
data — one column empty, one table full.

**Why this matters to the pull model specifically.** These are a trap. The design introduces a
configuration file listing every field and its sources (§2.3.5). While a column exists *and* appears
in the API, someone eventually adds it to that config and starts writing to it **in parallel with the
child table the rest of the codebase reads** — the exact duplicate-write problem this design exists
to remove, reintroduced by a leftover.

**The owner's decision, 2026-09-08, in three steps:**

1. **Now, in this design: all 25 are marked `never write`.** No plan row, no rank, no config entry.
2. **Next release, as its own small change: the 19 stop appearing in the API response.** This is
   near-zero risk and not really a breaking change — **a field that is `null` on every IPO is already
   functionally absent to every consumer.** A reader gets `null` today and `undefined` afterwards;
   both are falsy and every consumer already handles the empty case, because that is all it has ever
   received. Only code testing for the *key's existence* rather than its value would notice, and the
   owner confirmed **nothing outside this repo reads this API**.
3. **Later, after phase 1: drop the columns**, behind a per-table consumer audit. That is the part
   that carries real risk — `listing_performance.current_price` is populated and shares a name with
   the dead `ipos.current_price`, so a name-based grep cannot tell them apart.

**Two exceptions held back deliberately: `rating` and `ratingRationale`.** These are not mirrors of
anything. They would be **IPODhan's own view of an IPO**, for which no external source exists or
should. `ipo_scores` holds 10 rows and `ipo_reviews` holds zero — **an unbuilt feature, not dead
weight.** They leave the API response with the other 17 (they are null either way, so nothing is
lost), but **the columns stay**, so the product decision remains open rather than being closed as a
side effect of tidying.

## 2. How we go and get it — the pull loop

**Scope: phase 1 only.** 19 IPOs, status OPEN or UPCOMING, all `offering_type = 'IPO'`, mainboard or
SME (measured 2026-09-08). No closed IPO is read or written. Closed IPOs follow afterwards, one at a
time, newest close date first — that is section 6, and none of it is specified here.

Every claim below about how the system behaves today carries the file and line it was read from.
Anything not cited is a proposal, not a fact. That rule exists because the first draft of this
section asserted seven things about our own code that were false, and an implementer who trusted
them would have built the wrong thing.

### 2.1 What runs, and when — D-13 is the decision; this section only adds to it

**The cadence is not this design's to invent.** It was decided by the owner on 2026-09-03 as **D-13**
(`docs/walks/2026-09-02-deepa-pipeline-walk.md`, decision table) and its conformance is recorded in
`docs/specs/per-ipo-due-step-pipeline.md` §5.1. Those two are the source of truth. Restated here only
as far as the pull loop depends on it:

| Work | Cadence (D-13) | Where it lives |
|---|---|---|
| Discovery | **4× a day — 08:30, 11:00, 14:00, 17:30 IST** | `due-step-cycle.ts:15` |
| Due list | with discovery and after any filing — **not every 30 minutes** | `due-step-cycle.ts` |
| Live numbers | every wake **in market hours, Mon–Fri 10:00–17:00 IST, OPEN IPOs only** | `due-step-cycle.ts:81-85`, `index.ts:343` |
| Aggregators | once per filing + daily while open | `index.ts:180,346-370` |
| Sat / Sun / NSE holiday | only UPCOMING/PRE_OPEN/OPEN candidates do network work | `document-cycle-calendar-gate.ts` |

**The pull walk runs in the four discovery slots**, plus whenever a document for a phase-1 IPO
reaches `EXTRACTED`. It does not run on every wake. Measured: **6 OPEN, 13 UPCOMING** — so the
expensive walk touches 19 IPOs four times a day, and the cheap live poll touches 6.

#### 2.1.1 One correction to how D-13 was built: grey-market premium is gated with subscription, and should not be

D-13 said *"live numbers"*. The implementation put **subscription, demand graph and GMP behind one
market-hours gate** (`scraper/src/index.ts:343` runs `live:GMP` only inside
`isMarketHoursIST`). Those three do not have the same shape:

- **Subscription and the demand graph only exist during bidding hours.** Gating them is correct.
- **The grey market is an informal market that is most active in the evening**, and it trades at
  weekends. Gating it to 10:00–17:00 weekdays freezes the number exactly when readers look at it.

**Measured on production, 2026-09-08 22:03 IST:**

| | Before the scheduler (pre-04 Sep) | After |
|---|---:|---:|
| GMP fetches on a Saturday or Sunday | 2,045 | **0** |

and the newest `gmp_records` row was **16:02 IST while it was 22:03** — six hours stale, and it stays
that way until 10:00 the next morning. `timestamp` is our own fetch clock, not the source's
(`investorgain-gmp-orchestrator-v2.ts:536` sets `timestamp: new Date()`), so this is our gap, not
InvestorGain's. Over a Friday-to-Monday weekend the published figure reaches **about 65 hours old**.

**APPROVED by the owner, 2026-09-08.** Split the live step. Subscription and demand graph stay
inside the market-hours gate. **GMP runs on every wake while an IPO is UPCOMING or OPEN, including
evenings, weekends and holidays.** It is one HTTP request against one page and it is the single
most-read number on an IPO page outside market hours.

This is a change to D-13's *implementation*, not to D-13. Finding **F-41**, approved.

#### 2.1.2 An open question: nothing runs between 17:30 and 08:30

Discovery has a **15-hour hole overnight**. Price band advertisements are commonly filed in the
evening for an issue that opens the next morning; if that is the real pattern, the site shows no
price band for the whole evening before an issue opens — the window in which people actually
research it.

**This is a hypothesis, not a measured fact, and it cannot be measured from our own data**: discovery
only runs at those four slots, so our record of when a document "appeared" is a record of when we
looked. A fifth slot around 21:00 IST would close it cheaply. **APPROVED by the owner, 2026-09-08: add the evening slot.** Finding **F-42**.

#### 2.1.3 A contradiction with an existing approved spec, surfaced rather than buried

`docs/specs/per-ipo-due-step-pipeline.md` §6 (source tiers S-03/S-04, decided 2026-09-03) says tier-1a
filings are the truth for *"every static field (terms, **timeline**, financials, promoters,
intermediaries, objects, risks)"*, and that a tier-1b exchange value must never override a filing
value.

**Exception E-1 in this design does the opposite for the bidding timetable** — it puts NSE and BSE
above the document for open, close, allotment and listing dates, because a printed advertisement is
never reissued when a window is extended (W-117).

Both have a real reason. They cannot both stand. The design's position is that E-1 is the narrower
and later rule and should win **for the twelve timetable fields only**, leaving §6 intact everywhere
else — but that is a change to an approved spec and it is the owner's to confirm. Until then §6 and
E-1 disagree in writing, and no implementer should be asked to guess which one governs.

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

### 2.3.1 Every non-document fetch must prove the page is this IPO

**The mechanism, observed 2026-09-08.** A Chittorgarh IPO URL is
`/ipo/<slug>-ipo/<number>/`. **Only the number identifies the page; the slug is ignored.** Asking
for `/ipo/prasol-chemicals-ipo/1234/` returns HTTP 200 and the *Empyrean Cashews* page — a real,
well-formed page for a different company, with no redirect and no error.

**This is not a live defect today, and the design should not pretend otherwise.** The scraper does
not construct these URLs; it reads the href from a link on the listing page
(`scraper/src/scrapers/chittorgarh-scraper.ts:72-77`) and stores it as `ipos.verifier_url`. Six
stored URLs were fetched and checked on 2026-09-08 — Prasol, Glass Wall Systems, Pranav
Constructions, Kanohar Electricals, Veegaland, Manipal Payment — and every one served the right
company.

**It matters for the pull model for two reasons that are specific to this design.**

1. **A wrong URL is inherited forever.** `verifier_url` is stored per IPO (213 of 327 populated).
   If one was ever captured against the wrong listing row, every later fetch repeats the error
   silently, and nothing in the system re-checks it.
2. **The pull loop is new code that fetches rank-2 and rank-3 values on demand.** When a stored URL
   is missing — 114 of 327 IPOs have none — the tempting shortcut is to build one from the slug.
   That is exactly the path that returns another company's page with a 200.

**The rule, and it costs one string comparison:**

> Before any value is read from a fetched page, the page must name the IPO we asked about, compared
> through the existing company-name normaliser. If it does not match: read nothing, record
> `IDENTITY_MISMATCH` on the plan row, and clear the stored URL so it is rediscovered from the
> listing page rather than reused.

No extra request, no new dependency. And the standing check that turns a silent inheritance into a
detected one: **for every IPO holding a `verifier_url`, the nightly audit asserts the page names
that IPO** — reported by IPO name, never as a count.

#### 2.3.2 Which fields this touches, and the second identity problem it does not solve

**Two different identity failures, and the rule above only fixes one.**

| How we reach the source | Identity risk | Guarded by |
|---|---|---|
| **Per-IPO page** — Chittorgarh detail, via the stored `verifier_url` | the URL can serve another company's page | §2.3.1 above |
| **One list for all IPOs** — InvestorGain GMP (`data-read/331`), the Chittorgarh listing page | the page is right; the **row binding** can be wrong | **nothing yet — F-46** |

**Exposure of the per-IPO path, by the approved rank of the website:**

| Website's rank | Fields | Which |
|---|---:|---|
| Rank 1 | **1** | `gmp_records.gmp` — but it is list-fetched, so §2.3.1 does not apply to it |
| Rank 2 | **47** | nearly all of `financial_data`, `financial_statements`, `peer_companies`, plus `ipo_valuation.mcap_at_cap` / `pe_at_cap`, `promoters.name`, `ipos.sector` / `company_description` / `objectives` |
| Rank 3 | 37 | the long tail |

**Nothing where a website is rank 1 is fetched by per-IPO URL**, so the honest severity of §2.3.1 is
medium, not high. Today the exposure is smaller still: `financial_data` and `financial_statements`
are 100% document-sourced on production, so rank 2 is rarely reached.

**The pull model is what changes that.** Its whole shape is *"when round 1 fails its check, ask round
2"* — and round 2 for the financials **is** the Chittorgarh detail page. A path that is rare today
becomes the path taken on every failed extraction. If the stored URL is wrong, we write another
company's revenue, profit and net worth onto this IPO, and **every arithmetic check passes**, because
those numbers are internally consistent for the company they actually belong to.

**The second problem, unguarded (F-46).** List sources bind a row to our IPO by normalised company
name (`investorgain-gmp-orchestrator-v2.ts:331-336`). The page-identity rule cannot help: the page
is correct, the binding is not. Measured on production, **24 distinct fields holding 4,825 values**
come from the Chittorgarh listing page this way — `segment` 242, `offeringType` 241, `listingDate`
238, `closeDate` 237, `openDate` 236, `isin` 228, `faceValue` 226, `issueSize` 221, `registrar` 219,
`leadManagers` 219 — and `gmp_records.gmp`, the one field where a website is rank 1, is bound the
same way. This design needs a stated binding rule: what counts as a match, what a near-match does,
and what an ambiguous match does. It does not have one yet.

#### 2.3.3 Binding a list row to an IPO (F-46)

For a list source the page is never wrong — the binding is. The rule:

**Bind on the strongest key the row carries, and never on a partial or similarity match.**

1. `symbol` (exchange ticker) — exact.
2. `isin` — exact.
3. Normalised company name — exact after
   `packages/shared/src/utils/company-name-normalizer.ts`, which lowercases, expands `&`, and
   strips punctuation, a trailing parenthetical, a trailing `IPO`/`FPO`, and the legal suffix
   (`Limited`, `Ltd`, `Private Limited`, `Pvt Ltd`). **This is exact-match on a normalised string,
   not fuzzy matching** — nothing binds on substring, edit distance or "closest".

**Outcomes, all three of which must be recorded:**

| Result | What happens |
|---|---|
| Exactly one IPO matches | bind, and continue |
| **More than one matches** | `AMBIGUOUS` — bind nothing, write no value, record both candidates by name |
| **No IPO matches** | `UNBOUND` — not an error. This is how a newly announced IPO is found, and it is the signal discovery consumes. Record it by name so it is visible rather than dropped |

**And one cross-check the binding gets for free.** A list row carries its own dates. **If the row's
open or close date disagrees with the IPO it just bound to, the binding is suspect** — record it and
write nothing. A wrong binding almost always shows up here first, because two different IPOs rarely
share a bidding window.

**A measurement I read backwards, corrected 2026-09-09.** On 2026-09-08 I ran the normalisation
across all 327 production IPOs, found **zero** pairs collapsing to the same string, and reported that
as reassuring. **That reading was wrong, and it was wrong in the dangerous direction.**

Zero collisions does not mean the matching is safe. It means **the normaliser is too weak to ever
merge two rows — including two rows that describe the same company.**

Proven live, on an IPO that opens today:

```
ASSET RECONSTRUCTION COMPANY (INDIA) LIMITED  ->  "asset reconstruction company (india)"
Asset Reconstruction Co.(India) Ltd.          ->  "asset reconstruction co (india)"
                                                                    ^^^^^^^ vs ^^
```

It strips `Limited`, `Ltd`, `Private Limited` and `Pvt Ltd` — **but not `Company` against `Co.`** So
production carries **two rows for one mainboard IPO**, both UPCOMING, both opening 9 September, both
priced 132–139, and the site shows it twice with different numbers (F-55). This is the **W-108
class** from 2026-09-03 — a second *Rays of Belief* row where *"identity tiers 1–5 all missed"* —
recurring.

**So the binding rule above is necessary but not sufficient.** Exact-match on a normalised name is
only as good as the normalisation, and a normaliser that never collides is a normaliser that never
detects a duplicate either. Two things follow, and both belong to the loop rather than to a repair:

1. **The normaliser must fold corporate-form words** — `Company`/`Co.`, `Corporation`/`Corp.`,
   `Industries`/`Inds.` — not only the legal suffix.
2. **Duplicate detection is a check that runs at discovery**, on a deliberately stricter key than
   the binding key. A sweep with such a key over production finds exactly one duplicate group today:
   this one. Binding and de-duplication want opposite error biases, so they must not share a key.

#### 2.3.3.1 One row per IPO — identity is late-binding, so the rule cannot be enforced at insert

**Owner, 2026-09-09: "Is there a unique ID for each IPO? If yes then there should be only one row
for each IPO for that unique ID."** Agreed on the principle. The data shows why it is not happening,
and the reason is not a missing rule — it is timing.

**Measured on production, 2026-09-09:**

| Status | IPOs | ISIN | Symbol | CIN | BSE no. |
|---|---:|---:|---:|---:|---:|
| UPCOMING | 13 | **0** | 12 | 8 | 9 |
| OPEN | 6 | **0** | 5 | 5 | 4 |
| CLOSED | 60 | 1 | 12 | 0 | 0 |
| LISTED | 251 | 149 | 234 | 18 | 0 |

**No open or upcoming IPO has an ISIN.** The depository assigns it near listing, so the one
permanently unique identifier **arrives after the row has been created and published**. And the
duplicate proves the point: the second Asset Reconstruction row carries **no identifier of any kind**
— no symbol, no ISIN, no CIN, no BSE number. There was nothing to key on.

**So the rule takes the shape of late-binding identity, in four parts:**

1. **Create on the best identity available.** At discovery that is the normalised name — which is
   why §2.3.3's normaliser must fold corporate-form words, not only the legal suffix.
2. **Every time a stronger identifier arrives, check it against every other row.** When the second
   row is assigned its symbol it becomes `ARCIL`, **and `ARCIL` already exists**. That collision is
   the detection, and it is guaranteed to arrive before listing even though it is absent today.
3. **Converging identifiers mean a merge, not an alert.** Two rows sharing one symbol, one CIN or
   one ISIN are the same IPO by definition. The merge is automatic, keeps the union of populated
   fields, and preserves the provenance of both — a warning nobody reads is what produced the
   current state.
4. **Use CIN earlier than we do.** It is on 8 of 13 upcoming IPOs and, unlike a symbol or an ISIN,
   it exists from incorporation — long before any exchange assigns anything, and we already extract
   it from the filing (§E7). It is not sufficient alone, because one company can return with a
   rights issue or an FPO, but **CIN plus open date is a strong pair available early**.

**The gap this closes.** We hold four candidate identifiers and have **no rule for what happens when
two rows converge on one**. That absence, not the identifiers, is what let a mainboard IPO exist
twice on the day it opened.

#### 2.3.4 A correct page still contains other companies' numbers

The two rules above get us to the right page and bind it to the right IPO. **Neither stops the third
mistake: reading a value from the right page that belongs to a different company.**

**Observed 2026-09-08 on Chittorgarh's Prasol Chemicals page.** It shows a `PE Ratio` column — inside
a table headed *"Recently Listed IPOs in Specialty Chemicals"*, listing Sudeep Pharma and others. A
scraper matching that label anywhere on the page would have written **Sudeep Pharma's P/E of 47.61
onto Prasol Chemicals**, and no arithmetic check would object: it is a perfectly plausible P/E.

**The rule:**

> A value is only read from within the page section that is about **this** IPO. Extraction anchors
> on the section — the company's own financial table, its own valuation block — never on a label
> matched across the whole document. A label that appears in more than one section is a defect in
> the extractor, not a value.

This is the same failure as §2.3.1 moved one level in: there, the wrong page; here, the right page's
wrong table. `financial_data.pe_ratio` lost Chittorgarh as a source because of it, and the existing
scraper already applies this discipline in one place — the issue-size prose fallback anchors on the
page's own company name (`chittorgarh-detail-fields.ts:551`). The rule generalises what that comment
already knows.

### 2.3.5 The priority order is configuration, not code (owner requirement, 2026-09-08)

**The requirement.** *"For each field, make these priorities configurable. If we decide to change
them later, it should be easy configuration. We should not be required to change the code."*

Today the order lives in `scraper/src/config/field-priority-matrix.ts` — TypeScript. Changing which
source leads a field means editing code, opening a PR, passing CI and deploying. That is the wrong
cost for a decision that is not a code decision.

#### Two separate things, and only one of them is configurable

The day's verification work makes the distinction sharp, and it is what keeps this safe:

| | What it is | Who decides | Changes how |
|---|---|---|---|
| **Capability** | Can this source serve this field **at all**? | reality — proven by fetching | the verification job updates it |
| **Priority** | Of the sources that *can*, which do we **prefer**? | the owner | **configuration** |

Chittorgarh **cannot** serve `financial_data.pe_ratio` — the only P/E on its page belongs to other
companies (§2.3.4). NSE **cannot** serve any of the 33 financial fields — its API returns bidding
and demand data only. **No configuration may make an incapable source rank 1**, because the result
is not a different value, it is a permanent `NOT_PRINTED` and a silent slide to whatever is below.

So priority is configurable **within** capability, never over it.

#### Where the configuration lives

Three layers, each overriding the one above, reusing patterns this repo already has:

1. **The registry — `config/field-sources.json`, in the repo.** One row per field: its ranks, its
   unit, its check, its exceptions. This is what `field-source-resolution.spec.mjs` already
   generates for Appendix A; it stops being a document artefact and becomes the file the scraper
   reads. Changing it is a data edit reviewed like any other change, then deployed.
2. **The override table — `field_source_overrides`**, shaped on the existing
   `field_protection_metadata` (which is already per-field, per-IPO, with `edited_by`, `edit_note`
   and `is_permanent`). Columns: `table_name`, `field_name`, `ipo_id` (nullable — null means every
   IPO), `rank1/2/3`, `reason`, `set_by`, `set_at`, `expires_at`. **Takes effect at the next cycle
   with no deploy.**
3. **A per-IPO admin override**, which already exists as field protection and is untouched.

Effective order = the first valid layer, resolved once per walk and recorded on the plan row.

#### Four rules that keep this from becoming a foot-gun

A free-form config over the write path is a way to break production quietly at 2am. So:

- **An override is validated before it takes effect.** Every named source must be capable of that
  field, and the order must satisfy S-05 (`per-ipo-due-step-pipeline.md`). An invalid override is
  refused and logged — never partially applied.
- **An override expires.** `expires_at` defaults to 30 days. A change meant to be permanent goes
  into the registry, where it is reviewed. This stops the override table quietly becoming the real
  configuration that nobody reads.
- **Provenance records which configuration produced the value** — registry version or override id.
  Without it, "why does this field say that?" is unanswerable after any config change.
- **A nightly check reports every active override by field and reason**, and fails on one that is
  expired, invalid, or older than its stated intent. An override nobody remembers is the same class
  as a stale ranking in code, only harder to find.

#### What configuration cannot do, stated plainly

- **Reordering sources that already work: pure configuration.** No deploy.
- **Adding a new source** (another website, another exchange feed): needs a scraper for it, and a
  capability entry proven by fetching. **That is code.**
- **Adding a new field:** needs a column, an extractor and a check. **That is code.**

So the honest promise is: *changing the order is configuration; changing what we can reach is not.*

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

#### 2.5.1 Every trigger that re-asks a field, in one place

The triggers below were scattered across five sections of an earlier draft. An implementer would
have had to assemble them to know when the loop actually runs, which is how a mechanism gets
half-built. They are listed here once, and §2.5's evidence rule is trigger 3 rather than the whole
story.

| # | Trigger | Concrete case | Can it hit a field that already holds a value? |
|---|---|---|---|
| 1 | State is `PENDING` — never supplied | an SME prospectus not yet filed: the price band is asked four times a day and comes back empty | No — nothing to protect |
| 2 | `NOT_AVAILABLE_YET` reclaim | `isin` does not exist before listing; the field stays due and is taken the moment the exchange assigns it | Only a provisional lower-rank value, which is replaced, not blanked |
| 3 | **A better document arrived** (§2.5) | July's draft said the fresh issue was ₹400 cr; September's prospectus prints ₹320 cr after a pre-IPO placement. Every field from the draft returns to `PENDING` | **Yes** |
| 4 | **Scheduled verification** (§3.1) | every supplied field on a live IPO is re-checked against rank 2 weekly; `leadManagers` (578 unresolved conflicts) and `faceValue` (495) every slot | **Yes — the common one** |
| 5 | **A disagreement was found** (§3.2) | Chittorgarh disagrees with the document, so that one value is re-read from that page of that PDF | **Yes** |
| 6 | **The plan was invalidated** (§2.8) | Mopshop stored as `FPO`, corrected to `IPO`: its ranks were resolved for the wrong type, so the plan is rebuilt | **Yes** |
| 7 | **A visible bidding date moved** (S-05) | NSE moves the close date from 2 to 4 September; allotment, refund and credit dates move with it, and the advertisement is never reprinted | **Yes** |

**This is why §2.6 matters.** Triggers 3–7 all reach a field that already holds a good value. Under
the deleted "blank it" rule, a live IPO's price band would disappear because Chittorgarh happened to
be down during a Tuesday-afternoon verification pass. The field keeps its value; only the plan row
records that we could not reconfirm it, and the page marks it *last confirmed on <date>* once that
gap passes the staleness threshold (owner decision, 2026-09-08).

#### 2.5.2 A re-ask must not rewrite an unchanged value

Triggers 3-7 re-ask fields that already hold good values, and trigger 4 does it on a schedule. At
phase-1 size that is **19 IPOs x ~150 sourced fields = roughly 2,850 checks a week**. If each one
wrote, we would produce about **148,000 writes a year of pure churn**, each dragging a provenance
row and a cache invalidation with it.

**The rule (owner decision, 2026-09-08): verification is a read. It writes only when something changed.**

| Outcome of a re-ask | What is written |
|---|---|
| Same value, check passes | **nothing** — only `verify_state` and the timestamp on the plan row |
| Different value from a better document (trigger 3) | the new value, a provenance row, a cache drop |
| Different value from a verification source | no data write — this opens the re-read loop (§3.2) |
| Re-read produces a correction | the corrected value, provenance, cache drop |

**This also protects a signal we would otherwise destroy.** `ipos.updated_at` and
`field_sources.updated_at` must keep meaning *the value changed*, not *we looked at it*. The moment
verification writes on every pass, every freshness check downstream reads noise.

**What already exists, and does not need rebuilding.** Two layers landed in September and the pull
loop uses them rather than inventing a third:

- **A normalised comparison** — `areEquivalent` + `normalizeChosen`
  (`scraper/src/services/data-consolidation-service.ts:919-932`). It exists because Postgres returns
  a numeric as the string `"6800000000.00"` while the scraper holds the number `6800000000`, so
  every re-scrape of an unchanged number used to count as a write. The same comparison now decides
  both the row update and the provenance row, so the two cannot disagree.
- **A row-level gate** — the update is built as a diff and skipped when the diff is empty
  (`scraper/src/services/data-persister.ts:2258`). An earlier version keyed on a counter that never
  counted `listingExchanges`, `registrarId` or `offeringType`, so a resolved registrar could be
  dropped forever.

**One open gap this design inherits, and it stops being cosmetic here.** Walk item **W-106**
(2026-09-03) records that `valueActuallyChanged` is dead on every tested path — a higher-priority
source arriving with an equivalent value is treated as convergence before the check is consulted. It
was filed as *"not a behaviour defect; a misleading counter"* and left open.

Under the pull model that counter is the only thing separating *"verification confirmed 2,850 fields
and nothing changed"* from *"verification rewrote 2,850 fields identically."* **A dead counter makes
the no-op suppression unverifiable**, so W-106 becomes a prerequisite rather than a follow-up, and
check `PULL-NOOP` below is what proves it: writes per cycle divided by fields re-asked per cycle,
which on a quiet day must be near zero.

#### 2.5.3 Computed fields need their formulas audited — no source ranking can catch a wrong one

**Found by the owner, 2026-09-08.** `anchor_investors.lock_in_50_percent_date` and
`lock_in_remaining_date` are computed, not sourced. The live code computes both from the **anchor bid
date** (`scraper/src/scrapers/anchor-investors-scraper.ts:302`):

```
lockIn50PercentDate = bidDate + 30 days
lockInRemainingDate = bidDate + 90 days
```

**The regulation says the clock starts at allotment.** SEBI ICDR 2018, Schedule XIII Part A: 50% of
an anchor's allotment is locked for 30 days **from the date of allotment**, the remaining 50% for 90
days from allotment — the split rule for issues opening on or after 1 April 2022. Verified against
the regulation on 2026-09-08 rather than taken from memory.

**Measured impact.** ESDS Software: bid 27 Aug, allotment 2 Sep. We publish a 50% lock-in expiry of
**26 Sep**; the correct date is **2 Oct** — **six days early**, on a date traders watch because it is
when anchor shares become sellable and supply reaches the stock. Three more rows carry the same wrong
base and cannot yet be checked because their allotment date is not in yet.

**The general lesson, and it is a gap in this design.** **No source ranking could ever have caught
this.** A wrong formula takes correct inputs and produces a plausible output; every priority rule,
every conflict check and every arithmetic bound in §1 is blind to it, because nothing disagrees.
Sourcing discipline protects every sourced field and does nothing for the **13 computed ones**.

**So computed fields get their own audit, on the same standard as sources:**

| # | Field | Formula | Audited against |
|---|---|---|---|
| 1–2 | `lock_in_50_percent_date`, `lock_in_remaining_date` | `allotment_date` + 30 / + 90 | **SEBI ICDR Sch. XIII Part A — verified** |
| 3–4 | `face_value_multiple_floor/cap` | price ÷ face value | the multiple printed on the advertisement (§A4) |
| 5 | `gmp_percentage` | gmp ÷ price cap × 100 | recomputed, never taken from the source |
| 6 | `issue_price` | `ipos.price_range_max` at listing | the prospectus |
| 7–8 | `listing_gain_percent`, `current_gain_percent` | (price − issue) ÷ issue × 100 | arithmetic on stored inputs |
| 9 | `slug` | `generateIPOSlug(company_name)` | uniqueness + the redirect table |
| 10 | `registrar_id` | FK from `registrar` | the registrars table |
| 11–13 | `listing_performance.symbol` / `company_name` / `listing_date` | copies of `ipos.*` | must equal the source row — a divergence is a defect, not a disagreement |

**Every formula carries the authority it derives from** — a regulation, a printed value, or a stored
input — and a test asserts it. A formula with no cited authority is the same defect as a source rank
with no evidence, which is what this design spent 2026-09-08 removing.

#### 2.5.4 Issue-size components are provisional until the prospectus, and the check runs inside one document

`ipo_details.pre_ipo_placement` is a boolean. A red herring prospectus says *"Fresh Issue of up to
₹400 crore, subject to reduction by a Pre-IPO Placement of up to ₹80 crore"*; if the placement
happens, the final prospectus prints ₹320 crore. A yes/no records **that** it happened, never **by
how much** — and the issue size feeds market cap, shares at cap and the P/E, which cross-check
against each other and therefore **agree while all being wrong**.

**Measured 2026-09-08: the flag is `false` on 5 IPOs and `null` on 20. It has never once been
`true`** across 25 extractions, which is itself worth checking — a boolean that is never true may be
a detector that never fires rather than a fact that never occurs.

**Two rules, which cost nothing and are needed before the loop runs:**

1. **Issue-size fields are provisional until sourced from a `PROSPECTUS`.** An RHP figure is an
   upper bound (*"up to"*), not a final number.
2. **`fresh + OFS = total` is evaluated within ONE document, never across two.** Comparing a draft's
   fresh issue against a final total fails a correct extraction — and under the deleted blanking
   rule that failure would have destroyed the data.

**This check already fails on production, and diagnosing it (2026-09-09) found two extractor bugs
and cleared the websites of blame.**

Running the check as specified over the rows carrying both components: **six of nine fail.** The
provenance column explains it in one look — **every passing row took its total from the document;
every failing row took its total from a website while its components came from the document.** Two
sources describing the same offer, under no obligation to agree.

**But the websites are right, and our extraction is wrong.** NSE states each offer in words, which
settles it independently:

| IPO | NSE's own wording | Our stored fresh | Reconciliation |
|---|---|---:|---|
| **Kanohar** | fresh Rs 3,000 mn + OFS 11,957,915 shares | **₹60 cr** — wrong, NSE says ₹300 cr | 300 + (11,957,915 × ₹632) = **₹1,055.74 cr = the stored total, exactly** |
| **Glass Wall** | fresh Rs 600 mn + OFS 20,213,722 shares | **₹260 cr** — wrong, NSE says ₹60 cr | 60 + (20,213,722 × ₹182) = **₹427.89 cr = exact** |
| **Pranav** | fresh Rs 3,156 mn + OFS 2,856,869 shares | ₹315.60 cr — correct | implied OFS ₹35.43 cr ÷ 2,856,869 = **₹124/share = its stored cap, exactly** |
| **Prasol** | fresh Rs 800 mn + OFS Rs 4,200 mn | ₹80 cr — correct | 80 + 420 = **₹500 cr = exact** |
| **Karamtara** | fresh Rs 6,750 mn + OFS Rs 2,000 mn | ₹675 cr — correct | 675 + 200 = **₹875 cr = exact** |

**Two distinct defects, and the second is the common one:**

1. **`ofs_issue` is never extracted — all six.** The offer for sale is stated two ways: in rupees
   (*"OFS aggregating up to Rs. 4,200 million"*) and in shares (*"OFS of up to 20,213,722 equity
   shares"*). Neither form is being captured. The share form additionally needs multiplying by the
   cap price, which is where §1's unit discipline applies.
2. **`fresh_issue` is mis-extracted on two of six** — Kanohar reads ₹60 cr against NSE's ₹300 cr,
   Glass Wall ₹260 cr against ₹60 cr. Both are wrong in the *digits*, not the units, so a
   magnitude bound would not catch them. **Only the reconciliation check does.**

**What this says about the design.** The check specified here would have caught all six on day one;
it is not built. And §2.6's rule earns itself again: under the deleted blanking rule, six live IPOs
would have had their issue size destroyed by a check that was correctly failing on a *component*
that was never extracted.

**Asset Reconstruction is still unexplained** — `ofs_issue` ₹732.97 cr against a total of ₹696.06 cr,
a component larger than the whole, with no fresh issue recorded and no NSE symbol to check against.
It needs its own look.

Under §2.6 the pull loop handles these correctly: the check fails, the existing value stays, and an
`EXHAUSTED` row makes the gap visible instead of blanking the field. The data above shows the check
earning its place before a line of it is built.

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

**Owner decision, 2026-09-08:** confirmed, **with a staleness marker on the page**. A value we could
not reconfirm keeps serving, but once the gap passes the threshold the page shows *last confirmed on
<date>* rather than presenting it as current. That gives the honesty of blanking without the
destruction — nothing vanishes, and nothing pretends to be fresher than it is.

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

**Phase-1 precondition: three IPOs have no segment, and our own data already answers it.**

`CENTURY BUSINESS MEDIA`, `OM GALAXY` and `RAKSAN TRANSFORMERS` are UPCOMING with
`segment = NULL`. No rank set resolves for them, because SME and mainboard carry different
lot-value checks — so the walk cannot run on them as they stand.

They do not need a source. **The minimum application value separates the two segments cleanly**,
because SEBI sets it: a mainboard lot is about ₹15,000, an SME lot is about ₹1,00,000–1,50,000.
Measured across the 262 IPO rows that carry both a lot size and a price cap:

| Segment | IPOs | Median lot × cap | Range |
|---|---:|---:|---|
| MAINBOARD | 94 | **₹14,880** | 100 – 360,000 |
| SME | 168 | **₹127,600** | 10,000 – 150,000 |
| **The three unknowns** | 3 | **₹118,400** | 109,200 – 144,000 |

All three sit inside the SME band and roughly **eight times** the mainboard median, and all three
are BSE-only, which no mainboard IPO of that lot value would be. They are SME.

**The rule:** when `segment` is absent, infer it as SME if `lot_size × price_range_max ≥ ₹50,000`
and the IPO lists on a single exchange; otherwise MAINBOARD. Record the inference in provenance as
a derived value, never as a scraped one, and let a later document or exchange value overwrite it
under S-05. Flag any IPO where the inference and a sourced `segment` disagree — that combination
means one of the two is wrong and it is exactly the Qualiance false-alarm shape.

**The data repair itself is a production write and is the owner's call** (finding F-40); the design
only states the rule.

### 2.9 Statuses outside the three the first draft named

The first draft's tiers covered UPCOMING, OPEN, CLOSED and LISTED. The enum has six
(`packages/shared/src/db/schema.ts`, `ipoStatusEnum`). A phase-1 IPO can become either of the other
two at any time:

**Owner decision, 2026-09-08.**

- **POSTPONED — not terminal, it comes back.** Stays in scope at the normal four-slot cadence. A
  relaunched issue almost always carries a revised price band and a new window, so **its
  document-sourced fields are invalidated the moment the relaunch filing arrives** (§2.5 trigger 3)
  — the old terms must not survive the relaunch.
- **WITHDRAWN — terminal.** The walk stops. **Existing values are kept as a record**, because
  someone who applied wants to see what they applied to. The page **stays at its URL** with a clear
  withdrawal notice rather than redirecting — people who applied will search for it. **GMP and
  subscription polling stop**, because a withdrawn issue with a ticking grey-market premium reads as
  live and is actively misleading. And the IPO **leaves the §4 denominators**, so a dead issue does
  not drag the coverage numbers of the live ones.

Neither status appears on production today, but `document-cycle.ts` reserves a slot every cycle for
the withdrawal purge path, so both occur.

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
| `PULL-NOOP` | writes per cycle ÷ fields re-asked per cycle | near zero on a day with no filings | rises without a matching document arrival — verification is rewriting unchanged values |
| `PULL-NOBLANK` | fields that went from a value to absent this slot | **0** | any non-zero — this is the guard on §2.6 |
| `PULL-WRITE` | plan rows marked `SUPPLIED` whose write returned `skipped` | **0** | any non-zero |
| `PULL-FROZEN` | `SUPPLIED` rows whose `chosen_document_id` has been superseded | **0** | any non-zero — the guard on §2.5 |
| `PULL-ADMIN` | fields skipped for admin reasons with no live protection row | **0** | any non-zero — the guard on §2.7 |
| `PULL-TYPE` | plan rows whose resolved ranks do not match the IPO's current type; IPOs with a null segment | 0 / 0 | any non-zero |
| `E1-SOURCE` | for the ten E-1 fields, `field_sources.source` is never `DRHP` | true | any E-1 field written by the document path — **asserts the outcome, not the declared intent** |
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

**Phase-1 note:** the backlog tier and its nightly window are **the closed-IPO work** (F-35 — no backlog drain in
phase 1; the 2-vCPU box already took a 522 outage from two concurrent extractors). Phase 1 only ever
extracts a document belonging to one of the 19 open/upcoming IPOs, on demand, inside the normal wake
budget. Everything below describes the target state this design is building toward; it does not run
in phase 1.

**Re-measured this session: 176 unextracted, not 172.** The three causes hold:

| Cause | Documents | The design's answer |
|---|---:|---|
| No extractor exists for the type | 78 | Build **one**: the **ratios / basis-for-offer-price** document (32 pending — it carries the KPIs, the WACA and the peer set, all rank-1 document fields in §1). **Deliberately left unread, and recorded as such:** the basis-of-allotment advertisement (1 — see below), sample application forms (14), bidding centres (8), security parameters (23). All report `NOT_APPLICABLE` in the manifest rather than sitting in a backlog forever. |
| Budget of 3 filings per cycle | 91 | Demand-ordered allocation (§2.7) plus the **backlog tier's own nightly window** (§2.3, **the closed-IPO work**). The live tier keeps absolute priority, so a live IPO can never queue behind history. This converts 91 already-downloaded documents into data with no new parsing code — the single biggest win here. |
| 10-minute extraction cap | the Skyways class | A separate, longer budget for large or scanned documents, run in the backlog window only (**the closed-IPO work**), where a 40-minute extraction costs nothing. The live path keeps its 10-minute cap so it cannot blow the wake budget. |

O-4 is already marked APPROVED by the owner, so this section is the *how*, not a request.

**F-27 — the basis-of-allotment advertisement is stored and deliberately not read (owner decision,
2026-09-08).** An earlier draft scheduled an extractor for it. **Nothing exists to hold what that
extractor would produce** — there is no field anywhere for the allotment ratio, applications
received, valid applications, shares allotted per category, or oversubscription per category. Every
column we have with "allot" in its name is about something else: the allotment *date*, the
registrar's allotment-check *URL*, and `retail_max_allottees`.

Building a parser whose output is discarded is waste, and the ordering was my error — the extractor
was scheduled without checking there was a target.

**Why not build the fields either.** We hold **exactly one such document**, and it is published only
*after* an issue closes, so most of the 19 open and upcoming IPOs have not filed one. More
importantly, the question users actually ask — *"did I get shares?"* — **is already answered**: we
link to the registrar's allotment-check page, and 14 of 19 registrars have one with 18 healthy.

The gap is the *other* question — *"what were the odds?"*, the ratio people quote after an
oversubscribed issue. **That is a product decision about what IPODhan publishes, not a sourcing
decision**, and it does not belong in this design.

**So: the document keeps being discovered and stored, and is marked `NOT_APPLICABLE` for
extraction with this reason attached.** If the allotment ratio later becomes a feature, the
documents will have been accumulating rather than being thrown away — and the correct order then is
fields first, extractor second.

### 5.5 O-5 — the document outranks websites: what is inherited and what remains

Merged this morning as 9db4529d. The design inherits all of it: `DRHP` directly after `ADMIN` on
every field the extraction contract says a filing carries; a newer document heals an older one;
document types ranked so an old draft cannot overwrite a final advertisement; timeline dates
deliberately keeping the exchanges first (W-117).

**What remains after it, and why the ranking alone was never going to be enough:**

1. **130 of 194 published fields still have no ranking at all** (§0.6, measured against the live
   `field-priority-matrix.ts`, a different artifact from this design's Appendix A). Appendix A now
   ranks all 240 — but **it resolves only 3 of the 11 offering types phase 1 actually needs
   (MAINBOARD, SME-BSE, SME-NSE)**; the other 8 (F-11) are DROPPED-BY-SCOPE and **reopen for the closed-IPO work**.
2. **The staging-cycle proof for 9db4529d is still owed.** It is listed at 90%, not 100%, for that
   reason.
3. **Nothing re-sources the existing rows.** The flip changes who wins the *next* write. 91% of
   today's data was written before it. That is §6 — **entirely the closed-IPO work** under the owner's
   2026-09-08 scope cut; phase 1 touches no closed IPO's already-written rows.
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

So: of the document-sourced (class D) fields, **two** are genuine model candidates — the
business description, and the unit line as a proposal-with-check. Everything else is deterministic.
That is the honest answer to "last stretch only": the last stretch is small, and we should not reach
for it until the deterministic 119 are actually being read.

---

## 6. Re-sourcing closed IPOs — not scheduled, and each precondition has a named trigger

**There is no "phase 2" (owner, 2026-09-08).** An earlier draft parked ten findings in one, which is
how work disappears: a bucket with no date, no trigger and no owner. Every one of them now names the
**event** that brings it into scope, and none of them names a phase.

**The owner's sequence for closed IPOs, in his words:** *"We will not touch any closed IPO as of now.
Once those are done, then we will plan to check and update data for closed IPO gradually one by one
in sequence of IPO closing date — latest closed IPO first and older IPO closed later, but one by
one."*

One at a time, newest close date first. Not a batch, not a migration, not a phase.

**His ordering has a property worth naming**, because it was not the reason he chose it. Measured
against the purge rule:

| Closed | IPOs | Their PDFs |
|---|---:|---|
| ≤ 7 days ago | 13 | **still on disk** |
| 8–30 days | 35 | **inside the hard retention cap** |
| 31–180 days | 107 | purged — must be re-downloaded |
| > 180 days | 100 | purged, oldest |

**Newest-first means the first 48 are the ones whose files we still hold.** The re-download gamble —
the largest unknown in the whole plan — is deferred until after 48 IPOs have already proven the
machinery works.

### 6.1 What must be true before the FIRST closed IPO is touched

These are not future work. They are **preconditions**, and each is a finding with a trigger rather
than a line in a plan:

| Finding | What must exist first | Why, concretely |
|---|---|---|
| **F-09** | a `retain_until` pin the purge honours | `decidePurge` deletes any PDF past 30 days unconditionally (`document-store.ts:279`). Without the pin, we re-download a 2025 RHP, extract one field group, and the next cycle deletes it — a treadmill |
| **F-10** | effective-dated checks | `face_value ∈ {1,2,5,10}` is wrong for an NCD at ₹1,000; `listing ≤ close + 3 working days` is wrong for anything that listed before Dec 2023. Applied to history as-is, these fail correct data |
| **F-30** | each gate as a script with an exit code | four of the six are prose today. Prose cannot stop a bad run |
| **F-31** | a `field_sources` snapshot | it holds **one** prior value, so a second overwrite loses the original. 6,600 rows — cheap before, impossible after |
| **F-35** | a decided slot for the extractor | the box took a Cloudflare 522 outage from two concurrent extractors (`scripts/deploy-linux.sh:231-235`). A third workload needs its slot agreed, not discovered |

### 6.2 The document-type precondition, unchanged

A re-extraction must resolve a **real document type**, or the type ranking degrades to
newest-write-wins and an old draft overwrites a final price band advertisement. **`documents.filing_date`
is populated on 24 of 256 rows**, and the healing rule depends on it. Backfilling it is a
prerequisite of the first closed IPO, not part of the work.


## 7. Cost, sequence, and what I am not sure about

### 7.1 Sequence

| # | Piece | Depends on | Tier | Rough size |
|---|---|---|---|---|
| 1 | **The child-table consolidated writer** — extend the consolidation contract to `ipo_details`, `financial_statements`, `ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`, `peer_companies`: per-field priority resolution, `field_sources` rows, `data_conflicts` rows | — | **A** | **large — and it is the gate on everything below** |
| 2 | Field manifest: which document type prints which field | — | B | small — the spec turned into data |
| 3 | Matrix cleanup: delete the 13 dead snake_case keys, adopt the manifest | 2 | B | medium, mechanical |
| 4 | Per-field validation before write (the cheap half of O-3) | — | B | small, ships on its own |
| 5 | `ipo_field_plan` table + generator | 1, 2, 3 | **A** | medium |
| 6 | The pull walk over the plan | 5 | **A** | large — the core |
| 7 | Tiering and demand-ordered budgets (O-4) | 6 | **A** | medium |
| 8 | The ratios / basis-for-offer-price extractor (32 pending documents) | — | B | medium, independent |
| 9 | The re-read loop | 6 | **A** | medium |
| 10 | The verification checks in §4 | 6, 9 | B | medium — nothing above is proven without it |
| 11 | Unit conversion (O-2) + `financial_data` becomes derived | 10 | **A** | large, own release |

**Item 1 is first, by owner decision (2026-09-08), and nothing from item 5 onward is contracted
until it lands.**

`consolidatedUpsertIPO` consolidates **`tableName: 'ipos'` only**
(`data-consolidation-orchestrator.ts:187`) — **32 of the 240 fields.** The eight child tables are
written by `persistFilingExtraction` through their own repositories, with no priority resolution, no
provenance and no conflict rows. That is precisely *why* §0.1 measures them as 100%
document-sourced: nothing else can write them.

So **208 of 240 fields have no consolidated writer at all**, and the pull loop would have nowhere to
put 87% of what it extracts. An earlier draft buried this under a bullet claiming the write path was
unchanged. An implementer trusting that would have built the walk, run it, and found that the walk
works and the writes go nowhere. **It is the largest single piece of work here and it was described
as no work at all.**

**Deliberately not done first: the walk.** Building it early would "work" — on 32 fields — and give a
confident reading on the easiest third of the problem while the hard part is untouched.

Items 4 and 8 are genuinely independent and can start immediately, in parallel with item 1, without
prejudging anything.
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
   would not promise the number before M1 reports. **This was the single biggest unknown in the whole
   document, and the 2026-09-08 phase-1 scope cut defers it entirely** — M1 is inside §6, which is now
   the closed-IPO work (no closed IPO, no re-download of purged documents, in phase 1). Phase 1 only ever reads a
   document that is still on disk for one of today's 19 open/upcoming IPOs, so this unknown does not
   block phase-1 work — it blocks the closed-IPO work, and stays unanswered until the closed-IPO work starts.
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
   the **full timetable family**, not only the five he first named. E-1 was established at
   **twelve fields** by testing every date- and schedule-like field among the 194 against one
   question — does this value change when the bidding window changes? — then reduced to **ten**
   closing F-22 (2026-09-08): the two anchor lock-in dates are **derived** (`allotment_date + 30d /
   + 90d`), not independently sourced, so they were never really E-1 members and are now class C
   (§1.2.1).

   The three I had missed at the time were all in `anchor_investors` — the anchor bidding date and
   the two lock-in expiry dates, which move with the allotment date. Two of those three (the lock-ins)
   are the ones since reclassed out of E-1 by F-22.

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

## Appendix A — the complete per-field source resolution (all 240 fields, all IPO types)

**This appendix is the implementable form of §1 and, where they differ, it wins.** §1 explains the
reasoning per group; some of its rows resolve a whole table in one sentence ("all of `financial_data`
is rank 1 DOC, rank 2 Chittorgarh, rank 3 Moneycontrol"), which is readable but not something code
can be built from. Every one of the 240 fields below carries its own three sources, its own per-type
variation, and — where there is no rank 2 or 3 — the reason there is none, so a blank is never
mistaken for an omission.

Generated from a single specification: **240 fields — 194 populated on production today, plus 46
published columns the offer document prints that hold no data at all today** (`neverPopulated: true`
in the spec), added closing F-13. Scoping this appendix to only-what's-populated was backwards: a
field is empty precisely because no document was ever read for it. Every populated production field
is still in the spec, zero difference. The 46 never-populated fields cannot be checked against
production the same way — there is nothing on production to check against — so their source ranks are
asserted from the extraction contract (`docs/reviews/wp-c-extraction-contract.md` §1) and stay
unverified until the first document actually populates one. This must be re-run whenever a field is
added.

### A.0 The verification this appendix passed

Reviewed three times on 2026-09-08 at the owner's insistence. Each pass found real defects that
reading the document would not have shown. The current state:

| Check | Result |
|---|---|
| Every populated production field is in the spec, zero difference | **194 = 194** |
| Published columns the document prints with zero rows today (F-13), added to the spec | **46**, each flagged `neverPopulated: true` |
| Sourced fields with fewer than three sources that give **no reason** | **0** |
| Fields where SME silently loses a source mainboard has | **0** |
| Exchange-specific values fetchable for a venue the stock is not listed on | **0** |

**Mainboard source depth, stated plainly rather than claimed complete:**

| | Fields |
|---|---:|
| Three sources | **97** |
| Two sources, reason stated (§A.3) | 22 |
| One source, reason stated (§A.3) | 71 |
| No source — computed (class C) or written by our own pipeline (class I) | 50 |
| **Total** | **240** |

**Not every sourced field has three, and they never will.** 93 of them have fewer (22 two-source, 71
one-source) because a second publisher does not exist, or publishes a *different* number that would
be wrong to substitute — every one carries its reason inline in this appendix's Note column, and the
original 40 (the fields present before this session) are narrated by name in **§A.3**. Claiming three
sources for the anchor investor list or for share counts at the floor price would mean inventing one.

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

4. **The pool() resolver silently overrode a field's own `only:` declaration.** Found and fixed
   2026-09-08 while closing F-13. Any field in a WEB_OK table (`ipos`, `ipo_details`,
   `financial_data`, `peer_companies`, `subscriptions`, `listing_performance`, `registrars`,
   `ipo_intermediaries`, `gmp_records`) that carried an explicit `only:` reason for having no rank 2
   still got Chittorgarh/Moneycontrol auto-appended, so the generated row contradicted its own Note
   column — `ipo_details.compliance_officer` read `DOC · CG · MC` next to the note "no rank 2: named
   only in the filing". Ten already-committed fields were wrong this way (`ipos.cin`,
   `compliance_officer`/`_phone`/`_email`, `promoter_shares_held`, `sebi_regulation_cited`,
   `promoter_group_transactions_since_drhp`, `gmp_records.gmp`,
   `listing_performance.current_price_bse`/`_nse`); the 46 F-13 additions would have tripled it.
   `pool()` now returns early when `f.o.only` is set — mainboard three-source count corrected
   **112 → 97** for that reason alone (before the 46 new fields' own contribution).

**Fourth verification round, 2026-09-08/09 — the exchanges and Moneycontrol, against live payloads.**
Chittorgarh had been checked page-by-page; NSE, BSE and Moneycontrol had only been checked by API
shape and code reading. Doing it properly corrected **fifty-one ranks**:

| Source | Claimed | Verified | Correction |
|---|---:|---:|---|
| **Moneycontrol** | 46 fields | **9 + subscription** | Reading all three MC scrapers: they map `closeDate, companyName, issueSize, listingDate, offeringType, openDate, priceRange, segment, status`. **No financials, no peers, no promoters, no valuation, no sector, no description.** All 46 claims were false |
| **NSE** | 53 fields | mostly right, **3 wrong, 6 missing** | `/api/ipo-detail` `issueInfo` genuinely carries registrar, lead managers, issue type, sponsor bank, tick size and market timings — which I had as filing-only or BSE-ranked. It does **not** carry `designated_exchange`, `retail_max_allottees` or the allocation percentages |
| **BSE** | 54 fields | mostly right, **1 wrong** | `GetMkt_ISSUE_BBS_IPO` carries registrar, lead managers, sponsor bank, tick size, market timings — but **not** `issue_type`, which I had ranked to BSE |

**The Moneycontrol result has a consequence worth stating.** After correction, **Moneycontrol earns
zero ranks** — not because it is excluded, but because for all nine fields it serves, the document
and both exchanges are better and already available. It never reaches the top three. It contributes
206 provenance rows today only because the **push** model let it win by arriving first. **Under the
pull model the Moneycontrol scraper would never be consulted.** Whether to keep running it is the
owner's call, not this design's.

**The cause was structural, and it is fixed at the source.** The generator's `pool()` appended
Chittorgarh and Moneycontrol to any field in a "web-covered" table without asking whether either
source serves it. That is the design's own capability-versus-priority rule (§2.3.5) being broken by
the tool that generates the table. `pool()` now filters on an **observed capability list** — on the
way in as well as the way out, because a hand-authored rank naming an incapable source is the same
defect as an auto-appended one.

**One trap this round exposed and did not fix.** BSE's detail payload names its size field
`Issue_Size_No_of_shares` — **a share count, not rupees.** `ipos.issue_size` ranks BSE second. Using
that value directly is precisely the *"share count stored as issue size"* class this repo's own
`recurrence-detection-gate.md` was written for. The rank stays, because BSE does serve the concept;
**the extractor must convert, and the §1 arithmetic check is what catches it if it does not.**

**Class counts (authoritative, superseding the estimate in §1.1): D 162 · T 10 · X 13 · M 4 · W 1 ·
C 13 · I 37 = 240.** Of these, **71 fields have no rank 2 at all** (the one-source row above) — the
reason is stated on each row and is almost always "no website or exchange publishes this" (CIN, the
promoter tables, risk factors, the anchor book, the valuation table, and now the 46 F-13 fields).
That is a finished answer, not a gap.

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

### A.1 The 240 fields

| # | Field | Cls | R1 | R2 | R3 | SME-BSE | SME-NSE | Doc § | Note / why no lower rank |
|---:|---|---|---|---|---|---|---|---|---|
| 1 | `ipos.symbol` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 cover |  |
| 2 | `ipos.company_name` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | cover |  |
| 3 | `ipos.issue_size` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A5+A6 |  |
| 4 | `ipos.lot_size` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A3 |  |
| 5 | `ipos.open_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 6 | `ipos.close_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 7 | `ipos.listing_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 8 | `ipos.status` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 9 | `ipos.registrar` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E3 | VERIFIED: NSE issueInfo returns "Name of the Registrar"; BSE detail returns Registrar with address |
| 10 | `ipos.registrar_id` | C | — | — | — | — · — · — | — · — · — | — | computed: FK resolved from registrar |
| 11 | `ipos.rating_override` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 12 | `ipos.slug` | C | — | — | — | — · — · — | — · — · — | — | computed: generateIPOSlug(company_name) |
| 13 | `ipos.sector` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 14 | `ipos.price_range_min` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 15 | `ipos.price_range_max` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 |  |
| 16 | `ipos.last_scraped_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 17 | `ipos.listing_exchanges` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 18 | `ipos.face_value` | D | DOC | BSE | NSE | DOC · BSE · CG | DOC · NSE · CG | A2 |  |
| 19 | `ipos.allotment_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 20 | `ipos.company_description` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 21 | `ipos.lead_managers` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E1 | VERIFIED: NSE returns "Book Running Lead Managers"; BSE returns Book_Running_Lead_Manager |
| 22 | `ipos.isin` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 |  |
| 23 | `ipos.segment` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 24 | `ipos.offering_type` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A11 |  |
| 25 | `ipos.scraper_locked` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 26 | `ipos.last_manual_edit_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 27 | `ipos.objectives` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F4 |  |
| 28 | `ipos.bse_ipo_no` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload identifier |
| 29 | `ipos.bse_payload_lead_manager_count` | I | BSE | — | — | BSE · — · — | BSE · — · — | — | no rank 2: BSE payload cross-check only |
| 30 | `ipos.company_website` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | E7 |  |
| 31 | `ipos.verifier_url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 32 | `ipos.cin` | D | DOC | — | — | DOC · — · — | DOC · — · — | E7 | no rank 2: no website or exchange publishes the CIN |
| 33 | `ipo_details.company_description` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | F1 |  |
| 34 | `ipo_details.issue_type` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | A11 | CORRECTED: NSE returns "Issue Type: Book Building". BSE detail does NOT carry it - an earlier draft ranked BSE here |
| 35 | `ipo_details.fresh_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A5 |  |
| 36 | `ipo_details.ofs_issue` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A6 |  |
| 37 | `ipo_details.face_value` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A2 |  |
| 38 | `ipo_details.basis_of_allotment_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 39 | `ipo_details.initiation_of_refunds_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 40 | `ipo_details.credit_of_shares_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 41 | `ipo_details.exchanges` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A15 |  |
| 42 | `ipo_details.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 43 | `ipo_details.last_verified_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 44 | `ipo_details.compliance_officer` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 45 | `ipo_details.compliance_officer_phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 46 | `ipo_details.compliance_officer_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 47 | `ipo_details.upi_cutoff_time` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | B7 | clock time, not a date — deliberately NOT in E-1 |
| 48 | `ipo_details.designated_exchange` | D | DOC | — | — | DOC · — · — | DOC · — · — | A14 | no rank 2: observed absent from both exchange payloads 2026-09-09 - neither NSE issueInfo nor BSE detail names a designated exchange |
| 49 | `ipo_details.lot_multiple` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | A3 |  |
| 50 | `ipo_details.allocation_pct` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: observed absent 2026-09-09 - an earlier draft matched "Anchor Allocation Report" and mistook a document link for the allocation percentages |
| 51 | `ipo_details.pre_ipo_placement` | D | DOC | — | — | DOC · — · — | DOC · — · — | D6 | no rank 2: disclosure exists only in the filing; stored as a boolean today, but a pre-IPO placement reduces the fresh issue and should carry an amount — issue-size fields are provisional until sourced from a PROSPECTUS |
| 52 | `ipo_details.bid_windows` | D | DOC | NSE | CG | DOC · CG · — | DOC · NSE · CG | B8 | clock windows, not dates — deliberately NOT in E-1 |
| 53 | `ipo_details.promoter_shares_held` | D | DOC | — | — | DOC · — · — | DOC · — · — | D2 | no rank 2: capital-structure table only |
| 54 | `ipo_details.sebi_regulation_cited` | D | DOC | — | — | DOC · — · — | DOC · — · — | A12 | no rank 2: printed only on the advertisement |
| 55 | `ipo_details.promoter_group_transactions_since_drhp` | D | DOC | — | — | DOC · — · — | DOC · — · — | D7 | no rank 2: disclosure exists only in the filing |
| 56 | `ipo_details.cut_off_price` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: the cut-off price is fixed only in the offer document; no website republishes it separately from the price band |
| 57 | `ipo_details.min_investment` | D | DOC | — | — | DOC · — · — | DOC · — · — | A13 | no rank 2: a derived investment-amount display, not separately published elsewhere |
| 58 | `ipo_details.isin` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E7 |  |
| 59 | `ipo_details.registrar_link` | D | DOC | — | — | DOC · — · — | DOC · — · — | E7 | no rank 2: no website separately publishes the per-IPO registrar link |
| 60 | `ipo_details.lead_managers` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E7 |  |
| 61 | `ipo_details.company_address` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 62 | `ipo_details.company_phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 63 | `ipo_details.company_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 64 | `ipo_details.company_city` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 65 | `ipo_details.company_state` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 66 | `ipo_details.company_pincode` | D | DOC | — | — | DOC · — · — | DOC · — · — | E6 | no rank 2: contact/address field — printed only in the filing |
| 67 | `ipo_details.qib_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 68 | `ipo_details.nii_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 69 | `ipo_details.retail_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 70 | `ipo_details.retail_max_allottees` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 71 | `ipo_details.employee_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 72 | `ipo_details.anchor_shares_offered` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 73 | `ipo_details.max_retail_subscription` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 74 | `ipo_details.max_employee_subscription` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 75 | `ipo_details.employee_discount` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A16 | no rank 2: the exchange circular carries the allocation |
| 76 | `ipo_details.sponsor_banks` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | E6 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE issueInfo "Sponsor Bank", BSE detail Sponsor_Bank. An earlier draft called it filing-only |
| 77 | `ipo_details.tick_size` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE "Tick Size", BSE Tick_Size |
| 78 | `ipo_details.ipo_market_timings` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | B8 | CORRECTED 2026-09-09: BOTH exchanges carry it - NSE "IPO Market Timings", BSE IPO_Market_Timings |
| 79 | `ipo_details.category_details` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | A13 | no rank 2: the exchange circular carries the allocation |
| 80 | `ipo_details.sub_categories_upi` | D | DOC | NSE | — | DOC · — · — | DOC · NSE · — | B7 | no rank 2: the exchange circular carries the allocation |
| 81 | `financial_data.revenue_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 82 | `financial_data.revenue_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 83 | `financial_data.revenue_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 84 | `financial_data.profit_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 85 | `financial_data.profit_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 86 | `financial_data.profit_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 87 | `financial_data.net_worth` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 88 | `financial_data.eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 89 | `financial_data.roe` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | — |  |
| 90 | `financial_data.debt_to_equity` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | — |  |
| 91 | `financial_data.reserves_and_surplus` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 92 | `financial_data.total_assets` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 93 | `financial_data.total_borrowing` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 |  |
| 94 | `financial_data.promoter_holding_pre_issue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D8 |  |
| 95 | `financial_data.promoter_holding_post_issue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D8 |  |
| 96 | `financial_data.market_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A8 |  |
| 97 | `financial_data.pre_ipo_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 98 | `financial_data.post_ipo_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C6 |  |
| 99 | `financial_data.ronw` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A10 |  |
| 100 | `financial_data.pe_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: observed 2026-09-08: CG prints a PE Ratio column only for OTHER recently listed IPOs in a comparison table, never this IPO own |
| 101 | `financial_data.ebitda_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 102 | `financial_data.ebitda_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 103 | `financial_data.ebitda_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 104 | `financial_data.total_income_fy2022` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 105 | `financial_data.total_income_fy2023` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 106 | `financial_data.total_income_fy2024` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 |  |
| 107 | `financial_data.current_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 108 | `financial_data.quick_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 109 | `financial_data.inventory_turnover` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: KPI table only |
| 110 | `financial_statements.fiscal_year` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 111 | `financial_statements.revenue` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 112 | `financial_statements.total_income` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 113 | `financial_statements.ebitda` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 114 | `financial_statements.pat` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C1 | CG restated table carries this per fiscal year |
| 115 | `financial_statements.net_worth` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C2 | CG gives the most-recent year only, not the full series |
| 116 | `financial_statements.basis` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C8 | OBSERVED on a live CG page: heading gives restated/consolidated, footer gives the unit, and a note flags a year on a different basis |
| 117 | `financial_statements.unit` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C7 | OBSERVED on a live CG page: heading gives restated/consolidated, footer gives the unit, and a note flags a year on a different basis |
| 118 | `financial_statements.eps_basic` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 119 | `financial_statements.eps_diluted` | D | DOC | — | — | DOC · — · — | DOC · — · — | C6 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 120 | `financial_statements.op_cash_flow` | D | DOC | — | — | DOC · — · — | DOC · — · — | C3 | no rank 2: observed absent from a live CG detail page 2026-09-08 - it prints a single pre/post-issue EPS pair, never the per-fiscal-year basic-vs-diluted split, and no cash-flow line |
| 121 | `financial_statements.dscr` | D | DOC | — | — | DOC · — · — | DOC · — · — | C4 | no rank 2: DSCR appears only in the Risk Factors financial tables |
| 122 | `financial_statements.rent_expense` | D | DOC | — | — | DOC · — · — | DOC · — · — | C5 | no rank 2: rent expense line appears only in Other Financial Information |
| 123 | `ipo_valuation.price_floor` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | same number as ipos.price_range_min |
| 124 | `ipo_valuation.price_cap` | D | DOC | NSE | BSE | DOC · BSE · CG | DOC · NSE · CG | A1 | same number as ipos.price_range_max |
| 125 | `ipo_valuation.mcap_at_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A8 | CG prints a single market cap, which is the at-cap figure |
| 126 | `ipo_valuation.pe_at_cap` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | A9 | CG prints a single post-issue P/E, which is the at-cap figure (same logic as mcap_at_cap) |
| 127 | `ipo_valuation.mcap_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A8 | no rank 2: CG prints only ONE market cap (the at-cap one); no website prints the value at the floor price |
| 128 | `ipo_valuation.pe_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: CG prints only ONE P/E (post-issue, at cap); no website prints the value at the floor price |
| 129 | `ipo_valuation.ronw_weighted_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | A10 | no rank 2: CG prints a single-year RoNW; the 3-year WEIGHTED average is a different metric and appears only in the advertisement |
| 130 | `ipo_valuation.pricing_event` | I | DOC | — | — | DOC · — · — | DOC · — · — | — | no rank 2: not a sourced value - it records WHICH document produced the row (PRICE_BAND_AD vs PROSPECTUS) |
| 131 | `ipo_valuation.shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 132 | `ipo_valuation.shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 133 | `ipo_valuation.fresh_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 134 | `ipo_valuation.fresh_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 135 | `ipo_valuation.ofs_shares` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 136 | `ipo_valuation.total_shares_at_floor` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 137 | `ipo_valuation.total_shares_at_cap` | D | DOC | — | — | DOC · — · — | DOC · — · — | A7 | no rank 2: a share COUNT at a specific price point; websites publish the rupee issue size, never the share split at floor vs cap |
| 138 | `ipo_valuation.face_value_multiple_floor` | C | — | — | — | — · — · — | — · — · — | — | computed: price_floor ÷ face_value |
| 139 | `ipo_valuation.face_value_multiple_cap` | C | — | — | — | — · — · — | — · — · — | — | computed: price_cap ÷ face_value |
| 140 | `ipo_valuation.pe_not_ascertainable_reason` | D | DOC | — | — | DOC · — · — | DOC · — · — | A9 | no rank 2: reason text printed only alongside a null PE in the document |
| 141 | `promoters.name` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | D1 | OBSERVED 2026-09-08 on a live CG IPO page: "Company Promoters: <names>". An earlier draft called this document-only; a real fetch disproved it |
| 142 | `promoters.waca` | D | DOC | — | — | DOC · — · — | DOC · — · — | D3 | no rank 2: basis-for-offer-price table only |
| 143 | `promoters.is_promoter_group` | D | DOC | — | — | DOC · — · — | DOC · — · — | D1 | no rank 2: capital-structure table only |
| 144 | `ipo_intermediaries.role` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E1–E6 |  |
| 145 | `ipo_intermediaries.name` | D | DOC | BSE | CG | DOC · BSE · CG | DOC · CG · — | E1–E6 |  |
| 146 | `ipo_risk_factors.seq` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 147 | `ipo_risk_factors.heading` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 148 | `brlm_track_record.brlm_name` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 149 | `brlm_track_record.as_of_date` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: historical, never moves |
| 150 | `brlm_track_record.issues_3y` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 151 | `brlm_track_record.closed_below_issue_price` | D | DOC | — | — | DOC · — · — | DOC · — · — | E2 | no rank 2: only the advertisement prints it. CG has lead-manager performance pages that MIGHT serve as rank 2 - unverified and unscraped, listed as a candidate in A.3, not as a rank |
| 152 | `promoters.shares_held` | D | DOC | — | — | DOC · — · — | DOC · — · — | D2 | no rank 2: capital-structure table only |
| 153 | `promoters.waca_last_year` | D | DOC | — | — | DOC · — · — | DOC · — · — | D4 | no rank 2: basis-for-offer-price table only |
| 154 | `ipo_intermediaries.sebi_reg_no` | D | DOC | — | — | DOC · — · — | DOC · — · — | E3 | no rank 2: SEBI registration number printed only in the intermediaries section |
| 155 | `ipo_intermediaries.contact_person` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 156 | `ipo_intermediaries.phone` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 157 | `ipo_intermediaries.email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 158 | `ipo_intermediaries.grievance_email` | D | DOC | — | — | DOC · — · — | DOC · — · — | E4 | no rank 2: named only in the filing |
| 159 | `ipo_risk_factors.body` | D | DOC | — | — | DOC · — · — | DOC · — · — | F2 | no rank 2: risk factors exist only in the filing |
| 160 | `ipo_risk_factors.kpis` | D | DOC | — | — | DOC · — · — | DOC · — · — | F3 | no rank 2: concentration KPIs exist only in the filing |
| 161 | `promoter_acquisition_ranges.period` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 162 | `promoter_acquisition_ranges.waca` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 163 | `promoter_acquisition_ranges.cap_multiple` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 164 | `promoter_acquisition_ranges.price_low` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 165 | `promoter_acquisition_ranges.price_high` | D | DOC | — | — | DOC · — · — | DOC · — · — | D5 | no rank 2: the WACA 1y/18m/3y table exists only in the filing |
| 166 | `peer_companies.company_name` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 167 | `peer_companies.is_listed` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 168 | `peer_companies.pe_ratio` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 169 | `peer_companies.eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 170 | `peer_companies.diluted_eps` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 171 | `peer_companies.ronw` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 172 | `peer_companies.nav` | D | DOC | CG | — | DOC · CG · — | DOC · CG · — | C9 |  |
| 173 | `peer_companies.pbv_ratio` | D | DOC | — | — | DOC · — · — | DOC · — · — | C9 | no rank 2: observed absent from a live Chittorgarh IPO page 2026-09-08 - it prints NAV, EPS, P/E and market cap, never P/BV |
| 174 | `peer_companies.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 175 | `peer_companies.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 176 | `peer_companies.financial_statement_type` | D | DOC | — | — | DOC · — · — | DOC · — · — | C8 | no rank 2: CG does not print which basis (restated/standalone) the peer figures use |
| 177 | `anchor_investors.bid_date` | T | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | **E-1** (§1.2.1) |
| 178 | `anchor_investors.total_shares_offered` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 179 | `anchor_investors.total_amount_raised` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 180 | `anchor_investors.anchor_investors_count` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 181 | `anchor_investors.investor_list` | D | DOC | — | — | DOC · — · — | DOC · — · — | anchor report | no rank 2: the anchor allocation report IS the exchange filing; there is no separate second publisher of the anchor book |
| 182 | `anchor_investors.lock_in_50_percent_date` | C | — | — | — | — · — · — | — · — · — | — | computed: allotment_date + 30 days — SEBI ICDR 2018 Schedule XIII Part A, VERIFIED 2026-09-08 (50% locked 30 days from allotment, split rule for issues opening on or after 1 Apr 2022). Live code uses bid_date (anchor-investors-scraper.ts:302): a production bug, 6 days early on the one row with an allotment date |
| 183 | `anchor_investors.lock_in_remaining_date` | C | — | — | — | — · — · — | — · — · — | — | computed: allotment_date + 90 days — SEBI ICDR 2018 Schedule XIII Part A, VERIFIED 2026-09-08. Live code uses bid_date (anchor-investors-scraper.ts:302): a production bug |
| 184 | `documents.type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 185 | `documents.title` | I | — | — | — | — · — · — | — · — · — | — |  |
| 186 | `documents.url` | I | — | — | — | — · — · — | — · — · — | — |  |
| 187 | `documents.file_size` | I | — | — | — | — · — · — | — · — · — | — |  |
| 188 | `documents.uploaded_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 189 | `documents.exchange` | I | — | — | — | — · — · — | — · — · — | — |  |
| 190 | `documents.media_type` | I | — | — | — | — · — · — | — · — · — | — |  |
| 191 | `documents.sequence_number` | I | — | — | — | — · — · — | — · — · — | — |  |
| 192 | `documents.is_active` | I | — | — | — | — · — · — | — · — · — | — |  |
| 193 | `documents.extraction_status` | I | — | — | — | — · — · — | — · — · — | — |  |
| 194 | `documents.extracted_at` | I | — | — | — | — · — · — | — · — · — | — |  |
| 195 | `documents.extraction_error` | I | — | — | — | — · — · — | — · — · — | — |  |
| 196 | `documents.retry_count` | I | — | — | — | — · — · — | — · — · — | — |  |
| 197 | `documents.sha256` | I | — | — | — | — · — · — | — · — · — | — |  |
| 198 | `documents.filing_date` | D | DOC | BSE | — | DOC · BSE · — | DOC · — · — | B9 | historical — never moves; the doc-type healing rule depends on it |
| 199 | `subscriptions.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 200 | `subscriptions.qib_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 201 | `subscriptions.nii_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 202 | `subscriptions.retail_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 203 | `subscriptions.total_subscription` | X | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: no document can carry a live figure |
| 204 | `subscriptions.employee_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 205 | `subscriptions.b_nii_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 206 | `subscriptions.s_nii_subscription` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 207 | `subscriptions.total_shares_bid` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 208 | `subscriptions.shares_offered` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: no document can carry a live figure |
| 209 | `subscriptions.scope` | I | — | — | — | — · — · — | — · — · — | — |  |
| 210 | `gmp_records.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 211 | `gmp_records.gmp` | W | IG | CG | — | IG · CG · — | IG · CG · — | — | no rank 2: grey market has no official source, ever |
| 212 | `gmp_records.source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 213 | `gmp_records.gmp_percentage` | C | — | — | — | — · — · — | — · — · — | — | computed: gmp ÷ price_range_max × 100 |
| 214 | `listing_performance.listing_price` | M | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: post-listing market data |
| 215 | `listing_performance.issue_price` | C | — | — | — | — · — · — | — · — · — | — | computed: ipos.price_range_max at listing |
| 216 | `listing_performance.listing_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (listing − issue) ÷ issue × 100 |
| 217 | `listing_performance.current_price` | M | NSE | BSE | CG | BSE · CG · — | NSE · CG · — | — | no rank 2: post-listing market data |
| 218 | `listing_performance.current_gain_percent` | C | — | — | — | — · — · — | — · — · — | — | computed: (current − issue) ÷ issue × 100 |
| 219 | `listing_performance.last_updated` | I | — | — | — | — · — · — | — · — · — | — |  |
| 220 | `listing_performance.current_price_bse` | M | BSE | — | — | BSE · — · — | N/A · N/A · N/A | — | no rank 2: BSE quote by definition |
| 221 | `listing_performance.current_price_nse` | M | NSE | — | — | N/A · N/A · N/A | NSE · — · — | — | no rank 2: NSE quote by definition |
| 222 | `listing_performance.symbol` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.symbol |
| 223 | `listing_performance.company_name` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.company_name |
| 224 | `listing_performance.listing_date` | C | — | — | — | — · — · — | — · — · — | — | computed: copy of ipos.listing_date (E-1 sourced) |
| 225 | `listing_performance.data_source` | I | — | — | — | — · — · — | — · — · — | — |  |
| 226 | `ipo_demand_graph.timestamp` | I | — | — | — | — · — · — | — · — · — | — |  |
| 227 | `ipo_demand_graph.price_point` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 228 | `ipo_demand_graph.is_cut_off` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 229 | `ipo_demand_graph.cumulative_quantity` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 230 | `ipo_demand_graph.exchange` | X | NSE | BSE | — | BSE · — · — | NSE · — · — | — | no rank 2: live bid book; no document can carry it. Also N/A whenever ipo_details.issue_type = FIXED_PRICE (F-26) — a fixed-price issue has no bid book |
| 231 | `registrars.name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 232 | `registrars.short_name` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 233 | `registrars.email` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 234 | `registrars.phone` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 235 | `registrars.website` | D | REG | DOC | CG | REG · DOC · CG | REG · DOC · CG | E3 | the registrar itself is authoritative for its own URL |
| 236 | `registrars.allotment_check_url` | I | REG | — | — | REG · — · — | REG · — · — | — | no rank 2: the registrar owns this URL |
| 237 | `registrars.address` | D | DOC | REG | CG | DOC · REG · CG | DOC · REG · CG | E3 |  |
| 238 | `registrars.active` | I | ADMIN | — | — | ADMIN · — · — | ADMIN · — · — | — | no rank 2: admin-only by design; no external source exists |
| 239 | `registrars.allotment_url_healthy` | I | — | — | — | — · — · — | — · — · — | — |  |
| 240 | `registrars.allotment_url_checked_at` | I | — | — | — | — · — · — | — · — · — | — |  |

### A.2 Offering-type coverage

How many of the 240 fields apply to each offering type. A high `N/A` count is correct, not a
shortfall: a buyback has no price band, no anchor book and no peer comparison.

| Offering type | IPOs on prod | Fields N/A | Fields with a live resolution |
|---|---:|---:|---:|
| FPO | 0 | 0 | 240 |
| RIGHTS | 8 | 35 | 205 |
| OFS | 19 | 35 | 205 |
| NCD | 7 | 86 | 154 |
| INVITS | 3 | 91 | 149 |
| REITS | 2 | 91 | 149 |
| TENDER | 16 | 112 | 128 |
| BUYBACK | 1 | 112 | 128 |


**FPO shows 240 applicable and 0 N/A because it follows mainboard exactly, minus the draft-prospectus
stage. There are zero FPO rows on production, so none of it has ever been exercised — it is the least
trustworthy column in this appendix and is flagged as such in §7.3 item 3.**

**OFS and BUYBACK (20 IPOs) have never had a single provenance row written**, so for them this
appendix describes an intention rather than a correction of existing behaviour.

