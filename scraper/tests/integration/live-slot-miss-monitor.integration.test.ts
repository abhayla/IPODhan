// implements: item 21 (OD-72) -- the live-slot miss check's database half
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { dbCoverageLoader, completedLiveSlotsToday } from '../../src/services/live-slot-miss-monitor';

/**
 * The rule under test is SQL, so it runs on a real Postgres (ipodhan_test):
 * which IPOs count as bidding on the slot's IST day, and whether a snapshot
 * whose SOURCE time falls inside the slot's UTC bounds covers it. A unit test
 * of the predicate proves nothing about the date arithmetic or the
 * naive-timestamp comparison around it (defect-fix contract item 5).
 *
 * Run: see docs/ops/prod-ops-recipes.md section 12 (DATABASE_URL via the tunnel).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-21 live-slot miss: SKIPPED -- DATABASE_URL not set';

const COVERED_ID = '00000000-0000-4000-8000-0000000021a1';
const MISSED_ID = '00000000-0000-4000-8000-0000000021a2';
const OUTSIDE_ID = '00000000-0000-4000-8000-0000000021a3';

describe.skipIf(!DATABASE_URL)(`live-slot miss loader (${RUN_LABEL})`, () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  const ids = [COVERED_ID, MISSED_ID, OUTSIDE_ID];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    const name = (await pool.query('select current_database() as d')).rows[0].d;
    if (name !== 'ipodhan_test') throw new Error(`Refusing to run against '${name}', not ipodhan_test`);
    db = drizzle(pool, { schema });
    await db.execute(sql`DELETE FROM subscriptions WHERE ipo_id IN (${COVERED_ID}::uuid, ${MISSED_ID}::uuid, ${OUTSIDE_ID}::uuid)`);
    await db.execute(sql`DELETE FROM ipos WHERE id IN (${COVERED_ID}::uuid, ${MISSED_ID}::uuid, ${OUTSIDE_ID}::uuid)`);
    // Tue 2026-09-22 is bidding day 2 for the first two; the third closed on the 18th.
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date) VALUES
        (${COVERED_ID}::uuid, 'Item21 Covered Ltd', 'item21-covered-ltd', 'MAINBOARD', 'OPEN', '2026-09-21', '2026-09-23'),
        (${MISSED_ID}::uuid, 'Item21 Missed Ltd', 'item21-missed-ltd', 'SME', 'OPEN', '2026-09-21', '2026-09-23'),
        (${OUTSIDE_ID}::uuid, 'Item21 Outside Ltd', 'item21-outside-ltd', 'SME', 'OPEN', '2026-09-16', '2026-09-18')
    `);
    // 10:50 IST = 05:20 UTC, inside the 10:30-11:00 IST slot, bound as TEXT (ist-timezone rule).
    await db.execute(sql`
      INSERT INTO subscriptions (ipo_id, timestamp) VALUES (${COVERED_ID}::uuid, '2026-09-22 05:20:00')
    `);
    // 10:25 IST: inside the PREVIOUS slot, so it must not cover 10:30.
    await db.execute(sql`
      INSERT INTO subscriptions (ipo_id, timestamp) VALUES (${MISSED_ID}::uuid, '2026-09-22 04:55:00')
    `);
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.execute(sql`DELETE FROM subscriptions WHERE ipo_id IN (${COVERED_ID}::uuid, ${MISSED_ID}::uuid, ${OUTSIDE_ID}::uuid)`);
    await db.execute(sql`DELETE FROM ipos WHERE id IN (${COVERED_ID}::uuid, ${MISSED_ID}::uuid, ${OUTSIDE_ID}::uuid)`);
    await pool.end();
  }, 60000);

  it('one query judges every ended slot of the day: the bidding IPO with no figure inside a slot is named for that slot only', async () => {
    const slots = completedLiveSlotsToday(new Date('2026-09-22T05:50:00Z')); // 11:20 IST -> 10:00 and 10:30
    expect(slots.map((s) => s.key)).toEqual(['2026-09-22T10:00', '2026-09-22T10:30']);
    const rows = (await dbCoverageLoader(db as never)(slots)).filter((r) => ids.includes(r.id));
    expect(rows.map((r) => [r.slug, r.slotKey, r.covered])).toEqual([
      ['item21-covered-ltd', '2026-09-22T10:00', false],
      ['item21-covered-ltd', '2026-09-22T10:30', true],
      ['item21-missed-ltd', '2026-09-22T10:00', true],
      ['item21-missed-ltd', '2026-09-22T10:30', false],
    ]);
  });

  it('a Saturday is not a bidding day: nothing can be missed', async () => {
    await db.execute(sql`UPDATE ipos SET close_date = '2026-09-28' WHERE id = ${MISSED_ID}::uuid`);
    const saturday = completedLiveSlotsToday(new Date('2026-09-26T05:50:00Z'));
    const rows = (await dbCoverageLoader(db as never)(saturday)).filter((r) => ids.includes(r.id));
    expect(rows).toEqual([]);
  });
});
