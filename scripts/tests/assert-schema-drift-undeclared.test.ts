// Self-test for the #665 reverse-direction drift functions in
// assert-schema-drift.ts: diffUndeclaredIndexes() / diffUndeclaredUniqueConstraints().
// Pure functions over fixture inputs — no database required, so this runs in
// pr-gate.yml's no-DB "scripts/tests suite" job (see that workflow file for
// why assert-schema-drift.test.ts itself, which DOES need a live Postgres,
// deliberately is NOT in that job).
//
// Run: npx tsx --test scripts/tests/assert-schema-drift-undeclared.test.ts
//
// Class under test (#665): every index or unique constraint that exists on a
// live database but is not declared anywhere in schema.ts — checkIndexes()/
// checkUniqueConstraints() only ever check the opposite direction
// (declared -> present live), so a hand-applied object like staging's
// ipos_symbol_key was invisible to the existing script.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffUndeclaredIndexes,
  diffUndeclaredUniqueConstraints,
  ALLOWED_UNDECLARED_INDEXES,
  ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS,
  type LiveIndexRow,
  type LiveConstraintRow,
  type IndexExpectation,
  type UniqueConstraintExpectation,
  type UniqueColumnExpectation,
} from '../assert-schema-drift';

// ---- diffUndeclaredIndexes() ----

test('a live unique index absent from schema.ts entirely -> named UNDECLARED_INDEX (the #665 mechanism)', () => {
  // Mirrors #665's exact real-world finding: ipos_symbol_key exists on
  // staging, hand-applied, and schema.ts declares only index('idx_ipos_symbol')
  // on that column — no unique() anywhere.
  const liveIndexes: LiveIndexRow[] = [
    { tableName: 'ipos', indexName: 'ipos_symbol_key', columns: ['symbol'], isUnique: true, isPrimary: false },
  ];
  const drifts = diffUndeclaredIndexes(liveIndexes, [], [], [], []);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].kind, 'UNDECLARED_INDEX');
  assert.match(drifts[0].detail, /"ipos\.ipos_symbol_key"/);
  assert.match(drifts[0].detail, /not declared anywhere in schema\.ts/);
});

test('a live index whose name matches a declared index() -> no drift', () => {
  const liveIndexes: LiveIndexRow[] = [
    { tableName: 'ipos', indexName: 'idx_ipos_status', columns: ['status'], isUnique: false, isPrimary: false },
  ];
  const declaredIndexes: IndexExpectation[] = [
    { tableName: 'ipos', indexName: 'idx_ipos_status', columns: ['status'] },
  ];
  const drifts = diffUndeclaredIndexes(liveIndexes, declaredIndexes, [], [], []);
  assert.deepEqual(drifts, []);
});

test('a PRIMARY KEY backing index is never reported, even though schema.ts never names it as an index', () => {
  const liveIndexes: LiveIndexRow[] = [
    { tableName: 'ipos', indexName: 'ipos_pkey', columns: ['id'], isUnique: true, isPrimary: true },
  ];
  const drifts = diffUndeclaredIndexes(liveIndexes, [], [], [], []);
  assert.deepEqual(drifts, []);
});

test('the backing index for a declared table-level unique() constraint is not double-reported', () => {
  const liveIndexes: LiveIndexRow[] = [
    {
      tableName: 'promoters',
      indexName: 'unique_promoters_ipo_id_normalized_name',
      columns: ['ipo_id', 'normalized_name'],
      isUnique: true,
      isPrimary: false,
    },
  ];
  const declaredUniqueConstraints: UniqueConstraintExpectation[] = [
    { tableName: 'promoters', constraintName: 'unique_promoters_ipo_id_normalized_name', columns: ['ipo_id', 'normalized_name'] },
  ];
  const drifts = diffUndeclaredIndexes(liveIndexes, [], declaredUniqueConstraints, [], []);
  assert.deepEqual(drifts, []);
});

test('the backing index for a declared column-level .unique() is matched by (table, column), not by name', () => {
  // Regression fixture for the false-positive class found while building this
  // check: schema.ts's admin_settings.settingKey carries .unique() with no
  // explicit name, but the REAL applied migration named the constraint using
  // Postgres's own default ("_key" suffix), not drizzle's computed default
  // ("_unique" suffix) — so name-only matching would wrongly flag it.
  const liveIndexes: LiveIndexRow[] = [
    {
      tableName: 'admin_settings',
      indexName: 'admin_settings_setting_key_key', // Postgres default naming, NOT drizzle's "_unique" convention
      columns: ['setting_key'],
      isUnique: true,
      isPrimary: false,
    },
  ];
  const declaredUniqueColumns: UniqueColumnExpectation[] = [{ tableName: 'admin_settings', columnName: 'setting_key' }];
  const drifts = diffUndeclaredIndexes(liveIndexes, [], [], declaredUniqueColumns, []);
  assert.deepEqual(drifts, []);
});

test('a NON-unique index on a column that happens to be declared unique is still reported (column-unique match requires isUnique)', () => {
  const liveIndexes: LiveIndexRow[] = [
    { tableName: 'ipos', indexName: 'idx_ipos_slug', columns: ['slug'], isUnique: false, isPrimary: false },
  ];
  const declaredUniqueColumns: UniqueColumnExpectation[] = [{ tableName: 'ipos', columnName: 'slug' }];
  // idx_ipos_slug is ALSO a real declared index() in schema.ts in practice,
  // but this fixture isolates the column-unique exclusion path specifically:
  // a plain non-unique index is a distinct object from the unique()'s backing
  // index and must not be silently swallowed by the same exclusion.
  const drifts = diffUndeclaredIndexes(liveIndexes, [], [], declaredUniqueColumns, []);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].kind, 'UNDECLARED_INDEX');
});

test('an entry in the allow-list is suppressed by (table, name), with its reason available for review', () => {
  const liveIndexes: LiveIndexRow[] = [
    {
      tableName: 'ipo_risk_factors',
      indexName: 'unique_ipo_risk_factors_ipo_seq',
      columns: ['ipo_id', 'seq'],
      isUnique: true,
      isPrimary: false,
    },
  ];
  const drifts = diffUndeclaredIndexes(liveIndexes, [], [], [], ALLOWED_UNDECLARED_INDEXES);
  assert.deepEqual(drifts, []);
  assert.ok(ALLOWED_UNDECLARED_INDEXES.some((e) => e.tableName === 'ipo_risk_factors' && e.reason.length >= 20));
});

// ---- diffUndeclaredUniqueConstraints() ----

test('a live UNIQUE constraint absent from schema.ts -> named UNDECLARED_UNIQUE_CONSTRAINT', () => {
  const liveConstraints: LiveConstraintRow[] = [
    { tableName: 'users', constraintName: 'users_email_key', constraintType: 'UNIQUE', columns: ['email'] },
  ];
  const drifts = diffUndeclaredUniqueConstraints(liveConstraints, [], [], []);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].kind, 'UNDECLARED_UNIQUE_CONSTRAINT');
  assert.match(drifts[0].detail, /"users\.users_email_key"/);
});

test('a PRIMARY KEY constraint is never reported by this check', () => {
  const liveConstraints: LiveConstraintRow[] = [
    { tableName: 'users', constraintName: 'users_pkey', constraintType: 'PRIMARY KEY', columns: ['id'] },
  ];
  const drifts = diffUndeclaredUniqueConstraints(liveConstraints, [], [], []);
  assert.deepEqual(drifts, []);
});

test('a constraint matching a declared column-level .unique() by (table, column) is not reported, regardless of its live name', () => {
  const liveConstraints: LiveConstraintRow[] = [
    { tableName: 'ipo_details', constraintName: 'ipo_details_ipo_id_key', constraintType: 'UNIQUE', columns: ['ipo_id'] },
  ];
  const declaredUniqueColumns: UniqueColumnExpectation[] = [{ tableName: 'ipo_details', columnName: 'ipo_id' }];
  const drifts = diffUndeclaredUniqueConstraints(liveConstraints, [], declaredUniqueColumns, []);
  assert.deepEqual(drifts, []);
});

test('a composite constraint is NOT matched by a single declared unique column (no partial match)', () => {
  const liveConstraints: LiveConstraintRow[] = [
    {
      tableName: 'ipo_scores',
      constraintName: 'ipo_scores_ipo_id_calculated_at_key',
      constraintType: 'UNIQUE',
      columns: ['ipo_id', 'calculated_at'],
    },
  ];
  // ipo_scores.ipo_id IS declared unique as a single column, but this live
  // constraint covers TWO columns — a different object, still a real gap.
  const declaredUniqueColumns: UniqueColumnExpectation[] = [{ tableName: 'ipo_scores', columnName: 'ipo_id' }];
  const drifts = diffUndeclaredUniqueConstraints(liveConstraints, [], declaredUniqueColumns, []);
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].kind, 'UNDECLARED_UNIQUE_CONSTRAINT');
});

test('the gated ipo_risk_factors legacy constraint is suppressed by the reviewed allow-list, and only by exact (table, name)', () => {
  const liveConstraints: LiveConstraintRow[] = [
    { tableName: 'ipo_risk_factors', constraintName: 'unique_ipo_risk_factors_ipo_seq', constraintType: 'UNIQUE', columns: ['ipo_id', 'seq'] },
  ];
  const drifts = diffUndeclaredUniqueConstraints(liveConstraints, [], [], ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS);
  assert.deepEqual(drifts, []);

  // A DIFFERENT constraint on the same table is not swallowed by the allow-list.
  const otherConstraints: LiveConstraintRow[] = [
    { tableName: 'ipo_risk_factors', constraintName: 'some_other_constraint', constraintType: 'UNIQUE', columns: ['heading_hash'] },
  ];
  const otherDrifts = diffUndeclaredUniqueConstraints(otherConstraints, [], [], ALLOWED_UNDECLARED_UNIQUE_CONSTRAINTS);
  assert.equal(otherDrifts.length, 1);
});

// ---- diffAgainstUndeclaredBaseline() (review round 1 — shrink-only baseline) ----

import { diffAgainstUndeclaredBaseline, type UndeclaredBaselineEntry, type Drift } from '../assert-schema-drift';

test('an object in the baseline is reported as known, not fatal', () => {
  const baseline: UndeclaredBaselineEntry[] = [
    { kind: 'UNDECLARED_INDEX', tableName: 'ipos', name: 'ipos_symbol_key', issue: '#665' },
  ];
  const liveDrifts: Drift[] = [
    { kind: 'UNDECLARED_INDEX', detail: '"ipos.ipos_symbol_key" (columns: symbol, UNIQUE) exists on the live database but is not declared anywhere in schema.ts' },
  ];
  const { known, newDrifts, staleEntries } = diffAgainstUndeclaredBaseline(liveDrifts, baseline);
  assert.equal(known.length, 1);
  assert.deepEqual(newDrifts, []);
  assert.deepEqual(staleEntries, []);
});

test('a NEW object not in the baseline fails (appears in newDrifts)', () => {
  const baseline: UndeclaredBaselineEntry[] = [
    { kind: 'UNDECLARED_INDEX', tableName: 'ipos', name: 'ipos_symbol_key', issue: '#665' },
  ];
  const liveDrifts: Drift[] = [
    { kind: 'UNDECLARED_INDEX', detail: '"ipos.ipos_symbol_key" (columns: symbol, UNIQUE) exists on the live database but is not declared anywhere in schema.ts' },
    { kind: 'UNDECLARED_UNIQUE_CONSTRAINT', detail: '"prod_only_table.brand_new_constraint" (columns: foo) exists on the live database but is not declared anywhere in schema.ts' },
  ];
  const { known, newDrifts } = diffAgainstUndeclaredBaseline(liveDrifts, baseline);
  assert.equal(known.length, 1);
  assert.equal(newDrifts.length, 1);
  assert.match(newDrifts[0].detail, /prod_only_table\.brand_new_constraint/);
});

test('a stale baseline entry (object no longer live) is reported so the baseline is forced to shrink', () => {
  const baseline: UndeclaredBaselineEntry[] = [
    { kind: 'UNDECLARED_INDEX', tableName: 'ipos', name: 'ipos_symbol_key', issue: '#665' },
    { kind: 'UNDECLARED_INDEX', tableName: 'users', name: 'users_email_key', issue: '#665' },
  ];
  // users_email_key was fixed (declared in schema.ts) and no longer drifts live.
  const liveDrifts: Drift[] = [
    { kind: 'UNDECLARED_INDEX', detail: '"ipos.ipos_symbol_key" (columns: symbol, UNIQUE) exists on the live database but is not declared anywhere in schema.ts' },
  ];
  const { known, newDrifts, staleEntries } = diffAgainstUndeclaredBaseline(liveDrifts, baseline);
  assert.equal(known.length, 1);
  assert.deepEqual(newDrifts, []);
  assert.equal(staleEntries.length, 1);
  assert.equal(staleEntries[0].name, 'users_email_key');
});

test('an empty baseline against no live drifts is fully clean (all buckets empty)', () => {
  const { known, newDrifts, staleEntries } = diffAgainstUndeclaredBaseline([], []);
  assert.deepEqual(known, []);
  assert.deepEqual(newDrifts, []);
  assert.deepEqual(staleEntries, []);
});
