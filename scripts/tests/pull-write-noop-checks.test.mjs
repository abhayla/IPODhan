// #1490: PULL-NOOP / PULL-WRITE verdict logic. Each case can fail: delete an exemption in
// scripts/lib/pull-write-noop-checks.mjs and the matching case goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyNoopWrites, evaluatePullWrite, toCamel } from '../lib/pull-write-noop-checks.mjs';

const row = (o) => ({ previousValue: null, previousSource: null, source: 'DRHP', hasReceipt: false, answersRound: false, ...o });

test('(pull_noop) re-read-only writes (no value change) are not real changes', () => {
  const c = classifyNoopWrites([row({ previousSource: 'DRHP' }), row({}), row({ hasReceipt: true })]);
  assert.equal(c.touched, 3);
  assert.equal(c.realChanges, 0);
  assert.equal(c.unexplained, 0);
});

test('(pull_noop) a real value flip with no document or round cause is unexplained (FAIL shape)', () => {
  const c = classifyNoopWrites([row({ previousValue: '100' }), row({ previousSource: 'NSE', source: 'BSE' })]);
  assert.equal(c.realChanges, 2);
  assert.equal(c.unexplained, 2);
});

test('(pull_noop) a real change on an IPO with a receipt in the window is exempt (re-read)', () => {
  const c = classifyNoopWrites([row({ previousValue: '100', hasReceipt: true })]);
  assert.deepEqual([c.unexplained, c.exemptedReread], [0, 1]);
});

test('(pull_noop) a real change on an answers-round IPO is exempt', () => {
  const c = classifyNoopWrites([row({ previousValue: '100', answersRound: true })]);
  assert.deepEqual([c.unexplained, c.exemptedAnswers], [0, 1]);
});

test('(pull_noop) the floor query reads receipts and answers_round_at', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'audit-detection-floor.mjs'), 'utf8');
  const body = src.slice(src.indexOf('async function checkS_pullNoop'), src.indexOf('async function checkS_e1Source'));
  assert.match(body, /document_field_receipts/);
  assert.match(body, /answers_round_at/);
  assert.match(body, /classifyNoopWrites\(touched\)/);
});

// rows: [{ipo, key, v}] -- a fake child table. The fake honours the WHERE the lib builds, so a dropped
// row_key filter changes the rows returned and the case goes red.
function fakeQ({ columns, rows }) {
  return async (sql, params) => {
    if (/information_schema\.columns/.test(sql)) return columns.map((c) => ({ column_name: c }));
    if (/^SELECT "/.test(sql)) {
      const keyed = /fiscal_year = \$2 AND basis = \$3/.test(sql);
      return rows
        .filter((r) => r.ipo === params[0] && (!keyed || r.key === `${params[1]}:${params[2]}`))
        .map((r) => ({ v: r.v }));
    }
    throw new Error('unexpected sql ' + sql);
  };
}
const plan = (o) => ({ ipoId: 'i1', slug: 'acme', tableName: 'financial_statements', rowKey: '', fieldName: 'basis', answers: null, ...o });
const stored = (...vs) => vs.map((v, i) => ({ ipo: 'i1', key: `202${i}:RESTATED`, v }));

test('(pull_write) toCamel converts the plan snake_case field to field_sources camelCase', () => {
  assert.equal(toCamel('price_range_max'), 'priceRangeMax');
});

test('(pull_write) SUPPLIED with an empty stored column and no write is a missed write (FAIL)', async () => {
  const r = await evaluatePullWrite([plan({ answers: [{ outcome: 'SUPPLIED', value: 'RESTATED' }] })], new Set(),
    fakeQ({ columns: ['basis'], rows: stored(null, '') }));
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0].why, /empty/);
});

test('(pull_write) credited answer (no value) with the column stored on every row passes', async () => {
  const r = await evaluatePullWrite([plan({ answers: [{ outcome: 'SUPPLIED', value: null, credited: 'DOCUMENT_ROWS_STORED' }] })], new Set(),
    fakeQ({ columns: ['basis'], rows: stored('RESTATED', 'RESTATED') }));
  assert.deepEqual([r.missing.length, r.credited], [0, 1]);
});

test('(pull_write) credited answer, but one row of the IPO is empty -> missing', async () => {
  const r = await evaluatePullWrite([plan({ answers: [{ outcome: 'SUPPLIED', value: null, credited: 'DOCUMENT_ROWS_STORED' }] })], new Set(),
    fakeQ({ columns: ['basis'], rows: stored('RESTATED', null) }));
  assert.equal(r.missing.length, 1);
});

test('(pull_write) answer value equal to stored passes; a credited answer whose value differs from stored fails', async () => {
  const ok = await evaluatePullWrite([plan({ answers: [{ outcome: 'SUPPLIED', value: 'LAKH' }] })], new Set(),
    fakeQ({ columns: ['basis'], rows: stored('LAKH') }));
  assert.equal(ok.missing.length, 0);
  const bad = await evaluatePullWrite([plan({ answers: [{ outcome: 'SUPPLIED', value: 'LAKH', credited: 'DOCUMENT_VALUE_STORED' }] })], new Set(),
    fakeQ({ columns: ['basis'], rows: stored('MILLION') }));
  assert.equal(bad.missing.length, 1);
  assert.match(bad.missing[0].why, /differs/);
});

test('(pull_write) multi-row child table: row A has a value, row B is empty -> B is missing, A is not', async () => {
  const q = fakeQ({ columns: ['unit'], rows: [{ ipo: 'i1', key: '2024:RESTATED', v: 'LAKH' }, { ipo: 'i1', key: '2023:RESTATED', v: null }] });
  const ans = [{ outcome: 'SUPPLIED', value: 'LAKH' }];
  const a = await evaluatePullWrite([plan({ fieldName: 'unit', rowKey: '2024:RESTATED', answers: ans })], new Set(), q);
  assert.equal(a.missing.length, 0);
  const b = await evaluatePullWrite([plan({ fieldName: 'unit', rowKey: '2023:RESTATED', answers: ans })], new Set(), q);
  assert.equal(b.missing.length, 1);
});

test('(pull_write) a row_key that cannot be identified is missing, never guessed', async () => {
  const r = await evaluatePullWrite([plan({ tableName: 'ipo_risk_factors', fieldName: 'seq', rowKey: '7' })], new Set(),
    fakeQ({ columns: ['seq'], rows: [{ ipo: 'i1', key: 'x', v: '1' }] }));
  assert.equal(r.missing.length, 1);
  assert.match(r.missing[0].why, /not identifiable/);
});

test('(pull_write) a write for the SAME field on ANOTHER ipo or row_key does not satisfy the plan row', async () => {
  const q = fakeQ({ columns: ['basis'], rows: [] });
  const wrongIpo = await evaluatePullWrite([plan({})], new Set(['i2|financial_statements||basis']), q);
  assert.equal(wrongIpo.missing.length, 1);
  const wrongKey = await evaluatePullWrite([plan({})], new Set(['i1|financial_statements|2024:RESTATED|basis']), q);
  assert.equal(wrongKey.missing.length, 1);
  const own = await evaluatePullWrite([plan({})], new Set(['i1|financial_statements||basis']), q);
  assert.equal(own.missing.length, 0);
});
