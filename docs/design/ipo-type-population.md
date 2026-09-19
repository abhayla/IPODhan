<!-- GENERATED FILE — do not hand-edit. Regenerate with:
     node scripts/ops/generate-ipo-type-population.mjs
     Verify with --check. See docs/design/build-cards/item-30-ipo-type-table.md -->

# IPO type population — generated with live counts

Generated: 2026-09-19T17:00:41.107Z
Source: ipodhan_staging via localhost:15432

`scraper_owned` is the owner's boundary (guideline §5); `sample_sufficient` is the two-per-type
evidence threshold (§3). A type is scrapable only when BOTH are true.

`sample_sufficient` is `live_or_recent >= 2` and nothing else — the two-live-samples
bar from docs/design/spec-deviation-guideline.md §3.2. `live_or_recent` counts rows whose status
is UPCOMING, OPEN or CLOSED, plus LISTED rows whose listing date is within 180 days —
the same window OD-35 already uses.

| segment | offering_type | issue_type | total | live_or_recent | sample_sufficient | scraper_owned |
|---|---|---|---|---|---|---|
| MAINBOARD | INVITS | BOOK_BUILDING | 1 | 1 | false | false |
| MAINBOARD | INVITS | UNCLASSIFIED | 1 | 1 | false | false |
| MAINBOARD | IPO | BOOK_BUILDING | 89 | 77 | true | true |
| MAINBOARD | IPO | UNCLASSIFIED | 19 | 4 | true | true |
| MAINBOARD | NCD | UNCLASSIFIED | 4 | 4 | true | false |
| MAINBOARD | REITS | UNCLASSIFIED | 1 | 1 | false | false |
| MAINBOARD | RIGHTS | UNCLASSIFIED | 4 | 4 | true | true |
| MAINBOARD | TENDER | UNCLASSIFIED | 11 | 11 | true | false |
| SME | IPO | BOOK_BUILDING | 127 | 96 | true | true |
| SME | IPO | FIXED_PRICE | 23 | 18 | true | true |
| SME | IPO | UNCLASSIFIED | 48 | 14 | true | true |
| UNCLASSIFIED | BUYBACK | UNCLASSIFIED | 1 | 1 | false | false |
| UNCLASSIFIED | INVITS | UNCLASSIFIED | 1 | 1 | false | false |
| UNCLASSIFIED | IPO | UNCLASSIFIED | 10 | 10 | true | false |
| UNCLASSIFIED | NCD | UNCLASSIFIED | 3 | 3 | true | false |
| UNCLASSIFIED | OFS | UNCLASSIFIED | 19 | 19 | true | false |
| UNCLASSIFIED | RIGHTS | UNCLASSIFIED | 2 | 2 | true | false |
| UNCLASSIFIED | TENDER | UNCLASSIFIED | 5 | 5 | true | false |
