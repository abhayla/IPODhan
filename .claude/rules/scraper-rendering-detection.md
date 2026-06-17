---
name: scraper-rendering-detection
description: >
  Enforces the scraper's auto rendering-strategy detection — detectRenderingType()
  picks Cheerio for static HTML and Puppeteer for JS-rendered pages — so new
  scrapers don't hardcode (and pay for) a browser when a fetch+parse suffices.
globs: ["scraper/src/scrapers/**/*.ts", "scraper/src/utils/scraper-utils.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Scraper Rendering Detection — Cheerio vs Puppeteer

Source pages differ: some serve data in the initial HTML (parse with Cheerio,
~10x cheaper), others render it client-side (needs a Puppeteer browser). The
scraper utilities detect which at runtime instead of hardcoding per source.

## Use the auto-detection helpers

`scraper/src/utils/scraper-utils.ts` exposes the contract:

```typescript
import { detectRenderingType, scrapeWithAutoDetection } from '../utils/scraper-utils.js';

// detectRenderingType fetches raw HTML and checks if `testSelector` is present:
//   selector found  -> 'STATIC'  (Cheerio path)
//   selector absent -> 'DYNAMIC' (Puppeteer path)
//   fetch failed    -> 'DYNAMIC' (fail safe to the browser)
const $ = await scrapeWithAutoDetection({ url, testSelector: '#ipo-table tbody tr' });
const rows = $('#ipo-table tbody tr');
```

- New scrapers SHOULD obtain their Cheerio instance via `scrapeWithAutoDetection`
  rather than calling `fetch` + `cheerio.load` or launching Puppeteer directly
- The `testSelector` MUST be a selector that exists ONLY when the target data has
  rendered — that is the signal the page is usable as static HTML
- MUST NOT default a new source to Puppeteer "to be safe"; that triples run cost.
  Detection already fails over to `DYNAMIC` when the static fetch can't find the
  data, so static-first is both faster and correct

## Why it matters

- Static (Cheerio) runs are far cheaper and have no browser to crash/leak; reserve
  Puppeteer for pages that genuinely need JS execution
- Log lines from detection (`Static HTML rendering detected` /
  `JavaScript rendering required`) carry `url` + `selector` — keep them so a source
  silently switching rendering mode is visible in logs (see `structured-logging.md`)
