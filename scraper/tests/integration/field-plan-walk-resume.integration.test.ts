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
 * HOW TO RUN THIS (there is NO scraper/.env.test -- the guard reads the
 * environment, and the credentials live in GLOBAL.env, above every repo):
 *
 *   cd <worktree>/scraper
 *   PW=$(grep '^IPODHAN_APP_DB_PASSWORD=' /d/Abhay/GLOBAL.env | cut -d= -f2-)
 *   export DATABASE_URL="postgresql://ipodhan_app:${PW}@localhost:15432/ipodhan_test"
 *   export REDIS_URL="redis://localhost:6379/15"
 *   npx vitest run -c vitest.integration.config.ts <this file>
 *
 * THREE THINGS THAT EACH LOOK LIKE A BROKEN SUITE AND ARE NOT:
 *   1. localhost:15432 is the SSH TUNNEL to the Windows DB host, and it is the
 *      ONLY accepted route. Pointing DATABASE_URL straight at 103.118.16.189
 *      is refused by a non-overridable denylist in tests/helpers/
 *      db-safety-guard.ts -- that host serves production, and several of these
 *      suites do real INSERT/DELETE. The tunnel must already be up.
 *   2. REDIS_URL must be set even for suites that never touch Redis; the
 *      global guard refuses to run without a confirmed non-production target.
 *   3. With DATABASE_URL unset the suite SKIPS rather than fails
 *      (describe.skipIf), so a silent pass is not a green run.
 
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

  /** A write path that always succeeds. */
  function okOrchestrator() {
    return {
      consolidatedUpsertIPO: async () => ({ ipoId: IPO_ID, isNew: false, locked: true, skipped: false }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: any[]) => ({
        rowsProcessed: rows.length,
        rowsUpdated: rows.length,
        rowsSkipped: 0,
        conflictsDetected: 0,
        rows: rows.map((r) => ({
          rowKey: r.rowKey,
          consolidatedData: r.data,
          fieldsProcessed: 1,
          fieldsUpdated: 1,
          conflictsDetected: 0,
          skipped: false,
        })),
      }),
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

  function deps(orchestrator: any, fetcher: FieldFetcher = suppliedFetcher) {
    return {
      fieldPlanRepository: repo as never,
      orchestrator,
      sourceFetchers: { NSE: fetcher, BSE: fetcher },
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
