# Lane C item 2 slice 6 follow-up — 3-FY report-82 reprobe + detail-page check

Fetched Chittorgarh report 82 (`webnodejs.chittorgarh.com/cloud/report/data-read/82/{page}/10/{year}/{range}/0/{category}/0`)
for FY2024-25, FY2025-26, FY2026-27, both `mainboard` and `sme`, paginating until an empty page (up to 55 pages
for FY2025-26 SME). Row counts (deduped by Company anchor): 2024 mainboard 92, 2024 sme 240, 2025 mainboard 103,
2025 sme 267, 2026 mainboard 82, 2026 sme 149.

## Positive controls (matcher proven working, not just "ran without error")
- FY2025-26: "Gujarat Kidney & Super Speciality Ltd." row present in report 82 → staging DB confirms
  `status=LISTED, listing_date=2025-12-29`.
- FY2025-26: "Modern Diagnostic & Research Centre Ltd." row present → staging DB confirms `status=LISTED,
  listing_date=2026-01-06`.
- FY2026-27: "A-One Steels India Ltd." and "S.K.Offset Ltd." rows present → staging DB confirms both
  `status=UPCOMING` with matching listing dates (2026-09-30, 2026-09-29).
- (FY2024-25 controls "Indo Farm Equipment"/"Unimech Aerospace" are in the report row but absent from the
  staging DB — staging does not retain that far back; the report row's own real Opening/Listing dates serve as
  the control for that year instead.)

## Per-company result

| Company | Found in any FY (24/25/26)? | Issue Price / band | Detail URL | Verdict |
|---|---|---|---|---|
| BANGANGA PAPER INDUSTRIES LTD | No | — | none found; site search (`chittorgarh.com/?s=Banganga+Paper`) returns no company-specific link; guessed slug `banganga-paper-industries-ipo` 307-redirects (does not exist); report-82 `search=` query param is a no-op server-side (echoes an unrelated top row) | UNSOURCEABLE (no reachable page) |
| MARUTI INTERIOR PRODUCTS LTD | No | — | none found; same site-search and slug-guess methods failed as above | UNSOURCEABLE (no reachable page) |
| MUTHOOT FINCOTP LIMITED | No | — | not present in any of the 3 fiscal years, either category | UNSOURCEABLE (absent from report 82 across 3 FYs; not re-tried via site search this round — budget) |
| NIRBHAY COLOURS INDIA LTD | No | — | not present in any of the 3 fiscal years, either category | UNSOURCEABLE (absent from report 82 across 3 FYs; not re-tried via site search this round — budget) |
| STANBIK AGRO LIMITED | **Yes — FY2025-26, SME** | Report 82: "30.00"; detail page confirms **Issue Price ₹30 per share** (verbatim: "issue price at ₹30 per share") | `https://www.chittorgarh.com/ipo/stanbik-agro-ipo/2602/` | **REPAIRABLE — real price exists (₹30, single value not a band)** |

## Notes
- Report 82 rows use a single "Issue Price (Rs.)" column that is sometimes a band ("119.00 to 125.00", e.g.
  S.K.Offset) and sometimes a single fixed price ("30.00" for Stanbik Agro) — Stanbik's own IPO had no band, it
  priced at a flat ₹30.
- Only Stanbik Agro was reachable this round; the other 4 remain unsourced from Chittorgarh report 82 (3 full
  fiscal years) and from Chittorgarh site search. This does not prove they are absent from Chittorgarh entirely
  (e.g. they could be listed as delisted/SME-migrated under a different registered name) — that would need a
  separate probe, not run here under the 15-min budget.
