# IPO document sourcing — decision matrix for every stage, type and failure

Owner rule (2026-08-28 00:22 IST): **BSE or NSE first, always.** Third-party sites (Chittorgarh, InvestorGain, IPO Watch…) do not host filings — they link to the exchanges. Use them only to *verify* that the exchange link we picked is the right one, never as the document source. Fall back to other hosts only when both exchanges genuinely fail.

Everything below marked **[verified]** was tested live on 2026-08-28 00:30–00:45 IST from this PC and from the production VPS (72.61.240.224).

## 0. What each host actually does (measured, not assumed)

| Host | What it gives | PC | VPS | Notes |
|---|---|---|---|---|
| `api.bseindia.com …/IPO_HomePageDetail/w` | Board of live/forthcoming issues (IPO_NO, dates, status L/F, type: Book Building / Takeover / Buyback / Debt / RI) | 200 | 200 | **[verified]** Mainboard only — SME issues are NOT on it |
| `api.bseindia.com …/GetMkt_ISSUE_BBS_IPO/w?IPO_NO=` | Core fields + links: RHP (`Prospectus_GID`), Corrigendum, Addendum (zip), Price Band Ad, Anchor_Details, band, lot, FV, tick, timings, UPI cut-off, BRLM + **all** co-BRLMs, registrar, sponsor banks | 200 | 200 | **[verified]** best machine source for mainboard |
| `listing.bseindia.com/Download/...pdf`, `www.bseindia.com/downloads/ipo/*.zip` | The PDFs/zips themselves | 200 | 200 | **[verified]** |
| `www.nseindia.com/api/ipo-detail?symbol=X&series=EQ\|SME` | `issueInfo.dataList` with titled rows incl. **direct archive links**: RHP zip, Ratios/Basis, Bidding centers, Forms, Security params pre/post-anchor, Anchor allocation report; band, lot, all BRLMs, registrar; works for SME with `series=SME` | 200 | 200 (0.5–4.7 s; 15 s+ stalls seen on 25–26 Aug) | **[verified]** intermittent; homepage gave 403 at the same minute the API gave 200 |
| `nsearchives.nseindia.com/content/ipo/*.zip` | The documents (RHP_SKYWAYS.zip = 23 MB, PDF inside) | 200 | 200 | **[verified]** never blocked in any probe; this is where NSE documents live |
| `www.nseindia.com/api/ipo-current-issue` | Live issues with `issueStartDate`/`issueEndDate` as `DD-Mon-YYYY` strings | 200 | 200 | **[verified]** raw dates are correct (Annu 25→28); our parser shifts them (see §5) |
| `www.sebi.gov.in …sid=3&ssid=15&smid=11` (Public Issues → RHP) | Every current RHP + Abridged Prospectus, **mainboard and SME** | 200 | 200 | **[verified]** official regulator copy; the DRHP copy we fetched from SEBI was structurally broken (0 readable pages) — treat SEBI as fallback, not primary |
| `www.bsesme.com/PublicIssues/RHP.aspx`, `SMEIPODRHP.aspx` | BSE SME filings (HTML pages, PDFs under `bseindia.com/corporates/download/...`) | 200 | — | page exists; **not yet parsed** (Q3) |
| Company investor page (from RHP cover "website") | Full set incl. DRHP, addenda, material documents | 200 | 200 | **[verified]** only source that had everything for Skyways; unstructured, per-company layout |
| Chittorgarh / InvestorGain / IPO Watch | Links to the above + their own copy of numbers | 200 | — | **verifier only** (owner rule) |

## 1. The decision tree (one document, one IPO, one cycle)

```
want(doc_type, ipo)
 ├─ mainboard?  BSE core API by IPO_NO ──ok──> link for doc_type? ──yes──> download → sha256 → verify (§3) → store
 │                 │                              └─no (not yet filed) → mark NOT_YET, retry next cycle
 │                 └─fail (timeout/4xx/5xx/shape change) → log, go NSE
 ├─ NSE ipo-detail (series EQ|SME), retry ×3 backoff 2/4/8 s ──ok──> archive link for doc_type? ──yes──> download from nsearchives → …
 │                 │                              └─no → NOT_YET
 │                 └─fail → go SEBI
 ├─ SEBI Public-Issues listing (RHP/Abridged only) ──ok──> download → …   (DRHP: SEBI is the ONLY exchange-equivalent source)
 │                 └─fail / doc not listed → go company host
 ├─ company investor page (URL from RHP cover / DRHP cover / previous doc) ──ok──> download → …
 │                 └─fail → go verifier
 └─ third-party page: read the link they show → does it point to BSE/NSE/SEBI? 
        ├─ yes and we never tried that exact URL → try it (we had the wrong link)
        └─ no / same URL failed → mark BLOCKED_ALL, alert owner (P2), retry every cycle for 24 h then daily
```
Order for SME: NSE (Emerge) first, then BSE SME pages, then SEBI, then company host — because BSE's mainboard API does not list SME and BSE SME is HTML.

## 2. Stage × document × primary source (both IPO types)

| Stage | Document | Mainboard primary → fallbacks | SME primary → fallbacks | If not found |
|---|---|---|---|---|
| S0 DRHP filed | DRHP | **SEBI DRHP list** → company site → (BSE/NSE do not host DRHPs before RHP) | SEBI → BSE SME `SMEIPODRHP.aspx` / NSE Emerge → company | normal for months; retry weekly |
| S1 RHP filed | RHP | BSE core API `Prospectus_GID` → NSE `Red Herring Prospectus` zip → SEBI → company | NSE SME `Red Herring Prospectus` zip → BSE SME `RHP.aspx` → SEBI → company | NOT_YET until T−3; after T−2 with no RHP anywhere = P2 alert |
| S1 | Price Band Ad | BSE `Price_Band_Advertisement` → company → (NSE has none) | company → BSE SME | band still comes from BSE/NSE API fields; ad only needed for P/E & market cap |
| S1 | Ratios / Basis of issue price | NSE `Ratios / Basis of Issue Price` zip → RHP chapter | NSE SME same | fall back to extracting the RHP chapter |
| S1 | Corrigendum | BSE `Corrigendum` → company → SEBI | company → NSE addendum | none is normal |
| S2 Anchor | Anchor allocation report | NSE `Anchor Allocation Report` zip → BSE `Anchor_Details` → BRLM site | NSE SME zip → BSE SME | empty until T−1 evening; NOT_YET |
| S2 | Security params post-anchor | NSE zip | NSE SME zip | optional |
| S3 Open | Addenda | BSE `Addendum` zip → company | company | none is normal |
| S4 Closed | Basis of allotment | BSE / NSE circular → registrar site | same | T+1 evening; retry hourly |
| S4 | **Prospectus (final)** | BSE `Prospectus_GID` (link changes from RHP to Prospectus) → NSE issueInfo title "Prospectus" → SEBI → company | same | expected close…T+2; if absent at T+5 = P2 alert (Q1) |
| S5 Listed | Listing circular | NSE/BSE circulars (existing updater) | same | — |

## 3. Verify before trusting any download

1. HTTP 200 AND content-type PDF/zip AND size > 50 KB (BSE returns an HTML "Object Moved" page with 200 for wrong URLs — **[verified]**).
2. Zip → extract; must contain ≥ 1 PDF.
3. PDF text layer present (pdftotext ≥ 500 chars on the first 5 pages) — else OCR path or "scanned" flag.
4. Cover page contains the company name (fuzzy ≥ 0.85) and the expected document words ("Red Herring Prospectus" / "Prospectus" / "Draft Red Herring" / "Corrigendum" / "Addendum" / "Price Band"). **Skyways trap:** a final Prospectus cover also says "Prospectus" — classify as PROSPECTUS only when "red herring" and "draft" are absent.
5. SHA-256 dedup across sources; same hash from BSE and NSE = one row, two URLs.
6. Cross-check one hard fact against the exchange API (band or lot or issue-period) — mismatch = wrong company's file or superseded copy → discard, alert.
7. Third-party verifier (optional, cheap): Chittorgarh's RHP link host+filename matches ours → confidence +; differs → log for review, do not switch source automatically.

## 4. Failure permutations and the rule for each

| # | Situation | Rule |
|---|---|---|
| F1 | BSE API up, doc link present, download 200 | happy path |
| F2 | BSE API up, link present, download fails (403/404/HTML page) | try NSE archive copy; if that also fails, SEBI; else company; log `BSE_LINK_DEAD` with the URL for the owner |
| F3 | BSE API up, **no link yet** (field empty) | NOT_YET — it is not filed; do not fall through to third parties (they will not have it either); retry next cycle |
| F4 | BSE API down/timeout | NSE path; if NSE up, done. Neither tried again for BSE this cycle |
| F5 | BSE down **and** NSE API times out | wait 60 s, retry NSE once (stalls clear within a minute — **[verified]** 4.7 s → 0.5 s on the third call); then SEBI; then company |
| F6 | BSE down, NSE down, SEBI down, company down | BLOCKED_ALL: P2 alert with all four HTTP codes; keep exchange-API field values (band, lot, dates) which usually still arrive from the other exchange; retry every cycle 24 h, then daily |
| F7 | All up, but every link is to a **scanned** PDF (common for SME price-band ads) | OCR the 1–2 pages needed; if OCR confidence < 0.8 keep API values, flag admin |
| F8 | Document found but **wrong company** (BSE IPO_NO mismatch, NSE symbol collision) | §3 step 6 fails → discard, alert, do not store |
| F9 | Document superseded (Corrigendum, 2nd Addendum, Prospectus after RHP) | new row `sequence_number+1`, old `is_active=false`, re-extract only fields the new doc carries |
| F10 | Two exchanges give **different** documents of the same type (BSE RHP dated 11 Aug, NSE zip dated 12 Aug) | keep both rows, newest active; alert only if a cover-page fact (band, dates) differs |
| F11 | Document type mislabelled by the exchange (NSE "Security Parameters" without "(Pre Anchor)" — **[verified]** on MADHURKNIT) | classifier defaults bare "Security Parameters" to PRE_ANCHOR; test on the Madhur payload |
| F12 | IPO is **not an IPO** (BSE board lists Takeover / Buyback / Debt / RI rows — **[verified]** 9 of 20 rows) | filter on `IR_FLAG_FULL = 'Book Building'` (or Fixed Price) before creating anything; this is the corporate-action-pollution class from June |
| F13 | IPO on one exchange only (BSE-only SME, NSE-only Emerge) | try the listing exchange first; the other exchange returns nothing — that is F3, not F4 |
| F14 | Late discovery (we learn of the IPO after open) | run S0→S3 in one pass, newest filing first |
| F15 | Withdrawn / postponed | exchange status flips; stop fetches; keep docs; purge PDFs per D4 from that date |
| F16 | Prospectus never appears by T+5 | P2 alert; keep RHP+PBA values; page shows "final price not yet filed" |
| F17 | Our own parser drops data (BSE co-BRLM string truncated — **[verified]** Skyways shows 2 of 3) | fixture test on the real payload; nightly audit compares BRLM count vs BSE payload |
| F18 | Exchange changes its API shape | shape test on every cycle's first payload (required keys present); on failure switch to the other exchange and P2 alert — never silently write nulls |
| F19 | Rate limiting (429) | back off 5 min for that host only; other hosts continue |
| F20 | PDF > 100 MB or zip bomb | size cap 150 MB; skip with alert |

## 5. Live findings from this probe (must be fixed, independent of the plan)

1. **Date drift is live in prod today.** NSE raw `ipo-current-issue` says Annu 25→28 Aug and Lumino 27→31 Aug **[verified]**; prod DB has 24→27 and 26→30 (Sunday). Chittorgarh had the right dates and lost on priority. Cause: the T-327 fix (`b49f764f`) is merged but **never deployed** — its staging deploy on 26 Aug 07:12 was refused by the required-keys assert (`FATAL: required-keys assert failed — deploy refused`), the next run (`ee496299`) had `startup_failure`, and no run exists for the 27 Aug commits. Prod serves `d002d234` (25 Aug), 11 commits behind, including the issue-size fix and five API-500 fixes. The T-324 Notifier alert **did** fire (202) and was not acted on.
2. **BSE mainboard board carries non-IPO rows** (Takeover, Buyback, Debt, Rights) — the June corporate-action pollution class; the filter must be on `IR_FLAG_FULL`.
3. **NSE documents are one API call + a never-blocked archive host.** Our discovery job only fails because it gives that single call 15 s and no retry.

## 6. Scenarios I could not resolve — questions for the owner

- **Q1 — Prospectus wait limit.** How many working days after close do we wait for the final Prospectus before alerting? I assumed T+5. (Some issuers file T+1, some only before listing.)
- **Q2 — BLOCKED_ALL behaviour on the page.** When no source works for > 24 h, should the page show the fields we do have from exchange APIs with a "filings unavailable" note, or hide the sections? I assumed show + note.
- **Q3 — BSE SME depth.** BSE SME filings sit behind HTML pages (`bsesme.com/PublicIssues/RHP.aspx`), not an API. Is BSE-SME coverage required in this batch, or is NSE Emerge + SEBI + company site enough for SME until BSE SME is parsed? I assumed the latter for now.
- **Q4 — Third-party verifier list.** Owner named Chittorgarh-type sites as verifiers. Which ones are acceptable to fetch (they may block us too)? I assumed Chittorgarh only.
- **Q5 — Deploy.** Prod is 11 commits behind with live data bugs fixed on `main`. Deploying is your gate: do you want the staging env key fixed and `main` deployed before the A–F batch starts? (Recommended yes — otherwise the audit re-run will measure old code.)

## 7. Per-document state machine — never repeat finished work, always retry the exchanges first

Owner rule (2026-08-28 00:52 IST): each 30-min run must do only what is still missing. Found + read = skip. Not found = try BSE and NSE again (always, in that order), then fallbacks, until found. Every attempt is logged with success/failure.

### 7.1 State per (IPO, document type)

One row per `(ipo_id, doc_type)` in a new table `document_fetch_state` (the `documents` table only has rows for things already found, so "wanted but not found yet" has nowhere to live today):

| Column | Meaning |
|---|---|
| `state` | `WANTED` · `NOT_YET_FILED` · `FOUND` · `EXTRACTED` · `EXTRACT_FAILED` · `BLOCKED_ALL` · `SUPERSEDED` · `NOT_APPLICABLE` |
| `document_id` | FK to `documents` once found |
| `attempts` | total tries |
| `last_attempt_at`, `next_retry_at` | scheduling |
| `last_attempt` (jsonb) | `[{source:'BSE', http:200, ms:812, outcome:'no_link'}, {source:'NSE', http:0, ms:15000, outcome:'timeout'}, …]` — every source tried in that run, in order |
| `first_seen_at`, `extracted_at`, `extractor_version` | idempotency keys |
| `filing_date` | date printed on the document (supersession is by filing date, not fetch order) |

Transitions:
```
WANTED ──exchange says "not filed" (empty field, no title)──> NOT_YET_FILED   (retry next cycle; this is NOT a failure)
WANTED / NOT_YET_FILED ──link found + download verified (§3)──> FOUND          (documents row inserted, sha256)
WANTED ──every source failed (timeout/4xx/5xx/bad file)──> BLOCKED_ALL         (retry every cycle 24 h, then every 6 h; P2 alert at first entry)
FOUND ──extractor SUCCESS──> EXTRACTED                                          (extracted_at, extractor_version)
FOUND ──extractor FAILED ×3──> EXTRACT_FAILED                                   (admin flag; no more automatic retries until extractor_version changes)
EXTRACTED ──newer filing of a superseding type appears (Corrigendum/Prospectus/Addendum n+1)──> SUPERSEDED on the old row, new row WANTED→FOUND→EXTRACTED for the new doc
any ──IPO withdrawn / doc type not applicable (e.g. Price Band Ad for a fixed-price SME)──> NOT_APPLICABLE
```

### 7.2 What one 30-minute cycle does per IPO

```
for each IPO with status in (UPCOMING, OPEN, CLOSED) or LISTED within 10 days:
  due = doc types due at its stage (§2) whose state ∉ {EXTRACTED, SUPERSEDED, NOT_APPLICABLE}
  if due is empty → skip IPO entirely (zero network calls)            ← "found + read = don't touch"
  else:
    ONE exchange call covers every doc type at once:
      BSE core API (mainboard) / NSE ipo-detail (SME first) → map links to doc types
      if that call fails → the other exchange (retry ×3 backoff)      ← BSE/NSE always first, every cycle, regardless of last run
      if both fail → SEBI → company host → verifier                    (only for the types still missing)
    for each due type:
      link present → download → verify → FOUND (or BLOCKED_ALL if download fails on every host)
      link absent on both exchanges → NOT_YET_FILED
    extraction: at most ONE FOUND document per cycle across all IPOs (keeps the cycle < 60 s); newest filing first
    supersession check (cheap, uses the same exchange payload): if the RHP link changed to a Prospectus link, or an Addendum count grew → mark old EXTRACTED row SUPERSEDED, create the new WANTED row
```
Cost: an IPO whose documents are all EXTRACTED costs 0 calls. An IPO waiting for its Prospectus costs 1 BSE call per cycle. Today's job costs 1 NSE call per IPO per day with a 15 s stall and no memory of what happened.

### 7.3 Retry policy (why each number)

| State | Retry | Reason |
|---|---|---|
| NOT_YET_FILED | next cycle (30 min) | filing can appear any time; the call is one cheap API hit |
| BLOCKED_ALL | every cycle for 24 h, then every 6 h, P2 alert once at entry and once at 24 h | NSE stalls clear within minutes (measured); a day of failure means a real outage or a wrong link |
| Download failed on one host but link exists elsewhere | immediately, next host | same run |
| EXTRACT_FAILED | 3 attempts across 3 cycles, then stop until `extractor_version` bumps | a parse bug will not fix itself; retrying burns CPU and hides the bug |
| Prospectus not found | every cycle until T+3 (listing day); alert at T+3 | listing cannot happen before the Prospectus is filed with RoC (Q1) |

### 7.4 Logging — what exists today vs what the design adds

Today (verified): discovery writes **7 pino log lines** to the PM2 log file and nothing else — no `scraper_logs` row, no per-IPO record, no attempt history. The step ledger `scraper_steps` (T-340) exists in code but its migration (0033) is not in prod because the release was never deployed (§5). So the honest answer to "is the scraper logging success/failure?" is: **only as free text in a log file that rotates; nothing queryable, nothing the nightly audit reads.**

Design:
1. Every attempt writes the `last_attempt` json on the state row (source, http, ms, outcome) — queryable per IPO.
2. Every cycle writes one `scraper_steps` row per step (`primarySourceDiscovery: ok|skipped|failed`, `documentExtraction: …`) with counts in `reason` (e.g. `ipos=4 found=2 not_yet=1 blocked=1 extracted=1`).
3. `scraper_logs` gets one row per cycle for source `DOCUMENTS` with `records_processed`/`records_failed`, so the existing metrics tracker and alert thresholds cover it.
4. Nightly audit checks: any `BLOCKED_ALL` > 24 h → FAIL; any `FOUND` not extracted > 48 h → FAIL; any OPEN IPO with 0 state rows → FAIL (the job forgot the IPO); any `EXTRACT_FAILED` → WARN with the error.
5. Admin page (`/admin/documents`): the state table per IPO with the last attempt json — so you can see "BSE 200 no_link, NSE timeout, SEBI 200 found" without opening a log file.

### 7.5 Scenario walk-through (your example)

Cycle 1 (new IPO, T−5): BSE core API → RHP link present → download → FOUND. Price Band Ad link empty → NOT_YET_FILED. Anchor report → NOT_YET_FILED. Extraction: RHP → EXTRACTED (fields written).
Cycle 2: RHP state EXTRACTED → skipped. PBA + anchor still due → one BSE call. PBA link now present → FOUND → (next cycle) EXTRACTED. Anchor → NOT_YET_FILED.
Cycle N (T−1 evening): anchor link present → FOUND → EXTRACTED.
Cycle at open: nothing due except addenda check — the same BSE call; addendum count unchanged → no work.
Cycle after close: Prospectus becomes due → BSE link still "RHP" → NOT_YET_FILED; retried every cycle; at T+1 link changes → FOUND → EXTRACTED → RHP row marked SUPERSEDED for the fields the Prospectus carries; price-dependent fields rewritten at the final price.
Your failure case: cycle 1 BSE times out, NSE times out, SEBI has no listing yet, company site unknown (no RHP cover yet) → BLOCKED_ALL, P2 alert. Cycle 2: BSE first again → 200 → FOUND. No fallback host is touched because BSE answered.

## 8. Answers to the open questions (web-researched where possible)

- **Q1 — Prospectus wait limit → answered: alert at T+3.** Under SEBI's T+3 framework (mandatory since 1 Dec 2023) listing happens within 3 working days of close, and a company cannot list before the Prospectus is filed with the RoC; in practice issuers file it T+1/T+2. So: retry every cycle until listing day; if still absent on listing day, alert. Sources: [Business Standard — SEBI T+3 timeline](https://www.business-standard.com/amp/markets/ipo/market-regulator-sebi-plans-to-shorten-ipo-listing-timeline-to-three-days-123052000674_1.html), [Lawrbit — main-board IPO procedure](https://www.lawrbit.com/companies-act-procedures/initial-public-offer-on-main-board/), [s45 — mainboard listing timeline](https://s45.ai/feeds/blog/ipo-pre-open-time). No source states a statutory "within N days of close" deadline for the Prospectus itself — the T+3 listing bound is the effective one.
- **Q3 — BSE SME → answered: include it, no API needed.** `bsesme.com/PublicIssues/SMEIPODRHP.aspx` is plain HTML with `/download/<scrip>/…` links whose filenames carry the type (Draft Prospectus, Prospectus, Basis Advertisement, Addendum) — verified 00:55 IST. Parse it as the second SME source after NSE Emerge. No JSON API exists ([BSE SME public issues](https://www.bsesme.com/PublicIssues/PublicIssues.aspx?id=1)); third-party feeds ([APIDataFeed](https://www.apidatafeed.com/product/ipo)) are paid and not primary.
- **Q2 — BLOCKED_ALL on the page → decided (overridable): show the exchange-API fields with a "filings unavailable — retrying" note; never hide sections that have data.** No research can answer a UX preference; this is the option that loses the user the least.
- **Q4 — verifier sites → decided (overridable): Chittorgarh only for now.** It is the one third-party page we already scrape successfully; adding more verifiers adds more things that can block us and gains nothing until Chittorgarh proves insufficient.
- **Q5 — deploy `main` before the batch → still yours.** Recommended yes.
