# PROGRESS — IPO data completeness (`/goal` run)

**Branch:** `feat/ipo-data-completeness` (off `docs/ipo-data-completeness-goal` @ `53bf6477`). **Owner:** this session (IPODhan162), started 2026-06-16.
**Contract:** `docs/goals/2026-06-16-ipo-data-completeness.md`. **Tunnel:** `localhost:15432` UP.

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

## Stage A — de-pollute + normalize (IN PROGRESS)
| Task | Status | Notes |
|---|---|---|
| A0 branch + ledger | DONE | this file |
| A1 shared `isRealIPO()`/`REAL_IPO_OFFERING_TYPES` predicate (TDD) | pending | shared util |
| A2 apply predicate to findAll/findAllWithDetails/getIPOListings default + detail 404 | pending | list↔detail parity |
| A3 verify DuplicateDetectionService blocks already-listed re-creation (root cause) | pending | scrape-time |
| A4 name normalizer: re-normalize 3 existing rows + slug re-derive (corrective backfill) | pending | JS↔SQL agreement test already green |
| A5 registrar canonicalization | pending | consolidation layer |
| A6 price band single-value render (kpi-formatters `formatPriceBand`) | pending | ₹174–₹174 → ₹174 |
| A7 extend audit script → `--gate` (exit 1 on threshold miss) + fix industry/logo/description bug | pending | machine DoD |

## Skipped (already covered) — running list
- GMP coverage revival (C1) — CLOSED+DEPLOYED by its own contract; verify-only.

## §GATE (needs Abhay) — running list
- (none yet)

## DEFERRED — running list
- (tracked in `…-DEFERRED.md`)
