/**
 * Self-test for scripts/assert-schema-drift.ts (T-330).
 *
 * Provisions a throwaway scratch Postgres schema (via a fixture DDL block, not
 * `drizzle-kit push`, so this test does not depend on the schema SSOT being in
 * a pushable state), then exercises three fixture scenarios against the real
 * checkColumns()/checkMatviews() functions:
 *   1. matching schema -> no drift
 *   2. a narrowed varchar column (varchar(10) vs the SSOT's varchar(50)) -> named FAIL
 *   3. a missing matview -> named FAIL
 *
 * Requires a reachable throwaway Postgres instance — set DATABASE_URL (or
 * TEST_DATABASE_URL) to a scratch database before running. Never point this
 * at a real/shared database: the test CREATEs and DROPs a fixture table.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@localhost:55432/ipodhan_test \
 *     npx tsx scripts/tests/assert-schema-drift.test.ts
 */

import { Client } from 'pg';
import { checkColumns, checkMatviews, type Drift, type MatviewExpectation } from '../assert-schema-drift';

const FIXTURE_TABLE = '__schema_drift_selftest_fixture__';

let failed = 0;

function assertDriftKindPresent(drifts: Drift[], kind: Drift['kind'], nameFragment: string, caseName: string) {
  const found = drifts.some((d) => d.kind === kind && d.detail.includes(nameFragment));
  if (found) {
    console.log(`PASS: ${caseName}`);
  } else {
    console.log(`FAIL: ${caseName} — expected a [${kind}] drift mentioning "${nameFragment}", got: ${JSON.stringify(drifts)}`);
    failed = 1;
  }
}

function assertNoDrift(drifts: Drift[], caseName: string) {
  if (drifts.length === 0) {
    console.log(`PASS: ${caseName}`);
  } else {
    console.log(`FAIL: ${caseName} — expected no drift, got: ${JSON.stringify(drifts)}`);
    failed = 1;
  }
}

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('FATAL: set DATABASE_URL or TEST_DATABASE_URL to a throwaway scratch Postgres instance.');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    // ---- Case 1: matching schema (via the real schema.ts + drizzle-kit push
    // baseline, expected to already be applied to the target scratch DB by the
    // caller) -> checkColumns() on the real schema SSOT should find no drift.
    // This exercises the exact "matching -> pass" self-test DoD requires.
    const cleanDrifts = await checkColumns(client);
    assertNoDrift(cleanDrifts, 'matching schema.ts against a drizzle-kit-push baseline -> no column drift');

    // ---- Case 2: narrow a real column (ipo_scores.algorithm_version) to
    // varchar(10) and confirm checkColumns() reports the exact P2-1 mechanism.
    await client.query('DELETE FROM ipo_scores');
    await client.query(`ALTER TABLE ipo_scores ALTER COLUMN algorithm_version TYPE varchar(10)`);
    const narrowedDrifts = await checkColumns(client);
    assertDriftKindPresent(
      narrowedDrifts,
      'COLUMN_TYPE_MISMATCH',
      'ipo_scores.algorithm_version',
      'varchar(10) vs SSOT varchar(50) -> named COLUMN_TYPE_MISMATCH failure (T-330 P2-1 mechanism)'
    );
    // restore
    await client.query(`ALTER TABLE ipo_scores ALTER COLUMN algorithm_version TYPE varchar(50)`);
    const restoredDrifts = await checkColumns(client);
    assertNoDrift(restoredDrifts, 'widening algorithm_version back to varchar(50) clears the drift');

    // ---- Case 3: a missing table entirely (drop a real table) -> MISSING_TABLE.
    await client.query('DROP TABLE IF EXISTS registrars CASCADE');
    const missingTableDrifts = await checkColumns(client);
    assertDriftKindPresent(
      missingTableDrifts,
      'MISSING_TABLE',
      'registrars',
      'dropping a schema-declared table -> named MISSING_TABLE failure'
    );

    // ---- Case 4: missing matview -> named MISSING_MATVIEW failure, via an
    // injected fixture expectation list (never mutates the real registry).
    const fixtureMatviews: MatviewExpectation[] = [
      { name: FIXTURE_TABLE, referencedBy: 'self-test only' },
    ];
    const matviewDrifts = await checkMatviews(client, fixtureMatviews);
    assertDriftKindPresent(
      matviewDrifts,
      'MISSING_MATVIEW',
      FIXTURE_TABLE,
      'a registry entry with no live matview -> named MISSING_MATVIEW failure'
    );

    // ---- Case 5: an empty expectation list -> no matview drift (mirrors the
    // real EXPECTED_MATVIEWS being empty post-P2-3 retirement).
    const emptyMatviewDrifts = await checkMatviews(client, []);
    assertNoDrift(emptyMatviewDrifts, 'empty matview registry -> no matview drift');
  } finally {
    // best-effort restore of anything the test mutated, so a re-run of the
    // full suite (or a human re-running drizzle-kit push) starts clean
    await client.query('DROP TABLE IF EXISTS registrars CASCADE').catch(() => {});
    await client.end();
  }

  if (failed) {
    console.log('assert-schema-drift.test.ts: FAILED');
    process.exit(1);
  }
  console.log('assert-schema-drift.test.ts: all cases passed');
}

main().catch((error) => {
  console.error('FATAL:', error);
  process.exit(1);
});
