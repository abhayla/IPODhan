# C3b — DEFERRED (honest gaps, with reasons — NO fabrication)

Goal: `docs/goals/2026-06-17-c3b-drhp-financials-deterministic.md`

Per rule 20 (epistemic honesty) + goal-anchored honesty: a value that cannot be sourced
deterministically is left NULL and recorded here, never guessed.

## 1. Source-capped tail — 122 genuine IPOs not in Chittorgarh report-118
The detail-page extractor reaches the 144 IPOs that report-118 discovery covers (~54% of the
266 genuine IPOs). The other 122 are older / SME issues absent from report-118, so they have no
`/ipo/<slug>/<id>/` discovery entry. **Reason:** discovery source cap, identical to the
lot/registrar tails (`docs/goals/.run/2026-06-17-DEFERRED-source-capped-coverage-tails.md`).
**Unblock:** a paginated Chittorgarh endpoint or a second discovery source (SEBI / NSE / BSE
issue registry), then re-run the idempotent backfill.

## 2. Schema fixed FY columns (FY2022–2024) cap recent IPOs
`financial_data` has only `*_fy2022/2023/2024` columns. A 2025/2026 IPO's restated table reports
FY2025/FY2024/FY2023 — only FY2024/FY2023 land; FY2025 has no slot and is dropped (NOT
mislabelled into FY2024 — honesty). **Unblock:** add `*_fy2025`/`*_fy2026` columns (schema
migration = DBA/deploy §GATE) + a generalized per-FY render. Deferred (no migration in scope).

## 3. Revenue-from-operations only where the RHP PDF is parseable (Stage E)
The compact detail HTML carries "Total Income" but not "Revenue from operations"; Stage E fills
revenue from the stored RHP PDFs. Only the ~81 stored-PDF IPOs are candidates, and the
deterministic sidecar aligns columns only when the RHP restated-P&L header is unambiguous.
Template-variant RHPs (scanned, multi-column-merged, non-March fiscal year) are **skipped — no
guessed numbers**. **Unblock:** per-template parser rules, or the documented LLM last-resort
(separate future goal — explicitly OUT of scope here).

## 4. Out of scope by contract (separate later goals)
- **anchor_investors** — separate page + ~1-day-pre-open timing.
- **Bulk RHP-PDF discovery beyond the 81** — `documents` is capped at the 81 already stored
  (C3a-bulk goal).
- **LLM PDF fallback** for garbled/scanned RHPs — documented last resort, not built (Abhay: try
  free OSS first; pdfplumber tier delivered).
- **Web detail-page render/UX** for the now-populated sections — C-tier later goal.

## 5. Fields neither Chittorgarh HTML nor the RHP carries
`current_ratio`, `quick_ratio`, `inventory_turnover`, `roce` (no schema column), and
`promoter_holding` for IPOs whose detail page omits the valuation table — left NULL where the
source does not publish them.
