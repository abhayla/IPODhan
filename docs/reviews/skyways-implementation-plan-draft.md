# Skyways audit — implementation plan (DRAFT, keyed to ★ recommendations)

**Status: DRAFT.** Built from the ★ column of `skyways-field-decisions.md`. The owner's **Final value** column overrides every line here; the plan is re-cut once that column is filled. Nothing in this file is implemented.

Scope: one batch, one PR per work-package below (each < 400 lines, reviewable alone), landed in order. Every package ships a red-then-green test and a detection upgrade (nightly audit check) per the round-7 detection-gap rule.

## WP1 — Status flips at 17:00 IST on close_date (Units 1, 29)
- `web/lib/services/status-updater-service.ts`: replace the date-only/UTC state machine with an IST-aware one: `CLOSED` when `now_IST >= close_date 17:00`; `OPEN` from `open_date 10:00`.
- `scraper` conflict resolver: a date-derived `CLOSED` outranks any scraper's `OPEN` (NSE kept reporting OPEN after close).
- Test: state machine at 16:59 / 17:00 / 17:01 IST on close day; UTC-vs-IST boundary at 05:29 IST next day.
- Detection: nightly audit fails if any IPO is `OPEN` with `close_date < today_IST` or `close_date = today_IST and hour >= 17`.

## WP2 — BSE core API as first-class source (Units 4, 7, 10, 24, 33)
- `scraper/src/scrapers/bse-*`: consume `GetMkt_ISSUE_BBS_IPO?IPO_NO=` fully — parse BRLM **and every** `#`-separated Co-BRLM (bug: only the first co-BRLM survives today); tick size; market timings; UPI cut-off; `Prospectus_GID` / `Corrigendum` / `Addendum` / `Price_Band_Advertisement` links → `documents` rows (type RHP / CORRIGENDUM / ADDENDUM / PRICE_BAND_AD).
- Field-priority matrix: `open_date`, `close_date` → `ADMIN > BSE > NSE > MONEYCONTROL` (NSE was a day early on Skyways for five days); `lead_managers` → `ADMIN > BSE > DRHP > NSE`.
- Discovery job: BSE links first; NSE `issueInfo` second with retry ×3 + backoff; company-site and Chittorgarh as last fallbacks; run every 30-min cycle for OPEN/UPCOMING IPOs that still have 0 documents (not once per 24 h).
- Test: fixture of the Skyways BSE payload → 3 lead managers, 4 document links; retry path on a stubbed timeout.
- Detection: nightly audit FAIL if any IPO with status OPEN has 0 `documents` rows, or has fewer lead managers than the BSE payload lists.

## WP3 — Issue-size resolver: gross vs net (Unit 5)
- Resolver learns that BSE `Issue_Size_No_of_shares` is **net of anchor**; convert to gross (+ anchor portion) before comparing, or compare only like-with-like. A gap > 5 % must never be labelled `AUTO_RESOLVED_VALUES_CONVERGED`.
- Price Band Ad / RHP value becomes primary once extracted (WP4); NSE second.
- Test: Skyways numbers (5,828,000,000 vs 4,082,536,800 + anchor 1,26,48,000 × 138) reconcile; a genuine 30 % gap raises CRITICAL, not "converged".

## WP4 — Extraction wired into the prod cycle (Units 8, 11, 12, 16–21, 23, 27, 30, 34) + D4 retention
- Behind `ENABLE_DRHP_EXTRACTION` (default off; owner flips): each cycle picks ONE `documents` row with `extraction_status = PENDING` and type in {RHP, CORRIGENDUM, PRICE_BAND_AD, DRHP}, downloads to `scraper/data/prospectus/<ipo_id>/`, runs the existing pdfplumber extractor (`scraper/src/services/drhp-extractor.ts` — delete the fake-endpoint downloader, keep the extractor), writes `ipo_details`, `financial_data`, `peer_companies`, `ipos.objectives`, `isin`, `lead_managers`, timeline dates; sets `extraction_status = DONE|FAILED` with the error.
- Rules learned from Skyways: read the **latest** filing first (Corrigendum > RHP for dates; Price Band Ad > RHP for band/₹ sizes/P-E/mcap); `[•]` is "not yet priced", not a failure; category table must checksum to the total offer; financial period = the RHP's (FY24–26), never the DRHP's when an RHP exists; image-only chapters → use the MD&A / Basis-for-Offer-Price duplicates; post-issue promoter % stored as `computed`.
- **D4 retention:** `PROSPECTUS_RETENTION_DAYS=7` (env, default 7); a cycle step deletes `scraper/data/prospectus/<ipo_id>/` where `close_date + N days < today`; `documents` rows and extracted data stay; deletion logged per IPO.
- Test: Skyways RHP + Corrigendum + PBA fixtures (page text) → the exact values in `skyways-rhp-values.md`; retention step deletes a fixture dir dated 8 days after close and leaves one dated 6 days.
- Detection: nightly audit FAIL if any IPO listed > 3 days ago has RHP in `documents` but `financial_data` empty; WARN on any `documents` row PENDING > 48 h.

## WP5 — Page fixes (Units 13, 14, 19, 26, 35, 36)
- Subscription dashboard: pass `showAdvanced` so category / heat-map views render.
- "Awaiting data" strip: list only sections that a running writer can fill (drop broker reviews until a writer exists).
- Fix #242 (`sector` phantom field) so NSE sector populates.
- Schema: apply migration 0033 to prod (and find out why `assert-migrations-applied.sh` did not block the deploy); drop dead `ipos.gmp*`, `ipos.price_band_*`; single lead-manager path (remove `ipo_details.lead_managers` or make it the only one).
- Field-source writer: never record a `field_sources` row for a null value (Unit 12 bug).

## Order and gates
WP2 → WP3 → WP4 → WP1 → WP5. Each: Sonnet implementer (clear spec + tests) except WP4 (Opus — multi-file design), Opus fresh-context review, Fable verifies, PR, CI green, merge. Deploy is the owner's call. After the batch: re-run this audit on the next IPO that closes; success = 0 recurrences of the classes above.
