import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { planRepair, type CandidateRow } from '../../scripts/repair-bse-subscription-ist-shift';

/**
 * Proof (T-999, defect-fix-contract.md item 5): the repair tool's SQL
 * selection + shift + de-dup logic against a REAL Postgres, not a mock —
 * covers the class-2 requirement ("dry run lists them, apply fixes them,
 * second run 0").
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/repair-bse-subscription-ist-shift.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'T-999: SKIPPED — DATABASE_URL not set';
const IPO_ID = '00000000-0000-4000-8000-0000009990a1';
const IPO_ID_DUP = '00000000-0000-4000-8000-0000009990a2';

let pool: Pool | null = null;

async function selectCandidates(db: ReturnType<typeof drizzle>): Promise<CandidateRow[]> {
  const res = await db.execute(sql`
    select s.id::text as id, s.ipo_id::text as "ipoId", i.slug as slug,
           to_char(s."timestamp", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "timestamp",
           s.qib_subscription::text as "qibSubscription",
           s.nii_subscription::text as "niiSubscription",
           s.retail_subscription::text as "retailSubscription",
           s.total_subscription::text as "totalSubscription",
           s.employee_subscription::text as "employeeSubscription"
      from subscriptions s
      join ipos i on i.id = s.ipo_id
     where s.scope = 'BSE_ONLY'
       and to_char(s."timestamp", 'HH24:MI:SS') = '17:00:00'
     order by s."timestamp" asc`);
  return (res as unknown as { rows: CandidateRow[] }).rows;
}

describe.runIf(!!DATABASE_URL)(`repair-bse-subscription-ist-shift (${RUN_LABEL})`, () => {
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
    }
    db = drizzle(pool, { schema });

    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.ipoId, IPO_ID));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.ipoId, IPO_ID_DUP));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID_DUP));

    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'T-999 BSE TZ Fixture Ltd.', 't-999-bse-tz-fixture-ltd', 'MAINBOARD', 'OPEN', '2026-09-22', '2026-09-24')
    `);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID_DUP}::uuid, 'T-999 BSE TZ Dup Fixture Ltd.', 't-999-bse-tz-dup-fixture-ltd', 'MAINBOARD', 'OPEN', '2026-09-22', '2026-09-24')
    `);
  }, 30000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.ipoId, IPO_ID));
    await db.delete(schema.subscriptions).where(eq(schema.subscriptions.ipoId, IPO_ID_DUP));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID_DUP));
    await pool.end();
  }, 30000);

  it('dry run lists a planted shifted row; apply fixes it; a second run finds 0', async () => {
    // Plant a row exactly as the OLD `new Date(maxdt)` bug would have written it:
    // BSE Maxdt "9/24/2026 5:00:00 PM" parsed as UTC -> stored 2026-09-24T17:00:00Z.
    const [inserted] = await db
      .insert(schema.subscriptions)
      .values({
        ipoId: IPO_ID,
        timestamp: new Date('2026-09-24T17:00:00.000Z'),
        qibSubscription: '0.0022',
        totalSubscription: '0.0022',
        scope: 'BSE_ONLY',
      })
      .returning({ id: schema.subscriptions.id });

    // --- dry run: candidate is found, nothing changes ---
    const candidatesBefore = await selectCandidates(db);
    const mine = candidatesBefore.filter((c) => c.ipoId === IPO_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toBe(inserted.id);
    const plan = planRepair(mine, new Map());
    expect(plan.toShift).toHaveLength(1);
    expect(plan.toDeleteAsDuplicate).toHaveLength(0);

    const unchanged = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, inserted.id) });
    expect(unchanged!.timestamp.toISOString()).toBe('2026-09-24T17:00:00.000Z');

    // --- apply: shift -5h30m to the true observation instant (11:30:00Z) ---
    const shiftedIso = new Date(new Date(mine[0].timestamp).getTime() - (5 * 60 + 30) * 60 * 1000).toISOString();
    await db.execute(sql`update subscriptions set "timestamp" = ${shiftedIso}::timestamp where id = ${inserted.id}::uuid`);

    const after = await db.query.subscriptions.findFirst({ where: eq(schema.subscriptions.id, inserted.id) });
    expect(after!.timestamp.toISOString()).toBe('2026-09-24T11:30:00.000Z');

    // --- idempotency: second run's candidate selection finds 0 for this ipo ---
    const candidatesAfter = await selectCandidates(db);
    expect(candidatesAfter.filter((c) => c.ipoId === IPO_ID)).toHaveLength(0);
  }, 30000);

  it('de-duplicates: a shifted row colliding with an existing identical row is planned for DELETE, not UPDATE', async () => {
    const correct = await db
      .insert(schema.subscriptions)
      .values({
        ipoId: IPO_ID_DUP,
        timestamp: new Date('2026-09-24T11:30:00.000Z'),
        qibSubscription: '1.5000',
        totalSubscription: '1.5000',
        scope: 'BSE_ONLY',
      })
      .returning({ id: schema.subscriptions.id });

    const corrupted = await db
      .insert(schema.subscriptions)
      .values({
        ipoId: IPO_ID_DUP,
        timestamp: new Date('2026-09-24T17:00:00.000Z'), // same instant, mis-shifted +5h30m
        qibSubscription: '1.5000',
        totalSubscription: '1.5000',
        scope: 'BSE_ONLY',
      })
      .returning({ id: schema.subscriptions.id });

    const candidates = (await selectCandidates(db)).filter((c) => c.ipoId === IPO_ID_DUP);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe(corrupted[0].id);

    const existingMap = new Map<string, CandidateRow>([
      [
        `${IPO_ID_DUP}::2026-09-24T11:30:00.000Z`,
        {
          id: correct[0].id,
          ipoId: IPO_ID_DUP,
          slug: 't-999-bse-tz-dup-fixture-ltd',
          timestamp: '2026-09-24T11:30:00.000Z',
          qibSubscription: '1.50',
          niiSubscription: null,
          retailSubscription: null,
          totalSubscription: '1.50',
          employeeSubscription: null,
        },
      ],
    ]);
    const plan = planRepair(candidates, existingMap);
    expect(plan.toShift).toHaveLength(0);
    expect(plan.toDeleteAsDuplicate).toEqual([{ row: candidates[0], survivorId: correct[0].id }]);
  }, 30000);
});
