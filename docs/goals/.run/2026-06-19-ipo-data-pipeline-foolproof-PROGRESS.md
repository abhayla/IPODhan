# PROGRESS — Foolproof IPO data pipeline (`2026-06-19-ipo-data-pipeline-foolproof`)

Branch: `feat/ipo-data-pipeline-foolproof` (off `main`). Draft PR pending. NO merge / NO deploy / NO flag-enable (all §GATE).

## PREFLIGHT (done)
- Read state-of-record memory (ipo-data-completeness-progress, c3b-financials-contract, b1-listing-backfill-diagnosis, goal-session3-result-corrections, vps-db-tunnel-setup, goal doc).
- git log -30: PRs #34/#37/#39/#40/#46/#50 merged. C3a docs, B1 listing, C3b financials all landed to `main`.
- Tunnel `localhost:15432` UP. Baseline `audit-ipo-coverage.mjs` (2026-06-19):
  - 268 genuine IPOs (306 total). **Stage A invariants ALREADY PASS**: surfaceLeak=0, name-smells=0, dup-groups=0.
  - Coverage: financial_data 53.7%, peer_companies 45.5%, documents 30.2%, listing_perf 33.2% (of all real), objectives 51.5%.
  - Dark: subscriptions 2.6%, gmp 8.6%, ipo_demand_graph 0%, ipo_scores 0%, ipo_details 0%, anchor_investors 0%, company_description 0%.

## Stage status
- [x] **A — DONE + verified.** `scripts/lib/ipo-stage-completeness.mjs` (stage→due-fields SSOT, cumulative,
  substance-aware presence) + node:test (6/6). Extended `audit-ipo-coverage.mjs --gate` to: per-IPO stage-aware
  dashboard (UPCOMING/PRE_OPEN/OPEN/CLOSED/LISTED satisfied%), go-forward enforcement (env `PIPELINE_ACTIVATION_DATE`,
  unset today → all historical/best-effort), AND **folded in the substance gate** (one comprehensive command).
  Aggregate %s reclassified to WARN dashboard (per contract §2). **GATE now exits 0.**
- [x] **A.5 — DONE (core) + verified.** Write-path guards in `scraper/src/utils/validators.ts` (TDD, 16/16):
  `coercePositiveOrNull` (issue_size 0→null), `sanitizeIpoDates` (multi-signal date-stomp guard — listing
  disambiguates which field is corrupt: WINDLAS=null open/close, Leapfrog=null bad allotment), `sanitizeRegistrar`
  (strip ^/tab/contact pollution + glue-fix). Wired into `data-persister.ts`. Added `checkRegistrarQuality` (#45)
  to substance gate. **Corrective `scripts/fix-substance-corruption.mjs` applied (additive, tunnel, read-back):**
  issue_size=0 36→0, date-stomp 7→0, registrar-pollution 3→0. #41/#52 prevented at source. #42 verified (smells=0).
  #44 + registrar variant-collapse DEFERRED (see DEFERRED.md — no active victim / mis-map risk).
- [~] **B — pure-core DONE + verified** (commit `171587f3`). `scraper/src/services/primary-source-discovery.ts`:
  `parseNSEDocuments`/`parseBSEDocuments`/`parseSEBIDrhpListing` + `looksLikePdf` + `ENABLE_PRIMARY_SOURCE_DISCOVERY`
  flag. Unit tests 16/16 (reproduced by orchestrator). All doc types verified against real `documentTypeEnum`.
  **DEFERRED to a network+tunnel session** (Stage B acceptance not yet met): live fetch (NSE `&series=SME`, BSE
  detail row, SEBI page-1 GET); `.zip`→`%PDF` unzip (needs an unzip dep — §authorize); BSE GID→URL resolution;
  persistence via `data-persister`/`DocumentRepository`; `FIELD_PRIORITY_MATRIX` registration; downstream
  anchor/objectives/peers jobs populate; tunnel backfill + read-back.

### Ship status (this session)
- Branch `feat/ipo-data-pipeline-foolproof` pushed; commit `9cc1cf16` (Stage A+A.5).
- Draft PR: **PENDING — GitHub API rate limit hit at create time.** Branch is on remote;
  create from https://github.com/abhayla/IPODhan/pull/new/feat/ipo-data-pipeline-foolproof
  (or retry `gh pr create --draft`). Body drafted in this session's PR attempt.

### Continuation plan (next session, in priority order)
- **Stage B (next, biggest):** wire the stubbed `scraper/src/services/drhp-downloader.ts`
  `searchNSE/searchBSE/searchSEBI` per contract §1.5 (C-1): NSE `ipo-detail?symbol&series=SME`
  → archive `.zip` (unzip before %PDF, `extractAdditionalNSEFields()` already parses);
  BSE RHP off the existing detail row's `Prospectus_GID` (zero extra requests); SEBI page-1
  mainboard DRHP. Map to EXISTING `documentTypeEnum` (`ANCHOR_ALLOCATION_REPORT`, no `ANCHOR`).
  Flag `ENABLE_PRIMARY_SOURCE_DISCOVERY` (default OFF). TDD: mock HTTP in unit, real in e2e.
  Build code + unit tests first (no-network verifiable); live e2e + tunnel backfill needs a
  network+tunnel session. Chittorgarh stays the SME-DRHP/BSE-DRHP/deep-history fallback.
- **Stage C:** extend C3b extractors to the Stage-B PDFs; #54 is component-only (C-3).
- **Stage D/E/F:** live subscription/demand/GMP cadence · SME listing price (#36) · jobs (flags OFF, §GATE).
- **Stage G:** #54 `RevenueChart.tsx`+`calculateDataCompleteness` (plot totalIncome when revenue null;
  count totalIncome toward completeness — NO column rename, C-3); wire `DemandGraph` into page.tsx JSX;
  honest empty-states; #8/#7/#58. Needs G-UI (Playwright MCP drive).
- [ ] **B** — primary-source discovery spine (searchNSE/searchBSE/searchSEBI + .zip unzip + doc_type)
- [ ] **C** — extraction from own docs (extend C3b to DRHP/RHP PDFs) + #54 financial-field reconcile
- [ ] **D** — live OPEN-window scrape (subscription/demand/GMP tiered cadence)
- [ ] **E** — post-close listing + allotment (SME listing price #36)
- [~] **F — reconciler core DONE + verified** (commit `2a3500c5`). `scraper/src/scheduler/stage-reconciler.ts`:
  `deriveLifecycleStage` + `planStageReconciliation` → per-IPO {stage, dueFetches} (due-at-or-before-stage
  AND missing) — the self-sustaining "brain" that enqueues only newly-due work as an IPO crosses stages,
  vs blindly timer-running every scraper. Flag `ENABLE_STAGE_RECONCILER` (OFF). Unit 4/4. NOTE: the data-source
  jobs (financialData/peerCompanies/anchorInvestors/objectives/listingPerformance…) ALREADY exist on cron.
  **DEFERRED (§GATE-activated):** the live runner (query child-table presence via tunnel → enqueue the due jobs
  → record metrics) + auto-discovery-of-new-IPOs job + cron wiring + flag enable.
- [~] **G — #54 DONE + G-UI verified** (commit `bc4ec602`). Root cause was THREE revenue-only
  gates (C-3 named only 2): `hasMinimumFinancialData` (the section-level gate — found via the
  mandatory G-UI drive, not code-inspection), `calculateDataCompleteness`, and `RevenueChart`.
  All now count the top-line (revenue ∥ total income) and `RevenueChart` plots it with an honest
  "Total Income Trend" label (never mislabels income as revenue). G-UI: STALLION (3 income yrs,
  0 revenue) renders the section + "Data completeness 67%" + "Total Income Trend (3 Years)" chart
  (was "Financial Performance Data Unavailable"). Web `tsc` gate passed; catch-tests 4/4; screenshot
  in `.run/2026-06-19-stageG-54-total-income-trend.png`. NO column rename (avoids §GATE migration).
  **Stage-G findings (verified against current code, correcting stale C-6):**
  - **DemandGraph is NOT a gap** — the Demand tab already renders via `IPODetailTabs → DemandGraphChart`
    (IPODetailTabs.tsx:324-326). The `DemandGraph` import at `page.tsx:44` is dead/unused (trivial cleanup,
    optional). C-6's "wire DemandGraph into page.tsx JSX" was a partial read — do NOT add a duplicate.
  - **#58** — `QuickStatsGrid` (lines 66-75) HAS a "Listing Gain" stat (gated on `listingGainPercent`), but a
    live `/ipos?status=LISTED` drive showed **0** "Listing Gain" text on the cards → **UNVERIFIED / likely a
    real gap**: investigate which card the listings page actually uses, a possible 3-stat cap crowding it out,
    or whether the shown rows lack gain data. NOT claiming done.
  - **#8/#7 blank shells** are largely **DATA-gated, not render-gated**: `ipo_details` 0%, `ipo_scores` 0%,
    `subscriptions` 2.6%, `ipo_demand_graph` 0% → the existing components render honest empty-states; they fill
    once the DATA stages (D/E/F) populate. The render layer is mostly fine; the gap is data.
  - SME LISTED empty-state (C-6, page.tsx:454-459 hides ListingPerformanceCharts when listing price null) —
    minor honest-empty-state polish, still open.

## §GATE (awaiting Abhay)
- **NEW — authorize an unzip dependency** (`adm-zip` or `unzipper`) for Stage B-live: NSE/BSE
  docs are `.zip` wrappers that must be unzipped before the `%PDF` check. Guardrail forbids
  new deps without authorization. **Recommended: `adm-zip`** (sync, tiny, zero transitive deps).
- Standing set (unchanged): enable `ENABLE_PRIMARY_SOURCE_DISCOVERY` + discovery/cadence cron
  + `ENABLE_MONEYCONTROL_SUBSCRIPTION` + deploy/PM2 to activate (arrives with Stage F);
  apply any authored migrations; merge draft **PR #59**; rotate leaked prod DB password (#1).

## Shipped this run (branch `feat/ipo-data-pipeline-foolproof`, draft PR #59)
- `9cc1cf16` Stage A + A.5 · `9f17ff0b` progress · `171587f3` Stage B pure-core · + progress/deferred docs.
- Gate `node scripts/audit-ipo-coverage.mjs --gate` → PASS (exit 0). Scraper unit adds: 16 (write-guards) + 16 (discovery) + 6 (node:test stage lib), all green/reproduced.

## Remaining (each needs a specific resource — not avoidable in a no-network/no-browser session)
- **B-live** → network + tunnel + the §GATE unzip dep.
- **C / D / E** → network + tunnel (extraction from live docs; live subscription/demand/GMP; SME listing #36).
- **F** → jobs authored OFF then §GATE activation.
- **G** (#54 render etc.) → web code + **G-UI browser drive** (Playwright MCP); note web unit harness OOMs (#56/#51, out of scope §0.1) — verify #54 via the isolated chart test + a browser drive.

## DEFERRED — see `2026-06-19-ipo-data-pipeline-foolproof-DEFERRED.md`
