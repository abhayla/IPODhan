---
name: financial-column-precision
description: >
  Enforces precise numeric typing for money/share columns in the shared Drizzle
  schema — numeric() for fractional rupee values and bigint mode:'number' for
  share counts — so scraper updates never truncate or float-corrupt financial data.
paths: ["packages/shared/src/db/schema.ts", "packages/shared/src/db/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Financial Column Precision

IPO data is money and share counts. The schema (`packages/shared/src/db/schema.ts`,
~99 `numeric()` columns) types these for exact precision rather than lossy floats.
Adding a financial column with the wrong type silently corrupts values when
scrapers write large or fractional numbers.

## Typing rules for new columns

- Fractional rupee values (price, GMP, issue size in Cr, ratios) MUST use
  `numeric('col', { precision, scale })` — pick a `scale` that holds the
  fractional rupees/paise the field needs
- Whole share counts that can exceed 2³¹ (shares bid, shares offered, cut-off
  shares) MUST use `bigint('col', { mode: 'number' })` — the `mode: 'number'` is
  required so Drizzle returns a JS number, not a string

```typescript
// ✅ fractional money — exact
issueSize: numeric('issue_size', { precision: 12, scale: 2 }),
// ✅ large counts — bigint surfaced as a number
sharesOffered: bigint('shares_offered', { mode: 'number' }),
```

- MUST NOT use `real`/`doublePrecision`/JS `float` for money — binary floats
  can't represent decimal rupee values exactly and drift across updates
- MUST NOT use plain `integer` for share counts that may overflow `int4`
- Omitting `mode: 'number'` on `bigint` returns a string and breaks every
  downstream calculation/formatter that expects a number

## Where this connects

- Schema lives ONLY in `packages/shared/src/db/schema.ts` (see `schema-imports.md`);
  add the column there, then run the migration workflow
- Values typed here flow into the KPI formatters (see `web-display-formatting.md`),
  which assume real numbers — a stringified bigint renders as `NaN`/garbage
