// implements: item 5 slice s3 -- ipo_field_plan repository (claim + outcome)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (see ipo-field-plan-row-key-unique.integration.test.ts for the same guard).
import * as schema from '../../../packages/shared/src/db/schema';
import {
  IpoFieldPlanRepository,
  FIELD_PLAN_CLAIM_STALE_MINUTES,
  FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
} from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { nextDataJobSlotBoundary } from '../../../packages/shared/src/scheduler/data-job-slots';
import { resolveFieldSourcePolicy, policyOriginString } from '../../src/config/field-source-policy';
import { resolveIpoTypeKey } from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';
import {
  buildFieldPlanIpoGapKeys,
  fieldPlanClaimGapKeys,
  fieldPlanGapKeyFor,
} from '../../src/services/field-plan-gap-keys';

/**
 * Item 5 slice s3 -- the repository that claims a due plan row and writes an
 * attempt's outcome back onto it.
 *
 * THE CLASS this guards (both halves are silent in production if wrong):
 *   (a) a claim that can be taken TWICE under concurrency -- two walkers each
 *       believing they own the row, doing the same fetch and racing each
 *       other's writes. A select-then-update cannot prevent this; only a
 *       single statement with FOR UPDATE SKIP LOCKED can.
 *   (b) a plan row that records SUPPLIED for a write that did not happen --
 *       `consolidatedUpsertIPO` returns `skipped: true,
 *       skipReason: 'LOCK_NOT_ACQUIRED'` SILENTLY
 *       (data-consolidation-orchestrator.ts:137-139), and design §2.3 is
 *       explicit that such a return must leave the row PENDING with
 *       `attempts` UNTOUCHED. A false-clean SUPPLIED reads as success to
 *       every check downstream.
 *   Plus the reclaim half of (a): a killed walk must not strand its row
 *       forever, so a claim older than the staleness window is re-claimable.
 *
 * Covers both singleton ('' row_key) and keyed (fiscal-year) plan rows.
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
 *     tests/integration/ipo-field-plan-repository.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : 'item-5-slice-s3: SKIPPED -- DATABASE_URL not set';

const IPO_ID = '00000000-0000-4000-8000-0000000653f1';
const SLUG = 's3-field-plan-repository';

/** Redis is never touched by this repository; BaseRepository only needs the handle. */
const FAKE_REDIS = {} as never;

function makePool(max = 2): Pool {
  return new Pool({ connectionString: DATABASE_URL, max, options: '-c timezone=UTC' });
}

async function assertTestDatabase(pool: Pool): Promise<void> {
  const dbCheck = await pool.query('select current_database()');
  const currentDb = dbCheck.rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') {
    throw new Error(
      `Refusing to run: connected to '${currentDb}', not 'ipodhan_test'. ` +
        'This integration test only runs against the test database.'
    );
  }
}

describe.skipIf(!DATABASE_URL)(`ipo_field_plan repository (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let repo: IpoFieldPlanRepository;
  let db: ReturnType<typeof drizzle>;
  /** A real documents.id, so chosen_document_id FK-references something that exists. */
  let DOCUMENT_ID: string;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = makePool(4);
    await assertTestDatabase(pool);
    db = drizzle(pool, { schema });
    repo = new IpoFieldPlanRepository(db as never, FAKE_REDIS);

    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.documents).where(eq(schema.documents.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'S3 Field Plan Repo Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
    const [doc] = await db
      .insert(schema.documents)
      .values({
        ipoId: IPO_ID,
        type: 'RHP',
        title: 'S3 Fixture RHP',
        url: 'https://example.test/s3-fixture-rhp.pdf',
      } as never)
      .returning({ id: schema.documents.id });
    DOCUMENT_ID = doc.id;
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.delete(schema.documents).where(eq(schema.documents.ipoId, IPO_ID));
    await db.delete(schema.ipos).where(inArray(schema.ipos.id, [IPO_ID]));
    await pool.end();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
  });

  /** Insert one plan row and return its id. */
  async function seedRow(overrides: Record<string, unknown> = {}): Promise<string> {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipo_details',
        rowKey: '',
        fieldName: 'faceValue',
        state: 'PENDING',
        manifestVersion: 1,
        nextDueAt: new Date(Date.now() - 60_000),
        ...overrides,
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  async function readRow(id: string) {
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id));
    return row;
  }

  /**
   * Force a row immediately claimable again -- PENDING and due in the past --
   * regardless of the state/backoff a prior `recordOutcome` left it in. Used
   * only to set up a SECOND real attempt in the evidence-provenance tests
   * below -- those tests are about `recordOutcome`'s column-merge behaviour,
   * not about the walk's own re-queue-to-PENDING step (item 6, a later slice).
   */
  async function forceDue(id: string): Promise<void> {
    await db
      .update(schema.ipoFieldPlan)
      .set({ state: 'PENDING', nextDueAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.ipoFieldPlan.id, id));
  }

  // ---------------------------------------------------------------- claim ---

  it('claims a due PENDING row, stamping claimed_at and a fresh claim_token', async () => {
    const id = await seedRow();

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(id);
    expect(claimed!.claimToken).toBeTruthy();
    expect(claimed!.claimedAt).toBeInstanceOf(Date);

    const persisted = await readRow(id);
    expect(persisted.claimToken).toBe(claimed!.claimToken);
    expect(persisted.claimedAt).not.toBeNull();
  });

  it('returns null when nothing is due', async () => {
    await seedRow({ nextDueAt: new Date(Date.now() + 3_600_000) });
    expect(await repo.claimNextDueField({ ipoId: IPO_ID })).toBeNull();
  });

  it('a row with a NULL next_due_at is due (a never-attempted row)', async () => {
    await seedRow({ nextDueAt: null });
    expect(await repo.claimNextDueField({ ipoId: IPO_ID })).not.toBeNull();
  });

  it('only PENDING rows are due -- a SUPPLIED row is never claimed', async () => {
    await seedRow({ state: 'SUPPLIED' });
    expect(await repo.claimNextDueField({ ipoId: IPO_ID })).toBeNull();
  });

  it('claims OLDEST-DUE first', async () => {
    const newer = await seedRow({
      fieldName: 'newer',
      nextDueAt: new Date(Date.now() - 10_000),
    });
    const older = await seedRow({
      fieldName: 'older',
      nextDueAt: new Date(Date.now() - 900_000),
    });

    const first = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(first!.id).toBe(older);
    const second = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(second!.id).toBe(newer);
  });

  it('a keyed (fiscal-year) plan row claims exactly like a singleton row', async () => {
    const id = await seedRow({
      tableName: 'financial_statements',
      rowKey: 'FY2024',
      fieldName: 'revenue',
    });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(claimed!.id).toBe(id);
    expect(claimed!.rowKey).toBe('FY2024');
  });

  // ------------------------------------------------------------- reclaim ---

  it('a FRESH claim is NOT re-claimable', async () => {
    await seedRow({ claimedAt: new Date(), claimToken: 'held-by-a-live-walker' });
    expect(await repo.claimNextDueField({ ipoId: IPO_ID })).toBeNull();
  });

  it('a claim OLDER than the staleness window IS re-claimable, with a NEW token', async () => {
    const staleAt = new Date(Date.now() - (FIELD_PLAN_CLAIM_STALE_MINUTES + 5) * 60_000);
    const id = await seedRow({ claimedAt: staleAt, claimToken: 'token-of-a-killed-walk' });

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(id);
    expect(claimed!.claimToken).not.toBe('token-of-a-killed-walk');

    const persisted = await readRow(id);
    expect(persisted.claimToken).toBe(claimed!.claimToken);
  });

  // ------------------------------------------------ S8 re-ask (#762) ---
  //
  // #762 RCA: the spec's four-way OR (PENDING, OR verify_state=DUE, OR a
  // NOT_AVAILABLE_YET/CHECK_FAILED reclaim once due, OR a stale claim)
  // shipped as ONE branch (state='PENDING' only). NOT_AVAILABLE_YET and
  // CHECK_FAILED rows -- 12,480 of them on staging -- were never reclaimed.
  // These tests pin each restored branch, keyed on SLOT boundaries
  // (the data job's OD-19 slots, packages/shared/src/scheduler/data-job-slots.ts), never on an elapsed
  // interval (OD-33/D12 forbid a timer).

  it('#762: a NOT_AVAILABLE_YET row whose last attempt was in a PREVIOUS slot IS claimed', async () => {
    // 2026-09-15 07:00 IST is before the 08:00 slot; "now" below is set to
    // 09:00 IST, i.e. one slot boundary (08:00) has passed since the attempt.
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z'); // 07:00 IST
    const now = new Date('2026-09-15T03:30:00.000Z'); // 09:00 IST
    const id = await seedRow({
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000), // far in the future -- must be IGNORED
    });

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(id);
  });

  it('#762: the SAME NOT_AVAILABLE_YET row is NOT claimed again within the SAME slot', async () => {
    const lastAttemptAt = new Date('2026-09-15T03:00:00.000Z'); // 08:30 IST -- after the 08:00 slot boundary
    const now = new Date('2026-09-15T03:45:00.000Z'); // 09:15 IST -- same slot as the attempt
    await seedRow({
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    expect(await repo.claimNextDueField({ ipoId: IPO_ID, now })).toBeNull();
  });

  it('#762: a CHECK_FAILED row is reclaimable once a new slot has begun', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z'); // 07:00 IST
    const now = new Date('2026-09-15T03:30:00.000Z'); // 09:00 IST
    const id = await seedRow({
      state: 'CHECK_FAILED',
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(id);
  });

  it('#762: a CHECK_FAILED row at or past the attempts ceiling is NEVER reclaimed', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z');
    const now = new Date('2026-09-15T03:30:00.000Z');
    await seedRow({
      state: 'CHECK_FAILED',
      lastAttemptAt,
      attempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    expect(await repo.claimNextDueField({ ipoId: IPO_ID, now })).toBeNull();
  });

  it('#762: a SUPPLIED row is never claimed by the re-ask path, even across a slot boundary', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z');
    const now = new Date('2026-09-15T03:30:00.000Z');
    await seedRow({ state: 'SUPPLIED', lastAttemptAt });

    expect(await repo.claimNextDueField({ ipoId: IPO_ID, now })).toBeNull();
  });

  it('#762: an EXHAUSTED row is never claimed by the re-ask path', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z');
    const now = new Date('2026-09-15T03:30:00.000Z');
    await seedRow({ state: 'EXHAUSTED', lastAttemptAt });

    expect(await repo.claimNextDueField({ ipoId: IPO_ID, now })).toBeNull();
  });

  // The two `verify_state=DUE` trigger-4 tests that used to live here were
  // removed in S2 (docs/design/s2-witnesses-plan.md): `verify_state` and
  // `verify_due_at` are DROPPED from `ipo_field_plan`, and the claim query's
  // `verify_due_leg` (documented as dead code — nothing ever wrote those
  // columns) is removed in the same change.
  // NOTE (found this session, filed separately, not an S2 regression): with
  // the columns still present pre-S2, the first of those two tests already
  // failed (`expected null not to be null`) on this branch's base commit
  // (2bdcea47) — a pre-existing bug in the trigger-4 leg or its walk-level
  // caller, unrelated to S2's schema-only scope. S2 does not fix it; it
  // removes the dead leg the bug lived in.

  it('#762: PENDING (genuinely new work) is claimed before a due reclaim on the same IPO', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z');
    const now = new Date('2026-09-15T03:30:00.000Z');
    await seedRow({
      fieldName: 'reclaimCandidate',
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });
    const pendingId = await seedRow({
      fieldName: 'freshPending',
      state: 'PENDING',
      nextDueAt: new Date(now.getTime() - 60_000),
    });

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now });
    expect(claimed!.id).toBe(pendingId);
  });

  it('#762: churn guard bounds the exact number of CHECK_FAILED rows reclaimable in one slot', async () => {
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z');
    const now = new Date('2026-09-15T03:30:00.000Z');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(
        await seedRow({
          fieldName: `churn${i}`,
          state: 'CHECK_FAILED',
          lastAttemptAt,
          attempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS - 1,
          nextDueAt: new Date(now.getTime() + 3_600_000),
        })
      );
    }
    // The row AT the ceiling must be excluded from the count entirely.
    await seedRow({
      fieldName: 'atCeiling',
      state: 'CHECK_FAILED',
      lastAttemptAt,
      attempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    let claimedCount = 0;
    for (let i = 0; i < 4; i++) {
      const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now });
      if (!claimed) break;
      claimedCount += 1;
    }
    expect(claimedCount).toBe(3);
  });

  // ---------------------------- review round 2 CRITICAL: excludeIds -------
  //
  // A released-but-still-PENDING row (a dropped write, or an admin-protection
  // skip) is immediately re-claimable and `pri = 0` ranks it ahead of every
  // reclaim/verify leg -- without excludeIds the SAME row comes back forever
  // and the walk's own re-claim guard then stops the entire walk (see
  // field-plan-walk.ts's round-2 fix and its own dedicated real-walk-loop
  // test in field-plan-walk-reclaim-starvation.integration.test.ts, DoD A).

  it('#762 round 2: excludeIds keeps a released PENDING row out of the NEXT claim, returning a genuinely different row', async () => {
    const stuckId = await seedRow({ fieldName: 'stuckPending', state: 'PENDING', nextDueAt: new Date(Date.now() - 60_000) });
    const otherId = await seedRow({
      fieldName: 'reclaimable',
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt: new Date('2026-09-15T01:30:00.000Z'),
      nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
    });
    const now = new Date('2026-09-15T03:30:00.000Z');

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now, excludeIds: [stuckId] });

    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe(otherId);
    expect(claimed!.id).not.toBe(stuckId);
  });

  it('#762 round 2: an empty excludeIds array excludes nothing (a fresh walk claims normally)', async () => {
    const id = await seedRow({ state: 'PENDING', nextDueAt: new Date(Date.now() - 60_000) });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, excludeIds: [] });
    expect(claimed!.id).toBe(id);
  });

  it('#762 round 2: excludeIds excludes across EVERY leg, not just PENDING (a released reclaim row is also skipped)', async () => {
    const now = new Date('2026-09-15T03:30:00.000Z');
    const excludedId = await seedRow({
      fieldName: 'excludedReclaim',
      state: 'CHECK_FAILED',
      lastAttemptAt: new Date('2026-09-15T01:00:00.000Z'),
      nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
    });
    const otherId = await seedRow({
      fieldName: 'otherReclaim',
      state: 'CHECK_FAILED',
      lastAttemptAt: new Date('2026-09-15T01:30:00.000Z'),
      nextDueAt: new Date('2026-09-16T00:00:00.000Z'),
    });

    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now, excludeIds: [excludedId] });
    expect(claimed!.id).toBe(otherId);
  });

  // ---------------------------- review round 2 MAJOR-2: TZ-independence ---
  //
  // All four compared timestamp columns are `timestamp WITHOUT time zone`.
  // Casting the bound JS Date to `::timestamptz` (the round-1 shape) makes
  // Postgres resolve it through the SESSION timezone before comparing --
  // under Asia/Kolkata that silently shifts the bound value by 5h30m
  // relative to UTC. This test runs the SAME claim under both session
  // timezones and asserts an IDENTICAL result -- proving the query no
  // longer depends on session TZ state.

  // Each TZ test opens its OWN dedicated pool (makePool(1)) and `.end()`s it
  // in a `finally`, exactly like the concurrency tests below -- never a
  // connection borrowed from and released back to the SHARED `pool`/`db`
  // this whole file's other ~50 tests reuse. A pooled connection's session
  // `SET TIME ZONE` is NOT reset by `.release()` (found live: this file's
  // very first version of these two tests leaked an Asia/Kolkata session
  // back into the pool, which then silently misread every OTHER test's
  // naive-timestamp comparisons for the rest of the run -- 5 unrelated
  // tests failed with "expected null, got a row" purely from pool-order
  // luck, nothing to do with the query itself).

  it('#762 round 2 (MAJOR-2): claim result is IDENTICAL under SET TIME ZONE UTC vs Asia/Kolkata', async () => {
    const now = new Date('2026-09-15T09:00:00.000Z'); // 14:30 IST -- past the 08:00 and 14:00 slots
    const lastAttemptAt = new Date('2026-09-15T01:30:00.000Z'); // 07:00 IST -- before the 08:00 slot boundary
    const id = await seedRow({
      state: 'NOT_AVAILABLE_YET',
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    const utcPool = makePool(1);
    try {
      await utcPool.query("SET TIME ZONE 'UTC'");
      const utcRepo = new IpoFieldPlanRepository(drizzle(utcPool, { schema }) as never, FAKE_REDIS);
      const claimedUtc = await utcRepo.claimNextDueField({ ipoId: IPO_ID, now });
      expect(claimedUtc).not.toBeNull();
      expect(claimedUtc!.id).toBe(id);
    } finally {
      await utcPool.end();
    }

    // Release it and reclaim the identical row under a SEPARATE, disposable
    // Asia/Kolkata pool.
    await db
      .update(schema.ipoFieldPlan)
      .set({ claimedAt: null, claimToken: null })
      .where(eq(schema.ipoFieldPlan.id, id));

    const kolkataPool = makePool(1);
    try {
      await kolkataPool.query("SET TIME ZONE 'Asia/Kolkata'");
      const kolkataRepo = new IpoFieldPlanRepository(drizzle(kolkataPool, { schema }) as never, FAKE_REDIS);
      const claimedKolkata = await kolkataRepo.claimNextDueField({ ipoId: IPO_ID, now });
      expect(claimedKolkata).not.toBeNull();
      expect(claimedKolkata!.id).toBe(id);
    } finally {
      await kolkataPool.end();
    }
  });

  it('#762 round 2 (MAJOR-2): a row just past a slot boundary is reclaimed identically under both session timezones (the exact skew the round-1 bug would have hit)', async () => {
    const now = new Date('2026-09-15T03:31:00.000Z'); // 09:01 IST -- an hour past the 08:00 slot boundary
    const lastAttemptAt = new Date('2026-09-15T03:29:00.000Z'); // 08:59 IST -- in the CURRENT slot, not yet due by the slot rule
    const id = await seedRow({
      state: 'CHECK_FAILED',
      attempts: 1,
      lastAttemptAt,
      nextDueAt: new Date(now.getTime() + 3_600_000),
    });

    for (const tz of ['UTC', 'Asia/Kolkata']) {
      await db.update(schema.ipoFieldPlan).set({ claimedAt: null, claimToken: null }).where(eq(schema.ipoFieldPlan.id, id));
      const tzPool = makePool(1);
      try {
        await tzPool.query(`SET TIME ZONE '${tz}'`);
        const tzRepo = new IpoFieldPlanRepository(drizzle(tzPool, { schema }) as never, FAKE_REDIS);
        const claimed = await tzRepo.claimNextDueField({ ipoId: IPO_ID, now });
        // Assert consistency, not a specific due/not-due answer -- that is
        // what MAJOR-2 requires: the SAME answer under both TZs.
        expect(claimed, `tz=${tz}`).toBeNull();
      } finally {
        await tzPool.end();
      }
    }
  });

  // ---------------------------------------------------- CONCURRENT claim ---

  it('THE CLASS: two REAL connections racing the same single due row -- exactly one wins', async () => {
    await seedRow();

    // Two separate pools => two separate physical connections. A
    // select-then-update implementation lets BOTH see the row as unclaimed
    // and both stamp it; only FOR UPDATE SKIP LOCKED inside ONE statement
    // makes the loser see nothing.
    const poolA = makePool(1);
    const poolB = makePool(1);
    try {
      await assertTestDatabase(poolA);
      await assertTestDatabase(poolB);
      const repoA = new IpoFieldPlanRepository(drizzle(poolA, { schema }) as never, FAKE_REDIS);
      const repoB = new IpoFieldPlanRepository(drizzle(poolB, { schema }) as never, FAKE_REDIS);

      const [a, b] = await Promise.all([
        repoA.claimNextDueField({ ipoId: IPO_ID }),
        repoB.claimNextDueField({ ipoId: IPO_ID }),
      ]);

      const winners = [a, b].filter((r) => r !== null);
      expect(winners.length).toBe(1);
      expect([a, b].filter((r) => r === null).length).toBe(1);

      // and the row carries exactly the winner's token
      const persisted = await readRow(winners[0]!.id);
      expect(persisted.claimToken).toBe(winners[0]!.claimToken);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  }, 60000);

  it('THE CLASS: a row locked by another live transaction is SKIPPED, not waited on', async () => {
    // The two-connection race above is necessary but NOT sufficient: plain
    // `FOR UPDATE` also yields one winner, because the loser BLOCKS until the
    // winner commits and then re-evaluates the row as claimed. That makes the
    // race test pass against an implementation that has no SKIP LOCKED at all
    // (proven: removing SKIP LOCKED left all other tests green).
    //
    // What only SKIP LOCKED gives is that the loser does not WAIT. So: hold a
    // real row lock open in its own transaction and claim from another
    // connection. SKIP LOCKED skips the locked row and returns promptly;
    // plain FOR UPDATE blocks on it until the holder commits, which here
    // means until the statement timeout fires.
    const id = await seedRow();

    const holder = makePool(1);
    // A short statement timeout on the CLAIMER's own connections turns
    // "blocks forever" into a fast, loud failure instead of a test hang.
    const claimer = new Pool({
      connectionString: DATABASE_URL,
      max: 1,
      options: '-c timezone=UTC',
      statement_timeout: 4000,
    });
    try {
      const holderClient = await holder.connect();
      await holderClient.query('BEGIN');
      await holderClient.query('SELECT id FROM ipo_field_plan WHERE id = $1 FOR UPDATE', [id]);

      const repoClaimer = new IpoFieldPlanRepository(
        drizzle(claimer, { schema }) as never,
        FAKE_REDIS
      );

      const started = Date.now();
      const claimed = await repoClaimer.claimNextDueField({ ipoId: IPO_ID });
      const elapsed = Date.now() - started;

      // SKIP LOCKED: the only due row is locked, so nothing is claimable.
      expect(claimed).toBeNull();
      // and it came back promptly rather than blocking on the lock
      expect(elapsed).toBeLessThan(3000);

      await holderClient.query('ROLLBACK');
      holderClient.release();
    } finally {
      await holder.end();
      await claimer.end();
    }
  }, 60000);

  it('two REAL connections racing TWO due rows -- each gets a different row', async () => {
    await seedRow({ fieldName: 'a', nextDueAt: new Date(Date.now() - 900_000) });
    await seedRow({ fieldName: 'b', nextDueAt: new Date(Date.now() - 800_000) });

    const poolA = makePool(1);
    const poolB = makePool(1);
    try {
      const repoA = new IpoFieldPlanRepository(drizzle(poolA, { schema }) as never, FAKE_REDIS);
      const repoB = new IpoFieldPlanRepository(drizzle(poolB, { schema }) as never, FAKE_REDIS);
      const [a, b] = await Promise.all([
        repoA.claimNextDueField({ ipoId: IPO_ID }),
        repoB.claimNextDueField({ ipoId: IPO_ID }),
      ]);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.id).not.toBe(b!.id);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  }, 60000);

  // ------------------------------------------------------- recordOutcome ---

  it('records a SUPPLIED outcome with its evidence, and bumps attempts', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: {
        source: 'DOC',
        rank: 1,
        documentType: 'RHP',
        sha256: 'a'.repeat(64),
        page: 42,
      },
      // S1a review CRITICAL-1: policy_origin travels with the SAME UPDATE
      // as chosen_*, so this one test proves both column families are set
      // by the SAME recordOutcome call rather than needing a second test.
      policyOrigin: 'registry:3',
    });

    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('SUPPLIED');
    expect(persisted.attempts).toBe(1);
    expect(persisted.lastAttemptAt).not.toBeNull();
    expect(persisted.chosenSource).toBe('DOC');
    expect(persisted.chosenRank).toBe(1);
    expect(persisted.chosenDocumentType).toBe('RHP');
    expect(persisted.chosenSha256).toBe('a'.repeat(64));
    expect(persisted.chosenPage).toBe(42);
    expect(persisted.policyOrigin).toBe('registry:3');
    // the claim is released so nothing holds the row
    expect(persisted.claimToken).toBeNull();
    expect(persisted.claimedAt).toBeNull();
  });

  it('policyOrigin omitted leaves the column exactly as it was (no accidental null-out)', async () => {
    const id = await seedRow();
    await db.execute(sql`UPDATE ipo_field_plan SET policy_origin = 'registry:1' WHERE id = ${id}::uuid`);
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      // policyOrigin deliberately omitted.
    });

    const persisted = await readRow(id);
    expect(persisted.state).toBe('CHECK_FAILED');
    expect(persisted.policyOrigin).toBe('registry:1');
  });

  it('a FAILED attempt stays PENDING, bumps attempts and is next due at the next data slot (F-152: no elapsed-time backoff)', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    const now = new Date();
    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'PENDING',
      now,
    });
    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('PENDING');
    expect(persisted.attempts).toBe(1);
    expect(persisted.nextDueAt!.toISOString()).toBe(nextDataJobSlotBoundary(now).toISOString());
  });

  it('F-152: a transient CHECK_FAILED is next due at the start of the next data slot, whatever its attempt count', async () => {
    const id = await seedRow({ attempts: 3 });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    const now = new Date();
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      reasonCode: 'SOURCE_UNREACHABLE',
      cause: 'rank1:NSE:THROWN:ETIMEDOUT',
      now,
    });
    const persisted = await readRow(id);
    expect(persisted.state).toBe('CHECK_FAILED');
    expect(persisted.attempts).toBe(4);
    // Was now + 60 min (15 * 2^3 capped); now a slot boundary.
    expect(persisted.nextDueAt!.toISOString()).toBe(nextDataJobSlotBoundary(now).toISOString());
  });

  it('F-152: a structural gap (gapKey) is written definitive — exact columns, no next-due time, no attempt charged', async () => {
    const id = await seedRow({ attempts: 2 });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    const now = new Date();
    const cause = 'rank1:NSE:CHECK_FAILED:no mapping [gap:NO_MAPPING]';
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      reasonCode: 'COVERAGE_GAP',
      cause,
      gapKey: 'k-structural',
      now,
    });
    const persisted = await readRow(id);
    expect(persisted.state).toBe('CHECK_FAILED');
    expect(persisted.nextDueAt).toBeNull();
    expect(persisted.attempts).toBe(2);
    expect(persisted.reasonCode).toBe('COVERAGE_GAP');
    expect(persisted.cause).toBe(`[gap-key:k-structural] ${cause}`);
    expect(persisted.lastAttemptAt).not.toBeNull();
    expect(persisted.claimToken).toBeNull();
    expect(persisted.claimedAt).toBeNull();
  });

  it('THE CLASS: a SKIPPED write leaves the row PENDING with attempts UNTOUCHED', async () => {
    // `consolidatedUpsertIPO` returning skipped/LOCK_NOT_ACQUIRED means the
    // write never happened. Marking SUPPLIED here would be a false-clean
    // state; counting an attempt would burn the field's backoff budget for
    // work that was never done.
    const id = await seedRow({ attempts: 3 });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    const afterClaim = await readRow(id);

    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: false,
      skipReason: 'LOCK_NOT_ACQUIRED',
      // A caller may WANT to say SUPPLIED; the skipped branch must override it.
      state: 'SUPPLIED',
      chosen: { source: 'DOC', rank: 1 },
    });

    expect(result.written).toBe(true);
    expect(result.skipped).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('PENDING');
    expect(persisted.attempts).toBe(3);
    expect(persisted.chosenSource).toBeNull();
    expect(persisted.chosenRank).toBeNull();
    // last_attempt_at must not move either -- nothing was attempted
    expect(persisted.lastAttemptAt?.getTime() ?? null).toBe(
      afterClaim.lastAttemptAt?.getTime() ?? null
    );
    // but the claim IS released, so the row is re-claimable at once
    expect(persisted.claimToken).toBeNull();
  });

  it('THE CLASS: a SUPERSEDED token writes NOTHING at all', async () => {
    const id = await seedRow();
    const stale = await repo.claimNextDueField({ ipoId: IPO_ID });
    const staleToken = stale!.claimToken!;

    // the row is reclaimed by a newer walker (simulated by a direct re-stamp)
    await db
      .update(schema.ipoFieldPlan)
      .set({ claimToken: 'token-of-the-newer-walker', claimedAt: new Date() })
      .where(eq(schema.ipoFieldPlan.id, id));
    const before = await readRow(id);

    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: staleToken,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'DOC', rank: 1, sha256: 'b'.repeat(64) },
    });

    expect(result.written).toBe(false);
    expect(result.reason).toBe('CLAIM_SUPERSEDED');

    // RE-READ THE ROW: the assertion that matters is that nothing moved.
    const after = await readRow(id);
    expect(after.state).toBe(before.state);
    expect(after.attempts).toBe(before.attempts);
    expect(after.chosenSource).toBeNull();
    expect(after.chosenSha256).toBeNull();
    expect(after.claimToken).toBe('token-of-the-newer-walker');
    expect(after.lastAttemptAt?.getTime() ?? null).toBe(before.lastAttemptAt?.getTime() ?? null);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('a superseded token cannot sneak a SKIPPED write through either', async () => {
    const id = await seedRow();
    const stale = await repo.claimNextDueField({ ipoId: IPO_ID });
    await db
      .update(schema.ipoFieldPlan)
      .set({ claimToken: 'newer', claimedAt: new Date() })
      .where(eq(schema.ipoFieldPlan.id, id));

    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: stale!.claimToken!,
      writeHappened: false,
      skipReason: 'LOCK_NOT_ACQUIRED',
    });

    expect(result.written).toBe(false);
    const after = await readRow(id);
    expect(after.claimToken).toBe('newer');
  });

  it('a keyed (fiscal-year) row records its outcome exactly like a singleton row', async () => {
    const id = await seedRow({
      tableName: 'financial_statements',
      rowKey: 'FY2023',
      fieldName: 'revenue',
    });
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'NOT_PRINTED',
    });
    const persisted = await readRow(id);
    expect(persisted.state).toBe('NOT_PRINTED');
    expect(persisted.rowKey).toBe('FY2023');
    expect(persisted.attempts).toBe(1);
  });

  it('records a terminal EXHAUSTED state without scheduling another attempt', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'EXHAUSTED',
    });
    const persisted = await readRow(id);
    expect(persisted.state).toBe('EXHAUSTED');
    expect(persisted.nextDueAt).toBeNull();
  });

  it('records a non-terminal NOT_AVAILABLE_YET state and schedules a backoff retry', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    const before = Date.now();
    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'NOT_AVAILABLE_YET',
    });
    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('NOT_AVAILABLE_YET');
    expect(persisted.attempts).toBe(1);
    // non-terminal: the ask is retried, so a next attempt IS scheduled
    expect(persisted.nextDueAt).not.toBeNull();
    expect(persisted.nextDueAt!.getTime()).toBeGreaterThan(before);
  });

  it('records a non-terminal CHECK_FAILED state and schedules a backoff retry', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    const before = Date.now();
    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
    });
    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('CHECK_FAILED');
    expect(persisted.attempts).toBe(1);
    // non-terminal: the ask is retried, so a next attempt IS scheduled
    expect(persisted.nextDueAt).not.toBeNull();
    expect(persisted.nextDueAt!.getTime()).toBeGreaterThan(before);
  });

  // ------------------------------------------------- evidence provenance ---

  it('THE CLASS: chosen evidence from a second, different-source outcome does NOT splice onto the first source\'s columns', async () => {
    // Attempt 1: a document-backed source wins.
    const id = await seedRow();
    const claim1 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim1!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED', // non-terminal so the row is due again
      chosen: {
        source: 'DOC_RHP',
        rank: 1,
        documentId: DOCUMENT_ID,
        documentType: 'RHP',
        sha256: 'a'.repeat(64),
        page: 12,
      },
    });

    // Attempt 2: a DIFFERENT, non-document-backed source wins. The caller
    // legitimately omits documentId/documentType/sha256/page because this
    // source has none of those -- ChosenEvidence makes every field optional.
    await forceDue(id);
    const claim2 = await repo.claimNextDueField({ ipoId: IPO_ID });
    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claim2!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'CHITTORGARH', rank: 2 },
    });
    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.chosenSource).toBe('CHITTORGARH');
    expect(persisted.chosenRank).toBe(2);
    // THE BUG: these must NOT still carry attempt 1's document evidence --
    // a row that reads chosen_source='CHITTORGARH' with chosen_document_id
    // set is a FALSE PROVENANCE RECORD (CHITTORGARH is never document-backed).
    expect(persisted.chosenDocumentId).toBeNull();
    expect(persisted.chosenDocumentType).toBeNull();
    expect(persisted.chosenSha256).toBeNull();
    expect(persisted.chosenPage).toBeNull();
  });

  it('a keyed row: chosen evidence from a second outcome does not splice onto the first', async () => {
    const id = await seedRow({
      tableName: 'financial_statements',
      rowKey: 'FY2025',
      fieldName: 'revenue',
    });
    const claim1 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim1!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      chosen: {
        source: 'DOC_RHP',
        documentId: DOCUMENT_ID,
        sha256: 'c'.repeat(64),
        page: 7,
      },
    });

    await forceDue(id);
    const claim2 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim2!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'CHITTORGARH' },
    });

    const persisted = await readRow(id);
    expect(persisted.chosenSource).toBe('CHITTORGARH');
    expect(persisted.chosenDocumentId).toBeNull();
    expect(persisted.chosenSha256).toBeNull();
    expect(persisted.chosenPage).toBeNull();
  });

  it('omitting `chosen` entirely leaves all six evidence columns untouched', async () => {
    const id = await seedRow();
    const claim1 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim1!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      chosen: { source: 'DOC_RHP', documentId: DOCUMENT_ID, page: 5 },
    });

    await forceDue(id);
    const claim2 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim2!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED', // no `chosen` at all this time
    });

    const persisted = await readRow(id);
    // evidence from attempt 1 is preserved -- no new evidence was offered
    expect(persisted.chosenSource).toBe('DOC_RHP');
    expect(persisted.chosenDocumentId).toBe(DOCUMENT_ID);
    expect(persisted.chosenPage).toBe(5);
  });

  // ------------------------------------------- chosen_confirmed_at (item 21) ---
  //
  // OD-39 + OD-72: the page states the source and the date it was READ. That
  // date is stamped only when a row is recorded SUPPLIED with its evidence;
  // updated_at moves on any write and must not stand in for it.

  it('item 21: a SUPPLIED outcome with evidence stamps chosen_confirmed_at with the read instant (UTC, drift 0)', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    const readAt = new Date('2026-09-21T05:00:00.000Z'); // 10:30 IST
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'DOC', rank: 1, documentType: 'RHP' },
      now: readAt,
    });
    const raw = await db.execute(sql`SELECT chosen_confirmed_at::text AS t FROM ipo_field_plan WHERE id = ${id}::uuid`);
    // Round-trip the stored TEXT, not a parsed Date (ist-timezone rule): a 5h30m shift would show here.
    expect((raw as unknown as { rows: { t: string }[] }).rows[0].t).toBe('2026-09-21 05:00:00');
    const persisted = await readRow(id);
    expect(persisted.chosenConfirmedAt!.toISOString()).toBe(readAt.toISOString());
  });

  it('item 21: a later non-SUPPLIED write leaves chosen_confirmed_at exactly as it was (updated_at moves, the read date does not)', async () => {
    const id = await seedRow();
    const claim1 = await repo.claimNextDueField({ ipoId: IPO_ID });
    const readAt = new Date('2026-09-21T05:00:00.000Z');
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim1!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { source: 'DOC', rank: 1, documentType: 'RHP' },
      now: readAt,
    });
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'PENDING' WHERE id = ${id}::uuid`);
    await forceDue(id);
    const claim2 = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claim2!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      now: new Date('2026-09-23T05:00:00.000Z'),
    });
    const persisted = await readRow(id);
    expect(persisted.chosenConfirmedAt!.toISOString()).toBe(readAt.toISOString());
    expect(persisted.updatedAt.getTime()).toBeGreaterThan(readAt.getTime());
  });

  it('item 21: a SUPPLIED outcome that names NO chosen source gets NO read date', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      chosen: { rank: 1 },
      now: new Date('2026-09-21T05:00:00.000Z'),
    });
    const persisted = await readRow(id);
    expect(persisted.chosenSource).toBeNull();
    expect(persisted.chosenConfirmedAt).toBeNull();
  });

  it('item 21: migration 0058 backfills the read date from last_attempt_at for SUPPLIED rows that name a source, and only those', async () => {
    const withSource = await seedRow({ state: 'SUPPLIED', chosenSource: 'DOC', fieldName: 'faceValue' });
    const noSource = await seedRow({ state: 'SUPPLIED', chosenSource: null, fieldName: 'issueSize' });
    const notSupplied = await seedRow({ state: 'CHECK_FAILED', chosenSource: 'DOC', fieldName: 'lotSize' });
    const already = await seedRow({ state: 'SUPPLIED', chosenSource: 'BSE', fieldName: 'upiCutoffTime' });
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = '2026-09-19 03:17:55', chosen_confirmed_at = NULL WHERE id IN (${withSource}::uuid, ${noSource}::uuid, ${notSupplied}::uuid)`);
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = '2026-09-19 03:17:55', chosen_confirmed_at = '2026-09-01 00:00:00' WHERE id = ${already}::uuid`);
    const file = readFileSync(
      fileURLToPath(new URL('../../../web/drizzle/migrations/0058_ipo_field_plan_chosen_confirmed_at.sql', import.meta.url)),
      'utf8'
    );
    const update = file.split('--> statement-breakpoint').map((x) => x.trim()).find((x) => x.startsWith('UPDATE'));
    expect(update).toBeTruthy();
    await db.execute(sql.raw(update!));
    const read = async (id: string) =>
      ((await db.execute(sql`SELECT chosen_confirmed_at::text AS t FROM ipo_field_plan WHERE id = ${id}::uuid`)) as unknown as {
        rows: { t: string | null }[];
      }).rows[0].t;
    expect(await read(withSource)).toBe('2026-09-19 03:17:55');
    expect(await read(noSource)).toBeNull();
    expect(await read(notSupplied)).toBeNull();
    expect(await read(already)).toBe('2026-09-01 00:00:00');
  });

  it('item 21: a row never recorded SUPPLIED has NO read date (null, never a fabricated one)', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'CHECK_FAILED',
      chosen: { source: 'DOC', rank: 1 },
    });
    const persisted = await readRow(id);
    expect(persisted.chosenConfirmedAt).toBeNull();
  });

  // ------------------------------------------- releaseClaimUnrecorded ---
  //
  // F2 (Tier A review): this method was added by item 6 AFTER this repository
  // was reviewed and merged, so the original review never saw it. It is raw
  // SQL on a production table and its only coverage was a vi.fn() stub, which
  // exercises none of the SQL. The token check below is the ONLY thing
  // stopping a superseded walker from releasing a LIVE walker's claim --
  // deleting it left all 27 unit tests passing.

  it('releaseClaimUnrecorded with a MATCHING token clears both claimed_at and claim_token', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    // Pin the identity: `beforeEach` clears this IPO's rows, but asserting it
    // makes a surprise (a row from elsewhere) a named failure rather than a
    // confusing null assertion three lines later.
    expect(claimed!.id).toBe(id);
    expect(claimed!.claimToken).toBeTruthy();

    const released = await repo.releaseClaimUnrecorded({
      planRowId: id,
      claimToken: claimed!.claimToken!,
    });

    expect(released.released).toBe(true);
    const persisted = await readRow(id);
    expect(persisted.claimedAt).toBeNull();
    expect(persisted.claimToken).toBeNull();
    // The whole point of "unrecorded": NOTHING else moved. No attempt was
    // charged and no state was written. `next_due_at` keeps whatever the row
    // already had (seedRow backdates it so the row is due) -- release must not
    // schedule a backoff, and it must not clear an existing schedule either.
    expect(persisted.state).toBe('PENDING');
    expect(persisted.attempts).toBe(0);
    expect(persisted.lastAttemptAt).toBeNull();
  });

  it('releaseClaimUnrecorded with a NON-matching token changes nothing and reports the refusal', async () => {
    const id = await seedRow();
    const live = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(live!.claimToken).toBeTruthy();

    const released = await repo.releaseClaimUnrecorded({
      planRowId: id,
      claimToken: '00000000-0000-4000-8000-00000000dead',
    });

    expect(released.released).toBe(false);
    expect(released.reason).toBe('CLAIM_SUPERSEDED');

    // The LIVE walker's claim is untouched -- this is the guard's whole job.
    const persisted = await readRow(id);
    expect(persisted.claimToken).toBe(live!.claimToken);
    expect(persisted.claimedAt).not.toBeNull();
  });

  it('a released row is immediately re-claimable, and by a DIFFERENT token', async () => {
    const id = await seedRow();
    const first = await repo.claimNextDueField({ ipoId: IPO_ID });
    await repo.releaseClaimUnrecorded({ planRowId: id, claimToken: first!.claimToken! });

    const second = await repo.claimNextDueField({ ipoId: IPO_ID });

    expect(second).not.toBeNull();
    expect(second!.id).toBe(id);
    expect(second!.claimToken).not.toBe(first!.claimToken);
    expect((await readRow(id)).attempts).toBe(0);
  });

  // ------------------------------------------------ item 3 slice S2 -------
  // Re-ranking non-terminal rows to the current manifest version, and
  // planning the SME rows the version-1 manifest never planned. FAILING
  // FIRST: `listBelowVersion` / `updateRanksForVersion` did not exist before
  // this slice — this block is red by absence until they are added.

  describe('S2 -- listBelowVersion / updateRanksForVersion (manifest reconciliation)', () => {
    const manifest = loadFieldManifest();
    const CURRENT_VERSION = manifest.version;

    it('a version-1 row (DOC, BSE, null) for face_value becomes (DOC, CHITTORGARH, null) at the current version', async () => {
      // face_value ranks SME_NSE as [DOC, CHITTORGARH] (no BSE) — an SME-on-NSE
      // IPO with a stale BSE rank2 is exactly the manifest-drift class S2 fixes.
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'PENDING',
      });
      await db
        .update(schema.ipos)
        .set({ segment: 'SME', listingExchanges: ['NSE'] })
        .where(eq(schema.ipos.id, IPO_ID));

      const stale = await repo.listBelowVersion(CURRENT_VERSION);
      const row = stale.find((r) => r.id === id);
      expect(row).toBeDefined();
      expect(row!.rank1Source).toBe('DOC');
      expect(row!.rank2Source).toBe('BSE');

      const ipoType = resolveIpoTypeKey({ segment: 'SME', listingExchanges: ['NSE'] });
      expect(ipoType).toBe('SME_NSE');
      const policy = resolveFieldSourcePolicy(
        { table: 'ipo_details', column: 'face_value', ipoType },
        { manifest }
      );
      expect(policy.ranks).toEqual(['DOC', 'CHITTORGARH']);

      const { updated } = await repo.updateRanksForVersion([
        {
          id,
          rank1Source: policy.ranks[0] ?? null,
          rank2Source: policy.ranks[1] ?? null,
          rank3Source: policy.ranks[2] ?? null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: policyOriginString(policy.origin),
        },
      ]);
      expect(updated).toBe(1);

      const persisted = await readRow(id);
      expect(persisted.rank1Source).toBe('DOC');
      expect(persisted.rank2Source).toBe('CHITTORGARH');
      expect(persisted.rank3Source).toBeNull();
      expect(persisted.manifestVersion).toBe(CURRENT_VERSION);
      expect(persisted.policyOrigin).toBe(`registry:${CURRENT_VERSION}`);

      // Reverted so it does not leak into other tests in this file that
      // assume the fixture IPO is plain MAINBOARD.
      await db
        .update(schema.ipos)
        .set({ segment: null, listingExchanges: null })
        .where(eq(schema.ipos.id, IPO_ID));
    });

    it('a SUPPLIED row is NEVER touched, even when it is below the current version', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'SUPPLIED',
        chosenSource: 'BSE',
      });

      const stale = await repo.listBelowVersion(CURRENT_VERSION);
      expect(stale.find((r) => r.id === id)).toBeUndefined();

      // Even a caller that (wrongly) tries to update a SUPPLIED row's id is
      // refused by the WHERE clause -- state <> 'SUPPLIED' is enforced in the
      // SQL itself, not only by what listBelowVersion returns.
      const { updated } = await repo.updateRanksForVersion([
        {
          id,
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: `registry:${CURRENT_VERSION}`,
        },
      ]);
      expect(updated).toBe(0);

      const persisted = await readRow(id);
      expect(persisted.rank1Source).toBe('DOC');
      expect(persisted.rank2Source).toBe('BSE');
      expect(persisted.manifestVersion).toBe(1);
      expect(persisted.state).toBe('SUPPLIED');
    });

    it('a row already AT the current version is not returned by listBelowVersion', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        manifestVersion: CURRENT_VERSION,
        state: 'PENDING',
      });
      const stale = await repo.listBelowVersion(CURRENT_VERSION);
      expect(stale.find((r) => r.id === id)).toBeUndefined();
    });

    it('a non-SUPPLIED, non-PENDING row (e.g. EXHAUSTED) below the current version IS in scope', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'EXHAUSTED',
      });
      const stale = await repo.listBelowVersion(CURRENT_VERSION);
      expect(stale.find((r) => r.id === id)).toBeDefined();
    });

    it('an SME IPO gains its subscriptions.* rows via upsertGeneratedRows (the rows the version-1 manifest never planned)', async () => {
      await db
        .update(schema.ipos)
        .set({ segment: 'SME', listingExchanges: ['BSE'] })
        .where(eq(schema.ipos.id, IPO_ID));

      const before = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.tableName, 'subscriptions')));
      expect(before.length).toBe(0);

      const ipoType = resolveIpoTypeKey({ segment: 'SME', listingExchanges: ['BSE'] });
      expect(ipoType).toBe('SME_BSE');
      const policy = resolveFieldSourcePolicy(
        { table: 'subscriptions', column: 'total_subscription', ipoType },
        { manifest }
      );
      expect(policy.ranks).toEqual(['BSE', 'CHITTORGARH']);

      const { inserted } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'subscriptions',
          rowKey: '',
          fieldName: 'total_subscription',
          rank1Source: policy.ranks[0] ?? null,
          rank2Source: policy.ranks[1] ?? null,
          rank3Source: policy.ranks[2] ?? null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: policyOriginString(policy.origin),
        },
      ]);
      expect(inserted).toBe(1);

      const after = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.tableName, 'subscriptions')));
      expect(after.length).toBe(1);
      expect(after[0].rank1Source).toBe('BSE');
      expect(after[0].rank2Source).toBe('CHITTORGARH');

      await db
        .update(schema.ipos)
        .set({ segment: null, listingExchanges: null })
        .where(eq(schema.ipos.id, IPO_ID));
    });
  });

  describe('S7 (#732) -- upsertGeneratedRows re-ranks an existing row on a manifest version bump', () => {
    const manifest = loadFieldManifest();
    const CURRENT_VERSION = manifest.version;

    it('an existing non-terminal v1 row (rank2=BSE) re-planned at the current version becomes rank2=CHITTORGARH, SAME row id, live-state columns unchanged', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'PENDING',
        attempts: 0,
      });
      await db
        .update(schema.ipos)
        .set({ segment: 'SME', listingExchanges: ['NSE'] })
        .where(eq(schema.ipos.id, IPO_ID));

      const before = await readRow(id);
      expect(before.nextDueAt).not.toBeNull();

      const ipoType = resolveIpoTypeKey({ segment: 'SME', listingExchanges: ['NSE'] });
      const policy = resolveFieldSourcePolicy(
        { table: 'ipo_details', column: 'face_value', ipoType },
        { manifest }
      );
      expect(policy.ranks).toEqual(['DOC', 'CHITTORGARH']);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: policy.ranks[0] ?? null,
          rank2Source: policy.ranks[1] ?? null,
          rank3Source: policy.ranks[2] ?? null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: policyOriginString(policy.origin),
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(1);

      const after = await readRow(id);
      expect(after.id).toBe(id);
      expect(after.rank1Source).toBe('DOC');
      expect(after.rank2Source).toBe('CHITTORGARH');
      expect(after.rank3Source).toBeNull();
      expect(after.manifestVersion).toBe(CURRENT_VERSION);
      expect(after.state).toBe('PENDING');
      expect(after.attempts).toBe(0);
      expect(after.nextDueAt?.getTime()).toBe(before.nextDueAt?.getTime());
      expect(after.claimedAt).toBeNull();

      await db
        .update(schema.ipos)
        .set({ segment: null, listingExchanges: null })
        .where(eq(schema.ipos.id, IPO_ID));
    });

    it('a SUPPLIED v1 row re-planned at the current version is completely unchanged', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'SUPPLIED',
        chosenSource: 'BSE',
        chosenRank: 2,
      });
      const before = await readRow(id);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: `registry:${CURRENT_VERSION}`,
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(0);

      const after = await readRow(id);
      expect(after).toEqual(before);
    });

    it('a same-version re-run changes nothing and reports inserted:0, updated:0', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: CURRENT_VERSION,
        // #893: policy_origin must already match what the re-plan will send too,
        // or a legacy null->'registry:N' backfill is (correctly) counted as a
        // change under the fixed class -- this test is about ranks/version
        // being truly identical, not about that backfill.
        policyOrigin: `registry:${CURRENT_VERSION}`,
        state: 'PENDING',
      });
      const before = await readRow(id);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'BSE',
          rank3Source: null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: `registry:${CURRENT_VERSION}`,
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(0);

      const after = await readRow(id);
      expect(after).toEqual(before);
    });

    it('a genuinely new key still inserts, reporting inserted:1, updated:0', async () => {
      const before = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.fieldName, 'face_value')));
      expect(before.length).toBe(0);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'NSE',
          rank3Source: null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: `registry:${CURRENT_VERSION}`,
        },
      ]);
      expect(inserted).toBe(1);
      expect(updated).toBe(0);

      const after = await db
        .select()
        .from(schema.ipoFieldPlan)
        .where(and(eq(schema.ipoFieldPlan.ipoId, IPO_ID), eq(schema.ipoFieldPlan.fieldName, 'face_value')));
      expect(after.length).toBe(1);
      expect(after[0].rank2Source).toBe('NSE');
    });

    it('live-state protection: attempts/claimed_at/chosen_* on a non-terminal row survive a version-bump re-rank untouched, only ranks change', async () => {
      const claimedAt = new Date(Date.now() - 5 * 60_000);
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'BSE',
        rank3Source: null,
        manifestVersion: 1,
        state: 'CHECK_FAILED',
        attempts: 3,
        claimedAt,
        claimToken: 'fixture-claim-token',
        chosenSource: 'BSE',
        chosenRank: 2,
        
        chosenDocumentId: DOCUMENT_ID,
      });
      const before = await readRow(id);
      expect(before.attempts).toBe(3);
      expect(before.claimedAt).not.toBeNull();
      expect(before.chosenSource).toBe('BSE');
      expect(before.chosenRank).toBe(2);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: CURRENT_VERSION,
          policyOrigin: `registry:${CURRENT_VERSION}`,
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(1);

      const after = await readRow(id);
      expect(after.id).toBe(id);
      expect(after.rank1Source).toBe('DOC');
      expect(after.rank2Source).toBe('CHITTORGARH');
      expect(after.manifestVersion).toBe(CURRENT_VERSION);
      // Live-state columns: byte-for-byte untouched.
      expect(after.state).toBe('CHECK_FAILED');
      expect(after.attempts).toBe(3);
      expect(after.claimedAt?.getTime()).toBe(claimedAt.getTime());
      expect(after.claimToken).toBe('fixture-claim-token');
      expect(after.chosenSource).toBe('BSE');
      expect(after.chosenRank).toBe(2);
      
      expect(after.chosenDocumentId).toBe(DOCUMENT_ID);
    });
  });

  // ------------------------- item 3 S4 (#893) — an override re-ranks WITHOUT a version bump ---
  //
  // RCA: `field-plan-generator.ts` stamps `manifestVersion: manifest.version` regardless of
  // whether an override produced the ranks (an override "takes effect at the next cycle with
  // no deploy" per §2.3.5 — it never bumps the manifest version), so the old
  // `manifest_version < EXCLUDED.manifest_version` guard was always false for an override pass
  // and the re-rank was silently dropped.
  describe('item 3 S4 (#893) -- an override re-ranks an existing plan row at the SAME manifest version', () => {
    const SAME_VERSION = 7;

    it('a non-SUPPLIED row re-ranks when only policy_origin/ranks change, manifest_version unchanged (the Swap Test)', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'CHITTORGARH',
        rank3Source: null,
        manifestVersion: SAME_VERSION,
        policyOrigin: `registry:${SAME_VERSION}`,
        state: 'PENDING',
      });

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'CHITTORGARH',
          rank2Source: 'DOC',
          rank3Source: null,
          manifestVersion: SAME_VERSION,
          policyOrigin: 'override:swap-test-1',
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(1);

      const after = await readRow(id);
      expect(after.id).toBe(id);
      expect(after.rank1Source).toBe('CHITTORGARH');
      expect(after.rank2Source).toBe('DOC');
      expect(after.policyOrigin).toBe('override:swap-test-1');
      expect(after.manifestVersion).toBe(SAME_VERSION);
      expect(after.state).toBe('PENDING');
    });

    it('an identical re-plan (same ranks, same policy_origin, same version) writes 0 rows', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'CHITTORGARH',
        rank2Source: 'DOC',
        rank3Source: null,
        manifestVersion: SAME_VERSION,
        policyOrigin: 'override:swap-test-1',
        state: 'PENDING',
      });
      const before = await readRow(id);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'CHITTORGARH',
          rank2Source: 'DOC',
          rank3Source: null,
          manifestVersion: SAME_VERSION,
          policyOrigin: 'override:swap-test-1',
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(0);

      const after = await readRow(id);
      expect(after).toEqual(before);
    });

    it('an expired override (plan pass returns registry order) re-ranks the row back, same version', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'CHITTORGARH',
        rank2Source: 'DOC',
        rank3Source: null,
        manifestVersion: SAME_VERSION,
        policyOrigin: 'override:swap-test-1',
        state: 'PENDING',
      });

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: SAME_VERSION,
          policyOrigin: `registry:${SAME_VERSION}`,
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(1);

      const after = await readRow(id);
      expect(after.rank1Source).toBe('DOC');
      expect(after.rank2Source).toBe('CHITTORGARH');
      expect(after.policyOrigin).toBe(`registry:${SAME_VERSION}`);
    });

    it('a non-SUPPLIED row re-ranks when ONLY policy_origin changes (same ranks, same version) -- exactly 1 row updated', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'CHITTORGARH',
        rank3Source: null,
        manifestVersion: SAME_VERSION,
        policyOrigin: `registry:${SAME_VERSION}`,
        state: 'PENDING',
      });

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: SAME_VERSION,
          policyOrigin: 'override:swap-test-5',
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(1);

      const after = await readRow(id);
      expect(after.rank1Source).toBe('DOC');
      expect(after.rank2Source).toBe('CHITTORGARH');
      expect(after.policyOrigin).toBe('override:swap-test-5');
    });

    // CRITICAL case from the second Tier A review (2026-09-24): a SUPPLIED
    // row whose chosen_source sits at rank2 of the CURRENT order, re-planned
    // with that SAME order (no override), must write 0 rows and stay
    // SUPPLIED. The removed "chosenDemoted" branch fired here on every data
    // slot with no override present -- this is the regression guard for #968
    // staying deferred: nothing in this repository may reopen a SUPPLIED row.
    it('a SUPPLIED row whose chosen_source equals rank2, re-planned with the SAME registry order, writes 0 rows and stays SUPPLIED', async () => {
      const id = await seedRow({
        fieldName: 'face_value',
        rank1Source: 'DOC',
        rank2Source: 'CHITTORGARH',
        rank3Source: null,
        manifestVersion: SAME_VERSION,
        policyOrigin: `registry:${SAME_VERSION}`,
        state: 'SUPPLIED',
        chosenSource: 'CHITTORGARH',
        chosenRank: 2,
      });
      const before = await readRow(id);

      const { inserted, updated } = await repo.upsertGeneratedRows([
        {
          ipoId: IPO_ID,
          tableName: 'ipo_details',
          rowKey: '',
          fieldName: 'face_value',
          rank1Source: 'DOC',
          rank2Source: 'CHITTORGARH',
          rank3Source: null,
          manifestVersion: SAME_VERSION,
          policyOrigin: `registry:${SAME_VERSION}`,
        },
      ]);
      expect(inserted).toBe(0);
      expect(updated).toBe(0);

      const after = await readRow(id);
      expect(after).toEqual(before);
      expect(after.state).toBe('SUPPLIED');
    });
  });

  // ------------------------------------------ #884: a gap is not an attempt ---
  //
  // RCA (#884): recordOutcome charged `attempts + 1` for EVERY CHECK_FAILED, including
  // one whose only cause was a gap in our own configuration or code (no mapping, no
  // documentType, no fetcher, no column read, no document provenance on a COMPLETED
  // document). Review round 1: a lower claim priority is per-IPO only (claims filter by
  // ipo_id), so an uncharged gap row was re-asked every slot forever. Now a gap row is
  // recorded under the current GAP KEY (manifest version + fetcher coverage + extractor
  // version, stamped in `cause`) and offered again only when that key changes.
  describe('#884 -- a gap is not an attempt, and is re-asked only when the gap key changes', () => {
    const now = new Date('2026-09-15T03:30:00.000Z'); // 09:00 IST
    const earlierSlot = new Date('2026-09-15T01:30:00.000Z'); // 07:00 IST, previous slot
    const nextDay = new Date(now.getTime() + 24 * 3_600_000);
    const KEY = 'm1|f0123456789ab|xextract_filing.py@2026-09-03';
    const KEY_MANIFEST = 'm2|f0123456789ab|xextract_filing.py@2026-09-03';
    const KEY_COVERAGE = 'm1|fba9876543210|xextract_filing.py@2026-09-03';
    const KEY_EXTRACTOR = 'm1|f0123456789ab|xextract_filing.py@2026-10-01';
    const GAP_CAUSE = 'rank1:DOC:CHECK_FAILED:no documentType in manifest for this field [gap:NO_DOCUMENT_TYPE]';
    const PROVENANCE_CAUSE =
      'rank1:DOC:CHECK_FAILED:no document provenance for faceValue on RHP (extractor gap or field absent) — not retired [gap:NO_DOCUMENT_PROVENANCE]';

    // Review round 2: the claim takes the CURRENT keys per field (`table.field`).
    const allKeys = (k: string) => ({ 'ipo_details.faceValue': [k], 'ipo_details.isin': [k] });
    const COV = '0123456789ab';
    const XV = 'extract_filing.py@2026-09-03';
    const entry = (documentType?: string) => ({
      rank: { MAINBOARD: ['DOC', 'NSE'] },
      capability: { DOC: { capable: true }, NSE: { capable: true } },
      ...(documentType ? { documentType } : {}),
    });
    const buildKeys = (manifestFields: Record<string, unknown>, documents: unknown[] = []) =>
      buildFieldPlanIpoGapKeys({ manifestFields: manifestFields as never, coverageFingerprint: COV, extractorVersion: XV, documents: documents as never });

    async function claimAndRecord(
      id: string,
      opts: { reasonCode: string; cause: string; gapKey?: string; at?: Date }
    ) {
      const at = opts.at ?? now;
      const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now: at });
      expect(claimed?.id).toBe(id);
      const result = await repo.recordOutcome({
        planRowId: id,
        claimToken: claimed!.claimToken!,
        writeHappened: true,
        state: 'CHECK_FAILED',
        reasonCode: opts.reasonCode,
        cause: opts.cause,
        ...(opts.gapKey ? { gapKey: opts.gapKey } : {}),
        now: at,
      } as never);
      expect(result.written).toBe(true);
      return readRow(id);
    }

    it.each([
      ['COVERAGE_GAP', GAP_CAUSE],
      ['COVERAGE_GAP', PROVENANCE_CAUSE],
    ])('a gap CHECK_FAILED (%s) does NOT gain an attempt and its cause is stamped with the key', async (code, cause) => {
      const id = await seedRow({ state: 'CHECK_FAILED', attempts: 2, lastAttemptAt: earlierSlot });
      const after = await claimAndRecord(id, { reasonCode: code, cause, gapKey: KEY });
      expect(after.attempts).toBe(2);
      expect(after.state).toBe('CHECK_FAILED');
      expect(after.cause).toBe(`[gap-key:${KEY}] ${cause}`);
      expect(after.lastAttemptAt).not.toBeNull();
      expect(after.claimToken).toBeNull();
    });

    it('classification is structured: gap-looking TEXT without a gapKey is still charged', async () => {
      const id = await seedRow({ state: 'CHECK_FAILED', attempts: 2, lastAttemptAt: earlierSlot });
      const after = await claimAndRecord(id, { reasonCode: 'COVERAGE_GAP', cause: GAP_CAUSE });
      expect(after.attempts).toBe(3);
      expect(after.cause).toBe(GAP_CAUSE);
    });

    it('CORE: a gap row is NOT claimable next cycle under the same key, IS claimable after any key part changes, never gains an attempt', async () => {
      const id = await seedRow({ state: 'CHECK_FAILED', attempts: 1, lastAttemptAt: earlierSlot });
      await claimAndRecord(id, { reasonCode: 'COVERAGE_GAP', cause: GAP_CAUSE, gapKey: KEY });

      expect(await repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: allKeys(KEY) } as never)).toBeNull();
      expect(await repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay })).toBeNull();

      for (const changed of [KEY_MANIFEST, KEY_COVERAGE, KEY_EXTRACTOR]) {
        const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: allKeys(changed) } as never);
        expect(claimed?.id).toBe(id);
        await repo.releaseClaimUnrecorded({ planRowId: id, claimToken: claimed!.claimToken! });
      }

      const reclaimed = await repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: allKeys(KEY_MANIFEST) } as never);
      expect(reclaimed?.id).toBe(id);
      await repo.recordOutcome({
        planRowId: id,
        claimToken: reclaimed!.claimToken!,
        writeHappened: true,
        state: 'CHECK_FAILED',
        reasonCode: 'COVERAGE_GAP',
        cause: GAP_CAUSE,
        gapKey: KEY_MANIFEST,
        now: nextDay,
      } as never);
      const after = await readRow(id);
      expect(after.attempts).toBe(1);
      expect(after.cause).toBe(`[gap-key:${KEY_MANIFEST}] ${GAP_CAUSE}`);
      const twoDays = new Date(nextDay.getTime() + 24 * 3_600_000);
      expect(await repo.claimNextDueField({ ipoId: IPO_ID, now: twoDays, gapKeys: allKeys(KEY_MANIFEST) } as never)).toBeNull();
    });

    it('CORE NEW-1: a manifest CONTENT edit adding a documentType (no version bump) reopens THAT field; an edit to another field does not', async () => {
      const m0 = { 'ipo_details.faceValue': entry(), 'ipo_details.isin': entry() };
      const k0 = buildKeys(m0);
      const id = await seedRow({ state: 'CHECK_FAILED', attempts: 1, lastAttemptAt: earlierSlot });
      await claimAndRecord(id, {
        reasonCode: 'COVERAGE_GAP',
        cause: GAP_CAUSE,
        gapKey: fieldPlanGapKeyFor(k0, 'ipo_details', 'faceValue', ['NO_DOCUMENT_TYPE'])!,
      });
      const claim = (keys: ReturnType<typeof buildKeys>) =>
        repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: fieldPlanClaimGapKeys(keys) } as never);
      expect(await claim(k0)).toBeNull();
      expect(await claim(buildKeys({ ...m0, 'ipo_details.isin': entry('RHP') }))).toBeNull();
      const claimed = await claim(buildKeys({ ...m0, 'ipo_details.faceValue': entry('RHP') }));
      expect(claimed?.id).toBe(id);
      expect((await readRow(id)).attempts).toBe(1);
    });

    it('CORE NEW-2: a NO_DOCUMENT_PROVENANCE row stamped after the DRHP reopens when the RHP completes (same extractor); a mapping gap on the same IPO does not', async () => {
      const m = { 'ipo_details.faceValue': entry('RHP'), 'ipo_details.isin': entry('RHP') };
      const drhp = { id: '00000000-0000-4000-8000-00000000d001', type: 'DRHP', extractionStatus: 'COMPLETED', isActive: true };
      const rhp = { id: '00000000-0000-4000-8000-00000000d002', type: 'RHP', extractionStatus: 'COMPLETED', isActive: true };
      const k0 = buildKeys(m, [drhp]);
      const provenanceId = await seedRow({ state: 'CHECK_FAILED', attempts: 1, lastAttemptAt: earlierSlot });
      await claimAndRecord(provenanceId, {
        reasonCode: 'COVERAGE_GAP',
        cause: PROVENANCE_CAUSE,
        gapKey: fieldPlanGapKeyFor(k0, 'ipo_details', 'faceValue', ['NO_DOCUMENT_PROVENANCE'])!,
      });
      const mappingId = await seedRow({ state: 'CHECK_FAILED', attempts: 1, lastAttemptAt: earlierSlot, fieldName: 'isin' });
      await claimAndRecord(mappingId, {
        reasonCode: 'COVERAGE_GAP',
        cause: GAP_CAUSE,
        gapKey: fieldPlanGapKeyFor(k0, 'ipo_details', 'isin', ['NO_MAPPING'])!,
      });
      const claim = (keys: ReturnType<typeof buildKeys>, excludeIds: string[] = []) =>
        repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: fieldPlanClaimGapKeys(keys), excludeIds } as never);
      expect(await claim(k0)).toBeNull();
      expect(await claim(buildKeys(m, [drhp, { ...rhp, extractionStatus: 'PENDING' }]))).toBeNull();
      const k1 = buildKeys(m, [drhp, rhp]);
      const claimed = await claim(k1);
      expect(claimed?.id).toBe(provenanceId);
      expect(await claim(k1, [provenanceId])).toBeNull();
      expect((await readRow(provenanceId)).attempts).toBe(1);
    });

    it('MINOR-6: a stamped gap row with NULL last_attempt_at is offered only under a different key', async () => {
      const id = await seedRow({
        state: 'CHECK_FAILED',
        attempts: 0,
        lastAttemptAt: null,
        reasonCode: 'COVERAGE_GAP',
        cause: `[gap-key:${KEY}] ${GAP_CAUSE}`,
      });
      expect(await repo.claimNextDueField({ ipoId: IPO_ID, now, gapKeys: allKeys(KEY) } as never)).toBeNull();
      const claimed = await repo.claimNextDueField({ ipoId: IPO_ID, now, gapKeys: allKeys(KEY_EXTRACTOR) } as never);
      expect(claimed?.id).toBe(id);
    });

    it('a real failure still counts, and stops at the cap even when the gap key changes', async () => {
      const id = await seedRow({
        state: 'CHECK_FAILED',
        attempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS - 1,
        lastAttemptAt: earlierSlot,
      });
      const after = await claimAndRecord(id, { reasonCode: 'FAILED_VALIDATION', cause: 'no field result returned' });
      expect(after.attempts).toBe(FIELD_PLAN_RECLAIM_MAX_ATTEMPTS);
      expect(await repo.claimNextDueField({ ipoId: IPO_ID, now: nextDay, gapKeys: allKeys(KEY_MANIFEST) } as never)).toBeNull();
    });

    it('a genuine CHECK_FAILED is re-asked BEFORE a gap row whose key changed, even when the gap row is older', async () => {
      const gapId = await seedRow({
        state: 'CHECK_FAILED',
        attempts: 0,
        lastAttemptAt: new Date(earlierSlot.getTime() - 3_600_000),
        reasonCode: 'COVERAGE_GAP',
        cause: `[gap-key:${KEY}] ${GAP_CAUSE}`,
      });
      const genuineId = await seedRow({
        state: 'CHECK_FAILED',
        attempts: 1,
        lastAttemptAt: earlierSlot,
        fieldName: 'isin',
        reasonCode: 'FAILED_VALIDATION',
        cause: 'no field result returned',
      });
      const first = await repo.claimNextDueField({ ipoId: IPO_ID, now, gapKeys: allKeys(KEY_MANIFEST) } as never);
      expect(first?.id).toBe(genuineId);
      const second = await repo.claimNextDueField({
        ipoId: IPO_ID,
        now,
        gapKeys: allKeys(KEY_MANIFEST),
        excludeIds: [genuineId],
      } as never);
      expect(second?.id).toBe(gapId);
    });

    it('manifest reconciliation (S2 version bump) does not rewrite attempts: a genuine count survives', async () => {
      const genuine = await seedRow({
        state: 'CHECK_FAILED',
        attempts: FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
        lastAttemptAt: earlierSlot,
        manifestVersion: 1,
        fieldName: 'isin',
        reasonCode: 'FAILED_VALIDATION',
        cause: 'no field result returned',
      });
      await repo.updateRanksForVersion([
        { id: genuine, rank1Source: 'DOC', rank2Source: 'CHITTORGARH', rank3Source: null, manifestVersion: 2, policyOrigin: 'registry:2' },
      ]);
      expect((await readRow(genuine)).attempts).toBe(FIELD_PLAN_RECLAIM_MAX_ATTEMPTS);
    });
  });

});
