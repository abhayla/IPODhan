# GOAL — Foolproof IPO data pipeline: primary-document-first extraction → live-scrape → render, self-sustaining per-IPO for every IPO

**Type:** Autonomous **build + rebuild + activate + backfill + migration** master contract (run via `/goal`).
Execute end-to-end with **zero user input**. Every design decision is pre-made below — do not pause to ask;
make the call the contract specifies and keep going until the Definition of Done is fully met.

**Owner:** Abhay · **Created:** 2026-06-19 · **Scope:** `scraper/`, `packages/shared/`, `web/`, `docs/`, `scripts/` in `D:\Abhay\VibeCoding\IPODhan` ONLY
**Invocation:** `/goal docs/goals/2026-06-19-ipo-data-pipeline-foolproof.md`
**Supersedes:** `docs/goals/2026-06-16-ipo-data-completeness.md` (Stages A/B/C3a/C3b of it are largely executed — this contract carries forward only the *unfinished* items: the render gap #54/#7/#8/#58, the §GATE deploy/activation, and the source-capped tails — and reframes the whole goal around the lifecycle pipeline below). The 2026-06-16 doc stays as historical record; do NOT edit it.
**Companion:** monitoring runs from a separate session — keep `docs/goals/.run/2026-06-19-ipo-data-pipeline-foolproof-PROGRESS.md` current.

---

## 0. Mission

IPODhan must hold, and render, **every publicly-available data point for every genuine IPO** — captured in the
correct **source-priority sequence** and kept current **automatically for all IPOs, forever**. The sequence is
the real-world IPO data lifecycle (validated with the IPO-domain expert role, 2026-06-19):

1. **The company's own filings come FIRST** (primary source, not aggregators): the **DRHP** (rich company /
   financial / objects / risk / peer / promoter data, filed early — but **no price band, lot size, dates, or
   rupee issue size**), then the **RHP + any addenda/corrigenda** (filed ~2–5 days before open — adds **price
   band, lot size, dates, fresh-issue/OFS split, total issue size, registrar**), then the **anchor-allotment
   document** (separate filing ~1 day before open — anchor investors).
2. **Once the IPO is OPEN, live data comes from the web, NOT the PDFs**: subscription / demand (exchanges) and
   GMP (aggregators, **flagged unofficial**). Scraped at a **tiered cadence** so the page is fresh exactly when
   investors decide.
3. **After close**: allotment/basis (registrar) and listing date / price / gain (exchange).
4. Then it all **renders correctly** to the user, and the whole thing is **self-sustaining**: a new IPO is
   auto-discovered, and as it crosses each lifecycle stage the newly-due fields are fetched automatically.

**Done = for every GENUINE IPO, every field/table/graph that is publicly available *at that IPO's current
lifecycle stage* is captured from the highest-priority real source and renders correctly — proven by (a) a
stage-aware per-IPO completeness gate (`scripts/audit-ipo-coverage.mjs --gate`), (b) `node`+`pg` read-back via
the tunnel, and (c) a Playwright-MCP drive of a stratified IPO sample — with NO synthetic data and corporate
actions absent from all IPO surfaces.** A field is allowed to be missing ONLY if it is genuinely unpublished at
that stage, with proof logged (DEFERRED). Fixes are root-cause in the scraper write-path / discovery /
consolidation / scheduler / render layer — never per-IPO data patches. Going-forward completeness is mandatory;
historical (already-listed) backfill is best-effort. Deploy / PM2 / cron-enable / flag-enable / destructive DDL
remain §GATE (Abhay's).

---

## 0.1 OUT OF SCOPE (tracked separately — do NOT assume this goal handles them)

This contract owns the **IPO data + render** pipeline only. It explicitly does **NOT** resolve, and must not
silently claim to resolve, the following — each stays an independent issue:

- **#35 — CI red repo-wide** (CI/test infra). Reproduce gates locally; do not depend on a green CI badge. Fixing CI is a separate task.
- **#56 / #57 / #51 — web test + OOM debt** (jsdom/vitest OOM, AsyncErrorBoundary disabled, stale component tests). Out of scope; only fix a web test if Stage G changes directly break it.
- **#1 — rotate the leaked prod DB password** — Abhay's action (§GATE), not fixed here.

A stage may *touch* a file these issues mention, but closing them is not part of this Definition of Done.

---

## 0.2 PREFLIGHT — read what is already done FIRST (idempotency · NO duplication)

**This is the first action of the run, before ANY stage. Non-negotiable.** Two prior contracts and parallel
sessions already implement large parts of this. This contract must be **safe to run at any time without redoing
finished work.**

1. **Read the state-of-record:** `memory/*.md` (esp. `ipo-data-completeness-progress.md`,
   `c3b-financials-contract.md`, `b1-listing-backfill-diagnosis.md`, `gmp-coverage-root-cause.md`,
   `ipo-corporate-action-pollution.md`, `bse-json-api-enrichment.md`, `scraper-timestamp-tz-skew.md`,
   `deploy-requires-approval.md`, `vps-db-tunnel-setup.md`, `goal-session3-result-corrections.md`), the prior
   contracts (`docs/goals/2026-06-14-gmp-coverage-revival.md`, `2026-06-15-bse-ipo-enrichment.md`,
   `2026-06-16-ipo-data-completeness.md`) + their `docs/goals/.run/*-PROGRESS.md` and `*-DEFERRED.md`.
2. **Defer, don't duplicate.** GMP is owned by the GMP contract; BSE-core enrichment/dedup by the BSE contract;
   de-pollution + listing_performance (B1) + C3a docs + C3b financials/peers/objectives are already merged
   (`git log --oneline -30`: PRs #34/#39/#40/#46/#50, commits `e0cd4485`, `f8c45dc3`, `7d1baabf`). For those
   domains this contract **completes + verifies + activates**, it does NOT re-author.
3. **For every task below, check code + `git log --oneline -30` + a live tunnel DB read before building.** SKIP
   done work (verify-only); build only the delta; record every skip in the final report's "skipped (already
   covered)" list.
4. **Re-measure** via `node scripts/audit-ipo-coverage.mjs` (extended to the stage-aware gate in Stage A) before
   Stage B and after each stage.

This makes the contract **idempotent**: a re-run after partial progress (or a parallel GMP/BSE run) produces
only the remaining delta.

---

## 1. Context you need (read first)

**Stack / prod path:** one monorepo app — Next.js 15 web (`web/`, dev port 3000, type-gated at commit), ESM/tsx
scraper (`scraper/`, NOT commit-type-gated), shared package (`packages/shared/`, schema SSOT). DB is **prod
Postgres via the SSH tunnel `localhost:15432`** (`web/.env.local`, discrete `DATABASE_HOST/PORT/USER/PASSWORD`;
the audit script + C3b backfill already parse these — **the tunnel creds beat the scraper's stale direct-prod
`.env`**, set `override:true` / use a plain `pg.Client` on the tunnel). `psql` is NOT installed — use `node`+`pg`.
Tunnel re-establish: `ssh -i ~/.ssh/ipodhan_vps -N -L 15432:127.0.0.1:5432 administrator@103.118.16.189`.
**Deploy / PM2 / cron activation / flag-enable are GATED.**

| Thing | Path / import | Why it matters |
|---|---|---|
| **Coverage gate (measuring stick)** | `scripts/audit-ipo-coverage.mjs` (has `--gate`, per-section + name/dup/pollution smells) | **Stage A extends it to a STAGE-AWARE PER-IPO gate** (per IPO: lifecycle stage → due fields → missing-public fields; exit 1 on any stage-due public field missing without a logged deferral) |
| **DRHP/RHP/anchor discovery (PRIMARY source — STILL STUBBED)** | `scraper/src/services/drhp-downloader.ts` — `searchNSE`/`searchBSE`/`searchSEBI` are `return null` + `// TODO: Implement actual … search`; `findDRHPUrl` chains them | **Stage B builds the primary-source spine here.** C3a wired Chittorgarh discovery; the company's-own-filing path (SEBI/NSE/BSE incl. SME boards) is unbuilt |
| Document store + reader jobs | `DocumentRepository` → `documents` table; jobs ALREADY registered that READ `documents`: `scraper/src/jobs/anchor-investors-job.ts`, `objectives-job.ts`, `peer-companies-job.ts` | once `documents` is filled from primary sources, anchor/objectives/peers populate via these jobs |
| **Document extractors (C3b — BUILT, deterministic, NO LLM)** | `extractFinancialsFromDetailHtml` / `extractPeersFromDetailHtml` / `extractObjectivesFromDetailHtml` (Chittorgarh detail HTML); `extract_financials_pdf.py` (OSS pdfplumber sidecar, emits JSON only); `FINANCIAL_FIELD_BOUNDS` (output-plausibility) | **reuse + extend** for DRHP/RHP PDF extraction (Stage C); do NOT re-author; keep the HARD plausibility gate |
| Single write entry point | `scraper/src/services/data-persister.ts` `upsertIPO()` (~:199), `createFinancialData`/`createPeerCompanies`/`updateIPOObjectives`/`createAnchorInvestors`/`createGMPRecord` | ALL scraped writes here (lock → protection → validation → consolidation) — never raw Drizzle |
| Field priority matrix | `scraper/src/config/field-priority-matrix.ts` (`ADMIN`>`DRHP`>`NSE`>`BSE`>`MONEYCONTROL`>`CHITTORGARH`>`INVESTORGAIN_GMP`>`API_FALLBACK`) | **field-level source authority is the mechanism** — DRHP/RHP win for static company/terms fields; live scrapers win for time-based fields (`timeBased:true`); every new field registered here |
| Feature flags | `scraper/src/config/feature-flags.ts` | gate every new behavior; prod activation is GATED |
| Scheduler | `scraper/src/scheduler/scheduler.ts`, `scraper/src/scheduler/config.ts`, `scraper/src/scheduler/jobs/` | self-sustaining cadence + stage-transition triggers live here; activation GATED |
| List/detail IPO filter (pollution) | `web/lib/repositories/ipo-repository.ts` `findAll`/listings; detail page `web/app/ipos/[slug]/page.tsx`; shared `isRealIPO()` predicate (Stage A of #46) | de-pollution is merged — VERIFY parity holds; #6 (long-listed misclassified) may have residue |
| Duplicate / already-listed detection | `scraper/src/services/duplicate-detection-service.ts` (`checkForDuplicates`) in `data-validation-pipeline.ts` | HIGH symbol/ISIN match = already listed → block re-creation at ingestion (root cause of #6 pollution) (`ipo-duplicate-detection.md`) |
| **#54 render bug — financials don't show** | `web/components/ipo/charts/FinancialPerformanceCharts/` (`RevenueChart.tsx`, `utils.ts`, `types.ts`) + `web/app/ipos/[slug]/page.tsx` | C3b stored `total_income_fy*`; the UI reads `revenue_fy*` → "No revenue data (44%)" for ~132 IPOs. The data exists; the render layer is mis-wired |
| Blank-shell pages | `web/app/ipos/[slug]/page.tsx` (#8), six list/hub pages (#7), card listing-gain (#58 — `IPOCardEnhanced`) | populated data must actually render; carry forward from old contract |
| Listing-perf + matcher | `scraper/src/scrapers/listing-performance-updater.ts`; job `scraper/src/scheduler/jobs/listing-performance-update.ts`; backfill `scraper/src/scripts/backfill-listing-performance.ts`; `scraper/src/utils/match-ipo.ts` | B1 merged (mainboard 0→96.7%); SME listing-price source still a gap (#36) |
| BSE JSON API (SME quotes, IR_flag) | `scraper/src/scrapers/bse-*` (`api.bseindia.com/.../IPO_HomePageDetail/w` + scrip-code) | SME listing-price + classification truth |
| Subscription writers | NSE/BSE/Moneycontrol orchestrators; `ENABLE_MONEYCONTROL_SUBSCRIPTION` flag (code-ready) | live subscription for OPEN/CLOSED |
| Demand graph | `scraper/src/scrapers/nse-api-client.ts` (demand block) → `ipoDemandGraph` | NSE live demand for OPEN mainboard |
| IPO score (app-side) | `web/lib/services/ipo-score-service.ts`, `web/lib/repositories/ipo-score-repository.ts` | computed score persist/trigger |
| Render SSOT | `web/lib/utils/kpi-formatters.ts` (₹/Cr/`x`/`%`, null→`N/A`), `web/lib/utils/date-formatter.ts` (IST, `DD MMM YYYY`, null→`TBA`) | ALL money/ratio/date render via these — never inline (`web-display-formatting.md`) |
| Schema SSOT + precision | `packages/shared/src/db/schema.ts` only | money = `numeric(p,s)`, share counts = `bigint(mode:'number')` (`financial-column-precision.md`); `web/lib/db/schema.ts` is STALE |
| Health metrics | `scraper/src/services/scraper-metrics-tracker.ts` (+ `alerting-service.ts`) | every activated job records a per-source outcome (`scraper-health-metrics.md`) |
| Rendering detection | `scraper/src/utils/scraper-utils.ts` `detectRenderingType`/`scrapeWithAutoDetection` | static-first; never default Puppeteer (`scraper-rendering-detection.md`) |

**Gotchas:** CWD trap (root proxies only dev/dev:scraper/lint/build/test:unit; web tests from `web/`, scraper
tests from `scraper/` per tier config); compile `packages/shared` (`cd packages/shared && npx tsc`) before
web/scraper builds; prod DB password is the known-leaked one (rotation #1) — never echo/commit; a stray untracked
`docs/goals/.run/gmp-staleness-header.png` exists — never `git add -A`. CI is currently red repo-wide (#35) —
do NOT trust a green-looking CI badge; reproduce gates locally.

---

## 1.5 DEEP-RESEARCH COURSE CORRECTIONS (2026-06-19) — these OVERRIDE the stage text below where they conflict

A 9-agent deep-research pass live-probed every source (observed HTTP 200s + real PDF downloads, adversarially
verified) and read-back prod via the tunnel. The findings below are AUTHORITATIVE and take precedence over any
conflicting wording in the stages. Apply them.

**C-1 — Source feasibility (rewrites Stage B's "DRHP-first spine"):**
- **NSE (YES, mainboard + SME):** `GET /api/all-upcoming-issues?category=ipo` + `/api/ipo-current-issue` → per symbol `GET /api/ipo-detail?symbol=<SYM>&series=<EQ|SME>` (the **`&series=SME` param is MANDATORY** for SME — omitting it returns empty `issueInfo{}`). `issueInfo.dataList` yields titled rows → deterministic `nsearchives.nseindia.com/content/ipo/{RHP|ANCHOR|RATIOS|PREANCHOR_PARAMETERS|POSTANCHOR_PARAMETERS}_<SYM>.zip` (archive host needs NO cookies). `extractAdditionalNSEFields()` (nse-api-client.ts ~:723-752) already parses these — wire `searchNSE()` to it.
- **BSE (RHP yes, DRHP no):** the `GetMkt_ISSUE_BBS_IPO/w?IPO_NO=<n>` detail row the scraper ALREADY fetches carries `Prospectus_GID` (RHP), `Price_Band_Advertisement`, `Addendum`, `Corrigendum` → `searchBSE()` reads RHP with **zero extra requests**. SME covered (`DocumentsSMEiPO`, `Security_Type=Equity`).
- **SEBI (mainboard DRHP only):** `GET HomeAction.do?doListing=yes&sid=3&ssid=15&smid=10` (10=DRHP, 11=RHP, 12=Final), server-rendered `table#sample_1`, parse the detail href → full PDF at `/sebi_data/attachdocs/<mon-yyyy>/<id>.pdf`. Page-1 daily GET is the proven cron path; **deep historical POST pagination is UNPROVEN** (treat as best-effort). `sebi-monitor.ts:75` uses the dead `otherListingAction.do` and `:186` the wrong selector (`table.table-data`; real is `table#sample_1`) — fix both.
- **CRITICAL nomenclature/coverage fact:** NSE/BSE serve the **final RHP, NOT the draft DRHP** (`DRHP_<SYM>.zip` → 404). True draft DRHP is reachable **only from SEBI, mainboard only**. **SME DRHP and BSE DRHP discovery have NO deterministic primary path → FALL BACK to the Chittorgarh aggregator (C3a/C3b), which already delivers financials/peers/objectives at ~45–54%.** Re-label the contract's "DRHP-first spine" as "RHP+anchor primary (NSE/BSE) + mainboard-DRHP (SEBI) + Chittorgarh fallback for SME-DRHP / BSE-DRHP / deep history." **Anchor source of record = NSE `ANCHOR_<SYM>.zip`** (BSE `Anchor_Details` is empty except transiently ~T-1).
- **Mechanics:** NSE/BSE docs are **`.zip` wrappers** → `validatePDFFile()` must **unzip before** the `%PDF` check. Filenames are inconsistent → **parse URLs from the row/detail HTML, never construct by template.**

**C-2 — `doc_type` already exists (fixes Stage B):** use the EXISTING `documentTypeEnum` in `packages/shared/src/db/schema.ts` (`DRHP`, `RHP`, `PROSPECTUS`, `ADDENDUM`, `ANCHOR_ALLOCATION_REPORT`, …). Do NOT "add a doc_type if absent," and there is **NO `ANCHOR` value** — use `ANCHOR_ALLOCATION_REPORT`. `documents.type` is NOT NULL — map discovery to the existing enum.

**C-3 — #54 diagnosis was WRONG (rewrites Stage C dec.4 + Stage G dec.1):** the UI already reads BOTH `revenueFy*` AND `totalIncomeFy*` (`web/components/ipo/charts/FinancialPerformanceCharts/utils.ts:130-209`, `types.ts:17-34`); a row renders if EITHER is present. So a field-name "reconcile" will NOT fix the chart, and a column rename is a **§GATE destructive migration the run MUST NOT make**. Re-diagnose from the component: fix `RevenueChart.tsx` (plot `totalIncome` when `revenue` is null) and `calculateDataCompleteness` (count `totalIncome` toward completeness — it currently reports "No revenue data / 44%"). No column rename.

**C-4 — Two-financial-tables / two-peer-sources ambiguity (decide in Stage C):** schema has BOTH `financial_data` (`revenueFy2022/23/24`, `totalIncomeFy*`) AND `ipo_financials` (`revenueFy1/2/3`, `peerCompanies`, `pbRatio`, `roce`, `industryPe`); `peerCompanies` exists in BOTH `peer_companies` (table) AND `ipo_financials.peerCompanies` (text[]). **Decision:** treat `financial_data` + `peer_companies` (the tables C3b already writes) as canonical; make the UI read those; do NOT split writes across both. Record in the Authorization trail.

**C-5 — NEW Stage A.5 (consolidation/identity hardening) — RUNS BEFORE Stage B/E/F:** five OPEN integrity bugs live in the write paths the new writers sit on. Fix them first or the pipeline re-pollutes: (a) **date-plausibility guard** (analogous to `FINANCIAL_FIELD_BOUNDS`): `listing_date ≥ close_date`, `allotment_date` within `close_date + ~30d`, reject far-future-year corruption → closes #41, prevents #52 recurrence; (b) route every IPO-row create/update through `sanitizeCompanyName` → closes #42; (c) fix the duplicate-normalizer parenthesis case (`(India)` vs `India`) → closes #44; (d) registrar parse/normalize (address-pollution, missing space) → closes #45. **Extend `--gate` to FAIL on these substance smells, not just missing fields.** Stages B/E/F MUST NOT begin until A.5 is green.

**C-6 — Render gaps Stage G must add:** (a) **wire `DemandGraph` into `page.tsx`'s JSX** (currently imported but never rendered) + add to the Stage-G sample check; (b) a **deferred-listing SME LISTED row** must show an **honest empty-state** (`page.tsx:455-459` hides `ListingPerformanceCharts` when listing price is null → currently renders nothing); (c) the dark investor-facing sections — `ipo_details` (cut-off price / min-investment / category shares for `CategoryReservationSection`), timeline basis/refund/credit dates (`IPOTimelineWidget`), and `ipo_scores` compute+trigger (`IPOScoreSection`) — must be **populated-or-explicitly-DEFERRED**, not silently empty.

**C-7 — DoD blockers are REAL dependencies (not just "reproduce locally"):** the static gate `cd web && npx vitest run tests/unit` is the very suite that **OOMs (#56/#51)** → it is unachievable until that harness is fixed; the §GATE "merge draft PR" step is **blocked by red CI (#35)**. Either scope a minimal harness/CI fix in Stage A.5, OR state explicitly in the DoD that the web static gate runs **per-changed-suite only** and the merge **cannot land until Abhay resolves #35/#56/#51**. Do not claim the full web unit gate is green.

**C-8 — PREFLIGHT re-verify:** read-back the B1 "listing 96.7%" and #6 "de-pollution merged" claims via the tunnel before trusting them. (Research confirmed listing_performance = 93.7% of LISTED, surfaceLeak=0 — both broadly hold; verify anyway.)

---

## 2. STAGE A — The stage-aware per-IPO completeness model + gate (the new measuring stick)

**Files:** `scripts/audit-ipo-coverage.mjs` (extend), a new `scripts/lib/ipo-stage-completeness.mjs` (the
stage→due-fields map). **Keep untouched:** the scraper write-path; the merged de-pollution predicate.

### Pre-made design decisions (do NOT deviate)
1. **Lifecycle stages + due-field map (the SSOT for "what 100% means").** Define one map keyed by lifecycle
   stage; an IPO's stage is derived from its dates/status:
   - **UPCOMING / DRHP-filed:** company profile, description, financials (restated P&L per fiscal year),
     objects of the issue, risk factors, peers, promoter holding, sector/segment. *(price/lot/dates/issue-size NOT yet due)*
   - **PRE-OPEN / RHP-filed:** + price band, lot size, open/close dates, fresh-issue/OFS split, total issue size,
     registrar, lead managers, anchor-investor list (anchor doc), ISIN, listing date (tentative).
   - **OPEN:** + live subscription (overall + QIB/NII/Retail), demand/bid detail, GMP (unofficial).
   - **CLOSED:** + final subscription, allotment/basis date, registrar allotment link.
   - **LISTED:** + listing date, listing price, listing gain %, listing-day performance.
2. **The gate = per-IPO, stage-aware.** `--gate` iterates every genuine IPO, computes its stage, and checks each
   **stage-due** field. A stage-due field that is (a) populated → pass; (b) missing but logged in
   `docs/goals/.run/2026-06-19-…-DEFERRED.md` as genuinely-unpublished → pass-with-deferral; (c) missing and NOT
   deferred → **FAIL (exit 1)**. Aggregate %s per domain are still printed, but as a **dashboard, not the pass
   condition**.
3. **Honesty is enforced by the gate, not by trust:** the only way to clear a missing field is a populated value
   OR a logged deferral with a reason (source genuinely doesn't publish it at this stage / historical doc
   unreachable). **No synthetic data — ever.**
4. **Going-forward vs historical:** the gate distinguishes IPOs that entered the pipeline on/after the pipeline's
   activation (mandatory 100%) from pre-existing historical rows (best-effort; an unreachable historical document
   is an auto-deferral, not a failure). Tag rows accordingly.

### Stage A acceptance
- `node scripts/audit-ipo-coverage.mjs --gate` runs the per-IPO stage-aware check and exits non-zero while any
  stage-due public field is missing-and-undeferred; prints the per-IPO gap list + the dashboard.
- Unit test for the stage→due-fields map (a fixture IPO at each stage yields the right due set).
- **Stage gate sweep:** static → G-INDEPENDENT (reproduce the gate, sanity-check the due-field logic). Green before commit.

---

## 3. STAGE B — Primary-source document discovery spine (DRHP → RHP+addenda → anchor doc)

**Files:** `scraper/src/services/drhp-downloader.ts` (build the stubbed `searchNSE`/`searchBSE`/`searchSEBI` per
**C-1**, + addenda/version handling + the `.zip` unzip step), `DocumentRepository`/`documents` (map to the
EXISTING `documentTypeEnum` — see **C-2**, do NOT add a new discriminator; use `ANCHOR_ALLOCATION_REPORT`, there
is no `ANCHOR`), `field-priority-matrix.ts`, `feature-flags.ts`. **Keep untouched:** the C3a Chittorgarh
discovery (it is the FALLBACK for SME-DRHP / BSE-DRHP / deep history per C-1), the C3b extractors. **Precondition:
Stage A.5 (C-5) MUST be green before this stage runs.**

### Pre-made design decisions (do NOT deviate)
1. **TDD red-first** for every task (scraper tiers per `scraper-test-layout.md`; mock HTTP in unit, real fetch in e2e).
2. **Primary-source discovery is the spine; aggregator is fallback.** Build `searchSEBI` (SEBI filing listings),
   `searchNSE` (NSE mainboard + **NSE Emerge SME**), `searchBSE` (BSE mainboard + **BSE SME**, reuse the BSE
   JSON-API + scrip-code path). Chittorgarh stays as a last-resort fallback only when all primary sources miss.
   SME boards are first-class (≈⅔ of inventory) — a discovery path that silently skips SME is a bug.
3. **Distinguish document types and their field yields.** Store DRHP, RHP, ADDENDUM, ANCHOR as distinct
   `documents` rows with `doc_type`. The pipeline must know DRHP alone leaves price/lot/dates blank — those come
   from the RHP (or exchange) closer to open. Treat the structural fields as *not-yet-due* until an RHP exists.
4. **Handle revisions.** Re-fetch the latest version; an ADDENDUM/corrigendum (price-band revision, date
   extension) supersedes the earlier value via the priority matrix's `timeBased`/newest-wins where applicable.
   Never freeze the first PDF and ignore later filings.
5. Route all document/field writes through `data-persister`; register every new field in `FIELD_PRIORITY_MATRIX`
   (DRHP/RHP source, validation, `ignoreDRHP`/`timeBased` set correctly); gate the new discovery behind a flag
   (e.g. `ENABLE_PRIMARY_SOURCE_DISCOVERY`, default OFF → activation is §GATE).
6. **Backfill additively via the tunnel** after green for one real test IPO; capture before/after `documents` coverage.

### Stage B acceptance
- For ≥1 real current IPO, the primary-source path discovers + stores its DRHP and/or RHP (+ anchor doc when due)
  with correct `doc_type` (tunnel read-back). SME path proven on ≥1 SME IPO.
- The already-registered anchor/objectives/peers jobs populate from the new `documents` rows (read-back).
- **Stage gate sweep:** static → G-PERSIST (documents + downstream rows) → G-INDEPENDENT. Green/deferred before commit.

---

## 4. STAGE C — Foolproof extraction from the company's own documents

**Files:** the C3b extractors (`extractFinancialsFromDetailHtml`/`…Peers…`/`…Objectives…`,
`extract_financials_pdf.py`, `FINANCIAL_FIELD_BOUNDS`), extended to consume the DRHP/RHP PDFs from Stage B;
`data-persister` write helpers. **Keep untouched:** the deterministic NO-LLM design; the plausibility gate.

### Pre-made design decisions (do NOT deviate)
1. **Source authority by field, document-first:**
   - **DRHP →** financials (restated P&L per fiscal year), KPIs, valuation snapshot, objects of the issue, risk
     factors, peers, promoter holding, company description/business.
   - **RHP + addenda →** price band, lot size, dates, fresh-issue/OFS split, total issue size, registrar, lead managers.
   - **Anchor allotment doc →** anchor investors.
2. **Deterministic + plausibility-gated, NO LLM, NO fake data.** Every persisted value passes `FINANCIAL_FIELD_BOUNDS`
   (extend the bounds for any new field); a value the extractor cannot reach at sane confidence is **DEFERRED with
   reason + follow-up issue**, never invented (`output-plausibility-verification.md`).
3. **Write only via** `createFinancialData`/`createPeerCompanies`/`updateIPOObjectives`/`createAnchorInvestors`/
   `upsertIPO`; the IPO's own row filtered out of its peer table; respect field protection.
4. **#54 — see C-3 (the original diagnosis here was FALSE).** The UI already reads BOTH `revenueFy*` and
   `totalIncomeFy*`; do NOT rename any column (that would be a §GATE destructive migration). The fix is in the
   component (`RevenueChart.tsx` + `calculateDataCompleteness`) — verified in Stage G. Canonical financial table =
   `financial_data` + `peer_companies` (C-4).

### Stage C acceptance
- For the Stage-B test IPO(s), financials/objects/peers/(anchor) are extracted from its own DRHP/RHP at 100% of
  what those documents publish, every value plausibility-passing; un-extractable values logged DEFERRED.
- The `total_income_fy*`↔`revenue_fy*` contract is reconciled to one canonical field across schema/repo/UI.
- **Stage gate sweep:** static (incl. `packages/shared` compile if schema changed) → G-PERSIST → G-INDEPENDENT (substance: financials domain-sane). Green/deferred.

---

## 5. STAGE D — Live data during the OPEN window (web-scrape handoff, tiered cadence)

**Files:** subscription writers (NSE/BSE/Moneycontrol orchestrators, `ENABLE_MONEYCONTROL_SUBSCRIPTION`),
`nse-api-client.ts` demand block, GMP orchestrators (defer authoring to the GMP contract — complete+activate
only), `scheduler/config.ts`. **Keep untouched:** PDF-sourced static fields (the priority matrix protects them).

### Pre-made design decisions (do NOT deviate)
1. **Field-level handoff, not a hard phase switch.** During OPEN, live scrapers write ONLY time-based fields
   (subscription, demand, GMP, status) — marked `timeBased:true`/newest-wins in the matrix; they MUST NOT
   overwrite DRHP/RHP-sourced static fields (price/lot/dates/financials/objects/peers).
2. **Tiered cadence (tuned in `scheduler/config.ts`, GATED to activate):**
   - **Subscription + demand:** every ~2–3h on open days; **hourly (or tighter) on the final close day** near the 5pm cutoff.
   - **GMP:** 1–2×/day, **flagged UNOFFICIAL** in storage + render (it is grey-market hearsay, never authoritative).
   - **Static (PDF-sourced):** fetched once when the document appears; re-checked only for addenda.
3. **Subscription root cause:** NSE has no public subscription endpoint (scrapes 0) → use the code-ready
   Moneycontrol path behind its flag + BSE; diagnose before building (`/systematic-debugging`); record per-source
   outcome via `ScraperMetricsTracker`.
4. Real-time fields apply to OPEN (subscription/demand/GMP); final subscription frozen at CLOSED.

### Stage D acceptance
- For a real OPEN IPO (or the most recent CLOSED if none open), subscription (overall + QIB/NII/Retail) + demand
  populate via the live path (tunnel read-back); GMP present + flagged unofficial; static fields unchanged by the live run.
- **Stage gate sweep:** static → G-PERSIST (per-batch + final coverage) → G-INDEPENDENT (subscription %s domain-sane). Green/deferred.

---

## 6. STAGE E — Post-close: registrar allotment + exchange listing performance

**Files:** `listing-performance-updater.ts` + job + `backfill-listing-performance.ts` + `match-ipo.ts`; BSE
JSON-API SME quote path; registrar/allotment writer + matrix fields. **Keep untouched:** the merged B1 mainboard path.

### Pre-made design decisions (do NOT deviate)
1. **Listing performance:** B1 mainboard is merged (0→96.7%). The delta is **SME listing price** (#36): reuse
   the BSE JSON-API + scrip-code to fetch listing-day + current price for SME symbols, matched via `match-ipo.ts`.
   Threshold ≥95% of LISTED; an SME row with no obtainable listing-day price → DEFER that row, never fabricate.
2. **Allotment/basis:** populate `allotment_date` + registrar allotment link for CLOSED/LISTED from registrar/exchange;
   a source-capped value is DEFERRED (carry forward the 2026-06-16 source-capped tails — registrar/lot/allotment/issue_size).
3. Route via `upsertIPO`/domain repos; register fields; backfill additively via tunnel; capture before/after.

### Stage E acceptance
- SME LISTED rows gain listing price/gain where publicly available; remainder DEFERRED with reason. Allotment
  fields populated for CLOSED/LISTED where sourceable.
- **Stage gate sweep:** static → G-PERSIST → G-INDEPENDENT (listing-gain %, dates domain-sane). Green/deferred.

---

## 7. STAGE F — Self-sustaining automation (auto-discovery + stage-transition triggers)

**Files:** `scheduler/scheduler.ts`, `scheduler/config.ts`, `scheduler/jobs/` (register the discovery +
per-stage jobs), `scraper-metrics-tracker.ts`. **Activation in prod is GATED** — author + leave OFF, list in §GATE.

### Pre-made design decisions (do NOT deviate)
1. **Auto-discovery of new IPOs:** a scheduled job polls the primary sources (SEBI/NSE/BSE incl. SME) for newly
   filed IPOs and enrolls them (creates the row via `upsertIPO` + dedup check), so "all IPOs" needs no manual touch.
2. **Stage-transition driven fetch:** a scheduled reconciler computes each IPO's lifecycle stage and enqueues the
   newly-due fetches when it crosses a boundary (DRHP→RHP→OPEN→CLOSED→LISTED) — DRHP/RHP discovery, then live
   scrape while OPEN at the tiered cadence, then listing/allotment after close.
3. **Every activated job records a per-source outcome** (`ScraperMetricsTracker`) and rides the project notifier
   for health alerts (`scraper-health-metrics.md`, `notifier-integration.md`) — a silently-dark job is the failure
   this prevents (root cause of the original 0% coverage).
4. All jobs behind flags, default OFF; the cron schedule + flag enable + deploy is **§GATE**.

### Stage F acceptance
- Discovery + per-stage + cadence jobs are registered and pass a local dry-run (one cycle, tunnel, no prod cron);
  metrics recorded. The §GATE list enumerates exactly which flags + cron + deploy Abhay must enable.
- **Stage gate sweep:** static → G-PERSIST (a dry-run cycle writes/updates ≥1 IPO) → G-INDEPENDENT. Green/deferred.

---

## 8. STAGE G — Render correctly (every stage-due populated field shows, domain-sane)

**Files:** `web/components/ipo/charts/FinancialPerformanceCharts/` (#54), `web/app/ipos/[slug]/page.tsx` (#8),
the six list/hub pages (#7), `IPOCardEnhanced` (#58), via `kpi-formatters.ts`/`date-formatter.ts`. **Keep untouched:**
the data layer (Stages B–F own it).

### Pre-made design decisions (do NOT deviate)
1. **#54 root fix:** consume the reconciled canonical financial field (from Stage C) in `RevenueChart.tsx`/`utils.ts`
   — the chart shows real revenue/income for the ~132 IPOs that already have data. No UI alias hack.
2. **#8/#7 blank shells:** every applicable detail section + the six list/SME-hub/prospectus/history/holidays pages
   render their populated data; empty *only* when genuinely no data (then a real empty-state, not a broken shell).
3. **#58:** listing-gain % renders on the recently-listed cards.
4. All money/ratio/date render via the SSOT formatters (`web-display-formatting.md`); never inline.
5. React Server Components/services use repositories directly, never the apiClient (`web-data-access.md`).

### Stage G acceptance
- Stratified UI sample (≥2 UPCOMING, ≥3 OPEN, ≥3 CLOSED, ≥3 LISTED, both segments) renders real data in every
  applicable section; values domain-sane; 0 new console errors; screenshots saved under `docs/goals/.run/`.
- **Stage gate sweep:** static (`npm run lint && npm run build`; `cd web && npx vitest run tests/unit`) → **G-UI (mandatory)** → G-INDEPENDENT. Green/deferred.

---

## 9. Verification gates (IPODhan-adapted — load-bearing, non-negotiable)

**All rules in `.claude/rules/` are operative.** G-UI, G-PERSIST, and G-INDEPENDENT are **MANDATORY at every
task AND every stage boundary** (standing Abhay mandate). They are why this contract yields *proven-working*
output, not *claimed-working* output.

**Static (right CWD):** `npm run lint && npm run build` (root); `cd packages/shared && npx tsc && test -f dist/db/schema.d.ts` (compile FIRST when schema changes); `cd scraper && npx vitest run tests/unit/...` (NOT commit-type-gated); `cd web && npx vitest run tests/unit` (type-gated at commit). CI is red repo-wide (#35) — reproduce gates locally, do not trust CI.

- **G-PERSIST** (`e2e-persistence-verification.md`): after any scraper run / backfill / applied migration, exit
  code ≠ proof. Two signals: the run's count/log AND **independent `node`+`pg` read-back to `localhost:15432`**
  confirming row/column shape+values; multi-row loops verified per-batch + a final coverage query. ≤3 attempts → `/fix-loop`.
- **G-UI** (`supervisor-verification.md`): for any UI-changing task, DRIVE the app (self-heal: start `npm run dev`
  background, capture PID, wait for port 3000) via **Playwright MCP** — `browser_navigate` → `browser_take_screenshot`
  → `browser_snapshot` (ARIA) → `browser_console_messages`. Pass = intended value visible + in ARIA + **no NEW
  console errors**. ≤3 iters → `/fix-loop` → `/systematic-debugging`. MCP dead after self-heal → mark
  `completed (deferred — G-UI)` with reason; never claim complete.
- **G-INDEPENDENT** (`independent-test-verification.md` + `supervisor-verification.md` + `output-plausibility-verification.md`):
  after a stage is otherwise green, re-verify with FRESH eyes BEFORE marking complete: **reproduce the gate**
  (re-run the exact lint/test/`audit-ipo-coverage --gate` command — never trust a reported exit code) AND **inspect
  substance** (values domain-sane on the DEFAULT path — money/dates/sizes/rates not absurd). Sibling-sweep the
  output class. 3 reconcile cycles → `/systematic-debugging`; unresolved → log DEFERRED, proceed with state noted.
- **Behavior** (`claude-behavior.md`): **15** test failures → use the skills (no ad-hoc retry); **17** root cause,
  no band-aid; **20** epistemic honesty, NO synthetic/fake data, surface `**Assumption:**`/`**Unverified:**`,
  remove fakery rather than carry it; **23** keep going through the full DoD — context-budget anxiety is NOT a stop.
- Pino logging (no `console.*` in `scraper/src/**`); writes via `upsertIPO`/domain repos; new behavior flag-gated.

**Failure-recovery budget:** per-task ~15 attempts (≈5 inline → `/fix-loop` → `/systematic-debugging`) → DEFER
the task + continue (do NOT halt the run). MCP hang: 3 cycles (wait+retry → `browser_close`+re-nav → kill+restart
dev server) → DEFER + continue. Tunnel drop → re-establish via the SSH command above. **Hard halt ONLY:**
`npm install` failure, a contract-internal decision contradiction, an irrecoverable build break after the full
budget, OS permission denial, missing token / dead un-re-establishable tunnel. Context-budget anxiety is NOT a
halt — hand off via a one-line continuation note in the PROGRESS file, never fake-complete.

---

## 10. Commit + push

Branch `feat/ipo-data-pipeline-foolproof` (off `main`). One conventional commit per stage (`feat(scraper): …`,
`fix(web): …`, `feat(scripts): …` with the right scope), each AFTER its gate sweep is green. **NEVER `git add -A`**
— stage named files only (a stray `docs/goals/.run/gmp-staleness-header.png` exists). Push branch + open a
**DRAFT PR**. **Do NOT merge to main, do NOT deploy, do NOT enable any flag/cron** (all §GATE). Co-author trailer.
Keep `docs/goals/.run/2026-06-19-ipo-data-pipeline-foolproof-PROGRESS.md` current.

---

## 11. Definition of Done (all MUST be true)

**Model + gate:**
- [ ] Stage-aware per-IPO completeness gate exists; `node scripts/audit-ipo-coverage.mjs --gate` exits non-zero on any stage-due public field missing-and-undeferred; dashboard %s printed.

**Pipeline (each proven by `--gate` + read-back):**
- [ ] Primary-source discovery spine built (SEBI/NSE/BSE incl. SME); DRHP/RHP/ADDENDUM/ANCHOR stored with `doc_type`; aggregator is fallback only; addenda/versions handled.
- [ ] Document extraction fills financials/objects/peers/anchor at 100% of what the company's own docs publish (plausibility-passing; un-extractable → DEFERRED); `total_income_fy*`↔`revenue_fy*` reconciled to one canonical field.
- [ ] Live data (subscription/demand/GMP) populated for OPEN/CLOSED via web scrape at the tiered cadence; GMP flagged unofficial; static PDF fields never overwritten by live runs.
- [ ] Post-close: SME listing performance + allotment populated where sourceable (else DEFERRED).
- [ ] Self-sustaining: auto-discovery + stage-transition + cadence jobs registered, dry-run-proven, metrics recorded (activation = §GATE).
- [ ] Render: #54/#8/#7/#58 fixed — stratified UI sample renders real, domain-sane data; 0 new console errors; screenshots saved.

**Static gates:**
- [ ] `npm run lint && npm run build` pass; `packages/shared` compiles (`dist/db/schema.d.ts`); scraper + web unit tests green locally; `test-results/*.json` emitted.

**Gates:**
- [ ] G-PERSIST dual-signal on every write/backfill/migration; G-UI three-signal on Stage G; G-INDEPENDENT post-stage (gate reproduced + substance + sibling-swept).

**Ship:**
- [ ] Per-stage conventional commits pushed to `feat/ipo-data-pipeline-foolproof`; **draft PR open, NOT merged**.
- [ ] §GATE list populated; deferrals logged in `docs/goals/.run/2026-06-19-ipo-data-pipeline-foolproof-DEFERRED.md` with reason.

**§GATE — needs Abhay (run STOPS here, authors the artifact, logs, continues):**
- [x] **AUTHORIZED 2026-06-19 (Abhay):** Stage B-live MAY add the unzip dependency **`adm-zip`** to the `scraper` workspace (`cd scraper && npm install adm-zip`) for `.zip`-wrapped NSE/BSE document handling (unzip before the `%PDF` check). No further approval needed — the B-live continuation installs it and proceeds.
- [ ] Enable `ENABLE_PRIMARY_SOURCE_DISCOVERY` + the discovery/per-stage/cadence cron jobs + `ENABLE_MONEYCONTROL_SUBSCRIPTION` + any new flags; deploy/PM2 to activate.
- [ ] Apply any authored-but-unapplied (destructive) migrations to prod. · [ ] Merge the draft PR to `main`. · [ ] Rotate the leaked prod DB password (#1).

---

## 12. Final report (required on completion)

Commit SHAs + per-stage gate results; per-IPO stage-aware coverage before/after (with the dashboard); G-UI
verdict per screen + screenshot paths; G-PERSIST read-back values per write path; G-INDEPENDENT result; the
§GATE list awaiting Abhay (flags/cron/deploy/migrations/#1); skipped (already-covered) list; DoD tally; DEFERRED
entries (genuinely-unpublished/source-capped/historical-unreachable) with reason.

---

## 13. Guardrails (hard stops)

- **IPODhan repo only** (`scraper/`,`packages/shared/`,`web/`,`docs/`,`scripts/`); never write `D:\Abhay\VibeCoding\5Wealths\`.
- **No prod deploy / no merge to main / no flag/cron enable** — feature branch + draft PR; all activation is §GATE.
- **Prod DB additive/corrective via the `localhost:15432` tunnel only**; no destructive DDL without a gated migration.
- **No new dependencies** unless the contract authorizes one (the OSS pdfplumber sidecar already exists — reuse it).
- **No design reinvention** — reuse `data-persister`/the matrix/the C3b extractors/the SSOT formatters; extend over rewrite.
- **General fix, never per-IPO data patches.** Root cause in discovery/write-path/consolidation/scheduler/render.
- **Honesty: no synthetic/fake data — fill from a real source or leave blank + DEFER with reason.** GMP is always flagged unofficial.
- **Stop only on a true blocker** (per §9 hard-halt list). Context-budget anxiety is NOT a blocker — hand off via the PROGRESS note, never fake-complete.
- **Strategic items are `TODO(5W):` notes** (e.g. monetization, OFS/FPO listing policy) — repo-level work only here.
- **Secret:** prod DB password is the known-leaked one (rotation #1) — never echo/commit it.

---

## Authorization trail

| # | Decision | Choice |
|---|---|---|
| 1 | Domain model (verified via IPO-expert role) | primary-source first: DRHP (company/fin) → RHP+addenda (price/lot/dates/issue-size/registrar) → anchor doc → live web-scrape (subscription/GMP/demand) → registrar/exchange (allotment/listing) → render; field-level source authority via the priority matrix; GMP flagged unofficial |
| 2 | "100%" bar | **stage-aware per-IPO completeness** — per IPO, every stage-due publicly-available field captured; aggregate %s = dashboard, not the pass condition |
| 3 | Deferral policy | a field may be missing ONLY if genuinely unpublished at that stage, logged with reason; NO faking |
| 4 | Discovery source | PRIMARY (SEBI/NSE/BSE incl. NSE Emerge / BSE SME) is the spine; Chittorgarh = fallback only; SME is first-class |
| 5 | Document types | DRHP / RHP / ADDENDUM / ANCHOR stored distinctly (`doc_type`), distinct field yields; addenda/revisions supersede |
| 6 | Live-data handoff | field-level (live scrapers write only `timeBased` fields; never overwrite PDF-sourced static fields) |
| 7 | Cadence | tiered — subscription/demand every ~2–3h (hourly on close day); GMP 1–2×/day; static PDF once + addenda re-check |
| 8 | Self-sustaining | auto-discovery of new IPOs + stage-transition-triggered fetches on the cron scheduler; per-source health metrics; activation GATED |
| 9 | Time scope | go-forward = mandatory 100%; historical (already-listed) = best-effort (unreachable doc → auto-deferral, not failure) |
| 10 | Output file | NEW superseding contract `docs/goals/2026-06-19-ipo-data-pipeline-foolproof.md`; carries forward render #54/#7/#8/#58 + §GATE; 2026-06-16 stays as history |
| 11 | Deploy/activation | GATED (Abhay) — author + leave OFF; draft PR, no merge |
| 12 | Source feasibility (deep research 2026-06-19, live-verified) | NSE = RHP+anchor+ratios for mainboard+SME (`&series=SME` mandatory); BSE = RHP off the detail row (zero extra requests); SEBI = mainboard DRHP page-1 GET. NSE/BSE serve RHP not draft DRHP → **SME-DRHP + BSE-DRHP + deep history fall back to Chittorgarh**; anchor SoR = NSE `ANCHOR_<SYM>.zip`. Docs are `.zip` → unzip before `%PDF` (C-1) |
| 13 | `doc_type` | use the EXISTING `documentTypeEnum`; value is `ANCHOR_ALLOCATION_REPORT`, not `ANCHOR` (C-2) |
| 14 | #54 fix | component-level (`RevenueChart`/`calculateDataCompleteness`) — UI already reads both fields; NO column rename (C-3) |
| 15 | Canonical financial/peer tables | `financial_data` + `peer_companies` (not `ipo_financials`) (C-4) |
| 16 | Integrity precondition | NEW Stage A.5 fixes #41/#42/#44/#45 + adds a date-plausibility guard BEFORE B/E/F; `--gate` fails on substance smells (C-5) |
| 17 | DoD blockers | web static gate + merge §GATE are blocked by #56/#51/#35 — per-changed-suite gate + merge waits on Abhay (C-7) |

---

## References (loaded transitively by the skills this contract invokes)

- `.claude/rules/claude-behavior.md` — rules 15, 17, 20, 23
- `.claude/rules/supervisor-verification.md` · `independent-test-verification.md` · `e2e-persistence-verification.md` · `output-plausibility-verification.md` — the G-UI / G-PERSIST / G-INDEPENDENT gates
- `.claude/rules/tdd-rule.md` — red-green-refactor
- `.claude/rules/scraper-write-path.md` · `scraper-test-layout.md` · `scraper-rendering-detection.md` · `scraper-health-metrics.md` · `structured-logging.md` — scraper contracts
- `.claude/rules/schema-imports.md` · `shared-package-build.md` · `financial-column-precision.md` — schema/build
- `.claude/rules/ipo-duplicate-detection.md` · `canonical-ipo-slug.md` — identity/dedup
- `.claude/rules/web-data-access.md` · `web-display-formatting.md` · `web-api-routes.md` · `react-nextjs.md` — web/render
- `.claude/rules/notifier-integration.md` · `goal-anchored-decisions.md` · `decision-authority.md` — ops + decisions
- Skills: `/systematic-debugging` · `/fix-loop` · `/backfill-script` · `/add-scraper-source` · `/web-scraping-expert` · `/data-validation-expert` · `/playwright` · `/auto-verify` · `/ipo-domain-expert`
