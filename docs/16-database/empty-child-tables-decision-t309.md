# Empty child tables — decision record (T-309, round-6 review P3)

**Source finding:** T-305 round-6 review — `ipo_details`, `ipo_scores`,
`ipo_reviews`, `anchor_investors`, `ipo_financials` are all EMPTY for all 242
IPOs. No scraper writes `ipo_details`, so the `FIXED_PRICE` exemption in
`collectDegeneratePriceBandFields()` (`scraper/src/services/
data-consolidation-service.ts:145`, T-308/price-band territory — not touched
by this task) can never fire, and the `/dashboard` "All Scores" filter can
never match an IPO.

## Decision, per table

| Table | Decision | Why |
|---|---|---|
| `ipo_details` (issue_type) | **(b) retire/defer, tracked** | No currently-LIVE-WIRED scraper source captures a book-building-vs-fixed-price signal. Verified by direct grep: NSE's `issueType` cell and BSE's `issueType: undefined` are both used only for **offering-type** classification (IPO/OFS/RIGHTS/TENDER via `detectOfferingType()`), a different axis from the `issue_type` enum (`BOOK_BUILDING \| FIXED_PRICE \| HYBRID`). The only place this signal is human-visible is the Chittorgarh **detail page** ("Issue Type: Bookbuilding"), which is fetched TODAY only by a manual backfill script (`historical-ipo-assembler.ts` / `ingest-historical-ipo.ts`), never by the live 30-min cycle. Deriving it from the price band itself is unsafe — that is precisely the ambiguity the P1 finding describes (a collapsed band is indistinguishable from a genuine fixed-price issue by shape alone). Wiring a NEW per-IPO detail-page fetch into the live cycle to capture this one field is a new scraping capability, not a "minimal" write of an already-carried field — out of scope for this task's "no speculative scrapers" constraint. **Tracked as a backlog issue** (below) instead of built here.
| `ipo_scores` | **(b) docs note** | Computed/derived score, not a scraped field — belongs to a web/scoring service (T-310 territory), not the scraper. The `/dashboard` "All Scores" filter is dead until that service exists; flagged here so it is not mistaken for a scraper gap.
| `ipo_reviews` | **not a gap** | User-submitted content by design — empty is the correct state until users submit reviews.
| `anchor_investors` | **(b) backlog** | Chittorgarh publishes an "Anchor Investors" report, but it is a distinct report/endpoint from anything the live cycle currently fetches — a new scraper, out of scope here.
| `ipo_financials` | **(b) backlog** | Distinct from `financial_data` (already populated: 0->144 via the C3b Chittorgarh+pdfplumber pipeline). `ipo_financials` needs its own extractor — a new scraper, out of scope here.

## What this task did NOT do (and why)

This task did **not** modify `data-consolidation-service.ts` (the `FIXED_PRICE`
exemption itself) — that file is T-308's price-band territory, explicitly
off-limits per the T-309 contract. Retiring or fixing the exemption is T-308's
call, made with full context of the price-band guard it lives inside.

## Backlog

Filed as GitHub issues so the gap is tracked, not silently dropped:
- `ipo_details.issue_type` writer — wire a Chittorgarh per-IPO detail-page fetch
  (reusing the existing pure extractors in `chittorgarh-detail-fields.ts`) into
  the live cycle, scoped to `issue_type` only, so the `FIXED_PRICE` exemption
  becomes reachable in prod.
  [#222](https://github.com/abhayla/IPODhan/issues/222)
- `anchor_investors` writer — new Chittorgarh Anchor Investors report extractor.
  [#223](https://github.com/abhayla/IPODhan/issues/223)
- `ipo_financials` writer — new extractor, distinct from `financial_data`.
  [#224](https://github.com/abhayla/IPODhan/issues/224)
