// OD-75 round 2 (PR #914): the admin-only conflict reasons have ONE definition per language — the
// TS list in packages/shared/src/utils/conflict-reasons.ts and its SQL twin in
// scripts/lib/conflict-reasons.mjs. This file keeps them equal and pins every .mjs reader of
// data_conflicts that counts or decides to the shared predicate.
// The SQL itself is proven against ipodhan_test in
// scraper/tests/integration/od73-settled-field.integration.test.ts.
//
// Item 9 (PR #989): behaviourConflictPredicate must keep working on a database that lags main's
// migrations (data_conflicts.document_id not yet applied) — the class that made the nightly audit
// error out and skip every later check. See scripts/lib/conflict-reasons.mjs for the RCA.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ADMIN_ONLY_CONFLICT_REASONS,
  SOURCE_CHANGED_OWN_VALUE,
  behaviourConflictPredicate,
  ensureDocumentIdProbe,
  unresolvedConflictCountSql,
  unresolvedConflictNoiseSql,
  conflictsInserted24hSql,
  _setDocumentIdProbeForTests,
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
  assert.deepEqual(names, ['SOURCE_CHANGED_OWN_VALUE', 'OVERRIDE_SOURCE_LOST_TO_PRIORITY']);
  assert.deepEqual([...ADMIN_ONLY_CONFLICT_REASONS], ['SOURCE_CHANGED_OWN_VALUE', 'OVERRIDE_SOURCE_LOST_TO_PRIORITY']);
});

test('the predicate excludes every admin-only reason and keeps NULL reasons', () => {
  _setDocumentIdProbeForTests(undefined);
  const p = behaviourConflictPredicate('dc');
  assert.match(p, /dc\.resolution_reason IS NULL/);
  for (const r of ADMIN_ONLY_CONFLICT_REASONS) assert.ok(p.includes(`'${r}'`), `${r} missing from ${p}`);
});

// OD-90 (item 9): a corrigendum suggestion (document_id set) is admin review work, not a dispute —
// every count and behaviour read in the .mjs scripts skips it through the same predicate, WHEN the
// column exists on the audited database.
// MUTATION: drop `document_id IS NULL` from behaviourConflictPredicate's true-branch -> RED.
test('unprobed / column-present: predicate excludes corrigendum suggestions (document_id IS NULL)', () => {
  _setDocumentIdProbeForTests(undefined); // never probed: pre-probe default is "present" (legacy-safe)
  assert.match(behaviourConflictPredicate('dc'), /dc\.document_id IS NULL/);
  assert.match(behaviourConflictPredicate(), /(^|[^.])document_id IS NULL/);

  _setDocumentIdProbeForTests(true); // probed, column present
  assert.match(behaviourConflictPredicate('dc'), /dc\.document_id IS NULL/);
  _setDocumentIdProbeForTests(undefined);
});

// Item 9 core fix: on a database without the column (prod lagging main's migrations), the
// predicate MUST NOT reference document_id at all — a reference to a column the DB does not have
// is exactly what made checkF/checkG3 throw and skip every later check nightly.
// MUTATION: make the false-branch always include the document_id clause -> RED (references a
// column that does not exist on the probed DB, reproducing the original outage).
test('column-absent: predicate omits document_id entirely (no reference to a missing column)', () => {
  _setDocumentIdProbeForTests(false);
  const p = behaviourConflictPredicate('dc');
  assert.doesNotMatch(p, /document_id/);
  assert.match(p, /dc\.resolution_reason IS NULL/);
  for (const sql of [unresolvedConflictCountSql(), unresolvedConflictNoiseSql(), conflictsInserted24hSql()]) {
    assert.doesNotMatch(sql, /document_id/, sql);
  }
  _setDocumentIdProbeForTests(undefined);
});

test('ensureDocumentIdProbe caches after one call and reflects the probed column state', async () => {
  _setDocumentIdProbeForTests(undefined);
  let calls = 0;
  const queryColumnAbsent = async () => { calls += 1; return { rows: [] }; };
  const first = await ensureDocumentIdProbe(queryColumnAbsent);
  const second = await ensureDocumentIdProbe(queryColumnAbsent);
  assert.equal(first, false);
  assert.equal(second, false);
  assert.equal(calls, 1, 'probe must run at most once per process (cached)');
  assert.doesNotMatch(behaviourConflictPredicate('dc'), /document_id/);
  _setDocumentIdProbeForTests(undefined);

  const queryColumnPresent = async () => { calls += 1; return { rows: [{ '?column?': 1 }] }; };
  const third = await ensureDocumentIdProbe(queryColumnPresent);
  assert.equal(third, true);
  assert.match(behaviourConflictPredicate('dc'), /document_id/);
  _setDocumentIdProbeForTests(undefined);
});

test('ensureDocumentIdProbe accepts a query that resolves to the row array directly (audit-detection-floor\'s `q` shape: pool.query(...).then(r => r.rows))', async () => {
  _setDocumentIdProbeForTests(undefined);
  let calls = 0;
  const arrayQueryColumnAbsent = async () => { calls += 1; return []; };
  const first = await ensureDocumentIdProbe(arrayQueryColumnAbsent);
  assert.equal(first, false, 'array-shaped query (no rows) must not throw and must read as absent');
  assert.equal(calls, 1);
  _setDocumentIdProbeForTests(undefined);

  const arrayQueryColumnPresent = async () => { calls += 1; return [{ '?column?': 1 }]; };
  const second = await ensureDocumentIdProbe(arrayQueryColumnPresent);
  assert.equal(second, true, 'array-shaped query (row present) must read as present');
  _setDocumentIdProbeForTests(undefined);
});

test('every count query used by the nightly floor carries the predicate', () => {
  _setDocumentIdProbeForTests(undefined);
  for (const sql of [unresolvedConflictCountSql(), unresolvedConflictNoiseSql(), conflictsInserted24hSql()]) {
    assert.ok(sql.includes(behaviourConflictPredicate()), sql);
  }
});

test('audit-detection-floor reads data_conflicts counts only through the shared queries, and probes before them', () => {
  const src = readFileSync(join(ROOT, 'scripts/audit-detection-floor.mjs'), 'utf8');
  for (const name of ['unresolvedConflictCountSql', 'unresolvedConflictNoiseSql', 'conflictsInserted24hSql']) {
    assert.ok(src.includes(`q(${name}())`), `${name} is not what the floor runs`);
  }
  assert.ok(src.includes('ensureDocumentIdProbe(q)'), 'main() never primes the document_id probe before the checks that depend on it');
  // The live cross-source disagreement secondary signal (a/b) must also skip admin-only rows.
  assert.ok(src.includes("${behaviourConflictPredicate('c')}"), 'live-disagreement conflict read lacks the predicate');
});

test('adminQueueSize counts only real disputes (the conflict query carries the predicate)', async () => {
  _setDocumentIdProbeForTests(undefined);
  const seen = [];
  const pool = { query: async (sql) => { seen.push(sql); return { rows: [] }; } };
  await adminQueueSize(pool);
  const conflictSql = seen.find((s) => /FROM data_conflicts/.test(s));
  assert.ok(conflictSql, 'adminQueueSize did not read data_conflicts');
  assert.ok(conflictSql.includes(behaviourConflictPredicate('dc')), conflictSql);
  _setDocumentIdProbeForTests(undefined);
});
