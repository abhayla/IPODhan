// Item 3, slice S2 (#731), MAJOR-4 fix (independent Tier A review): every
// sibling invariant in this directory ships a test that drives the REAL
// exported module through a fake pg pool, proving the shipped SQL, never a
// re-implementation of it (duplicate-ipo-rows-invariant.test.mjs,
// heading-hash-current.test.mjs, normalized-name-current.test.mjs). This one
// was missing it.
//
// Run: node --test scripts/tests/plan-rank2-never-bse-for-issue-size-invariant.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import planRank2NeverBseForIssueSizeInvariant from '../lib/repair-invariants/plan-rank2-never-bse-for-issue-size.mjs';

const poolOf = (rows) => ({ query: async () => ({ rows }) });

const row = (slug, tableName, rowKey, state) => ({ slug, tableName, rowKey, state });

test('a clean table (no issue_size row ranked rank2=BSE) is zero violations', async () => {
  const { count, details } = await planRank2NeverBseForIssueSizeInvariant(
    poolOf([])
  );
  assert.equal(count, 0);
  assert.deepEqual(details, []);
});

test('a planted rank2=BSE issue_size row on a non-terminal state is ONE violation, named by slug', async () => {
  const { count, details } = await planRank2NeverBseForIssueSizeInvariant(
    poolOf([row('planted-fixture-ipo', 'ipo_details', '', 'PENDING')])
  );
  assert.equal(count, 1);
  assert.equal(details[0].slug, 'planted-fixture-ipo');
});

test('the query itself already excludes SUPPLIED rows (frozen audit trail, never a false positive) -- the SQL text is the contract, this locks it in', async () => {
  let capturedSql = null;
  const pool = {
    query: async (sql) => {
      capturedSql = sql;
      return { rows: [] };
    },
  };
  await planRank2NeverBseForIssueSizeInvariant(pool);
  assert.match(capturedSql, /state\s*<>\s*'SUPPLIED'/);
  assert.match(capturedSql, /field_name\s*=\s*'issue_size'/);
  assert.match(capturedSql, /rank2_source\s*=\s*'BSE'/);
});

test('multiple violations across different IPOs all surface, count matches details length', async () => {
  const { count, details } = await planRank2NeverBseForIssueSizeInvariant(
    poolOf([
      row('ipo-a', 'ipo_details', '', 'PENDING'),
      row('ipo-b', 'ipo_details', '', 'CHECK_FAILED'),
      row('ipo-c', 'ipo_details', '', 'EXHAUSTED'),
    ])
  );
  assert.equal(count, 3);
  assert.equal(details.length, 3);
});
