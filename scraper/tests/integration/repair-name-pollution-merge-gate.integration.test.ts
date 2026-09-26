import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { runNamePollutionRepair, MERGED_BY } from '../../scripts/repair-name-pollution-and-redirects.js';

/**
 * #1051 (spec section 2.3.3.3, OD-38, OD-69, OD-92): the name-pollution repair merges a loser row
 * ONLY through `IPORepository.mergeDuplicateInto` — the eligibility gate runs, an `ipo_merge_log`
 * row is written, and `unmergeDuplicate` restores the loser. A loser the gate refuses is reported
 * for that row and left in place, never forced.
 *
 * Fixture, three rows that the tool groups as one company (same sanitize + match key):
 *   KEEP   "T1051 Gamma Ltd."                          clean, the canonical
 *   TWIN   "T1051 Gamma Ltd. (T1051 Gamma IPO) CT"     bracketed listing-page twin: the gate passes it
 *   LETTER "T1051 Gamma Ltd. O"                        bare trailing status letter: the identity fold
 *                                                      keeps the "O" on purpose, so the gate refuses it
 *
 * SKIPS CLEANLY when no DATABASE_URL is set. Run from `scraper/` against ipodhan_test only:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/repair-name-pollution-merge-gate.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const KEEP = '00000000-0000-4000-9105-1000000000a1';
const TWIN = '00000000-0000-4000-9105-1000000000a2';
const LETTER = '00000000-0000-4000-9105-1000000000a3';
const IDS = [KEEP, TWIN, LETTER];
const KEEP_NAME = 'T1051 Gamma Ltd.';
const KEEP_SLUG = generateIPOSlug(KEEP_NAME);
const TWIN_SLUG = 't-1051-gamma-twin-ct';
const LETTER_SLUG = 't-1051-gamma-letter-o';

let pool: Pool | null = null;
let repo: IPORepository | null = null;
let db: ReturnType<typeof drizzle> | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

async function cleanup() {
  await pool!.query(`DELETE FROM ipo_merge_log WHERE drop_ipo_id = ANY($1::uuid[]) OR keep_ipo_id = ANY($1::uuid[])`, [IDS]);
  await pool!.query(`DELETE FROM ipo_slug_redirects WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await pool!.query(`DELETE FROM ipos WHERE id = ANY($1::uuid[])`, [IDS]);
}

async function plant() {
  await pool!.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date, created_at)
     VALUES ($1, $4, $5, 'IPO', 'MAINBOARD', 'UPCOMING', '2026-10-05', '2026-10-07', '2026-09-01T00:00:00Z'),
            ($2, 'T1051 Gamma Ltd. (T1051 Gamma IPO) CT', $6, 'IPO', 'MAINBOARD', 'UPCOMING', '2026-10-05', '2026-10-07', '2026-09-02T00:00:00Z'),
            ($3, 'T1051 Gamma Ltd. O', $7, 'IPO', 'MAINBOARD', 'UPCOMING', '2026-10-05', '2026-10-07', '2026-09-03T00:00:00Z')`,
    [KEEP, TWIN, LETTER, KEEP_NAME, KEEP_SLUG, TWIN_SLUG, LETTER_SLUG]
  );
}

async function presentIds(): Promise<string[]> {
  const r = await pool!.query(`SELECT id::text FROM ipos WHERE id = ANY($1::uuid[]) ORDER BY id`, [IDS]);
  return r.rows.map((x) => x.id as string);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  const name = (await pool.query('select current_database() as n')).rows[0].n as string;
  if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}: this test writes; ipodhan_test only`);
  db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);
});
beforeEach(async () => {
  if (pool) await cleanup();
});
afterAll(async () => {
  if (pool) await cleanup();
  await pool?.end();
});

describe.skipIf(!DATABASE_URL)('#1051 name-pollution loser merge goes through mergeDuplicateInto (ipodhan_test)', () => {
  it('dry run writes nothing and already names the refused loser', async () => {
    await plant();
    const c = await runNamePollutionRepair(db as never, repo!, { apply: false, log: () => {} });
    expect(await presentIds()).toEqual([...IDS].sort());
    expect((await pool!.query(`SELECT count(*)::int n FROM ipo_merge_log WHERE keep_ipo_id = $1`, [KEEP])).rows[0].n).toBe(0);
    expect(c.merged).toBe(1); // planned
    expect(c.refused.map((r) => r.loserId)).toEqual([LETTER]);
  });

  it('apply: the twin is merged with an ipo_merge_log row and a DUPLICATE_MERGE redirect; the refused loser stays, named', async () => {
    await plant();
    const c = await runNamePollutionRepair(db as never, repo!, { apply: true, log: () => {} });

    expect(c.merged).toBe(1);
    expect(c.refused).toHaveLength(1);
    expect(c.refused[0].loserId).toBe(LETTER);
    expect(c.refused[0].slug).toBe(LETTER_SLUG);
    expect(c.refused[0].reason).toMatch(/company names do not fold/);

    expect(await presentIds()).toEqual([KEEP, LETTER].sort());

    const log = await pool!.query(
      `SELECT keep_ipo_id::text k, drop_ipo_id::text d, merged_by, drop_slug FROM ipo_merge_log WHERE drop_ipo_id = $1`,
      [TWIN]
    );
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ k: KEEP, d: TWIN, merged_by: MERGED_BY, drop_slug: TWIN_SLUG });
    expect((await pool!.query(`SELECT count(*)::int n FROM ipo_merge_log WHERE drop_ipo_id = $1`, [LETTER])).rows[0].n).toBe(0);

    const rd = await pool!.query(`SELECT ipo_id::text i, reason FROM ipo_slug_redirects WHERE old_slug = $1`, [TWIN_SLUG]);
    expect(rd.rows).toEqual([{ i: KEEP, reason: 'DUPLICATE_MERGE' }]);
  });

  it('--unmerge restores the merged twin exactly and takes its redirect back', async () => {
    await plant();
    const before = (await pool!.query(`SELECT to_jsonb(t.*)::text r FROM ipos t WHERE id = $1`, [TWIN])).rows[0].r as string;
    await runNamePollutionRepair(db as never, repo!, { apply: true, log: () => {} });
    const mergeId = (await pool!.query(`SELECT id::text FROM ipo_merge_log WHERE drop_ipo_id = $1`, [TWIN])).rows[0].id as string;

    await repo!.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'repair-name-pollution-merge-gate.test' });

    const after = (await pool!.query(`SELECT to_jsonb(t.*)::text r FROM ipos t WHERE id = $1`, [TWIN])).rows[0]?.r as string;
    expect(JSON.parse(after)).toEqual(JSON.parse(before));
    expect(await presentIds()).toEqual([...IDS].sort());
    expect((await pool!.query(`SELECT count(*)::int n FROM ipo_slug_redirects WHERE old_slug = $1`, [TWIN_SLUG])).rows[0].n).toBe(0);
  });

  it('a second apply run is a no-op for the merged twin and still refuses the same loser', async () => {
    await plant();
    await runNamePollutionRepair(db as never, repo!, { apply: true, log: () => {} });
    const c2 = await runNamePollutionRepair(db as never, repo!, { apply: true, log: () => {} });
    expect(c2.merged).toBe(0);
    expect(c2.refused.map((r) => r.loserId)).toEqual([LETTER]);
    expect((await pool!.query(`SELECT count(*)::int n FROM ipo_merge_log WHERE keep_ipo_id = $1`, [KEEP])).rows[0].n).toBe(1);
  });
});
