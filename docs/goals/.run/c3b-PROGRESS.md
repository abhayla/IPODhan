# C3b — DRHP financials/peers/objectives (deterministic, NO LLM) — PROGRESS

Goal: `docs/goals/2026-06-17-c3b-drhp-financials-deterministic.md`
Branch: `feat/ipo-c3b-financials-deterministic` · Run: 2026-06-18 (autonomous `/goal`)

## Result — financial_data / peer_companies / ipos.objectives lifted from 0

| Target | Before | After | Notes |
|---|---:|---:|---|
| `financial_data` (distinct IPOs) | 0 | **144** | 100% of the 144 Chittorgarh-discoverable genuine IPOs |
| `peer_companies` (distinct IPOs) | 0 | **122** | 321 peer rows; subject row excluded per IPO |
| `ipos.objectives` (populated) | 0 | **138** | objects-of-issue with serial + amount (null when undisclosed) |
| core-financials rows (net worth + a ratio + an annual figure) | 0 | **133** | 92% of the discoverable population (DoD ≥60% ✓) |

Discoverable population = 144 of 266 genuine IPOs matched to Chittorgarh report-118.
The 122 un-discoverable genuine IPOs are the **source-capped tail** (not in report 118)
→ left NULL + DEFERRED (see c3b-DEFERRED.md). No fabricated data.

## Stages

- **A — extractors (TDD):** `extractFinancialsFromDetailHtml` / `extractPeersFromDetailHtml`
  / `extractObjectivesFromDetailHtml` in `chittorgarh-detail-fields.ts`, output-plausibility
  gated via exported `FINANCIAL_FIELD_BOUNDS`. 14 new unit tests + 11 existing = **25 green**
  on a verbatim real-page fixture. Per-FY P&L mapped to the column's TRUE fiscal year
  (interim/FY2025 columns dropped — never mislabelled into an FY2024 slot).
- **B — matrix:** every new field registered in `FIELD_PRIORITY_MATRIX` (CHITTORGARH source,
  validation bounds referencing the same `FINANCIAL_FIELD_BOUNDS`). Matrix loads, 71 keys.
- **C — backfill:** `backfill-financials-chittorgarh-detail.ts` (report-118 discovery → detail
  fetch → 3 extractors → data-persister writers; dry-run default, idempotent, enrich-only).
- **D — run + verify:** full apply 141 IPOs written, 0 failed. G-PERSIST read-back confirmed
  shape+values. **G-INDEPENDENT: 5/5 live spot-checks (Susan, Hexagon, Vidya, Yaashvi, Anubhav)
  matched the Chittorgarh page EXACTLY** and are domain-sane; loss-makers show negative
  PAT/RoNW and NULL P/E (honest, not faked).
- **E — pdfplumber enrichment:** `extract_financials_pdf.py` (sidecar, JSON only) +
  `backfill-financials-pdf.ts` (consumer). Adds the "Revenue from operations" line the compact
  HTML omits, ENRICH-only (fills NULL fields, never overwrites). pytest 5/5 on a verbatim
  Anubhav Plast RHP fixture. **Stage E apply: 81 stored-PDF IPOs processed → 3 enriched, 78
  skipped (no parseable/alignable restated-P&L → NO guessed numbers), 0 failed.** Of the 3,
  **2 kept** (Anubhav Plast, Manilam Industries — revenue_fy now populated; Anubhav rev_fy2024
  87.33 ≈ total_income 87.41) and **1 (Striders Impex) was caught by the cross-field coherence
  guard** (PDF revenue 1.70 vs total income 41.77 = a column-misparse) and its revenue NULLed in
  prod — honesty over coverage. Low yield is the documented template-variance cap (mostly SME
  prospectuses); see c3b-DEFERRED.md §3. G-PERSIST confirmed the 2 good revenue rows + that
  enrich-only never overwrote an HTML value (Anubhav netWorth 20.85 preserved).

## §GATE — awaiting Abhay (deploy-requires-approval)

- **Merge draft PR** `feat/ipo-c3b-financials-deterministic` → main.
- **No deploy / cron / flag change** performed (GATED). The data is already LIVE in prod via
  the additive tunnel backfill; the code merge does not change runtime behavior until a
  scheduled job is wired (separate decision).

## Skipped (already covered) — none
The three extractors did not exist; all targets were 0. Nothing was pre-built.
