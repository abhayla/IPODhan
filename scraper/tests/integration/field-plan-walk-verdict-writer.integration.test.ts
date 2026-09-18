// implements: docs/design/s3b2-verdict-writer-plan.md (S3b-2 -- the comparator decides,
// verdict is written) -- the REAL-DATA proof: one ipos.issue_size row with DOC + CHITTORGARH,
// witnesses populated, verdict matching what the two sources actually said, read back BY
// IDENTITY (not counted).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's node_modules junction can
// resolve the alias back to the PRIMARY checkout, which does not carry this slice's edits (same
// guard as field-plan-walk-real-writer.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';
// FEATURE_FLAGS bakes every flag at module-eval time (same reason
// field-plan-walk-real-writer.integration.test.ts imports the orchestrator/walk dynamically,
// AFTER this file's own process.env lines run) -- a static import here would freeze
// ENABLE_VERDICT_WRITER (and ENABLE_DATA_CONSOLIDATION) before this file's own assignment runs.
type DataConsolidationOrchestratorCtor = typeof import('../../src/services/data-consolidation-orchestrator.js').DataConsolidationOrchestrator;
type WalkFieldPlanForIPOFn = typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;

/**
 * THE PROOF FIELD MUST BE ipos.issue_size WITH DOC + CHITTORGARH -- verified in the manifest
 * this session: rank.MAINBOARD = ['DOC', 'CHITTORGARH'], and NSE is capable:false for this field
 * ("NSE computes (sharesOffered/netOffer) x price, excluding the OFS portion"). A proof built on
 * NSE would be fabricated.
 *
 * WIN: an untracked issue_size (no field_sources row) is SUPPLIED by DOC. The walk asks DOC then
 * CHITTORGARH; both answer SUPPLIED with the SAME value -- the real matrix accepts DOC (no
 * existing provenance to lose to), and with ENABLE_VERDICT_WRITER=true the walk computes
 * CONFIRMED (2 real answers, MONEY family, agree) and writes witnesses=[DOC, CHITTORGARH] onto
 * the SAME field_sources row the consolidator's own write already created.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     REDIS_URL=redis://localhost:6379/15 \
 *     npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-plan-walk-verdict-writer.integration.test.ts
 */

process.env.ENABLE_POLICY_WRITER = 'true';
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
process.env.ENABLE_VERDICT_WRITER = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 's3b2: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-000000005362'; // s3b2 -> 5362, matching the sibling fixtures' digit-encoding convention
const SLUG = 's3b2-verdict-writer-fixture';

const DOC_VALUE = 300_000_000; // Rs 30 Cr -- DOC's answer
const CHITTORGARH_VALUE = 300_000_000; // same value -- the two sources AGREE

const docFetcher: FieldFetcher = async () => ({
  outcome: 'SUPPLIED',
  value: DOC_VALUE,
  documentType: 'PRICE_BAND_AD',
  page: undefined,
});
const chittorgarhFetcher: FieldFetcher = async () => ({
  outcome: 'SUPPLIED',
  value: CHITTORGARH_VALUE,
  documentType: undefined,
  page: undefined,
});

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)(`S3b-2: field-plan walk verdict writer, REAL DataConsolidationOrchestrator (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let redis: Redis | null = null;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: FieldPlanWalkOrchestrator;
  let fieldSourcesRepository: FieldSourcesRepository;
  let walkFieldPlanForIPO: WalkFieldPlanForIPOFn;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(
        `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
          'This integration test only runs against the test database.'
      );
    }
    db = drizzle(pool, { schema });

    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();

    const { DataConsolidationOrchestrator }: { DataConsolidationOrchestrator: DataConsolidationOrchestratorCtor } =
      await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));

    const ipoRepository = new IPORepository(db as never, redis as never);
    fieldSourcesRepository = new FieldSourcesRepository(db as never, redis as never);
    orchestrator = new DataConsolidationOrchestrator(
      ipoRepository,
      fieldSourcesRepository,
      new DataConflictsRepository(db as never, redis as never),
      redis as never
    ) as unknown as FieldPlanWalkOrchestrator;

    planRepo = new IpoFieldPlanRepository(db as never, redis as never);

    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    if (redis) {
      const keys = await redis.keys(`*${IPO_ID}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
  });

  async function seedPlanRow(): Promise<string> {
    const [row] = await db
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
    return row.id;
  }

  function resolvePolicyDocChittorgarh() {
    // Matches the REAL manifest row for ipos.issue_size on MAINBOARD (verified this session):
    // rank.MAINBOARD = ['DOC', 'CHITTORGARH'] -- capableSourceCount 2.
    return async () => ({
      ranks: ['DOC', 'CHITTORGARH'],
      documentType: 'PRICE_BAND_AD' as const,
      origin: { kind: 'registry' as const, version: 2 },
      na: false,
    });
  }

  function deps() {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: docFetcher, CHITTORGARH: chittorgarhFetcher },
      ipoRepository: {
        findById: async (id: string) => {
          const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
          return row ?? null;
        },
      } as never,
      resolvePolicy: resolvePolicyDocChittorgarh() as never,
      // The default production wiring (buildFieldPlanWalkWitnessVerdictWriter) against THIS
      // file's own real fieldSourcesRepository -- the SAME instance the orchestrator's own
      // trackFieldSource call writes through, so both calls land on the identical
      // field_sources row (same ON CONFLICT target).
      trackWitnessVerdict: (input: {
        ipoId: string;
        tableName: string;
        rowKey: string;
        fieldName: string;
        source: string;
        witnesses: Array<{ source: string; value: unknown; at: string; docType?: string }>;
        verdict: string;
      }) =>
        fieldSourcesRepository.trackFieldUpdate({
          ipoId: input.ipoId,
          tableName: input.tableName,
          rowKey: input.rowKey,
          fieldName: input.fieldName,
          source: input.source as never,
          witnesses: input.witnesses,
          verdict: input.verdict,
        }),
    };
  }

  async function readFieldSourceByIdentity() {
    const [row] = await db
      .select()
      .from(schema.fieldSources)
      .where(
        and(
          eq(schema.fieldSources.ipoId, IPO_ID),
          eq(schema.fieldSources.tableName, 'ipos'),
          eq(schema.fieldSources.rowKey, ''),
          eq(schema.fieldSources.fieldName, 'issueSize')
        )
      );
    return row;
  }

  it('CONFIRMED: DOC and CHITTORGARH agree on issue_size -- witnesses populated, verdict matches what the two sources actually said', async () => {
    await db.execute(
      sql`
        INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
        VALUES (${IPO_ID}::uuid, 'S3b-2 Verdict Writer Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
      `
    );
    await seedPlanRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);

    // Read back BY IDENTITY (ipoId, tableName, rowKey, fieldName) -- never counted.
    const row = await readFieldSourceByIdentity();
    expect(row).toBeDefined();
    expect(row.source).toBe('DRHP'); // DOC's writer-source identity (field-source-codes.ts)
    expect(row.verdict).toBe('CONFIRMED');
    expect(row.witnesses).toHaveLength(2);
    const witnesses = row.witnesses as Array<{ source: string; value: unknown }>;
    const sources = witnesses.map((w) => w.source).sort();
    expect(sources).toEqual(['CHITTORGARH', 'DOC']);
    for (const w of witnesses) {
      expect(Number(w.value)).toBe(DOC_VALUE);
    }
  });
});
