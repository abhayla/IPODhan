// OD-75 round 2 (PR #914): the admin-only conflict reasons have ONE definition per language — the
// TS list in packages/shared/src/utils/conflict-reasons.ts and its SQL twin in
// scripts/lib/conflict-reasons.mjs. This file keeps them equal and pins every .mjs reader of
// data_conflicts that counts or decides to the shared predicate.
// The SQL itself is proven against ipodhan_test in
// scraper/tests/integration/od73-settled-field.integration.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ADMIN_ONLY_CONFLICT_REASONS,
  SOURCE_CHANGED_OWN_VALUE,
  behaviourConflictPredicate,
  UNRESOLVED_CONFLICT_COUNT_SQL,
  UNRESOLVED_CONFLICT_NOISE_SQL,
  CONFLICTS_INSERTED_24H_SQL,
} from '../lib/conflict-reasons.mjs';
import { adminQueueSize } from '../ops/admin-queue-size.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the .mjs admin-only reason list equals the TS list (parity)', () => {
  const ts = readFileSync(join(ROOT, 'packages/shared/src/utils/conflict-reasons.ts'), 'utf8');
  const constant = /export const SOURCE_CHANGED_OWN_VALUE = '([A-Z_]+)'/.exec(ts);
  assert.ok(constant, 'SOURCE_CHANGED_OWN_VALUE literal not found in the TS source');
  assert.equal(SOURCE_CHANGED_OWN_VALUE, constant[1]);
  const list = /ADMIN_ONLY_CONFLICT_REASONS: readonly string\[\] = \[([^\]]*)\]/.exec(ts);
  assert.ok(list, 'ADMIN_ONLY_CONFLICT_REASONS not found in the TS source');
  const names = list[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(names, ['SOURCE_CHANGED_OWN_VALUE']);
  assert.deepEqual([...ADMIN_ONLY_CONFLICT_REASONS], ['SOURCE_CHANGED_OWN_VALUE']);
});

test('the predicate excludes every admin-only reason and keeps NULL reasons', () => {
  const p = behaviourConflictPredicate('dc');
  assert.match(p, /dc\.resolution_reason IS NULL/);
  for (const r of ADMIN_ONLY_CONFLICT_REASONS) assert.ok(p.includes(`'${r}'`), `${r} missing from ${p}`);
});

test('every count query used by the nightly floor carries the predicate', () => {
  for (const sql of [UNRESOLVED_CONFLICT_COUNT_SQL, UNRESOLVED_CONFLICT_NOISE_SQL, CONFLICTS_INSERTED_24H_SQL]) {
    assert.ok(sql.includes(behaviourConflictPredicate()), sql);
  }
});

test('audit-detection-floor reads data_conflicts counts only through the shared queries', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-detection-floor.mjs'), 'utf8');
  for (const name of ['UNRESOLVED_CONFLICT_COUNT_SQL', 'UNRESOLVED_CONFLICT_NOISE_SQL', 'CONFLICTS_INSERTED_24H_SQL']) {
    assert.ok(src.includes(`q(${name})`), `${name} is not what the floor runs`);
  }
  // The live cross-source disagreement secondary signal (a/b) must also skip admin-only rows.
  assert.ok(src.includes("${behaviourConflictPredicate('c')}"), 'live-disagreement conflict read lacks the predicate');
});

test('adminQueueSize counts only real disputes (the conflict query carries the predicate)', async () => {
  const seen = [];
  const pool = { query: async (sql) => { seen.push(sql); return { rows: [] }; } };
  await adminQueueSize(pool);
  const conflictSql = seen.find((s) => /FROM data_conflicts/.test(s));
  assert.ok(conflictSql, 'adminQueueSize did not read data_conflicts');
  assert.ok(conflictSql.includes(behaviourConflictPredicate('dc')), conflictSql);
});
