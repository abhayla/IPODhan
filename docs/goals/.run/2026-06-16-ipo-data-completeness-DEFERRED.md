# DEFERRED — IPO data completeness (`/goal` run, 2026-06-16)

Each entry: what's deferred, WHY, and the concrete next step. Nothing here is faked or silently dropped.

## A5 — Registrar canonicalization
**Why deferred:** far larger than the contract's single "KFin TechnologiesLimited" example. A tunnel
read of distinct registrars on genuine IPOs shows ~28 variants collapsing to ~8 real registrars:
- **KFin** ×6 spellings: `KFin TechnologiesLimited`, `Kfin Technologies Limited`, `KFin Technologies Limited`, `KFIN TECHNOLOGIES LIMITED`, `KfinTechnologies Limited`, `KFIN Technologies Limited` — plus a garbage row with embedded contact text (`"1\tKfin Technologies Limited\tM Murali Krishna\tTel.: …"`).
- **Bigshare** ×4 incl. a typo `Bigshare Servies Private Limited` and case/suffix variants.
- **Cameo / Maashitla / MAS / Purva / Integrated / MUFG Intime** each with case/spacing/suffix variants; some with embedded addresses (`"…^Subramanian Building,1,Club House Road,Chennai…"`).

**Why it's not a one-liner:** needs (1) a canonical-registrar mapping (the `registrars` reference table
is the natural home), (2) a normalizer that fixes case/spacing, collapses legal suffixes, strips
embedded address/contact junk, and fuzzy-maps variants to the canonical name, (3) wiring at the
**consolidation/normalization layer** (per contract — not per-row), (4) a corrective backfill with
mis-map review. Mis-mapping risk is real (two different registrars must not merge).

**Next step:** build `normalizeRegistrar()` (shared util) seeded from the `registrars` table; add a
registrar-quality check to `audit-ipo-coverage.mjs --gate` (count rows whose registrar ≠ a canonical
name); backfill via a tunnel script modeled on `backfill-clean-company-names.ts` (dry-run + read-back);
file as its own issue. Follow-up issue: TODO (create via `/create-github-issue`).

## A3 finding (not deferred — resolved as verify-only)
The scrape-time pollution root cause is **already guarded** by offering_type protection (PR #25/#27,
merged) + normalized-name upsert matching — NOT by the DuplicateDetectionService symbol-gate, which is
*intentionally* off in prod (`createProductionPipeline`, data-validation-pipeline.ts:281) because it
false-positived on every already-known IPO (GitHub #3). Re-enabling it as a create-gate would regress
#3. If a future "block re-creation of an already-listed company" gate is wanted, it must carry
new-vs-update context (match to an existing IPO id first; only block when it's a genuinely NEW row for
an already-listed symbol) — a separate, tested change. Not a band-aid re-enable.

## SESSION-2 corrections (2026-06-16 PM) — supersede the optimistic Stage-B notes below

### B1 — listing_performance 0%: NSE has NO listing price (root cause corrected)
**Was:** "backfill likely never run". **Truth (evidence):** NSE `/api/public-past-issues` returns 1364
records; 48/91 of our LISTED candidates match by symbol; **0 records contain `listingPrice`** — NSE
simply does not publish listing-day price on that feed. The existing `backfill-listing-performance.ts`
NSE path can therefore never create a row. **Next step:** build a real listing-PRICE source — BSE
`StockReachGraph` quote keyed by BSE scrip code (we don't store scrip codes on `ipos`; resolve via the
BSE IPO API which returns `Scrip_cd`), compute listingGain vs issue price, write via
`ListingPerformanceRepository`. SME (67/91) needs the same BSE quote path. Diagnostic committed:
`scraper/scripts/diagnose-listing-performance.ts`. Follow-up: comment on issue #36 (listing source gap).

### C3a — documents: DISCOVERY half DELIVERED (81 IPOs); BULK archive deferred
**Delivered:** Chittorgarh report-20 → 81/263 IPOs now have real prospectus PDFs (see PROGRESS). **Deferred:**
the FULL DRHP/RHP archive. BSE detail pages are SPA (static fetch dead). Chittorgarh report-20 JSON is a
"latest-N" widget (pagination ignored; only perPage 5/10 work) so it surfaces ~recent issues only. **Next
step (multi-session):** reverse-engineer Chittorgarh's full-archive endpoint (likely a POST/search or a
different report variant), OR scrape the SEBI "Draft Offer Documents filed with SEBI" registry (authoritative,
server-rendered), OR add a Puppeteer-rendered BSE-detail path. Then re-run the committed
`backfill-chittorgarh-documents.ts` (idempotent). Follow-up: file a dedicated issue.

### C3b — DRHP financial extraction: still deferred (external Python parser missing)
Documents now have URLs (extractionStatus PENDING) but the financial/objectives/peers extractor that turns a
DRHP PDF into rows is unbuilt (the external `extract_drhp_pdfplumber_v2.py` is not in the repo). Build a
fresh Node/TS PDF extractor under the hard output-plausibility gate (defer-not-fake). Multi-day.

### B6 — ipo_scores: input-starved + no compute wiring
`rating-calculator.ts` needs financials/subscriptions/peers (≈0%) and nothing computes→persists `ipo_scores`.
Deferred until inputs exist (transitively gated on C3b + subscription capture).

## Stage B — dark data-population writers (HANDED OFF)
All need a **diagnosis + backfill RUN**; scheduler/flag activation is §GATE (Abhay). Per-domain:
- **B1 listing_performance 0/91 LISTED** — writer + job + backfill (`scraper/src/scripts/backfill-listing-performance.ts`) + matcher (`scraper/src/utils/match-ipo.ts`) all EXIST. Diagnose: job dark? matcher failing? backfill never run? (`/systematic-debugging`). Then run the backfill via tunnel (like A4) and prove ≥95% via `audit --gate`. **Highest-leverage Stage B item; likely "never run".**
- **B2 subscriptions 3/52** — BSE-contract Stage C cracked live capture (`Pubissues_GetBkbldgCatdem_ng/w`); needs the flag/run. Defer to BSE contract; run its path via tunnel.
- **B3 anchor_investors 0%** — activate `anchor-investors-job.ts`; backfill book-built mainboard past anchor date.
- **B4 peer_companies 0%** — DRHP/Chittorgarh sourced; best-effort then DEFER (no fake peers).
- **B5 ipo_demand_graph 0%** — NSE live-demand (`nse-api-client.ts` demand block) for OPEN mainboard.
- **B6 ipo_scores 0%** — trigger app-side `ipo-score-service.ts` compute/persist; plausibility-bound 0–100.
- **B7 core sparse fields** (registrar 30% / lot_size 61% / allotment_date 0.8% / symbol 79% LISTED) — NSE-first + BSE-JSON-API enrichment; run the BSE current-board backfill (flag `ENABLE_BSE_API`, currently OFF).

## Stage C — deferred-domain contracts + DRHP
- **C1 GMP** — verify-only (contract CLOSED+DEPLOYED).
- **C2 BSE core** — flag `ENABLE_BSE_API` OFF; current-board backfill never run against prod. Run it (allowed via tunnel); flag-enable + deploy is §GATE.
- **C3 DRHP financials/objectives/documents** — multi-day auto-discovery pipeline (RHP `.zip` → unzip → extract → documents table). Best-effort then DEFER per contract. NO fabricated financials.

## Stage D — render honesty + per-IPO UI verification (HANDED OFF)
Stratified Playwright sample (≥2 UPCOMING/≥3 OPEN/≥3 CLOSED/≥3 LISTED, both segments) asserting populated
sections show real data — run after Stage B fills the data (verifying empty sections now would just
confirm they're empty). Stage A's de-pollution + price band were already G-UI-verified this session.

## §GATE (needs Abhay) — when Stage B/C run
- Enable each new scheduler/cron flag (listing-perf, subscription, anchor, peers, demand, score, `ENABLE_BSE_API`) + deploy/PM2.
- Apply any authored-but-unapplied destructive migrations to prod.
- Merge the draft PR to `main`.
