# UI Redesign North Star (owner-selected references, 2026-07-02)

**Decision (Abhay, 2026-07-02):** IPODhan's UI converges on three owner-selected references.
Reference screenshots live in `test-evidence/ui-review/references/` (mobile 390 + desktop 1280).
This doc is the canonical design target — every page iteration is blind-reviewed against it.

| Reference | Governs | What we copy |
|---|---|---|
| [Screener.in company page](https://www.screener.in/company/RELIANCE/consolidated/) | IPO detail page structure | Sticky in-page ANCHOR NAV (not tabs) over flat white section cards; compact label:value ratio grid in the header; dense plain tables, right-aligned numbers; Pros/Cons two-column card; documents as plain link columns |
| [Zerodha Markets stock page](https://zerodha.com/markets/stocks/NSE/RELIANCE/) | Global visual language | Neutral-dominant palette (white cards on light-gray page bg), thin 1px dividers, generous whitespace, small readable type, ONE accent color, zero gradients/shadows/animations-as-decoration |
| [Levels.fyi India table](https://www.levels.fyi/t/software-engineer/locations/india) | All listing/history tables + filters | Sticky header row, compact scannable rows, chip filters with visible state, mobile column priority, pagination |

## Design tokens (target)

- **Page background:** light gray (`#f7f8fa`-class); content in white cards, `border` 1px `#e5e7eb`, radius 8px, NO card shadows (hover shadow only where clickable)
- **Accent:** keep IPODhan teal for brand continuity (owner may switch to Zerodha blue later); accent used ONLY for links, primary buttons, active states — never section backgrounds
- **Typography:** section titles = plain `text-lg font-semibold` (no gradients/uppercase tracking); body/table = `text-sm`; numbers right-aligned, `tabular-nums`
- **Density:** table row height ~36-40px desktop; label:value grids 2-4 cols; whitespace BETWEEN cards > padding INSIDE cards
- **Signal colors:** green/red reserved for gain/loss numbers and chips only — never whole-card borders/washes

## Page blueprints

1. **ipo-detail (Screener blueprint):** header block (name + status + apply CTA + ratio grid: issue size, price band, lot, min investment, GMP, subscription, open/close/listing dates) → sticky anchor nav (Overview · Subscription · GMP · Financials · Peers · Allotment · Documents) → flat section cards in that order. KILL: tab bar double-render, decorative gradients, per-section boilerplate intros.
2. **listing pages (Levels blueprint):** summary strip (real metrics only) → chip filters → ONE dense table (no card-section triplication of the same IPOs; Current/Upcoming become filter chips, not separate sections). Mobile: priority columns + sticky first col (shipped).
3. **home (Zerodha Markets blueprint):** compact data-first fold — live open-issues table with GMP/subscription columns when data exists; marketing cards demoted below data.
4. **history (Levels blueprint):** current table is closest to target — keep, drop card-border shouting, add benchmark strip (avg listing gain of filtered set).

## Verification contract

Blind reviewers receive: page screenshots + the 3 reference screenshots, scoring "distance from reference" alongside the 6-dimension rubric; gate stays owner's >9.5.
