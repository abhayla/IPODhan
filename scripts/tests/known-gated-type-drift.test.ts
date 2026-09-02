// Mutation-proof self-test for the KNOWN_GATED_TYPE_DRIFT exact-match
// predicate (T-405 L1). Run: npx tsx --test scripts/tests/known-gated-type-drift.test.ts
//
// L1 fix: isKnownGatedDrift() used to match on table.column PREFIX only, so
// ANY future type drift on one of the 11 gated columns would be silently
// ignored in CI — including a drift that has nothing to do with the
// already-approved widening. These tests pin the exact-match behavior: only
// the EXACT registered (table, column, expected, actual) tuple is gated;
// same column + different actual type, or an unrelated column, still fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isKnownGatedDrift, KNOWN_GATED_TYPE_DRIFT, type Drift } from '../assert-schema-drift';

test('an exact gated finding (from evidence/T-405/after-drift.txt) is ignored', () => {
  const gated = KNOWN_GATED_TYPE_DRIFT[0]; // gmp_records.gmp
  const drift: Drift = {
    kind: 'COLUMN_TYPE_MISMATCH',
    detail: `"${gated.tableName}.${gated.columnName}" expects ${gated.expected}, live column is ${gated.actual}`,
  };
  assert.equal(isKnownGatedDrift(drift), true);
});

test('every registered entry round-trips as gated', () => {
  for (const g of KNOWN_GATED_TYPE_DRIFT) {
    const drift: Drift = {
      kind: 'COLUMN_TYPE_MISMATCH',
      detail: `"${g.tableName}.${g.columnName}" expects ${g.expected}, live column is ${g.actual}`,
    };
    assert.equal(isKnownGatedDrift(drift), true, `expected ${g.tableName}.${g.columnName} to be gated`);
  }
});

test('same gated column but a DIFFERENT actual type is NOT ignored', () => {
  const gated = KNOWN_GATED_TYPE_DRIFT[0]; // gmp_records.gmp, registered actual numeric(32,0)
  const drift: Drift = {
    kind: 'COLUMN_TYPE_MISMATCH',
    detail: `"${gated.tableName}.${gated.columnName}" expects ${gated.expected}, live column is numeric(8,4)`,
  };
  assert.equal(isKnownGatedDrift(drift), false);
});

test('same gated column but a DIFFERENT expected type is NOT ignored', () => {
  const gated = KNOWN_GATED_TYPE_DRIFT[0];
  const drift: Drift = {
    kind: 'COLUMN_TYPE_MISMATCH',
    detail: `"${gated.tableName}.${gated.columnName}" expects numeric(12,4), live column is ${gated.actual}`,
  };
  assert.equal(isKnownGatedDrift(drift), false);
});

test('an unrelated column is NOT ignored', () => {
  const drift: Drift = {
    kind: 'COLUMN_TYPE_MISMATCH',
    detail: `"ipos.registrar" expects varchar(255), live column is varchar(100)`,
  };
  assert.equal(isKnownGatedDrift(drift), false);
});

test('a non-COLUMN_TYPE_MISMATCH kind is never gated even with a matching detail string', () => {
  const gated = KNOWN_GATED_TYPE_DRIFT[0];
  const drift: Drift = {
    kind: 'MISSING_COLUMN',
    detail: `"${gated.tableName}.${gated.columnName}" expects ${gated.expected}, live column is ${gated.actual}`,
  };
  assert.equal(isKnownGatedDrift(drift), false);
});
