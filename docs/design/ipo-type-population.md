<!-- GENERATED FILE — do not hand-edit. Regenerate with:
     node scripts/ops/generate-ipo-type-population.mjs
     Verify with --check. See docs/design/build-cards/item-30-ipo-type-table.md -->

# IPO type population — generated with live counts

Generated: 2026-09-19T16:42:52.256Z
Source: ipodhan_staging via localhost:15432

`proven_scrapable` is `live_or_recent >= 2` and nothing else — the two-live-samples bar from
docs/design/spec-deviation-guideline.md §3.2. `live_or_recent` counts rows whose status is
UPCOMING, OPEN or CLOSED, plus LISTED rows whose listing date is within 180 days —
the same window OD-35 already uses.

| segment | offering_type | issue_type | total | live_or_recent | proven_scrapable |
|---|---|---|---|---|---|
| MAINBOARD | INVITS | BOOK_BUILDING | 1 | 1 | false |
| MAINBOARD | INVITS | UNCLASSIFIED | 1 | 1 | false |
| MAINBOARD | IPO | BOOK_BUILDING | 89 | 77 | true |
| MAINBOARD | IPO | UNCLASSIFIED | 19 | 4 | true |
| MAINBOARD | NCD | UNCLASSIFIED | 4 | 4 | true |
| MAINBOARD | REITS | UNCLASSIFIED | 1 | 1 | false |
| MAINBOARD | RIGHTS | UNCLASSIFIED | 4 | 4 | true |
| MAINBOARD | TENDER | UNCLASSIFIED | 11 | 11 | true |
| SME | IPO | BOOK_BUILDING | 127 | 96 | true |
| SME | IPO | FIXED_PRICE | 23 | 18 | true |
| SME | IPO | UNCLASSIFIED | 48 | 14 | true |
| UNCLASSIFIED | BUYBACK | UNCLASSIFIED | 1 | 1 | false |
| UNCLASSIFIED | INVITS | UNCLASSIFIED | 1 | 1 | false |
| UNCLASSIFIED | IPO | UNCLASSIFIED | 10 | 10 | true |
| UNCLASSIFIED | NCD | UNCLASSIFIED | 3 | 3 | true |
| UNCLASSIFIED | OFS | UNCLASSIFIED | 19 | 19 | true |
| UNCLASSIFIED | RIGHTS | UNCLASSIFIED | 2 | 2 | true |
| UNCLASSIFIED | TENDER | UNCLASSIFIED | 5 | 5 | true |
