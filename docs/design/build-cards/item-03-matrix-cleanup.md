# Item 3 — matrix cleanup

**PROVISIONAL on C-1 (new fork this card opens — see "What I found beyond the brief" under
Interfaces).** Everything else in this card is unconditional.

## Purpose

After this ships, `field-priority-matrix.ts` has exactly one entry per real, live field name —
every dead snake_case key is gone, `getFieldRules()` reads its rank order and validation from
item 2's manifest wherever the manifest has an entry, and the `ipos.listingExchange` /
`ipos.listingExchanges` provenance split (§7.3 item 8) is resolved to the one real column.

## Serves

- **§7.1 item 3** — "Matrix cleanup: delete the 13 dead snake_case keys, adopt the manifest."
- **§0.6** — "13 of the 77 matrix keys are dead duplicates in the wrong case... Consolidation
  writes camelCase, so the snake_case entries match nothing and never have." **Measured this
  session as 27, not 13 — see the count below and the discrepancy called out under Interfaces.**
- **§7.3 item 8** — the `ipos.listingExchange` (224 rows) vs `ipos.listingExchanges` (208 rows)
  provenance split, explicitly assigned to this item's card by the design ("it belongs in the
  matrix cleanup (§7.1 item 2 [sic — the design's own cross-reference is to the wrong item number;
  the matrix cleanup is item 3, not item 2]) rather than being left to be rediscovered").
- **OD-5** (§2.3.5) — this item is what makes the manifest from item 2 the thing consolidation
  actually reads, not just a file that exists.

## Files

| Path | State | Change |
|---|---|---|
| `scraper/src/config/field-priority-matrix.ts` | exists, 969 lines (`FIELD_PRIORITY_MATRIX` object spans lines 129-800, 77 keys) | Delete the dead keys (list below); `getFieldRules` (lines 863-874) and `getSourcePriority` (880-883) rewritten to check `loadFieldManifest().fields[canonicalPath]` FIRST (where `canonicalPath` is resolved from `tableName` + the camelCase `fieldName`, threaded in from `data-consolidation-service.ts`'s existing `tableName` parameter — see Interfaces), falling back to the (now duplicate-free) TS object only for fields item 2's manifest does not yet cover |
| `scraper/src/services/data-consolidation-service.ts` | exists, 2340 lines | `getFieldRules(fieldName)` calls at lines 925, 1017 and `getSourcePriority(fieldName, source)` calls at lines 339, 1920-1921 gain a `tableName` argument (the function already has `input.tableName`/`params.tableName` in scope at every call site — no new data has to be threaded in, just an added parameter) |
| `scraper/config/field-manifest.yaml` | NEW by item 2, this item is its first real consumer | Unchanged by this item — this item reads it, does not author more of it (see "What this item does NOT do" below) |
| `data_conflicts` production rows with `field_name = 'listingExchange'` (singular) | 224 rows, per §7.3 item 8's measurement | A one-time, source-backed, re-runnable repair script (per `defect-fix-contract.md` item 4) that either deletes these rows or re-keys them to `listingExchanges` — see Schema |

## Schema

No new tables or columns. One repair to an existing table's data, per `defect-fix-contract.md`:

```sql
-- scraper/scripts/repair-listing-exchange-singular-provenance.mjs (NEW) — dry-run default, --apply flag required
-- Deletes field_sources rows for a column that has never existed.
DELETE FROM field_sources
WHERE table_name = 'ipos' AND field_name = 'listingExchange';
```

I recommend DELETE, not re-key, because re-keying would fabricate a `source`/`confidence`/
`updatedAt` history for the plural column that was never actually recorded under that key — the 208
existing `listingExchanges` rows are the real history and are untouched by this repair.

## Interfaces

```typescript
// scraper/src/config/field-priority-matrix.ts

/**
 * canonicalPath resolves a (tableName, fieldName) pair to the manifest's
 * "<table>.<column>" key. It does NOT re-run toCamelKey — the manifest key is
 * the DB column name (snake_case), matching how item 2's YAML and Appendix A
 * are both keyed, so this function converts the incoming camelCase fieldName
 * to snake_case, not the other way around, before building the lookup key.
 */
function canonicalPath(tableName: string, fieldName: string): string;

export function getFieldRules(fieldName: string, tableName?: string): FieldRules {
  if (tableName) {
    const manifestEntry = loadFieldManifest().fields[canonicalPath(tableName, fieldName)];
    if (manifestEntry) return manifestEntryToFieldRules(manifestEntry); // adapts FieldManifestEntry -> the existing FieldRules shape, so every other caller in data-consolidation-service.ts is unchanged
  }
  // unchanged fallback below, on the now-duplicate-free object
  const canonical = toCamelKey(fieldName);
  return FIELD_PRIORITY_MATRIX[canonical] || FIELD_PRIORITY_MATRIX[fieldName] || DEFAULT_RULES;
}
```

`tableName` is optional (not `tableName: string`) so every existing test and any caller this session
did not find keeps working unchanged during the transition; it becomes required once every D/T/X/W/M
field has a manifest row (a later, unscheduled cleanup, not part of this item).

### The exact count, and how I got it

`FIELD_PRIORITY_MATRIX` has **77 top-level keys** (`awk 'NR>=129 && NR<=800' field-priority-matrix.ts
| grep -cE '^  [a-zA-Z_][a-zA-Z0-9_]*:\s*\{'` — matches §0.6's own count exactly, so the extraction
method is right). Of those 77, **27 contain an underscore** — i.e. are not already camelCase. I
checked, for every one of the 27, whether `data-consolidation-service.ts` could ever pass that exact
string as `fieldName`:

1. `getFieldRules`/`getSourcePriority` have exactly **two callers in the whole repo**:
   `data-consolidation-service.ts` and the matrix file's own internal helpers
   (`grep -rl getFieldRules scraper/src --include=*.ts` returns only those two files).
2. `data-consolidation-service.ts` always derives `fieldName` from
   `Object.entries(input.incomingData)` (line ~854).
3. Every producer of `incomingData` I read (`data-persister.ts`, `financial-data-scraper.ts`,
   `filing-persister.ts`) builds it with the Drizzle schema's own camelCase property names —
   confirmed by grepping each of the 27 snake_case matrix keys against the whole `scraper/src` tree
   outside the matrix file itself: **zero of the 27 literal snake_case strings appear as an object
   key anywhere a payload is actually built** (`revenue_fy1`, `roe_percentage`, `pb_ratio`,
   `fresh_issue_size`, `offer_for_sale_size`, `retail_subscription`, `qib_subscription`,
   `nii_subscription`, `listing_gain_percentage` return **zero** hits outside the matrix and its own
   comments; the others return hits only in migration SQL / DB column names / unrelated prose, never
   as an object-literal key feeding `incomingData`).

**So all 27 are dead — not 13.** They split into three groups, and the split matters for what
"delete" actually means for each:

**Group A — 5 keys shadowed by an exact camelCase sibling already in the same file** (dead by
`getFieldRules`'s own lookup order, regardless of what any caller ever passes):
`open_date` (line 364, shadowed by `openDate` line 377) · `close_date` (384, shadowed by `closeDate`
392) · `lot_size` (456, shadowed by `lotSize` 467) · `company_description` (216, shadowed by
`companyDescription` 227) · `gmp_price` (540, shadowed by `gmpPrice` 561). **Delete outright — the
camelCase sibling already carries identical `sources`/`normalization`/`validation`, confirmed by
diffing each pair's fields.**

**Group B — 6 keys the design names as duplicates, but the code shows they are not** (`revenue_fy1`,
`revenue_fy2`, `revenue_fy3`, `profit_fy1`, `profit_fy2`, `profit_fy3`, lines 4-42 relative to the
object start). §0.6's own example is *"revenue_fy1 beside revenueFy2022"* — implying `revenue_fy1`
duplicates `financial_data`'s hard-coded-year column. It does not: `packages/shared/src/db/schema.ts`
lines 582-587 show `revenueFy1`/`revenueFy2`/`revenueFy3`/`profitFy1`/`profitFy2`/`profitFy3` are the
real camelCase field names of a **third, separate table**, `ipo_financials` (schema.ts line 574,
`export const ipoFinancials`), not `financial_data`. `ipo_financials` has **no writer anywhere in
`scraper/src`** — the only hit for `ipoFinancials`/`ipo_financials` in the whole scraper tree is a
comment (`bse-detail-scraper.ts:10`, *"Populates ipo_details and ipo_financials tables"*, describing
intent, not code that runs). So these 6 keys are dead for the SAME reason as the rest (nothing calls
`getFieldRules` with these names, because nothing writes `ipo_financials` at all), but the
*mechanism* the design states — "shadowed by a camelCase sibling" — is wrong for this group: there
is no `revenueFy1` key in the matrix to be shadowed by; the real field just has no entry, live or
dead, anywhere. **Delete the 6 keys as dead weight, and separately record that `ipo_financials` is
an unbuilt/orphaned table** (same class as `ipo_scores`/`ipo_reviews`, §0.6's "an unbuilt feature,
not dead code" pattern) — whether it should be revived, merged into `financial_statements`, or
dropped is a product question this card does not answer, and is out of this item's scope.

**Group C — 16 keys with no sibling anywhere, live or dead** (`peer_companies`, `roe_percentage`,
`roce_percentage`, `pb_ratio`, `fresh_issue_size`, `offer_for_sale_size`, `issue_price`,
`min_investment`, `total_subscription`, `retail_subscription`, `qib_subscription`,
`nii_subscription`, `gmp_percentage`, `expected_listing_price`, `listing_price`,
`listing_gain_percentage`). Each has a REAL camelCase schema field (verified individually against
`packages/shared/src/db/schema.ts`: e.g. `gmpRecords.gmpPercentage` line 496, `gmpRecords.
expectedListingPrice` line 497, `subscriptions.totalSubscription` line 374,
`ipoFinancials.roePercentage` line 595) that has **zero matrix entry today** — the live field falls
through to `getFieldRules`'s `DEFAULT_RULES` (lines 867-872: plain NSE-first order, no
`confidenceThreshold` tuning, no `validation` bounds) every single consolidation cycle. **Deleting
these 16 without adding the correct camelCase entry (or a manifest row) would be a pure regression —
it removes dead text but leaves the live field exactly as unprotected as before.** This item deletes
the dead snake key AND, for each of the 16, either (a) confirms item 2's manifest already covers that
`table.column` (so `getFieldRules` finds it via the new manifest-first lookup and no TS fallback
entry is needed), or (b) adds a minimal camelCase TS entry for any of the 16 the manifest does not
yet cover, so no live field regresses from "wrong dead key" to "no key at all mid-migration."

**Total: 5 + 6 + 16 = 27 keys deleted, matching the measured count above, not the design's stated
13.** I could not find a criterion under which exactly 13 of these are "dead" and the other 14 are
not — every one of the 27 fails the same reachability test. **This is the contradiction to flag,
not silently resolve**: either the design's "13" underclaims what needs deleting (my
recommendation, on the measured evidence above), or there is a narrower definition of "dead
duplicate" the design intended that this session's reading did not reconstruct — **recorded as
C-1**: *"Is 'dead snake_case key' scoped to only the keys with an existing camelCase sibling (11,
by this session's count — Groups A+B), or every snake_case key nothing can ever reach (27, Groups
A+B+C)?"* Recommendation: 27 — Group C's entries are strictly worse than Groups A/B (they are the
ONLY entry for a live field, silently disabling that field's tuned validation, not merely a harmless
second entry), so leaving them because they weren't in the original "13" would keep the more serious
half of the bug.

### The `listingExchange` / `listingExchanges` repair (§7.3 item 8)

`packages/shared/src/db/schema.ts:296` — `listingExchanges` (plural, `jsonb`) is the only column;
there is no `listing_exchange` (singular) column anywhere in the schema. `scrapedIPO.listingExchange`
(singular) is a **scraper-input** field (`'NSE' | 'BSE' | 'BOTH' | undefined`, the raw per-source
signal — `scraper/src/services/listing-exchange-resolution.ts:45-58`) that gets resolved into the
plural array before it ever reaches `field_sources`; I could not find any current code path that
writes `field_sources.field_name = 'listingExchange'` (singular) — `grep -rn "'listingExchange'"
scraper/src` returns zero hits outside the input-variable name. **So the 224 singular rows §7.3
measured are historical** — written by an earlier version of the persister before whatever refactor
introduced `listing-exchange-resolution.ts`, not a live write path today. This means the fix is a
**data repair, not a code change**: delete the 224 stale rows (SQL above), no source code edit
needed. I flag this because the design's phrasing ("belongs in the matrix cleanup") could be
misread as "fix the matrix," and the matrix has no `listingExchange`/`listingExchanges` snake-case
duplicate to delete — field 17 in Appendix A (`listingExchanges`) is class **T** (named exception
E-1), already correctly camelCase, already singular-free.

## Feature flag

Reuses `ENABLE_FIELD_MANIFEST` from item 2 (`scraper/src/config/feature-flags.ts`). Off: `getFieldRules`
uses only the (now duplicate-free) TS object, unchanged behavior from today except the 27 deletions,
which are pure no-ops on production (none of the 27 was ever reachable). On: manifest-first lookup
per the Interfaces section. Default per slot: off in prod/staging/local until item 2's manifest
covers enough of the 190 D/T/X/W/M fields to be worth flipping — that threshold is a judgement call
for whoever lands this item, not fixed here.

## Tests

- **Unit** — `scraper/tests/unit/config/field-priority-matrix.test.ts` (NEW) (existing file — confirm with (NEW)
  `ls`, extend if present, create if not): (1) each of the 27 deleted keys is absent from
  `Object.keys(FIELD_PRIORITY_MATRIX)`; (2) the 5 Group-A camelCase siblings still resolve to the
  exact same `FieldRules` object shape they had before (regression guard — the sibling's own rules
  must not change, only the duplicate disappears); (3) for each of the 16 Group-C fields, `getFieldRules`
  with `ENABLE_FIELD_MANIFEST=false` returns either the new minimal TS entry (if this item added one)
  or `DEFAULT_RULES` with a passing assertion that this is a KNOWN, tracked gap, not a silent one;
  (4) with `ENABLE_FIELD_MANIFEST=true` and a manifest fixture containing `ipos.issue_size`,
  `getFieldRules('issueSize', 'ipos')` returns the manifest's rank order, not the TS object's.
- **Red before the change:** test (1) is red today (all 27 keys currently present); tests (2)-(4)
  are new, so they are red by absence, matching the template's rule for a net-new assertion.

## Detection

`docs/reviews/detection-checks/matrix-manifest-drift.json` (NEW, per `recurrence-detection-gate.md`
— this item touches `scraper/src/config/field-priority-matrix.ts`, which the gate's path list
covers): asserts, nightly, that no key remaining in `FIELD_PRIORITY_MATRIX` contains an underscore
UNLESS it is the sole entry for that concept (no camelCase sibling exists) — i.e. this check would
have caught Groups A and B before they ever shipped, and continues to catch any future PR that
reintroduces a shadowed snake_case key. It does not catch Group C by construction (there is nothing
to compare against without the manifest) — once `ENABLE_FIELD_MANIFEST` is on everywhere, a second
check (`manifest-coverage.json`, deferred to whichever item actually completes the 190-field
manifest) closes that half.

## Staging proof

`pm2 logs ipodhan-scraper` after the next scheduled cycle post-deploy, grep for the per-field
`[DataConsolidation]` log lines this service already emits (e.g. the W-145 log line quoted in
`data-consolidation-service.ts:815`) — confirm at least one `issueSize`/`openDate`/`lotSize` field
still resolves and writes normally (proves the 5 Group-A deletions did not silently drop the live
camelCase sibling too). For the `listingExchange` repair specifically: `SELECT count(*) FROM
field_sources WHERE table_name='ipos' AND field_name='listingExchange'` against staging before and
after `--apply`, expecting the post count to be 0, plus
`node scripts/assert-repair-held.mjs listing-exchange-singular-gone --cycles 2` (per
`defect-fix-contract.md` item 5) run against staging after two real scraper cycles, to prove no
code path resurrects the singular key.

## Rollback

The 27 key deletions: `git revert` — none of them was ever reachable, so nothing about the running
system's behavior can regress by reverting. The manifest-first lookup in `getFieldRules`: gated by
`ENABLE_FIELD_MANIFEST`, flip to `false` to fall back to the TS object immediately, no deploy needed
if the flag is read from env at runtime (confirm this — `feature-flags.ts`'s existing flags are all
`process.env.X === 'true'`, read once at module load, so a flag flip today needs a process restart;
same constraint applies here, not a new one this item introduces). The `listingExchange` data
repair: **not reversible** — the 224 rows are historical provenance for a column that does not
exist; there is nothing correct to restore them to. This is why the repair script is dry-run by
default and requires an explicit `--apply`.

## Tier, budget and cost

**Tier B** for the 27 key deletions and the manifest-wiring (ordinary app code, CI green is the
gate). **Tier A** for the `listingExchange` data repair specifically (data repair on a production
table, per `defect-fix-contract.md`'s own classification of repair tools as Tier A regardless of
size). `Budget: 30 min wall-clock, 60 tool calls` for the deletions/wiring; `Budget: 15 min
wall-clock, 30 tool calls` for the repair script (small, single DELETE, dry-run proven on staging
first). One review round expected for each; the repair script additionally needs the Tier A
mutation-test pass per `engineering-roles.md`'s Code-Quality Reviewer mandate (does the dry-run
truly change nothing; does `--apply` require an explicit flag with no default-on path).

---

### A note on the `C-n` numbering in this card

`C-1`, `C-2` and any other `C-n` in this card are **card-local decisions**: reversible, internal
choices the card author made and recorded so an implementer can see them and disagree. They are NOT
owner forks. Owner forks live in §0.0.2 of `docs/design/data-sourcing-pull-model.md` as `O-nn`, and
this card opened none — an earlier draft numbered these as `O-13` and `O-14`, which collided with the
real owner fork O-13 (the grey-market premium and the market-hours gate).

## Rules implemented

<!-- generated by docs/design/apply-rule-ownership.mjs - edits inside this block are overwritten -->

1 rule(s) from `docs/design/rules.json`, generated by
`node docs/design/apply-rule-ownership.mjs --apply` from `rule-ownership.json`.

| Design section | Rule ids |
|---|---|
| §1.12 | R-158 |

## Known gaps

None recorded yet. A finding this item owns but does not close is written here, with its
id and the reason — that is what stops "zero open findings" being reached by dropping one.
