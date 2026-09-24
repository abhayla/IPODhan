// implements: item 3 slice S3 -- the pull walk driving the REAL
// `DataConsolidationOrchestrator` against ipodhan_test (design §2.3.5, R-054)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, and, desc, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (same guard as field-plan-walk-resume.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';
import { buildFieldPlanIpoGapKeys, fieldPlanClaimGapKeys } from '../../src/services/field-plan-gap-keys.js';
// `feature-flags.ts`'s `export const FEATURE_FLAGS = {...}` bakes every flag
// (e.g. `ENABLE_DATA_CONSOLIDATION: process.env.ENABLE_DATA_CONSOLIDATION
// === 'true'`) ONCE at module-eval time. A plain top-level `import` is
// hoisted and resolved before ANY of this file's own top-level statements
// run (ES module semantics), and `field-plan-walk.js` statically imports
// `data-consolidation-service.js`, which statically imports
// `feature-flags.ts` -- so a static import of EITHER `field-plan-walk.js`
// or `data-consolidation-orchestrator.js` here bakes FEATURE_FLAGS before
// this file's own `process.env` lines run, no matter their textual order.
// Measured directly: a static import of just the orchestrator still logged
// skipReason 'CONSOLIDATION_DISABLED' on every write. Both are imported
// dynamically in `beforeAll`, AFTER the env vars are set, so this file's
// own env assignment is the FIRST thing to touch feature-flags.ts.
type DataConsolidationOrchestratorCtor = typeof import('../../src/services/data-consolidation-orchestrator.js').DataConsolidationOrchestrator;
type WalkFieldPlanForIPOFn = typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;

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
// This file is the first integration test to call through to the REAL
// DataConsolidationOrchestrator.consolidatedUpsertIPO rather than a stub —
// without these, ENABLE_DATA_CONSOLIDATION defaults false and every write
// short-circuits with skipReason 'CONSOLIDATION_DISABLED' before the matrix
// or field_sources are ever touched (data-consolidation-orchestrator.ts:201).
// CONSOLIDATION_PERCENTAGE=0 is a separate, equally-fatal LIVE-GATE
// (feature-flags.ts:544) that silently disables the whole pipeline even
// with ENABLE_DATA_CONSOLIDATION=true — both must be set. Flags bake at
// import (see the three above), so these run before any production import.
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
// OD-99 block below: the child-row writer must reach its row-key check (MISSING_ROW_KEY);
// the ipos-only S3 cases above never call the child-row writer, so this changes nothing for them.
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = 'true';

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

    // Dynamic imports, AFTER the env vars above are set -- see the top-of-file
    // comment on why a static import would freeze FEATURE_FLAGS.ENABLE_DATA_CONSOLIDATION=false.
    const { DataConsolidationOrchestrator }: { DataConsolidationOrchestrator: DataConsolidationOrchestratorCtor } =
      await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));

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
        // ipo_field_plan.field_name is snake_case (unlike field_sources.field_name,
        // which is camelCase -- lesson field-sources-field-name-is-camelCase,
        // inverted here). The walk's own claimNextDueField selects on this
        // exact stored value and does its OWN columnToCamelCase conversion
        // internally (field-plan-walk.ts:987) -- confirmed by reading both
        // the generator's write (field-plan-generator.ts) and the claim
        // query (ipo-field-plan-repository.ts's claimNextDueField, which
        // reads WHERE state = 'PENDING' with no field_name transform).
        fieldName: 'issue_size',
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
    // The PLAN row's policy_origin comes from THIS TEST's own resolvePolicy
    // stub (resolvePolicyChittorgarh, hardcoded 'registry:1') -- the walk
    // records exactly what its resolvePolicy dependency told it (S1a).
    expect(row.policyOrigin).toBe('registry:1');

    const storedIssueSize = await readIssueSize();
    expect(Number(storedIssueSize)).toBe(CHITTORGARH_VALUE);

    const sources = await readFieldSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].source).toBe('CHITTORGARH');
    // S1d provenance write (data-consolidation-service.ts's computePolicyOrigin,
    // trackFieldUpdate): the field_sources row's data_lineage is written by a
    // SEPARATE call, inside the real orchestrator, to the REAL
    // resolveFieldSourcePolicy against the REAL on-disk manifest
    // (scraper/config/field-manifest.json, currently version 2 -- confirmed by
    // reading the file directly, not assumed) -- NOT from this test's
    // resolvePolicy stub, which only feeds the walk's own ranking/ask-order
    // decision. That is WHY this deliberately reads 'registry:2' while the
    // plan row above reads 'registry:1': two independent origin computations,
    // one stubbed (the walk's ranks) and one real (the writer's own lineage
    // resolution), and they are allowed to disagree because they answer
    // different questions ("what ranks did the walk ask in" vs "what does the
    // CURRENT real manifest say about this field"). On a fresh INSERT (this
    // untracked row) trackFieldUpdate sets data_lineage directly, no jsonb
    // merge involved (the COALESCE-merge path only fires on ON CONFLICT
    // UPDATE -- see field-sources-repository.ts's trackFieldUpdate comment).
    // Exact value, never toBeDefined()/truthiness -- a wrong version or a
    // missing key must fail this test.
    expect(sources[0].dataLineage).toEqual({ policyOrigin: 'registry:2' });
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

// ---------------------------------------------------------------------------
// OD-99 (design §2.3, OD-62, OD-73, OD-78): structural write refusals and equal answers.
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
const OD99_RUN_LABEL = DATABASE_URL ? 'live' : 'OD-99: SKIPPED -- DATABASE_URL not set';
const OD99_IPO_ID = '00000000-0000-4000-8000-000000000099';
const OD99_SLUG = 'od99-structural-write-drop-fixture';
// ipodhan_test still has the pre-ALTER integer gmp column (schema.ts B2/G14 note), so a whole number.
const OD99_STORED_GMP = 42;

type BuildGmpFetcherFn = typeof import('../../src/services/field-plan-walk-investorgain-gmp-fetcher.js').buildInvestorgainGmpFetcher;

describe.skipIf(!DATABASE_URL)(`OD-99: structural write refusals and equal answers (${OD99_RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let redis: Redis | null = null;
  let db: ReturnType<typeof drizzle>;
  let planRepo: IpoFieldPlanRepository;
  let realOrchestrator: FieldPlanWalkOrchestrator;
  let walkFieldPlanForIPO: WalkFieldPlanForIPOFn;
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
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, OD99_IPO_ID));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, OD99_IPO_ID));
    await db.delete(schema.gmpRecords).where(eq(schema.gmpRecords.ipoId, OD99_IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [OD99_IPO_ID]));
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
      const keys = await redis.keys(`*${OD99_IPO_ID}*`);
      if (keys.length > 0) await redis.del(...keys);
    }
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${OD99_IPO_ID}::uuid, 'OD-99 Fixture Ltd.', ${OD99_SLUG}, 'MAINBOARD', 'OPEN', '2026-09-24', '2026-09-26')
    `);
    await db.execute(sql`
      INSERT INTO gmp_records (ipo_id, timestamp, gmp, source)
      VALUES (${OD99_IPO_ID}::uuid, ${new Date('2026-09-25T04:00:00Z').toISOString()}, ${OD99_STORED_GMP}, 'INVESTORGAIN_GMP')
    `);
  });

  async function seedGmpPlanRow(): Promise<string> {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: OD99_IPO_ID,
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
    Number((await pool!.query('SELECT count(*)::int AS n FROM gmp_records WHERE ipo_id = $1', [OD99_IPO_ID])).rows[0].n);

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

    const result = await walkFieldPlanForIPO(OD99_IPO_ID, deps(fetcher, realOrchestrator) as never, openBudget());

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

    const result = await walkFieldPlanForIPO(OD99_IPO_ID, deps(fetcher, realOrchestrator) as never, openBudget());

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

    const again = await planRepo.claimNextDueField({ ipoId: OD99_IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-A')) });
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

    const result = await walkFieldPlanForIPO(OD99_IPO_ID, deps(fetcher, lockLost) as never, openBudget());

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
    await walkFieldPlanForIPO(OD99_IPO_ID, deps(fetcher, realOrchestrator, 'w-A') as never, openBudget());
    expect((await readPlanRow(id)).state).toBe('CHECK_FAILED');

    const sameKey = await planRepo.claimNextDueField({ ipoId: OD99_IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-A')) });
    expect(sameKey).toBeNull();

    const reopened = await planRepo.claimNextDueField({ ipoId: OD99_IPO_ID, gapKeys: fieldPlanClaimGapKeys(gapKeysWith('w-B')) });
    expect(reopened?.id).toBe(id);
    await planRepo.releaseClaimUnrecorded({ planRowId: id, claimToken: reopened!.claimToken as string });
  });
});
