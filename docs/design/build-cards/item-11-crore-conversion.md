# Item 11 — the crore conversion (OD-20) and `financial_data` becomes derived

## Purpose

Every genuinely rupee-denominated aggregate amount column converts to crore (OD-20: *"Crore should
be the default for every amount column"*), `financial_data` stops being a hand-written table with
hard-coded FY2022–FY2024 columns and becomes a projection computed from `financial_statements`
(closing the live Annu Projects defect, §0.9), and the public API serves both shapes for one release
so nothing breaks the day this ships.

## Serves

`docs/design/data-sourcing-pull-model.md` §5.2 (O-2, OD-20), §0.8 (money in four units), §0.9 (the
live `financial_data` defect), §7.1 item 11. Owner fork **O-12** (five `RUPEES_KEPT` exceptions) —
this card proceeds on the design's recommendation and is marked provisional where noted.

## Files

**Read this session; every line number below is current.**

| Path | State | Change |
|---|---|---|
| `packages/shared/src/db/schema.ts:285` | exists | `ipos.issueSize` — widen comment, no precision change (already `precision:18,scale:2`); value repaired from rupees to crore |
| `packages/shared/src/db/schema.ts:1112-1113` | exists | `ipoDetails.freshIssue`, `ipoDetails.ofsIssue` — same table, rupees → crore, no precision change |
| `packages/shared/src/db/schema.ts:1743-1744` | exists | `ipoValuation.mcapAtFloor`, `ipoValuation.mcapAtCap` — rupees → crore, no precision change |
| `packages/shared/src/db/schema.ts:513-570` | exists | `financialData` table — **no column added/removed**; the table becomes populated by a derivation, not by `financial-data-scraper.ts`'s regex writer (below). Already crore at the writer level — see Schema section |
| `packages/shared/src/db/schema.ts:1682-1712` | exists | `financialStatements` — **unchanged**. Already carries a per-row `unit` enum (`MILLION`/`LAKH`/`CRORE`); this is the source of truth item 11 derives from, not a conversion target |
| `packages/shared/src/db/schema.ts:339` | exists | `ipos.objectives` (jsonb, `IPOObjective[]`) — the `amount` field is typed `// Amount in crores` but the writer below does not enforce it. New reader normalizes; old rows stay readable |
| `packages/shared/src/db/schema.ts:1312-1316` | exists | `IPOObjective` interface — add a schema-versioned wrapper, see Schema |
| `scraper/src/scrapers/objectives-scraper.ts:158,182,208` | exists | Regex captures `(?:Cr\|Crore\|crore\|Lakhs\|lakh)?` as an **optional** trailing unit and stores the bare number regardless — a Lakh-denominated objective is stored under a `// Amount in crores` type with no conversion, unlike `financial-data-scraper.ts:128` which does convert. Fix: require the unit capture group, route through `toCrore`-equivalent, refuse (not guess) when no unit is printed |
| `scraper/src/services/filing-persister.ts:678-698,887-897,1301-1310,1734,1751,1774` | exists | `freshMn`/`ofsAtCapMn` → `ipos.issueSize`/`ipoDetails.freshIssue`/`ipoDetails.ofsIssue`/`ipoValuation.mcapAtFloor/mcapAtCap` all call `toRupees(value, unit)` (line 267) today; `financialData.*` already calls `toCrore(value, unit)` (line 272). **This file already has the unit-aware conversion helpers this item needs (`toRupees`, `toCrore`, `convertUnit`, lines 231-282) — reuse them, do not write new ones.** `ENABLE_FILING_AUTO_PERSIST` defaults `false` (`feature-flags.ts:212`) and this session found no prod override, so this path is not live — see the O-12/live-defect note below |
| `packages/shared/src/repositories/financial-data-repository.ts:33-52` | exists | `findByIPO` reads the stored `financial_data` row directly. Becomes: read `financial_statements` rows for the IPO, pick the 3 most recent fiscal years by `basis` (RESTATED preferred, `checkCrossDocumentAgreement` in `cross-document-agreement.ts` already establishes the basis precedence), convert each via `toCrore(value, row.unit)`, shape into the existing `FinancialData` type |
| `scraper/src/scrapers/financial-data-scraper.ts` (296 lines) | exists | Becomes dead code once the repository derives instead of reading a scraper-written row — **retire the writer, keep the file until the following release's cleanup** (matches the one-release-overlap rule below) |
| `web/app/api/ipos/[slug]/financials/route.ts:105-133` | exists | Serves `financialRepository.findByIPO(ipo.id)` verbatim — the exact route §0.9 evidenced (`GET /api/ipos/annu-projects-ltd/financials` showing FY2024 while the document says FY2026). No route code change needed if the repository now derives; the **response is what changes** (5 fiscal years become reachable instead of 3) |
| `web/lib/utils.ts:22,31-39,48-53` | exists | `RUPEES_PER_CRORE`, `formatIssueSizeCrores`, `formatIssueSizeCroresBare` — divide a rupee input by 10,000,000. Once `ipos.issueSize` is crore, these divide an already-crore value by 10,000,000 again (silently wrong by 7 orders of magnitude) unless retired/repointed |
| `web/components/ipo/IssueStructureSection.tsx:67-71` | exists | `fmtCrore()` does its own inline `v / 10000000` for `valuation.mcapAtFloor`/`mcapAtCap` (lines 271-272) — same defect, private to this component |
| `web/lib/utils/kpi-formatters.ts:18-24` | exists | `formatMarketCap()` — takes an **already-crore** value, no division. Feeds `financial_data.marketCap` via `KPIHighlightSection.tsx:193` — unaffected by this item (financial_data is already crore, see Schema) |
| `web/app/api/ipos/listings/route.ts:262-264` | exists | `marketCap: issueSize * (currentPrice / issuePrice)` — a ratio calc; output is in `issueSize`'s unit. Silently changes from rupees to crore the day `ipos.issueSize` converts. Consumer: `IPOListingsTable.tsx:222` (`formatNumber(ipo.marketCap)`, a bare-number formatter with no unit awareness — must be re-labelled) |
| `web/lib/services/ipo-scoring-realtime.ts:390-396` | exists | `calculateFundamentals()` compares `Number(ipo.issueSize)` against `1000`/`500`/`100` — thresholds that only make sense in **crore**. Today, with `issueSize` in rupees (min 50,000 per §0.8), every row is `> 1000` and this component is a silent always-max no-op. **The crore conversion activates this scoring component for the first time in production** — a behaviour change, not a bug fix, and it changes every IPO's fundamentals sub-score. Call this out to QA/PM explicitly; it is not covered by this item's own tests |
| `web/lib/utils/rating-calculator.ts:164-168` | exists | Same pattern, same thresholds (`>= 1000`, `>= 500`, `< 100`), same currently-dormant behaviour, same activation risk |
| `web/app/api/ipos/route.ts:86,293` | exists | `sortBy=issueSize` — sorts on the raw column value; ordering is unaffected by a uniform unit change (monotonic transform), no code change, listed for completeness |
| `web/app/api/admin/ipos/route.ts`, `web/app/api/admin/ipos/[id]/route.ts` | exists | Admin CRUD on `ipos`/`ipo_details`/`ipo_valuation` — reads/writes the raw column. Needs the admin edit form (`web/app/admin/edit/[slug]/page.tsx`) relabelled rupees→crore in the same release, or an admin can type a rupee-scale number into a crore-scale column |
| `web/lib/admin/field-labels.ts`, `web/lib/admin/dynamic-validation-rules.ts`, `web/lib/admin/schema-introspector.ts` | exist | Admin metadata describing these columns' display unit and validation bounds — bounds written for rupee-scale values need updating to crore-scale or every admin edit fails validation |
| `scripts/lib/repair-invariants/<NEW>.mjs` | NEW | Per-column repair-held invariant, pattern copied from `scripts/lib/repair-invariants/issue-size-t451.mjs` (87 lines, reads expected values from a JSON fixture, diffs against live `ipos`/`ipo_details`/`ipo_valuation`) |
| `scripts/repair-crore-conversion.mjs` | NEW | The repair tool itself — see Schema |

## Schema

**No new tables. No precision changes** — every genuinely-rupee column already sits at
`numeric(18,2)` (widened by T-504/#402 for exactly this reason, per the comment at
`schema.ts:1106-1110`), which comfortably holds a crore-scale value. `npm run db:generate` produces
no DDL for the five genuinely-converting columns; it is a **data migration**, not a schema migration.

**What the design's §5.2 table does not distinguish, and this card does — read the code before
repairing anything:**

1. **Genuinely stored in rupees today (real conversion, real repair needed):** `ipos.issueSize`
   (`filing-persister.ts:703` calls `toRupees`), `ipoDetails.freshIssue`/`ofsIssue`
   (`filing-persister.ts:893,896`, `toRupees`), `ipoValuation.mcapAtFloor`/`mcapAtCap`
   (`filing-persister.ts:1304,1308`, `toRupees`, and the `F7 UNIT CONTRACT` comment at line 1300
   says outright: *"ipo_valuation.mcap_at_floor/mcap_at_cap are stored in RUPEES, while
   financial_data.market_cap... is stored in CRORE. Same source number, two different
   denominations"*). **5 columns, 3 tables.**
2. **Already crore at the writer level, by convention, not by type** — `financial_data.*` (19
   columns; `financial-data-scraper.ts:128` divides Lakh values by 100 and its regex only matches
   `Cr|crore` literals, and `filing-persister.ts:1734,1751,1774` calls `toCrore` explicitly),
   `ipo_financials.*` (6 columns, same convention, no code path found writing it from a
   non-crore source this session — **flagged, not verified**: no writer for `ipo_financials.*` was
   found under `scraper/src`; if one exists outside the paths this session searched, its unit
   assumption needs the same check before this item ships), `anchor_investors.totalAmountRaised`
   (§0.8 measures it directly as crore, 12.81–216.00). **These 26 columns need no data repair** —
   only the formal "CRORE" classification, which the probe already assigns. Applying the repair
   tool to them is wasted work at best and a bug at worst if it assumes rupees.
3. **Stored in the document's own unit, per row, and never normalised** — `financial_statements.*`
   (7 columns; `unit` enum, `filing-persister.ts:1029,1221` — 55 rows MILLION, 10 rows LAKH per
   §0.8). **This table does NOT convert.** It stays multi-unit by design (`convertUnit` exists
   precisely so two rows in different units can be compared, `filing-persister.ts:281`). The crore
   conversion happens **only** at the point `financial_data` is derived from it (below).

`ipos.objectives` — not numeric, jsonb. Add a schema-versioned wrapper so an old un-normalized row
(pre-fix, unit ambiguous or wrong) is distinguishable from a new normalized one:
```typescript
// packages/shared/src/db/schema.ts — replace the IPOObjective export
export interface IPOObjective {
  sno: number;
  description: string;
  amount: number | null;        // ALWAYS crore from schemaVersion 2 onward
  amountUnit?: 'CRORE' | 'UNKNOWN'; // absent/undefined = schemaVersion 1 (pre-fix, unverified unit)
}
```
No migration needed (jsonb is schemaless); the reader (below) treats a row with no `amountUnit` as
`UNKNOWN` and does not render a crore label it cannot back.

**Destructive DDL:** none. This item drops no column. `financial_data`'s FY2022-2024 columns "stay
untouched" per the existing comment at `schema.ts:1680` — this item does not contradict that; it
changes who **writes** them (a derivation instead of a scraper), not their shape. Dropping them is a
future, separate, gated migration under `web/drizzle/migrations/_gated/` — **the design does not
say when**, and this card does not invent that date.

## Interfaces

```typescript
// packages/shared/src/db/financial-data-derivation.ts — NEW
// Corrected this session: there is no exported `FinancialStatements` type in
// packages/shared/src/db/types.ts (checked — absent). The real row type is
// `FinancialStatementRow`, exported from the REPOSITORY file, with string-typed
// numeric columns (drizzle numeric() -> string, not number) —
// packages/shared/src/repositories/financial-statements-repository.ts:24-41.
import type { FinancialStatementRow } from '../repositories/financial-statements-repository';
import { toCrore } from '../../../scraper/src/services/filing-persister'; // OR: hoist toCrore/RUPEES_PER_UNIT
                                                                            // into packages/shared so both
                                                                            // scraper and web can import it
                                                                            // without a cross-workspace reach
                                                                            // into scraper/src — see Fork below

export interface DerivedFinancialData {
  ipoId: string;
  revenueFy1: number | null; revenueFy2: number | null; revenueFy3: number | null; // 3 MOST RECENT fiscal years
  profitFy1: number | null;  profitFy2: number | null;  profitFy3: number | null;  // present, not fixed FY2022-24
  ebitdaFy1: number | null;  ebitdaFy2: number | null;  ebitdaFy3: number | null;
  totalIncomeFy1: number | null; totalIncomeFy2: number | null; totalIncomeFy3: number | null;
  netWorth: number | null;   // latest fiscal year
  marketCap: number | null;  // carried from ipo_valuation.mcapAtCap, converted crore (see F7 UNIT CONTRACT note)
  fiscalYearsUsed: [number, number, number]; // e.g. [2024, 2025, 2026] — makes §0.9's defect impossible
                                              // to reintroduce silently: the years are DATA, not column names
}

/** Reads financial_statements, sorts by fiscalYear desc, takes 3, converts unit -> crore per row. */
export function deriveFinancialData(
  statements: FinancialStatementRow[]
): DerivedFinancialData | null;
```

**A genuine naming fork (design does not say):** the OLD `financial_data` columns are named
`revenueFy2022` etc. (year baked into the name); the NEW derivation is year-agnostic
(`revenueFy1`/`Fy2/Fy3` = "most recent / next / oldest of the 3", not a calendar year). The one-release
overlap (below) must therefore serve **both shapes** at once on the SAME route:
`{ revenueFy2022, revenueFy2023, revenueFy2024, revenueFy1, revenueFy2, revenueFy3, fiscalYearsUsed }`.
The design does not name the new field set — this card proposes `Fy1/Fy2/Fy3` + `fiscalYearsUsed`
above; **flagged as a fork for owner sign-off before the API contract is frozen.**

```typescript
// scripts/repair-crore-conversion.mjs — NEW, CLI contract
// Usage: node scripts/repair-crore-conversion.mjs --table ipos --column issue_size [--apply] [--slug X]
//   Dry-run (default): for every row in <table> where <column> looks rupee-scale (per the SAME
//   c_issue_size_floor/consistency-style magnitude check, reused not reinvented — see Detection),
//   re-read the value from its ORIGINAL SOURCE via field_sources (the document if DOC-sourced, the
//   exchange payload if NSE/BSE-sourced) and print { slug, column, storedRupees, resourcedCrore,
//   source, willWrite: boolean }. A row whose field_sources entry cannot be re-fetched (source URL
//   gone, document purged) is printed with willWrite:false and NEVER guessed via /10000000 — that
//   arithmetic is exactly how a share count became a rupee amount once (F-54's class) and cannot be
//   trusted to reverse cleanly either.
//   --apply: writes the resourced crore value + a fresh field_sources row per column (provenance:
//   'REPAIR', timestamp now). Never touches a row it could not re-source.
export {};
```

## Feature flag

**None new.** This is a data + API-shape migration, not a scraper behaviour change — there is no
"per-cycle" decision to gate. Guarded instead by:
- The one-release API overlap (below) IS the rollback mechanism — no flag needed because both shapes
  are live simultaneously.
- The repair tool's own `--apply` gate (dry-run default) is the write-time guard.
- `ENABLE_FILING_AUTO_PERSIST` (`feature-flags.ts:212`, default `false`) already gates whether
  `filing-persister.ts`'s `toRupees`/`toCrore` calls run at all in prod today. **This item does not
  change that flag's default** — it only means the fields it writes (when the flag eventually turns
  on) are already unit-correct. If `ENABLE_FILING_AUTO_PERSIST` is still `false` in prod when this
  item ships, the repair tool is the ONLY path that populates crore-scale values for rows currently
  written by whatever non-filing path put rupee values there (**the design does not say what that
  path is** — this session found no scraper writer for `ipoDetails.freshIssue`/`ofsIssue` other than
  `filing-persister.ts`, so the live wrong values §5.2 describes for Kanohar/Glass Wall either predate
  a removed code path or were written while the flag was briefly on. **Flagged as an open question
  for the owner**, not invented an answer for.)

## Tests

- `packages/shared/tests/unit/financial-data-derivation.test.ts` (NEW) — red before the change:
  `deriveFinancialData([...])` given `financial_statements` rows in MILLION, LAKH and CRORE units
  each converts correctly (assert against `toCrore` computed independently in the test, not by
  copy-pasting the implementation); given 5 fiscal years, returns the 3 most recent; given a row
  where `basis` disagrees (RESTATED vs STANDALONE) for the same year, prefers RESTATED (matches
  `filing-persister.ts:1023-1027`'s own precedence comment).
- `scraper/tests/unit/scrapers/objectives-scraper.test.ts` (extend existing, or NEW if none exists —
  **check before writing**: this session did not find one under `scraper/tests/unit/scrapers/`)
  asserting a Lakh-suffixed objective converts to crore and a no-unit-suffix objective is REFUSED
  (not silently stored as crore) — this is the regression guard for the defect at
  `objectives-scraper.ts:158`.
- `web/tests/unit/lib/utils/issue-size-formatter.test.ts` (existing file, extend) — asserts
  `formatIssueSizeCrores` is either retired (test asserts the export no longer exists / throws) or
  repointed to accept an already-crore input, whichever the API-overlap decision below picks.
- `scripts/tests/repair-crore-conversion.test.mjs` (NEW) — dry-run on a fixture DB produces the
  correct diff and writes nothing; `--apply` writes exactly the resourced value and a `field_sources`
  row; a row with no re-fetchable source is left untouched and reported.

## Detection

**New check**, `docs/reviews/detection-checks/c_amount_column_unit_drift.json` — asserts, per CRORE
column, that the live distribution's median falls inside a plausible crore-scale band for its
segment (reusing the `c_issue_size_floor` pattern already proven for `ipos.issue_size`:
`docs/reviews/detection-checks/c_issue_size_floor.json`, MAINBOARD floor Rs10,00,00,000 /
SME floor Rs1,00,00,000 — the same floors, restated once conversion makes the column crore-native,
become "SME median < 1.0 crore is implausible" instead of the current rupee-scale threshold). This
is the check that would catch a FUTURE write path reintroducing a rupee value into a now-crore
column — the exact recurrence class item 14 exists to guard against, applied here pre-emptively
because item 11 creates six NEW columns where that class can recur (`ipos.issueSize`,
`ipoDetails.freshIssue/ofsIssue`, `ipoValuation.mcapAtFloor/mcapAtCap`, and `ipos.objectives[].amount`).
Runs in the nightly audit (`scripts/audit-detection-floor.mjs`, alongside `c_issue_size_*`).

## Staging proof

- **Migration/derivation proof:** deploy to staging, then read
  `GET https://staging.ipodhan.com/api/ipos/annu-projects-ltd/financials` and confirm the response
  carries FY2025/FY2026 (closing §0.9) — the exact log line: the route's own response body, field
  `fiscalYearsUsed` containing `2025` or `2026`.
- **Repair proof (mandatory per `defect-fix-contract.md` item 5):**
  `node scripts/assert-repair-held.mjs scripts/lib/repair-invariants/crore-conversion.mjs --cycles 2`
  against staging — invariant module (pattern-copied from `issue-size-t451.mjs`) checks a named set
  of repaired rows' crore values against an expected-value fixture captured at repair time, fails if
  a subsequent scraper cycle reintroduces a rupee-scale value.
- **API-overlap proof:** staging response for a repaired IPO carries BOTH the old field (old unit,
  unchanged value) and the new crore field, same route, same response, until the following release.

## Rollback

**Reversible with effort, not cleanly reversible once served** (per §7.2: *"item 11... once the
public API has served the new shape"*). Before the API-overlap release: revert the repair tool's
writes per-row via the `field_sources` history it wrote (previous value + source recorded for every
field it touched) — a scripted rollback, not a blanket restore, because rows repaired after the
rollback point must not be undone. After the API-overlap release ships and the old field is retired
(the following release): rollback requires re-adding the old field to the API for one more release,
not simply reverting a commit — **this is the point of no clean return**, and it is why the old field
stays live for a full release rather than being retired same-day.

## Tier, budget and cost

**Tier A** (migrations, prod deploy, own release per §7.1). Depends on item 10 (verification checks)
per §7.1's dependency table.
`Budget: 60 min wall-clock, 120 tool calls` for the implementation task that follows this card
(not this card itself). Cost: this is explicitly called out in §7.1 as "large, own release" — expect
2 review rounds (Tier A default 1, escalate to 2 on any CRITICAL/MAJOR finding per
`.claude/rules/engineering-roles.md` review-tier rule) given the six file-classification distinctions
this card had to work out that the design's flattened table did not carry.

## Rules implemented

9 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §5.2 | R-105, R-106, R-107, R-108, R-109, R-110, R-111, R-112, R-113 |

## Known gaps

- **F-95 (MAJOR) — The crore conversion silently activates a dormant scoring bug: every IPO currently scores as the largest possible.** Carried here rather than closed: the conversion activates a dormant scoring bug on every IPO at once; it is a release-note and threshold-recalibration item, deliberately not fixed ahead of the conversion. Not fixed in the design (OD-47); it is this item's to close.

- **F-77 (MAJOR) — web/lib/utils/rating-calculator.ts has the identical dormant-threshold-activation defect as ipo-scoring-realtime.ts (tracked as F-95), but item 11 documents it without adding it to the fix scope, tests, or detection.** Carried here rather than closed: rating-calculator.ts carries the identical dormant-threshold defect as ipo-scoring-realtime.ts; both files, one test, one release note. Not fixed in the design (OD-47); it is this item's to close.

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
