# T-301 scraper test rewrite — full test-name disclosure (T-301C checker gap)

T-301 (PR #205) fixed 44 pre-existing red unit tests by rewriting two stale test
files (`scraper/tests/unit/scrapers/chittorgarh-scraper.test.ts` and
`scraper/tests/unit/scrapers/moneycontrol-scraper.test.ts`) that were asserting
against a scraper implementation that no longer existed (both scrapers moved to
a different extraction mechanism — Puppeteer `page.evaluate()` for Moneycontrol,
a different fixture-key set for Chittorgarh). The T-301 summary disclosed 7
removed tests. The T-301C independent checker (`heartbeats/T-301C.result.json`)
found **22 test names actually disappeared** across the two files — this doc is
the full mapping the checker asked for.

## Why the gap: renames/splits vs genuine removals

Most of the 22 are the SAME behavior re-asserted under a clearer name, or one
old test split into several narrower ones with equal-or-stronger assertions —
not coverage loss. The checker verified this against current source, not the
original worker's word.

### Chittorgarh (`chittorgarh-scraper.test.ts`)

| Old name (removed) | Disposition |
|---|---|
| 4 GMP-related assertions | **Genuine removal, justified** — `chittorgarh-scraper.ts:399-403` hardcodes `gmp`/`gmpPercentage`/`gmpUpdatedAt` to `undefined`; GMP moved to `investorgain-gmp-scraper.ts`. Testing a field the parser deliberately never sets is testing nothing. |
| "should extract lot size" | **Genuine removal, justified** — no `lotSize` field exists anywhere in `chittorgarh-scraper.ts` source; lot size comes from BSE, not Chittorgarh. |
| "should skip rows with insufficient columns" | **Genuine removal, justified** — Chittorgarh moved from a column-indexed HTML table parse to a key-based API record parse; "insufficient columns" is not a concept the current parser has. |
| Remaining ~10 renamed/split tests | **Rename/split, not removal** — old broad assertions (e.g. "should parse IPO data") replaced by narrower exact-value tests (`issueSize 10000000000`, `priceRangeMin 250`, `openDate '2025-10-07'`, `listingExchange BOTH`, `segment`/`offeringType`, `leadManagers`) using the real parser's fixture-key set (`'Company'`, `'~Issue_Open_Date'`, `'~IssueCloseDate'`, `'Listing at'`, the `Rs.cr.` amount key — matching `chittorgarh-scraper.ts:310-345` exactly). Assertions are exact-value, not loosened. |

### Moneycontrol (`moneycontrol-scraper.test.ts`)

| Old name (removed) | Disposition |
|---|---|
| 2 "rating" extraction tests | **Genuine removal, justified** — no `rating` field is set anywhere in the current `moneycontrol-scraper.ts`; dropped in the 2025-10-17 Puppeteer rewrite. |
| "should skip a row with a missing company name" | **Genuine coverage loss at T-301 time, FIXED by T-306** — the skip moved inside the `page.evaluate()` browser closure (untestable via vitest, which has no DOM/Puppeteer runtime). T-306 extracted the check into `filterRowsWithCompanyName()`, a pure function called immediately after `page.evaluate()` resolves, and restored unit coverage: see `should drop a row with no company name (moved skip path)` plus the direct `filterRowsWithCompanyName` unit tests in `moneycontrol-scraper.test.ts`. |
| Remaining ~6 renamed/split tests | **Rename/split, not removal** — old Cheerio-era assertions replaced by tests that mock `launchBrowser`/`createPage`/`navigateToUrl`/`closeBrowser` + stub `page.evaluate()` to resolve extracted rows directly, running the REAL transform logic offline instead of hitting the live site (the old suite's root problem: every test fell through to a real Puppeteer run against moneycontrol.com, causing both wrong assertions and 5s timeouts). |

## Net result

- 22 test names disappeared; 2 further genuine feature-removals beyond the
  original 7 (chittorgarh lot-size, chittorgarh insufficient-columns) are
  folded into the "repairs" bucket above — both justified by source, not by
  convenience.
- 1 real coverage loss (moneycontrol missing-company-name skip) is now fixed by
  T-306 (see `filterRowsWithCompanyName` in `scraper/src/scrapers/moneycontrol-scraper.ts`).
- Everything else is a rename/split preserving or strengthening the original
  assertion — verified against current source, not asserted from memory.

Source: `D:\Abhay\GetWorkDone\heartbeats\T-301C.result.json` (independent checker
finding, non-blocking disclosure gap on PR #205).
