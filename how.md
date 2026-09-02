# How — The step-by-step process IPODhan uses to achieve its goal

> This document explains, in plain language and in order, **how** IPODhan delivers the goal
> described in [`about-me.md`](./about-me.md): turn scattered, messy, partly-mislabelled IPO
> data into one correct, complete, fresh, user-facing record.
>
> Each step gives: (a) **what happens**, in simple terms, and (b) **where it lives** in the
> code (so the doc stays honest and maintainable). It is grounded in a real trace of the
> codebase, not a wish-list.

The journey has **three big phases**, broken into numbered steps:

- **Phase A — Discover & decide:** find candidates, and answer *"is this really an IPO?"*
- **Phase B — Gather, reconcile & store:** collect every detail (incl. the prospectus PDF),
  resolve source conflicts, protect human edits, and write it to the database — once, safely.
- **Phase C — Keep fresh & serve:** re-scrape on a market-aware schedule, and show the data to
  the user fast and correctly.

---

## Precondition (once per machine, not per IPO)

Before walking any IPO through the pipeline by hand (or trusting a live run to have exercised
it), the machine needs:

```
ls node_modules/pino >/dev/null 2>&1 || npm install      # deps in the MAIN checkout, not a worktree
netstat -an | grep -q ":15432.*LISTEN"                    # local -> prod-DB SSH tunnel up
```

- **DB tunnel** — local dev talks to the prod Postgres box over an SSH tunnel to
  `localhost:15432` (see the `vps-db-tunnel-setup` memory); `web/.env.local` is tunnel-aware.
- **Prod feature flags** — read live from the VPS, not assumed. The five that gate the write
  path below all default to describing 2026-08's state, but this walk confirmed them read
  `true`/`100` on the VPS on 2026-09-02: `ENABLE_DATA_CONSOLIDATION=true`,
  `ENABLE_SOURCE_TRACKING=true`, `ENABLE_CONFLICT_DETECTION=true`,
  `CONSOLIDATION_PERCENTAGE=100`, `ENABLE_BSE_API=true`. Re-check them on the VPS before trusting
  this document — don't assume they still hold.
- **Pool/timeout env over the tunnel** — `PG_CONNECTION_TIMEOUT_MS=20000 SHARED_DB_POOL_MAX=3`.
  The shared pg pool's default 2s connect timeout kills a multi-row write over the SSH tunnel
  (W-20); not needed against the direct VPS network path.
- **tesseract** — only installed on the VPS (T-406), not on a dev laptop. The OCR branch (Step
  D6 below) can only be exercised there; locally it always takes the "no text layer" skip path.
- **Probe convention** — a step probe lives at `scraper/scripts/_walk-<step>-probe.ts`, is run
  with `npx tsx`, and is deleted after the step. It always calls the real scraper function, never
  a hand-rolled curl — a probe that hand-parses the API separately from the real code proves
  nothing about the real code.

### Source tiers

Three tiers decide which source is trusted for which kind of field (full detail:
`docs/specs/per-ipo-due-step-pipeline.md` §3):

1. **Filings** (RHP/DRHP, the price-band ad) are the source of **truth for static fields** —
   financials, promoters, objects of the offer, category reservation, peer comparison.
2. **Exchange APIs** (NSE, BSE) are the source of **truth for live fields** (status, subscription,
   GMP-adjacent timing) **and for document discovery** (they carry the links to the filings).
3. **Aggregators** (Moneycontrol, Chittorgarh) are **verification only** — they confirm an
   exchange or filing value, they never outrank one — **except GMP, which has no exchange
   source and is trusted only from InvestorGain.**

---

## Phase A — Discover the candidate, decide what it is, write it

### Step B1 — Fetch the BSE IPO board (JSON)

BSE's own IPO board is fetched as typed JSON (not scraped HTML) and every row carries BSE's own
`IR_flag`, the most authoritative signal for what kind of corporate action a row actually is.

*What DEEPA produced:* 22 board rows, 4 of them `IR_flag=IPO`; the DEEPA row was present with
`IR_flag=IPO`.

*Status:* **LIVE in prod** — `ENABLE_BSE_API=true` on the VPS.

*Where:* `scraper/src/scrapers/bse-api-scraper.ts`.

### Step B2 — Fetch the NSE current + all-upcoming lists

NSE is fetched the same way — typed JSON lists, not HTML — for both the currently-active IPOs
and the all-upcoming list, so an IPO that has not opened yet is still discovered.

*What DEEPA produced:* NSE reachable (no 403 on the walk day); DEEPA present in both lists.

*Status:* **LIVE in prod.**

*Where:* `scraper/src/scrapers/nse-api-client.ts`.

### Step B3 — Parse the candidate row into typed fields

Each source's raw JSON row is mapped into the shared internal shape (face value, price band,
lot size, dates, issue size, ...).

*What DEEPA produced:* BSE — 10/10 fields parsed correctly from the raw detail payload (48
keys). NSE — **wrong**: `faceValue` came back `10` because the NSE list payload carries no face
value and the mapper silently defaulted to `|| 10`; NSE's own `issueInfo` text elsewhere says
"Rs. 2 per Equity Share" (DEEPA's real face value, matching BSE).

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** (originally found and fixed on
`fix/nse-face-value-default`, merged in): the fabricated `|| 10` default was removed from every
site it appeared — `nse-api-client.ts`, the legacy NSE scraper, `data-persister.ts`'s insert
path, `data-consolidation-orchestrator.ts`, `bse-scraper.ts`, `bse-detail-scraper.ts`, and the
Chittorgarh rights/debt adapter (7 sites total). Missing face value is now `undefined`, never a
guessed `10`, so a real conflict surfaces instead of a silent wrong number.

*Where:* `scraper/src/scrapers/nse-api-client.ts` (`transformIPOData`,
`extractAdditionalNSEFields`); `scraper/src/scrapers/bse-api-scraper.ts`, `bse-detail-scraper.ts`.

### Step B4 — Classify: is this really an IPO?

Same logic as before: BSE's `IR_flag` first, then symbol patterns, then name keywords, with a
guard so a record correctly classified as non-IPO can't be downgraded back to "IPO" by a later
generic guess.

*What DEEPA produced:* `IR_flag=IPO` -> classified IPO; symbol/name checks agree; segment
`MAINBOARD`; a full sweep of the 22-row board classified 22/22 sanely and the keep-classification
guard held a TENDER row correctly un-downgraded.

*Status:* **LIVE in prod.**

*Where:* `scraper/src/utils/detect-offering-type.ts` (`detectOfferingTypeFromBSEIRFlag`,
`resolveOfferingTypeKeepingClassification`).

### Step B5 — Validate the raw record

Domain rules reject obvious garbage (lot size 1, close-before-open, an inverted price band) and
auto-fix what's fixable (e.g. a "rights issue" name gets reclassified to RIGHTS).

*What DEEPA produced:* valid on both the BSE and NSE inputs; production's `shouldCreate=true` on
both. The gap this run exposed: validation runs **per source**, on whichever fields that source
happens to carry — BSE's JSON has no `segment` field, so the SEBI band-width rule (mainboard
<=20%, SME <=40%) never even fires on a BSE-only row. A 25% band on a mainboard IPO from BSE
would pass today (a coverage hole, not a wrong value for DEEPA specifically).

*Status:* **LIVE in prod**, with the coverage hole open (validate the *merged* record after
consolidation, not each source's partial view — tracked as a spec item).

*Where:* `scraper/src/pipelines/data-validation-pipeline.ts`; `scraper/src/utils/data-validation.ts`.

### Step B6 — Identity match: new record or existing one?

Before writing, the scraper resolves the incoming row against anything already in the database —
exact name+symbol, common suffix variants ("Ltd" / "LTD."), a fuzzy name match, or symbol-with-
wrong-name — so the same company never gets written as two rows.

*What DEEPA produced:* `resolveIpoRow` correctly resolved every variant tried (exact match, 'Ltd',
'LTD.', a typo'd 'Jewelers', symbol-with-wrong-name) to the one existing DEEPA row; an unmatched
company correctly resolves to NEW.

*Status:* **LIVE in prod.**

*Where:* `scraper/src/services/duplicate-detection-service.ts` (`resolveIpoRow`).

### Step B7 — Write through `upsertIPO` (update + insert)

The single write door: re-check the IPO-level lock, filter admin-protected fields, run
validation, consolidate via the field-priority matrix, then write — under a Redis lock keyed by
slug.

*What DEEPA produced:* the insert path was correct (one row, exchanges merged as `[BSE, NSE]`).
The **update** path, run against a pre-existing DEEPA row, needed 4 fix rounds before it was
correct: an absent incoming value was overwriting a present stored value (W-16 — e.g. an NSE
update nulling `lead_managers`); provenance history wasn't recorded, so "what did BSE say before
NSE overwrote it" was unanswerable (W-17); and conflict rows were logged wrong in both directions
— a real face-value conflict (2 vs 10) produced no `data_conflicts` row, while a same-value merge
produced a spurious one (W-18).

*Status:* **FIXED on branch `docs/deepa-walk-ledger`**, Tier A reviewed (4 review rounds,
final: MERGEABLE, 126+16 tests reproduced independently). Live-proven on a no-provenance row:
nothing destroyed across 5 writes, a confirming write now creates provenance, a genuine 2-vs-10
conflict yields exactly one CRITICAL row, and a losing write leaves history intact. Not deployed.

*Where:* `scraper/src/services/data-persister.ts` (`upsertIPO`, `buildNonDestructiveUpdate`,
`mergeListingExchangesForSource`); `scraper/src/services/data-consolidation-service.ts`
(`consolidateField`, conflict logging, `areEquivalent`).

---

## Phase B — Find, download, extract, reconcile, protect, store, keep fresh

### Step C1 — BSE issue detail -> typed document links

BSE's per-IPO detail JSON is parsed into typed document links (RHP, price-band ad, corrigendum,
addendum, anchor details).

*What DEEPA produced:* 2 links — `PRICE_BAND_AD` classified correctly; the RHP zip
(`..._Red_Herring_Prospectus_and_GID_...zip`) was **wrongly** typed `PROSPECTUS` because the
classifier's `isRedHerring()` matcher only recognised "red herring" with a space or "rhp", not an
underscore-joined filename.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — title normalisation now turns `_`/`-`/`.`
into spaces before matching (`normalizeTitle`); 5 new tests, 48/48 reproduced. Not deployed.

*Where:* `scraper/src/services/document-classifier.ts`.

### Step C2 — NSE issue detail -> typed document links

Same idea for NSE, which carries a richer detail payload for DEEPA.

*What DEEPA produced:* 7 typed links, including RHP, `RATIOS_BASIS_ISSUE_PRICE`,
`ANCHOR_ALLOCATION_REPORT` (which BSE does not carry for this IPO).

*Status:* **LIVE in prod** (BSE_API flag; NSE detail fetch is unconditional).

*Where:* `scraper/src/services/document-classifier.ts`; NSE detail parsing in
`scraper/src/scrapers/nse-api-client.ts`.

### Step C3 — SEBI public-issues listings

A third, independent source for RHP/DRHP/PROSPECTUS links — SEBI's own filed-documents pages.

*What DEEPA produced:* the RHP was found by name. The DRHP was **not** found — SEBI's listing
was fetched as one page of the 25 newest filings only, never paged or searched, and DEEPA's DRHP
(filed months earlier) had scrolled off page 1.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — added a SEBI form-POST search (by
company name, with the session/Referer handling SEBI's WAF requires) plus a paging fallback;
39/39 tests reproduced. Live-proven: DEEPA's DRHP found on the first search. Not deployed.

*Where:* `scraper/src/services/document-discovery-runner.ts` (`trySebi`);
`scraper/src/services/sebi-source.ts`.

### Step C4 — Fallback: company host, human verifier

When exchange + SEBI both miss, the runner is designed to fall back to the company's own investor
page, then flag for a human verifier.

*What DEEPA produced:* skipped with `no_company_url` — no company website was stored, even
though the RHP's own cover page states it. There is also no Chittorgarh rung in the runner at
all, despite the lifecycle plan listing one.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — after an RHP is stored, the runner now
reads the company website off its cover page and persists it to `ipos.company_website` for later
rungs; live-proven (`https://www.deepajewel.com` extracted from DEEPA's cover). A regression this
fix could have caused (picking a banker's domain off the cover instead of the issuer's) was
caught by test reproduction and closed. Not deployed. The Chittorgarh rung remains unbuilt.

*Where:* `scraper/src/services/document-discovery-runner.ts`.

### Step C5 — Classify each discovered link

Every link found by C1-C4 is typed by its own content, not just trusted from its source's "kind"
label — a mismatch there means the wrong document lands under the wrong type.

*What DEEPA produced:* NSE's `RATIOS_BASIS_ISSUE_PRICE` zip actually contained the readable text
copy of the price-band ad (its member classified as `PRICE_BAND_AD`), but the row was stored
under the fetch kind, `RATIOS_BASIS_ISSUE_PRICE` — so extraction later looked for the price-band
ad under BSE's unreadable scanned copy instead of NSE's readable one.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — when the member's own classification
disagrees with the fetch kind, the runner now stores it under the member's real type. Not
deployed.

*Where:* `scraper/src/services/document-discovery-runner.ts`; `document-classifier.ts`.

### Step D1 — Download with retry

*What DEEPA produced:* 4 zips downloaded (BSE RHP 14.3 MB, BSE price-band ad 2.8 MB, NSE ratios
0.6 MB, NSE anchor 0.8 MB); PDF members extracted.

*Status:* **BUILT, off the live cycle** — runs via the discovery harness, not the scheduled
`--source=all` cron.

*Where:* `scraper/src/services/document-discovery-runner.ts`.

### Step D2 — Reject non-PDF responses

*What DEEPA produced:* not triggered — all four responses were valid zips containing real PDFs.

*Status:* same as D1.

### Step D3 — sha256 dedup

*What DEEPA produced:* 4 distinct hashes, each stored on its `documents` row; a second run made
zero additional downloads.

*Status:* same as D1.

*Where:* `scraper/src/services/document-discovery-runner.ts`.

### Step D4 — Store under `<ipo_id>/` + a `documents` row

*What DEEPA produced:* 5 documents stored (the DRHP, found via SEBI search, added 13.4 MB),
7 `document_fetch_state` rows (5 `FOUND`, corrigendum/addendum correctly `NOT_YET_FILED` since
none exist yet for an open IPO).

*Status:* same as D1; the state's `NOT_YET_FILED` vs `NOT_FOUND` distinction was fixed on this
branch (a state that previously conflated "not filed yet" with "we failed to find it" — now backs
off and alerts on repeated failure instead of silently calling it not-yet-filed).

*Where:* `scraper/src/services/document-discovery-runner.ts`.

### Step D5 — A second run makes zero network calls

*What DEEPA produced:* run 1: 8 calls; run 2: 0; run 3: pure skip — the state machine correctly
treats already-fetched documents as done.

*Status:* same as D1.

### Step D6 — Text-layer check / OCR route

Before extraction, each PDF is checked for a real text layer; scanned pages without one are
routed to OCR.

*What DEEPA produced:* RHP (433 pages), the NSE text copy of the ad (4 pages, ~44k chars — the
actual extraction source), and the anchor letter all had real text. BSE's own scanned price-band
ad (4 pages, 71 garbage chars — broken font encoding) correctly triggered
`skipped_no_text_layer`.

*Status:* **BUILT, verified only against a text-layer PDF locally** — the OCR branch itself needs
`tesseract`, which is on the VPS but not this dev laptop (see Precondition), so it could not be
exercised end-to-end in this walk. For DEEPA the NSE text copy made OCR unnecessary anyway.

*Where:* `scraper/scripts/extract_financials_pdf.py` / the PDF router (text-layer check).

### Step E1 — Issue terms + timeline

The price-band ad (or RHP) is parsed for the core issue facts: band, face value, lot, shares at
floor/cap, fresh-issue amount, key dates.

*What DEEPA produced:* correct on all core fields — band 168/177, face 2, lot 84, shares at
floor/cap 14,880,952 / 14,124,293, fresh Rs 2,500 mn, allotment 4 Sep, refund 7 Sep, listing
8 Sep. Missed on the first pass: the OFS row, the market-cap row, anchor/open/close date lines,
and the RHP filing date — because the extractor's patterns were shaped only around one earlier
IPO (Purple Style Labs) and didn't generalise.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — an 86-field hand-transcribed oracle for
DEEPA (`docs/reviews/fixtures/deepa-jewellers-expected.json`) now drives the extractor to match
every field the ad actually carries, including the ones missed on the first pass. Not deployed.

*Where:* `scraper/scripts/extract_filing.py` (`--doc-type PRICE_BAND_AD`).

### Step E2 — Category reservation (QIB/NII/retail)

*What DEEPA produced:* first pass returned null — the extractor expected one regulation's exact
wording and DEEPA's ad used different phrasing ("NOT MORE THAN 50% / NOT LESS THAN 15% / NOT
LESS THAN 35%").

*Status:* **FIXED** alongside E1 (tolerant patterns from the same oracle). Not deployed.

*Where:* `scraper/scripts/extract_filing.py`.

### Step E3 — Financials per FY

*What DEEPA produced (first pass, WRONG):* revenue/PAT/EPS off by orders of magnitude and the
unit misread as "lakhs" when the source table said "Rs million" — pdfplumber was inserting a
stray space after the first digit of every numeric cell on the RHP's annexure page, corrupting
every number silently while the arithmetic checks still passed.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — the table-repair logic was corrected, and
six named plausibility checks were added (PAT never exceeds revenue, EBITDA at least PAT, YoY
ratio within bounds, EPS x shares matches PAT, the stated unit sits near the table it describes,
and the ad's KPI table must agree with the RHP's own summary). This is the exact class the
project's output-plausibility rule exists to catch. Not deployed.

*Where:* `scraper/scripts/extract_financials_pdf.py`; `scraper/scripts/extract_filing.py`.

### Step E4 — KPIs and ratios

*What DEEPA produced:* weighted RoNW (45.26) correct; P/E at floor/cap, per-year RoNW, EBITDA
margin, NAV not yet extracted.

*Status:* partially built, same fix wave as E1-E3. Not deployed.

### Step E5 — Objects of the offer

*What DEEPA produced:* nothing — DEEPA's price-band ad has no objects section, and the RHP path
for this field isn't built yet.

*Status:* **MISSING.**

### Step E6 — Peer comparison

*What DEEPA produced:* peers (Sky Gold and Diamonds, Shringar House of Mangalsutra) with their
P/E, EPS, RoNW, NAV extracted correctly; industry P/E not yet extracted.

*Status:* FIXED alongside E1 (oracle-driven patterns). Not deployed.

### Step E7 — Promoters + intermediaries

*What DEEPA produced:* BRLM/registrar registration numbers, compliance officer, CIN all correct;
promoter names, OFS share counts, and WACA not yet extracted.

*Status:* partial, same fix wave. Not deployed.

### Step E8 — Risk factors / litigation

*What DEEPA produced:* FAIL — the RHP's `risk_factor_count` heading matcher returned 0 against a
required minimum of 20; this is a pre-existing bug, untouched by this walk.

*Status:* **MISSING / broken**, open.

### Step E9 — Arithmetic checks

*What DEEPA produced:* the offer-level checks (shares x price = amount, monotonic bands) fired
correctly. The financial-series checks did not exist before this walk (see E3) — that gap is what
let the wrong revenue/PAT/EPS numbers through.

*Status:* FIXED alongside E3. Not deployed.

### Step E10 — `[bullet]` unpriced placeholders

*What DEEPA produced:* unpriced OFS amounts (printed with an unpriced-bullet placeholder before
the price is fixed) correctly emit `null` with a reason, not a false zero.

*Status:* **LIVE / correct on the tested path**, not deployed as part of the wider extraction
pipeline (extraction itself is CLI-only, see Step 12).

### Step F1 — Chittorgarh list for DEEPA

*What DEEPA produced:* present among 204 listed IPOs, with band/dates/exchanges agreeing; but the
company name parsed as "Deepa Jewellers Ltd. O" — the scraper appended a status-pill's text
("O" for Open) that sits as a sibling `<span>` inside the same table cell as the company anchor.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — the anchor's own text is now used in
isolation; 5 tests, 93/93 Chittorgarh tests reproduced. Not deployed.

*Where:* `scraper/src/scrapers/chittorgarh-scraper.ts` (`extractTextFromAnchor`).

### Step F2 — Moneycontrol list for DEEPA

*What DEEPA produced:* not present — Moneycontrol's list page is a partial feed (12 IPOs shown,
DEEPA not among them). Not a scraper defect, a coverage gap in the source itself.

*Status:* as designed, coverage-limited.

### Step F3 — InvestorGain GMP for DEEPA

*What DEEPA produced:* GMP 28 (15.82%), price 177, correct dates, correct slug/id.

*Status:* **BUILT and correct on this run**; not scheduled in prod (`ENABLE_GMP_SCHEDULED_JOB` is
unset on the VPS — see H2 below).

### Step F4 — Field-by-field compare against the tier-1 record

*What DEEPA produced:* `upsertIPO(chittorgarh row, 'CHITTORGARH')` resolved identity correctly
despite the polluted " O" name (no duplicate created); a listing date with no existing tier-1
value was accepted from Chittorgarh.

*Status:* **LIVE on the consolidation path.**

### Step F5 — Mismatch -> visible conflict, tier-1 kept

*What DEEPA produced:* a real conflict — NSE's issue size (Rs 3,278,055,045, the exchange share
count x price) vs Chittorgarh's (Rs 4,597,200,000, fresh + OFS at cap) — correctly logged as
CRITICAL, with NSE (the higher-tier source) kept. **The kept value is the wrong one**: the ad
confirms Chittorgarh's Rs 4,597 mn is the real total offer size; the exchange share count is a
narrower figure that isn't the same thing (W-11).

*Status:* **behaviour correct, data wrong** — the priority matrix needs the filing-derived issue
size promoted to outrank the exchange figure (tracked for Step G1, not yet built).

*Where:* `scraper/src/services/data-consolidation-service.ts`.

### Step F6 — Confidence per field

*What DEEPA produced:* every `field_sources.confidence` value was `100`, regardless of source
(NSE, BSE, Chittorgarh all `100`) — no confidence scoring exists at all.

*Status:* **MISSING.**

### Step G1 — Merge via the priority matrix

*What DEEPA produced:* proven at B7 and F5 — per-field winners are logged, `NSE > BSE >
CHITTORGARH` is applied, and a static-field mismatch produces a conflict row. Still open: a
wrong exchange issue size can currently beat the ad's correct total (see F5) until filing values
are persisted as a higher-priority tier (tier 1a) than exchange data (tier 1b).

*Status:* **LIVE**, with the tier-1a gap open (blocks on Step G4).

*Where:* `scraper/src/config/field-priority-matrix.ts`.

### Step G2 — Admin field lock survives scrapes

*What DEEPA produced:* `markFieldAsManuallyEdited(issueSize)` then an NSE scrape sending a
different value: the manually-set Rs 4,597,160,000 was kept, the write was correctly filtered,
and the block was recorded for the admin to see.

*Status:* **LIVE in prod.**

*Where:* `web/lib/admin/field-protection-checker.ts`.

### Step G3 — Single write door + Redis lock

*What DEEPA produced:* every write in this walk went through `upsertIPO`; lock keys were
observed in logs; the legacy (non-consolidation) fallback path is now non-destructive too.

*Status:* **LIVE in prod.**

*Where:* `scraper/src/services/data-persister.ts` (`upsertIPO`).

### Step G4 — Persist extracted filing data, filing outranking exchange

Take the extractor's JSON for a filing (price band ad, RHP) and write every field whose
arithmetic check passed into the right table: `ipos` scalars through the single write door
(source DRHP, so the matrix, provenance and conflict rows apply), `ipo_details` (timetable,
category split, fresh/OFS amounts, UPI cut-off, compliance officer), `financial_statements`
(one row per fiscal year), `ipo_valuation`, `promoters`, `ipo_intermediaries`,
`brlm_track_record`, `peer_companies`, `financial_data`. A second filing merges into existing
rows without erasing the first one's columns.

*What DEEPA produced:* issue size became the ad total (Rs 459.72 crore, fresh 250 + offer for
sale 209.72) and outranked the exchanges' 327.81 crore with a CRITICAL conflict row; face value
2 outranked NSE's fabricated 10; three financial-year rows with the true revenue, EBITDA, PAT,
net worth, EPS and operating cash flow; valuation, 3 promoters, 3 intermediaries, BRLM track
record, 5 peers. Skipped with reason: unpriced fields, DSCR, rent, objects (not in the ad).

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** (built in this walk, Tier A review),
not deployed. The `scraper_source` enum has no RHP or PRICE_BAND_AD value, so both write as
DRHP with the document identity kept in `field_sources.dataLineage`. Anchor investors and
risk factors are not persisted yet (W-51).

*Where:* `scraper/src/services/filing-persister.ts`; CLI `scraper/scripts/persist-filing.ts
--ipo <id> --doc-type PRICE_BAND_AD|RHP --json <extractor output> --apply`;
`scraper/src/config/field-priority-matrix.ts` (DRHP added for issueSize, faceValue, and last
for allotmentDate, listingDate).

### Step G5 — Write the 18 new inventory columns

*What DEEPA produced:* nothing — blocked on an unapproved schema migration
(`docs/reviews/price-band-ad-field-inventory.md` §"Schema changes").

*Status:* **BLOCKED** on owner sign-off.

### Step H1 — Subscription snapshot

*What DEEPA produced:* NSE's consolidated figure (3.61x) was correctly written; BSE's own-book
figure (1.23x) was correctly **suppressed** by an existing guard, because writing it would have
reduced the visible total without a share-count-backed payload behind it. No `scope` column
exists to label which reading is which. The stored timestamp is the write time, not the payload's
own observation time (a reading NSE stamped 18:02 IST was stored as 20:39 IST).

*Status:* **LIVE in prod**, with the scope-column and timestamp gaps open.

*Where:* `scraper/src/services/data-persister.ts` (`createSubscriptionSnapshot`).

### Step H2 — GMP snapshot

*What DEEPA produced:* InvestorGain's GMP 28 (15.82%) written with its own source timestamp.

*Status:* **BUILT, not scheduled** — `ENABLE_GMP_SCHEDULED_JOB` is unset on the VPS, so this
writer never runs in prod today.

*Where:* `scraper/src/services/data-persister.ts` (`createGMPRecord`).

### Step H3 — Anchor allocation

*What DEEPA produced (before the fix):* `scrapeAnchorInvestors` looks for a DRHP-listed table of
anchor investors and gives up when it finds none — but DEEPA's real anchor data lives in the
stored `ANCHOR_ALLOCATION_REPORT` PDF, which this scraper never reads. Root cause: it queries
columns (`documentType`, `documentName`, `documentUrl`) that don't exist in the schema
(`type`, `title`, `url`) — this scraper has **never** produced an anchor row for any IPO.

*What DEEPA produced (after the fix):* a positional-column parser reading the (skewed-scan)
anchor letter, cross-checked against a hand-transcribed oracle: 15/15 investors matched to the
rupee (15 investors, 7,791,789 shares, Rs 1,379,146,653).

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — persistence into `financial_data`-style
tables is Step G4's job, not yet wired. Not deployed.

*Where:* `scraper/src/scrapers/anchor-investors-scraper.ts`; `scraper/src/scrapers/anchor-report-parser.ts`.

### Step H4 — Demand graph snapshot

*What DEEPA produced:* skipped — this walk's B2 payload didn't capture the NSE bid-demand points
needed. To be exercised on a future OPEN IPO during live market hours.

*Status:* **NOT EXERCISED** this walk; code path unverified.

### Step I1 — Stage from status + band

*What DEEPA produced:* every input combination classified correctly (OPEN/priced -> OPEN;
UPCOMING/no-band -> UPCOMING; UPCOMING/priced -> PRE_OPEN; CLOSED; LISTED).

*Status:* **BUILT**, correct; not wired into prod (`ENABLE_STAGE_RECONCILER` unset on the VPS).

*Where:* `scraper/src/scheduler/stage-reconciler.ts`.

### Step I2 — Due list per stage

*What DEEPA produced:* the OPEN-stage due list (financials, peers, objectives, DRHP, anchor,
corrigendum, demand, allotment) was correct for DEEPA. One gap: a LISTED IPO with every document
already present still lists `docDrhp` and `docCorrigendum` as due forever, because optional/
never-filed document kinds never reach a terminal state.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** in the state machine (a permanently-past-
due optional kind now resolves to `NOT_APPLICABLE` once an IPO is LISTED); the reconciler's own
due-map still needs the same fix (tracked as a spec item). Not wired into prod.

*Where:* `scraper/src/scheduler/stage-reconciler.ts`; `scraper/src/services/document-state-machine.ts`.

### Step I3 — Supersession

*What DEEPA produced:* every rule tested correctly — a PROSPECTUS supersedes the RHP and the
price-band ad; a newer corrigendum deactivates an older one; an older filing arriving later is
ignored; the same file reached via a different URL updates the URL only, not the content.

*Status:* **BUILT**, correct; not wired into prod (`ENABLE_DOCUMENT_STATE_MACHINE` unset).

*Where:* `scraper/src/services/document-state-machine.ts` (`decideSupersession`, `markSuperseded`).

### Step I4 — Withdrawn / postponed

*What DEEPA produced:* n/a for DEEPA (it didn't withdraw) — but the code path that would handle
it is dead: `ipo_status` has no `WITHDRAWN`/`POSTPONED` value in its enum, and no scraper detects
a withdrawal signal from BSE/NSE, so the branch that stops fetches and purges data on withdrawal
can never execute.

*Status:* **MISSING** (dead code path) — needs a schema enum extension + a status mapper.

*Where:* `scraper/src/services/document-cycle.ts`.

### Step I5 — Listing: price, gain, ISIN

*What DEEPA produced:* not applicable — DEEPA lists 8 Sep, after this walk.

*Status:* **NOT AVAILABLE YET** for this IPO.

### Step I6 — PDF purge at close+7d

*What DEEPA produced:* not applicable yet.

*Status:* **NOT DUE** for this IPO.

### Step J1 — Cache invalidation per slug

*What DEEPA produced:* every upsert correctly logged the expected Redis key deletions
(`ipo:id:<id>`, `ipo:slug:deepa-jewellers-ltd`) plus the field-sources/conflicts keys.

*Status:* **LIVE in prod.**

### Step J2 — Detail page renders

*What DEEPA produced:* before G4, `/ipos/deepa-jewellers-ltd` showed the wrong issue size
(327.81 crore), "TBA" for basis of allotment and "Awaiting data" for financials, peers and
promoters. After G4 the same page shows issue size 459.72 crore with the fresh/OFS split, the
full timetable to the 8 September listing, the business overview, promoter holding 48.79% to
35.45%, KPIs, the five-peer table, five documents including the DRHP, and the compliance
officer. Still "awaiting": IPODhan score, broker reviews, anchor investors.

*Status:* **LIVE** page code; the data behind it comes from steps fixed on the branch.

*Where:* `web/app/ipos/[slug]/page.tsx`. Evidence:
`docs/walks/evidence/ipo-page-deepa-before-g4-2026-09-02.png` and `...-after-g4-...png`.

### Step J3 — Admin conflict view

*What DEEPA produced (before the fix):* `/admin/conflicts` crashed client-side
(`TypeError: Cannot read properties of undefined (reading 'map')`) even though both backing APIs
returned 200 — the page read a response shape the API doesn't send (it invented `stats.byIPO`
and `stats.totalUnresolved`; the API actually returns `{total, unresolved, resolved, bySource,
bySeverity}` + `problematicFields`). The one screen an admin uses to see a CRITICAL source
disagreement was unusable.

*Status:* **FIXED on branch `docs/deepa-walk-ledger`** — page reads the real shape, has an
empty-state and a shape guard, and shows problematic-field chips. Browser-verified (2 unresolved,
1 critical, 3 warning rendered correctly). No component test yet. Not deployed.

*Where:* `web/app/admin/conflicts/page.tsx`; `web/app/api/admin/conflicts/route.ts`,
`web/app/api/admin/conflicts/stats/route.ts`.

> **Result of Phase B:** the ledger above is the DEEPA walk's real trace of every planned step —
> `docs/walks/2026-09-02-deepa-pipeline-walk.md` §1 has the full verdict table with per-step
> timing, and §2 (W-01..W-47) has every defect found, its fix, and its current status. As of this
> writing every fix listed "FIXED on branch `docs/deepa-walk-ledger`" is **tested and reviewed but
> not deployed** — nothing from this walk is live until it ships together (walk decision D-09).

---

## Phase C — Keep the data fresh, and show it to the user

### Step 12 — Re-scrape on a flat 30-minute cron (the tiered IST scheduler is built but does not run)

`scraper/src/scheduler/config.ts` defines a tiered cron anchored to **Indian market hours**
(`Asia/Kolkata`): denser during trading hours, relaxed after hours and on weekends. It does
**not** run in production — prod is a flat PM2 `cron_restart` firing `--source=all` every 30
minutes, all day, every day (`scripts/deploy-linux.sh`). The status updater
(`triggerStatusUpdate`, promoting IPOs UPCOMING → OPEN → CLOSED → LISTED) runs inside that same
one-shot `--source=all` cycle, not from the tiered scheduler.

- *Where:* `scraper/src/index.ts` (`triggerStatusUpdate`, the flat cycle that actually runs);
  `scripts/deploy-linux.sh` (`--cron-restart=*/30_*_*_*_*`); `scraper/src/scheduler/config.ts`
  (the tiered tables — built, unused in prod).
- *Planned replacement:* the flat "all sources every 30 min" cron is meant to be replaced by
  per-IPO **due-step scheduling** — rare discovery, stage-driven document checks, live numbers
  only for OPEN IPOs in market hours, closed/listed IPOs going quiet — see
  `docs/specs/per-ipo-due-step-pipeline.md` §2 (recommendation S-02 in the DEEPA walk ledger, not
  yet built).

### Step 13 — Keep the data store lean (prune transient logs)

Every full scrape run records operational rows in `scraper_logs`. Left unbounded these **dwarf
the actual IPO data** (they were ~87% of the database at 323 IPOs — ~115 MB of 132 MB) and have
previously filled the VPS disk. So after each `--source=all` run the scraper **prunes
`scraper_logs` older than 30 days** as a best-effort, non-fatal step — it keeps the database
lean and is the single biggest lever on DB size. The retention window is configurable, and the
prune never fails the scrape (it is wrapped so an error only logs `(non-fatal)` and continues).

- *Where:* `scraper/src/index.ts` (`pruneScraperLogs()`, `SCRAPER_LOG_RETENTION_DAYS = 30`,
  runs post-run after `--source=all`); follows the `non-fatal-side-effects` convention.

### Step 14 — The website reads the data directly (no internal HTTP hop)

The Next.js app's pages and services read from the database **directly through repositories** —
they never call the site's own API over HTTP. Each repository extends a base class that wraps
every read in a **cache-aside** pattern: try Redis first (with a 2-second timeout), and on a miss
or any Redis error, fall through to PostgreSQL. **A Redis outage never breaks a page** — it just
serves from the database.

- *Where:* `web/lib/services/*` (e.g. `home-ipo-service.ts` `getCachedOrFetch`);
  `web/lib/repositories/*` extending `BaseRepository.getFromCache`;
  `web/lib/cache/redis-client.ts`.

### Step 15 — Caching keys and freshness are kept in lock-step

Cache keys follow one shape (`{entity}:{operation}:{id}`) defined in one place, with TTLs
(e.g. listings 5 min, detail 15 min, GMP 10 min). Crucially, each page's **ISR revalidation
interval matches the Redis TTL of the data behind it**, so a page never claims to be fresher
than its cache.

- *Where:* `web/lib/cache/cache-keys.ts` (`CacheTTL`, key generators);
  `export const revalidate = …` in the page files (e.g. `web/app/page.tsx`).

### Step 16 — Render the page: listings and the IPO detail view

The home and listing pages (mainboard, SME, NCD, OFS, rights, history) show the IPO tables. The
detail page (`/ipos/[slug]`) fetches the IPO with its relations, guards out non-IPO offerings,
and renders header, timeline, metrics, financials, peers, objectives, documents, etc. — server-
rendered for speed and SEO. Plainly: because Step 7's document pipeline is not wired into the
live cycle, the financials/peers/objectives/documents sections render "Awaiting data" for every
IPO scraped since launch — that section of the page has real markup and no real data behind it
yet.

- *Where:* `web/app/page.tsx`, `web/app/mainboard-ipos/page.tsx`, … ,
  `web/app/ipos/[slug]/page.tsx` (the "Awaiting data" fallback for financials/peers/documents).

### Step 17 — Format every number and date for an Indian audience

All user-facing values go through shared formatters: money/ratios via the KPI formatters
(₹, "Cr", "x", "%", `N/A` for missing), and dates via the date formatter (DD MMM YYYY in **IST**,
"TBA" when unknown, plus a screen-reader-friendly long form). No component formats money or dates
by hand — so display stays consistent.

- *Where:* `web/lib/utils/kpi-formatters.ts`; `web/lib/utils/date-formatter.ts`.

### Step 18 — Make it discoverable (SEO + structured data)

Every page's metadata is built from typed factories, and each IPO emits JSON-LD
`FinancialProduct` structured data (price, availability mapped from status, valid dates) plus
breadcrumb schema — so Google can surface IPODhan's IPO pages in rich results, feeding the
lead-generation goal.

- *Where:* `web/lib/seo/metadata.ts` (metadata factories);
  `web/lib/seo/structured-data.ts` (`generateFinancialProductSchema`, breadcrumb/list schemas).

### Step 19 — Serve admin and API surfaces safely

Public API routes return a uniform `{ success, data }` envelope and never leak internals; admin
routes are wrapped with auth that fails closed and attributes every manual edit to the admin who
made it (which is what creates the Step 9 field protection). Requests carry a trace id for
end-to-end debugging.

- *Where:* `web/app/api/**`; `web/lib/middleware/admin-auth.ts`.

---

## The whole journey, at a glance

```
                    PHASE A — discover & decide
  cron fires ──> source scrapes (Cheerio/Puppeteer) ──> validate raw record
        └─> IS IT AN IPO?  (BSE IR_flag > symbol > name keywords)  ── not IPO ──> excluded
        └─> NEW or EXISTING?  (symbol / ISIN / fuzzy name / dates)

                    PHASE B — gather, reconcile, protect, store
  collect details from all sources
        └─> [PLANNED, see docs/reviews/ipo-document-lifecycle-plan.md + T-403-plan.md §8–9]
            find DRHP/RHP link (flagged off) ──> download ──> pdfplumber ──> financials/objectives/peers
            (today: financials/objectives/peers are extracted CLI-only, on demand, not in this cycle)
        └─> reconcile conflicts via field-priority matrix (ADMIN>DRHP>NSE>BSE>…)
        └─> respect human-locked fields (field protection)
        └─> upsertIPO()  [single write door + Redis lock]  ──> PostgreSQL
              (ipos + financial_data + documents + peer_companies + objectives
               + time-series: subscriptions / gmp_records / ipo_demand_graph)

                    PHASE C — keep fresh & serve
  flat 30-min cron re-runs --source=all ──> data stays current
        (the tiered IST market-hours scheduler in scraper/src/scheduler/config.ts is built but unused in prod)
        └─> prune scraper_logs > 30 days (non-fatal) ──> DB stays lean
  user visits ──> page ──> service ──> repository ──> Redis (2s, fail-open) ──> Postgres
        └─> format (₹/Cr/x/%, IST dates) + SEO/JSON-LD ──> rendered IPO page
```

---

## Notes on honesty & scope

- This describes the **architecture as built**. Operational coverage of some fields (e.g. how
  many IPOs currently have full GMP or financial data) varies and is tracked separately in the
  project's issues/goals — it is not a property of the pipeline design above.
- The numbered file anchors are pointers to where each step lives; line numbers drift, so they
  are intentionally given as *files/functions* rather than exact lines.
- Strategic/portfolio decisions (why the project exists, kill/promote, commercialization) live
  under `5Wealths\` and are out of scope here — see `5W-CONTEXT.md`.
- Steps B1–J3 above are ground-truthed against a real per-IPO walk, not a design read of the
  code: `docs/walks/2026-09-02-deepa-pipeline-walk.md` (DEEPA, symbol DEEPA, walked 2026-09-02)
  found **46 defects** (W-01..W-47, W-42 never assigned) across those steps, of which **24 were
  fixed and tested** on branch `docs/deepa-walk-ledger` during the walk, leaving 22 open.
- **Nothing from that walk is deployed yet** (walk decision D-09) — every step above marked
  "FIXED on branch `docs/deepa-walk-ledger`" is tested and reviewed, not live; only steps marked
  "LIVE in prod" reflect what a user sees today.
