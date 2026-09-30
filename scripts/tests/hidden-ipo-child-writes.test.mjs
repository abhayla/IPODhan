// d_hidden_ipo_child_writes (§9.2 item 23, OD-150): pure parts of the nightly check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planHiddenChildWriteCheck, childWritesAfterHideSql, summariseHiddenChildWrites, isWriteTimeColumn, NON_SCRAPER_TABLES } from '../lib/hidden-ipo-child-writes.mjs';

const fk = [
  { table_name: 'gmp_records', column_name: 'ipo_id' },
  { table_name: 'brlm_track_record', column_name: 'source_ipo_id' },
  { table_name: 'ipo_details', column_name: 'ipo_id' },
  { table_name: 'audit_logs', column_name: 'ipo_id' },
  ...Object.keys(NON_SCRAPER_TABLES).filter((t) => t !== 'audit_logs').map((t) => ({ table_name: t, column_name: 'ipo_id' })),
];
const ts = [
  { table_name: 'gmp_records', column_name: 'created_at' },
  { table_name: 'gmp_records', column_name: 'timestamp' },
  { table_name: 'gmp_records', column_name: 'next_attempt_at' },
  { table_name: 'brlm_track_record', column_name: 'updated_at' },
];

test('the plan uses the FK catalog link column (brlm_track_record.source_ipo_id), skips non-scraper tables, names unmeasured ones', () => {
  const p = planHiddenChildWriteCheck(fk, ts);
  assert.deepEqual(p.plans, [
    { table: 'gmp_records', link: 'ipo_id', writeCols: ['created_at', 'timestamp'] },
    { table: 'brlm_track_record', link: 'source_ipo_id', writeCols: ['updated_at'] },
  ]);
  assert.deepEqual(p.unmeasured, ['ipo_details.ipo_id']);
  assert.deepEqual(p.staleExemptions, []);
});

test('an exemption naming a table no longer in the FK catalog is reported stale and FAILs', () => {
  const p = planHiddenChildWriteCheck(fk.filter((r) => r.table_name !== 'ipo_reviews'), ts);
  assert.deepEqual(p.staleExemptions, ['ipo_reviews']);
  assert.equal(summariseHiddenChildWrites({ hiddenCount: 0, ...p, offenders: [] }).status, 'FAIL');
});

test('write-time columns exclude scheduled / due times', () => {
  assert.equal(isWriteTimeColumn('updated_at'), true);
  assert.equal(isWriteTimeColumn('last_updated'), true);
  assert.equal(isWriteTimeColumn('next_attempt_at'), false);
  assert.equal(isWriteTimeColumn('expires_at'), false);
  assert.equal(isWriteTimeColumn('open_date'), false);
});

test('SQL joins on the link column and compares the newest write to hidden_at; refuses odd identifiers', () => {
  const q = childWritesAfterHideSql({ table: 'brlm_track_record', link: 'source_ipo_id', writeCols: ['created_at', 'updated_at'] });
  assert.match(q, /JOIN ipos i ON i\.id = c\.source_ipo_id/);
  assert.match(q, /GREATEST\(c\.created_at, c\.updated_at\) > i\.hidden_at/);
  assert.throws(() => childWritesAfterHideSql({ table: 'x; drop', link: 'ipo_id', writeCols: ['created_at'] }));
});

test('verdicts: PASS with none, FAIL with offenders listed by slug, UNVERIFIABLE with no measurable table (fails closed)', () => {
  const base = { hiddenCount: 1, plans: [{ table: 'gmp_records' }], unmeasured: [], staleExemptions: [] };
  assert.equal(summariseHiddenChildWrites({ ...base, offenders: [] }).status, 'PASS');
  const f = summariseHiddenChildWrites({ ...base, offenders: [{ table: 'gmp_records', n: 2, slug: 'coal-india-ltd', hiddenAt: 'h', newestWrite: 'w' }] });
  assert.equal(f.status, 'FAIL');
  assert.match(f.detail, /gmp_records 2 row\(s\) for coal-india-ltd/);
  assert.equal(summariseHiddenChildWrites({ ...base, plans: [], offenders: [] }).status, 'UNVERIFIABLE');
});
