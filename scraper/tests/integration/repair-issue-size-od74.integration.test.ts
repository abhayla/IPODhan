import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * OD-74 / OD-73 / OD-77 on real Postgres (ipodhan_test), driving the REAL tool
 * (scraper/scripts/repair-issue-size-chittorgarh-once-od74.ts) as a process, against the
 * tracked page store (copied to a temp dir so the run cannot touch the committed manifest),
 * with --no-fetch: no network.
 *
 *  - a BSE-computed value that differs from the printed total is written, with CHITTORGARH provenance;
 *  - an identical value and a value equal within the printed rounding are NOT written and NOT re-stamped;
 *  - TENDER 0 -> NULL; OFS 0 -> NULL + plan row reason_code NOT_SOURCED;
 *  - --undo restores every row exactly (value, updated_at, provenance row, plan row gone);
 *  - prod mode with an empty store refuses (exit 2) and writes nothing.
 *
 * Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *        npx vitest run -c vitest.integration.config.ts tests/integration/repair-issue-size-od74.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'repair-issue-size-od74: DATABASE_URL not set';
const SCRAPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = path.join(SCRAPER, 'scripts', 'data', 'od74-issue-size');

const ID = {
  write: '00000000-0000-4000-9074-000000000001',
  identical: '00000000-0000-4000-9074-000000000002',
  rounding: '00000000-0000-4000-9074-000000000003',
  tender: '00000000-0000-4000-9074-000000000004',
  ofs: '00000000-0000-4000-9074-000000000005',
};
const IDS = Object.values(ID);
const STAMP = '2026-06-16 12:52:00';

let pool: Pool | null = null;
let tmpStore = '';

function run(args: string[]) {
  const r = spawnSync('npx', ['tsx', 'scripts/repair-issue-size-chittorgarh-once-od74.ts', ...args], {
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
    `SELECT i.slug, i.issue_size::text AS size, i.updated_at::text AS iu, fs.source::text AS src, fs.updated_at::text AS fu,
            fs.updated_by AS fby, p.reason_code AS rc, p.state::text AS pstate
       FROM ipos i
       LEFT JOIN field_sources fs ON fs.ipo_id = i.id AND fs.table_name = 'ipos' AND fs.field_name = 'issueSize' AND fs.row_key = ''
       LEFT JOIN ipo_field_plan p ON p.ipo_id = i.id AND p.table_name = 'ipos' AND p.field_name = 'issue_size' AND p.row_key = ''
      WHERE i.id = ANY($1::uuid[]) ORDER BY i.slug`,
    [IDS]
  );
  return Object.fromEntries(rows.map((r) => [r.slug, r]));
}

async function cleanup() {
  await pool!.query(`DELETE FROM ipo_field_plan WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await pool!.query(`DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await pool!.query(`DELETE FROM ipos WHERE id = ANY($1::uuid[])`, [IDS]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  await cleanup();
  await pool.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, issue_size, verifier_url, updated_at) VALUES
      ($1::uuid, 'OD74 Write Ltd', 'od74-t-write', 'IPO', 'MAINBOARD', 'LISTED', '2021-12-21', 1679302840, 'https://www.chittorgarh.com/ipo/cms-info-systems-ipo/1203/', $6),
      ($2::uuid, 'OD74 Identical Ltd', 'od74-t-identical', 'IPO', 'SME', 'LISTED', '2026-08-15', 267300000, 'https://www.chittorgarh.com/ipo/dhanwel-hybrid-seeds-ipo/2846/', $6),
      ($3::uuid, 'OD74 Rounding Ltd', 'od74-t-rounding', 'IPO', 'SME', 'LISTED', '2026-08-24', 507744000, 'https://www.chittorgarh.com/ipo/kwick-forensic-solutions-ipo/2757/', $6),
      ($4::uuid, 'OD74 Tender Ltd', 'od74-t-tender', 'TENDER', NULL, 'CLOSED', '2026-08-01', 0, NULL, $6),
      ($5::uuid, 'OD74 Ofs Ltd', 'od74-t-ofs', 'OFS', 'MAINBOARD', 'CLOSED', '2026-08-01', 0, NULL, $6)`,
    [ID.write, ID.identical, ID.rounding, ID.tender, ID.ofs, STAMP]
  );
  await pool.query(
    `INSERT INTO field_sources (ipo_id, table_name, field_name, source, confidence, updated_at, updated_by)
     SELECT id, 'ipos', 'issueSize', 'BSE', 90, $2::timestamp, 'seed' FROM ipos WHERE id = ANY($1::uuid[])`,
    [[ID.write, ID.identical, ID.rounding], STAMP]
  );
  tmpStore = fs.mkdtempSync(path.join(os.tmpdir(), 'od74-store-'));
  fs.cpSync(STORE, tmpStore, { recursive: true });
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
  if (tmpStore) fs.rmSync(tmpStore, { recursive: true, force: true });
});

describe.skipIf(!DATABASE_URL)(`OD-74/OD-77 repair on real Postgres (${SKIP_REASON})`, () => {
  it('prod mode with no pinned pages refuses, exit 2, nothing written', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'od74-empty-'));
    const before = await snapshot();
    const r = run(['--apply', '--prod-mode', '--no-fetch', '--store-dir', empty]);
    expect(r.code, r.out).toBe(2);
    expect(r.out).toMatch(/prod mode never fetches/);
    expect(await snapshot()).toEqual(before);
    fs.rmSync(empty, { recursive: true, force: true });
  }, 150_000);

  let applyLedger = '';
  it('apply: writes only the real difference; identical and within-rounding rows untouched', async () => {
    const before = await snapshot();
    const r = run(['--apply', '--no-fetch', '--store-dir', tmpStore]);
    expect(r.code, r.out).toBe(0);
    applyLedger = r.out.match(/ledger (\S+\.json)/)![1];
    const after = await snapshot();
    expect(after['od74-t-write'].size).toBe('11000000000.00');
    expect(after['od74-t-write'].src).toBe('CHITTORGARH');
    for (const slug of ['od74-t-identical', 'od74-t-rounding']) expect(after[slug]).toEqual(before[slug]);
  }, 150_000);

  let zerosLedger = '';
  it('--zeros apply: TENDER 0 -> NULL with no plan row; OFS 0 -> NULL with NOT_SOURCED', async () => {
    const r = run(['--zeros', '--apply']);
    expect(r.code, r.out).toBe(0);
    zerosLedger = r.out.match(/ledger (\S+\.json)/)![1];
    const s = await snapshot();
    expect(s['od74-t-tender']).toMatchObject({ size: null, rc: null });
    expect(s['od74-t-ofs']).toMatchObject({ size: null, rc: 'NOT_SOURCED', pstate: 'EXHAUSTED' });
  }, 150_000);

  it('--undo restores every row exactly from the before-image', async () => {
    for (const f of [zerosLedger, applyLedger]) {
      const r = run(['--undo', f]);
      expect(r.code, r.out).toBe(0);
    }
    const s = await snapshot();
    expect(s['od74-t-write']).toMatchObject({ size: '1679302840.00', iu: STAMP, src: 'BSE', fu: STAMP, fby: 'seed' });
    expect(s['od74-t-tender']).toMatchObject({ size: '0.00', iu: STAMP });
    expect(s['od74-t-ofs']).toMatchObject({ size: '0.00', iu: STAMP, rc: null, pstate: null });
  }, 300_000);
});
