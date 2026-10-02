import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  attention, buildWitnesses, camelCase, formatValue, renderPageCell, renderRow, renderSourceCell, sourceColumns,
} from '../ops/lib/field-source-table-format.mjs';

const w = (over) => ({ rank: 1, source: 'NSE', status: 'abstained', outcome: null, value: null, cause: null, docType: null, credited: null, ...over });

test('renderSourceCell: a supplied value, with the document type only for DOC', () => {
  assert.equal(renderSourceCell(w({ source: 'DOC', status: 'value', outcome: 'SUPPLIED', value: '1', docType: 'DRHP' })), 'DOC: 1 (DRHP)');
  assert.equal(renderSourceCell(w({ source: 'BSE', status: 'value', outcome: 'SUPPLIED', value: 8 })), 'BSE: 8');
});

test('renderSourceCell: every outcome reads in plain words', () => {
  assert.equal(renderSourceCell(w({ status: 'never_asked' })), 'NSE: not asked yet');
  assert.equal(renderSourceCell(w({ outcome: 'NOT_AVAILABLE_YET' })), 'NSE: not available yet');
  assert.equal(renderSourceCell(w({ outcome: 'NOT_PRINTED' })), 'NSE: not printed by the source');
  assert.equal(renderSourceCell(w({ status: 'failed', outcome: 'CHECK_FAILED', cause: 'x [gap:NO_MAPPING]' })), 'NSE: no data (source not mapped)');
  assert.equal(renderSourceCell(w({ source: 'DOC', status: 'failed', outcome: 'CHECK_FAILED', cause: 'y [gap:NO_DOCUMENT_PROVENANCE]' })), 'DOC: not read from document');
  assert.equal(renderSourceCell(w({ status: 'failed', outcome: 'CHECK_FAILED', cause: 'timeout' })), 'NSE: check failed');
  assert.equal(renderSourceCell(w({ status: 'failed', outcome: 'FAILED' })), 'NSE: failed');
  assert.equal(renderSourceCell(w({ status: 'abstained', outcome: 'SUPPLIED' })), 'NSE: gave no value');
});

test('renderSourceCell: credited document rows are evidence, not a value', () => {
  assert.equal(renderSourceCell(w({ source: 'DOC', status: 'value', credited: { kind: 'ROWS', rowCount: 4 } })), 'DOC: 4 stored rows (credited)');
});

test('sourceColumns: rank order, padded to three, extra sources appended to the third', () => {
  const ws = [w({ rank: 2, source: 'BSE', status: 'never_asked' }), w({ rank: 1, source: 'DOC', status: 'never_asked' })];
  assert.deepEqual(sourceColumns(ws), ['DOC: not asked yet', 'BSE: not asked yet', '—']);
  const four = ['A', 'B', 'C', 'D'].map((s, i) => w({ rank: i + 1, source: s, status: 'never_asked' }));
  assert.deepEqual(sourceColumns(four), ['A: not asked yet', 'B: not asked yet', 'C: not asked yet; D: not asked yet']);
});

test('buildWitnesses: stored witnesses win, then the stored value, then plan answers, else never asked', () => {
  const out = buildWitnesses({
    ranks: ['DOC', 'NSE', 'BSE', 'CHITTORGARH'],
    witnesses: [{ source: 'NSE', outcome: 'NOT_AVAILABLE_YET', value: null }],
    planAnswers: [{ source: 'BSE', outcome: 'CHECK_FAILED', cause: 'c [gap:NO_MAPPING]' }],
    fsSource: 'DRHP',
    currentValue: 'v',
  });
  assert.equal(out[0].status, 'value');
  assert.equal(out[0].docType, 'DRHP');
  assert.equal(out[1].outcome, 'NOT_AVAILABLE_YET');
  assert.equal(out[2].outcome, 'CHECK_FAILED');
  assert.equal(out[3].status, 'never_asked');
});

test('buildWitnesses: a witness with no outcome is SUPPLIED; CG matches its CHITTORGARH alias', () => {
  const [a] = buildWitnesses({ ranks: ['CHITTORGARH'], witnesses: [{ source: 'CG', value: 'x' }], planAnswers: null, fsSource: null, currentValue: null });
  assert.equal(a.status, 'value');
  assert.equal(a.value, 'x');
});

test('renderPageCell: value with source, empty, and child-table row counts', () => {
  assert.equal(renderPageCell({ value: 'MAINBOARD', source: 'DRHP' }), 'MAINBOARD [from DRHP]');
  assert.equal(renderPageCell({ value: null, source: 'DRHP' }), '(empty)');
  assert.equal(renderPageCell({ value: [], source: null }), '(empty)');
  assert.equal(renderPageCell({ value: 'RESTATED', source: 'DRHP', rowCount: 3 }), '3 rows, e.g. RESTATED [from DRHP]');
  assert.equal(renderPageCell({ value: null, source: null, rowCount: 0 }), '(empty)');
});

test('formatValue: long values are cut, pipes escaped', () => {
  assert.equal(formatValue('a|b'), 'a\\|b');
  assert.ok(formatValue('x'.repeat(200)).endsWith('...'));
});

test('renderRow joins five cells; attention flags empty and non-rank-1 pages', () => {
  const row = renderRow('ipos.cin', [w({ source: 'DOC', status: 'never_asked' })], { value: null, source: null });
  assert.equal(row, '| ipos.cin | DOC: not asked yet | — | — | (empty) |');
  assert.equal(attention({ value: null }, ['DOC']), 'empty');
  assert.equal(attention({ value: 'x', source: 'BSE' }, ['DOC', 'BSE']), 'from BSE (rank 2, not rank 1)');
  assert.equal(attention({ value: 'x', source: 'DRHP' }, ['DOC', 'BSE']), null);
  assert.equal(attention({ value: 'x', source: 'ADMIN' }, ['DOC']), null);
});

test('camelCase matches field_sources.field_name', () => {
  assert.equal(camelCase('price_range_min'), 'priceRangeMin');
  assert.equal(camelCase('ebitda_fy2024'), 'ebitdaFy2024');
});
