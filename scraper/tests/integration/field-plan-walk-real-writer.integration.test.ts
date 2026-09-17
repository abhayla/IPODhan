// implements: item 3 slice S3 -- the pull walk driving the REAL
// `DataConsolidationOrchestrator` against ipodhan_test (design §2.3.5, R-054)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, and, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (same guard as field-plan-walk-resume.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationOrchestrator } from '../../src/services/data-consolidation-orchestrator.js';
import { walkFieldPlanForIPO, type FieldFetcher, type FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * Item 3 slice S3 -- unlike field-plan-walk-resume.integration.test.ts (real
 * repository, STUBBED orchestrator), this file constructs the REAL
 * `DataConsolidationOrchestrator` -- the same class production's
 * `buildFieldPlanWalkOrchestrator` (field-plan-walk-deps.ts) wires -- against
 * ipodhan_test. That is the whole point (lesson `stubbed-writer-hides-
 * contract-bugs`): three walk<->writer contract bugs and two stub drifts hid
 * behind a stubbed consolidator on 2026-09-16. A mock can be wrong in a way
 * that agrees with itself forever; only the real orchestrator, writing
 * through the real matrix priority (`field-priority-matrix.ts`'s `issueSize`
 * entry: ADMIN > DRHP > CHITTORGARH > NSE > BSE > MONEYCONTROL) and the real
 * `field_sources` table, can prove the WIN and LOST outcomes end to end.
 *
 * WIN: `ipos.issue_size` stored with NO field_sources row (untracked) -- the
 * walk supplies a CHITTORGARH value onto it. Nothing outranks "untracked",
 * so the write wins: row SUPPLIED, a field_sources row appears with source
 * CHITTORGARH, and the plan row's own `chosen_source`/`chosen_rank` and
 * `policy_origin` (ENABLE_POLICY_WRITER, S1d) record the walk's own write.
 *
 * LOST: `ipos.issue_size` stored WITH an existing DRHP field_sources row
 * (DRHP outranks CHITTORGARH in the matrix) -- the walk supplies a
 * CHITTORGARH value, the real matrix priority refuses it, and PASS 3's own
 * rule (field-plan-walk.ts:607-613, "definitive answer... will read the same
 * next pass") records CHECK_FAILED, never SUPPLIED, never EXHAUSTED. The
 * stored value and the DRHP field_sources row are read back UNCHANGED.
 *
 * SKIPS CLEANLY when no database is configured. See
 * field-plan-walk-resume.integration.test.ts's header for the tunnel/Redis
 * setup this file shares (docs/ops/prod-ops-recipes.md, section 12) and the
 * "read the test COUNT, not just the exit code" warning -- with
 * DATABASE_URL unset this describe block SKIPS rather than fails.
 *
 * Run in isolation from field-plan-walk-resume.integration.test.ts and
 * ipo-field-plan-repository.integration.test.ts if run together they can
 * share `ipo_field_plan` claim contention (documented there); this file uses
 * its own IPO id so it cannot collide on ROWS, only on the FOR UPDATE SKIP
 * LOCKED scheduling those files already document as a known, harmless flake
 * source.
 *
 * To run:
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-plan-walk-real-writer.integration.test.ts
 */

process.env.ENABLE_POLICY_WRITER = 'true';
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-3 S3: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-000000000353';
const SLUG = 'item3-s3-field-plan-walk-real-writer';

const UNTRACKED_ISSUE_SIZE = 100_000_000; // Rs 10 Cr, seeded with no field_sources row
const DRHP_ISSUE_SIZE = 250_000_000; // Rs 25 Cr, seeded WITH a DRHP field_sources row
const CHITTORGARH_VALUE = 300_000_000; // Rs 30 Cr, what the walk's fetcher supplies

const chittorgarhFetcher: FieldFetcher = async () => ({
  outcome: 'SUPPLIED',
  value: CHITTORGARH_VALUE,
  documentType: undefined,
  page: undefined,
});

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)(`item 3 S3: field-plan walk, REAL DataConsolidationOrchestrator (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let redis: Redis | null = null;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: FieldPlanWalkOrchestrator;

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

    // The REAL production wiring's constructor call
    // (field-plan-walk-deps.ts's buildFieldPlanWalkOrchestrator), not a
    // second hand-rolled construction -- same repository classes, same
    // DataConsolidationOrchestrator, this file's own real pool + redis.
    const ipoRepository = new IPORepository(db as never, redis as never);
    orchestrator = new DataConsolidationOrchestrator(
      ipoRepository,
      new FieldSourcesRepository(db as never, redis as never),
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
        fieldName: 'issueSize',
        rank1Source: 'CHITTORGARH',
        state: 'PENDING',
        manifestVersion: 1,
        nextDueAt: null,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  function resolvePolicyChittorgarh() {
    return async () => ({
      ranks: ['CHITTORGARH'],
      documentType: undefined,
      origin: { kind: 'registry' as const, version: 1 },
      na: false,
    });
  }

  function deps() {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { CHITTORGARH: chittorgarhFetcher },
      ipoRepository: {
        findById: async (id: string) => {
          const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
          return row ?? null;
        },
      } as never,
      resolvePolicy: resolvePolicyChittorgarh() as never,
    };
  }

  async function readPlanRow(id: string) {
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    return row;
  }

  async function readIssueSize(): Promise<string | null> {
    const [row] = await db.select({ issueSize: schema.ipos.issueSize }).from(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    return row?.issueSize ?? null;
  }

  async function readFieldSources() {
    return db
      .select()
      .from(schema.fieldSources)
      .where(
        and(
          eq(schema.fieldSources.ipoId, IPO_ID),
          eq(schema.fieldSources.tableName, 'ipos'),
          eq(schema.fieldSources.fieldName, 'issueSize')
        )
      );
  }

  it('WIN: an untracked stored value is SUPPLIED by the real orchestrator, a field_sources row records CHITTORGARH, policy_origin is recorded', async () => {
    await db.execute(
      // Untracked: issue_size seeded directly, no field_sources row for it.
      // Raw SQL matches the sibling integration tests' own seeding idiom.
      sql`
        INSERT INTO ipos (id, company_name, slug, category, status, issue_size, open_date, close_date)
        VALUES (${IPO_ID}::uuid, 'Item 3 S3 WIN Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', ${UNTRACKED_ISSUE_SIZE}, '2026-09-14', '2026-09-16')
      `
    );
    const id = await seedPlanRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(1);
    expect(result.fieldsCheckFailed).toBe(0);

    const row = await readPlanRow(id);
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenSource).toBe('CHITTORGARH');
    expect(row.chosenRank).toBe(1);
    expect(row.claimedAt).toBeNull();
    expect(row.claimToken).toBeNull();
    expect(row.policyOrigin).toBe('registry:1');

    const storedIssueSize = await readIssueSize();
    expect(Number(storedIssueSize)).toBe(CHITTORGARH_VALUE);

    const sources = await readFieldSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].source).toBe('CHITTORGARH');
  });

  it('LOST: a stored DRHP value outranks CHITTORGARH — row NOT supplied, CHECK_FAILED, stored value and field_sources row unchanged', async () => {
    await db.execute(
      sql`
        INSERT INTO ipos (id, company_name, slug, category, status, issue_size, open_date, close_date)
        VALUES (${IPO_ID}::uuid, 'Item 3 S3 LOST Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', ${DRHP_ISSUE_SIZE}, '2026-09-14', '2026-09-16')
      `
    );
    // Existing DRHP provenance — DRHP outranks CHITTORGARH in the real
    // matrix (field-priority-matrix.ts issueSize: ADMIN > DRHP > CHITTORGARH
    // > NSE > BSE > MONEYCONTROL), so the walk's CHITTORGARH write must lose.
    await db.insert(schema.fieldSources).values({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'issueSize',
      source: 'DRHP',
      confidence: 95,
    } as never);

    const id = await seedPlanRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(), openBudget());
    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsExhausted).toBe(0);

    const row = await readPlanRow(id);
    // Settled and re-askable, never terminal (field-plan-walk.ts:607-613).
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.nextDueAt).not.toBeNull();
    expect(row.chosenSource).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.claimToken).toBeNull();

    // Stored value and provenance UNCHANGED — read back from the real
    // tables, not from the walk's own return value.
    const storedIssueSize = await readIssueSize();
    expect(Number(storedIssueSize)).toBe(DRHP_ISSUE_SIZE);

    const sources = await readFieldSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].source).toBe('DRHP');
  });
});
