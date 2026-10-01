// implements: #1379 round 2 -- spec data-sourcing-pull-model.md §5.3 rule 4: "the pull loop then asks rank 2
// for the dropped field" for EVERY write-time refusal, not only an OD-21 rule. Here: the matrix-bounds refusal
// (VALIDATION_FAILED, data-consolidation-service.ts runPreRankChecks step 3), which runs in production with NO
// flag. The REAL DataConsolidationOrchestrator + the REAL claim SQL on ipodhan_test; ENABLE_FIELD_EXTRACTION_VALIDATION
// is left at its default (OFF) and asserted OFF, so the OD-21 gate cannot be what refuses.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias (worktree junction guard, as the sibling walk tests).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import type { FieldFetcher } from '../../src/services/field-plan-walk.js';

// Flags bake at import (see field-plan-walk-real-writer.integration.test.ts): set BEFORE the dynamic imports.
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : '#1379: SKIPPED -- DATABASE_URL not set';
const IPO = '00000000-0000-4000-8000-000000137902';
const SLUG = 'zzq1379-matrix-bounds-flag-off-testco';

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe.skipIf(!DATABASE_URL)(`#1379 r2 matrix-bounds refusal, flag OFF -> rank 2 in the same pass, real orchestrator + claim SQL (${RUN_LABEL})`, () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const cur = (await pool.query('select current_database() AS d')).rows[0].d as string;
    if (cur !== 'ipodhan_test') throw new Error(`Refusing to run against ${cur}; ipodhan_test only`);
    db = drizzle(pool, { schema });
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags.js');
    expect((FEATURE_FLAGS as Record<string, unknown>).ENABLE_FIELD_EXTRACTION_VALIDATION).toBeFalsy();
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    const { DataConsolidationService } = await import('../../src/services/data-consolidation-service.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    const fieldSources = new FieldSourcesRepository(db as never, noRedis as never);
    const conflicts = new DataConflictsRepository(db as never, noRedis as never);
    orchestrator = new DataConsolidationOrchestrator(new IPORepository(db as never, noRedis as never), fieldSources, conflicts, null);
    planRepo = new IpoFieldPlanRepository(db as never, noRedis as never);
    const { buildFieldPlanGapKeySource } = await import('../../src/services/field-plan-walk-deps.js');
    gapKeys = buildFieldPlanGapKeySource({ fetchers: {}, extractorVersion: 'x1', redis: noRedis as never });
  }, 60000);

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
  }

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: 'Zzq1379 Matrix Bounds Flag Off Testco Limited', slug: SLUG,
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', sector: 'Technology',
    } as never);
  });

  async function seedPlan(ranks: string[]): Promise<string> {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName: 'face_value',
        rank1Source: ranks[0], rank2Source: ranks[1] ?? null, state: 'PENDING', manifestVersion: 2, nextDueAt: null,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  /** The PRODUCTION key source (field-plan-walk-deps.ts): the IPO's stage read from its row, the real manifest. */
  let gapKeys: { forIpo(ipoId: string): Promise<unknown> };

  function deps(ranks: string[], answers: Record<string, unknown>) {
    const fetchers: Record<string, FieldFetcher> = {};
    for (const [src, value] of Object.entries(answers)) {
      fetchers[src] = vi.fn(async () =>
        value === 'NOT_PRINTED' ? ({ outcome: 'NOT_PRINTED' } as never) : ({ outcome: 'SUPPLIED', value, documentType: undefined, page: undefined } as never)
      );
    }
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: fetchers,
      gapKeys,
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({ ranks, documentType: undefined, origin: { kind: 'registry', version: 2 }, na: false })) as never,
      fetchers,
    };
  }
  const budget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });

  async function readAll(planId: string) {
    const [plan] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, planId));
    const [ipo] = await db.select({ faceValue: schema.ipos.faceValue }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    return { plan, faceValue: ipo?.faceValue ?? null };
  }

  /** (unused here) "The next data slot": push the row's last attempt before the most recent slot boundary. */
  async function ageLastAttempt(planId: string) {
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = now() - interval '2 days' WHERE id = ${planId}::uuid`);
  }

  it('NSE face_value 20000 breaks the matrix bound (max 10000): VALIDATION_FAILED refuses it, BSE 10 is written in the SAME pass', async () => {
    const id = await seedPlan(['NSE', 'BSE']);
    const d = deps(['NSE', 'BSE'], { NSE: 20000, BSE: 10 });
    const result = await walk(IPO, d as never, budget());
    const { plan, faceValue } = await readAll(id);
    expect(d.fetchers.NSE).toHaveBeenCalledTimes(1);
    expect(result.fieldsSupplied).toBe(1);
    expect(plan.state).toBe('SUPPLIED');
    expect(plan.chosenSource).toBe('BSE');
    expect(plan.chosenRank).toBe(2);
    expect(Number(faceValue)).toBe(10);
  });

  it('control, a real priority loss: a stored DRHP value outranks NSE -> LOST_TO_HIGHER_PRIORITY, BSE is not written', async () => {
    await db.update(schema.ipos).set({ faceValue: '5' } as never).where(eq(schema.ipos.id, IPO));
    await db.insert(schema.fieldSources).values({
      ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName: 'faceValue', source: 'DRHP', value: '5',
    } as never);
    const id = await seedPlan(['NSE', 'BSE']);
    await walk(IPO, deps(['NSE', 'BSE'], { NSE: 2, BSE: 10 }) as never, budget());
    const { plan, faceValue } = await readAll(id);
    expect(plan.reasonCode).toBe('LOST_TO_HIGHER_PRIORITY');
    expect(Number(faceValue)).toBe(5);
  });
});
