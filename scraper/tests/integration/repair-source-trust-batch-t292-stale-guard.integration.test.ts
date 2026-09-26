import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #422 red-first proof, on the REAL `repair-source-trust-batch-t292.ts` tool:
 * the tool hard-codes a dated (2026-08-23) correction that nulls Priority
 * Jewels Limited's open/close dates, reasoning that the row had none at the
 * time. A prod dry run on 2026-09-08 showed the row had since gone LISTED
 * with real, correct open/close dates — the tool proposed nulling them
 * anyway, because nothing checked whether the row's facts had moved on since
 * the citation.
 *
 * This test seeds a Priority-Jewels-SHAPED row (LISTED, real non-null
 * open/close dates, no field_sources provenance — the exact shape from
 * issue #422) plus the tool's other three hard-coded slugs already holding
 * their OWN correct target values (so the tool computes zero changes for
 * them and the stale-correction guard never has to run on them). Before the
 * #422 fix this test failed: the dry run printed
 * "priority-jewels-ltd: openDate: ... -> null" as a proposed change. After
 * the fix it prints a SKIP line naming the LISTED status as the reason and
 * proposes zero rows.
 *
 * Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *        npx vitest run -c vitest.integration.config.ts tests/integration/repair-source-trust-batch-t292-stale-guard.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'repair-source-trust-batch-t292-stale-guard: DATABASE_URL not set';
const SCRAPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SLUGS = {
  mopshop: 'mopshop-distribution-ltd',
  priorityJewels: 'priority-jewels-ltd',
  suryo: 'suryo-foods-industries-ltd',
  travels: 'travels-rentals-ltd',
} as const;

let pool: Pool | null = null;

function run(args: string[]) {
  const r = spawnSync('npx', ['tsx', 'scripts/repair-source-trust-batch-t292.ts', ...args], {
    cwd: SCRAPER,
    env: { ...process.env, REDIS_URL: '' },
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

async function cleanup() {
  await pool!.query(`DELETE FROM field_sources WHERE ipo_id IN (SELECT id FROM ipos WHERE slug = ANY($1))`, [
    Object.values(SLUGS),
  ]);
  await pool!.query(`DELETE FROM ipos WHERE slug = ANY($1)`, [Object.values(SLUGS)]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  await cleanup();
  await pool.query(
    `INSERT INTO ipos (company_name, slug, offering_type, segment, status, open_date, close_date, listing_date, lot_size, price_range_min, price_range_max, issue_size, updated_at) VALUES
      -- t292's own target values already in place -> zero changes computed, never reaches the stale-correction guard.
      ('Mopshop Distribution Ltd', $1, 'IPO', 'SME', 'UPCOMING', '2026-08-19', '2026-08-21', '2026-08-26', 1000, 138, 138, NULL, now()),
      -- #422 shape: the row t292 would still try to null on a re-run -- LISTED, real non-null dates, no field_sources provenance.
      ('Priority Jewels Limited', $2, 'IPO', 'MAINBOARD', 'LISTED', '2026-08-28', '2026-09-01', '2026-09-04', NULL, 190, 200, NULL, now()),
      ('Suryo Foods Industries Ltd', $3, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-19', '2026-03-06', '2026-03-11', NULL, 20, 20, '59400000.00', now()),
      ('Travels Rentals Ltd', $4, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-05', '2026-03-06', '2026-03-11', NULL, 15, 15, '168040275.00', now())
    `,
    [SLUGS.mopshop, SLUGS.priorityJewels, SLUGS.suryo, SLUGS.travels]
  );
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)('repair-source-trust-batch-t292 stale-correction guard (#422)', () => {
  it('skips the Priority-Jewels-shaped LISTED row instead of proposing to null its real dates', () => {
    const { code, out } = run([]);
    expect(code).toBe(0);
    // The stale-correction guard fires and names the reason.
    expect(out).toMatch(/SKIP priority-jewels-ltd\.openDate:.*row status is LISTED/);
    expect(out).toMatch(/SKIP priority-jewels-ltd\.closeDate:.*row status is LISTED/);
    // Zero rows proposed for priority-jewels-ltd specifically -- it never appears in the "would be corrected" print block.
    expect(out).not.toMatch(/Priority Jewels Limited \(priority-jewels-ltd\):/);
  });
});
