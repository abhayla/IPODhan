# Item 4 — per-field validation before the write (OD-21)

## Purpose

After this ships, every extracted field is validated on its own, against a date-scoped,
offering-type-scoped configuration rule, **before** it is allowed to win a write — a field that
fails is dropped and recorded with enough detail to debug without re-running anything, while every
other field on the same document still gets written; nothing is all-or-nothing, and a value the
current rule set was never written to judge is recorded and kept, not silently blanked.

## Serves

- **OD-21** (§5.3) — *"Go with your recommendation"*: per-field validation before the write, the
  failing field dropped with its cause, rank 2 asked, no timed retry. §5.3 states plainly: *"This is
  no longer 'the cheap half' of anything; it is the whole of build item 4."*
- **§7.1 item 4** — depends only on item 2 (the manifest/config file family this item's rules live
  in), not on item 6 (the pull walk) — so this item lands as a real improvement to the CURRENT
  production write path (`consolidateField`) immediately, not only inside a walk that does not exist
  yet.
- **F-10** — closed by the date-range field on every rule (see Interfaces). Without it, a rule
  correct today rejects a correct 2022 row (`listing ≤ close + 3 working days` when T+6 applied
  before December 2023) or accepts a wrong one (`face_value ∈ {1,2,5,10}` applied to an NCD priced
  at 1,000).
- **`signal-ownership.md` R6** — *"Any logged failure MUST carry the underlying cause... A failure
  that cannot be classified from its own row is a defect of the logger."* The failure row's `cause`
  column is `NOT NULL` for exactly this reason.
- **`defect-fix-contract.md`** — this item is itself a write-path change, so its own PR needs a
  `Class:`/`Proof:` line: the class is every extracted field on every table item 1 makes writable,
  across every offering type and every historical date; the proof is the staging line named below.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/config/validation-rules.yaml` | **NEW** (`scraper/config/` (NEW) created by item 2; this is the second file in that "family") | One entry per validation rule: id, `appliesTo` (table/column), `offeringTypes`, `segments`, `validFrom`/`validTo`, `assertion` |
| `scraper/config/validation-rules.schema.json` | **NEW** | JSON Schema (draft-07) for the file above |
| `scraper/src/config/validation-rules-loader.ts` | **NEW** | `loadValidationRules()` — same parse-validate-throw contract as item 2's `loadFieldManifest()`, called from the same `scraper/src/index.ts` call site, right after it |
| `scraper/src/services/field-extraction-validation.ts` | **NEW** | `validateFieldValue(params): FieldValidationOutcome` — the actual rule evaluator; pure function, no DB access, so it is unit-testable without a database |
| `scraper/src/services/field-extraction-failures-repository.ts` (NEW) (+ the `web/lib/repositories/` mirror, per the existing field-sources/data-conflicts pairing) | **NEW** | Repository over the new `field_extraction_failures` table: `recordFailure(...)`, `markResolved(ipoId, tableName, fieldName, rowKey)` |
| `scraper/src/services/data-consolidation-service.ts` | exists, 2340 lines | `consolidateField` (line 983) calls `validateFieldValue` immediately after `const rules = getFieldRules(fieldName);` (currently line 1017) and before `normalize(fieldName, incomingValue, rules)` (line 1019) — see Interfaces for the exact gate |
| `packages/shared/src/db/schema.ts` | exists, 1970 lines | New table `fieldExtractionFailures` — see Schema. Inserted after `dataConflicts` (ends line 1475) and before `financialStatements` (line 1682), matching the file's existing "one write-path table, then its relations" grouping |

## Schema

```typescript
// packages/shared/src/db/schema.ts — NEW, after dataConflicts (line 1475)

// ==================== TABLE 22b: FIELD_EXTRACTION_FAILURES (OD-21) ====================
// One row per field that a validation rule rejected before it could be
// written. Distinct from `data_conflicts` (which logs two DIFFERENT sources
// disagreeing on a value both consider valid) — this table logs a single
// source's value failing a rule outright, regardless of whether anything
// else disagrees with it.

export const fieldExtractionFailures = pgTable(
  'field_extraction_failures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id')
      .notNull()
      .references(() => ipos.id, { onDelete: 'cascade' }),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    fieldName: varchar('field_name', { length: 100 }).notNull(),
    // Item 1's row_key. NOT NULL with an empty-string sentinel, exactly as items 1 and 5 define it.
    // CORRECTED 2026-09-09 (F-78): an earlier draft made this nullable with the comment "null for
    // singleton tables", which silently breaks the very join the comment promises — `NULL = ''` is
    // false in SQL, so a failure row for a singleton table would never match its field_sources row.
    // ('' for ipos and every singleton child table;
    // populated for financial_statements/promoters/anchor_investors/etc.
    // rows, matching field_sources.row_key exactly so the two tables join).
    rowKey: varchar('row_key', { length: 200 }).notNull().default(''),

    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    // nullable: a class-T/X/M field (e.g. `status`, real-time subscription
    // numbers) can fail a rule with no document behind the value at all.
    documentSha256: char('document_sha256', { length: 64 }),

    ruleId: varchar('rule_id', { length: 100 }).notNull(), // matches validation-rules.yaml's `id`
    rankAttempted: scraperSourceEnum('rank_attempted').notNull(), // which source produced the rejected value
    extractedValue: text('extracted_value'), // truncated to 2,000 chars at the write site, never reshaped
    cause: text('cause').notNull(), // plain words — signal-ownership.md R6, never null

    occurredAt: timestamp('occurred_at').defaultNow().notNull(),
    // Set when a later rank (or a later cycle) supplies a value for the SAME
    // (ipoId, tableName, fieldName, rowKey) that passes validation — the row
    // is kept, never deleted, so the history of what was tried is provable.
    resolvedAt: timestamp('resolved_at'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_field_extraction_failures_ipo_id').on(table.ipoId),
    fieldNameIdx: index('idx_field_extraction_failures_field_name').on(table.fieldName),
    ruleIdIdx: index('idx_field_extraction_failures_rule_id').on(table.ruleId),
    unresolvedIdx: index('idx_field_extraction_failures_unresolved')
      .on(table.ipoId, table.tableName, table.fieldName)
      .where(isNull(table.resolvedAt)),
  })
);

export const fieldExtractionFailuresRelations = relations(fieldExtractionFailures, ({ one }) => ({
  ipo: one(ipos, { fields: [fieldExtractionFailures.ipoId], references: [ipos.id] }),
  document: one(documents, { fields: [fieldExtractionFailures.documentId], references: [documents.id] }),
}));
```

Migration: `npm run db:generate` from this (additive, one new table, no destructive DDL) — goes in
the normal `meta/_journal.json` path, not `_gated/`.

## Interfaces

```typescript
// scraper/src/services/field-extraction-validation.ts

export interface ValidationRule {
  id: string;                    // e.g. 'face_value_equity_enum', 'listing_t3', 'listing_t6'
  appliesTo: { table: string; column: string };
  /** offeringTypeEnum values, or ['ALL']. */
  offeringTypes: string[];
  /** 'MAINBOARD' | 'SME' | 'ALL'. */
  segments: string[];
  /** ISO date or null (no lower bound). Inclusive. */
  validFrom: string | null;
  /** ISO date or null (no upper bound, i.e. "still in force"). Inclusive. */
  validTo: string | null;
  /**
   * A restricted assertion DSL, not eval()'d TypeScript — the same posture
   * as the schema's own CHECK-constraint-avoidance comment
   * (`ipo_details` table, schema.ts: "PostgreSQL doesn't support CHECK
   * constraints with subqueries referencing other tables... enforced at the
   * application level"). The evaluator is a small named-function dispatch
   * table (`ENUM(field, set)`, `RANGE(field, min, max)`,
   * `DATE_WITHIN_WORKING_DAYS(laterField, earlierField, n, exchange)`), not a
   * string eval, so a malformed rule fails at `loadValidationRules()` time
   * (unknown function name), never at write time.
   */
  assertion: string;
  /** Plain-words description used verbatim as `cause` on a rejection. */
  causeTemplate: string;
}

export type FieldValidationOutcome =
  | { status: 'PASS' }
  | { status: 'FAIL'; ruleId: string; cause: string }
  /** No rule's (offeringType, segment, date) window covers this value — write it, do not reject it (§5.3 "What this does not do"). */
  | { status: 'NO_RULE_APPLIES' };

export function validateFieldValue(params: {
  table: string;
  column: string;
  value: unknown;
  offeringType: string;
  segment: string | null;
  /** The date the rule set is evaluated AS OF — the filing/effective date of
   * the ROW being validated (e.g. ipos.listing_date's own value, or
   * ipos.open_date for a row still being discovered), NEVER "today". This is
   * what makes a 2022 backlog row judged by the 2022-era rule, not today's. */
  asOfDate: Date;
  rules: ValidationRule[]; // from loadValidationRules(), threaded in, not re-read per call
}): FieldValidationOutcome;
```

**The write-path gate, exact insertion point:**

```typescript
// scraper/src/services/data-consolidation-service.ts, inside consolidateField (line 983)
// ... existing code through line 1017 unchanged ...
const rules = getFieldRules(fieldName);

// NEW — OD-21 gate. Runs on the INCOMING value only: the existing stored
// value already passed this same gate on a previous cycle (or predates the
// gate, in which case it is judged by whichever rule's date window covers
// its own last-updated date the first time anything re-touches the field —
// no all-at-once backfill sweep is in scope for this item).
const validation = validateFieldValue({
  table: tableName,
  column: fieldName, // NOTE: fieldName here is the camelCase name; validateFieldValue
                      // converts to the DB column name internally the same way item 3's
                      // canonicalPath() does, so validation-rules.yaml is keyed on DB
                      // column names exactly like field-manifest.yaml, not on the JS name
  value: incomingValue,
  offeringType: params.existingRowValue?.offeringType ?? incomingSource /* see note below */,
  segment: params.segment ?? null,
  asOfDate: /* the row's own relevant date — see "What I could not resolve" below */,
  rules: loadValidationRules(),
});

if (validation.status === 'FAIL') {
  await this.failuresRepository.recordFailure({
    ipoId, tableName, fieldName, rowKey: params.rowKey ?? '',
    documentId: params.incomingDocumentId ?? null,
    documentSha256: params.incomingDocumentSha256 ?? null,
    ruleId: validation.ruleId,
    rankAttempted: incomingSource,
    extractedValue: String(incomingValue).slice(0, 2000),
    cause: validation.cause,
  });
  // The incoming value is dropped — proceed exactly as if incomingValue were
  // undefined for the rest of this function, so the EXISTING per-field
  // "no existing value, accept incoming" / "existing exists, compare
  // priority" logic below is untouched and the field falls through to
  // whatever the existing stored value already was (null if there wasn't one).
}
// NO_RULE_APPLIES and PASS both fall through unchanged — the incoming value
// competes for the write exactly as it does today.
```

**What I could not resolve, named as a fork rather than guessed (§0 rule: "no card invents a
decision"):** `consolidateField`'s params (line 983-1006) do not currently carry `offeringType`,
`incomingDocumentId` or `incomingDocumentSha256` — only `ipoStatus` is threaded in for a comparable
purpose (T-328). Threading three more fields through every one of the ~15 call sites that build this
params object (traced from the single call site at line 866, itself called once per field per
`consolidateIPOData` invocation) is straightforward but is real surface area this card is not
sized to also design in full. **This is C-2**: *should `offeringType`/`incomingDocumentId`/
`incomingDocumentSha256` be threaded onto `ConsolidateIPODataInput` (once per row, not per field —
cheaper) or onto every `consolidateField` params object (once per field — more local but
repetitive)?* Recommendation: `ConsolidateIPODataInput` (row-level) — offering type and the
document identity are properties of the ROW/document being consolidated, not of the individual
field, so threading them once per row and letting `consolidateField` read them off `this` or a
shared closure avoids fifteen near-identical parameter list edits for no benefit.

**`asOfDate` similarly needs a per-field-group answer this card states rather than invents:** for a
class-T field (`listing_date` itself), the natural `asOfDate` is the row's OWN `listing_date` value
being validated — using the very value under test as the window key is circular only if the window
boundary is far from the value, which here it is not (a listing date decides which T+n rule governs
its own gap check). For every other class-D field with no natural "effective date" of its own
(`face_value`, which the offering-type rule already scopes without needing a date at all), `asOfDate`
is simply unused — the offering-type/segment scoping alone resolves which rule applies, and `validFrom`/
`validTo` stay `null` (no date scoping) for those rules. The card does NOT invent a universal
"asOfDate = filing date" answer because no field group needs one that Appendix A names today.

**Complete worked rule set — the two named F-10 examples, full content:**

```yaml
# scraper/config/validation-rules.yaml
version: 1
rules:
  - id: face_value_equity_enum
    appliesTo: { table: ipos, column: face_value }
    offeringTypes: [IPO, FPO, RIGHTS, IPP, QIP, PREFERENTIAL]
    segments: [ALL]
    validFrom: null
    validTo: null
    assertion: "ENUM(value, [1, 2, 5, 10])"
    causeTemplate: "face_value {value} is not one of the equity denominations {1,2,5,10}"

  - id: face_value_debt_positive
    appliesTo: { table: ipos, column: face_value }
    offeringTypes: [NCD, BONDS]
    segments: [ALL]
    validFrom: null
    validTo: null
    # Design does not say what NCD face-value bound is right (only that
    # {1,2,5,10} is WRONG for it) — kept permissive (>0, <=100000, matching
    # the existing field-priority-matrix.ts faceValue validation ceiling)
    # rather than inventing a debt-specific enum nothing in this design names.
    assertion: "RANGE(value, 0, 100000)"
    causeTemplate: "face_value {value} is not a positive amount within the NCD/BONDS range"

  - id: listing_t3
    appliesTo: { table: ipos, column: listing_date }
    offeringTypes: [ALL]
    segments: [ALL]
    validFrom: "2023-12-01"
    validTo: null
    assertion: "DATE_WITHIN_WORKING_DAYS(listing_date, close_date, 3, exchange)"
    causeTemplate: "listing_date {value} is more than 3 working days after close_date (T+3, in force since 2023-12-01)"

  - id: listing_t6
    appliesTo: { table: ipos, column: listing_date }
    offeringTypes: [ALL]
    segments: [ALL]
    validFrom: null
    validTo: "2023-11-30"
    assertion: "DATE_WITHIN_WORKING_DAYS(listing_date, close_date, 6, exchange)"
    causeTemplate: "listing_date {value} is more than 6 working days after close_date (T+6, the rule before 2023-12-01)"
```

`DATE_WITHIN_WORKING_DAYS`'s working-day calendar reads `market_holidays`
(`packages/shared/src/db/schema.ts:802`, existing table — `date`, `exchange`, `type`, `year`) —
**I found no existing working-day-arithmetic utility anywhere in `scraper/src`**
(`grep -rn "workingDaysBetween\|addWorkingDays" scraper/src` returns nothing), so this function is
new code this item must also write, not a reuse of something that exists. A value with NO rule
covering its `(offeringType, segment, asOfDate)` triple returns `NO_RULE_APPLIES` per the
`FieldValidationOutcome` type above and is written, exactly as §5.3 specifies — e.g. a listing date
from a rule set that only defines T+3 and T+6 windows, applied to a hypothetical future T+1 regime
nobody has written a rule for yet, is NOT silently rejected by falling through to the nearer window.

## Feature flag

`ENABLE_FIELD_EXTRACTION_VALIDATION`, `scraper/src/config/feature-flags.ts`. Default `false` in
every slot at merge time — this is a Tier A write-path change and the standing rule
(`defect-fix-contract.md`) requires a staging proof before the behavior is live anywhere, so the
flag stays off through the PR and is flipped on staging first, by hand, once the proof below is
read. Off: `consolidateField` behaves exactly as today (no gate runs, no `field_extraction_failures`
row is ever written). On: the gate in Interfaces runs on every field.

## Tests

- **Unit** — `scraper/tests/unit/services/field-extraction-validation.test.ts` (NEW): (1)
  `face_value_equity_enum` rejects 3 for an IPO row, accepts 10; (2) `face_value_debt_positive`
  accepts 1000 for an NCD row where `face_value_equity_enum` would have rejected it — proves
  offering-type scoping actually separates the two rules rather than one silently overriding the
  other; (3) `listing_t3` rejects a T+5 gap for a 2026 row; (4) `listing_t6` ACCEPTS that same T+5
  gap for a 2022 row (`asOfDate` before 2023-12-01) — this is the literal F-10 regression test:
  the SAME value, judged by the SAME field, must PASS under the old-era rule and FAIL under the
  current one; (5) a value with no offering-type/date match anywhere returns `NO_RULE_APPLIES`, not
  `FAIL`.
- **Integration** — `scraper/tests/integration/services/data-consolidation-service-validation.test.ts` (NEW)
  (NEW, requires DB per the project's integration-test convention): with the flag on, a rejected
  `fresh_issue` value produces exactly one `field_extraction_failures` row with a non-null `cause`,
  and the REST of that same document's fields (e.g. `registrar`, `leadManagers`) still land in
  `ipos`/`field_sources` in the same consolidation call — proving §5.3 rule 3 ("nothing is
  all-or-nothing") at the row level, not just asserted in prose.
- **Red before the change:** all of the above are net-new files/assertions against code that does
  not exist yet — red by absence, per the template's rule for a first-time gate.

## Detection

`docs/reviews/detection-checks/field-extraction-failure-rate.json` (NEW): a nightly audit script
(`scripts/audit-field-extraction-failures.mjs` (NEW), NEW) that reads `field_extraction_failures` for the
last 24h, groups by `ruleId`, and fails (non-zero exit) if any single rule's failure count on a
FRESHLY-discovered document (not a re-read) crosses a threshold this card does not fix a number for
— **the design does not say what rate is "too many"**, and I am not inventing one; the check ships
with the threshold set to "any count > 0 is reported, none is a hard fail," and the owner picks a
real threshold once a few nights of real data exist to calibrate against (this is the honest
version of §4's own posture — measure first, gate second). This is a genuinely NEW detection
surface, not a modification of an existing one, so there is no `No detection change:` declaration
needed — this item's whole point is adding one.

## Staging proof

The exact line: after deploying with `ENABLE_FIELD_EXTRACTION_VALIDATION=true` on staging and
letting one real due-step cycle run (`docs/ops/prod-ops-recipes.md`'s staging-cycle-read recipe),
query staging for
`SELECT count(*) FROM field_extraction_failures WHERE occurred_at > now() - interval '1 hour'` —
healthy value is **zero rows on a night with no real rule violation** (proves the gate does not
false-positive on ordinary data) — followed by a deliberate proof run: temporarily feed a known-bad
fixture value (an NCD row's `face_value=1000` re-run through `face_value_equity_enum` with the wrong
offering type on purpose, in a throwaway test IPO row, never on a real one) and confirm exactly one
row appears with `rule_id='face_value_equity_enum'`, a non-null `cause`, and that the OTHER fields
on the same fixture document still wrote successfully. Both counters — the "zero on real data" line
and the "exactly one on the deliberate bad fixture" line — are what a reviewer reads before merging
to `release/prod-<date>`, per `defect-fix-contract.md`'s item 5 timing note (merge to `main` is how
the proof is obtained; the release cut is the gate that requires it).

## Rollback

Flip `ENABLE_FIELD_EXTRACTION_VALIDATION` to `false` — the gate stops running immediately (module-
load-time flag, so this needs a process restart, same constraint as every other flag in this file,
not a new one). `field_extraction_failures` rows already written are historical fact (a value WAS
rejected at that time by that rule) and are never deleted by a rollback — they stay as an audit
trail even after the flag is off. No existing column's stored value is ever rewritten by this item
(a rejected value is dropped from the CURRENT write, never used to overwrite something already
stored), so there is nothing to restore on the `ipos`/child-table side.

## Tier, budget and cost

**Tier A** — per the brief's own classification and `.claude/rules/defect-fix-contract.md`: this is
a scraper write-path change (`scraper/src/services/**`), which the recurrence-detection-gate rule
also puts under mandatory detection-change scrutiny — satisfied by the new nightly check above, not
a `No detection change:` declaration. `Budget: 60 min wall-clock, 120 tool calls`: this item touches a write-path service, a new table, a new repository,
a new config file family, and a new detection script — the widest single item of the three this
session's cards cover. Two review rounds expected only if the first finds a CRITICAL/MAJOR per
`engineering-roles.md`'s Tier A default (one round unless escalated); the reviewer's highest-value
check is C-2 and the `asOfDate` fork above — confirm neither was silently resolved by the time this
lands, since both are named exactly so a reviewer can catch a silent "just pick one" in the diff.

---

### A note on the `C-n` numbering in this card

`C-1`, `C-2` and any other `C-n` in this card are **card-local decisions**: reversible, internal
choices the card author made and recorded so an implementer can see them and disagree. They are NOT
owner forks. Owner forks live in §0.0.2 of `docs/design/data-sourcing-pull-model.md` as `O-nn`, and
this card opened none — an earlier draft numbered these as `O-13` and `O-14`, which collided with the
real owner fork O-13 (the grey-market premium and the market-hours gate).

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

2 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §5.3 | R-114 |
| §5.3.1 | R-115 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
