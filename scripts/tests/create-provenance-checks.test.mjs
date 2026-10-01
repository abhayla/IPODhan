import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_PROVENANCE_COLUMNS, buildUnprovenancedColumnsSql, evaluateUnprovenancedColumns } from '../lib/create-provenance-checks.mjs';

test('(u_create_column_without_provenance) no rows -> PASS', () => {
  const v = evaluateUnprovenancedColumns([]);
  assert.equal(v.status, 'PASS');
  assert.equal(v.ipoCount, 0);
});

test('(u_create_column_without_provenance) a row with an unsourced column -> FAIL naming the IPO and the column', () => {
  const v = evaluateUnprovenancedColumns([
    { id: 'a', slug: 'acme-ltd', status: 'UPCOMING', offeringType: 'IPO', fieldName: 'companyName' },
    { id: 'a', slug: 'acme-ltd', status: 'UPCOMING', offeringType: 'IPO', fieldName: 'lotSize' },
    { id: 'b', slug: 'beta-ltd', status: 'LISTED', offeringType: 'OFS', fieldName: 'status' },
  ]);
  assert.equal(v.status, 'FAIL');
  assert.equal(v.ipoCount, 2);
  assert.equal(v.columnCount, 3);
  assert.match(v.detail, /acme-ltd \[UPCOMING\/IPO\] no provenance for: companyName,lotSize/);
  assert.match(v.detail, /beta-ltd \[LISTED\/OFS\]/);
});

test('(u_create_column_without_provenance) the SQL covers companyName and every status/segment/offering type (no population filter)', () => {
  const sql = buildUnprovenancedColumnsSql();
  assert.match(sql, /'companyName' AS "fieldName"/);
  assert.equal((sql.match(/UNION ALL/g) ?? []).length, CREATE_PROVENANCE_COLUMNS.length - 1);
  assert.doesNotMatch(sql, /offering_type\s*=/, 'must not narrow the population to IPO rows');
  assert.doesNotMatch(sql, /i\.status\s*(=|IN|<>)/i, 'must not narrow the population by status');
  assert.match(sql, /fs\.row_key = ''/);
  assert.match(sql, /i\.issue_size > 0/);
});

test('(u_create_column_without_provenance) the column list never names a bookkeeping column', () => {
  const fields = CREATE_PROVENANCE_COLUMNS.map((c) => c.field);
  for (const bookkeeping of ['id', 'slug', 'createdAt', 'updatedAt', 'lastScrapedAt']) {
    assert.ok(!fields.includes(bookkeeping), bookkeeping);
  }
});
