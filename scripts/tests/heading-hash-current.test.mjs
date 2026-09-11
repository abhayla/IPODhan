// Unit tests for scripts/lib/repair-invariants/heading-hash-current.mjs.
//
// Same shape as normalized-name-current.test.mjs (slice s8b's sibling for
// promoters/peer_companies/ipo_intermediaries), for the one table s8b could
// not cover: `ipo_risk_factors.heading_hash`. `normalizeHeading` /
// `headingHashForRiskFactor` lived on a different branch when s8b was
// written, so s8b never imported them and heading_hash has had NO runtime
// invariant until this slice.
//
// The case that matters most: `ipo_risk_factors.heading_hash` is
// `NOT NULL DEFAULT ''` today (schema.ts) with ~2130 pre-existing rows never
// backfilled. In that window every row reads stored='' against a recomputed
// non-null hash (a heading is essentially never blank) — a naive staleness
// check would report one finding per row. NOT_YET_BACKFILLED must collapse
// that to ONE finding per table, and that ONE finding must still FAIL the
// gate — reporting zero here would let a silently-skipped backfill read as
// clean, which is the exact hole this invariant exists to close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import invariant, {
  OUTCOME_STALE,
  OUTCOME_NOT_YET_BACKFILLED,
} from '../lib/repair-invariants/heading-hash-current.mjs';
import { headingHashForRiskFactor } from '../../packages/shared/src/utils/risk-factor-heading-key.ts';

/** Minimal stub of the pg Pool surface the invariant uses. */
function stubPool(rowsByTable) {
  return {
    async query(sql) {
      const m = sql.match(/FROM (\w+)/);
      return { rows: rowsByTable[m[1]] ?? [] };
    },
  };
}

const H1 = headingHashForRiskFactor('We depend on one customer');
const H2 = headingHashForRiskFactor('Our plants are concentrated in Raigad');

const CURRENT = [
  { id: 'r1', ipo_id: 'i1', name_value: 'We depend on one customer', heading_hash: H1 },
  { id: 'r2', ipo_id: 'i1', name_value: 'Our plants are concentrated in Raigad', heading_hash: H2 },
];

test('all keys current -> zero findings', async () => {
  const pool = stubPool({ ipo_risk_factors: CURRENT });
  const { count, details } = await invariant(pool);
  assert.equal(count, 0);
  assert.deepEqual(details, []);
});

test('a table where EVERY row holds the default and none holds a computed key reports NOT_YET_BACKFILLED — ONE finding, not one per row', async () => {
  const blank = CURRENT.map((r) => ({ ...r, heading_hash: '' }));
  const pool = stubPool({ ipo_risk_factors: blank });
  const { count, details } = await invariant(pool);
  assert.equal(count, 1, 'an un-backfilled table is one finding, not one per row');
  assert.equal(details.length, 1);
  assert.equal(details[0].outcome, OUTCOME_NOT_YET_BACKFILLED);
  assert.equal(details[0].table, 'ipo_risk_factors');
  assert.equal(details[0].rowCount, 2, 'it still reports HOW MANY rows are waiting');
});

test('NOT_YET_BACKFILLED still FAILS — it must never read as clean', async () => {
  const blank = CURRENT.map((r) => ({ ...r, heading_hash: '' }));
  const pool = stubPool({ ipo_risk_factors: blank });
  const { count } = await invariant(pool);
  assert.ok(count > 0, 'a table that should have been backfilled and was not must not pass');
});

test('MIXED — some current, some blank — stays STALE and reports every row', async () => {
  const mixed = [CURRENT[0], { ...CURRENT[1], heading_hash: '' }];
  const pool = stubPool({ ipo_risk_factors: mixed });
  const { count, details } = await invariant(pool);
  assert.equal(count, 1);
  assert.equal(details[0].outcome, OUTCOME_STALE, 'a mixed table is real staleness, not a migration window');
  assert.equal(details[0].id, 'r2');
});

test('a genuinely stale key (populated, wrong) is STALE even if it is the only row', async () => {
  const stale = [{ id: 'r9', ipo_id: 'i1', name_value: 'We depend on one customer', heading_hash: 'deadbeefdeadbeef' }];
  const pool = stubPool({ ipo_risk_factors: stale });
  const { count, details } = await invariant(pool);
  assert.equal(count, 1);
  assert.equal(details[0].outcome, OUTCOME_STALE);
  assert.equal(details[0].stored, 'deadbeefdeadbeef');
});

test('a blank/whitespace heading (no identity) is never a finding, and does not make the table look un-backfilled', async () => {
  const rows = [CURRENT[0], { id: 'r3', ipo_id: 'i1', name_value: '   ', heading_hash: '' }];
  const pool = stubPool({ ipo_risk_factors: rows });
  const { count } = await invariant(pool);
  assert.equal(count, 0, 'a blank-heading row alongside current keys is neither stale nor un-backfilled');
});

test('an EMPTY table is not "un-backfilled" — nothing is waiting', async () => {
  const pool = stubPool({ ipo_risk_factors: [] });
  const { count } = await invariant(pool);
  assert.equal(count, 0);
});
