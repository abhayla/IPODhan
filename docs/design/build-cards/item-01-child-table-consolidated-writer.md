# Item 1 — The child-table consolidated writer

## Purpose

After this ships, a write to any of the eight child tables (`ipo_details`, `financial_statements`,
`ipo_valuation`, `ipo_risk_factors`, `promoters`, `anchor_investors`, `ipo_intermediaries`,
`peer_companies`) goes through the same per-field priority resolution, `field_sources` provenance,
and `data_conflicts` detection that `ipos` already gets — which today is true of zero of them.

## Serves

OD-10 (*"Agreed, child-table writer is item 1"*, 2026-09-08), §2.10, §7.1 row 1 (*"the gate on
everything below"*). Directly closes the gap §7.1 names: **"162 of the 194 [populated] fields ...
have no consolidated writer at all"** and 208 of 240 once the empty-but-published fields are
counted. Without this item, item 6 (the pull walk) has nowhere to put 87% of what it extracts.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/services/data-consolidation-orchestrator.ts` | exists (600 lines) | `consolidatedUpsertIPO` (line 90) stays as the `ipos`-only entry point, unchanged in signature. New method `consolidatedUpsertChildRows(ipoId, tableName, rows, source, docType, preResolvedIPO?)` added (append after `consolidatedUpsertIPO`, ~line 300 once the existing method's body ends) — takes an array of incoming child rows for one table, computes each row's natural key (see Schema below), matches against existing rows, and calls `consolidationService.consolidateIPOData` once per (row, field) pair instead of once per (ipo, field). Replaces the direct `deps.promoters.replacePromoters(...)` / `deps.riskFactors.replaceForIpo(...)` / `deps.intermediaries.replaceForIpo(...)` / `deps.peerCompanies.deleteByIPOId + batchCreate` / `createAnchorInvestors` call sites — those repositories keep their existing methods (still used for the actual row insert/update after consolidation decides the value), but the callers listed below stop calling them directly and go through the orchestrator instead. |
| `scraper/src/services/data-consolidation-service.ts` | exists (2340 lines) | `ConsolidateIPODataInput` (line 96-108) gains an optional `rowKey?: string` field (default `''`). `consolidateField`'s params (line 979) gains `rowKey`. Every call into `trackFieldSource` (7 call sites: lines 718, 1124, 1161, 1217, 1314) and `logConflict` (the `ConflictInfo` shape, line 113-135) threads `rowKey` through. The four open-conflict lookups that currently match on `row.tableName === tableName && row.fieldName === fieldName` alone (lines 836, 1237, 1555, 1624) gain `&& row.rowKey === rowKey` — without this, two financial-year rows disagreeing on `revenue` in the same cycle would each see the other's open conflict as their own. |
| `scraper/src/services/filing-persister.ts` | exists (1828 lines) | The five `replaceAllowed(...)` call sites for whole-row replace (`promoters` line 1390, `promoter_acquisition_ranges` line 1435, `ipo_risk_factors` line 1518, `ipo_intermediaries` line 1644, `peer_companies` line 1701) and their paired repository calls (`replacePromoters`, `replaceForIpo` x2, `deleteByIPOId`+`batchCreate`) are replaced by calls to `orchestrator.consolidatedUpsertChildRows`. `trackField(tableName, 'rows')` (line 646-670, the current single-synthetic-row provenance write) is deleted — it is superseded by the per-field `field_sources` rows the new path writes. `promoter_acquisition_ranges` and `brlm_track_record` are **out of scope for item 1** (not in the eight named tables) and keep their current whole-row-replace / raw-upsert behaviour unchanged. |
| `scraper/src/services/filing-persister.ts` — **the three tables the row above does NOT cover** | exists | CORRECTED 2026-09-09 (F-73). The five `replaceAllowed` call sites are the whole-row-replace tables only. `ipo_details`, `financial_statements` and `ipo_valuation` are written by a different shape — a direct writable-object upsert — and were never named for change, so they would have kept flowing through the old no-priority-resolution path after item 1 "shipped": `detailsWritable` at **line 993** (`if (Object.keys(detailsWritable).length > 0)`), `deps.financialStatements.upsert` at **line 1250**, and `valuation` at **line 1316** (`if (Object.keys(valuation).length > 0)`). All three become `consolidatedUpsertChildRows` calls with the row key from the Schema section: `''` for `ipo_details`, `fiscalYear:basis` for `financial_statements`, `pricingEvent` for `ipo_valuation`. Three of the eight named tables carry the revenue, EPS and valuation numbers, so omitting them would have left the largest half of the gap open while the card read as complete. |
| `scraper/src/services/anchor-persister.ts` | exists | Line 540-541 (`const write = deps.persist ?? createAnchorInvestors; await write(...)`) is replaced by a call to `consolidatedUpsertChildRows(ipoId, 'anchor_investors', [row], source, docType)`. `data-persister.ts`'s `createAnchorInvestors` (line 1980-2036, the `findByIPOId` + update-or-create) stops being called from here; it may still exist for any other caller, but is not this item's concern if none exists — a quick `grep -rn createAnchorInvestors scraper/src` before deleting it is this item's own check, not asserted here. |
| `packages/shared/src/repositories/field-sources-repository.ts` (+ the `web/lib/repositories/` copy, kept in lockstep the way the two already are — see the diff between them checked this session, which is cosmetic-only) | exists (162+ lines) | `TrackFieldUpdateInput` (line 27-35) and `FieldSourceRecord` (line 13-25) gain `rowKey: string \| null`. `trackFieldUpdate` (line 162) writes it through. `findByField` (used by `filing-persister.ts`'s `trackField`, and by the consolidation service's read paths) gains a `rowKey` parameter, default `null`/`''` for the singleton tables. |
| The equivalent `data_conflicts` repository (not yet located this session by exact path — grep `class DataConflictsRepository` under `packages/shared/src/repositories/` before starting; the pattern will mirror the field-sources file above) | exists, path to confirm at start of work | Same `rowKey` threading: `logConflict`, `autoResolveConverged(ipoId, tableName, fieldName)` → `autoResolveConverged(ipoId, tableName, rowKey, fieldName)`, and the open-conflicts query gains `rowKey` to its `WHERE`. |
| `packages/shared/src/utils/company-name-normalizer.ts` (`normalizeCompanyNameForMatching`, already imported at `data-consolidation-orchestrator.ts:28`) | exists | Reused, not changed, as the row-key function for `promoters` and `peer_companies` (see Schema). If item 12 (fold corporate-form words into the normalizer, F-46/F-55) lands first, this item inherits that improvement for free; if item 1 lands first, item 12 improves both call sites together — no dependency either way blocks this item's build. |

## Schema

**The hard part.** `field_sources` and `data_conflicts` are keyed today on `(ipoId, tableName,
fieldName)` — `field_sources` even enforces it as a real unique constraint,
`unique_field_source_per_ipo` (`schema.ts:1414-1418`). That key assumes **one row per (IPO, table)**,
which is true of `ipos` and true of the two child tables that already carry their own natural key in
their own unique constraint (`ipo_details`, singleton; nothing else). It is false for the other six.
Writing a provenance row for `financial_statements.revenue` today, for two different fiscal years,
would either violate the unique constraint or silently overwrite one year's provenance with the
other's — the exact "false-clean state" class §2.3 already calls out for a different reason (the
`LOCK_NOT_ACQUIRED` skip).

**The fix: widen the key by one column, `row_key`, present on both tables.**

```typescript
// packages/shared/src/db/schema.ts — field_sources (existing table, columns 1376-1421)
export const fieldSources = pgTable(
  'field_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ipoId: uuid('ipo_id').notNull().references(() => ipos.id, { onDelete: 'cascade' }),
    tableName: varchar('table_name', { length: 100 }).notNull(),
    // NEW. '' for every table that has exactly one row per IPO (ipos, ipo_details,
    // anchor_investors, financial_data). Non-empty for the six tables below.
    // Never null — a nullable column can't sit inside a unique constraint the way
    // an empty string can (two NULLs are not equal under a unique index; two ''
    // are), which is exactly why '' is the singleton sentinel, not null.
    rowKey: varchar('row_key', { length: 200 }).notNull().default(''),
    fieldName: varchar('field_name', { length: 100 }).notNull(),
    source: scraperSourceEnum('source').notNull(),
    confidence: integer('confidence').default(100).notNull(),
    previousValue: text('previous_value'),
    previousSource: scraperSourceEnum('previous_source'),
    dataLineage: jsonb('data_lineage'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    updatedBy: varchar('updated_by', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    ipoIdIdx: index('idx_field_sources_ipo_id').on(table.ipoId),
    tableNameIdx: index('idx_field_sources_table_name').on(table.tableName),
    fieldNameIdx: index('idx_field_sources_field_name').on(table.fieldName),
    sourceIdx: index('idx_field_sources_source').on(table.source),
    // WIDENED from (ipoId, tableName, fieldName)
    ipoTableFieldIdx: index('idx_field_sources_ipo_table_field').on(
      table.ipoId, table.tableName, table.rowKey, table.fieldName
    ),
    // WIDENED. Was `unique_field_source_per_ipo` on (ipoId, tableName, fieldName);
    // renamed because its meaning changed, not just its columns — a rename with no
    // column change is a silent trap for a migration that only ALTERs.
    uniqueFieldPerRow: unique('unique_field_source_per_ipo_row').on(
      table.ipoId, table.tableName, table.rowKey, table.fieldName
    ),
  })
);

// data_conflicts (existing table, columns 1428-1465) — same addition, no unique
// constraint exists on this table today so none is added; the composite index
// gains the column so the open-conflicts-for-this-row query stays an index scan.
export const dataConflicts = pgTable(
  'data_conflicts',
  {
    // ...unchanged columns...
    rowKey: varchar('row_key', { length: 200 }).notNull().default(''),
    // ...unchanged columns...
  },
  (table) => ({
    // ...unchanged indexes...
    ipoTableRowIdx: index('idx_data_conflicts_ipo_table_row').on(
      table.ipoId, table.tableName, table.rowKey
    ),
  })
);
```

Generated migration (`npm run db:generate`, run from `web/`) will emit, in shape:

```sql
ALTER TABLE "field_sources" ADD COLUMN "row_key" varchar(200) DEFAULT '' NOT NULL;
ALTER TABLE "field_sources" DROP CONSTRAINT "unique_field_source_per_ipo";
ALTER TABLE "field_sources" ADD CONSTRAINT "unique_field_source_per_ipo_row"
  UNIQUE ("ipo_id","table_name","row_key","field_name");
CREATE INDEX "idx_field_sources_ipo_table_field" ON "field_sources"
  ("ipo_id","table_name","row_key","field_name");  -- replaces the 3-column version

ALTER TABLE "data_conflicts" ADD COLUMN "row_key" varchar(200) DEFAULT '' NOT NULL;
CREATE INDEX "idx_data_conflicts_ipo_table_row" ON "data_conflicts"
  ("ipo_id","table_name","row_key");
```

Both are additive-with-a-default (existing rows all get `row_key = ''`, correctly, since every
existing `field_sources`/`data_conflicts` row was written by the `ipos`-only path or by the
whole-table-replace path — both singleton-shaped under the current code) — **not destructive**, does
not go in `_gated/`.

**The row-key shape for each of the eight child tables, and why it holds across re-extractions:**

| Table | `row_key` | Why it is stable |
|---|---|---|
| `ipo_details` | `''` | Schema already enforces `ipoId` as `.unique()` (`schema.ts:1099-1102`) — there is structurally one row per IPO. Same shape as `ipos` itself. |
| `financial_statements` | `` `${fiscalYear}:${basis}` `` e.g. `2024:RESTATED` | Matches the table's own existing unique constraint `unique_financial_statements_ipo_fy_basis` (`schema.ts:1704-1707`) exactly. A fiscal year and its accounting basis are facts about the reporting period, fixed before any document is filed — a re-extraction of FY2024 RESTATED is always FY2024 RESTATED, never renumbered, regardless of which filing (DRHP, RHP, PROSPECTUS) supplied the figures. |
| `ipo_valuation` | `` `${pricingEvent}` `` — `PRICE_BAND_AD` or `PROSPECTUS` | Matches `unique_ipo_valuation_ipo_pricing_event` (`schema.ts:1755-1758`). The enum has exactly two members (`schema.ts:193-196`); which one a row is is a fact about which document produced it, not a position. |
| `ipo_risk_factors` | **`sha256(normalizeHeading(heading)).slice(0,16)`** — NOT the existing `seq` | The table's current unique constraint is `unique_ipo_risk_factors_ipo_seq` on `(ipoId, seq)` (`schema.ts:1902-1904`) — **positional**. §2.5.1 trigger 3 (a better document arrives) and trigger 6 (plan invalidated) both re-run extraction, and a risk-factor section commonly adds, drops, or reorders items between a DRHP and the final RHP/PROSPECTUS — the design does not say risk factors are reordering-stable, and nothing in the code asserts it either. Keying on the heading's content (normalized: lowercase, whitespace-collapsed, punctuation-stripped) survives reordering; a genuinely reworded heading is treated as a new risk factor, which is the correct behaviour (it is a different fact, not the same fact renumbered). **This requires its own schema change to `ipo_risk_factors` itself** — add `heading_hash varchar(32) NOT NULL`, and replace `unique_ipo_risk_factors_ipo_seq` with a unique constraint on `(ipoId, headingHash)`; `seq` stays as a plain display-order integer, re-derived on every write from array position, no longer load-bearing for identity. **Flagged as a fork the design does not resolve — see below.** |
| `promoters` | `normalizeCompanyNameForMatching(name)` (existing function, `packages/shared/src/utils/company-name-normalizer.ts`, already used for IPO identity resolution at `data-consolidation-orchestrator.ts:141`) | The table has **no unique constraint today** (`schema.ts:1770-1791` — only an `ipoId` index) because the current write path deletes every row and reinserts (`replacePromoters`, called from `filing-persister.ts:1391`), so no key was ever needed. A named promoter's identity is their name; the same normalizer already resolves company-name variants for IPO matching, so reusing it here is not inventing a second normalization rule for the same problem. **Requires adding a unique constraint `(ipoId, normalizedName)` to `promoters` itself** — without one, the per-row match-then-update this item introduces (replacing delete-then-insert) has no DB-enforced guarantee against two rows for one promoter. |
| `anchor_investors` | `''` | The current write path (`data-persister.ts:2004`, `findByIPOId`) treats this as **one row per IPO** — there is no code path that creates a second row for a second bid date, and the table has no unique constraint enforcing that (only non-unique indexes on `ipoId` and `bidDate`). Item 1 keeps that shape rather than inventing multi-tranche support nothing asks for (YAGNI, `claude-behavior.md` rule 21) — but this is worth naming as a real gap if an oversubscribed issue's anchor book is ever revised with a second allocation on a later date, since the update-in-place would overwrite the first tranche's figures rather than adding a second row. **Flagged as a fork below** rather than silently assumed to be fine. |
| `ipo_intermediaries` | `` `${role}:${normalizeCompanyNameForMatching(name)}` `` e.g. `BRLM:jm financial` | The existing index is `(ipoId, role)` (`schema.ts:1847`), not unique, and role alone collides (a mainboard IPO commonly has 2-4 BRLMs and several syndicate members under the same `role` value). Name distinguishes them within a role; the same normalizer as promoters/peers is reused, not reinvented. **Requires a unique constraint `(ipoId, role, normalizedName)`** — none exists today because the write path is whole-table replace. |
| `peer_companies` | `normalizeCompanyNameForMatching(companyName)` | No unique constraint today (`schema.ts:846-867`) — same replace-then-insert reason as promoters. Peer identity is the listed comparable company's name. **Requires a unique constraint `(ipoId, normalizedName)`.** |

**Forks this card cannot resolve on its own — the design does not say, and this item should not
guess silently:**

1. **O-nn-a: does a child row absent from the newest document get retired, or kept?** When the
   newest, highest-precedence document for an IPO no longer lists a promoter/intermediary/peer that
   an older document did, is that evidence the fact changed (drop the row) or just that this
   extraction pass didn't re-confirm it (keep it, the way §2.6 keeps a field that fails re-source)?
   **Recommended: keep, never hard-delete, mirroring §2.6's field-level rule at row granularity** —
   deleting on absence risks losing a promoter because one page failed to parse, which is a worse
   failure mode than a stale row. A later, explicit "retire" needs its own signal (e.g., the same
   document TYPE re-read and still not listing it), which this item does not build.
2. **O-nn-b: can `anchor_investors` ever hold two tranches for one IPO?** The code today says no
   (`row_key = ''`, one row per IPO). If a real issue revises its anchor allocation on a second date,
   this item's schema has nowhere to put the second row without another migration. **Recommended:
   ship on the current one-row assumption** (it matches every existing anchor-allocation report this
   codebase has ever parsed) and revisit if a real second-tranche IPO is observed — inventing
   multi-tranche support with zero observed cases is speculative generality (rule 21).
3. **O-nn-c: `ipo_risk_factors`' re-keying from `seq` to `heading_hash` is a schema change to a table
   item 1 was not asked to touch.** The design's item-1 description names the eight tables for
   *field-priority resolution*; it does not say their own unique constraints may need to change too.
   This card recommends the change because the alternative (keying `field_sources` on the unstable
   `seq`) silently mis-attributes provenance across a reordering. **Recommended: make the change**,
   but it is called out explicitly rather than folded in as if the design already decided it.

## Interfaces

```typescript
// scraper/src/services/data-consolidation-service.ts
export interface ConsolidateIPODataInput {
  ipoId: string;
  tableName: string;
  rowKey?: string;              // NEW — default '' (singleton row). See Schema table above.
  incomingData: Record<string, any>;
  source: ScraperSource;
  existingData?: Record<string, any>;
  confidence?: number;
  shadowMode?: boolean;
  scrapedAt?: Date;
  docType?: string;
}

// scraper/src/services/data-consolidation-orchestrator.ts — NEW method
export interface ChildRowInput {
  /** The row's natural key, computed by the caller per the Schema table (empty string for
   *  singleton tables). The orchestrator does not compute this itself — filing-persister.ts
   *  and anchor-persister.ts already have the row's fields in hand and know which table they
   *  are writing, so they call the matching row-key function directly. */
  rowKey: string;
  /** The row's own primary-key id, if it already exists in the DB (undefined = new row). */
  existingRowId?: string;
  data: Record<string, any>;
}

async consolidatedUpsertChildRows(
  ipoId: string,
  tableName: 'ipo_details' | 'financial_statements' | 'ipo_valuation' | 'ipo_risk_factors'
    | 'promoters' | 'anchor_investors' | 'ipo_intermediaries' | 'peer_companies',
  rows: ChildRowInput[],
  source: ScraperSource,
  docType?: string,
): Promise<{ rowsProcessed: number; rowsUpdated: number; conflictsDetected: number }>

// packages/shared/src/repositories/field-sources-repository.ts
export interface TrackFieldUpdateInput {
  ipoId: string;
  tableName: string;
  rowKey?: string;               // NEW — default '' at the repository layer if omitted
  fieldName: string;
  source: ScraperSourceLiteral;
  confidence?: number;
  previousValue?: string | null;
  previousSource?: ScraperSourceLiteral | null;
  dataLineage?: Record<string, unknown>;
  updatedBy?: string;
}
```

**Worked example** — a re-extraction supplies FY2024 restated revenue for an IPO that already has a
FY2023 restated row:

```typescript
await orchestrator.consolidatedUpsertChildRows(
  ipoId,
  'financial_statements',
  [{ rowKey: '2024:RESTATED', existingRowId: undefined, data: { revenue: '450000000', ebitda: '82000000', /* ... */ } }],
  'DRHP',
  'PROSPECTUS',
);
// -> consolidationService.consolidateIPOData({ ipoId, tableName: 'financial_statements',
//      rowKey: '2024:RESTATED', incomingData: {...}, source: 'DRHP', existingData: undefined, docType: 'PROSPECTUS' })
// -> field_sources row: (ipoId, 'financial_statements', '2024:RESTATED', 'revenue', 'DRHP', ...)
// The FY2023 row's field_sources rows (rowKey '2023:RESTATED') are untouched — the widened
// unique constraint is exactly what makes that true; under the old 3-column key, both years'
// 'revenue' provenance would have collided on write.
```

## Feature flag

Reuses the existing `FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION` and `ENABLE_SOURCE_TRACKING` /
`ENABLE_CONFLICT_DETECTION` gates already read by `data-consolidation-orchestrator.ts` and
`data-consolidation-service.ts` — no new flag name. Default per slot: **unchanged** (these flags are
already on in prod per the existing config; item 1 does not flip any default, it extends what the
already-on path covers). If a staged rollout is wanted per table (e.g., ship `financial_statements`
before `promoters`), that is a per-tableName check inside `consolidatedUpsertChildRows`, gated by a
new `FEATURE_FLAGS.CHILD_TABLE_CONSOLIDATION_TABLES: Set<string>` (default: all eight) — **the
design does not ask for a staged per-table rollout; this flag is this card's own recommendation for
a safer landing**, not a requirement. Rollback: shrink the set; nothing destructive happens by
removing a table from it (the writer falls back to the pre-item-1 whole-replace call for tables not
in the set, so both code paths must coexist until every table has migrated — call sites in
`filing-persister.ts` branch on flag membership rather than being deleted outright until this item's
staging proof covers all eight).

## Tests

Tier: unit, `scraper/tests/unit/services/` (matches the existing
`data-consolidation-*.test.ts` naming, e.g. `data-consolidation-child-table-row-key.test.ts`) —
**red before the change**:

1. `consolidateField` writes two `field_sources` rows for the same `(ipoId, tableName, fieldName)`
   when `rowKey` differs (FY2023 vs FY2024 `revenue`) — asserts today's code throws or overwrites
   (there is no `rowKey` parameter to pass, so this test asserts the *current* 3-column unique
   constraint would collide if two child rows tried to write the same field name — provable today
   by inspecting the constraint definition/migration, not by running two writes past a constraint
   this schema doesn't have yet).
2. `normalizeCompanyNameForMatching('Sunil Sharma')` and `('SUNIL SHARMA ')` produce the same
   `rowKey` for `promoters` — asserts the row-key function, not the whole write path.
3. `ipo_risk_factors` re-keying: two extractions where risk factor #3 and #4 swap position but keep
   their headings produce the SAME two `rowKey`s in swapped `seq` order — asserts `heading_hash` is
   position-independent.
4. A promoter present in extraction 1, absent in extraction 2 (same document type, re-read): the
   row and its `field_sources` rows survive (per the "keep, never delete" recommendation above) —
   asserts O-nn-a's recommendation, not a design requirement, so this test documents this item's own
   decision.

Integration, `scraper/tests/integration/` (needs real DB — the widened unique constraint is exactly
the thing an in-memory mock cannot prove): `child-table-row-key.integration.test.ts` — write
`financial_statements` for two fiscal years through `consolidatedUpsertChildRows`, assert two
`field_sources` rows exist for `fieldName='revenue'` with different `rowKey`, assert no unique
constraint violation.

## Detection

`docs/reviews/detection-checks/field-sources-row-key-coverage.json` (**NEW**) — asserts, for every
IPO with more than one `financial_statements`/`promoters`/`ipo_intermediaries`/`peer_companies` row,
that `field_sources` has at least one row per `(tableName, rowKey)` pair that exists in the child
table — i.e., no child row is silently un-provenanced. Runs in the nightly audit
(`scripts/vps-data-audit-cron.sh`). Without this, a code path that forgets to pass `rowKey` (falls
back to the `''` default) would write real provenance under the wrong key and this item's whole
point — "which document said this promoter's WACA was X" — would be unrecoverable, silently.

## Staging proof

After deploying to staging: pick one real multi-year IPO (staging has restated FY2023+FY2024 rows
for several; confirm with `SELECT ipo_id, fiscal_year, basis FROM financial_statements GROUP BY 1,2,3
HAVING count(*) > 0` through the tunnel), force a re-extraction of its offer document, and read:

```sql
SELECT row_key, field_name, source, updated_at FROM field_sources
WHERE ipo_id = '<id>' AND table_name = 'financial_statements' ORDER BY row_key, field_name;
```

Healthy value: one row per `(fiscal_year:basis, field_name)` pair that the document prints, distinct
`row_key`s per year, no single `row_key=''` catch-all. Cycle: the next 00:00/08:00/14:00 data-job
run after deploy (§2.1) — the first cycle that touches a document for that IPO.

## Rollback

Revert the code paths (filing-persister.ts / anchor-persister.ts call the old
replace-repository methods again) and the feature-flag table-set to empty. The schema migration
(`row_key` columns, widened constraints) is additive with a default and does **not** need reverting —
leaving it in place after a code rollback is harmless (every row still has `row_key=''`, matching the
pre-item-1 world). Only the six new child-table unique constraints (`promoters`, `ipo_intermediaries`,
`peer_companies`, `ipo_risk_factors`'s replacement constraint) are new invariants on those tables;
rolling back the code does not require dropping them, since the pre-item-1 whole-replace path never
violates a uniqueness rule it doesn't check (delete-then-insert can't collide with itself).

## Tier, budget and cost

**Tier A** — a write-path change to eight tables plus a schema migration touching two audit tables
(`field_sources`, `data_conflicts`) that every downstream conflict/provenance query reads.
`Budget: 60 min wall-clock, 120 tool calls`. Cost: this is explicitly the largest single item in
§7.1 ("large — and it is the gate on everything below") — expect at least 2 review rounds given the
row-key forks above are this card's own recommendations, not owner-confirmed decisions, and a
reviewer may reasonably push back on the `ipo_risk_factors` re-keying or the "keep, never delete"
row-retirement rule before this lands.

## Rules implemented

1 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §1.12 | R-158 |

## Known gaps

- **F-74 (MAJOR) — Item 1 adds three new UNIQUE constraints to production tables with no pre-migration duplicate check or repair step.** Carried here rather than closed: three new UNIQUE constraints need a pre-migration duplicate scan and a repair step; probe duplicate-scan.mjs measures whether any exist today. Not fixed in the design (OD-47); it is this item's to close.

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
