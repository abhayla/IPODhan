// PULL-FROZEN (item 6, OD-91). Imports the REAL check; the fake q returns a row ARRAY exactly
// like the audit's own `q = (sql, p) => pool.query(sql, p).then((r) => r.rows)`.
// Run: node --test scripts/tests/pull-frozen-checks.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPullFrozen, supersedesForField, PRECEDENCE } from '../lib/pull-frozen-checks.mjs';

function fakeQ({ probe = { receipts: 'document_field_receipts', superseded_by: true }, rows = [] } = {}) {
  return async (sql) => (sql.includes('to_regclass') ? [probe] : rows);
}

const planted = {
  plan_row_id: 'p1', slug: 'lcc-projects-ltd', table_name: 'ipos', row_key: '', field_name: 'company_description',
  chosen_id: 'rhp-1', chosen_type: 'RHP', chosen_filing: '2026-09-03', chosen_sha: 'a',
  cand_id: 'pro-1', cand_type: 'PROSPECTUS', cand_filing: null, cand_sha: 'b',
  issue_type: 'BOOK_BUILDING', price_range_min: 90, price_range_max: 95,
};

test('pull_frozen is RED on a planted row outranked by a receipted prospectus, and names it', async () => {
  const res = await collectPullFrozen(fakeQ({ rows: [planted] }));
  assert.equal(res.status, 'FAIL');
  assert.equal(res.offenders.length, 1);
  assert.match(res.offenders[0], /lcc-projects-ltd ipos\.company_description: chosen RHP rhp-1, outranked by receipted PROSPECTUS pro-1/);
});

test('pull_frozen PASSES when the receipted candidate does not outrank (corrigendum, OD-90)', async () => {
  const res = await collectPullFrozen(fakeQ({ rows: [{ ...planted, cand_type: 'CORRIGENDUM' }] }));
  assert.equal(res.status, 'PASS');
});

test('pull_frozen is UNVERIFIABLE (not PASS) on a database without migration 0060', async () => {
  const res = await collectPullFrozen(fakeQ({ probe: { receipts: null, superseded_by: false } }));
  assert.equal(res.status, 'UNVERIFIABLE');
});

test('same type needs both filing dates and a strictly later one', () => {
  const a = { id: 'a', docType: 'RHP', filingDate: '2026-08-01' };
  assert.equal(supersedesForField('ipos', 'company_description', a, { id: 'b', docType: 'RHP', filingDate: '2026-09-01' }, false), true);
  assert.equal(supersedesForField('ipos', 'company_description', a, { id: 'b', docType: 'RHP', filingDate: null }, false), false);
});

test('the field family decides (cin is RHP-family: a later PRICE_BAND_AD does not supersede an RHP)', () => {
  const rhp = { id: 'r', docType: 'RHP', filingDate: '2026-08-01' };
  assert.equal(supersedesForField('ipos', 'cin', rhp, { id: 'p', docType: 'PRICE_BAND_AD', filingDate: '2026-09-01' }, false), false);
});

test('a reopened row (superseded_by = the candidate) is not frozen', async () => {
  const sqls = [];
  await collectPullFrozen(async (sql) => { sqls.push(sql); return sql.includes('to_regclass') ? [{ receipts: 'x', superseded_by: true }] : []; });
  assert.match(sqls.find((x) => x.includes('ipo_field_plan p')), /p\.superseded_by IS DISTINCT FROM d\.id/);
});

test('precedence comes from the one config file the scraper reads', () => {
  const cfg = JSON.parse(readFileSync(new URL('../../scraper/config/document-precedence.json', import.meta.url), 'utf8'));
  assert.deepEqual({ ...PRECEDENCE }, cfg.precedence);
  const ts = readFileSync(new URL('../../scraper/src/services/document-types.ts', import.meta.url), 'utf8');
  assert.match(ts, /document-precedence\.json/);
  assert.doesNotMatch(ts, /PROSPECTUS: 100/);
  const lib = readFileSync(new URL('../lib/pull-frozen-checks.mjs', import.meta.url), 'utf8');
  assert.match(lib, /plan-supersession-rule\.mjs/);
  assert.doesNotMatch(lib, /function outranks/);
});

test('the frozen query only counts a candidate whose OWN receipt has the field (OD-91)', async () => {
  const seen = [];
  await collectPullFrozen(async (sql) => {
    seen.push(sql);
    return sql.includes('to_regclass') ? [{ receipts: 'document_field_receipts', superseded_by: true }] : [];
  });
  const main = seen.find((s) => s.includes('ipo_field_plan p'));
  assert.ok(main, 'the plan-row query ran');
  assert.match(main, /JOIN document_field_receipts r ON r\.document_id = d\.id/);
  assert.match(main, /r\.table_name = p\.table_name/);
  assert.match(main, /lower\(replace\(r\.field_name, '_', ''\)\) = lower\(replace\(p\.field_name, '_', ''\)\)/);
});
