# PROGRESS — IPO data completeness (`/goal` run)

**Branch:** `feat/ipo-data-completeness` (off `docs/ipo-data-completeness-goal` @ `53bf6477`). **Owner:** this session (IPODhan162), started 2026-06-16.
**Contract:** `docs/goals/2026-06-16-ipo-data-completeness.md`. **Tunnel:** `localhost:15432` UP.
**Draft PR:** https://github.com/abhayla/IPODhan/pull/34 (Stage A; NOT merged — §GATE).

## §0.2 PREFLIGHT (done 2026-06-16)

**Coverage baseline (fresh `node scripts/audit-ipo-coverage.mjs` via tunnel, 301 IPOs):**
- Inventory: 6 UPCOMING / 15 OPEN / 186 CLOSED / 91 LISTED (24 LISTED-MAINBOARD + 67 LISTED-SME). 3 null-segment.
- Child tables: subscriptions **1.0%** (3); gmp_records **6.0%** (18); ipo_demand_graph / financial_data / ipo_financials / documents / listing_performance / peer_companies / ipo_scores / ipo_details / anchor_investors / ipo_reviews = **0%**.
- Core cols: price_min/max 88%, lot_size 55.1%, allotment_date 1%, listing_date 34.2%, registrar 28.2%, symbol 43.5%, objectives 0%, issue_size 100%, face_value 100%.
- Name smells: **3** ("Horizon Reclaim (India) Ltd. CT" [OPEN], "Susan Electricals India Ltd. P" [CLOSED], "Utkal Speciality Industries India Ltd. P" [CLOSED]). Duplicate groups: **0** (GMP/BSE dedup already cleaned).
- **Audit-script bug:** queries non-existent cols `industry`/`logo`/`description` (ERROR rows) — fix when extending to `--gate`.

**Prior contracts (defer, don't duplicate):**
- **GMP (`2026-06-14`)** — CLOSED/DEPLOYED/VERIFIED. Coverage 3→17-19, `*/30` cron self-sustaining, dedup done, all 3 gated migrations APPLIED, PRs #18/#20/#21 merged. **C1 = verify-only.** Open delta = none (Advit-Jewels ingestion gap is upstream, out of scope).
- **BSE (`2026-06-15`)** — core rebuilt on JSON API + live subscription capture; draft **PR #26 merged to main**, flag `ENABLE_BSE_API` **OFF**, current-board backfill **never run against prod**. Historical mass-backfill correctly BLOCKED (detail endpoint lacks `IR_flag` → would re-pollute corp actions). **C2 = verify + run current-board delta only (gated on flag for live; manual backfill allowed).**

**Structural facts established (ground truth, not assumed):**
- `offering_type` enum (schema.ts:26): IPO, FPO, RIGHTS, OFS, IPP, QIP, PREFERENTIAL, NCD, BONDS, INVITS, REITS, BUYBACK, DELISTING, TENDER. **Real-IPO set = `['IPO']`** (covers MAINBOARD + SME; SME IPOs are offering_type=IPO, segment=SME).
- Non-IPO surfaces (OFS/NCD/Rights/FPO) have **listing pages only, NO `[slug]` detail route**; the sole detail route is `/ipos/[slug]`. Their services query with an **explicit `offeringType`** and do **not** link to `/ipos/[slug]` → 404-ing all non-IPO on the IPO detail route is SAFE (no regression), and a default IPO-only listings filter won't touch them (they pass explicit type).
- De-pollution consumer map (full surface set): `ipo-repository.ts` `findAll`(:110), `findAllWithDetails`(:738), `getIPOListings`(:1402, category=null→ALL currently unfiltered = pollution vector); detail-page `NON_IPO_CORPORATE_ACTIONS`(page.tsx:168, only TENDER/BUYBACK/DELISTING → must become the shared predicate).
- Name normalizer (`company-name-normalizer.ts`) already strips trailing 1-2 letter codes for NEW rows, but 3 existing rows predate it → need a corrective re-normalization pass (additive UPDATE via tunnel, slug re-derived via `generateIPOSlug`).

## EXECUTION STRATEGY (honest, context-aware)
Stage A is highest-leverage + fully autonomous + no §GATE → execute fully this session with TDD + G-UI/G-PERSIST/G-INDEPENDENT. Stages B/C/D: run cheap high-value deltas (e.g. listing-performance backfill if writer works), DEFER multi-day pipelines (DRHP financials) with reason + issue. Keep this ledger current; never fake-complete.

## Stage A — de-pollute + normalize (CORE DONE — A5 deferred)
| Task | Status | SHA | Notes |
|---|---|---|---|
| A0 branch + ledger | DONE | — | this file |
| A1 shared `isRealIPO()`/`REAL_IPO_OFFERING_TYPES` predicate (TDD) | **DONE** | f1b03e2b | shared util + exports map + index; 4 unit tests (incl. every-enum-value completeness) |
| A2 apply predicate: findAll + count + findAllWithDetails(calendar) + getIPOListings(ALL) default IPO-only; detail page + generateMetadata 404 non-IPO | **DONE** | f1b03e2b | list↔detail parity. **G-UI proven**: OFS `bank-of-maharashtra` → 404; real IPOs → 200 |
| A3 verify DuplicateDetectionService blocks already-listed re-creation | **DONE (verify — no code)** | — | FINDING: the prod pipeline *intentionally* disables the dedup symbol-gate (`createProductionPipeline` `skipDuplicateDetection:true`, data-validation-pipeline.ts:281) because it false-positived on every already-known IPO → GitHub #3 zero-records bug. The real scrape-time pollution guard is **offering_type protection (PR #25/#27, merged)** + normalized-name upsert matching. Re-enabling the blunt symbol-gate would regress #3 → NOT done (correct). Display predicate (A2) = safety net. |
| A4 name normalizer: strip trailing status-code on create (`sanitizeCompanyName`) + corrective backfill of 3 prod rows | **DONE** | 105b86bf | TDD (strip + don't-over-strip); backfill via tunnel, read-back residual=0, slugs unchanged. Gate name-quality 3→0 |
| A5 registrar canonicalization | **DEFERRED** | — | Bigger than the contract example: ~28 variants → ~8 real registrars (KFin ×6 spellings, Bigshare ×4 incl. typo "Servies", several with embedded address/contact junk e.g. `"…^Subramanian Building…"`, `"Tel.: +91…"`). Needs a canonical-mapping dictionary + consolidation-layer wiring + careful backfill (mis-map risk). See DEFERRED file. |
| A6 price band single-value render (`formatPriceBand` SSOT) | **DONE** | f630e759, 6c599d4d | TDD; wired **6** render sites (InfoSection, IPOCard, IPOCardEnhanced, IPODetailsTable, LotDetailsSection, SMEContentSections×2, CSVExporter). **G-UI caught an incomplete first sweep** (3 sites missed) → fixed all. Proven: susan `₹127` everywhere, aequs `₹118 - ₹124`, 0 console errors |
| A7 extend audit → `--gate` (exit 1 on miss) + fix non-existent column bug | **DONE** | f1b03e2b | real-IPO populations; `company_description` fix; exit codes verified (1 on FAIL, 0 report) |

**Stage A gate state (G-INDEPENDENT, reproduced):** ALL 3 Stage A invariants **PASS** — `pollution.surfaceLeak==0`, `name-quality.smells==0`, `duplicates.groups==0`. Coverage thresholds correctly FAIL (Stage B/C pending — honest). Evidence screenshot: `docs/goals/.run/2026-06-16-stageA-priceband-collapsed-susan.png`.

## Stages B / C / D — HANDED OFF (not started this session)
Stage A (de-pollution + price-band correctness + machine gate) was the highest-leverage, fully-autonomous, no-§GATE slice and is delivered+verified+committed. B/C/D remain — most need a backfill RUN and/or are §GATE (flag-enable/deploy). Concrete next steps in the DEFERRED file. Notable: **B1 listing_performance 0/91** (backfill `scraper/src/scripts/backfill-listing-performance.ts` exists — diagnose dark-job vs matcher vs never-run, then run via tunnel like A4); **C1 GMP** verify-only (its contract is CLOSED+DEPLOYED); **C2 BSE** flag OFF + current-board backfill never run.

## SESSION 2 (2026-06-16 PM, off `main` post Stage-A+BSE merge) — C3a documents DELIVERED + root-cause corrections

**Re-measured coverage (tunnel, 263 genuine IPOs):** core fields improved post-BSE-merge (lot_size 71%, registrar 59%, symbol 68%, price 94%, issue_size 100%); child tables still ~0% except gmp 7.2%, subscriptions 1.1%. Pollution invariant holds (surfaceLeak=0). Name smells back to 3 — the create-time `sanitizeCompanyName` fix is MERGED but **not deployed** to the prod scraper (§GATE), so re-scrapes reintroduce " CT"/" P"; A4 backfill is only a temporary patch until deploy.

**DELIVERED + VERIFIED — C3a documents (the keystone, 4-section unblocker):**
- NEW `scraper/src/scrapers/chittorgarh-document-scraper.ts` (parse/classify DRHP/RHP/Prospectus + report-20 fetch) + 9 unit tests (TDD red→green) + `scraper/scripts/backfill-chittorgarh-documents.ts` (dry-run default, idempotent, matches isin→symbol→normalized-name, persists via `DocumentRepository.upsertDocuments`).
- Applied additively via tunnel: **documents 0% → 30.8% (81/263 genuine IPOs)**, real prospectus PDF URLs (company sites, bsesme.com, nseindia archives), 74 PROSPECTUS + 7 RHP, extractionStatus PENDING. G-PERSIST (audit + pg read-back) + G-INDEPENDENT (substance: correct company↔URL) PASS. Unblocks the DISCOVERY half for objectives/peers/anchor jobs (their `findByIPO` now returns rows); PDF EXTRACTION (C3b) remains deferred.

**ROOT-CAUSE CORRECTIONS (evidence-backed; the prior ledger's assumptions were wrong):**
- **B1 listing_performance 0%** — NOT "backfill never run". The existing backfill's NSE path is *structurally incapable*: NSE `/api/public-past-issues` (1364 records, 48/91 of our candidates match by symbol) returns **ZERO `listingPrice` for any record** — the field NSE never populates. Needs a real listing-PRICE source (BSE quote via scrip-code, which we don't store). Diagnostic committed: `scraper/scripts/diagnose-listing-performance.ts`. → DEFERRED (see DEFERRED file).
- **C3a bulk DRHP** — BSE detail page is now a JS SPA (static fetch = 12.5KB shell, 0 fields/0 doc-links → `bse-detail-scraper`/`scrapeBSEIPODetailWithDocuments` dead for live pages). Chittorgarh report-20 JSON is a "latest-N" widget (pagination non-functional; only perPage 5/10 honoured) → it yields ~91 recent PDFs (81 matched, the win above) but NOT the full archive. Full-archive discovery (correct paginated/search endpoint, or SEBI registry) is the deferred multi-session piece.
- **B6 ipo_scores 0%** — input-starved: the rating-calculator needs financials/subscriptions/peers (all ~0%) AND there's no compute→`ipo_scores` persist wiring. DEFERRED until inputs exist.

## MEASURED DoD VERDICT (machine gate, 2026-06-17) — `node scripts/audit-ipo-coverage.mjs --gate`
**Goal satisfied ⟺ this gate exits 0.** Current: **exit 1, GATE FAIL (7 checks below threshold).**
- **Stage A correctness invariants — ALL PASS:** pollution.surfaceLeak=0, name-quality.smells=0 (fixed this turn via the corrective `backfill-clean-company-names.ts --apply` over the 3 " CT"/" P" rows; slugs unchanged; read-back residual=0), duplicates.groups=0.
- **Remaining 7 = coverage thresholds, NONE autonomously closable in-session:**
  - listing_performance 0/91 (needs BSE-quote source build — B1, multi-session)
  - subscriptions 3/105 (needs BSE live path + flag/deploy — §GATE)
  - gmp_records 5/11 current (GMP contract's cron is deployed; upstream ingestion gap)
  - core.registrar 59%, core.lot_size 71%, core.allotment_date 0.8%, core.symbol 79% LISTED
    (these are scraper-populated; reaching threshold needs the writers ACTIVATED in prod = deploy/§GATE,
    plus historical sources that are otherwise corp-action-pollution-unsafe)
  - core.listing_date 100% LISTED — PASS.
**Conclusion:** the gate cannot advance further without (a) §GATE prod deploy/flag-enable to run the
writers, or (b) the multi-session source builds (B1 BSE-quote, C3a bulk DRHP, C3b extractor). The
autonomous run has closed every non-gated, in-session-completable check.

## Skipped (already covered)
- GMP coverage revival (C1) — CLOSED+DEPLOYED by its own contract (PRs #18/#20/#21, `*/30` cron); verify-only.

## §GATE (needs Abhay)
- (none reached this session — Stage A used only code + a corrective tunnel backfill, both allowed.)

## DEFERRED
- A5 registrar canonicalization; Stages B/C/D backfills + activations — see `…-DEFERRED.md`.
