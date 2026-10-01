/**
 * #1380 / F-220 on the real database (ipodhan_test only): the repair core selects the exchange-specific
 * market_holidays rows that are one-day-early copies of another exchange's row and deletes exactly those,
 * in one transaction. Seeds the F-220 shape in year 2031 (no real rows there) inside an outer transaction
 * that is rolled back, so nothing is left behind and parallel files are unaffected.
 *
 * Must be selected: NSE copies one day early of BOTH rows (one with different case/whitespace), a BSE copy.
 * Must NOT be selected: a genuine NSE-only holiday with no later copy; the double-holiday date (a BOTH row
 * on the same date, 2031-10-02) even though a BOTH row with the same description sits the next day.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { deleteShiftedHolidayCopies, findShiftedHolidayCopies } from '../../src/services/shifted-market-holidays';

const rows = (r: any) => (r.rows ?? r) as any[];
const ROLLBACK = new Error('rollback-sentinel');
const id = (n: number) => `00000000-0000-4000-8000-0000001380${String(n).padStart(2, '0')}`;

const SEED: Array<[number, string, string, string]> = [
  // [n, date, exchange, description]
  [1, '2031-04-18', 'BOTH', 'Good Friday'],
  [2, '2031-04-17', 'NSE', 'Good Friday'], // shifted copy -> selected
  [3, '2031-01-26', 'BOTH', 'Republic Day'],
  [4, '2031-01-25', 'NSE', '  REPUBLIC   day '], // shifted copy, case/whitespace differ -> selected
  [5, '2031-06-10', 'NSE', 'Special NSE closure'], // genuine NSE-only, no later copy -> NOT selected
  [6, '2031-10-02', 'BOTH', 'Mahatma Gandhi Jayanti'],
  [7, '2031-10-02', 'NSE', 'Dussehra'], // double holiday: date carried by BOTH -> NOT selected
  [8, '2031-10-03', 'BOTH', 'Dussehra'],
  [9, '2031-11-14', 'BOTH', 'Diwali Balipratipada'],
  [10, '2031-11-13', 'BSE', 'Diwali Balipratipada'], // BSE shifted copy -> selected
];
const SHIFTED = [2, 4, 10].map(id);
const KEPT = [1, 3, 5, 6, 7, 8, 9].map(id);

async function seed(tx: any) {
  for (const [n, date, exchange, description] of SEED) {
    await tx.execute(sql`
      INSERT INTO market_holidays (id, date, description, exchange, type, year)
      VALUES (${id(n)}::uuid, ${date}::date, ${description}, ${exchange}::exchange, 'TRADING'::holiday_type, 2031)`);
  }
}

describe('shifted market holiday repair core (#1380, ipodhan_test)', () => {
  let db: any;
  beforeAll(async () => {
    db = await getTestDb();
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
  });
  afterAll(async () => {
    await cleanupTestDb();
  });

  it('selects exactly the one-day-early copies and not the genuine or double-holiday rows', async () => {
    await expect(
      db.transaction(async (tx: any) => {
        await seed(tx);
        const mine = (await findShiftedHolidayCopies(tx)).filter((s) => s.row.year === 2031);
        expect(mine.map((s) => s.row.id).sort()).toEqual([...SHIFTED].sort());
        const byId = new Map(mine.map((s) => [s.row.id, s]));
        expect(byId.get(id(2))!.copyOf.id).toBe(id(1));
        expect(byId.get(id(2))!.weekday).toBe('Thursday');
        expect(byId.get(id(10))!.copyOf.id).toBe(id(9));
        throw ROLLBACK;
      })
    ).rejects.toBe(ROLLBACK);
  });

  it('apply deletes exactly the selected rows, leaves every other row, and a second run selects none', async () => {
    await expect(
      db.transaction(async (tx: any) => {
        await seed(tx);
        const before = rows(await tx.execute(sql`SELECT count(*)::int AS n FROM market_holidays`))[0].n;
        const result = await deleteShiftedHolidayCopies(tx);
        const mineDeleted = result.selected.filter((s) => s.row.year === 2031).map((s) => s.row.id);
        expect(mineDeleted.sort()).toEqual([...SHIFTED].sort());
        expect(result.deleted).toBe(result.selected.length);
        const after = rows(await tx.execute(sql`SELECT count(*)::int AS n FROM market_holidays`))[0].n;
        expect(after).toBe(before - result.deleted);
        const left = rows(await tx.execute(sql`SELECT id::text AS id FROM market_holidays WHERE year = 2031`)).map((r) => r.id);
        expect(left.sort()).toEqual([...KEPT].sort());
        expect((await findShiftedHolidayCopies(tx)).length).toBe(0);
        throw ROLLBACK;
      })
    ).rejects.toBe(ROLLBACK);
  });
});
