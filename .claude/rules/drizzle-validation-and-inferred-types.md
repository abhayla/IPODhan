---
name: drizzle-validation-and-inferred-types
description: >
  Two paired shared conventions — every table gets drizzle-zod insert/select schemas with
  domain-rule overrides in db/validations.ts, and every table ROW type is derived via
  Infer{Select,Insert}Model, never hand-authored. Hand-written interfaces are reserved for
  non-table shapes (filters, pagination).
globs: ["packages/shared/src/**/*.ts"]
version: "1.0.0"
synthesized: true
private: false
---

# Drizzle Zod Validation & Inferred Entity Types

## (A) Zod validation schemas live in db/validations.ts, paired per table
Every table MUST have a paired
`insert<Entity>Schema = createInsertSchema(schema.X, { ...overrides })` and
`select<Entity>Schema = createSelectSchema(schema.X)` from `drizzle-zod`, defined in
`packages/shared/src/db/validations.ts`. Field overrides encode the DOMAIN rules the column type
cannot express:

- foreign keys → `ipoId: z.string().uuid('Invalid IPO ID')`
- URLs → `z.string().url(...)` (e.g. `affiliateUrl`, `allotmentCheckUrl`, document `url`, registrar `website`)
- email → `z.string().email(...)`
- slug → `z.string().regex(/^[a-z0-9-]+$/, ...)`
- `issueSize` → string `.refine` capped at `999999.99` (the `NUMERIC(15,2)` ceiling, ₹999,999 crores)

Cross-field invariants are STANDALONE `.refine()` schemas, not crammed into the per-table schema —
`validatePriceRange` (min ≤ max) and `validateIPODates` (openDate ≤ closeDate). Query-string params
get their own schema using `z.coerce.number()` + `.default()` (see `historicalIPOQueryParamsSchema`
with `page`/`limit` coercion). MUST NOT validate table input with an ad-hoc inline `z.object(...)` at
a call site — extend or reuse the table's schema in `validations.ts`.

## (B) Table row types are ALWAYS inferred, never hand-written
Every table ROW type MUST be derived in `packages/shared/src/repositories/types.ts` via Drizzle's
inference: `type IPO = InferSelectModel<typeof ipos>` and
`type IPOInsert = InferInsertModel<typeof ipos>`, and the same `Select`/`Insert` pair for every other
table (`Subscription`, `GMPRecord`, `FinancialData`, `Document`, `ListingPerformance`,
`PeerCompany`, `MarketHoliday`, `Registrar`, `BrokerAffiliate`). These are re-exported through
`packages/shared/src/types/index.ts`. You MUST NOT hand-author an `interface`/`type` that mirrors a
table's columns — it silently drifts from the schema.

Composite/relation types EXTEND the inferred base rather than restating fields:
`type IPOWithRelations = IPO & { financialData?: ...; documents?: Document[]; ... }`. Hand-written
`interface`s are reserved ONLY for non-table shapes — query filters (`IPOFilters`,
`SubscriptionFilters`, `GMPFilters`), pagination (`PaginationMeta`, `PaginatedResponse<T>`), and
repository contracts. If a shape corresponds to a DB row, infer it; if it is an API/query construct,
an interface is fine.

## CRITICAL RULES
- MUST define a paired `insert<Entity>Schema` + `select<Entity>Schema` (drizzle-zod) per table in `packages/shared/src/db/validations.ts`; MUST NOT inline ad-hoc `z.object` table validation at call sites.
- MUST encode domain rules as field overrides (uuid FKs, `.url()`, `.email()`, slug regex, `issueSize` ≤ 999999.99 = NUMERIC(15,2) ceiling) and cross-field invariants as standalone `.refine()` schemas.
- MUST use `z.coerce.*` + `.default()` for query-param schemas.
- MUST derive every table ROW type via `InferSelectModel`/`InferInsertModel`; MUST NOT hand-author an interface that mirrors table columns.
- Composite/relation types MUST extend the inferred base (`IPO & {...}`); hand-written interfaces are reserved for non-table shapes (filters, `PaginationMeta`, `PaginatedResponse<T>`).
