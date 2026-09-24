// implements: OD-99 -- a structural write refusal is recorded, never silently
// re-queued; an answer equal to the stored value is SUPPLIED with no write
// (design §2.4, §2.5.1, OD-62, OD-73, OD-78)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports, NOT the `@ipodhan/shared` alias (worktree junction guard,
// same as field-plan-walk-real-writer.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { buildFieldPlanIpoGapKeys, fieldPlanClaimGapKeys } from '../../src/services/field-plan-gap-keys.js';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * The class (measured on staging 2026-09-25, PR #1019's failure class
 * `dropped-write-strands-a-plan-row-pending`): a plan row whose fetcher
 * answers SUPPLIED but whose write the consolidated writer refuses for a
 * STRUCTURAL reason (MISSING_ROW_KEY, CHILD_TABLE_CONSOLIDATION_DISABLED,
 * CONSOLIDATION_DISABLED) was put back PENDING with attempts and
 * last_attempt_at untouched, so it was claimed first on every wake forever.
 *
 * (i)   gmp_records.gmp: the INVESTORGAIN_GMP fetcher answers the value the
 *       GMP job already stored -> SUPPLIED, chosen_source INVESTORGAIN_GMP,
 *       and ZERO gmp_records rows added (OD-73).
 * (ii)  a structural refusal (the REAL orchestrator's MISSING_ROW_KEY) ->
 *       CHECK_FAILED, gap WRITER_CANNOT_ACCEPT, attempts +1, and the next
 *       claim call does not return it.
 * (iii) a transient drop (LOCK_NOT_ACQUIRED) -> PENDING, attempts untouched.
 * (iv)  the (ii) row is offered again once the writer's capability changes.
 *
 * Flags bake at import (see field-plan-walk-real-writer's header), so the
 * production modules are imported dynamically after the env below is set.
 * SKIPS when DATABASE_URL is unset -- read the test COUNT, not the exit code.
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
const RUN_LABEL = DATABASE_URL ? 'live' : 'OD-99: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-000000000099';
const SLUG = 'od99-structural-write-drop-fixture';
// ipodhan_test still has the pre-ALTER integer gmp column (schema.ts B2/G14 note), so a whole number.
const STORED_GMP = 42;

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

type WalkFn = typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
type BuildGmpFetcherFn = typeof import('../../src/services/field-plan-walk-investorgain-gmp-fetcher.js').buildInvestorgainGmpFetcher;

describe.skipIf(!DATABASE_URL)(`OD-99: structural write refusals and equal answers (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let redis: Redis | null = null;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let realOrchestrator: FieldPlanWalkOrchestrator;
  let walkFieldPlanForIPO: WalkFn;
  let buildInvestorgainGmpFetcher: BuildGmpFetcherFn;

  const manifestFields = {
    'gmp_records.gmp': { ranks: ['INVESTORGAIN_GMP', 'CHITTORGARH'] },
  } as never;

  function gapKeysWith(writerCapability: string) {
    return buildFieldPlanIpoGapKeys({
      manifestFields,
      coverageFingerprint: 'cov',
      extractorVersion: 'x1',
      documents: [],
      writerCapability: () => writerCapability,
    });
  }

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
    }
    db = drizzle(pool, { schema });
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();

    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));
    ({ buildInvestorgainGmpFetcher } = await import('../../src/services/field-plan-walk-investorgain-gmp-fetcher.js'));
    realOrchestrator = new DataConsolidationOrchestrator(
      new IPORepository(db as never, redis as never),
      new FieldSourcesRepository(db as never, redis as never),
      new DataConflictsRepository(db as never, redis as never),
      redis as never
    ) as unknown as FieldPlanWalkOrchestrator;
    planRepo = new IpoFieldPlanRepository(db as never, redis as never);
  }, 60000);

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.gmpRecords).where(eq(schema.gmpRecords.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  }

  afterAll(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await cleanup();
    if (redis) {
      const keys = await redis.keys(`*${IPO_ID}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'OD-99 Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-24', '2026-09-26')
    `);
    await db.execute(sql`
      INSERT INTO gmp_records (ipo_id, timestamp, gmp, source)
      VALUES (${IPO_ID}::uuid, ${new Date('2026-09-25T04:00:00Z').toISOString()}, ${STORED_GMP}, 'INVESTORGAIN_GMP')
    `);
  });

  async function seedGmpPlanRow(): Promise<string> {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'gmp_records',
        rowKey: '',
        fieldName: 'gmp',
        rank1Source: 'INVESTORGAIN_GMP',
        state: 'PENDING',
        manifestVersion: 1,
        nextDueAt: null,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  const readPlanRow = async (id: string) =>
    (await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id)))[0];
  const countGmpRows = async () =>
    Number((await pool!.query('SELECT count(*)::int AS n FROM gmp_records WHERE ipo_id = $1', [IPO_ID])).rows[0].n);

  const gmpReader = {
    async findLatestFromInvestorGain(ipoId: string) {
      const rows = await db
        .select({ id: schema.gmpRecords.id, gmp: schema.gmpRecords.gmp, timestamp: schema.gmpRecords.timestamp })
        .from(schema.gmpRecords)
        .where(and(eq(schema.gmpRecords.ipoId, ipoId), eq(schema.gmpRecords.source, 'INVESTORGAIN_GMP')))
        .orderBy(desc(schema.gmpRecords.timestamp))
        .limit(1);
      return rows[0] ?? null;
    },
  };

  function deps(fetcher: FieldFetcher, orchestrator: FieldPlanWalkOrchestrator, writerCapability = 'w-A') {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { INVESTORGAIN_GMP: fetcher },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['INVESTORGAIN_GMP'],
        documentType: undefined,
        origin: { kind: 'registry' as const, version: 1 },
        na: false,
      })) as never,
      gapKeys: { forIpo: async () => gapKeysWith(writerCapability) },
    };
  }

  it('(i) the GMP fetcher answers the stored value: SUPPLIED from INVESTORGAIN_GMP, zero gmp_records rows written', async () => {
    const id = await seedGmpPlanRow();
    const before = await countGmpRows();
    const fetcher = buildInvestorgainGmpFetcher({ gmpReader, isInvestorgainGmpCapable: () => true });

    const result = await walkFieldPlanForIPO(IPO_ID, deps(fetcher, realOrchestrator) as never, openBudget());

    const row = await readPlanRow(id);
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenSource).toBe('INVESTORGAIN_GMP');
    expect(row.chosenRank).toBe(1);
    expect(row.attempts).toBe(1);
    expect(row.claimToken).toBeNull();
    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsWriteSkipped).toBe(0);
    expect(before).toBe(1);
    expect(await countGmpRows()).toBe(1);
  });

  it('(ii) a structural refusal (real MISSING_ROW_KEY) is CHECK_FAILED under a WRITER_CANNOT_ACCEPT gap key, charged, and not claimed again', async () => {
    const id = await seedGmpPlanRow();
    // A value the writer must actually be asked to write (no stored value declared).
    const fetcher: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 55 });

    const result = await walkFieldPlanForIPO(IPO_ID, deps(fetcher, realOrchestrator) as never, openBudget());

    const row = await readPlanRow(id);
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.attempts).toBe(1);
    expect(row.lastAttemptAt).not.toBeNull();
    expect(row.nextDueAt).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(row.reasonCode).toBe('COVERAGE_GAP');
    expect(row.cause).toContain('MISSING_ROW_KEY');
    expect(row.cause).toContain('[gap:WRITER_CANNOT_ACCEPT]');
    expect(row.cause?.startsWith(`[gap-key:${gapKeysWith('w-A').byField['gmp_records.gmp'].withWriter}]`)).toBe(true);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsWriteSkipped).toBe(0);
    expect(await countGmpRows()).toBe(1);

    const again = await planRepo.claimNextDueField({ ipoId: IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-A')) });
    expect(again).toBeNull();
  });

  it('(iii) a transient drop (LOCK_NOT_ACQUIRED) is still re-queued PENDING with attempts untouched', async () => {
    const id = await seedGmpPlanRow();
    const fetcher: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 55 });
    const lockLost = {
      consolidatedUpsertIPO: async () => ({ ipoId: '', isNew: false, locked: false, skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' }),
      consolidatedUpsertChildRows: async () => {
        throw new Error('LOCK_NOT_ACQUIRED: lock lost mid-flight');
      },
    } as unknown as FieldPlanWalkOrchestrator;

    const result = await walkFieldPlanForIPO(IPO_ID, deps(fetcher, lockLost) as never, openBudget());

    const row = await readPlanRow(id);
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(0);
    expect(row.lastAttemptAt).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(result.fieldsWriteSkipped).toBe(1);
    expect(result.droppedWrites[0].skipReason).toContain('LOCK_NOT_ACQUIRED');
  });

  it('(iv) the structural row is offered again when the writer capability in its gap key changes', async () => {
    const id = await seedGmpPlanRow();
    const fetcher: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 55 });
    await walkFieldPlanForIPO(IPO_ID, deps(fetcher, realOrchestrator, 'w-A') as never, openBudget());
    expect((await readPlanRow(id)).state).toBe('CHECK_FAILED');

    const sameKey = await planRepo.claimNextDueField({ ipoId: IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-A')) });
    expect(sameKey).toBeNull();

    const reopened = await planRepo.claimNextDueField({ ipoId: IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-B')) });
    expect(reopened?.id).toBe(id);
    await planRepo.releaseClaimUnrecorded({ planRowId: id, claimToken: reopened!.claimToken as string });
  });
});
