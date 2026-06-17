---
name: web-display-formatting
description: >
  Enforces the web app's single source of truth for displaying IPO financial KPIs
  and dates — the kpi-formatters and date-formatter modules — so currency, ratios,
  percentages, and dates render consistently (₹/en-IN, IST, null → 'N/A'/'TBA').
globs: ["web/app/**/*.tsx", "web/components/**/*.tsx", "web/lib/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Web Display Formatting — KPI & Date SSOT

All user-facing financial metrics and dates MUST be rendered through the shared
formatters. Never inline `toLocaleString`, `Intl.DateTimeFormat`, manual `₹`
concatenation, or hand-rolled null checks in components — they drift and produce
inconsistent display (missing rupee symbol, wrong timezone, `null`/`NaN` leaking
to the UI).

## Financial KPIs → `web/lib/utils/kpi-formatters.ts`

This module is the SSOT for every financial number. Each formatter returns
`'N/A'` for `null`/`undefined` and uses the Indian numbering system (`en-IN`).

```typescript
import { formatCurrency, formatMarketCap, formatRatio, formatChange } from '@/lib/utils/kpi-formatters';

formatMarketCap(5000)      // "₹5,000 Cr"
formatCurrency(45.2)       // "₹45.20"
formatRatio(3.25)          // "3.25x"
formatChange(-8.3)         // "-8.3%"   (always signed)
formatCompactNumber(1.5e7) // "1.50 Cr"
```

- MUST use the domain-specific wrappers where they exist: `formatEPS`, `formatPE`,
  `formatROE` (they delegate to the base formatters with the correct precision)
- MUST NOT reimplement rupee/Cr/Lakh/`x`/`%` formatting inline — extend
  `kpi-formatters.ts` instead and reuse it

## Dates → `web/lib/utils/date-formatter.ts`

IPO dates render in IST (`Asia/Kolkata`), format `DD MMM YYYY`, with `'TBA'` as
the null fallback (not blank, not `Invalid Date`).

```typescript
import { formatIPODate, getAccessibleDate } from '@/lib/utils/date-formatter';

formatIPODate('2025-10-09')                       // "09 Oct 2025"
formatIPODate(null)                               // "TBA"
formatIPODate('2025-10-09', { includeTimezone: true }) // "09 Oct 2025 (IST)"
getAccessibleDate('2025-10-09')                   // "9 October 2025"  (for aria-label)
```

- MUST pair the short visual date with `getAccessibleDate()` in `aria-label` for
  screen-reader accessibility — that is why both functions exist
- MUST NOT construct dates without `timeZone: 'Asia/Kolkata'` — IPO listing/close
  dates are India-market dates and shift a day if rendered in the browser locale
