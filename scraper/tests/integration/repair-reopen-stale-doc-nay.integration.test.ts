// F-161 item 6 follow-up: reopen DOC rank NOT_AVAILABLE_YET plan rows the pre-#982
// fetcher wrongly answered while the IPO already held its offer document. Drives the
// REAL tool (scraper/scripts/repair-reopen-stale-doc-nay.ts) as a process against real
// Postgres (ipodhan_test), on the SAME population the detection floor check
// `pull_doc_nay_with_offer_doc` selects.
//
// Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
//        npx vitest run -c vitest.integration.config.ts tests/integration/repair-reopen-stale-doc-nay.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'repair-reopen-stale-doc-nay: DATABASE_URL not set';
const SCRAPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const ID = {
  // stale DOC NAY, offer doc extracted BEFORE the last attempt -> SHOULD be selected
  stale: '00000000-0000-4000-9161-000000000001',
  // DOC NAY but NO completed offer document at all -> must NOT be selected
  noDoc: '00000000-0000-4000-9161-000000000002',
  // NAY row from a non-DOC rank -> must NOT be selected
  nonDoc: '00000000-0000-4000-9161-000000000003',
};
const IDS = Object.values(ID);
const DOC_STALE = '00000000-0000-4000-9161-0000000000d1';
const DOC_NONDOC = '00000000-0000-4000-9161-0000000000d2';

let pool: Pool | null = null;

function run(args: string[]) {
  const r = spawnSync('npx', ['tsx', 'scripts/repair-reopen-stale-doc-nay.ts', ...args], {
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
    `SELECT i.slug, p.id, p.state::text AS state, p.reason_code AS rc, p.next_due_at AS due, p.claimed_at AS claimed
       FROM ipo_field_plan p JOIN ipos i ON i.id = p.ipo_id
      WHERE p.id = ANY($1::uuid[]) ORDER BY i.slug`,
    [IDS]
  );
  return Object.fromEntries(rows.map((r) => [r.slug, r]));
}

async function cleanup() {
  await pool!.query(`DELETE FROM ipo_field_plan WHERE id = ANY($1::uuid[])`, [IDS]);
  await pool!.query(`DELETE FROM documents WHERE id = ANY($1::uuid[])`, [[DOC_STALE, DOC_NONDOC]]);
  await pool!.query(`DELETE FROM ipos WHERE id = ANY($1::uuid[])`, [IDS]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  await cleanup();
  await pool.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date) VALUES
      ($1::uuid, 'F161 Stale Ltd', 'f161-stale', 'IPO', 'SME', 'LISTED', '2026-08-01'),
      ($2::uuid, 'F161 NoDoc Ltd', 'f161-nodoc', 'IPO', 'SME', 'LISTED', '2026-08-01'),
      ($3::uuid, 'F161 NonDoc Ltd', 'f161-nondoc', 'IPO', 'SME', 'LISTED', '2026-08-01')`,
    [ID.stale, ID.noDoc, ID.nonDoc]
  );
  // offer document extracted well before the plan row's last_attempt_at, on the STALE ipo only
  await pool.query(
    `INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, extracted_at, is_active) VALUES
      ($1::uuid, $2::uuid, 'RHP', 'RHP', 'https://x/f161-stale-rhp.pdf', 'COMPLETED', '2026-09-01 00:00:00', true),
      ($3::uuid, $4::uuid, 'RHP', 'RHP', 'https://x/f161-nondoc-rhp.pdf', 'COMPLETED', '2026-09-01 00:00:00', true)`,
    [DOC_STALE, ID.stale, DOC_NONDOC, ID.nonDoc]
  );
  await pool.query(
    `INSERT INTO ipo_field_plan (id, ipo_id, table_name, row_key, field_name, rank1_source, state, cause, last_attempt_at, manifest_version) VALUES
      ($1::uuid, $2::uuid, 'ipos', '', 'priceBandLow', 'DOC', 'NOT_AVAILABLE_YET', 'rank1:DOC:NOT_AVAILABLE_YET:no documentType mapped for this field yet', '2026-09-10 00:00:00', 1),
      ($3::uuid, $4::uuid, 'ipos', '', 'priceBandLow', 'DOC', 'NOT_AVAILABLE_YET', 'rank1:DOC:NOT_AVAILABLE_YET:no documentType mapped for this field yet', '2026-09-10 00:00:00', 1),
      ($5::uuid, $6::uuid, 'ipos', '', 'lotSize', 'NSE', 'NOT_AVAILABLE_YET', 'rank1:NSE:NOT_AVAILABLE_YET:not published yet', '2026-09-10 00:00:00', 1)`,
    [ID.stale, ID.stale, ID.noDoc, ID.noDoc, ID.nonDoc, ID.nonDoc]
  );
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`repair-reopen-stale-doc-nay on real Postgres (${SKIP_REASON})`, () => {
  it('refuses without --expect-db', () => {
    const r = run([]);
    expect(r.code, r.out).not.toBe(0);
    expect(r.out).toMatch(/--expect-db <name> is required/);
  }, 60_000);

  it('dry run selects only the stale row (offer doc extracted before last_attempt_at)', () => {
    const before = { }; // no-op placeholder, snapshot compared after apply instead
    const r = run(['--expect-db', 'ipodhan_test']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/1 stale DOC NOT_AVAILABLE_YET row\(s\) on 1 IPO/);
    expect(r.out).toMatch(/f161-stale/);
    expect(r.out).not.toMatch(/f161-nodoc/);
    expect(r.out).not.toMatch(/f161-nondoc/);
    void before;
  }, 60_000);

  let ledger = '';
  it('--apply reopens only the stale row; no-doc and non-DOC rows untouched', async () => {
    const r = run(['--expect-db', 'ipodhan_test', '--apply']);
    expect(r.code, r.out).toBe(0);
    ledger = r.out.match(/ledger \(before-image[^)]*\) written to (\S+\.json)/)![1];
    const after = await snapshot();
    expect(after['f161-stale']).toMatchObject({ state: 'PENDING', rc: null, claimed: null });
    expect(after['f161-stale'].due).not.toBeNull();
    expect(after['f161-nodoc']).toMatchObject({ state: 'NOT_AVAILABLE_YET' });
    expect(after['f161-nondoc']).toMatchObject({ state: 'NOT_AVAILABLE_YET' });
  }, 60_000);

  it('re-running --apply is a no-op (already reopened rows no longer match the cause)', () => {
    const r = run(['--expect-db', 'ipodhan_test', '--apply']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/0 stale DOC NOT_AVAILABLE_YET row\(s\)/);
  }, 60_000);

  it('--undo restores the stale row to NOT_AVAILABLE_YET', async () => {
    const r = run(['--expect-db', 'ipodhan_test', '--undo', ledger, '--apply']);
    expect(r.code, r.out).toBe(0);
    const after = await snapshot();
    expect(after['f161-stale']).toMatchObject({ state: 'NOT_AVAILABLE_YET' });
  }, 60_000);
});
