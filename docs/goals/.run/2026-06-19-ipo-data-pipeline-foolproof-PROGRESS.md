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
- [ ] **B/E/F unblocked** (A.5 gate green) — not yet started this session.
- [ ] **B** — primary-source discovery spine (searchNSE/searchBSE/searchSEBI + .zip unzip + doc_type)
- [ ] **C** — extraction from own docs (extend C3b to DRHP/RHP PDFs) + #54 financial-field reconcile
- [ ] **D** — live OPEN-window scrape (subscription/demand/GMP tiered cadence)
- [ ] **E** — post-close listing + allotment (SME listing price #36)
- [ ] **F** — self-sustaining automation (auto-discovery + stage-transition + cadence jobs, flags OFF)
- [ ] **G** — render (#54/#8/#7/#58 + DemandGraph wire-in + honest empty-states)

## §GATE (awaiting Abhay) — populated as stages complete
- (tbd)

## DEFERRED — see `2026-06-19-ipo-data-pipeline-foolproof-DEFERRED.md`
