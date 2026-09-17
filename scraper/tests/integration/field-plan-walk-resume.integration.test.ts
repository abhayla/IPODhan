// implements: item 6 -- the pull walk's resume behaviour against the REAL repository (design §2.2)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (see ipo-field-plan-repository.integration.test.ts for the same guard).
import * as schema from '../../../packages/shared/src/db/schema';
import {
  IpoFieldPlanRepository,
  FIELD_PLAN_CLAIM_STALE_MINUTES,
} from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { walkFieldPlanForIPO, type FieldFetcher } from '../../src/services/field-plan-walk.js';
import {
  fieldResult,
  consolidatedUpsertResultFixture,
  consolidatedChildRowsResultFixture,
} from '../helpers/consolidation-result-fixture.js';

/**
 * Item 6 -- the walk, run against the REAL repository and a REAL
 * `ipo_field_plan` table.
 *
 * THE CLASS a mock cannot prove, and this does:
 *
 *  1. RESUME. §2.2's whole promise is "the walk commits one field at a time
 *     and is resumable from any point". A walk killed mid-field leaves a
 *     claim behind; only the real claim SQL (stale-claim reclaim, FOR UPDATE
 *     SKIP LOCKED) decides whether a second walk picks that field back up or
 *     strands it forever. A stub repository that hands out rows from an array
 *     answers neither question.
 *
 *  2. NO STUCK CLAIM. The staging proof reads `no row left with a non-null
 *     claimed_at after the cycle`. That is a property of the TABLE after a
 *     real walk, not of the walk's own return value, and it is asserted here
 *     directly.
 *
 *  3. THE DROPPED WRITE, END TO END. A `skipped` write must leave the row
 *     PENDING with `attempts` UNTOUCHED -- read back from the row, not from
 *     the arguments the walk passed. A walk that passed the right arguments
 *     to a repository that then bumped `attempts` anyway would pass every
 *     unit test and still burn the field's backoff budget in production.
 *
 * Covers BOTH row shapes: singleton (`ipos`, row_key '') and keyed
 * (`financial_statements`, fiscal-year row_key).
 *
 * KNOWN FLAKE, named rather than left to surprise a reader. This suite and
 * `ipo-field-plan-repository.integration.test.ts` share the `ipo_field_plan`
 * TABLE (each scopes every claim to its own IPO id, so neither can claim the
 * other's rows). vitest runs integration files in parallel, and
 * `claimNextDueField`'s `FOR UPDATE SKIP LOCKED` is deliberately willing to
 * find NOTHING when a row it would otherwise take is locked by another
 * transaction -- that is the concurrency property item 5 built, not a bug. In
 * one run of the two files together, two dropped-write assertions here saw a
 * null claim for that reason; both files pass in isolation and passed together
 * on the re-run. If this recurs, the fix is to serialise these two files (or
 * give this suite its own schema), NOT to weaken the claim SQL.
 *
 * SKIPS CLEANLY when no database is configured.
 *
 * HOW TO RUN THIS. The literal recipe -- the exact exports, where the
 * credentials come from, and the tunnel -- lives in ONE place:
 *
 *     docs/ops/prod-ops-recipes.md, section 12
 *
 * It is not repeated here on purpose. A test file must not carry a host, a
 * connection string, or a pointer to the credential store: this file is read
 * by more people than the recipe is, and every copy is a place the real
 * target can drift out of sync or leak. There is no scraper/.env.test -- the
 * guard reads the process environment, which is why an unprepared run fails
 * with "could not determine the target database host".
 *
 * FOUR THINGS THAT EACH LOOK LIKE A BROKEN SUITE AND ARE NOT:
 *   1. localhost:15432 is the SSH TUNNEL to the Windows DB host, and it is the
 *      ONLY accepted route. Pointing DATABASE_URL straight at the prod DB host (named in the recipe)
 *      is refused by a non-overridable denylist in tests/helpers/
 *      db-safety-guard.ts -- that host serves production, and several of these
 *      suites do real INSERT/DELETE. The tunnel must already be up.
 *   2. REDIS_URL must be set even for suites that never touch Redis; the
 *      global guard refuses to run without a confirmed non-production target.
 *   3. With DATABASE_URL unset the suite SKIPS rather than fails
 *      (describe.skipIf), so a silent pass is not a green run -- check the
 *      test COUNT and the (live) vs SKIPPED label in the describe name.
 *   4. Run the two ipo_field_plan files ONE AT A TIME. They share that table,
 *      vitest runs integration files in parallel, and claimNextDueField's
 *      FOR UPDATE SKIP LOCKED is DESIGNED to find nothing when a row it would
 *      take is locked by another transaction. A concurrent run can therefore
 *      fail a claim assertion that is perfectly correct. Seen once between
 *      these two suites; both pass in isolation. The fix is to serialise the
 *      files, never to weaken the claim SQL.
 *
 * To run:
 *   npx vitest run -c vitest.integration.config.ts \
 *     tests/integration/field-plan-walk-resume.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-6: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000660a6';
const SLUG = 'item6-field-plan-walk-resume';

const FAKE_REDIS = {} as never;

const suppliedFetcher: FieldFetcher = async () => ({
  outcome: 'SUPPLIED',
  value: 1234,
  documentType: 'RHP',
  page: 7,
});

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)(`item 6 field-plan walk, real repository (${RUN_LABEL})`, () => {
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
      VALUES (${IPO_ID}::uuid, 'Item 6 Walk Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
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

  async function readAll() {
    return db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
  }

  /**
   * A write path that always WINS -- the consolidator's own `fieldResults`
   * confirm `chosenSource`/`finalValue` match what was supplied, echoing the
   * REAL shape (review round 6 addendum: this used to omit `consolidation`
   * entirely, which after round 5/6's `fieldResults`-agreement fix made
   * every field here read as CHECK_FAILED via "no field result returned" --
   * 4 failures, all "expected +0 to be N" SUPPLIED -- because a stub built
   * loosely from `as never` had silently drifted from the real writer
   * contract three times in one night. Built from the shared, REAL-interface
   * fixture so it cannot drift again without a type error.
   */
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

  /**
   * A write path that REACHES the consolidator but LOSES to a different,
   * already-stored source's value (matrix priority) -- the round 5/6 class.
   * The row must be re-askable (CHECK_FAILED, transient), NEVER retired and
   * NEVER SUPPLIED, which is exactly what the resume/concurrency contract
   * this suite proves must hold for every losing outcome too.
   */
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

  /** A write path that DROPS every write, exactly as a lost lock does. */
  function droppingOrchestrator() {
    return {
      consolidatedUpsertIPO: async () => ({
        ipoId: '',
        isNew: false,
        locked: false,
        skipped: true,
        skipReason: 'LOCK_NOT_ACQUIRED',
      }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: any[]) => ({
        rowsProcessed: rows.length,
        rowsUpdated: 0,
        rowsSkipped: rows.length,
        conflictsDetected: 0,
        rows: rows.map((r) => ({
          rowKey: r.rowKey,
          consolidatedData: {},
          fieldsProcessed: 0,
          fieldsUpdated: 0,
          conflictsDetected: 0,
          skipped: true,
          skipReason: 'MISSING_ROW_KEY',
        })),
      }),
    } as never;
  }

  /**
   * Review round 4 (CI red, run 35125498227): `runWrite`'s singleton-table
   * branch (review round 2, RCA1) unconditionally calls
   * `deps.ipoRepository.findById(ipoId)` before it ever reaches the
   * orchestrator this file stubs — this `deps()` helper had no
   * `ipoRepository` at all, so that call threw
   * "Cannot read properties of undefined (reading 'findById')" and EVERY
   * write in this suite was dropped before `okOrchestrator()` was ever
   * called, regardless of what it was stubbed to return.
   *
   * `beforeAll` already seeds a real `ipos` row for `IPO_ID` (line ~133) —
   * this reads that SAME row back through the minimal
   * `FieldPlanWalkIPORepository` shape (`{ findById }`) the walk actually
   * needs, rather than adding a new seam: `deps.ipoRepository` already
   * existed as an injection point since round 2, it was simply never wired
   * here. No production code changed for this fix.
   */
  function ipoRepositoryStub() {
    return {
      findById: async (id: string) => {
        const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
        return row ?? null;
      },
    };
  }

  /**
   * item 3 slice S1a: production resolves the ask order from ONE `resolvePolicy` call per field
   * per walk, never from the plan row's rank columns directly. This suite seeds rows with
   * synthetic field names (`field0`, `issueSize`) that do not exist in the real manifest, so the
   * PRODUCTION default (`defaultResolvePolicy`, the real 190-row manifest) would throw
   * "unknown field" here -- same reason the unit test file stubs it. This reads the row BACK from
   * the real table by (tableName, fieldName) and echoes its own rank columns, so the resolver
   * indirection is exercised against the real repository without requiring every synthetic field
   * name in this suite to exist in the manifest.
   */
  function resolvePolicyFromSeededRow() {
    return async ({ table, column }: { table: string; column: string }) => {
      const [row] = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.tableName, table), eq(schema.ipoFieldPlan.fieldName, column)))
        .limit(1);
      const ranks = row ? [row.rank1Source, row.rank2Source, row.rank3Source] : [];
      while (ranks.length > 0 && ranks[ranks.length - 1] == null) ranks.pop();
      return { ranks, documentType: undefined, origin: { kind: 'registry' as const, version: 1 }, na: false };
    };
  }

  function deps(orchestrator: any, fetcher: FieldFetcher = suppliedFetcher) {
    return {
      fieldPlanRepository: repo as never,
      orchestrator,
      sourceFetchers: { NSE: fetcher, BSE: fetcher },
      ipoRepository: ipoRepositoryStub() as never,
      resolvePolicy: resolvePolicyFromSeededRow() as never,
    };
  }

  it('drains every due field and leaves NO row holding a claim (the staging proof, in miniature)', async () => {
    for (let i = 0; i < 5; i++) await seedRow({ fieldName: `field${i}` });
    await seedRow({ tableName: 'financial_statements', rowKey: 'FY2025', fieldName: 'revenue' });

    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget());

    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');
    expect(result.fieldsSupplied).toBe(6);

    const rows = await readAll();
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.state).toBe('SUPPLIED');
      // THE staging-proof assertion: nothing is left holding a claim.
      expect(row.claimedAt).toBeNull();
      expect(row.claimToken).toBeNull();
      expect(row.chosenSource).toBe('NSE');
      expect(row.chosenRank).toBe(1);
      expect(row.attempts).toBe(1);
    }
  });

  // S1a review CRITICAL-1: the walk computes `policyOrigin` and passes it to
  // `recordAndClassify`, but the repository's SQL never set `policy_origin`
  // -- an untyped `params: Record<string, unknown>` bag hid the missing
  // field from the compiler and no test asserted the WALK's write (only the
  // generator's own insert wrote the column, which would mask this defect
  // in a lazier test). This nulls the column FIRST, by hand, via a raw
  // UPDATE, so the generator's original value cannot be the thing the
  // assertion is actually reading.
  it('the WALK records policy_origin on the outcome (S1a review CRITICAL-1) -- the generator\'s value cannot mask this', async () => {
    const id = await seedRow({ fieldName: 'issueSize', rank1Source: 'NSE', rank2Source: 'BSE', manifestVersion: 2 });

    // Prove the column starts non-authoritative for this assertion: null it
    // explicitly so a later read of 'registry:2' can only have come from the
    // WALK's own write, never a value the seed/generator happened to leave.
    await db.execute(sql`UPDATE ipo_field_plan SET policy_origin = NULL WHERE id = ${id}::uuid`);
    const [beforeRow] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(beforeRow.policyOrigin).toBeNull();

    // A resolvePolicy stubbed to answer 'registry:2' specifically, so the
    // assertion below checks an exact, deliberate value rather than
    // whatever `resolvePolicyFromSeededRow`'s default origin happens to be.
    const resolvePolicyRegistry2 = async () => ({
      ranks: ['NSE', 'BSE'],
      documentType: undefined,
      origin: { kind: 'registry' as const, version: 2 },
      na: false,
    });
    const walkDeps = { ...deps(okOrchestrator()), resolvePolicy: resolvePolicyRegistry2 as never };

    const result = await walkFieldPlanForIPO(IPO_ID, walkDeps, openBudget());
    expect(result.fieldsSupplied).toBe(1);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('SUPPLIED');
    // The WALK's own recordOutcome call is what put this value back after
    // this test nulled the column by hand -- the generator's original write
    // (nulled above) cannot be what this assertion is reading.
    expect(row.policyOrigin).toBe('registry:2');
  });

  it('a dropped write leaves the row PENDING with attempts UNTOUCHED, read back from the table', async () => {
    const id = await seedRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(droppingOrchestrator()), openBudget());

    expect(result.fieldsWriteSkipped).toBe(1);
    expect(result.fieldsSupplied).toBe(0);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('PENDING');
    // The whole point: a dropped write must NOT burn the field's backoff budget.
    expect(row.attempts).toBe(0);
    expect(row.lastAttemptAt).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.chosenSource).toBeNull();
  });

  it('a write that LOSES to a higher-priority source (round 5/6 class, against the REAL fixture) records CHECK_FAILED with a real backoff, NEVER SUPPLIED, NEVER EXHAUSTED, and leaves no stranded claim', async () => {
    const id = await seedRow();

    const result = await walkFieldPlanForIPO(IPO_ID, deps(losingOrchestrator()), openBudget());

    expect(result.fieldsSupplied).toBe(0);
    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsExhausted).toBe(0);
    expect(result.fieldsWriteSkipped).toBe(0);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    // Settled and re-askable -- CHECK_FAILED (not TERMINAL_STATES), so
    // recordOutcome scheduled a real backoff instead of nulling next_due_at
    // (same proof pattern as the TRANSIENT-failure case below, now for the
    // "reached the writer but lost the priority race" class).
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.nextDueAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.claimedAt).toBeNull();
    expect(row.claimToken).toBeNull();
    // Never carries chosen_source -- the field was NOT actually sourced from NSE.
    expect(row.chosenSource).toBeNull();
  });

  it('a dropped write is retried by the very next walk -- the field is immediately re-claimable', async () => {
    const id = await seedRow();

    await walkFieldPlanForIPO(IPO_ID, deps(droppingOrchestrator()), openBudget());
    const second = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget());

    expect(second.fieldsSupplied).toBe(1);
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('SUPPLIED');
    expect(row.attempts).toBe(1);
  });

  it('RESUME: a walk killed after claiming field 2 loses only that field, and a later walk reclaims it', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await seedRow({ fieldName: `field${i}` }));

    // Walk 1 settles two fields, then is "killed": it claims a third and never
    // records an outcome. A budget that expires after two fields reproduces the
    // orderly half; the abandoned claim below reproduces the kill.
    let clock = 0;
    const killedWalk = await walkFieldPlanForIPO(
      IPO_ID,
      deps(okOrchestrator(), async () => {
        clock += 60;
        return { outcome: 'SUPPLIED', value: 1 };
      }),
      { deadlineMs: 100, now: () => clock }
    );
    expect(killedWalk.stoppedReason).toBe('BUDGET_EXHAUSTED');
    expect(killedWalk.fieldsSupplied).toBe(2);

    // The kill itself: claim one more row and simply walk away from it, the way
    // a SIGKILL between the claim and the write does.
    const abandoned = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(abandoned).not.toBeNull();
    expect(abandoned!.claimedAt).not.toBeNull();

    // A walk starting NOW cannot take the abandoned row (its claim is live),
    // so it drains only the two untouched fields.
    const promptWalk = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget());
    expect(promptWalk.fieldsSupplied).toBe(2);

    const stillPending = (await readAll()).filter((r) => r.state === 'PENDING');
    expect(stillPending).toHaveLength(1);
    expect(stillPending[0].id).toBe(abandoned!.id);

    // Age the abandoned claim past the staleness window -- the killed process
    // is never coming back to release it.
    await db
      .update(schema.ipoFieldPlan)
      .set({ claimedAt: new Date(Date.now() - (FIELD_PLAN_CLAIM_STALE_MINUTES + 5) * 60_000) })
      .where(eq(schema.ipoFieldPlan.id, abandoned!.id));

    // The resume: a later walk reclaims the stranded field and finishes it.
    const resumeWalk = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget());
    expect(resumeWalk.fieldsSupplied).toBe(1);
    expect(resumeWalk.stoppedReason).toBe('NO_DUE_FIELDS');

    const rows = await readAll();
    expect(rows.filter((r) => r.state === 'SUPPLIED')).toHaveLength(5);
    for (const row of rows) expect(row.claimedAt).toBeNull();
  });

  it('a superseded claim writes NOTHING and stops the walk (the refusal is handled, not ignored)', async () => {
    const id = await seedRow();

    // Claim the row, then steal it: age the claim and re-claim it with a new
    // token, exactly as a second walker would after the first was presumed dead.
    const first = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(first).not.toBeNull();
    await db
      .update(schema.ipoFieldPlan)
      .set({ claimedAt: new Date(Date.now() - (FIELD_PLAN_CLAIM_STALE_MINUTES + 5) * 60_000) })
      .where(eq(schema.ipoFieldPlan.id, id));
    const stealer = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(stealer).not.toBeNull();
    expect(stealer!.claimToken).not.toBe(first!.claimToken);

    // The first walker wakes up and tries to record its stale result.
    const refused = await repo.recordOutcome({
      planRowId: id,
      claimToken: first!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'NSE', rank: 1 },
    });
    expect(refused.written).toBe(false);
    expect(refused.reason).toBe('CLAIM_SUPERSEDED');

    // Nothing was written: the stealer's claim is intact and no state changed.
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('PENDING');
    expect(row.claimToken).toBe(stealer!.claimToken);
    expect(row.chosenSource).toBeNull();
    expect(row.attempts).toBe(0);
  });

  it('an admin-protected field is released UNRECORDED: no state, no attempt, no claim', async () => {
    const id = await seedRow({ fieldName: 'issuePrice' });

    const result = await walkFieldPlanForIPO(
      IPO_ID,
      { ...deps(okOrchestrator()), protectionFilter: async () => true },
      openBudget()
    );

    expect(result.fieldsSkippedProtected).toBe(1);
    expect(result.stoppedReason).toBe('NO_DUE_FIELDS');

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('PENDING');
    expect(row.attempts).toBe(0);
    expect(row.lastAttemptAt).toBeNull();
    expect(row.nextDueAt).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.claimToken).toBeNull();
  });

  it('a DEFINITIVE all-ranks failure records EXHAUSTED, terminal, and never blanks the stored value (§2.6)', async () => {
    const id = await seedRow();

    const definitive: FieldFetcher = async () => ({
      outcome: 'CHECK_FAILED',
      reason: 'the page parsed and the field is not in it',
      transient: false,
    });
    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator(), definitive), openBudget());

    expect(result.fieldsExhausted).toBe(1);
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    expect(row.state).toBe('EXHAUSTED');
    expect(row.attempts).toBe(1);
    expect(row.claimedAt).toBeNull();
    // EXHAUSTED is terminal: no further attempt is scheduled, and the field's
    // stored value in `ipos` was never touched (the walk called no writer).
    expect(row.nextDueAt).toBeNull();
    expect(row.chosenSource).toBeNull();
  });

  it('a TRANSIENT all-ranks failure records CHECK_FAILED and the row is STILL DUE (F1, against the real table)', async () => {
    const id = await seedRow();

    const flaky: FieldFetcher = async () => {
      throw new Error('ETIMEDOUT');
    };
    const result = await walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator(), flaky), openBudget());

    expect(result.fieldsCheckFailed).toBe(1);
    expect(result.fieldsExhausted).toBe(0);

    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    // The proof a mock cannot give: CHECK_FAILED is NOT in TERMINAL_STATES, so
    // the repository scheduled a real backoff instead of nulling next_due_at.
    // A flaky minute costs a delay, never the field.
    expect(row.state).toBe('CHECK_FAILED');
    expect(row.nextDueAt).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.claimedAt).toBeNull();
  });

  it('two concurrent walks never both settle the same field', async () => {
    for (let i = 0; i < 6; i++) await seedRow({ fieldName: `field${i}` });

    const [a, b] = await Promise.all([
      walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget()),
      walkFieldPlanForIPO(IPO_ID, deps(okOrchestrator()), openBudget()),
    ]);

    // Between them they settle each field exactly once -- never twice.
    expect(a.fieldsSupplied + b.fieldsSupplied).toBe(6);
    const rows = await readAll();
    for (const row of rows) {
      expect(row.state).toBe('SUPPLIED');
      expect(row.attempts).toBe(1);
      expect(row.claimedAt).toBeNull();
    }
  });
});
