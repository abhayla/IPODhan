// implements: docs/design/s2-witnesses-plan.md (S2 — witnesses jsonb + verdict)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias — a worktree's node_modules
// junction can resolve the alias back to the PRIMARY checkout, which does not
// carry this slice's edits (see field-sources-row-key-unique.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';

/**
 * S2 — the schema gains capacity to record a SECOND witness for a field.
 * `field_sources` physically cannot today: `unique_field_source_per_ipo` on
 * (ipoId, tableName, rowKey, fieldName) makes one row per field by
 * construction. This slice adds `witnesses jsonb` (the OTHER answers) and
 * `verdict varchar(16)` alongside the existing winning source/value — the
 * unique constraint stays exactly as narrow as before.
 *
 * THE CLASS: every field instance in field_sources — all rows, all segments,
 * all statuses, rows written before AND after this change. This test proves
 * the container works for one instance; it does not itself prove the whole
 * class, which is unchanged data (a NULL-default column touches nothing).
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-sources-witnesses.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 's2-witnesses: SKIPPED — DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-000000005201'; // s2 -> 52, 01 fixture
const SLUG = 's2-witnesses-fixture';

describe.skipIf(!DATABASE_URL)(`field_sources witnesses + verdict (${RUN_LABEL})`, () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });

    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }

    const db = drizzle(pool, { schema });
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S2 Witnesses Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-08', '2026-09-10')
    `);
  }, 30000);

  afterAll(async () => {
    const db = drizzle(pool, { schema });
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
  }, 30000);

  it('T1: a row can carry two witness answers and a verdict, read back intact', async () => {
    const db = drizzle(pool, { schema });
    const witnesses = [
      { source: 'BSE', value: '1000000', at: '2026-09-08T10:00:00.000Z' },
      { source: 'CHITTORGARH', value: '1000000', at: '2026-09-08T11:00:00.000Z' },
    ];

    const [inserted] = await db
      .insert(schema.fieldSources)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'issueSize',
        source: 'NSE',
        confidence: 95,
        witnesses,
        verdict: 'CONFIRMED',
      })
      .returning();

    expect(inserted.witnesses).toEqual(witnesses);
    expect((inserted.witnesses as unknown[]).length).toBe(2);
    expect(inserted.verdict).toBe('CONFIRMED');

    const [readBack] = await db
      .select()
      .from(schema.fieldSources)
      .where(eq(schema.fieldSources.id, inserted.id));

    expect(readBack.witnesses).toEqual(witnesses);
    expect((readBack.witnesses as unknown[]).length).toBe(2);
    expect(readBack.verdict).toBe('CONFIRMED');
  });

  it('T2: the unique constraint still refuses a second row for the same (ipoId, tableName, rowKey, fieldName) — the jsonb approach does not weaken it', async () => {
    const db = drizzle(pool, { schema });

    await db.insert(schema.fieldSources).values({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'faceValue',
      source: 'NSE',
      confidence: 90,
    });

    let caught: unknown;
    try {
      await db.insert(schema.fieldSources).values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'faceValue',
        source: 'BSE',
        confidence: 80,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; message?: string } })?.cause;
    const code = cause?.code;
    const message = cause?.message ?? (caught as Error)?.message ?? '';
    expect(code === '23505' || /duplicate key value violates unique constraint/.test(message)).toBe(
      true
    );
  });
});
