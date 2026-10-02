// implements: F-233 -- the field-plan walk writes IPO-level financial_data answers (one row per IPO)
// through the REAL consolidated child writer against ipodhan_test. Spec: OD-73, Appendix A
// financial_data rows (DOC above CHITTORGARH), §2.7, #684.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports (a worktree junction can resolve the alias to the primary checkout).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';
import { getTestDb, cleanupTestDb } from '../test-utils/db';

// Flags bake at import, so env is set first and the production modules are imported dynamically.
process.env.ENABLE_POLICY_WRITER = 'true';
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const IPO_ID = '00000000-0000-4000-8000-000000000233';
const SLUG = 'walk-financial-data-writer-f233';

const docNotAvailable: FieldFetcher = async () => ({ outcome: 'NOT_AVAILABLE_YET' });
const cgMarketCap: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: '4507.61', documentType: undefined, page: undefined });

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)('F-233: walk writes financial_data through the consolidated child writer', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let redis: Redis;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: FieldPlanWalkOrchestrator & { consolidatedUpsertChildRows: (...a: any[]) => Promise<any> };
  let walkFieldPlanForIPO: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;

  async function wipe() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.financialData).where(eq(schema.financialData.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
  }

  beforeAll(async () => {
    db = await getTestDb();
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));
    const dbAny = db as never;
    orchestrator = new DataConsolidationOrchestrator(
      new IPORepository(dbAny, redis as never),
      new FieldSourcesRepository(dbAny, redis as never),
      new DataConflictsRepository(dbAny, redis as never),
      redis as never
    ) as never;
    planRepo = new IpoFieldPlanRepository(dbAny, redis as never);
    await wipe();
  }, 60000);

  afterAll(async () => {
    if (db) await wipe();
    if (redis) await redis.quit();
    await cleanupTestDb();
  }, 60000);

  beforeEach(async () => {
    await wipe();
    const keys = await redis.keys(`*${IPO_ID}*`);
    if (keys.length > 0) await redis.del(...keys);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'Walk Financial Data F233 Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'financial_data',
      rowKey: '',
      fieldName: 'market_cap',
      rank1Source: 'DOC',
      state: 'PENDING',
      manifestVersion: 1,
      nextDueAt: null,
    } as never);
  });

  function deps() {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: docNotAvailable, CHITTORGARH: cgMarketCap },
      ipoRepository: {
        findById: async (id: string) => {
          const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
          return row ?? null;
        },
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['DOC', 'CHITTORGARH'],
        documentType: undefined,
        origin: { kind: 'registry' as const, version: 1 },
        na: false,
      })) as never,
    };
  }

  const readMarketCap = async () =>
    db.select({ marketCap: schema.financialData.marketCap }).from(schema.financialData).where(eq(schema.financialData.ipoId, IPO_ID));
  const provenance = async () =>
    (await db.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID)))
      .filter((r) => r.tableName === 'financial_data')
      .map((r) => [r.rowKey, r.fieldName, r.source]);

  it('empty field, no row: the CHITTORGARH answer creates the row by ipo_id, stored in crore as supplied, with provenance', async () => {
    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);
    expect(await readMarketCap()).toEqual([{ marketCap: '4507.61' }]);
    expect(await provenance()).toEqual([['', 'marketCap', 'CHITTORGARH']]);
  });

  it('a DOC (DRHP) value already stored is NOT replaced by a different CHITTORGARH answer', async () => {
    await orchestrator.consolidatedUpsertChildRows(IPO_ID, 'financial_data', [{ rowKey: '', data: { marketCap: '4000.00' } }], 'DRHP', 'RHP', undefined, {
      writeRow: true,
    });
    expect(await readMarketCap()).toEqual([{ marketCap: '4000.00' }]);

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(0);
    expect(await readMarketCap()).toEqual([{ marketCap: '4000.00' }]);
    expect(await provenance()).toEqual([['', 'marketCap', 'DRHP']]);
  });
});
