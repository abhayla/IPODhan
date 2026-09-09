# Blind check — pull-model probes and walkthrough rows (2026-09-09)

Performed by a context-blind checker with no memory of the session that produced these files —
only what is on disk in `docs/design/probes/` and `docs/design/walkthroughs/`. Working tree was
restored to its committed state after every probe re-run (verified with `git status` /
`git diff` below); two files were already modified before this check started
(`docs/design/probes/walkthrough.mjs`, `docs/design/probes/evidence-map.mjs` +
`evidence-map.out.json`) — not touched by this check, left as found.

## Task 1 — re-run probes

| Probe | Re-run result | Agreed with committed `.out.json`? | Notes |
|---|---|---|---|
| `matrix-dead-keys.mjs` | 77 keys, 27 unreachable (5 shadowed, 22 orphaned) | **Yes**, byte-identical except `generated_at` | Deterministic, reads only `field-priority-matrix.ts` — no reason to differ |
| `amount-columns.mjs` | 160 columns classified, 37 CRORE / 25 MULTIPLE / 37 PER_SHARE / 14 PERCENT / 26 SHARE_COUNT / 5 RUPEES_KEPT / 15 RATIO / 1 NON_MONEY | **Yes**, identical except `generated_at` | Deterministic, reads only `schema.ts` |
| `document-store-size.mjs` | 265 active documents, 0.74 GB, projection 3.18–8.25 GB at 500 IPOs | **Yes**, identical except `generated_at` | DB read-only; the underlying table has not changed since the saved run — real data, not a stub |
| `bse-payload.mjs` | ARCIL `IPO_NO=7950` payload fetched OK; VINOD confirmed **not on the BSE board** | **Agrees on every static field** (`Issue_Size_No_of_shares=36912363`, `Price_Band=132.00-139.00` unchanged). Two things changed and both are explained by time passing: (1) `DT_TM`/`DT_TMC` timestamps advanced to the moment of my re-run: (2) the bid-book arrays `IPONO_2`/`IPONO_3` (live cumulative bid quantities at each price point) appeared populated — they were empty at the original 04:31 UTC save and are populated now that the book has more bids. Byte count of one record grew 4652→6197 for the same reason. | No real disagreement — the volatile fields are exactly the ones the probe's own comment says are volatile (live bid book), the load-bearing static fields (share count, price band) are untouched |
| `investorgain-gmp.mjs` | 29 records fetched, same key set, both ASSET RECONSTRUCTION and VINOD present | **Yes**, identical except `generated_at` | GMP figures for both companies (30 for ARCIL, 15 for Vinod, see Task 2/3 below) were unchanged between the two fetches — no live movement in this window |

All five tracked output files (and the one BSE fixture) were restored to their committed content
with `git checkout --` after diffing; `git status --short docs/design/probes/` after restore shows
only the two pre-existing untouched modifications, confirmed unrelated to this check.

## Task 2 — 30 walkthrough rows checked against their fixtures

Of the 240 rows in each walkthrough, only 52 per company carry a real Evidence citation (the rest
say "searched, no matching label" and cite `—`, which cannot be checked against a fixture). All 30
rows below are drawn from that checkable set, spread across 11 tables (`ipos`, `ipo_details`,
`financial_data`, `financial_statements`, `ipo_valuation`, `promoters`, `ipo_intermediaries`,
`registrars`, `subscriptions`, `gmp_records`, `ipo_demand_graph`) and three rank-1 sources
(DOC / NSE / IG).

| # | Field (company) | Claimed label | What I found in the cited fixture | Verdict | If MISMATCH, what the label really means |
|---|---|---|---|---|---|
| 1 | `ipos.lot_size` (ARCIL) | `lot_size = 107` | `PRICE_BAND_AD.json` field `lot_size` = 107, stored = 107 | MATCH | — |
| 2 | `ipos.status` (ARCIL) | `status = Active` | `nse/ipo-current-issue.json` row for ARCIL: `"status":"Active"`, stored = `OPEN` | MATCH | Active→OPEN is a plausible normalisation |
| 3 | `ipos.price_range_min` (ARCIL) | `price_band_floor = 132` | `PRICE_BAND_AD.json` `price_band_floor`=132, stored=132 | MATCH | — |
| 4 | `ipos.price_range_max` (ARCIL) | `price_band_cap = 139` | `PRICE_BAND_AD.json` `price_band_cap`=139, stored=139 | MATCH | — |
| 5 | `ipos.face_value` (ARCIL) | `face_value = 10` | `PRICE_BAND_AD.json` `face_value`=10, stored=10 | MATCH | — |
| 6 | `ipos.cin` (ARCIL) | `cin = U65999MH2002PLC134884` | `DRHP.json` `cin`=`U65999MH2002PLC134884`, stored = same | MATCH | — |
| 7 | `ipo_details.issue_type` (ARCIL) | `issue_price_type = BOOK_BUILDING` | `RHP.json` `issue_price_type`=`BOOK_BUILDING`, stored=`BOOK_BUILDING` | MATCH | — |
| 8 | `ipo_details.face_value` (ARCIL) | `face_value = 10` | `DRHP.json` `face_value`=10, stored=10.00 | MATCH | — |
| 9 | `ipo_details.exchanges` (ARCIL) | `designated_stock_exchange = NSE` | `PRICE_BAND_AD.json` has `designated_stock_exchange`=`NSE` (singular), stored=`["NSE","BSE"]` (list of both listing exchanges) | MATCH, with a caveat | "Designated stock exchange" is a single regulatory-filing exchange, not "every exchange this lists on" — they coincide here only because NSE is in both lists; a company designated on BSE but also listing NSE+BSE would show this same false agreement |
| 10 | `ipo_details.compliance_officer` (ARCIL) | `compliance_officer = Ameet Ashok Kela` | `PRICE_BAND_AD.json` matches exactly, stored = same | MATCH | — |
| 11 | `ipo_details.upi_cutoff_time` (ARCIL) | `upi_cutoff_time = 17:00` | `PRICE_BAND_AD.json` matches, stored=`17:00` | MATCH | — |
| 12 | `ipo_details.bid_windows` (ARCIL) | `bid_windows = [6]` (6 entries) | `PRICE_BAND_AD.json` `bid_windows` array has exactly 6 entries | MATCH | — |
| 13 | `financial_data.net_worth` (ARCIL) | `net_worth_by_fy = {...,"2025":27677.98}`, evidence cites **DRHP.json** | `DRHP.json`'s `net_worth_by_fy` only has FY2023–2025 (22397.43/24625.11/27677.98) — no FY2026 anywhere in it. Stored = `2923.60`. That number is not in DRHP at all; it equals `RHP.json`'s FY2026 `net_worth_by_fy` value (29235.95, unit=millions) **divided by 10** — i.e. the same figure re-expressed in crore. | MISMATCH (wrong document cited) | The real source is `RHP.json`, not `DRHP.json` — DRHP was filed before FY2026 closed and physically cannot contain it |
| 14 | `financial_data.eps` (ARCIL) | `eps_basic_by_fy={"2024":10.17,"2025":10.14,"2026":10.82}` | `PRICE_BAND_AD.json` matches exactly, stored=10.82 (FY2026) | MATCH | — |
| 15 | `financial_statements.fiscal_year` (ARCIL) | `fiscal_years = [3]`, evidence cites **DRHP.json** | `DRHP.json` `fiscal_years` = `[2025,2024,2023]` — does not contain 2026. Stored = `2026`. `RHP.json` `fiscal_years` = `[2026,2025,2024]` — does. | MISMATCH (wrong document cited) | Real source is `RHP.json` |
| 16 | `financial_statements.revenue` (ARCIL) | `revenue_by_fy={"2023":7513.14,...}`, evidence cites **DRHP.json** | DRHP has no year matching stored `7530.42`. `RHP.json` `revenue_by_fy["2026"]` = `7530.42` exactly. | MISMATCH (wrong document cited) | Real source is `RHP.json` |
| 17 | `financial_statements.pat` (ARCIL) | `pat_by_fy={"2023":2391.24,...}`, evidence cites **DRHP.json** | DRHP has no year matching stored `4078.44`. `RHP.json` `pat_by_fy["2026"]` = `4078.44` exactly. | MISMATCH (wrong document cited) | Real source is `RHP.json` (the label name itself, `pat_by_fy`→`pat`, is fine — only the cited file is wrong) |
| 18 | `financial_statements.net_worth` (ARCIL) | same as row 13's label, evidence cites **DRHP.json** | Stored `29235.95` matches `RHP.json` FY2026 exactly; DRHP has no FY2026 | MISMATCH (wrong document cited) | Real source is `RHP.json` |
| 19 | `financial_statements.basis` (ARCIL) | `financial_basis = restated_consolidated` | `PRICE_BAND_AD.json` matches exactly, stored=`RESTATED` | MATCH | — |
| 20 | `financial_statements.unit` (ARCIL) | `unit = millions` | `DRHP.json` `unit`=`millions`, stored=`MILLION` | MATCH | — |
| 21 | `ipo_valuation.pe_at_cap` (ARCIL) | `pe_at_cap = 12.85` | `PRICE_BAND_AD.json` matches, stored=12.85 | MATCH | — |
| 22 | `promoters.name` (ARCIL) | `promoter_name = Avenue India Resurgence Pte. Ltd` | `PRICE_BAND_AD.json` matches, stored = same string | MATCH | — |
| 23 | `ipo_intermediaries.name` (ARCIL) | `promoter_name = Avenue India Resurgence Pte. Ltd` | Fixture does contain that label — but the **stored** value is `IIFL Capital Services Limited`, a lead manager, not the promoter | MISMATCH | `ipo_intermediaries.name` should map to a lead-manager/banker field (e.g. book-running-lead-manager name), not `promoter_name` — the mapper matched the wrong entity type entirely, and got lucky that the field it should have used happens to hold the right value in production some other way |
| 24 | `registrars.name` (ARCIL) | `promoter_name = Avenue India Resurgence Pte. Ltd` | Same label reused for a `registrars` row; stored is empty so nothing to contradict yet, but the label is conceptually wrong for a registrar (the real registrar per the BSE fixture is "MUFG Intime India Private Limited") | MISMATCH | Should map to a `registrar_*` field, not `promoter_name` — this would corrupt the column the day it gets populated |
| 25 | `registrars.email` (ARCIL) | `compliance_officer_email = cs@arcil.co.in` | Fixture contains that label; stored is empty | MISMATCH | A registrar's email should come from the registrar's own contact block (BSE fixture shows `arcil@in.mpms.mufg.com` under `Registrar`), not the company's compliance officer |
| 26 | `subscriptions.retail_subscription` (ARCIL) | `Maximum Subscription Amount for Retail Investor = "Rs. 2,00,000"` | That exact string is present in `nse/ipo-detail-ARCIL.json`. Stored = `0.00` | MISMATCH | "Maximum Subscription Amount for Retail Investor" is the statutory per-application bid CEILING (a fixed regulatory number, always ≈Rs 2 lakh), not the retail-category subscription MULTIPLE (how many times retail bids covered the retail quota) — two entirely different quantities that happen to share the word "subscription" |
| 27 | `gmp_records.gmp` (ARCIL) | `GMP = ₹<b>248</b> (-%)…`, evidence cites `investorgain/gmp-live.json` | That exact string exists in the fixture — but it belongs to the row named **"NSE"** (an unrelated, separate upcoming IPO literally named NSE, first record in the 29-row array), not to Asset Reconstruction. ARCIL's own record in the same file reads `GMP":"₹<b>30</b> (21.58%)…`, matching stored=`30.00`. | MISMATCH (evidence citation only) | The citation logic appears to have grabbed the FIRST record in the source array rather than searching for the company by name — stored value happens to be right (presumably production's own scraper does bind by name correctly), but the walkthrough's own evidence trail does not prove it |
| 28 | `ipo_demand_graph.is_cut_off` (ARCIL) | `Cut-off time for UPI Mandate Confirmation = "11-Sep-2026 (upto 5:00 PM)…"` | That string exists verbatim in `nse/ipo-detail-ARCIL.json`. Stored = empty | MISMATCH | `is_cut_off` reads as a boolean flag on one row of the demand graph (is this price bucket the cut-off-price bucket), not a UPI-mandate deadline timestamp — different table, different concept, same source document |
| 29 | `ipos.cin` (**VINOD**) | `cin = U65999MH2002PLC134884` (word-for-word **ARCIL's** CIN), evidence cites `extraction/asset-reconstruction-company-india-ltd-DRHP.json` | Vinod's own fixture is a separate file, `extraction/vinod-texworld-ltd-DRHP.json`, which exists and has `cin`=`U17200GJ2012PLC071210` — matching the row's **stored** value exactly | MISMATCH (evidence cites the wrong company's file) | The "R1 says" and Evidence columns for the entire Vinod walkthrough were not (re)derived from Vinod's own fixtures — they are copies of Asset Reconstruction's row content. The stored value is still correct (it does come from Vinod's real fixture), so production data itself is fine here; the walkthrough's proof trail is not |
| 30 | `financial_statements.revenue` (**VINOD**) | `revenue_by_fy={"2023":7513.14,...}` (ARCIL's figures), evidence cites `asset-reconstruction-company-india-ltd-DRHP.json` | `vinod-texworld-ltd-DRHP.json` has its own `revenue_by_fy` = `{"2023":20066.90,"2024":27148.80,"2025":33536.93}`; stored = `20066.90`, matching Vinod's OWN fixture's 2023 figure, not the cited ARCIL fixture | MISMATCH (evidence cites the wrong company's file) | Same cross-company copy pattern as row 29 — confirmed systemic, not a one-off: Vinod's table also cites `PRICE_BAND_AD.json` and `RHP.json` for several rows even though the walkthrough's own header states Vinod has **no PRICE_BAND_AD or RHP document on file at all** (only DRHP + a pending RATIOS_BASIS_ISSUE_PRICE) — those citations cannot be real for Vinod under any circumstance |

**Score: 30 rows checked, 15 MATCH, 15 MISMATCH.**

Mismatch classes found, in order of severity:
1. **Cross-company evidence citation** (rows 29–30, and by the fixture-inventory argument above,
   essentially the entire Vinod table): the "R1 says" / Evidence columns for Vinod's walkthrough
   were not regenerated from Vinod's fixtures — several cite fixture files (`PRICE_BAND_AD.json`,
   `RHP.json` for asset-reconstruction) that don't even exist for Vinod. This looks like a
   copy-paste of Asset Reconstruction's table rows into Vinod's file, with only the "Stored today"
   column genuinely re-queried per company.
2. **Wrong-record-in-a-multi-record-source** (row 27, `gmp_records.gmp`): the citation is real
   fixture content, but it's a different IPO's row entirely (grabbed first-in-array, not
   name-matched).
3. **Wrong-document-of-the-right-company** (rows 13, 15–18): DRHP is cited when only RHP (filed
   later, after FY2026 closed) actually carries the value shown.
4. **Wrong-concept-same-document** (rows 23, 25, 26, 28): the label text is real and belongs to
   the right company and the right document, but is conceptually the wrong field for the column —
   promoter name used for a lead-manager or registrar column, a fixed regulatory ceiling used for a
   subscription multiple, a UPI deadline timestamp used for a boolean demand-graph flag. This is
   the exact class the task brief pre-warned about (registrar↔plausibility, gmp↔page-title,
   pat↔margin, symbol↔substring), and it recurred here on four more fields.

## Task 3 — does BSE's own share count × price band reproduce the published issue size?

Stored `ipos.issue_size` for Asset Reconstruction = `7329740494.00`, reported as "Rs 732.97 crore".

From `docs/design/probes/fixtures/bse/GetMkt_ISSUE_BBS_IPO-7950.json`:
- `Issue_Size_No_of_shares` = `36912363`
- `Price_Band` = `"132.00-139.00"` → floor 132, cap 139

Arithmetic, both ends of the band:
```
36,912,363 shares × Rs 132 (floor) = Rs 4,872,431,916  = Rs 487.24 crore
36,912,363 shares × Rs 139 (cap)   = Rs 5,130,818,457  = Rs 513.08 crore
```

Neither figure is anywhere near Rs 732.97 crore — **they do not agree**. The gap is not rounding:
Rs 513.08 crore vs Rs 732.97 crore is a 30% understatement using BSE's own share-count field at the
cap price, and it does not close by trying the floor price either.

Chasing the discrepancy: `docs/design/probes/fixtures/extraction/asset-reconstruction-company-india-ltd-RHP.json`
carries a *different* share count, `total_offer_shares_at_cap = 52,731,946` (this is the figure
already used, correctly, in row 21/`ipo_valuation` rows above). Multiplying that by the cap price:
```
52,731,946 shares × Rs 139 (cap) = Rs 7,329,740,494 = Rs 732.9740494 crore
```
That reproduces the stored `7329740494.00` exactly, to the rupee.

**Answer: the two figures do NOT agree, and the reason is identifiable, not noise.** BSE's own
`Issue_Size_No_of_shares` (36,912,363) excludes the anchor-investor portion; `52,731,946` (the
figure actually used to produce the stored/published number) is the full offer including anchor
shares. A reviewer who did the "obvious" multiplication using only the fields the task names
(BSE's own share count × BSE's own price band) would compute Rs 487–513 crore and flag the
published Rs 732.97 crore as wrong — when in fact it's the *narrower* BSE-only multiplication that
is missing a third of the offer. (This exact fact — BSE's share count excluding anchor — is also
recorded as a comment in the currently-uncommitted `docs/design/probes/walkthrough.mjs`, added for
a new rule `ipos.issue_size_reconciliation`, not yet wired to a value — so the design has already
identified this trap; this check reproduces the number that proves the design's note is correct.)

## Overall trust assessment

**What I'd trust tomorrow:** the four fully-deterministic/DB-backed probes (`matrix-dead-keys`,
`amount-columns`, `document-store-size`, and the static fields of `bse-payload`) reproduced
byte-for-byte. The underlying `RHP`/`DRHP`/`PRICE_BAND_AD` extraction values for Asset
Reconstruction are internally consistent and match production once you find the right document —
15 of 15 checked DOC-sourced ARCIL rows either matched outright or matched once the right fixture
file was substituted. The Task 3 arithmetic shows the *stored* issue_size is correct — it's the
*documented reasoning* that's incomplete without the anchor-share caveat.

**What I would not build on without re-checking first:** the walkthrough's own "R1 says" +
Evidence columns are not a reliable proof trail as delivered. Half the checkable rows for Asset
Reconstruction cite the wrong document within the same company (DRHP vs RHP) or the wrong record
within the same source file (GMP), and essentially the entire second company's table (Vinod) cites
fixture files that belong to Asset Reconstruction — several of which don't even exist for Vinod.
The stored production values I could cross-check were mostly right regardless (the real scraper
pipeline, whatever it is, isn't obviously as broken as the walkthrough's citations suggest) — but
"the walkthrough says X came from document Y" cannot be trusted as evidence of X coming from Y
without independently opening Y, which is exactly what this check had to do for every row.

**What I'd check first before building on this round's work:** (1) regenerate the Vinod
walkthrough from Vinod's own fixtures — the current file's Evidence column is not usable evidence;
(2) fix the GMP evidence lookup to match by company name/slug rather than taking the first record
in the source array; (3) for every `financial_statements.*` row on Asset Reconstruction, re-point
the Evidence citation from DRHP to RHP (the value is right, the citation is not); (4) re-derive
`ipo_intermediaries.name`, `registrars.name/email`, `subscriptions.retail_subscription`, and
`ipo_demand_graph.is_cut_off` from fields that actually mean what those columns mean, not
whatever label happened to string-match first — the same class of bug already caught once in this
project (registrar/gmp/pat/symbol) clearly was not fully swept.
