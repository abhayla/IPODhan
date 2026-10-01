// implements: #1379 -- spec data-sourcing-pull-model.md §5.3 rule 4 (OD-21) "the pull loop then asks rank 2
// for the dropped field", rule 5 "never on a backoff timer"; OD-62 (FAILED_VALIDATION = fix the extractor,
// not ask again); OD-56 (a stage change is the event that re-reads).
// The REAL DataConsolidationOrchestrator + the REAL ipo_field_plan claim SQL on ipodhan_test, with the
// ENABLE_FIELD_EXTRACTION_VALIDATION gate ON in this test only (its default stays off). The failures
// repository is injected into the orchestrator's service here; on main that wiring is #1370 / PR #1382.
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
import { FieldExtractionFailuresRepository } from '../../../packages/shared/src/repositories/field-extraction-failures-repository';
import type { FieldFetcher } from '../../src/services/field-plan-walk.js';

// Flags bake at import (see field-plan-walk-real-writer.integration.test.ts): set BEFORE the dynamic imports.
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : '#1379: SKIPPED -- DATABASE_URL not set';
const IPO = '00000000-0000-4000-8000-000000137901';
const SLUG = 'zzq1379-rank-two-after-refusal-testco';

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe.skipIf(!DATABASE_URL)(`#1379 refused rank 1 -> rank 2 in the same pass, real orchestrator + claim SQL (${RUN_LABEL})`, () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let savedGate: unknown;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const cur = (await pool.query('select current_database() AS d')).rows[0].d as string;
    if (cur !== 'ipodhan_test') throw new Error(`Refusing to run against ${cur}; ipodhan_test only`);
    db = drizzle(pool, { schema });
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags.js');
    savedGate = (FEATURE_FLAGS as Record<string, unknown>).ENABLE_FIELD_EXTRACTION_VALIDATION;
    (FEATURE_FLAGS as Record<string, unknown>).ENABLE_FIELD_EXTRACTION_VALIDATION = true;
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    const { DataConsolidationService } = await import('../../src/services/data-consolidation-service.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    const fieldSources = new FieldSourcesRepository(db as never, noRedis as never);
    const conflicts = new DataConflictsRepository(db as never, noRedis as never);
    orchestrator = new DataConsolidationOrchestrator(new IPORepository(db as never, noRedis as never), fieldSources, conflicts, null);
    // The failures repository, as #1370's factory gives it (absent, the OD-21 gate does not run at all).
    orchestrator.consolidationService = new DataConsolidationService(
      fieldSources,
      conflicts,
      undefined,
      new FieldExtractionFailuresRepository(db as never, noRedis as never) as never
    );
    planRepo = new IpoFieldPlanRepository(db as never, noRedis as never);
    const { buildFieldPlanGapKeySource } = await import('../../src/services/field-plan-walk-deps.js');
    gapKeys = buildFieldPlanGapKeySource({ fetchers: {}, extractorVersion: 'x1', redis: noRedis as never });
  }, 60000);

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
    await db.delete(schema.fieldExtractionFailures).where(eq(schema.fieldExtractionFailures.ipoId, IPO));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
  }

  afterAll(async () => {
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags.js');
    (FEATURE_FLAGS as Record<string, unknown>).ENABLE_FIELD_EXTRACTION_VALIDATION = savedGate;
    if (db) await cleanup();
    await pool?.end();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: 'Zzq1379 Rank Two After Refusal Testco Limited', slug: SLUG,
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
    const failures = await db.select().from(schema.fieldExtractionFailures).where(eq(schema.fieldExtractionFailures.ipoId, IPO));
    return { plan, faceValue: ipo?.faceValue ?? null, failures };
  }

  /** "The next data slot": push the row's last attempt before the most recent slot boundary. */
  async function ageLastAttempt(planId: string) {
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = now() - interval '2 days' WHERE id = ${planId}::uuid`);
  }

  it('state 1: NSE face_value 3 is refused (face_value_equity_enum), BSE 10 is written in the SAME pass; row SUPPLIED from rank 2', async () => {
    const id = await seedPlan(['NSE', 'BSE']);
    const d = deps(['NSE', 'BSE'], { NSE: 3, BSE: 10 });
    const result = await walk(IPO, d as never, budget());
    const { plan, faceValue, failures } = await readAll(id);
    expect(result.fieldsSupplied).toBe(1);
    expect(plan.state).toBe('SUPPLIED');
    expect(plan.chosenSource).toBe('BSE');
    expect(plan.chosenRank).toBe(2);
    expect(Number(faceValue)).toBe(10);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ ruleId: 'face_value_equity_enum', rankAttempted: 'NSE', extractedValue: '3' });
  });

  it('state 5: the only rank is refused -> CHECK_FAILED / FAILED_VALIDATION, NOT re-asked next slot (no second failure row), re-asked once on a stage change', async () => {
    const id = await seedPlan(['NSE']);
    const d1 = deps(['NSE'], { NSE: 3 });
    await walk(IPO, d1 as never, budget());
    let s = await readAll(id);
    expect(s.plan.state).toBe('CHECK_FAILED');
    expect(s.plan.reasonCode).toBe('FAILED_VALIDATION');
    expect(s.plan.cause).toMatch(/^\[gap-key:.*rank1:NSE:VALIDATION_REFUSED:VALIDATION_RULE_FAILED:face_value_equity_enum/);
    expect(s.plan.attempts).toBe(0);
    expect(s.faceValue).toBeNull();
    expect(s.failures).toHaveLength(1);

    // Next data slot, nothing new: the row is not claimed, rank 1 is not asked, no second failure row.
    await ageLastAttempt(id);
    const d2 = deps(['NSE'], { NSE: 3 });
    await walk(IPO, d2 as never, budget());
    expect(d2.fetchers.NSE).not.toHaveBeenCalled();
    s = await readAll(id);
    expect(s.failures).toHaveLength(1);

    // Stage change (OD-56): the key changes, the row is offered once, the value is validated again.
    await db.update(schema.ipos).set({ status: 'OPEN' } as never).where(eq(schema.ipos.id, IPO));
    const d3 = deps(['NSE'], { NSE: 3 });
    await walk(IPO, d3 as never, budget());
    expect(d3.fetchers.NSE).toHaveBeenCalledTimes(1);
    s = await readAll(id);
    expect(s.plan.state).toBe('CHECK_FAILED');
    expect(s.plan.reasonCode).toBe('FAILED_VALIDATION');
  });

  it('state 3a: rank 2 does not print it -> same parking; a later slot asks neither rank', async () => {
    const id = await seedPlan(['NSE', 'BSE']);
    await walk(IPO, deps(['NSE', 'BSE'], { NSE: 3, BSE: 'NOT_PRINTED' }) as never, budget());
    await ageLastAttempt(id);
    const d2 = deps(['NSE', 'BSE'], { NSE: 3, BSE: 'NOT_PRINTED' });
    await walk(IPO, d2 as never, budget());
    expect(d2.fetchers.NSE).not.toHaveBeenCalled();
    expect(d2.fetchers.BSE).not.toHaveBeenCalled();
    const s = await readAll(id);
    expect(s.plan.reasonCode).toBe('FAILED_VALIDATION');
    expect(s.failures).toHaveLength(1);
  });
});
