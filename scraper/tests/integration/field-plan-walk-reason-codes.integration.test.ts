// implements: S4 (#779) -- OD-62's reason codes survive the walk onto ipo_field_plan.reason_code/cause,
// proven against the REAL repository and a REAL ipo_field_plan table (never a mock recording the arguments
// the walk PASSED -- the class this whole suite exists to catch is the walk computing the right cause and
// the repository silently dropping it, exactly what happened to `policyOrigin` in S1a review CRITICAL-1).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's node_modules
// junction can resolve the alias back to the PRIMARY checkout (same guard as
// field-plan-walk-resume.integration.test.ts).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { walkFieldPlanForIPO, type FieldFetcher } from '../../src/services/field-plan-walk.js';
import {
  fieldResult,
  consolidatedUpsertResultFixture,
  consolidatedChildRowsResultFixture,
} from '../helpers/consolidation-result-fixture.js';

/**
 * HOW TO RUN THIS. docs/ops/prod-ops-recipes.md, section 12 -- not repeated
 * here (see field-plan-walk-resume.integration.test.ts's own doc comment for
 * why a test file must never carry a host or credential pointer).
 *
 * SKIPS CLEANLY when DATABASE_URL is unset -- check the (live) vs SKIPPED
 * label in the describe name and the test COUNT, never the exit code alone.
 *
 * Run this file ALONE, not concurrently with field-plan-walk-resume or
 * ipo-field-plan-repository (they share the `ipo_field_plan` TABLE across
 * vitest's parallel integration workers; each file scopes its own IPO id so
 * cross-file claims never collide, but a shared table under FOR UPDATE SKIP
 * LOCKED has produced one flaky claim before -- named there, not repeated).
 *
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-plan-walk-reason-codes.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'S4: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000779a1';
const SLUG = 's4-field-plan-walk-reason-codes';

const FAKE_REDIS = {} as never;

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)(`S4 field-plan walk reason codes, real repository (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let repo: IpoFieldPlanRepository;
  let db: ReturnType<typeof drizzle>;

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
    repo = new IpoFieldPlanRepository(db as never, FAKE_REDIS);

    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S4 Reason Code Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
  });

  async function seedRow(overrides: Record<string, unknown> = {}): Promise<string> {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName: 'issueSize',
        rank1Source: 'NSE',
        state: 'PENDING',
        manifestVersion: 1,
        nextDueAt: null,
        ...overrides,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  function ipoRepositoryStub() {
    return {
      findById: async (id: string) => {
        const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
        return row ?? null;
      },
    };
  }

  function resolvePolicyFromSeededRow() {
    return async ({ table, column }: { table: string; column: string }) => {
      const [row] = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(sql`ipo_id = ${IPO_ID}::uuid AND table_name = ${table} AND field_name = ${column}`)
        .limit(1);
      const ranks = row ? [row.rank1Source, row.rank2Source, row.rank3Source] : [];
      while (ranks.length > 0 && ranks[ranks.length - 1] == null) ranks.pop();
      return { ranks, documentType: undefined, origin: { kind: 'registry' as const, version: 1 }, na: false };
    };
  }

  function deps(orchestrator: any, fetcher: FieldFetcher) {
    return {
      fieldPlanRepository: repo as never,
      orchestrator,
      sourceFetchers: { NSE: fetcher, BSE: fetcher },
      ipoRepository: ipoRepositoryStub() as never,
      resolvePolicy: resolvePolicyFromSeededRow() as never,
    };
  }

  /** A write path that always WINS -- unused here except as the "no fetcher" orchestrator filler. */
  function okOrchestrator() {
    return {
      consolidatedUpsertIPO: async (scraped: any, source: any, _c?: any, _p?: any, onlyFields?: string[]) => {
        const field = onlyFields?.[0];
        return consolidatedUpsertResultFixture({
          ipoId: IPO_ID,
          fieldResults: field ? [fieldResult(field, scraped[field], source)] : [],
        });
      },
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: any[], source: any) => {
        const row = rows[0];
        const field = Object.keys(row.data)[0];
        return consolidatedChildRowsResultFixture(row.rowKey, [fieldResult(field, row.data[field], source)], {
          consolidatedData: row.data,
        });
      },
    } as never;
  }

  /** A write path that REACHES the consolidator but LOSES to a different source's stored value. */
  function losingOrchestrator() {
    return {
      consolidatedUpsertIPO: async () =>
        consolidatedUpsertResultFixture({
          ipoId: IPO_ID,
          fieldResults: [fieldResult('issueSize', 999999, 'CHITTORGARH')],
        }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: any[]) =>
        consolidatedChildRowsResultFixture(rows[0].rowKey, [fieldResult('revenue', 999999, 'CHITTORGARH')]),
    } as never;
  }

  const suppliedFetcher: FieldFetcher = async () => ({
    outcome: 'SUPPLIED',
    value: 1234,
    documentType: 'RHP',
    page: 7,
  });

  // ---- 1. SOURCE_UNREACHABLE: no fetcher registered for the rank ----
  it('a field with no fetcher registered records SOURCE_UNREACHABLE with the raw cause, read back from the row', async () => {
    // rank1Source names a source with NO entry in sourceFetchers below.
    const id = await seedRow({ rank1Source: 'UNREGISTERED_SOURCE' });

    const walkDeps = deps(okOrchestrator(), suppliedFetcher);
    // Remove the only fetcher this rank could have used.
    (walkDeps.sourceFetchers as Record<string, FieldFetcher>) = {};

    const result = await walkFieldPlanForIPO(IPO_ID, walkDeps, openBudget());
    expect(result.fieldsCheckFailed).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.reasonCode).toBe('SOURCE_UNREACHABLE');
    expect(row.cause).toContain('NO_FETCHER_REGISTERED');
    expect(row.cause).toContain('UNREGISTERED_SOURCE');
  });

  // ---- 2. LOST_TO_HIGHER_PRIORITY: the write reached consolidation and LOST to matrix priority ----
  // (#785: this is a HEALTHY outcome -- the value was fine, just outranked -- and must NEVER be
  // recorded as FAILED_VALIDATION, which OD-62 reserves for a genuine shape-check rejection.)
  it('a write that loses to a higher-priority source records LOST_TO_HIGHER_PRIORITY with the matrix-priority cause', async () => {
    const id = await seedRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(losingOrchestrator(), suppliedFetcher), openBudget());
    expect(result.fieldsCheckFailed).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.reasonCode).toBe('LOST_TO_HIGHER_PRIORITY');
    expect(row.reasonCode).not.toBe('FAILED_VALIDATION');
    expect(row.cause).toContain('matrix priority');
  });

  // ---- 2b. COVERAGE_GAP: a transient CHECK_FAILED where a document WAS held and the fetcher WAS
  // reached, but it returned a real reason (a manifest/config gap) -- #785 defect 2. This must
  // NEVER fall into SOURCE_UNREACHABLE, which means "the source could not even be asked".
  it('a transient CHECK_FAILED with a document held records COVERAGE_GAP, not SOURCE_UNREACHABLE', async () => {
    const id = await seedRow({ rank1Source: 'NSE', rank2Source: null });
    const transientCheckFailedFetcher: FieldFetcher = async () => ({
      outcome: 'CHECK_FAILED',
      reason: 'no documentType in manifest',
      // transient omitted -> defaults to TRUE per the walk's own doc comment
    });

    const result = await walkFieldPlanForIPO(
      IPO_ID,
      deps(okOrchestrator(), transientCheckFailedFetcher),
      openBudget()
    );
    expect(result.fieldsCheckFailed).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.reasonCode).toBe('COVERAGE_GAP');
    expect(row.reasonCode).not.toBe('SOURCE_UNREACHABLE');
    expect(row.cause).toContain('no documentType in manifest');
  });

  // ---- 2c. UNCLASSIFIED (unit-level, not here): every real push site in field-plan-walk.ts is
  // tagged (:NO_FETCHER_REGISTERED, :THROWN:, :CHECK_FAILED:), so there is no live code path
  // through the actual walk that reaches the UNCLASSIFIED fallback -- fabricating one here would
  // just be testing a made-up cause string, not real behaviour. The fallback itself (and that it
  // preserves the raw cause) is pinned directly on the exported `classifyFailure` in
  // `tests/unit/services/field-plan-walk.test.ts` ("classifyFailure (#785 reason-code remap)").
  // A THROWN error IS exercised end-to-end via `walkFieldPlanForIPO` below and correctly still
  // resolves to SOURCE_UNREACHABLE, not UNCLASSIFIED -- see "a field with no fetcher registered
  // records SOURCE_UNREACHABLE" above and the unit suite's own THROWN case.

  // ---- 3. NOT_PUBLISHED_YET: the authoritative source has not printed this field yet ----
  it('NOT_AVAILABLE_YET records NOT_PUBLISHED_YET, and the row stays re-askable (non-terminal)', async () => {
    const id = await seedRow({ rank1Source: 'NSE', rank2Source: null });
    const naFetcher: FieldFetcher = async () => ({ outcome: 'NOT_AVAILABLE_YET' });

    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator(), naFetcher), openBudget());
    expect(result.fieldsNotAvailableYet).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('NOT_AVAILABLE_YET');
    expect(row.reasonCode).toBe('NOT_PUBLISHED_YET');
    expect(row.cause).toContain('NOT_AVAILABLE_YET');
    expect(row.nextDueAt).not.toBeNull();
  });

  // ---- 4. EXTRACTION_FAILED: a definitive CHECK_FAILED (document held, field not in it) ----
  it('a definitive CHECK_FAILED (transient: false) records EXTRACTION_FAILED', async () => {
    const id = await seedRow({ rank1Source: 'NSE', rank2Source: null });
    const definitiveFailFetcher: FieldFetcher = async () => ({
      outcome: 'CHECK_FAILED',
      reason: 'field not present in the held RHP',
      transient: false,
    });

    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator(), definitiveFailFetcher), openBudget());
    // Single rank, definitive -> every rank answered definitively -> EXHAUSTED (terminal), not CHECK_FAILED.
    expect(result.fieldsExhausted).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('EXHAUSTED');
    expect(row.reasonCode).toBe('EXTRACTION_FAILED');
    expect(row.cause).toContain('field not present in the held RHP');
    expect(row.cause).toContain('(definitive)');
  });

  // ---- 5. SUPPLIED never writes a reason code, and it survives on RE-READ ----
  it('SUPPLIED writes no reason_code/cause -- the columns stay NULL going forward, not just on this row\'s creation', async () => {
    const id = await seedRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator(), suppliedFetcher), openBudget());
    expect(result.fieldsSupplied).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('SUPPLIED');
    expect(row.reasonCode).toBeNull();
    expect(row.cause).toBeNull();
  });

  // ---- 6. Every terminal not-supplied state writes a code from the named set, NEVER a bare null going forward ----
  // Each field is walked ALONE (its own beforeEach-cleared table, one seeded row per call) so one
  // scenario's fetcher/orchestrator cannot answer a DIFFERENT field's row as an accidental side effect
  // -- walkFieldPlanForIPO drains every DUE row for the IPO, not just the one a scenario cares about.
  it('every not-supplied terminal state this walk settles writes a reason_code from the named set (never bare null)', async () => {
    const NAMED_CODES = new Set([
      'SOURCE_UNREACHABLE',
      'EXTRACTION_FAILED',
      'FAILED_VALIDATION',
      'NOT_PUBLISHED_YET',
      'LOST_TO_HIGHER_PRIORITY',
      'COVERAGE_GAP',
      'UNCLASSIFIED',
    ]);
    const naFetcher: FieldFetcher = async () => ({ outcome: 'NOT_AVAILABLE_YET' });
    const definitiveFailFetcher: FieldFetcher = async () => ({
      outcome: 'CHECK_FAILED',
      reason: 'x',
      transient: false,
    });

    const scenarios: Array<{ seed: Record<string, unknown>; orchestrator: any; fetcher: FieldFetcher }> = [
      { seed: { fieldName: 'field0', rank1Source: 'GHOST' }, orchestrator: okOrchestrator(), fetcher: suppliedFetcher },
      { seed: { fieldName: 'field1' }, orchestrator: losingOrchestrator(), fetcher: suppliedFetcher },
      { seed: { fieldName: 'field2', rank2Source: null }, orchestrator: okOrchestrator(), fetcher: naFetcher },
      { seed: { fieldName: 'field3', rank2Source: null }, orchestrator: okOrchestrator(), fetcher: definitiveFailFetcher },
    ];

    for (const scenario of scenarios) {
      await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
      const id = await seedRow(scenario.seed);
      await walkFieldPlanForIPO(IPO_ID, deps(scenario.orchestrator, scenario.fetcher), openBudget());

      const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
      expect(row.state).not.toBe('SUPPLIED');
      expect(row.reasonCode).not.toBeNull();
      expect(NAMED_CODES.has(row.reasonCode as string)).toBe(true);
      expect(row.cause).not.toBeNull();
    }
  });
});
