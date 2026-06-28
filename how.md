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

## Phase A — Discover the candidates and decide what is really an IPO

### Step 1 — A scraper run fires (one shot, then exits)

A scrape is a run-once-and-exit program. In production, PM2 re-launches it every 30 minutes via
cron (it is **not** an always-on loop — that previously caused a crash-loop). The entry point
reads a `--source` argument (`nse`, `bse`, `moneycontrol`, `chittorgarh`, `gmp`, `fallback`,
`api`, or `all`) and dispatches to the matching source orchestrator.

- *Where:* `scraper/src/index.ts` (arg parse + dispatch); `ecosystem.config.js`
  (`cron_restart: '*/30 * * * *'`, `autorestart: false`).

### Step 2 — Each source fetches its data the cheapest way that works

Every source has an orchestrator that extends one shared base class. Before fetching, the
scraper auto-detects how the page serves its data: if the data is already in the raw HTML it
parses with **Cheerio** (≈10× cheaper); only if the data is rendered by JavaScript does it
launch a real **Puppeteer** browser. If the cheap fetch can't find the data, it safely falls
back to the browser.

- *Where:* `scraper/src/base/BaseScraperOrchestrator.ts` (the `run()` template);
  `scraper/src/scrapers/*-v2.ts` (per-source); `scraper/src/utils/scraper-utils.ts`
  (`detectRenderingType` / `scrapeWithAutoDetection`).

### Step 3 — Validate the raw record (reject obvious garbage)

Each scraped record is checked against domain rules before anything else: a lot size of 1 is
rejected (a SEBI violation — never a real IPO), price-band width limits are enforced
(MAINBOARD ≤ 20%, SME ≤ 40%), and impossible dates (close before open) are rejected. Bad
records are dropped here; fixable ones are auto-corrected.

- *Where:* `scraper/src/pipelines/data-validation-pipeline.ts`;
  `scraper/src/utils/data-validation.ts`.

### Step 4 — **Decide: is this a genuine IPO, or some other money-raising event?**

This is the make-or-break classification. The system determines an `offering_type` and only
treats `IPO` records as IPOs. It uses, in order of authority:

1. **BSE's own `IR_flag`** (from BSE's JSON API) — the most authoritative signal:
   `IPO` → genuine public issue; `OTB` → buyback/**takeover/tender** (NOT an IPO);
   `DPI` → debt/NCD; `RI` → rights issue; `FPO`/`OFS` → follow-on / offer-for-sale.
2. **Symbol patterns** (e.g. `…TDR` → tender, `…BUYBACK`, `…DELISTING`).
3. **Name keywords** (e.g. "rights issue", "InvIT", "REIT").

A guard prevents *re-pollution*: once a record is correctly classified as a non-IPO, a later
generic "IPO" guess can't downgrade it back. A separate post-scrape job re-polls BSE's
authoritative board and reclassifies anything that slipped through (this is how cases like a
takeover wrongly labelled "IPO" get pushed out of IPO listings).

- *Where:* `scraper/src/utils/detect-offering-type.ts`
  (`detectOfferingTypeFromBSEIRFlag`, `resolveOfferingTypeKeepingClassification`);
  `scraper/src/scripts/reclassify-corporate-actions.ts` (post-scrape correction).

### Step 5 — Decide: is this a *new* record or an *existing* one?

Before creating a row, the scraper checks whether this IPO already exists, by descending
confidence: exact stock **symbol** match (HIGH — likely already listed), exact **ISIN** match
(HIGH), **fuzzy company-name** match (MEDIUM), and **date-range overlap** (MEDIUM). A HIGH match
routes to *update the existing record* rather than insert a duplicate. The platform also tags
each IPO's **segment** (MAINBOARD vs SME) and **status** (UPCOMING / OPEN / CLOSED / LISTED).

- *Where:* `scraper/src/services/duplicate-detection-service.ts`;
  segment/status helpers in `scraper/src/utils/detect-offering-type.ts`.

---

## Phase B — Gather every detail, reconcile it, protect it, and store it

### Step 6 — Collect the IPO's details from whichever sources have them

Different sources are good at different fields. NSE/BSE give the core issue facts; Chittorgarh
is strong on lot size and GMP; Moneycontrol gives peers; InvestorGain gives GMP; the DRHP gives
financials. Each source contributes what it knows; conflicts are resolved in Step 8.

- *Where:* the per-source orchestrators (`scraper/src/scrapers/*-v2.ts`).

### Step 7 — **Download and read the prospectus (DRHP/RHP) PDF**

For each IPO, the system locates the prospectus by searching NSE → BSE → SEBI, downloads the
PDF, and records it in the `documents` table (idempotent — it won't re-download). It then runs a
**Python + pdfplumber** extractor (as a child process) that reads through the PDF and pulls out
the numbers a human would otherwise extract by hand:

- **Financials** — revenue/profit/EBITDA across recent years, EPS, RoE, net worth, market cap,
  promoter holding → stored in `financial_data`.
- **Objects of the Offer** (use of funds) → stored as JSON on the IPO row (`ipos.objectives`).
- **Peer comparison** companies and their ratios → stored in `peer_companies` (peers also come
  from Moneycontrol by sector).

Each extraction carries a confidence score; low-confidence results are flagged for human review.
DRHP extraction is **non-blocking** — if it fails, the IPO record is still created/updated.

- *Where:* `scraper/src/services/drhp-downloader.ts` (find + download + record document),
  `scraper/src/services/drhp-orchestrator.ts` (coordinates), `scraper/src/services/drhp-extractor.ts`
  (spawns the pdfplumber Python extractor); persistence in `scraper/src/services/data-persister.ts`
  (`createFinancialData`, `updateIPOObjectives`, `createPeerCompanies`).

### Step 8 — Reconcile conflicting sources into one authoritative value (per field)

When two sources disagree on the same field, a **field-priority matrix** decides the winner —
*per field*, not per source. The base source order is:

> **ADMIN** (a human's manual edit — always wins) → **DRHP** (the regulatory document) →
> **NSE** → **BSE** → **MONEYCONTROL** → **CHITTORGARH** → **INVESTORGAIN_GMP** → **API_FALLBACK**

But it's smarter than a flat ranking: each field declares its own rules. Financials prefer DRHP;
lot size prefers BSE; **real-time fields (GMP, subscription, status) are "newest wins"** and
ignore the static DRHP. Values are normalized (currency, dates, company names) before comparison,
and every chosen value + losing value is logged for audit (`field_sources`, `data_conflicts`).

- *Where:* `scraper/src/config/field-priority-matrix.ts` (the rules);
  `scraper/src/services/data-consolidation-service.ts` (applies them).

### Step 9 — Never overwrite a human's correction (field protection)

If an admin has manually edited a field, that field is **locked**: later scrapes are filtered so
they cannot overwrite it. An entire IPO can also be locked (`scraper_locked`). Blocked write
attempts are recorded so the admin can see what the scraper *wanted* to change.

- *Where:* `packages/shared/src/admin/field-protection-checker.ts`
  (`isIPOLocked`, `filterProtectedFields`, `markFieldAsManuallyEdited`); enforced inside the
  base orchestrator so no source can skip it.

### Step 10 — Write to the database through one safe door

Every IPO write — from any scraper, script, or backfill — goes through a **single entry point**,
`upsertIPO()`. It (in order): re-checks the IPO-level lock → filters protected fields → runs the
validation pipeline → consolidates via the priority matrix → writes the result. Writes that could
race a concurrent run take a **Redis distributed lock** keyed by the IPO's slug (if Redis is
down, it logs and proceeds rather than blocking). New behaviour ships behind **feature flags**
(default off). The IPO's public URL key — its **slug** — is generated by one canonical function
so the same company never produces two different slugs (e.g. "Acme Limited" and "Acme Ltd" both
→ `acme-ltd`).

- *Where:* `scraper/src/services/data-persister.ts` (`upsertIPO` — the only write path);
  `scraper/src/utils/distributed-lock.ts`; `scraper/src/config/feature-flags.ts`;
  `packages/shared/src/utils/slug.ts` (`generateIPOSlug`).

### Step 11 — Record the moving numbers as time-series

Subscription figures, GMP, and the demand graph change constantly, so they are stored as
*append* snapshots (one row per reading), not overwrites — preserving history for charts.

- *Where:* `data-persister.ts` (`createSubscriptionSnapshot`, `createGMPRecord`,
  `createDemandGraphSnapshot`) → tables `subscriptions`, `gmp_records`, `ipo_demand_graph`.

> **Result of Phase B:** one consolidated `ipos` row plus its related `financial_data`,
> `documents`, `peer_companies`, objectives, and the time-series tables — all in PostgreSQL,
> with an audit trail of which source set each field.

---

## Phase C — Keep the data fresh, and show it to the user

### Step 12 — Re-scrape on a market-aware schedule (IST)

A scheduler runs each source on a tiered cron, anchored to **Indian market hours** (`Asia/Kolkata`):
densest during trading hours (e.g. NSE every 30 min 9:15–15:30 on weekdays, BSE every 15 min),
relaxed after hours, hourly on weekends — so live data (subscription, GMP) is captured when it
actually moves, without hammering sources overnight. A separate status-updater promotes IPOs
through UPCOMING → OPEN → CLOSED → LISTED.

- *Where:* `scraper/src/scheduler/config.ts` (the tier tables, `timezone: 'Asia/Kolkata'`);
  PM2 `cron_restart` in `ecosystem.config.js`.

### Step 13 — The website reads the data directly (no internal HTTP hop)

The Next.js app's pages and services read from the database **directly through repositories** —
they never call the site's own API over HTTP. Each repository extends a base class that wraps
every read in a **cache-aside** pattern: try Redis first (with a 2-second timeout), and on a miss
or any Redis error, fall through to PostgreSQL. **A Redis outage never breaks a page** — it just
serves from the database.

- *Where:* `web/lib/services/*` (e.g. `home-ipo-service.ts` `getCachedOrFetch`);
  `web/lib/repositories/*` extending `BaseRepository.getFromCache`;
  `web/lib/cache/redis-client.ts`.

### Step 14 — Caching keys and freshness are kept in lock-step

Cache keys follow one shape (`{entity}:{operation}:{id}`) defined in one place, with TTLs
(e.g. listings 5 min, detail 15 min, GMP 10 min). Crucially, each page's **ISR revalidation
interval matches the Redis TTL of the data behind it**, so a page never claims to be fresher
than its cache.

- *Where:* `web/lib/cache/cache-keys.ts` (`CacheTTL`, key generators);
  `export const revalidate = …` in the page files (e.g. `web/app/page.tsx`).

### Step 15 — Render the page: listings and the IPO detail view

The home and listing pages (mainboard, SME, NCD, OFS, rights, history) show the IPO tables. The
detail page (`/ipos/[slug]`) fetches the IPO with its relations, guards out non-IPO offerings,
and renders header, timeline, metrics, financials, peers, objectives, documents, etc. — server-
rendered for speed and SEO.

- *Where:* `web/app/page.tsx`, `web/app/mainboard-ipos/page.tsx`, … ,
  `web/app/ipos/[slug]/page.tsx`.

### Step 16 — Format every number and date for an Indian audience

All user-facing values go through shared formatters: money/ratios via the KPI formatters
(₹, "Cr", "x", "%", `N/A` for missing), and dates via the date formatter (DD MMM YYYY in **IST**,
"TBA" when unknown, plus a screen-reader-friendly long form). No component formats money or dates
by hand — so display stays consistent.

- *Where:* `web/lib/utils/kpi-formatters.ts`; `web/lib/utils/date-formatter.ts`.

### Step 17 — Make it discoverable (SEO + structured data)

Every page's metadata is built from typed factories, and each IPO emits JSON-LD
`FinancialProduct` structured data (price, availability mapped from status, valid dates) plus
breadcrumb schema — so Google can surface IPODhan's IPO pages in rich results, feeding the
lead-generation goal.

- *Where:* `web/lib/seo/metadata.ts` (metadata factories);
  `web/lib/seo/structured-data.ts` (`generateFinancialProductSchema`, breadcrumb/list schemas).

### Step 18 — Serve admin and API surfaces safely

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
        └─> download DRHP/RHP PDF ──> pdfplumber reads pages ──> financials/objectives/peers
        └─> reconcile conflicts via field-priority matrix (ADMIN>DRHP>NSE>BSE>…)
        └─> respect human-locked fields (field protection)
        └─> upsertIPO()  [single write door + Redis lock]  ──> PostgreSQL
              (ipos + financial_data + documents + peer_companies + objectives
               + time-series: subscriptions / gmp_records / ipo_demand_graph)

                    PHASE C — keep fresh & serve
  scheduler re-scrapes on IST market-hours tiers ──> data stays current
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
