# T-428 — WP C-1 filing schema — plan

## New enums (checked against existing enum/table names for collisions)

- `pricing_event` — `PRICE_BAND_AD | PROSPECTUS`
- `financial_statement_basis` — `RESTATED | STANDALONE` (distinct from the existing
  `financial_statement_type` enum which is `CONSOLIDATED | STANDALONE` and backs
  `ipo_financials` — different semantics, must not collide/reuse)
- `financial_unit` — `MILLION | LAKH | CRORE`
- `acquisition_period` — `1Y | 18M | 3Y` (Postgres enum labels can't start with a digit as
  bare identifiers but ARE fine as quoted string literals — drizzle always quotes)
- `intermediary_role` — `BRLM | REGISTRAR | SYNDICATE | SPONSOR_BANK | ESCROW_BANK | PUBLIC_ISSUE_BANK`

None of these names collide with an existing pgEnum name or an existing/new table name
(checked against the full `pgEnum(` and `pgTable(` list in schema.ts, and against the 7 new
table names below).

## New tables

1. `financial_statements` — (ipoId uuid FK, fiscalYear int, basis financial_statement_basis,
   unit financial_unit, revenue/totalIncome/ebitda/pat/netWorth/epsBasic/epsDiluted/opCashFlow/
   dscr/rentExpense numeric(18,2), createdAt, updatedAt). Unique (ipoId, fiscalYear, basis).
   Index on ipoId.
2. `ipo_valuation` — (ipoId FK, pricingEvent enum, priceFloor/priceCap/sharesAtFloor/
   sharesAtCap/mcapAtFloor/mcapAtCap/peAtFloor/peAtCap numeric(18,2), peNotAscertainableReason
   text, ronwWeighted3y numeric(18,2), faceValueMultipleFloor/faceValueMultipleCap
   numeric(18,2)). Unique (ipoId, pricingEvent). Index on ipoId.
3. `promoters` — (ipoId FK, name varchar(255), sharesHeld bigint, waca numeric(18,2),
   wacaLastYear numeric(18,2), isPromoterGroup bool default false). Index on ipoId.
4. `promoter_acquisition_ranges` — (ipoId FK, period acquisition_period, waca numeric(18,2),
   capMultiple numeric(18,2), priceLow numeric(18,2), priceHigh numeric(18,2)). Index on ipoId.
5. `ipo_intermediaries` — (ipoId FK, role intermediary_role, name varchar(255), sebiRegNo
   varchar(50), contactPerson varchar(255), phone varchar(50), email varchar(255),
   grievanceEmail varchar(255)). Index on ipoId, index on (ipoId, role).
6. `brlm_track_record` — (brlmName varchar(255), asOfDate date, issues3y int,
   closedBelowIssuePrice int, sourceIpoId uuid FK -> ipos.id). Index on brlmName.
   No ipoId column per se (per DoD it keys on brlmName + sourceIpoId is the provenance FK) —
   still gets the FK+index per the "every new row-table has an ipo_id FK + index" rule via
   `sourceIpoId`.
7. `ipo_risk_factors` — (ipoId FK, seq int, heading varchar(500), body text, kpis jsonb).
   Unique (ipoId, seq). Index on ipoId.

All 7 tables: `createdAt`/`updatedAt` timestamps, `id` uuid PK defaultRandom.

## Column additions (existing tables)

- `ipos.cin` varchar(21) — nullable
- `documents.filing_date` date — nullable
- `ipo_details.designated_exchange` varchar(10) — nullable (NSE|BSE|BOTH free text, no enum
  per DoD which didn't specify one; keeping it a plain varchar avoids inventing an enum not in
  the DoD list)
- `ipo_details.lot_multiple` integer — nullable
- `ipo_details.allocation_pct` jsonb — nullable
- `ipo_details.pre_ipo_placement` boolean — nullable

## Files touched

- `packages/shared/src/db/schema.ts` — SSOT edit (enums + 7 tables + 6 columns)
- `web/drizzle/migrations/0042_wp_c1_filing_schema.sql` (+ meta/_journal.json entry) —
  drizzle-kit generate output, hand-wrapped idempotent per 0038-style convention
- `packages/shared/src/repositories/financial-statements-repository.ts`
- `packages/shared/src/repositories/ipo-valuation-repository.ts`
- `packages/shared/src/repositories/promoters-repository.ts` (covers both promoters +
  promoter_acquisition_ranges — closely related, one caller)
- `packages/shared/src/repositories/ipo-intermediaries-repository.ts`
- `packages/shared/src/repositories/brlm-track-record-repository.ts`
- `packages/shared/src/repositories/ipo-risk-factors-repository.ts`
- `packages/shared/src/repositories/index.ts` — export new classes/types
- `packages/shared/package.json` — exports map entries for each new repository file
- unit tests: one file per repository under `packages/shared/src/repositories/__tests__/` or
  co-located `*.test.ts` (matching existing convention — check before picking)
- `evidence/T-428/` — before/after drift readback

## Cache keys (inline literals, following `{entity}:{operation}:{identifier}`, same convention
as `field-sources-repository.ts` — shared package repos do not import web's cache-keys.ts)

- `financial-statements:ipo:{ipoId}`
- `ipo-valuation:ipo:{ipoId}`
- `promoters:ipo:{ipoId}`
- `promoter-acquisition-ranges:ipo:{ipoId}`
- `ipo-intermediaries:ipo:{ipoId}`
- `brlm-track-record:name:{brlmName}`
- `ipo-risk-factors:ipo:{ipoId}`

TTL: reuse `FINANCIAL_DATA`-equivalent 1800s conceptually (inline literal `1800`, since shared
package doesn't import web's `CacheTTL`).

## Verification sequence

1. `cd packages/shared && npx tsc`
2. `cd web && npx drizzle-kit generate` → hand-wrap the emitted SQL idempotent, rename file to
   `0042_wp_c1_filing_schema.sql`, fix journal.
3. `node --test scripts/tests/migration-name-collision.test.mjs` (live gate reads the journal
   automatically — no manual "extension" needed beyond adding the new migration to the journal)
4. Replay: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` on ipodhan_test → `npx drizzle-kit migrate` → `SCHEMA_DRIFT_IGNORE_GATED=1 npm run audit:schema-drift` (root) → save evidence.
5. Repository unit tests (mocked db).
6. Full gates once: shared tsc, web tsc --noEmit, pr-gate.yml steps, scraper vitest, web vitest.
