// T-308F checker finding F4 — audit-ipo-coverage.mjs's substance-gate query
// LEFT JOINed `ipo_details` on `ipo_id`, which has NO unique constraint
// (see packages/shared/src/db/schema.ts — only an index, `idx_ipo_details_ipo_id`).
// A second ipo_details row for the same ipo_id would multiply every
// substance-check count for that IPO. Fixed by replacing the plain LEFT JOIN
// with `LEFT JOIN LATERAL (... ORDER BY updated_at DESC, id DESC LIMIT 1) d ON true`.
//
// T-454 (#221) RCA: this test used to re-declare that LATERAL SQL *inline*
// against its own temp tables instead of executing the gate's own query, so
// it could never fail on a regression of the gate — and the DB-only test
// t.skip()'d whenever TEST_DATABASE_URL was unset (always true in CI), so it
// was a no-op in the pipeline too.
//
// Fix: audit-ipo-coverage.mjs now exports `IPO_DETAILS_LATERAL_JOIN_SQL` —
// the exact string spliced into the gate's live query — and the module is
// import-safe (a `isMainModule` guard stops `main()`/the DB fatal-check from
// running on import). This test imports THAT string, so drift in the gate's
// own query is what the assertions see; the DB test below also runs the
// gate's query text verbatim against a scratch table instead of a hand-typed
// copy.
//
// Mutation proof (documented in PR body — not run automatically, since it
// requires temporarily editing the source under test): replacing the whole
// `LEFT JOIN LATERAL (...) d ON true` block in audit-ipo-coverage.mjs with
// the naive `LEFT JOIN ipo_details d ON d.ipo_id = i.id` turns the
// "SQL shape" test below RED (no `LATERAL` keyword to find) even with no DB
// reachable — this is the "cannot fail on regression, skips in CI" gap #221
// reported: previously this test would have stayed skipped and green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { IPO_DETAILS_LATERAL_JOIN_SQL } from '../audit-ipo-coverage.mjs';

const TEST_DB = process.env.TEST_DATABASE_URL;

// Runs WITHOUT a database, in CI, every time — the class of check #221 asked
// for: "make the SQL-shape assertion run WITHOUT a DB so CI cannot silently
// skip everything." Asserts the exact de-duplication shape the gate depends
// on: a LATERAL join, ordered newest-first, capped to one row.
test('gate query: ipo_details de-dup join is a LATERAL, ordered newest-first, LIMIT 1 (no DB required)', () => {
  assert.match(
    IPO_DETAILS_LATERAL_JOIN_SQL,
    /LEFT JOIN LATERAL/i,
    'the gate must de-duplicate ipo_details via LATERAL, not a plain LEFT JOIN (which multiplies rows — F4)'
  );
  assert.match(
    IPO_DETAILS_LATERAL_JOIN_SQL,
    /ORDER BY\s+updated_at\s+DESC/i,
    'the gate must pick the most-recently-updated ipo_details row deterministically'
  );
  assert.match(
    IPO_DETAILS_LATERAL_JOIN_SQL,
    /LIMIT 1/i,
    'the gate must cap the LATERAL subquery to exactly one row per IPO'
  );
  assert.match(
    IPO_DETAILS_LATERAL_JOIN_SQL,
    /WHERE ipo_id = i\.id/,
    'the LATERAL subquery must correlate on the outer ipo row, not scan unfiltered'
  );
});

// This test requires a REAL, disposable Postgres reachable via
// TEST_DATABASE_URL — it deliberately does NOT fall back to DATABASE_URL,
// because that variable may point at the shared prod/tunnel database and
// this test creates + drops temp tables (T-308 contract: "never write to
// prod"). If TEST_DATABASE_URL is not set, the test SKIPS rather than
// running against an unknown/prod connection — but the SQL-shape test above
// is what keeps CI honest when this one skips.
//
// Run against a scratch DB, e.g.:
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/ipodhan_scratch \
//     node --test scripts/tests/audit-ipo-coverage-distinct-on.test.mjs
test('F4: the gate\'s own LATERAL join returns exactly 1 row per IPO even with a duplicated ipo_details row', async (t) => {
  if (!TEST_DB) {
    t.skip('TEST_DATABASE_URL not set — skipping (never runs against DATABASE_URL/prod, per T-308 "never write to prod")');
    return;
  }

  const pool = new pg.Pool({ connectionString: TEST_DB });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Real table names so the gate's own query text (which references
    // `ipo_details` un-aliased in the FROM sense — it just correlates via
    // `i.id`) runs unmodified against them.
    await client.query(`
      CREATE TEMP TABLE ipos (id uuid PRIMARY KEY) ON COMMIT DROP;
    `);
    await client.query(`
      CREATE TEMP TABLE ipo_details (
        id uuid PRIMARY KEY,
        ipo_id uuid NOT NULL,
        issue_type text,
        updated_at timestamp NOT NULL DEFAULT now()
      ) ON COMMIT DROP;
    `);

    const ipoId = '11111111-1111-1111-1111-111111111111';
    await client.query('INSERT INTO ipos (id) VALUES ($1)', [ipoId]);
    // Duplicate ipo_details rows for the SAME ipo_id — the exact shape that
    // multiplies a plain LEFT JOIN. Different updated_at so LATERAL's
    // ORDER BY ... LIMIT 1 is deterministic (picks the newer row).
    await client.query(
      `INSERT INTO ipo_details (id, ipo_id, issue_type, updated_at) VALUES
         ('22222222-2222-2222-2222-222222222222', $1, 'BOOK_BUILDING', now() - interval '1 day'),
         ('33333333-3333-3333-3333-333333333333', $1, 'FIXED_PRICE', now())`,
      [ipoId]
    );

    // Sanity: a naive LEFT JOIN would multiply the row (proves the fixture
    // actually reproduces the bug this test guards against).
    const naive = await client.query(
      `SELECT i.id FROM ipos i LEFT JOIN ipo_details d ON d.ipo_id = i.id`
    );
    assert.equal(naive.rowCount, 2, 'fixture sanity check: plain LEFT JOIN should multiply to 2 rows');

    // The gate's OWN query text — imported, not re-typed — so a regression
    // in audit-ipo-coverage.mjs's real query fails THIS assertion.
    const fixed = await client.query(
      `SELECT i.id, d.issue_type
         FROM ipos i
         ${IPO_DETAILS_LATERAL_JOIN_SQL}`
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
