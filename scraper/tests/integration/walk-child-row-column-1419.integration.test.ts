// implements: #1419 -- the field-plan walk's child-table write must land the COLUMN value, not only field_sources
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports (worktree junction can resolve the alias to the primary checkout).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';
import { getTestDb, cleanupTestDb } from '../test-utils/db';

/**
 * #1419 class: every child-table field (ipo_details here) supplied by the walk from a rank-1 source.
 * The REAL walk entry (walkFieldPlanForIPO) drives the REAL DataConsolidationOrchestrator; the assertion
 * reads the COLUMN in ipo_details, never only field_sources.
 *
 * Flags bake at import, so env is set first and the production modules are imported dynamically.
 */
process.env.ENABLE_POLICY_WRITER = 'true';
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const IPO_ID = '00000000-0000-4000-8000-000000001419';
const SLUG = 'walk-child-row-column-1419';

const VALUES: Record<string, unknown> = {
  'ipo_details.issue_type': 'BOOK_BUILDING',
  'ipo_valuation.pe_at_cap': '42.50',
  'anchor_investors.anchor_investors_count': 17,
};
const nseFetcher: FieldFetcher = async (_ipoId, tableName, _rowKey, fieldName) => ({
  outcome: 'SUPPLIED',
  value: VALUES[`${tableName}.${fieldName}`],
  documentType: undefined,
  page: undefined,
});

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)('#1419: walk child-row write lands the ipo_details column', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let redis: Redis;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: FieldPlanWalkOrchestrator;
  let walkFieldPlanForIPO: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;

  async function wipe() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, IPO_ID));
    await db.delete(schema.ipoValuation).where(eq(schema.ipoValuation.ipoId, IPO_ID));
    await db.delete(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO_ID));
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
    ) as unknown as FieldPlanWalkOrchestrator;
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
      VALUES (${IPO_ID}::uuid, 'Walk Child Row 1419 Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
    await plant('ipo_details', '', 'issue_type');
  });

  async function plant(tableName: string, rowKey: string, fieldName: string) {
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName,
      rowKey,
      fieldName,
      rank1Source: 'NSE',
      state: 'PENDING',
      manifestVersion: 1,
      nextDueAt: null,
    } as never);
  }

  function deps() {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { NSE: nseFetcher },
      ipoRepository: {
        findById: async (id: string) => {
          const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
          return row ?? null;
        },
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['NSE'],
        documentType: undefined,
        origin: { kind: 'registry' as const, version: 1 },
        na: false,
      })) as never,
    };
  }

  async function readColumn() {
    const rows = await db
      .select({ issueType: schema.ipoDetails.issueType })
      .from(schema.ipoDetails)
      .where(eq(schema.ipoDetails.ipoId, IPO_ID));
    return rows;
  }

  it('existing ipo_details row: a rank-1 NSE issue_type is stored in the COLUMN, not only in field_sources', async () => {
    await db.insert(schema.ipoDetails).values({
      ipoId: IPO_ID,
      dataSource: 'NSE',
      issueType: 'FIXED_PRICE',
    } as never);

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);

    const provenance = await db.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    expect(provenance.some((r) => r.tableName === 'ipo_details' && r.fieldName === 'issueType' && r.source === 'NSE')).toBe(true);

    const rows = await readColumn();
    expect(rows).toHaveLength(1);
    expect(rows[0].issueType).toBe('BOOK_BUILDING');
  });

  it('no ipo_details row yet: the rank-1 value creates the row with the column set', async () => {
    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);

    const rows = await readColumn();
    expect(rows).toHaveLength(1);
    expect(rows[0].issueType).toBe('BOOK_BUILDING');
  });

  it('a second child table (ipo_valuation, keyed by pricing event): the value lands in ITS column on the keyed row', async () => {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await plant('ipo_valuation', 'PRICE_BAND_AD', 'pe_at_cap');

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);

    const rows = await db
      .select({ pricingEvent: schema.ipoValuation.pricingEvent, peAtCap: schema.ipoValuation.peAtCap })
      .from(schema.ipoValuation)
      .where(eq(schema.ipoValuation.ipoId, IPO_ID));
    expect(rows).toEqual([{ pricingEvent: 'PRICE_BAND_AD', peAtCap: '42.50' }]);
    const provenance = await db.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    expect(provenance.filter((r) => r.tableName === 'ipo_valuation').map((r) => [r.rowKey, r.fieldName, r.source])).toEqual([
      ['PRICE_BAND_AD', 'peAtCap', 'NSE'],
    ]);
  });

  it('existing anchor_investors row: the walk value lands in the COLUMN', async () => {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await plant('anchor_investors', '', 'anchor_investors_count');
    await db.insert(schema.anchorInvestors).values({
      ipoId: IPO_ID,
      bidDate: '2026-09-13',
      totalSharesOffered: 1000,
      totalAmountRaised: '100.00',
      anchorInvestorsCount: 3,
      lockIn50PercentDate: '2026-10-13',
      lockInRemainingDate: '2026-12-13',
    } as never);

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);
    const rows = await db
      .select({ n: schema.anchorInvestors.anchorInvestorsCount })
      .from(schema.anchorInvestors)
      .where(eq(schema.anchorInvestors.ipoId, IPO_ID));
    expect(rows).toEqual([{ n: 17 }]);
  });

  it('no anchor_investors row and no way to create one: refused BEFORE provenance (no field_sources row, no SUPPLIED)', async () => {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await plant('anchor_investors', '', 'anchor_investors_count');

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(0);
    const provenance = await db.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    expect(provenance.filter((r) => r.tableName === 'anchor_investors')).toEqual([]);
    const rows = await db.select().from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO_ID));
    expect(rows).toEqual([]);
  });
});
