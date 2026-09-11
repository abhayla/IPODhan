// implements: item 5 slice s2 — ipo_field_plan row-scoped unique key (#618)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout,
// which does not carry this slice's schema edit (see
// field-sources-row-key-unique.integration.test.ts for the same guard).
import * as schema from '../../../packages/shared/src/db/schema';

/**
 * Item 5 slice s2 (#618) — PR #612's `unique_ipo_field_plan` constraint is
 * (ipo_id, table_name, field_name). That key gives ONE plan row per
 * (IPO, table, field) — it cannot express per-row state for a multi-row
 * child table. THE CLASS this breaks: `financial_statements` holds one row
 * per fiscal year, so FY2023's `revenue` plan row and FY2024's `revenue`
 * plan row collide under the old key -- the table cannot record "FY2023's
 * revenue was supplied, FY2024's was never printed", which is the exact
 * thing it exists to record.
 *
 * The fix widens the key to (ipo_id, table_name, row_key, field_name) with
 * `row_key` NOT NULL DEFAULT '' -- the same discriminator item 1 (s18)
 * already established for `field_sources`, not a `fiscal_year` column (see
 * the build card + PR body for why NULL-in-UNIQUE and a second
 * discriminator are both rejected).
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/ipo-field-plan-row-key-unique.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-5-slice-s2: SKIPPED — DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000618f1';
const SLUG = 's2-field-plan-row-key-unique';

// The pg driver's error is on `err.cause` (drizzle's DrizzleQueryError wraps
// it, and its own `.message` is the SQL text, not the Postgres error) --
// `.rejects.toThrow(/duplicate key/)` checks `.message` and never matches.
// Assert on the underlying cause: code 23505 + the named constraint.
async function assertUniqueViolation(
  db: ReturnType<typeof drizzle>,
  values: Record<string, unknown>
): Promise<void> {
  let caught: unknown;
  try {
    await db.insert(schema.ipoFieldPlan).values(values as never);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeDefined();
  const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause;
  expect(cause?.code).toBe('23505');
  expect(cause?.constraint).toBe('unique_ipo_field_plan');
}

describe.skipIf(!DATABASE_URL)(`ipo_field_plan row-scoped unique key (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
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
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S2 Field Plan RowKey Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-08', '2026-09-10')
    `);
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    const db = drizzle(pool, { schema });
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
  }, 30000);

  it('THE CLASS: two plan rows for the same (ipo, table, field), different row keys -- both insertable', async () => {
    const db = drizzle(pool!, { schema });

    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: 'FY2023',
      fieldName: 'revenue',
      manifestVersion: 1,
    });
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: 'FY2024',
      fieldName: 'revenue',
      manifestVersion: 1,
    });

    const rows = await db
      .select()
      .from(schema.ipoFieldPlan)
      .where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));

    expect(rows.length).toBe(2);
    const byKey = new Map(rows.map((r) => [r.rowKey, r]));
    expect(byKey.has('FY2023')).toBe(true);
    expect(byKey.has('FY2024')).toBe(true);
  });

  it('the constraint STILL constrains: same (ipo, table, row_key, field) twice -- collides', async () => {
    const db = drizzle(pool!, { schema });

    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: 'FY2025',
      fieldName: 'netProfit',
      manifestVersion: 1,
    });

    await expect(assertUniqueViolation(db, {
      ipoId: IPO_ID,
      tableName: 'financial_statements',
      rowKey: 'FY2025',
      fieldName: 'netProfit',
      manifestVersion: 1,
    })).resolves.toBeUndefined();
  });

  it("non-row-scoped fields still collide on the sentinel '' row_key (unchanged behavior)", async () => {
    const db = drizzle(pool!, { schema });

    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'ipo_details',
      fieldName: 'faceValue',
      manifestVersion: 1,
    });

    const row = (
      await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(eq(schema.ipoFieldPlan.ipoId, IPO_ID))
    ).find((r) => r.tableName === 'ipo_details' && r.fieldName === 'faceValue');
    expect(row?.rowKey).toBe('');

    await expect(assertUniqueViolation(db, {
      ipoId: IPO_ID,
      tableName: 'ipo_details',
      fieldName: 'faceValue',
      manifestVersion: 1,
    })).resolves.toBeUndefined();
  });
});

describe.skipIf(!DATABASE_URL)(`ipo_field_plan LIVE constraint shape (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    await pool.end();
  }, 30000);

  it('unique_ipo_field_plan covers exactly (ipo_id, table_name, row_key, field_name) in that order', async () => {
    const { rows } = await pool!.query<{ def: string }>(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'ipo_field_plan'::regclass AND conname = 'unique_ipo_field_plan'
    `);

    expect(rows.length).toBe(1);
    expect(rows[0].def).toBe('UNIQUE (ipo_id, table_name, row_key, field_name)');
  });

  // The four-column constraint is only half the guarantee. Postgres treats NULLs as
  // DISTINCT inside a UNIQUE constraint, so if row_key were ever made nullable a writer
  // passing rowKey: null explicitly could insert unlimited duplicates for the same
  // (ipo, table, field) and every other test here would stay green -- the constraint
  // would still read as present while enforcing nothing for those rows. NOT NULL is what
  // makes the sentinel '' load-bearing, so it is asserted rather than assumed.
  it('row_key is NOT NULL and defaults to the empty sentinel', async () => {
    const { rows } = await pool!.query<{ is_nullable: string; column_default: string | null }>(`
      SELECT is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'ipo_field_plan' AND column_name = 'row_key'
    `);

    expect(rows.length).toBe(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toBe("''::character varying");
  });
});
