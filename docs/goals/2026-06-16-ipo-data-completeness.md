# GOAL — IPO data completeness: every publicly-available field/table/graph correct for every IPO, proven

**Type:** Autonomous **fix + activate + backfill + BUILD + migration** master contract (run via `/goal`). Execute
end-to-end with **zero user input**. Every design decision is pre-made below — do not pause to ask; make the
call the contract specifies and keep going until the Definition of Done is fully met.

> **UPDATE 2026-06-16 (Abhay directive — "unblock ALL FOUR blocked-section groups"):** This contract no longer
> *defers* the DRHP-fed sections. The DRHP discover→download→store pipeline and a fresh financial extractor are
> **promoted to in-scope BUILDS** (Stage C3a/C3b below). All forks here are resolved by the owning engineering
> role anchored to the goal (`.claude/rules/engineering-roles.md` + `goal-anchored-decisions.md`) — the run
> DECIDES, it does not ask. Honesty still binds: a value that genuinely cannot be extracted at sane confidence
> is DEFERRED with a follow-up issue, never faked. Prod deploy / flag-enable / cron activation / destructive
> DDL remain §GATE (Abhay's).

**Owner:** Abhay · **Created:** 2026-06-16 · **Scope:** `scraper/`, `packages/shared/`, `web/`, `docs/`, `scripts/` in `D:\Abhay\VibeCoding\IPODhan` ONLY
**Invocation:** `/goal docs/goals/2026-06-16-ipo-data-completeness.md`
**Companion:** monitoring runs from a separate session — keep `docs/goals/.run/2026-06-16-ipo-data-completeness-PROGRESS.md` current.

---

## 0. Mission

The IPO detail page is an **empty shell for nearly every IPO**, and the active-IPO lists are **polluted with
corporate actions**. A live read-only audit of prod (2026-06-16, 298 IPOs) found: child tables ~0% populated
(financial_data / ipo_financials / documents / listing_performance / peer_companies / ipo_scores /
anchor_investors / ipo_reviews / ipo_demand_graph / **ipo_details = 0%**; subscriptions 1%; gmp_records 6%);
the flat denormalized `ipos` columns are also empty (gmp/subscription/listing/isin/description/rating = 0%) so
the data is **genuinely unscraped, not a UI-wiring bug**; the OPEN bucket is **13/15 non-IPOs** (9 TENDER, 2
RIGHTS, 1 NCD, 1 BUYBACK) and ~35–38 corporate actions pollute IPO lists site-wide; `listing_performance` is
**0/91 LISTED**; core columns are sparse (allotment_date 1%, registrar 28.5%, lot_size 55.7%, objectives 0%,
36 missing price band) and the price band renders collapsed (`₹174–₹174`); plus name/registrar normalization
smells (`"…Ltd. CT"`, `"KFin TechnologiesLimited"`, 3 null-segment rows).

**Done = for every GENUINE IPO (upcoming/open/closed/listed), every publicly-available field, table, and graph
is populated from a real source and renders correctly — proven by (a) an extended coverage gate
(`scripts/audit-ipo-coverage.mjs`) meeting the §7 per-domain thresholds against tunnel prod data, (b) `node`+`pg`
read-back, and (c) Playwright-MCP drive of a stratified IPO sample — with corporate actions removed from all
IPO surfaces, and with NO prod deploy, NO destructive prod DDL, and NO synthetic data.** Fixes are **root-cause
in the scraper write-path / consolidation / scheduler** and a **shared is-real-IPO predicate** — never per-IPO
data patches. The DRHP/RHP **auto-discovery→download→store pipeline** (currently stubbed) and a **fresh
financial extractor** (the external Python parser is missing from the repo) ARE in scope to build (Stage C3).
Only a value that — after the build + the failure budget — genuinely cannot be extracted at sane confidence is
**DEFERRED with a reason + follow-up issue**, never faked.

---

## 0.2 PREFLIGHT — read what is already done FIRST (idempotency · NO duplication)

**This is the first action of the run, before ANY stage. Non-negotiable.** Two prior contracts and parallel
sessions already implement part of this. This contract must be **safe to run at any time without redoing
finished work**, and must **defer to (not duplicate)** the GMP + BSE contracts.

1. **Read the state-of-record:** `memory/*.md` (esp. `gmp-coverage-root-cause.md`, `ipo-corporate-action-pollution.md`,
   `bse-json-api-enrichment.md`, `scraper-timestamp-tz-skew.md`, `deploy-requires-approval.md`,
   `vps-db-tunnel-setup.md`), plus the two prior contracts and their run ledgers:
   - `docs/goals/2026-06-14-gmp-coverage-revival.md` (+ `.run/2026-06-14-gmp-coverage-revival-PROGRESS.md`) — **owns GMP**.
   - `docs/goals/2026-06-15-bse-ipo-enrichment.md` (+ its PROGRESS) — **owns BSE core enrichment (issue_size/lot/registrar/price/lead-managers) + #16 dedup + subscription + DRHP best-effort**.
   - GitHub issues **#6** (corp-action pollution), **#7** (blank pages), **#8** (empty shell).
2. **Defer, don't duplicate.** For the GMP domain (Stage C1) and BSE-core/dedup/DRHP domains (Stages B-core, C2),
   this contract's job is to **complete and verify** those contracts' work, not re-author it: check their branches
   (`feat/gmp-coverage-revival`, `feat/bse-ipo-enrichment`) + `git log --oneline -30` + a live tunnel coverage read;
   if a task is done, **verify-only**; if partial, run **only the missing delta** (e.g. their backfills were never
   executed against prod — coverage is still 0–6% — so the delta is usually "run the backfill + prove coverage").
3. **For every task below, check code + `git log` + a tunnel DB read before building.** SKIP done work (verify-only);
   build only the delta; record every skip in the final report's "skipped (already covered)" list.
4. **Re-measure coverage** via `node scripts/audit-ipo-coverage.mjs` (the §7 gate) before Stage A and after each stage.

This makes the contract **idempotent**: a re-run after partial progress (or after a parallel GMP/BSE run) produces
only the remaining delta.

---

## 1. Context you need (read first)

**Stack / prod path:** one monorepo app — Next.js 15 web (`web/`, dev port 3000, type-gated at commit), ESM/tsx
scraper (`scraper/`, NOT commit-type-gated), shared package (`packages/shared/`, schema SSOT). DB is **prod
Postgres via the SSH tunnel at `localhost:15432`** (`web/.env.local`, discrete `DATABASE_HOST/PORT/USER/PASSWORD`
— the audit script already parses these). `psql` is NOT installed — use `node`+`pg`. Tunnel re-establish:
`ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189`. **Deploy / PM2 / cron
activation / flag-enable are GATED** (no prod deploy without Abhay).

| Thing | Path / import | Why it matters |
|---|---|---|
| **Coverage gate (measuring stick — already exists)** | `scripts/audit-ipo-coverage.mjs` | read-only per-section coverage + name/dup/pollution smells; **Stage A extends it into a thresholded gate (exit 1 on miss)** |
| Single write entry point | `scraper/src/services/data-persister.ts` `upsertIPO()` (~:199), `createGMPRecord`/`createAnchorInvestors` | ALL scraped writes here (lock → protection → validation → consolidation) — never raw Drizzle |
| Field priority matrix | `scraper/src/config/field-priority-matrix.ts` | every scraped field MUST be registered (source, normalization, validation, timeBased) |
| Feature flags | `scraper/src/config/feature-flags.ts` | gate every new behavior; activation in prod is GATED |
| Scheduler | `scraper/src/scheduler/scheduler.ts`, `scraper/src/scheduler/config.ts`, `scraper/src/scheduler/jobs/` | several writers exist but their jobs are **not registered/active** → 0% coverage |
| **List/detail IPO filter (pollution root cause)** | `web/lib/repositories/ipo-repository.ts` `findAll`/listings (~:67, ~:705); detail 404 list in `web/app/ipos/[slug]/page.tsx` `NON_IPO_CORPORATE_ACTIONS=['TENDER','BUYBACK','DELISTING']` (~:168) | list queries do NOT exclude non-IPO `offering_type`; detail list is incomplete (OFS/FPO/RIGHTS/NCD/INVITS render as fake IPOs) |
| BSE JSON-API source (IR_flag authoritative) | `scraper/src/scrapers/bse-*` (see BSE contract) | classification truth for IPO vs corporate action |
| Listing-performance writer | `scraper/src/scrapers/listing-performance-updater.ts`; job `scraper/src/scheduler/jobs/listing-performance-update.ts`; backfill `scraper/src/scripts/backfill-listing-performance.ts`; matcher `scraper/src/utils/match-ipo.ts` | EXISTS but `listing_performance`=0/91 LISTED → job dark / matcher failing / backfill never run |
| Subscription writers | NSE/BSE/Moneycontrol orchestrators + `subscriptions` write in `data-persister` | `subscriptions`=1% incl. 0/15 OPEN — live capture broken (BSE contract Stage C owns the first diagnosis) |
| Anchor job + repo | `scraper/src/jobs/anchor-investors-job.ts`, `scraper/src/repositories/anchor-investor-repository.ts` | `anchor_investors`=0% — applies to book-built mainboard only |
| Peers repo | `scraper/src/repositories/peer-company-repository.ts` | `peer_companies`=0% — DRHP/Chittorgarh-sourced |
| Demand graph | `scraper/src/scrapers/nse-api-client.ts` (demand block), `ipoDemandGraph` table | `ipo_demand_graph`=0% — NSE live demand for OPEN IPOs |
| IPO score (computed app-side) | `web/lib/services/ipo-score-service.ts`, `web/lib/repositories/ipo-score-repository.ts` | `ipo_scores`=0% — score compute/persist never triggered |
| GMP (defer to GMP contract) | `scraper/src/scrapers/investorgain-gmp-orchestrator-v2.ts` etc. | `gmp_records`=6% — Stage C1 = complete + verify the GMP contract, do NOT re-author |
| **DRHP pipeline (BUILD — Stage C3)** | discover→download→store: `scraper/src/services/drhp-downloader.ts` (`findDRHPUrl`/`searchNSE`/`searchBSE`/`searchSEBI` are **100% stubbed — all `return null`**); store via `DocumentRepository` → `documents` table; jobs that READ `documents` are ALREADY registered: `scraper/src/jobs/anchor-investors-job.ts`, `objectives-job.ts`, `peer-companies-job.ts` | C3a builds the stubbed discovery/download/store → unblocks documents + (transitively) anchor/objectives/peers via the registered jobs |
| **DRHP financials extractor (BUILD fresh — Stage C3b)** | `web/lib/services/drhp-extractor-service.ts` shells out to an **EXTERNAL `extract_drhp_pdfplumber_v2.py` that is NOT in this repo + undocumented**; schema `financial_data`/`ipo_financials` + `FinancialDataRepository.upsert()` already exist | build a fresh Node/TS PDF financial extractor (reuse the schema+repo+`extraction_logs`); **HARD output-plausibility gate** — defer un-extractable values, never fake |
| Name normalizer (dedup keystone) | `packages/shared/src/utils/company-name-normalizer.ts` (JS) ↔ `ipo-repository.ts findByNormalizedName` (SQL) | MUST stay in agreement; strip trailing status-code tokens (`" CT"`, `" P"`, `" O"`, `" N"`, trailing `" IPO"`) |
| **Duplicate / already-listed detection** | `scraper/src/services/duplicate-detection-service.ts` (`checkForDuplicates`), wired into `scraper/src/pipelines/data-validation-pipeline.ts` (on by default) | HIGH symbol/ISIN match = **company already listed** → a root cause of the corp-action / re-listing pollution; MUST block re-creation, not just filter the display (`ipo-duplicate-detection.md`) |
| Rendering detection (SPA vs static) | `scraper/src/utils/scraper-utils.ts` — `detectRenderingType` / `scrapeWithAutoDetection` | diagnose the dark/SPA writers (the BSE-detail root cause) static-first; never default to Puppeteer (`scraper-rendering-detection.md`) |
| Scraper health metrics | `scraper/src/services/scraper-metrics-tracker.ts` (+ `alerting-service.ts`) | every activated job/scraper MUST record a per-source outcome (`scraper-health-metrics.md`) |
| Field protection (admin edits) | `@ipodhan/shared/admin/field-protection-checker` (`FieldProtectionService`); web wrapper `web/lib/admin/field-protection-checker.ts` | backfills MUST respect protected fields (`data-persister` already filters them) (`admin-field-protection.md`) |
| Canonical slug | `@ipodhan/shared/utils/slug` `generateIPOSlug()` | ALL slug derivation here; never hand-roll — keeps the unique index + dedup coherent (`canonical-ipo-slug.md`) |
| **Web display SSOT** | `web/lib/utils/kpi-formatters.ts` (₹/Cr/`x`/`%`, null→`N/A`), `web/lib/utils/date-formatter.ts` (IST, `DD MMM YYYY`, null→`TBA`) | ALL Stage A/D rendering of money/ratios/dates goes through these — never inline `toLocaleString`/`Intl`/manual `₹` (`web-display-formatting.md`) |
| Schema SSOT + financial precision | `packages/shared/src/db/schema.ts` | edit ONLY here (`web/lib/db/schema.ts` is STALE legacy); any new/changed money column = `numeric(precision,scale)`, share counts = `bigint(mode:'number')` (`financial-column-precision.md`) |

**Gotchas:** CWD trap (root proxies only dev/dev:scraper/lint/build/test:unit; web tests from `web/`, scraper
tests from `scraper/` with the right tier config); compile `packages/shared` (`npx tsc`) before web/scraper
builds; the prod DB password is the known-leaked one (rotation tracked in #1) — never echo/commit it; a stray
untracked `docs/goals/.run/gmp-staleness-header.png` exists — never `git add -A`.

**Baseline coverage (2026-06-16, via tunnel — the measuring stick):** 298 rows (6 UPCOMING / 15 OPEN / 186
CLOSED / 91 LISTED). ipo_details/financial_data/ipo_financials/documents/listing_performance/peer_companies/
ipo_scores/anchor_investors/ipo_reviews/ipo_demand_graph = 0%; subscriptions 1%; gmp_records 6%. ~35–38 non-IPO
offering rows polluting lists; OPEN bucket 13/15 non-IPO.

---

## 2. STAGE A — De-pollute IPO surfaces + normalize core fields (correctness; highest leverage, fastest)

**Files:** `web/lib/repositories/ipo-repository.ts` (listings/findAll), `web/app/ipos/[slug]/page.tsx`,
`packages/shared/src/db/schema.ts` (only if a shared predicate constant is added), `packages/shared/src/utils/company-name-normalizer.ts`,
`scraper/src/services/duplicate-detection-service.ts` (scrape-time re-listing block), `web/lib/utils/kpi-formatters.ts`
+ `web/lib/utils/date-formatter.ts` (render SSOT — extend, don't inline), `scripts/audit-ipo-coverage.mjs` (extend to a gate).
**Keep untouched:** the scraper write-path internals; the PR #23 BSE `IR_flag` classification.

### Pre-made design decisions (do NOT deviate)
1. **TDD red-first** for every task (web unit tests `cd web && npx vitest`; shared util tests in shared).
2. **One shared `REAL_IPO_OFFERING_TYPES` / `isRealIPO()` predicate** (define once, e.g. in
   `packages/shared/src/utils/` or a shared config; the genuine-IPO set = `['IPO']`, plus any type Abhay's
   product treats as IPO-like — default ONLY `IPO`; everything else — `OFS/FPO/RIGHTS/NCD/INVITS/REITS/BUYBACK/
   DELISTING/TENDER/QIP/IPP/PREFERENTIAL/BONDS` — is a non-IPO). Apply it uniformly: (a) the listings/`findAll`
   default filter excludes non-IPO offering types unless an explicit `offeringType` is passed; (b) the detail
   page 404s ALL non-IPO types (replace the partial `NON_IPO_CORPORATE_ACTIONS` list with the shared predicate);
   (c) the IPO calendar/SME hub/active lists inherit the same filter. **List ↔ detail parity is the invariant.**
   (d) **Scrape-time ROOT CAUSE:** already-listed companies (e.g. WIPRO) must be caught by
   `DuplicateDetectionService.checkForDuplicates()` HIGH symbol/ISIN match and NOT created as new IPO rows —
   verify/repair that detection (via the validation pipeline, `skipDuplicateDetection:false`) so pollution stops
   at ingestion, not only at display (`ipo-duplicate-detection.md`). The display predicate is the safety net; the
   dedup service is the root-cause fix.
3. **Do NOT delete corporate-action rows** — they stay in `ipos` (tracked by `offering_type`), just excluded
   from IPO surfaces. (Deletion is a separate product decision → `TODO(5W):` if it ever arises.)
4. **Normalize core fields (root cause, general):**
   - Extend the **name normalizer** to strip trailing status-code tokens so `"…Ltd. CT"`, `"…Ltd. P"`,
     `"…Ltd. O"`, trailing `" IPO"` collapse; keep JS↔SQL agreement (add the ≥30-name agreement test). After a name
     change, the row's `slug` MUST be re-derived via `generateIPOSlug()` (never hand-rolled) so the unique index +
     dedup stay coherent (`canonical-ipo-slug.md`).
   - **Registrar normalization:** fix missing-space/casing (`"KFin TechnologiesLimited"` → canonical
     `"KFin Technologies Limited"`) at the consolidation/normalization layer, not per-row.
   - **Collapsed price band:** where only one bound exists or `min==max`, the band must RENDER as a single value
     (`₹174`), not `₹174–₹174`. Fix in the **`kpi-formatters.ts` SSOT** (extend a `formatPriceBand` there — never
     inline `₹`/`toLocaleString` in the component, per `web-display-formatting.md`), and stop mirroring
     `price_range_min:=max` in the writer where the source gives only one bound (store the real bound, render single).
     Price/band/issue-size columns stay `numeric()` typed (`financial-column-precision.md`).
   - **Null-segment real IPOs:** backfill `segment` for genuine IPO rows from the source; the 3 current null-segment
     rows are NCD/Trust (non-IPO) → excluded by the predicate, no segment backfill needed (verify).
5. **Extend `scripts/audit-ipo-coverage.mjs` into the §7 thresholded gate** (`--gate` flag → exit 1 on any
   threshold miss; thresholds measured against the *applicable* population per §7). This is the machine-checkable DoD.

### Stage A acceptance (run the §6 gate sweep before committing)
- **Zero corporate actions on any IPO surface:** no non-IPO `offering_type` appears in listings/calendar/SME hub;
  every non-IPO detail URL 404s; list↔detail parity proven (drive 3 corp-action slugs → 404, 3 real IPO slugs → 200).
- Name/registrar normalized (no trailing status tokens; registrar canonical); normalizer JS↔SQL agreement test green; slug re-derived via `generateIPOSlug` (no orphaned/duplicate slugs).
- `DuplicateDetectionService` blocks re-creation of an already-listed company (unit test: a HIGH symbol/ISIN match → create blocked, routed to update — `ipo-duplicate-detection.md`).
- Price band renders single value when min==max/one bound (Playwright proof on the `₹174–₹174` case), via `kpi-formatters.ts`.
- `node scripts/audit-ipo-coverage.mjs --gate` runs and reports the pollution count as **0**.

---

## 3. STAGE B — Activate & fix the dark data-population writers (the core of "fill everything")

For EACH domain below: (1) **diagnose root cause** of 0% (job unregistered? matcher failing? endpoint dead/SPA?
flag off?) — `/systematic-debugging`; for a dead/SPA source use `detectRenderingType`/`scrapeWithAutoDetection`
(static-first, never default Puppeteer — `scraper-rendering-detection.md`); (2) **fix at the writer/scheduler/matcher**,
route through `upsertIPO`/the domain repo, register every field in `FIELD_PRIORITY_MATRIX`, gate new behavior behind a
feature flag, **record a per-source outcome via `ScraperMetricsTracker`** on every run (`scraper-health-metrics.md`),
respect field protection (`data-persister` filters protected fields — `admin-field-protection.md`), and type any
new money/share column `numeric()`/`bigint(mode:'number')` (`financial-column-precision.md`); (3) **run the backfill
additively against prod via the tunnel**; (4) **prove the §7 threshold** by read-back + the coverage gate. TDD
red-first per task. **Scheduler/cron/flag activation in prod is GATED** (author + leave OFF, add to §GATE).

**Files:** the writers/jobs/repos named in §1. **Keep untouched:** GMP files (Stage C1 owns), the de-pollution
predicate (Stage A owns).

### Pre-made design decisions (do NOT deviate)
1. **B1 — Listing performance (LISTED).** GROUNDED (2026-06-16): the job `listing-performance-update.ts` IS
   registered + the matcher `match-ipo.ts` works (symbol-exact → pg_trgm fallback); the dominant blocker is the
   `backfill-listing-performance.ts` was **never run**, AND **no SME listing-price source** (67/91 LISTED are
   SME; NSE `/api/public-past-issues` is mainboard-only). **Decision (Scraper/Data-Pipeline + Architect):**
   (a) RUN the existing backfill via the tunnel for the ~24 MAINBOARD LISTED now (additive); (b) BUILD a BSE SME
   listing-price path — reuse the BSE JSON-API + scrip-code lookup already in the BSE enricher
   (`scraper/src/scrapers/bse-*`) to fetch listing-day + current price for SME symbols, matched via
   `match-ipo.ts`. Register every new field in `FIELD_PRIORITY_MATRIX`. Threshold is ≥95% of LISTED; any SME row
   with no obtainable listing-day price → DEFER that row (issue), never fabricate. Source: NSE past-issues
   (mainboard) + BSE scrip-code quote (SME).
2. **B2 — Subscription (OPEN/CLOSED).** GROUNDED: NSE scrapes 0 subscriptions (no API endpoint); BSE Puppeteer
   path is fragile; the **Moneycontrol path is code-ready behind the OFF flag `ENABLE_MONEYCONTROL_SUBSCRIPTION`**
   but `moneycontrol-orchestrator-v2.ts` never calls `createSubscriptionSnapshot()`. **Decision:** (a) wire the
   Moneycontrol orchestrator to write subscriptions through `createSubscriptionSnapshot()` when the flag is on
   (code-only, autonomous — flag stays OFF in prod = §GATE); (b) complete the **BSE JSON-API subscription path**
   (`bse-api-scraper.ts` `Pubissues_GetBkbldgCatdem_ng/w`) so it flows through the orchestrator under
   `ENABLE_BSE_API`. QIB/NII/Retail/total, timestamped; real-time for OPEN, final snapshot for CLOSED. Defer to
   the BSE contract via preflight; build only the missing delta.
3. **B3 — Anchor investors.** Activate `anchor-investors-job.ts`; backfill CLOSED/LISTED **book-built mainboard**
   real IPOs whose anchor bid date has passed (anchor applies to book-built mainboard only — measure threshold
   against THAT population, not all 298).
4. **B4 — Peers.** Activate the peer scrape (`peer-company-repository.ts` + the registered `peer-companies-job.ts`,
   which reads `documents`); source from the C3a DRHP pipeline + Chittorgarh. Peers are now fed by C3a — DEFER
   only a specific IPO whose prospectus genuinely lacks a peer section (no fake peers).
5. **B5 — Demand graph (OPEN).** GROUNDED: the `ipoDemandGraph` table + web read route exist, but the **write
   path is ENTIRELY ABSENT** (no parser, no persister fn, no orchestrator call, no job). **Decision (BUILD):**
   (a) extract the demand block from the NSE API response in `nse-api-client.ts`; (b) validate + type the rows;
   (c) add `createDemandGraphSnapshot()` to `data-persister.ts`; (d) wire it into the NSE orchestrator for OPEN
   mainboard real IPOs; (e) register fields + add a scraper unit test (TDD red-first). Job registration in prod
   = §GATE; the code build is autonomous.
6. **B6 — IPO score.** Trigger the app-side score compute/persist (`ipo-score-service.ts`) for real IPOs with
   sufficient inputs; ensure it runs (job or on-write hook) and persists to `ipo_scores`. A score MUST be
   plausibility-bounded (0–100, sane verdict) — no absurd score ships.
7. **B7 — Core sparse fields + marginal wins** (registrar/lot_size/allotment_date/listing_date/symbol/isin/
   objectives). GROUNDED + decided: (a) **name-normalizer**: the trailing-status-token strip is ALREADY in code
   (`company-name-normalizer.ts`) but **never backfilled to prod** — run an additive backfill over the 3 smelly
   rows ("…Ltd. CT", "…Ltd. P" ×2) through the name-update path, re-deriving `slug` via `generateIPOSlug`;
   (b) **`allotment_date`/`isin`/`symbol` are MISSING from `FIELD_PRIORITY_MATRIX`** → add entries (NSE-first for
   isin/symbol, Moneycontrol for allotment_date) so consolidation stops dropping them; activate the existing but
   unregistered `nse-isin-scraper.ts`; (c) **registrar**: build a shared `normalizeRegistrar()` (collapse
   missing-space/casing: "KFin TechnologiesLimited" → "KFin Technologies Limited") and wire it as the registrar
   `normalization` at the consolidation layer (not per-row); (d) the rumored **"per-script connection bug" is a
   VERIFIED PHANTOM** — every script imports the shared `db` singleton, none creates its own connection — do NOT
   chase it. Objectives come from the C3a DRHP pipeline (no longer "best-effort DEFER"). Defer BSE core to the
   BSE contract; run its backfill if unrun.

### Stage B acceptance (per domain, run the §6 gate sweep)
- Each domain meets its §7 threshold (read-back + `--gate`), OR is logged DEFERRED with a concrete reason +
  follow-up issue. Substance-sane on the default path (G-INDEPENDENT). New jobs authored but **flags OFF** (§GATE).

---

## 4. STAGE C — Complete the deferred-domain contracts + BUILD the DRHP pipeline

1. **C1 — GMP:** via preflight, run/complete `2026-06-14-gmp-coverage-revival.md` to its AC1 (≥95% of
   InvestorGain-listed current IPOs) and VERIFY — do NOT re-author. If that contract's code is merged/active,
   verify-only; if its backfill never ran, run it additively and prove coverage.
2. **C2 — BSE core + #16 dedup:** via preflight, run/complete `2026-06-15-bse-ipo-enrichment.md` (issue_size/lot/
   registrar/price/lead-managers + dup merge) and VERIFY. Verify-only if already done.
3. **C3 — DRHP pipeline + financials (PROMOTED FROM DEFERRED TO IN-SCOPE BUILD — Abhay "unblock all 4").**
   Decision (Scraper/Data-Pipeline + Architect, goal-anchored): build it as two stages, foundation first.
   - **C3a — DRHP/RHP discover→download→store (foundation, fully autonomous, highest leverage):** Implement the
     **stubbed** `scraper/src/services/drhp-downloader.ts` search methods (`searchNSE`/`searchBSE`/`searchSEBI`,
     all currently `return null`) using the static-first detection (`scraper-rendering-detection.md`); validate
     the PDF (`%PDF` magic bytes, already coded); store via `DocumentRepository` → `documents` table with
     `type`/`exchange`/`extractionStatus`. This UNBLOCKS three sections at once: **documents** (DRHP/RHP links)
     directly, and **anchor_investors + objectives + peer_companies** transitively — their jobs
     (`anchor-investors-job.ts`, `objectives-job.ts`, `peer-companies-job.ts`) are ALREADY registered and query
     the `documents` table; once documents exist they produce rows. Verify each job actually fires + persists
     (G-PERSIST read-back). Gate new behavior behind a feature flag; record `ScraperMetricsTracker` outcomes.
   - **C3b — Financial extractor (BUILD FRESH — the external Python `extract_drhp_pdfplumber_v2.py` is NOT in the
     repo):** build a Node/TS DRHP financial extractor (PDF → revenue/profit/EBITDA/EPS/net-worth/PE/ROE per FY)
     reusing the existing `financial_data`/`ipo_financials` schema, `FinancialDataRepository.upsert()`, and the
     `extraction_logs` audit trail + confidence routing (≥90% auto, 75–89% review, <75% manual). **HARD
     output-plausibility gate (`output-plausibility-verification.md`):** no financial value persists unless it is
     domain-sane (revenue/profit in ₹cr range, PE/ROE plausible, FY-consistent) — a value the extractor cannot
     reach sane confidence on within the failure budget is **DEFERRED with a follow-up issue, NEVER fabricated.**
   - **objectives + company_description:** objectives flow from C3a (the registered `objectives-job.ts`);
     `company_description` is extracted by C3b from the DRHP overview section (currently 0% with no writer).
   - **If the full extractor proves multi-day beyond the run's budget:** ship C3a + the C3b scaffold + whatever
     financials pass the plausibility gate, and DEFER the remainder with a concrete follow-up issue — C3a's
     unblocking of documents/anchor/objectives/peers stands on its own and is the bulk of the user value.

### Stage C acceptance
- GMP + BSE-core thresholds met (or their contracts' DoD referenced as met); C3a documents pipeline built +
  unblocking anchor/objectives/peers (proven by read-back); C3b financials extracted under the plausibility gate,
  only un-extractable values DEFERRED with reason.

---

## 5. STAGE D — Render honesty + per-IPO UI verification (the user-visible proof)

**Files:** the detail-page section components (empty-state vs real-data), the price-band display, the listing
charts. **Keep untouched:** data writers (Stages B/C own them).

### Pre-made design decisions (do NOT deviate)
1. Where a section now HAS data, it MUST render the data (not an empty state) — verify each previously-blank
   section on a populated real IPO. All money/ratio/percent render via `web/lib/utils/kpi-formatters.ts` and all
   dates via `web/lib/utils/date-formatter.ts` (IST, `TBA` null fallback, paired `getAccessibleDate()` aria-label) —
   never inline `₹`/`toLocaleString`/`Intl` (`web-display-formatting.md`).
2. No fabricated/`Math.random()` data on any surface (sibling-sweep with the GMP contract's G17 honesty rule).
3. **Per-IPO UI verification (the audit-in-reverse):** drive a **stratified sample** with Playwright MCP — ≥2
   UPCOMING, ≥3 OPEN (real IPOs), ≥3 CLOSED, ≥3 LISTED, both segments — screenshot + ARIA + console; assert the
   sections that SHOULD have data now show it and values are domain-sane (G-INDEPENDENT/output-plausibility).

### Stage D acceptance
- The stratified sample renders real data in every applicable section; 0 new console errors; sample screenshots saved.

---

## 6. Verification gates (IPODhan-adapted standing rules — load-bearing, not decorative)

> **All rules in `.claude/rules/` are operative for this run.** G-UI, G-PERSIST, and G-INDEPENDENT are **MANDATORY
> at every task AND every stage boundary** (a standing Abhay mandate). Do not skip, soften, or defer them. They are
> why this contract yields *proven-working*, not *claimed-working*, output.
>
> **Synthesized IPODhan-specific rules that bind this run (load transitively):** `ipo-duplicate-detection.md`,
> `canonical-ipo-slug.md`, `financial-column-precision.md`, `web-display-formatting.md`, `scraper-rendering-detection.md`,
> `scraper-health-metrics.md`, `admin-field-protection.md`, `agent-orchestration.md` (any subagent dispatch — e.g. a
> G-INDEPENDENT blind verifier — is single-level from this T0 run; workers cannot sub-dispatch).

**Static gates (per stage, from the right CWD):**
- root: `npm run lint && npm run build` · `cd packages/shared && npx tsc && test -f dist/db/schema.d.ts`
- `cd scraper && npx vitest run tests/unit/...` · `cd web && npx vitest run tests/unit`

**G-UI — drive the running app** (`supervisor-verification.md`; Stages A & D + any UI change). Self-heal: if the
dev server is down, start `npm run dev` once in the background (capture PID), wait for port 3000, then Playwright MCP:
`browser_navigate` → `browser_take_screenshot` → `browser_snapshot` (ARIA) → `browser_console_messages`. **Pass = all
three:** intended value visible; present in ARIA; no NEW console errors. ≤3 iterations → `/fix-loop` →
`/systematic-debugging`. MCP unavailable after self-heal → "UI verification skipped because <reason>", mark
`completed (deferred — G-UI)`; never claim complete.

**G-PERSIST — write→persistence verification** (`e2e-persistence-verification.md`; every scraper run / backfill /
applied additive migration). Exit code / "it ran" do NOT count. Two signals: (1) the run's count/log reflects the
write; (2) **independent `node`+`pg` read-back to `localhost:15432`** confirms shape+values (the `/pg-query` skill is
the canonical read-only query path). Verify **per batch** in backfill loops, then a final coverage query via the gate. ≤3 attempts → `/fix-loop`. Degrade → "persistence
verification skipped because <reason>"; never claim complete.

**G-INDEPENDENT — post-stage independent + substance verification (ALWAYS fires)** (`independent-test-verification.md`
+ `supervisor-verification.md` + `output-plausibility-verification.md`). After a stage is otherwise green, re-verify
with FRESH eyes: **reproduce the gate** (re-run the exact lint/test/`audit-ipo-coverage --gate` command — never trust
a reported exit code) AND **inspect substance** (values domain-sane on the DEFAULT path: issue_size in ₹cr range,
lot_size plausible, GMP within −50%…+200%, score 0–100, listing gain plausible). **Sibling-sweep the whole IPO class**,
not one row. 3 reconcile cycles → `/systematic-debugging`; unresolved → log DEFERRED, proceed with state noted.

**Behavioral rules (`.claude/rules/claude-behavior.md`):** 15 (test failures → skills, no ad-hoc retry), 17 (root
cause over patch), 20 (epistemic honesty — no fake data; surface `**Assumption:**`/`**Unverified:**`), 23 (standing
directive — keep going through the full DoD; context-budget anxiety is NOT a stop).

**Failure-recovery budget:** per-task ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`) → DEFER the
task + continue, do not halt. MCP hang: 3 cycles (wait+retry → `browser_close`+re-navigate → kill+restart dev server)
→ DEFER. Tunnel drop → re-establish (§1 ssh). **Hard-halt ONLY:** `npm install` failure; a contradiction inside THIS
contract; an irrecoverable build break after the full budget; OS permission denial; a missing credential / dead
tunnel that won't re-establish. Context-budget anxiety is NOT a halt — hand off via a one-line continuation note in
the PROGRESS file, never fake-complete.

---

## 7. Definition of Done (all MUST be true) — thresholds measured against the APPLICABLE population

> "Applicable population" = the genuine IPOs for which the data is publicly available (e.g. anchor only applies to
> book-built mainboard; listing perf only to LISTED; subscription only to OPEN/CLOSED real IPOs). The extended
> `scripts/audit-ipo-coverage.mjs --gate` computes each ratio and **exits 1 on any miss** — it is the machine gate.

**Correctness / de-pollution (Stage A):**
- [ ] 0 corporate actions on any IPO surface (listings/calendar/SME hub/detail); list↔detail parity (non-IPO → 404, real → 200); shared `isRealIPO()` predicate applied uniformly.
- [ ] Name normalizer strips trailing status tokens (JS↔SQL agreement test green); registrar canonicalized; price band renders single value when min==max/one bound.

**Coverage thresholds (Stages B/C), each proven by `--gate` + read-back:**
- [ ] **listing_performance ≥95% of LISTED** real IPOs.
- [ ] **subscriptions ≥95% of OPEN/CLOSED** real IPOs that have a symbol (real-time for OPEN).
- [ ] **gmp_records ≥95% of InvestorGain-listed current** IPOs (GMP contract AC1).
- [ ] **core fields:** registrar ≥90%, lot_size ≥95%, allotment_date ≥90% (CLOSED/LISTED), listing_date 100% (LISTED), symbol ≥90% (LISTED), issue_size>0 (BSE contract) — across real IPOs.
- [ ] **anchor_investors ≥90% of book-built mainboard** real IPOs past anchor date; **ipo_scores ≥95%** of real IPOs with sufficient inputs; **ipo_demand_graph** present for OPEN mainboard real IPOs.
- [ ] **documents (DRHP/RHP)** populated via the C3a discover→download→store pipeline for genuine IPOs with a
  published prospectus; **anchor_investors / objectives / peer_companies** then produced by their already-registered
  jobs reading `documents` (proven by read-back).
- [ ] **financial_data / ipo_financials / company_description:** extracted by the C3b fresh extractor, every
  persisted value passing the output-plausibility gate; values the extractor cannot reach sane confidence on are
  DEFERRED with reason + follow-up issue (NO fake data).

**Render proof (Stage D):**
- [ ] Stratified UI sample (≥2 UPCOMING, ≥3 OPEN, ≥3 CLOSED, ≥3 LISTED, both segments) renders real data in every applicable section; values domain-sane; 0 new console errors; screenshots saved under `docs/goals/.run/`.

**Static gates:**
- [ ] `npm run lint && npm run build` pass; `packages/shared` compiles (`dist/db/schema.d.ts`); scraper + web unit tests green; `test-results/*.json` emitted.

**Verification gates (per stage):**
- [ ] G-PERSIST dual-signal on every write/backfill/applied-migration; G-UI three-signal on Stage A & D surfaces; G-INDEPENDENT post-stage sweep (gate reproduced + substance plausibility + sibling-swept).

**Ship:**
- [ ] Conventional commits pushed to `feat/ipo-data-completeness`; **draft PR open, NOT merged**.
- [ ] §GATE list populated; deferrals logged in `docs/goals/.run/2026-06-16-ipo-data-completeness-DEFERRED.md` with rule status + reason.

**§GATE — needs Abhay (run STOPS at these, authors the artifact, logs, continues):**
- [ ] Enable each new scheduler/cron job flag (listing-perf, subscription, anchor, peers, demand, GMP, score) + deploy/PM2 to activate.
- [ ] Apply any authored-but-unapplied (destructive) migrations to prod. · [ ] Merge the draft PR to `main`.

---

## 8. Final report (required on completion)

Commit SHAs + per-stage gate results; the coverage table **before/after** per domain (matched / applicable %) from
`scripts/audit-ipo-coverage.mjs --gate`, incl. the verbatim pollution count and any unmatched-names list; G-PERSIST
read-back values per backfill; G-UI verdict + screenshot paths for the Stage D stratified sample; G-INDEPENDENT
result; the §GATE list (flags/migrations/deploy/merge) awaiting Abhay; the "skipped (already covered)" list from §0.2;
DoD green/amber/red tally; DEFERRED entries (DRHP financials etc.) with rule status + reason + follow-up issue links.

---

## 9. Guardrails (hard stops)

- **IPODhan repo only** (`scraper/`, `packages/shared/`, `web/`, `docs/`, `scripts/`). NEVER write
  `D:\Abhay\VibeCoding\5Wealths\`; surface strategic items (e.g. "should we list OFS/FPO at all?") as `TODO(5W):` notes only.
- **No prod deploy / no PM2 / no `deploy.yml` / no remote restart / no flag-enable in prod.** All activation is GATED.
- **Prod DB = additive/corrective via tunnel only** (backfill rows; `ADD COLUMN`/`CREATE INDEX IF NOT EXISTS` allowed).
  MUST NOT apply `DROP`/`ALTER … TYPE`/destructive `UNIQUE` to prod — author the migration, leave UNAPPLIED, add to §GATE.
- **Never merge / never push `main`.** Feature branch `feat/ipo-data-completeness` + draft PR only. Stage files by
  name — NEVER `git add -A` (stray untracked `gmp-staleness-header.png`). Co-author trailer.
- **General root-cause fix, NEVER per-IPO patching.** Every fix is in the writer/scheduler/matcher/consolidation or a
  shared predicate; prove on the IPO class, not a single row.
- **Schema SSOT = `packages/shared/src/db/schema.ts` only** (never `web/lib/db/schema.ts`). All scraped writes via
  `data-persister`; every field in `FIELD_PRIORITY_MATRIX`; new behavior flag-gated; racy writes take the Redis lock.
- **No new dependencies** unless this contract authorizes one. **No design reinvention** — reuse the existing
  writers/jobs/repos/components; defer to (don't duplicate) the GMP + BSE contracts.
- **Honesty:** no synthetic/fake data — fill from a real source or leave blank + DEFER with reason. Root cause, not
  band-aid. The prod DB password is the known-leaked one (rotation #1) — never echo/commit it.
- **Stop only on a true blocker** (§6 hard-halt list) or a §GATE item. Context-budget anxiety is NOT a blocker — hand
  off via the PROGRESS file, never fake-complete.

---

## Authorization trail

| # | Decision | Choice |
|---|---|---|
| 1 | Contract shape | **ONE comprehensive, preflight-idempotent master**; completes + verifies (does not duplicate) the GMP + BSE contracts; adds the uncovered classes |
| 2 | Audit role (this session) | characterize issue-CLASSES via live DB coverage + stratified UI drive (done 2026-06-16) → this contract |
| 3 | Source of truth per field | the existing `FIELD_PRIORITY_MATRIX` order (NSE > BSE > Moneycontrol > Chittorgarh > InvestorGain_GMP), BSE `IR_flag` for IPO-vs-corp-action, DRHP/SEBI for financials/objectives/docs |
| 4 | Prod path | additive/corrective via the `localhost:15432` tunnel; deploy / cron / flag-enable / destructive DDL **GATED** |
| 5 | DoD model | per-domain coverage thresholds against the **applicable** population, machine-checked by `scripts/audit-ipo-coverage.mjs --gate`; UI proven on a stratified sample |
| 6 | Corporate-action pollution | shared `isRealIPO()` predicate applied uniformly (list ↔ detail parity); rows **excluded, not deleted** |
| 7 | Known-hard data (DRHP financials/objectives/docs/peers) | ~~best-effort, then DEFER~~ **SUPERSEDED by row 12 (2026-06-16): promoted to in-scope BUILD (C3a/C3b).** Only a value un-extractable at sane confidence after the build is DEFERRED with reason + follow-up issue — never faked |
| 8 | Git policy | `feat/ipo-data-completeness` + draft PR; NEVER merge/push main |
| 9 | Verification model | IPODhan named rules (supervisor- / independent- / e2e-persistence / output-plausibility) MANDATORY per task + stage |
| 10 | Post-synthesis rule alignment (2026-06-16) | bind the 8 synthesized IPODhan rules: pollution root cause via `DuplicateDetectionService` (not only display filter); slugs via `generateIPOSlug`; money/share columns `numeric()`/`bigint`; render via `kpi-formatters.ts`/`date-formatter.ts`; dark-writer diagnosis via `detectRenderingType`; per-source `ScraperMetricsTracker`; backfills respect `FieldProtectionService`; subagent dispatch single-level (`agent-orchestration.md`) |
| 11 | Update channel | contract authored/updated via the `goal-creator` skill (not ad-hoc edits); in-place edit permitted — contract not yet run/running |
| 12 | Unblock-all-4 update (2026-06-16) | Abhay directive "unblock ALL FOUR" overrides the prior DRHP defer. DRHP promoted to in-scope BUILD: **C3a** discover→download→store (`drhp-downloader.ts` stubs → `documents`, unblocking anchor/objectives/peers via their registered jobs) + **C3b** fresh Node/TS financial extractor (external Python missing) under a hard output-plausibility gate. B1 = run mainboard backfill + build BSE-SME listing-price path. B2 = wire Moneycontrol (flag-gated) + BSE-API subscription. B5 = build the absent NSE demand write path. Marginal = name-normalizer backfill + add allotment_date/isin/symbol to FIELD_PRIORITY_MATRIX + `normalizeRegistrar()`; "per-script connection bug" = verified phantom. Forks resolved by the owning role anchored to the goal (`engineering-roles.md` + `goal-anchored-decisions.md`, ported from firekaro-planner 2026-06-16); honesty preserved (defer-not-fake); deploy/flag/cron/DDL stay §GATE |

---

## References (loaded transitively)

- `.claude/rules/claude-behavior.md` — rules 15, 17, 20, 23
- `.claude/rules/engineering-roles.md` + `goal-anchored-decisions.md` — the run RESOLVES every fork by adopting the owning role anchored to the goal (decide, don't ask); `decision-authority.md` governs escalate-vs-decide
- `.claude/rules/supervisor-verification.md` · `independent-test-verification.md` · `e2e-persistence-verification.md` · `output-plausibility-verification.md` · `e2e-readiness-signal.md` — the G-UI / G-PERSIST / G-INDEPENDENT gates
- `.claude/rules/dod-verbs.md` — load-bearing DoD verbs · `.claude/rules/tdd-rule.md` — red-green-refactor
- `.claude/rules/scraper-write-path.md` · `scraper-test-layout.md` · `schema-imports.md` · `shared-package-build.md` · `structured-logging.md`
- `.claude/rules/web-data-access.md` · `web-api-routes.md` · `react-nextjs.md` · `bug-triage-discipline.md`
- **Synthesized IPODhan-specific rules (post-2026-06-16, bind this run):** `.claude/rules/ipo-duplicate-detection.md` (DuplicateDetectionService) · `canonical-ipo-slug.md` (`generateIPOSlug` SSOT) · `financial-column-precision.md` (`numeric()`/`bigint`) · `web-display-formatting.md` (`kpi-formatters.ts` + `date-formatter.ts` SSOT) · `scraper-rendering-detection.md` (`detectRenderingType`/`scrapeWithAutoDetection`) · `scraper-health-metrics.md` (`ScraperMetricsTracker`) · `admin-field-protection.md` (`FieldProtectionService`) · `agent-orchestration.md` (single-level dispatch)
- Prior contracts (defer, don't duplicate): `docs/goals/2026-06-14-gmp-coverage-revival.md` · `docs/goals/2026-06-15-bse-ipo-enrichment.md`
- GitHub issues: **#6** (pollution), **#7** (blank pages), **#8** (empty shell)
- Skills the run drives: `/fix-loop` · `/systematic-debugging` · `/auto-verify` · `/backfill-script` · `/playwright` · `/tdd` · `/pg-query` (canonical read-only DB query for G-PERSIST)
