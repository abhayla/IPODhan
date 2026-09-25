// RCA 2026-09-25 (staging --apply): drizzle's sql`` expands a JS array
// interpolated as `${ids}` into a parenthesized parameter LIST, not a Postgres
// array -- `DELETE FROM ipo_field_plan WHERE id = ANY(($1, $2, $3, ...))`
// fails outright. The whole run was one transaction, so nothing was deleted.
// Drives the REAL tool (scraper/scripts/repair-retire-manifest-removed-fields.ts)
// as a process against real Postgres (ipodhan_test) -- never the mocked-deps
// unit test, which never touches the SQL string.
//
// Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
//        npx vitest run -c vitest.integration.config.ts tests/integration/repair-retire-manifest-removed-fields.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'repair-retire-manifest-removed-fields: DATABASE_URL not set';
const SCRAPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// A field key that is NOT in the current manifest (retired) and one that IS.
const REMOVED_FIELD = 'gmp_records';
const KEPT_FIELD_NAME = 'price_range_min';

const IPO_ID = '00000000-0000-4000-9f61-000000000001';
const REMOVED_ROW_ID = '00000000-0000-4000-9f61-0000000000a1';
const KEPT_ROW_ID = '00000000-0000-4000-9f61-0000000000a2';

let pool: Pool | null = null;

function run(args: string[]) {
  const r = spawnSync('npx', ['tsx', 'scripts/repair-retire-manifest-removed-fields.ts', ...args], {
    cwd: SCRAPER,
    env: { ...process.env, REDIS_URL: '' },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function snapshot() {
  const { rows } = await pool!.query(
    `SELECT id, table_name AS "tableName", field_name AS "fieldName" FROM ipo_field_plan
      WHERE id = ANY($1::uuid[]) ORDER BY field_name`,
    [[REMOVED_ROW_ID, KEPT_ROW_ID]]
  );
  return rows;
}

async function cleanup() {
  await pool!.query(`DELETE FROM ipo_field_plan WHERE id = ANY($1::uuid[])`, [[REMOVED_ROW_ID, KEPT_ROW_ID]]);
  await pool!.query(`DELETE FROM ipos WHERE id = $1::uuid`, [IPO_ID]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  await cleanup();
  await pool.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date) VALUES
      ($1::uuid, 'F1022 Retire Ltd', 'f1022-retire', 'IPO', 'MAINBOARD', 'LISTED', '2026-08-01')`,
    [IPO_ID]
  );
  await pool.query(
    `INSERT INTO ipo_field_plan (id, ipo_id, table_name, row_key, field_name, rank1_source, state, manifest_version) VALUES
      ($1::uuid, $2::uuid, $3, '', 'gmp', 'INVESTORGAIN_GMP', 'SUPPLIED', 1),
      ($4::uuid, $2::uuid, 'ipos', '', $5, 'NSE', 'SUPPLIED', 1)`,
    [REMOVED_ROW_ID, IPO_ID, REMOVED_FIELD, KEPT_ROW_ID, KEPT_FIELD_NAME]
  );
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`repair-retire-manifest-removed-fields on real Postgres (${SKIP_REASON})`, () => {
  it('dry run reports the removed-field row without deleting anything', () => {
    const r = run(['--expect-db', 'ipodhan_test', '--ipo', IPO_ID]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(new RegExp(`${REMOVED_FIELD}\\.gmp`));
  }, 60_000);

  let ledger = '';
  it('--apply deletes only the removed-field row via the REAL SQL (fails red before the fix)', async () => {
    const r = run(['--expect-db', 'ipodhan_test', '--apply', '--ipo', IPO_ID]);
    // Before the fix: exits 1, stderr carries "Failed query ... ANY((" and 0 rows
    // are ever deleted (the whole thing is one transaction). After the fix: exits 0.
    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toMatch(/Failed query/);
    ledger = r.out.match(/ledger written to (\S+\.json)/)![1];
    const after = await snapshot();
    expect(after.map((row: { fieldName: string }) => row.fieldName)).toEqual([KEPT_FIELD_NAME]);
  }, 60_000);

  it('re-running --apply is a no-op (the row is already gone)', () => {
    const r = run(['--expect-db', 'ipodhan_test', '--apply', '--ipo', IPO_ID]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/nothing to repair/);
  }, 60_000);

  it('--undo restores the deleted row', async () => {
    const r = run(['--expect-db', 'ipodhan_test', '--undo', ledger, '--apply']);
    expect(r.code, r.out).toBe(0);
    const after = await snapshot();
    expect(after.map((row: { fieldName: string }) => row.fieldName).sort()).toEqual(['gmp', KEPT_FIELD_NAME].sort());
  }, 60_000);
});
