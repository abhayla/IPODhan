// Unit tests for scripts/lib/repair-invariants/normalized-name-current.mjs.
//
// The module previously had none. It is the tool a 544-row re-key is proven
// with, so "does it return the right SHAPE of answer" cannot be left to a
// staging run that only ever exercises the happy path.
//
// The case that forced these tests: prod has no normalized_name column today.
// The release sequence is migration (NOT NULL DEFAULT '') -> backfill -> E1.
// In the window between the migration and the backfill EVERY row reads '' and a
// naive staleness check reports one finding per row — 531 on prod. Technically
// true, and precisely the kind of check people learn to ignore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import invariant, { OUTCOME_STALE, OUTCOME_NOT_YET_BACKFILLED } from '../lib/repair-invariants/normalized-name-current.mjs';

/** Minimal stub of the pg Pool surface the invariant uses. */
function stubPool(rowsByTable) {
  return {
    async query(sql) {
      const m = sql.match(/FROM (\w+)/);
      return { rows: rowsByTable[m[1]] ?? [] };
    },
  };
}

const CURRENT = [
  { id: 'p1', ipo_id: 'i1', name_value: 'Axis Bank Limited', normalized_name: 'axis bank' },
  { id: 'p2', ipo_id: 'i1', name_value: 'Kotak Mahindra Bank Ltd', normalized_name: 'kotak mahindra bank' },
];

test('all keys current -> zero findings', () => {
  const pool = stubPool({ promoters: CURRENT, peer_companies: [], ipo_intermediaries: [] });
  return invariant(pool).then(({ count, details }) => {
    assert.equal(count, 0);
    assert.deepEqual(details, []);
  });
});

test('a table where EVERY row holds the default and none holds a computed key reports NOT_YET_BACKFILLED — ONE finding, not one per row', async () => {
  const blank = CURRENT.map((r) => ({ ...r, normalized_name: '' }));
  const pool = stubPool({ promoters: blank, peer_companies: [], ipo_intermediaries: [] });
  const { count, details } = await invariant(pool);
  // ONE finding for the table, not two for the rows.
  assert.equal(count, 1, 'an un-backfilled table is one finding, not one per row');
  assert.equal(details.length, 1);
  assert.equal(details[0].outcome, OUTCOME_NOT_YET_BACKFILLED);
  assert.equal(details[0].table, 'promoters');
  assert.equal(details[0].rowCount, 2, 'it still reports HOW MANY rows are waiting');
});

test('NOT_YET_BACKFILLED still FAILS — it must never read as clean', async () => {
  const blank = CURRENT.map((r) => ({ ...r, normalized_name: '' }));
  const pool = stubPool({ promoters: blank, peer_companies: [], ipo_intermediaries: [] });
  const { count } = await invariant(pool);
  // The hole this closes: if an un-backfilled table returned 0, a backfill that
  // silently never ran would read as a clean gate.
  assert.ok(count > 0, 'a table that should have been backfilled and was not must not pass');
});

test('MIXED — some current, some blank — stays STALE and reports every row', async () => {
  const mixed = [CURRENT[0], { ...CURRENT[1], normalized_name: '' }];
  const pool = stubPool({ promoters: mixed, peer_companies: [], ipo_intermediaries: [] });
  const { count, details } = await invariant(pool);
  assert.equal(count, 1);
  assert.equal(details[0].outcome, OUTCOME_STALE, 'a mixed table is real staleness, not a migration window');
  assert.equal(details[0].id, 'p2');
});

test('a genuinely stale key (populated, wrong) is STALE even if it is the only row', async () => {
  const stale = [{ id: 'p9', ipo_id: 'i1', name_value: 'Axis Bank Limited', normalized_name: 'axisbankOLD' }];
  const pool = stubPool({ promoters: stale, peer_companies: [], ipo_intermediaries: [] });
  const { count, details } = await invariant(pool);
  assert.equal(count, 1);
  assert.equal(details[0].outcome, OUTCOME_STALE);
  assert.equal(details[0].stored, 'axisbankOLD');
});

test('the no-identity pair (blank name, stored empty) is never a finding, and does not make a table look un-backfilled', async () => {
  const rows = [CURRENT[0], { id: 'p3', ipo_id: 'i1', name_value: '   ', normalized_name: '' }];
  const pool = stubPool({ promoters: rows, peer_companies: [], ipo_intermediaries: [] });
  const { count } = await invariant(pool);
  assert.equal(count, 0, 'a blank-name row alongside current keys is neither stale nor un-backfilled');
});

test('an EMPTY table is not "un-backfilled" — nothing is waiting', async () => {
  const pool = stubPool({ promoters: [], peer_companies: [], ipo_intermediaries: [] });
  const { count } = await invariant(pool);
  assert.equal(count, 0);
});
