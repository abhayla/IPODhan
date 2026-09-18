// implements: #762 (S8) review round 2 CRITICAL + MAJOR-4 -- the walk-loop
// x claim-query interaction, against the REAL repository and a REAL walk.
//
// THE CLASS: round 2's restructured claimNextDueField ranks every PENDING
// candidate (pri = 0) ahead of every reclaim/verify leg (pri = 1). An
// un-handleable PENDING row -- one whose write keeps dropping
// (skipped:true) -- is released back to PENDING with claimed_at cleared
// and attempts UNTOUCHED (releaseClaimUnrecorded / the dropped-write
// branch), so it is immediately reclaimable again, and pri=0 guarantees
// it is the VERY NEXT candidate the claim query returns. The walk's own
// `settledThisWalk` guard (field-plan-walk.ts) then sees the SAME id a
// second time and STOPS THE WHOLE WALK (stoppedReason = 'NO_DUE_FIELDS'),
// discarding every other due row on the IPO -- including thousands of
// genuinely reclaimable NOT_AVAILABLE_YET/CHECK_FAILED rows ranked below
// it purely because they are not PENDING.
//
// MAJOR-4 (round 2): every existing walk unit test stubs
// claimNextDueField, so none of them can expose this -- a stub's queue
// empties instead of handing the SAME row back, exactly the caveat
// field-plan-walk.ts's own `settledThisWalk` doc comment already names for
// the ORIGINAL (round-0) version of this defect class. This file drives
// the REAL claim SQL, the REAL walk loop, and proves the fix
// (claimNextDueField's excludeIds, threaded from the walk's own
// settledThisWalk set) actually reaches the reclaim rows.
//
// SKIPS CLEANLY when no database is configured.
//
// To run:
//   npx vitest run -c vitest.integration.config.ts \
//     tests/integration/field-plan-walk-reclaim-starvation.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { walkFieldPlanForIPO, type FieldFetcher } from '../../src/services/field-plan-walk.js';
import {
  fieldResult,
  consolidatedUpsertResultFixture,
  consolidatedChildRowsResultFixture,
} from '../helpers/consolidation-result-fixture.js';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : '#762 round 2 CRITICAL: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000762d1';
const SLUG = 's8-round2-reclaim-starvation';

const FAKE_REDIS = {} as never;

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)(`#762 round 2 CRITICAL: walk-loop x claim-query starvation (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let repo: IpoFieldPlanRepository;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const dbCheck = await pool.query('select current_database()');
    const currentDb = dbCheck.rows[0].current_database as string;
    if (currentDb !== 'ipodhan_test') {
      throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
    }
    db = drizzle(pool, { schema });
    repo = new IpoFieldPlanRepository(db as never, FAKE_REDIS);

    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S8 Round 2 Starvation Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
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
        fieldName: 'field0',
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
        .where(
          sql`${schema.ipoFieldPlan.ipoId} = ${IPO_ID}::uuid AND ${schema.ipoFieldPlan.tableName} = ${table} AND ${schema.ipoFieldPlan.fieldName} = ${column}`
        )
        .limit(1);
      const ranks = row ? [row.rank1Source, row.rank2Source, row.rank3Source] : [];
      while (ranks.length > 0 && ranks[ranks.length - 1] == null) ranks.pop();
      return { ranks, documentType: undefined, origin: { kind: 'registry' as const, version: 1 }, na: false };
    };
  }

  /** A write path that ALWAYS drops -- the un-handleable-PENDING-row generator. */
  function droppingOrchestrator() {
    return {
      consolidatedUpsertIPO: async () => ({
        ipoId: '',
        isNew: false,
        locked: false,
        skipped: true,
        skipReason: 'LOCK_NOT_ACQUIRED',
      }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: unknown[]) => ({
        rowsProcessed: rows.length,
        rowsUpdated: 0,
        rowsSkipped: rows.length,
        conflictsDetected: 0,
        rows: [],
      }),
    } as never;
  }

  /** A write path that SUCCEEDS -- the reclaim fields' fixture answers with. */
  function okOrchestrator() {
    return {
      consolidatedUpsertIPO: async (scraped: Record<string, unknown>, source: string, _c?: unknown, _p?: unknown, onlyFields?: string[]) => {
        const field = onlyFields?.[0];
        return consolidatedUpsertResultFixture({
          ipoId: IPO_ID,
          fieldResults: field ? [fieldResult(field, scraped[field], source)] : [],
        });
      },
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: { rowKey: string; data: Record<string, unknown> }[], source: string) => {
        const row = rows[0];
        const field = Object.keys(row.data)[0];
        return consolidatedChildRowsResultFixture(row.rowKey, [fieldResult(field, row.data[field], source)], {
          consolidatedData: row.data,
        });
      },
    } as never;
  }

  const suppliedFetcher: FieldFetcher = async () => ({
    outcome: 'SUPPLIED',
    value: 1234,
    documentType: 'RHP',
    page: 7,
  });

  function deps(orchestrator: unknown = okOrchestrator(), fetcher: FieldFetcher = suppliedFetcher, protectionFilter?: (ipoId: string, table: string, field: string) => Promise<boolean>) {
    return {
      fieldPlanRepository: repo as never,
      orchestrator: orchestrator as never,
      sourceFetchers: { NSE: fetcher, BSE: fetcher },
      ipoRepository: ipoRepositoryStub() as never,
      resolvePolicy: resolvePolicyFromSeededRow() as never,
      protectionFilter,
    };
  }

  it('CRITICAL (round 2): one un-handleable PENDING row does NOT starve reclaim rows below it -- the walk reaches and correctly settles them', async () => {
    // The un-handleable row: §2.7's admin-protection path RELEASES the
    // claim WITHOUT recording any state (releaseClaimUnrecorded touches
    // only claimed_at/claim_token) -- the row stays PENDING exactly as
    // seeded, immediately reclaimable, and pri=0 makes it the walk's
    // immediate next candidate under the pre-fix query. This is the
    // reviewer's own named scenario ("protected field, dropped write").
    const stuckId = await seedRow({ fieldName: 'protectedField' });

    // Five genuinely reclaimable rows, already past their slot boundary --
    // exactly the class #762 exists to restore (NOT_AVAILABLE_YET and
    // CHECK_FAILED, both below the attempts ceiling). These use the REAL
    // supplied-write path so the assertion below proves they were not just
    // "touched" but correctly SETTLED.
    const reclaimIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      reclaimIds.push(
        await seedRow({
          fieldName: `reclaimNay${i}`,
          state: 'NOT_AVAILABLE_YET',
          lastAttemptAt: new Date('2026-09-15T01:00:00.000Z'),
          nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
        })
      );
    }
    for (let i = 0; i < 2; i++) {
      reclaimIds.push(
        await seedRow({
          fieldName: `reclaimCf${i}`,
          state: 'CHECK_FAILED',
          attempts: 1,
          lastAttemptAt: new Date('2026-09-15T01:00:00.000Z'),
          nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
        })
      );
    }

    const walkDeps = deps(okOrchestrator(), suppliedFetcher, async (_ipoId, _table, field) => field === 'protectedField');

    const result = await walkFieldPlanForIPO(IPO_ID, walkDeps, openBudget());

    // The point of this test: the protected field is skipped exactly once
    // per walk pass (§2.7's own contract -- it is never re-attempted within
    // the same walk once excludeIds suppresses it), and the CRITICAL fix is
    // that the walk does NOT stop before it reaches the reclaim rows.
    expect(result.fieldsSkippedProtected).toBeGreaterThanOrEqual(1);
    expect(result.fieldsSupplied, 'the reclaim rows must be reached and SUPPLIED -- the starvation bug is back if this is 0').toBe(5);

    const rows = await readAll();
    const reclaimRowsAfter = rows.filter((r) => reclaimIds.includes(r.id));

    // Every reclaim row must have been SETTLED -- state moved to SUPPLIED,
    // not left sitting in NOT_AVAILABLE_YET/CHECK_FAILED with its original
    // frozen last_attempt_at.
    for (const row of reclaimRowsAfter) {
      expect(row.state, `field ${row.fieldName} was not settled -- reclaim starvation`).toBe('SUPPLIED');
      expect(row.claimedAt).toBeNull();
    }

    // The protected row must still exist and still be PENDING (protection
    // never records a state) -- proves the walk did not silently corrupt it
    // while draining the reclaim rows around it.
    const [stuckRow] = rows.filter((r) => r.id === stuckId);
    expect(stuckRow.state).toBe('PENDING');
    expect(stuckRow.attempts).toBe(0);
    expect(stuckRow.claimedAt).toBeNull();
  });

  it('mechanism-level RED: without excludeIds, the claim query hands the SAME released PENDING row back, ahead of every reclaim row', async () => {
    // The precise mechanism the walk-level test above depends on being
    // FIXED: a released PENDING row is immediately reclaimable, and pri=0
    // ranks it ahead of every reclaim leg. This asserts that WITHOUT
    // excludeIds, two successive claims (simulating the walk's claim ->
    // release -> re-claim cycle) return the IDENTICAL row -- the exact
    // precondition that starves the reclaim rows below it. Proves the
    // starvation mechanism is real, independent of the walk's own loop
    // logic (which is what the test above exercises end to end).
    const stuckId = await seedRow({ fieldName: 'protectedOrBrokenField' });
    await seedRow({
      fieldName: 'reclaimNay0',
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt: new Date('2026-09-15T01:00:00.000Z'),
      nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
    });
    const now = new Date('2026-09-15T03:30:00.000Z'); // 09:00 IST -- past the 08:30 slot

    // First claim: takes the PENDING row.
    const first = await repo.claimNextDueField({ ipoId: IPO_ID, now });
    expect(first!.id).toBe(stuckId);

    // Simulate the walk's "write dropped -> released back to PENDING,
    // attempts untouched" branch.
    await repo.releaseClaimUnrecorded({ planRowId: first!.id, claimToken: first!.claimToken });

    // Second claim WITHOUT excludeIds (the round-1 shape): must return the
    // SAME row again, proving the reclaim row is unreachable until
    // excludeIds is applied.
    const second = await repo.claimNextDueField({ ipoId: IPO_ID, now });
    expect(second!.id, 'RED: without excludeIds, the claim query re-offers the same released PENDING row instead of reaching the reclaim row').toBe(stuckId);

    // Release again and prove the FIX: with excludeIds naming the stuck
    // row, the claim query is forced past it to the reclaim row.
    await repo.releaseClaimUnrecorded({ planRowId: second!.id, claimToken: second!.claimToken });
    const third = await repo.claimNextDueField({ ipoId: IPO_ID, now, excludeIds: [stuckId] });
    expect(third!.id, 'GREEN: excludeIds forces the claim past the stuck row to the reclaim row').not.toBe(stuckId);
  });
});
