import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * #422 round-2 red-first proof: the "proceed" side of the stale-correction
 * guard on the REAL `repair-source-trust-batch-t292.ts` tool. The sibling
 * test (`repair-source-trust-batch-t292-stale-guard.integration.test.ts`)
 * proves the SKIP path (a terminal-status row); no test covered the PROCEED
 * path — a non-terminal row whose live DATE column genuinely still matches
 * the correction's recorded `from` value.
 *
 * Before this fix that path was ALSO broken, just silently: the tool reads
 * `mopshop.openDate` through drizzle's default `date()` column mode, which
 * passes through whatever the raw `pg` driver hands back for a DATE (OID
 * 1082) column — `new Date(year, month - 1, day)`, built from LOCAL date
 * parts. `decideStaleCorrectionSkip` compared that via `String(dateObject)`
 * against the plain `'2026-08-15'` `from` string, which never matched, so
 * EVERY date-typed correction was falsely skipped as "the row has changed
 * since" even when the row had not changed at all.
 *
 * This test seeds Mopshop Distribution Ltd. — the tool's own P1-1 case —
 * UPCOMING (non-terminal) with `open_date` set to the tool's recorded
 * `assumedFrom` ('2026-08-15') so the guard's comparison is exercised on a
 * REAL round-trip through Postgres, not a hand-typed Date. Dry-run only
 * (`--apply` is never passed); the row is deleted in `afterAll`.
 *
 * Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *        npx vitest run -c vitest.integration.config.ts \
 *        tests/integration/repair-source-trust-batch-t292-stale-guard-proceed.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
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

// The other three slugs are seeded already at the tool's own target values
// (Priority Jewels/Suryo/Travels), same shape as the sibling SKIP test, so
// the tool computes zero changes for them and this test's assertions are
// only about Mopshop's date-typed field.
async function seedMopshop(openDate: string) {
  await pool!.query(
    `INSERT INTO ipos (company_name, slug, offering_type, segment, status, open_date, close_date, listing_date, lot_size, price_range_min, price_range_max, issue_size, updated_at) VALUES
      ('Mopshop Distribution Ltd', $1, 'IPO', 'SME', 'UPCOMING', $5, '2026-08-21', '2026-08-26', 1000, 138, 138, NULL, now()),
      ('Priority Jewels Limited', $2, 'IPO', 'MAINBOARD', 'LISTED', '2026-08-28', '2026-09-01', '2026-09-04', NULL, 190, 200, NULL, now()),
      ('Suryo Foods Industries Ltd', $3, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-19', '2026-03-06', '2026-03-11', NULL, 20, 20, '59400000.00', now()),
      ('Travels Rentals Ltd', $4, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-05', '2026-03-06', '2026-03-11', NULL, 15, 15, '168040275.00', now())
    `,
    [SLUGS.mopshop, SLUGS.priorityJewels, SLUGS.suryo, SLUGS.travels, openDate]
  );
}

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)('repair-source-trust-batch-t292 stale-correction guard — PROCEED path (#422 round 2)', () => {
  it('proceeds (proposes the correction) on a non-terminal row whose DATE column still matches `from`, dry-run only', async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    await cleanup();
    // open_date == the tool's recorded assumedFrom ('2026-08-15') for Mopshop.
    await seedMopshop('2026-08-15');

    const { code, out } = run([]); // no --apply: dry run only
    expect(code).toBe(0);
    expect(out).not.toMatch(/SKIP mopshop-distribution-ltd\.openDate/);
    expect(out).toMatch(/Mopshop Distribution Ltd \(mopshop-distribution-ltd\):/);
    expect(out).toMatch(/- openDate: "2026-08-15" -> "2026-08-19"/);

    // Dry run never writes: the live column is unchanged.
    const after = await pool.query(`SELECT open_date::text AS open_date FROM ipos WHERE slug = $1`, [SLUGS.mopshop]);
    expect(after.rows[0].open_date).toBe('2026-08-15');
  });

  it('still skips when the DATE column is one calendar day different from `from`', async () => {
    await cleanup();
    // open_date one day off the recorded assumedFrom ('2026-08-15' -> '2026-08-16').
    await seedMopshop('2026-08-16');

    const { code, out } = run([]);
    expect(code).toBe(0);
    expect(out).toMatch(/SKIP mopshop-distribution-ltd\.openDate:.*current value/);
    expect(out).not.toMatch(/would update: mopshop-distribution-ltd\.openDate ->/);
  });
});
