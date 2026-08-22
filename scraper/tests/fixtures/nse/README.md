# NSE live payload fixtures (T-266)

Captured from the real endpoints on **2026-08-22 ~11:35 IST** (see
`D:\Abhay\GetWorkDone\evidence\2026-08-22-T-266\nse-raw-capture.json` for the
raw HTTP capture, status codes and the capture script).

| File | Endpoint | What it proves |
|---|---|---|
| `ipo-current-issue.live-2026-08-22.json` | `/api/ipo-current-issue` | The payload has **no `bidDetails` array** — the field `transformSubscriptionData()` used to iterate. Its `noOfTime` is the **NSE-only** figure. |
| `ipo-active-category-AUGMONT.live-2026-08-22.json` | `/api/ipo-active-category?symbol=AUGMONT&issueType=ipo` | The real category table + the **consolidated (whole-market)** total. |
| `ipo-active-category-TEMPSENS.live-2026-08-22.json` | same, TEMPSENS | ditto |

## Why `ipo-active-category` is the whole-market figure

Arithmetic from this exact capture, cross-checked against what production was
displaying at the time (BSE-only, per the T-264 review):

| IPO | NSE-only (`ipo-current-issue.noOfTime`) | BSE-only (what the site showed) | Sum | `ipo-active-category` Total |
|---|---|---|---|---|
| AUGMONT | 1.79018 | 0.95 | **2.74018** | **2.74015** |
| TEMPSENS | 13.70394 | 7.95 | **21.65394** | **21.65620** |

The sum of the two exchange-only figures reproduces the `ipo-active-category`
total to within rounding of the displayed BSE value. So:

* `ipo-current-issue` -> `EXCHANGE_ONLY` (NSE side of the book)
* BSE API -> `EXCHANGE_ONLY` (BSE side of the book)
* `ipo-active-category` -> `CONSOLIDATED` (both books) — this is what an
  investor means by "subscribed N times", and the only figure the site may show
  as the whole-market number.

## Parsing note

Category rows must be keyed on **`srNo`**, not on the category text. The text is
ambiguous: `Individuals(Other than RIIs)` (srNo `2.1(b)`) contains the word
"Individuals" and a naive `includes('INDIVIDUAL')` match assigns it to Retail.
`Others` appears three times under three different parents. `srNo` is the only
unambiguous key.

Refresh procedure: re-run the capture script in the evidence directory while an
IPO is open, and re-save with the capture date in the filename. Keep old
fixtures — they are regression anchors.

## Reading the suite result on this branch

`npx vitest run` in `scraper/` reports **43 failures** on this branch. All 43 are
pre-existing on `origin/main` and live in files T-266 does not touch:
`chittorgarh-rights-debt-adapter.test.ts`, `chittorgarh-scraper.test.ts`,
`moneycontrol-scraper.test.ts`, `validators.test.ts`.

`validators.test.ts` is the only one whose source file T-266 also edits, so it was
baselined explicitly — `scraper/src/utils/validators.ts` was reverted to
`origin/main` and the suite re-run:

| `validators.ts` at | Result |
|---|---|
| `169284d7` (pre-T-266) | 18 failed / 34 passed (52) |
| `d22f7b2e` (post-T-266) | 18 failed / 34 passed (52) |

Identical. The T-266 edit to that file is additive only — two optional numeric
fields and an optional `coverage` enum on `ScrapedSubscriptionSchema` — while the
failures are in `generateSlug` and `ScrapedIPOSchema`.

T-266's own tests are green: 23/23 across
`t266-nse-subscription-parser.test.ts`, `t266-nse-active-category-wiring.test.ts`
and `t266-subscription-coverage-guard.test.ts`.
