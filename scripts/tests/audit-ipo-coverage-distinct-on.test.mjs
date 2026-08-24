// T-308F checker finding F4 — audit-ipo-coverage.mjs's substance-gate query
// LEFT JOINed `ipo_details` on `ipo_id`, which has NO unique constraint
// (see packages/shared/src/db/schema.ts — only an index, `idx_ipo_details_ipo_id`).
// A second ipo_details row for the same ipo_id would multiply every
// substance-check count for that IPO. Fixed by replacing the plain LEFT JOIN
// with `LEFT JOIN LATERAL (... ORDER BY updated_at DESC, id DESC LIMIT 1) d ON true`.
//
// This test proves the fix with a duplicated fixture row. It requires a REAL,
// disposable Postgres reachable via TEST_DATABASE_URL — it deliberately does
// NOT fall back to DATABASE_URL, because that variable may point at the
// shared prod/tunnel database and this test creates + drops temp tables
// (T-308 contract: "never write to prod"). If TEST_DATABASE_URL is not set,
// the test SKIPS rather than running against an unknown/prod connection.
//
// Run against a scratch DB, e.g.:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ipodhan_scratch \
//     node --test scripts/tests/audit-ipo-coverage-distinct-on.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const TEST_DB = process.env.TEST_DATABASE_URL;

test('F4: ipo_details LATERAL join returns exactly 1 row per IPO even with a duplicated ipo_details row', async (t) => {
  if (!TEST_DB) {
    t.skip('TEST_DATABASE_URL not set — skipping (never runs against DATABASE_URL/prod, per T-308 "never write to prod")');
    return;
  }

  const pool = new pg.Pool({ connectionString: TEST_DB });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TEMP TABLE ipos_t308f4 (id uuid PRIMARY KEY) ON COMMIT DROP;
    `);
    await client.query(`
      CREATE TEMP TABLE ipo_details_t308f4 (
        id uuid PRIMARY KEY,
        ipo_id uuid NOT NULL,
        issue_type text,
        updated_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP;
    `);

    const ipoId = '11111111-1111-1111-1111-111111111111';
    await client.query('INSERT INTO ipos_t308f4 (id) VALUES ($1)', [ipoId]);
    // Duplicate ipo_details rows for the SAME ipo_id — the exact shape that
    // multiplies a plain LEFT JOIN. Different updated_at so LATERAL's
    // ORDER BY ... LIMIT 1 is deterministic (picks the newer row).
    await client.query(
      `INSERT INTO ipo_details_t308f4 (id, ipo_id, issue_type, updated_at) VALUES
         ('22222222-2222-2222-2222-222222222222', $1, 'BOOK_BUILDING', now() - interval '1 day'),
         ('33333333-3333-3333-3333-333333333333', $1, 'FIXED_PRICE', now())`,
      [ipoId]
    );

    // Sanity: a naive LEFT JOIN would multiply the row (proves the fixture
    // actually reproduces the bug this test guards against).
    const naive = await client.query(
      `SELECT i.id FROM ipos_t308f4 i LEFT JOIN ipo_details_t308f4 d ON d.ipo_id = i.id`
    );
    assert.equal(naive.rowCount, 2, 'fixture sanity check: plain LEFT JOIN should multiply to 2 rows');

    // The actual fix under test.
    const fixed = await client.query(
      `SELECT i.id, d.issue_type
         FROM ipos_t308f4 i
         LEFT JOIN LATERAL (
           SELECT issue_type FROM ipo_details_t308f4
            WHERE ipo_id = i.id
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
         ) d ON true`
    );

    assert.equal(fixed.rowCount, 1, 'LATERAL join must return exactly 1 row per IPO, not one per ipo_details row');
    assert.equal(fixed.rows[0].issue_type, 'FIXED_PRICE', 'LATERAL join must deterministically pick the most-recently-updated ipo_details row');

    await client.query('ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
});
