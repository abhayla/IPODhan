# S2 — witnesses jsonb + 5-state verdict; retire dead verify* columns

**Core:** the schema can record a SECOND witness for a field. Today `field_sources` physically
cannot: `unique_field_source_per_ipo` on (ipoId, tableName, rowKey, fieldName) makes one row per
field BY CONSTRUCTION.
**Proof:** a real-DB integration test writes two witness answers for one field on `ipodhan_test`,
reads them back, and the unique constraint is still intact (a second INSERT for the same field
still raises 23505).

RCA: the consensus model needs N answers per field; the table holds 1 by unique constraint.
Class: every field instance in `field_sources` — all 10,836 rows on staging, all segments,
       all statuses, rows written before AND after the change.
Tier: A (journaled migration on a live table).

## What lands
1. `witnesses jsonb` on `field_sources` — nullable, default NULL. Shape:
   `[{source, value, at, docType?}]` — the OTHER answers, beside the winning `source`/value.
2. `verdict varchar(16)` on `field_sources` — nullable. Five states, per the board:
   CONFIRMED | DISPUTED | UNCONFIRMED | SINGLE_SOURCE | NO_WITNESS.
   Nullable because every existing row predates the model — a NOT NULL default would assert a
   verdict nothing computed.
3. DROP the five dead `ipo_field_plan` columns: verify_due_at, verify_state, verify_source,
   verify_value, disagreement_count + index idx_ipo_field_plan_verify_due.
4. `web/lib/repositories/ipo-field-plan-repository.ts`: drop verifyDueAt from the select and
   the `isStale` computation that reads it.

## Measured basis for the drop (staging, this session)
13,512 plan rows: verify_due_at NULL 13,512/13,512, verify_state 0, verify_source 0,
verify_value 0, disagreement_count>0 in 0 rows. Only reader is the repository above, and
`isStale` therefore evaluates FALSE for every row today. Dropping changes no rendered output.
No scraper code writes them — the re-read loop (item 9) that would have was never built, and
OD-56 supersedes it.

## isStale — the one real decision
`FieldProvenance.isStale` loses its input. Two options:
 (a) drop `isStale` from the type and its two consumers;
 (b) keep the field, hard-code false.
Choose (a). (b) is a lie that type-checks. `summariseFieldGroup` ORs isStale across a group;
keeping a permanently-false input there is dead logic that a later reader will trust.

## Failing tests first
- T1 (integration, real DB): insert a field_sources row with two witnesses; read back; assert
  witnesses length 2 and verdict 'CONFIRMED'. RED before the migration (column absent).
- T2 (integration): the unique constraint still refuses a second row for the same
  (ipoId, tableName, rowKey, fieldName). Proves the jsonb approach did not weaken it.
- T3 (unit): the repository returns a provenance map with no isStale key.
- T4: drizzle-kit generate produces exactly ONE new journal entry (no drift).

## Mutation tests
- Remove `witnesses` from the schema -> T1 red.
- Widen the unique constraint to include a witness column -> T2 red.
- Re-add verifyDueAt to the repository select -> T3 red.

## Proof (real data)
Migration applied to `ipodhan_test` through the tunnel; `\d field_sources` shows both columns;
`\d ipo_field_plan` shows the five gone; integration suite green with a READ COUNT, not exit 0.

## Out of scope, named
- Nothing WRITES witnesses yet. That is S3a (collect) and S3b (decide). S2 is the container only.
- OD-57's DATE family is missing from S1's ComparisonFamily (only MONEY/RATIO/IDENTITY/IDENTIFIER).
  Dates were the LARGEST disagreement family — 12,719 of 28,946. Recorded as an S3b prerequisite.

No detection change: this slice adds schema capacity only; no scraper write path changes, so no
existing check can regress. The consensus check that reads these columns is S7.
