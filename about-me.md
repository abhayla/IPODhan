# About Me — IPODhan

> **In one line:** IPODhan is an automated IPO information platform for Indian investors —
> it figures out which new share issues are *genuine IPOs*, gathers every detail about them
> **document-first** (the company's own DRHP/RHP prospectus and other verified filings), fills
> the remaining gaps by scraping, keeps the data fresh, and presents it cleanly and for free to
> anyone deciding whether to apply for an IPO.

**Companion document:** [`how.md`](./how.md) is the code-level trace of *how* each step below is
implemented. This file (`about-me.md`) is the **reference for the goal and the data-acquisition
method** — the steps to follow when collecting an IPO's data.

---

## 1. The goal (what this project is for)

There is no single, reliable, free place for an ordinary Indian investor to see **all** the
information needed to make an IPO decision. The data is scattered — the exchanges (NSE, BSE),
aggregator sites (Moneycontrol, Chittorgarh), grey-market trackers, and the company's own
hundreds-of-pages prospectus (DRHP/RHP). Worse, exchange "public issue" listings mix real IPOs
together with other money-raising events (rights issues, buybacks, takeovers/tender offers,
debt issues, OFS, REITs/InvITs) that look similar but are **not** IPOs.

**IPODhan's goal is to do that scattered, error-prone research automatically and correctly**, so
the user gets one trustworthy, complete, up-to-date view of every Indian IPO:

1. **Correctly identify** what is a real IPO versus some other corporate action.
2. **Collect every detail** of each IPO — primarily from the company's verified filings
   (DRHP/RHP), and the rest from exchanges and trackers.
3. **Resolve disagreements** between sources into one authoritative record (the most reliable
   source wins, per field), while never overwriting a human's manual correction.
4. **Keep it fresh** — subscription figures and GMP move during market hours; the platform
   re-scrapes on a market-aware schedule.
5. **Show it to the user** quickly, accurately formatted (₹, crores, IST dates), and
   search-engine-discoverable.

## 2. Who it serves (the primary user)

The **retail Indian investor** deciding whether to apply for an upcoming or open IPO — someone
who wants the price band, lot size, dates, subscription status, GMP, financial health, and
"should I look closer?" signals in one place without paying or hunting across five websites.

Secondary users: anyone researching past IPO listing performance, and the IPODhan admin who
curates/corrects data.

## 3. The value it creates

- **Completeness** — pulls together data that no single free source has in one place,
  including details that otherwise require reading a 300+ page prospectus PDF.
- **Correctness** — it actively filters out non-IPOs (a takeover is not an IPO) and reconciles
  conflicting numbers instead of trusting one source blindly.
- **Freshness** — live-ish subscription and GMP figures, refreshed on a market-hours schedule.
- **Trust** — human admin corrections are *protected* and never silently overwritten by a later
  scrape.
- **Free & automated** — minimal manual entry; the system fetches, computes, and infers.

## 4. Why this project exists in the bigger picture

IPODhan sits in the **Financial Wealth** pillar of the 5 Wealths portfolio as a
**lead-generation feeder**: high-quality, SEO-discoverable IPO content attracts investors, who
open demat accounts through partner brokers (Zerodha / AngelOne affiliate links), which produces
brokerage/affiliate revenue for the operating business (PIFS). The product earns its place by
*feeding* that funnel — so completeness, correctness, and search visibility are not vanity
metrics; they are the engine. (Portfolio/strategic decisions are governed separately under
`5Wealths\` — see `5W-CONTEXT.md`.)

## 5. The principles it must honour

Everything is built to be **productized** (works for any user, not hard-coded for one),
**multi-tenant-ready from day one**, **automated** (fetch/compute/infer over manual entry), and
**continuously updated** from any new signal — the four immutable principles in
`5W-PRINCIPLES.md`.

---

# 6. How IPODhan acquires an IPO's data (the sourcing strategy)

This is the method to follow when collecting all details for any IPO. It is **document-first**,
but document-first does **not** mean "documents only" — it means *use the most authoritative
source for each kind of fact, and fill what documents structurally cannot provide by scraping.*

## 6.1 The core principle — choose the source by the *class* of fact

IPO data divides into two fundamentally different classes, and the best source differs by class:

| Class | Examples | Best source | Why |
|---|---|---|---|
| **Static / authoritative** ("prospectus facts") | financials (multi-year revenue, profit, EBITDA, EPS, RoE, net worth), objects of the offer + amounts, fresh-issue vs OFS split, capital structure, promoter & pre/post holding, risk factors, peer comparison, registrar, ISIN; and from the **RHP**: final price band, lot size, dates | **The document (RHP > DRHP)** is the source of truth; exchange used for the same fields when machine-readable | The prospectus is the legally-filed, SEBI-vetted primary source. Aggregators *transcribe* it and add errors, rounding, staleness, and mislabelling. Reading it directly removes that error layer — and surfaces fields no aggregator has (our completeness edge). |
| **Dynamic / live** ("market facts") | live subscription (QIB/NII/Retail ×), the demand/bid graph, **GMP**, total applications, basis-of-allotment / allocation structure, listing-day price & gain | **Scraping only** (exchange bidding portals; registrar; grey-market trackers) | These are **generated during and after the bidding window** and appear in **no document, ever**. Scraping here is not a fallback — it is the only possible source. |

**Consequence:** "use DRHP/RHP and scrape only what's missing" is correct **for the static
class**. But ~half of what users care about most (subscription, GMP, allotment, listing) is
*structurally absent* from every document — so scraping is *primary by necessity* for the
dynamic class. Both paths are always required.

## 6.2 Verified / official document sources (where to download from)

Documents MUST be downloaded only from verified/official sources, in this order of preference:

1. **SEBI** (filings portal) — the DRHP/RHP/final prospectus as filed.
2. **NSE / BSE** (the issue's exchange pages) — RHP, addenda, anchor-investor circular, basis of
   allotment, listing circular (ISIN, symbol, lot, listing date).
3. **The company's** lead manager / merchant banker site (the prospectus is also hosted there).
4. **The registrar** (e.g. for basis of allotment, application/allotment status).

Never treat a random aggregator's re-hosted copy as the authoritative document. The system
records each downloaded document in the `documents` table and reads it with a PDF extractor.

## 6.3 Status-aware availability — what exists depends on where the IPO is in its lifecycle

What you *can* obtain depends on the IPO's **status**. The dynamic-class facts simply do not
exist yet for an early-stage IPO — so the collection target changes by status:

| Data point | UPCOMING | OPEN | CLOSED (pre-listing) | LISTED |
|---|---|---|---|---|
| Financials, objects, structure, holding, risks, peers (from DRHP) | ✅ | ✅ | ✅ | ✅ |
| Final price band, lot size, dates (from RHP / exchange) | ⚠️ DRHP draft only; final on RHP near open | ✅ | ✅ | ✅ |
| Registrar, ISIN | ✅ (ISIN may come at/after RHP) | ✅ | ✅ | ✅ |
| Anchor-investor allocation | ❌ (filed ~1 day before open) | ✅ | ✅ | ✅ |
| **Live subscription (QIB/NII/Retail ×)** | ❌ | ✅ live, accumulating | ✅ final (frozen) | ✅ final |
| **Demand / bid graph** | ❌ | ✅ live | ✅ final | ✅ final |
| **GMP** (grey market) | ⚠️ sometimes pre-open | ✅ | ✅ | ⚠️ until listing |
| **Total applications, basis of allotment / allocation structure** | ❌ | ❌ | ✅ (registrar, ~1–2 days after close) | ✅ |
| **Listing price, listing gain, listing-day performance** | ❌ | ❌ | ❌ | ✅ |

Reading rule: ✅ = available now; ⚠️ = partially/conditionally available; ❌ = does not exist yet.
**So:** an OPEN IPO yields almost all static data + live subscription/GMP but **no** allotment or
listing; a CLOSED IPO adds final subscription, applications, and the allotment/allocation
structure; a LISTED IPO adds listing price and performance.

## 6.4 The acquisition sequence (write from documents first, then enrich)

For any single IPO, follow these steps in order. The database is written **early from the
documents**, then **progressively updated** as scraping fills the status-appropriate gaps.

**Step 1 — Identify & classify.** Confirm it is a genuine IPO (BSE `IR_flag` is authoritative —
exclude takeover/buyback/rights/NCD/OFS) and determine its **segment** (MAINBOARD/SME) and
current **status** (UPCOMING/OPEN/CLOSED/LISTED). Status decides what to collect (§6.3).

**Step 2 — Download the verified documents.** From the official sources (§6.2): DRHP always;
RHP if filed; plus anchor circular / basis-of-allotment / listing circular *if the status makes
them available*. Record each in `documents`.

**Step 3 — Read the documents and extract the static facts.** Parse the DRHP/RHP (PDF) to
extract financials, objects of the offer, capital structure, promoter holding, risk factors,
peers, and — from the RHP — final price band, lot size, dates. RHP **overrides** DRHP where they
differ (the draft lacks finals).

**Step 4 — Write the database from the documents (initial record).** Create/update the IPO row
and its `financial_data`, `objectives`, `peer_companies`, `documents` from what the documents
gave. This is the authoritative static core — written *before* any scraping.

**Step 5 — Determine what is still missing, given the status.** Using §6.3, list the gaps the
documents cannot fill for this IPO's status (e.g. for an OPEN IPO: live subscription, demand,
GMP; for a CLOSED IPO: also final subscription, applications, allotment structure; for LISTED:
also listing price/gain).

**Step 6 — Scrape the gaps from the right live sources.** Exchange bidding portals for
subscription + demand; the registrar for applications + basis of allotment; grey-market trackers
for GMP (clearly labelled unofficial); the exchange for listing price/gain. Append the
time-series readings (subscription/GMP/demand are snapshots, not overwrites).

**Step 7 — Update the database with the scraped gaps.** Update the same record with the dynamic
data. Conflicts between any sources are resolved per field by the priority matrix
(**ADMIN > RHP/DRHP > NSE > BSE > MONEYCONTROL > CHITTORGARH > INVESTORGAIN_GMP > API_FALLBACK**;
real-time fields are newest-wins). Admin manual edits are protected and never overwritten. All
writes go through the single `upsertIPO()` door.

**Step 8 — Re-collect on schedule until the lifecycle completes.** Re-run the status-appropriate
collection on a market-hours cadence so live data stays current and the record advances UPCOMING
→ OPEN → CLOSED → LISTED, picking up each newly-available data point at its status.

## 6.5 In short

> **Document-first for what the prospectus authoritatively holds (write the DB from it first);
> scrape-only for the live/post-close facts that exist in no document; reconcile per field with
> the most-authoritative source winning; and let the IPO's status tell you what to collect and
> what cannot exist yet.**

---

*The code-level implementation of every step above — the exact files, services, and tables — is
in [`how.md`](./how.md). Strategic/portfolio decisions live under `5Wealths\` — see
`5W-CONTEXT.md`.*
