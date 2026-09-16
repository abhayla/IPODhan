// implements: item 5 slice s3 -- ipo_field_plan repository (claim + outcome)
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's
// node_modules junction can resolve the alias back to the PRIMARY checkout
// (see ipo-field-plan-row-key-unique.integration.test.ts for the same guard).
import * as schema from '../../../packages/shared/src/db/schema';
import {
  IpoFieldPlanRepository,
  FIELD_PLAN_CLAIM_STALE_MINUTES,
} from '../../../packages/shared/src/repositories/ipo-field-plan-repository';

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
 * HOW TO RUN THIS (there is NO scraper/.env.test -- the guard reads the
 * environment, and the credentials live in GLOBAL.env, above every repo):
 *
 *   cd <worktree>/scraper
 *   PW=$(grep '^IPODHAN_APP_DB_PASSWORD=' /d/Abhay/GLOBAL.env | cut -d= -f2-)
 *   export DATABASE_URL=<the sanctioned ipodhan_test URL from the recipe -- not repeated
 *     here: a literal connection string in an integration file is refused by
 *     tests-connection-source.test.ts, which cannot vet a target it did not build>
 *   export REDIS_URL="redis://localhost:6379/15"
 *   npx vitest run -c vitest.integration.config.ts <this file>
 *
 * THREE THINGS THAT EACH LOOK LIKE A BROKEN SUITE AND ARE NOT:
 *   1. localhost:15432 is the SSH TUNNEL to the Windows DB host, and it is the
 *      ONLY accepted route. Pointing DATABASE_URL straight at the prod DB host (named in the recipe)
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
    // the claim is released so nothing holds the row
    expect(persisted.claimToken).toBeNull();
    expect(persisted.claimedAt).toBeNull();
  });

  it('a FAILED attempt stays PENDING, bumps attempts and schedules a backoff', async () => {
    const id = await seedRow();
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });

    const before = Date.now();
    const result = await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'PENDING',
    });
    expect(result.written).toBe(true);

    const persisted = await readRow(id);
    expect(persisted.state).toBe('PENDING');
    expect(persisted.attempts).toBe(1);
    expect(persisted.nextDueAt!.getTime()).toBeGreaterThan(before);
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

});
