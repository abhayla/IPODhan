import { describe, it, expect, beforeEach, afterAll } from 'vitest';
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
 * #422 round 4 (MAJOR 2): this file used to be TWO files
 * (`...stale-guard.integration.test.ts` and
 * `...stale-guard-proceed.integration.test.ts`), each independently
 * cleaning up and re-seeding the SAME four hard-coded slugs
 * ('mopshop-distribution-ltd', 'priority-jewels-ltd',
 * 'suryo-foods-industries-ltd', 'travels-rentals-ltd') against the one
 * shared `ipodhan_test` database. `vitest.integration.config.ts` already
 * disables `fileParallelism` (2026-09-26, same class), so the two files
 * cannot literally race each other — but they are STILL two independently
 * mutating owners of the exact same rows in the same suite, and the CI
 * failure this round chased (mopshop's SKIP line missing, "0 rows
 * corrected", output shaped like the SIBLING file's fixture) is exactly the
 * failure mode of two files sharing one mutable fixture, whichever ran last
 * before the assertion read the DB.
 *
 * A "per-file slug prefix" (the usual fix for this class) is NOT available
 * here: `repair-source-trust-batch-t292.ts` hard-codes these four exact
 * slugs via `loadRow('mopshop-distribution-ltd')` etc. in `main()` — they
 * are not parameterized, so two files cannot each own a disjoint slug set
 * without rewriting the tool under test (out of scope for this round).
 * Merging into ONE file with ONE pool, ONE cleanup, and sequential `it()`
 * blocks removes the cross-file shared-fixture hazard structurally instead:
 * there is now exactly one owner of these four rows in the whole suite.
 *
 * This test seeds a Priority-Jewels-shaped row (LISTED, real non-null
 * open/close dates, no field_sources provenance — the exact shape from
 * issue #422) plus the tool's other three hard-coded slugs already holding
 * their OWN correct target values (so the tool computes zero changes for
 * them and the stale-correction guard never has to run on them), then two
 * PROCEED-path cases against Mopshop's date-typed field (#422 round 2): the
 * tool reads `mopshop.openDate` through drizzle's default `date()` column
 * mode, which passes through whatever the raw `pg` driver hands back for a
 * DATE (OID 1082) column — a `Date` object built from LOCAL date parts.
 * `decideStaleCorrectionSkip` compares that via `toComparableCorrectionText`
 * (calendar parts, never `.toISOString()`) against the plain 'YYYY-MM-DD'
 * `from` string.
 *
 * Run: DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *        npx vitest run -c vitest.integration.config.ts tests/integration/repair-source-trust-batch-t292-stale-guard.integration.test.ts
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

// The Priority-Jewels/Suryo/Travels values below are the tool's own target
// values (Priority Jewels: the #422 LISTED shape it must SKIP; Suryo/Travels:
// already-correct) -- the tool computes zero changes for those three in
// every case here, so each `it()` below only has to reason about Mopshop.
async function seed(mopshopOpenDate: string) {
  await pool!.query(
    `INSERT INTO ipos (company_name, slug, offering_type, segment, status, open_date, close_date, listing_date, lot_size, price_range_min, price_range_max, issue_size, updated_at) VALUES
      ('Mopshop Distribution Ltd', $1, 'IPO', 'SME', 'UPCOMING', $5, '2026-08-21', '2026-08-26', 1000, 138, 138, NULL, now()),
      ('Priority Jewels Limited', $2, 'IPO', 'MAINBOARD', 'LISTED', '2026-08-28', '2026-09-01', '2026-09-04', NULL, 190, 200, NULL, now()),
      ('Suryo Foods Industries Ltd', $3, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-19', '2026-03-06', '2026-03-11', NULL, 20, 20, '59400000.00', now()),
      ('Travels Rentals Ltd', $4, 'RIGHTS', 'MAINBOARD', 'LISTED', '2026-02-05', '2026-03-06', '2026-03-11', NULL, 15, 15, '168040275.00', now())
    `,
    [SLUGS.mopshop, SLUGS.priorityJewels, SLUGS.suryo, SLUGS.travels, mopshopOpenDate]
  );
}

beforeEach(async () => {
  if (!DATABASE_URL) return;
  if (!pool) pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  await cleanup();
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)('repair-source-trust-batch-t292 stale-correction guard (#422)', () => {
  it('skips the Priority-Jewels-shaped LISTED row instead of proposing to null its real dates', async () => {
    // Mopshop already at its own target values here -> zero changes computed
    // for it, so this case is only about Priority Jewels.
    await seed('2026-08-19');

    const { code, out } = run([]);
    expect(code).toBe(0);
    expect(out).toMatch(/SKIP priority-jewels-ltd\.openDate:.*row status is LISTED/);
    expect(out).toMatch(/SKIP priority-jewels-ltd\.closeDate:.*row status is LISTED/);
    // Zero rows proposed for priority-jewels-ltd specifically -- it never appears in the "would be corrected" print block.
    expect(out).not.toMatch(/Priority Jewels Limited \(priority-jewels-ltd\):/);
  });

  it('proceeds (proposes the correction) on a non-terminal row whose DATE column still matches `from`, dry-run only (#422 round 2)', async () => {
    // open_date == the tool's recorded assumedFrom ('2026-08-15') for Mopshop.
    await seed('2026-08-15');

    const { code, out } = run([]); // no --apply: dry run only
    expect(code).toBe(0);
    expect(out).not.toMatch(/SKIP mopshop-distribution-ltd\.openDate/);
    expect(out).toMatch(/Mopshop Distribution Ltd \(mopshop-distribution-ltd\):/);
    expect(out).toMatch(/- openDate: "2026-08-15" -> "2026-08-19"/);

    // Dry run never writes: the live column is unchanged.
    const after = await pool!.query(`SELECT open_date::text AS open_date FROM ipos WHERE slug = $1`, [SLUGS.mopshop]);
    expect(after.rows[0].open_date).toBe('2026-08-15');
  });

  it('still skips when the DATE column is one calendar day different from `from` (#422 round 2)', async () => {
    // open_date one day off the recorded assumedFrom ('2026-08-15' -> '2026-08-16').
    await seed('2026-08-16');

    const { code, out } = run([]);
    expect(code).toBe(0);
    expect(out).toMatch(/SKIP mopshop-distribution-ltd\.openDate:.*current value/);
    expect(out).not.toMatch(/would update: mopshop-distribution-ltd\.openDate ->/);
  });
});
