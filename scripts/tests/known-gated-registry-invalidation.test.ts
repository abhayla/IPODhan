// Self-invalidating registry test for KNOWN_GATED_INDEX_DRIFT and
// KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT (item 1 slice s3b fix round).
//
// KNOWN_GATED_INDEX_DRIFT's one entry (field_sources.idx_field_sources_ipo_table_field)
// carries a comment promising "remove this entry the moment slice s3 merges
// and schema.ts itself declares row_key on field_sources" — a comment is not
// a mechanism. This test makes that promise self-enforcing: it reads the
// SSOT (packages/shared/src/db/schema.ts) via the real
// collectExpectedIndexes() the drift checker itself uses (never a
// hard-coded re-typed string), and fails, naming the entry, the moment
// schema.ts's declared columns for that index stop matching the entry's
// `expectedColumns`. When slice s3 merges row_key into the index, this goes
// red and forces the entry's removal — it cannot silently keep gating a
// drift that no longer exists.
//
// Run: npx tsx --test scripts/tests/known-gated-registry-invalidation.test.ts
// (plain `node --test` cannot resolve the `@ipodhan/shared/db/schema` path
// alias the SSOT import needs — same reason known-gated-type-drift.test.ts
// and assert-schema-drift.test.ts in this directory are also tsx-run, not
// bare node --test.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectExpectedIndexes,
  collectExpectedUniqueConstraints,
  KNOWN_GATED_INDEX_DRIFT,
  KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT,
} from '../assert-schema-drift';

test('every KNOWN_GATED_INDEX_DRIFT entry still matches what schema.ts currently declares for that index', () => {
  const declared = collectExpectedIndexes();
  for (const gated of KNOWN_GATED_INDEX_DRIFT) {
    const live = declared.find(
      (d) => d.tableName === gated.tableName && d.indexName === gated.indexName
    );
    assert.ok(
      live,
      `stale KNOWN_GATED_INDEX_DRIFT entry: schema.ts no longer declares an index named ` +
        `"${gated.tableName}.${gated.indexName}" at all — remove the entry`
    );
    const declaredColumns = live.columns.join(', ');
    assert.equal(
      declaredColumns,
      gated.expectedColumns,
      `stale KNOWN_GATED_INDEX_DRIFT entry "${gated.tableName}.${gated.indexName}": ` +
        `entry says expectedColumns = "${gated.expectedColumns}" but schema.ts now declares ` +
        `(${declaredColumns}) for this index. This is exactly the "slice s3 merged, schema.ts ` +
        `now declares row_key" trigger the entry's comment promised to watch for — remove the ` +
        `entry (the drift it gated no longer exists).`
    );
  }
});

// KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT's invalidation condition is NOT a
// schema.ts change (schema.ts already declares all three constraints today
// — that is exactly why they are gated as MISSING_UNIQUE_CONSTRAINT, "declared
// in schema.ts but not live yet"). The condition that retires each entry is
// an operator hand-applying web/drizzle/migrations/_gated/E1_row_key_unique_constraints.sql
// on a given slot's LIVE database — state this unit test has no access to and
// must not fake a live DB connection to fabricate. What this test CAN and
// does assert is the narrower, still-real invariant: every gated entry names
// a unique constraint schema.ts still actually declares. If a future schema
// change renames or drops one of these constraints, the entry would silently
// gate nothing (or the wrong thing) — this test catches that class instead.
test('every KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT entry still names a unique constraint schema.ts currently declares', () => {
  const declared = collectExpectedUniqueConstraints();
  for (const gated of KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT) {
    const live = declared.find(
      (d) => d.tableName === gated.tableName && d.constraintName === gated.constraintName
    );
    assert.ok(
      live,
      `stale KNOWN_GATED_UNIQUE_CONSTRAINT_DRIFT entry: schema.ts no longer declares a unique ` +
        `constraint named "${gated.tableName}.${gated.constraintName}" — remove the entry`
    );
  }
});
