import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports (the sibling walk integration files' convention).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import {
  writeAdminFieldValue,
  readAdminFieldVersion,
  type AdminFieldWriteInput,
} from '../../../packages/shared/src/services/admin-field-write';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * §2.4 clarification ("'skip' ... means 'never WRITE', not 'never read'"), §9.2 items 9 and 19,
 * OD-103, OD-106. An admin holds `ipos.issue_size` through the REAL admin write path; a walk pass
 * with the PRODUCTION hold deps (`buildFieldPlanWalkHoldDeps`: the protection read and the
 * witnesses-only update) must ask the field's sources, record their answers as witnesses on the
 * ADMIN field_sources row, and write NOTHING: `ipos` keeps the admin value, field_sources keeps
 * source ADMIN and its time, the plan row keeps its state and attempts (never SUPPLIED by a
 * source), and the read is stamped so the very next wake does not ask again.
 *
 * Runs only against `ipodhan_test` (refuses any other database).
 */
process.env.ENABLE_VERDICT_WRITER = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const IPO_ID = '00000000-0000-4000-8000-00000000b1d9';
const SLUG = 'held-field-read-proof-ipo';
const ADMIN_VALUE = '1230000000';
const DOC_VALUE = 300_000_000;

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)('an admin-held field is read, never written (§2.4 clarification, ipodhan_test)', () => {
  let pool: Pool;
  let redis: Redis;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let planRepo: IpoFieldPlanRepository;
  let walkFieldPlanForIPO: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let buildFieldPlanWalkHoldDeps: typeof import('../../src/services/field-plan-walk-deps.js').buildFieldPlanWalkHoldDeps;

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO_ID]));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
    const keys = await redis.keys(`*${IPO_ID}*`);
    if (keys.length > 0) await redis.del(...keys);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const current = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));
    ({ buildFieldPlanWalkHoldDeps } = await import('../../src/services/field-plan-walk-deps.js'));
    planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await cleanup();
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO_ID}::uuid, 'Held Field Read Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Proof Registrar Ltd', 'Proof Sector')`);
  });

  it('asks the sources, stores their answers as witnesses on the ADMIN row, writes no value, keeps the plan state', async () => {
    // 1. The admin holds the field through the real admin write path.
    const v = await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'issueSize');
    const input: AdminFieldWriteInput = {
      ipoId: IPO_ID,
      tableName: 'ipos',
      fieldName: 'issueSize',
      value: ADMIN_VALUE,
      mode: { kind: 'typed', sourceNote: 'RHP page 7' },
      expectedVersion: v!.version,
      actor: { name: 'held-read-test-admin', adminId: 'admin-held-read-it' },
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    };
    const saved = await writeAdminFieldValue(db as never, input);
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');
    const [adminRowBefore] = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.fieldName, 'issueSize')));
    expect(adminRowBefore?.source).toBe('ADMIN');
    const tokenBefore = (await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'issueSize'))!.version;

    // 2. A due plan row for the held field.
    const [plan] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'issue_size',
        rank1Source: 'DOC',
        rank2Source: 'CHITTORGARH',
        state: 'PENDING',
        manifestVersion: 2,
        nextDueAt: null,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });

    // 3. One walk pass with the production hold deps. The sources DISAGREE with the admin.
    let docCalls = 0;
    let cgCalls = 0;
    const doc: FieldFetcher = async () => {
      docCalls += 1;
      return { outcome: 'SUPPLIED', value: DOC_VALUE, documentType: 'RHP' };
    };
    const cg: FieldFetcher = async () => {
      cgCalls += 1;
      return { outcome: 'NOT_PRINTED' };
    };
    const writes: unknown[] = [];
    const orchestrator = {
      consolidatedUpsertIPO: async (...args: unknown[]) => {
        writes.push(args);
        throw new Error('a held field must never reach the writer');
      },
      consolidatedUpsertChildRows: async (...args: unknown[]) => {
        writes.push(args);
        throw new Error('a held field must never reach the writer');
      },
    } as unknown as FieldPlanWalkOrchestrator;
    const deps = {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: doc, CHITTORGARH: cg },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['DOC', 'CHITTORGARH'],
        documentType: 'PRICE_BAND_AD' as const,
        origin: { kind: 'registry' as const, version: 2 },
        na: false,
      })) as never,
      ...buildFieldPlanWalkHoldDeps(redis as never),
    };

    const result = await walkFieldPlanForIPO(IPO_ID, deps, openBudget());

    expect(result.fieldsSkippedProtected).toBe(1);
    expect(result.fieldsAttempted).toBe(0);
    expect(docCalls).toBe(1);
    expect(cgCalls).toBe(1);
    expect(writes).toHaveLength(0);

    // ipos value unchanged.
    const [ipo] = await db.select({ issueSize: schema.ipos.issueSize }).from(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    expect(Number(ipo.issueSize)).toBe(Number(ADMIN_VALUE));

    // field_sources: still ADMIN, same attribution and time; witnesses hold the sources' answers.
    const [adminRowAfter] = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.fieldName, 'issueSize')));
    expect(adminRowAfter.source).toBe('ADMIN');
    expect(adminRowAfter.updatedAt?.getTime()).toBe(adminRowBefore.updatedAt?.getTime());
    expect(adminRowAfter.updatedBy).toBe(adminRowBefore.updatedBy);
    expect(adminRowAfter.dataLineage).toEqual(adminRowBefore.dataLineage);
    const witnesses = adminRowAfter.witnesses as Array<{ source: string; value: unknown; outcome?: string }>;
    expect(witnesses.map((w) => [w.source, w.outcome, w.value])).toEqual([
      ['DOC', 'SUPPLIED', DOC_VALUE],
      ['CHITTORGARH', 'NOT_PRINTED', null],
    ]);
    // Tier A MINOR-1: the walk refreshed the witnesses without moving updated_at, and the admin
    // version token still changes, so a pick made from the witnesses shown before is refused as stale.
    const tokenAfter = (await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'issueSize'))!.version;
    expect(tokenAfter).not.toBe(tokenBefore);
    const fsCount = await db.select({ id: schema.fieldSources.id }).from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    expect(fsCount).toHaveLength(1);

    // Plan row: state and attempts untouched, no source recorded as the supplier, read stamped.
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(0);
    expect(row.chosenSource).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.lastAttemptAt).not.toBeNull();
    // Tier A MAJOR-1: the row LEAVES the slot cadence (no next-slot due): the stamp carries the
    // IPO's read context (stage | completed documents), and only a change of it makes the row due.
    expect(row.nextDueAt).toBeNull();
    expect(row.cause).toBe('[held-read:UPCOMING|0]');

    // 4. The next wake (same slot) does not ask the held field again.
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    expect(docCalls).toBe(1);
    expect(cgCalls).toBe(1);

    // 5. Several slots later (the read backdated three days; a next-slot due would be long past):
    //    still not asked. §2.4: "No extra read is scheduled for a held field (OD-65)".
    const backdate = async () =>
      db.execute(sql`
        UPDATE ipo_field_plan
           SET last_attempt_at = now() - interval '3 days',
               next_due_at = CASE WHEN next_due_at IS NULL THEN NULL ELSE now() - interval '2 days' END
         WHERE id = ${plan.id}::uuid`);
    await backdate();
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    expect(docCalls).toBe(1);

    // 6. A stage change (OD-56) reopens it: asked exactly once more, then quiet again.
    await db.execute(sql`UPDATE ipos SET status = 'OPEN' WHERE id = ${IPO_ID}::uuid`);
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    expect(docCalls).toBe(2);
    const [afterStage] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(afterStage.cause).toBe('[held-read:OPEN|0]');
    expect(afterStage.state).toBe('PENDING');
    expect(afterStage.attempts).toBe(0);
    await backdate();
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    expect(docCalls).toBe(2);

    // 7. A new COMPLETED document (OD-66) reopens it: asked exactly once more.
    await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status)
      VALUES (${IPO_ID}::uuid, 'RHP', 'Held read proof RHP', 'https://example.invalid/rhp.pdf', 'COMPLETED')`);
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    await walkFieldPlanForIPO(IPO_ID, deps, openBudget());
    expect(docCalls).toBe(3);
    const [afterDoc] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(afterDoc.cause).toBe('[held-read:OPEN|1]');
    expect(cgCalls).toBe(3);
  }, 60000);
});
