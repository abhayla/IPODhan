/**
 * #1364 on the real database (ipodhan_test only): `readDocumentFilingDates` returns each document's
 * `filing_date` as YYYY-MM-DD (date column, no timezone shift), null for a document without one, and
 * skips ids that are not uuids or have no row. Consolidation orders two equal-rank documents by these
 * dates (OD-30), so the SQL is proven here, not only the comparator.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { readDocumentFilingDates } from '../../src/services/document-filing-dates';

const IPO = '00000000-0000-4000-8000-000000001364';
const rows = (r: any) => (r.rows ?? r) as any[];
let db: any;

describe('readDocumentFilingDates (#1364, ipodhan_test)', () => {
  beforeAll(async () => {
    db = await getTestDb();
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment)
      VALUES (${IPO}::uuid, 'Filing Date Ltd', 'filing-date-ltd-1364', 'UPCOMING', 'MAINBOARD')`);
  });
  afterAll(async () => {
    if (db) await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
    await cleanupTestDb();
  });

  it('returns each date as stored, null without one, and skips unknown or non-uuid ids', async () => {
    const insert = async (type: string, filed: string | null) =>
      rows(await db.execute(sql`
        INSERT INTO documents (ipo_id, type, title, url, filing_date)
        VALUES (${IPO}::uuid, ${type}, ${type}, ${'https://example.test/1364-' + Math.random().toString(36).slice(2) + '.pdf'}, ${filed}::date)
        RETURNING id`))[0].id as string;
    const older = await insert('RHP', '2026-08-20');
    const newer = await insert('RHP', '2026-09-10');
    const undated = await insert('DRHP', null);
    const missing = '00000000-0000-4000-8000-0000000013ff';

    const dates = await readDocumentFilingDates(db, [older, newer, undated, missing, 'not-a-uuid']);
    expect(dates.get(older)).toBe('2026-08-20');
    expect(dates.get(newer)).toBe('2026-09-10');
    expect(dates.get(undated)).toBeNull();
    expect(dates.has(missing)).toBe(false);
    expect(dates.size).toBe(3);
  });
});
