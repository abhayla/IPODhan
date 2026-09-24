// implements: #968 (spec §2.3.5, OD-73, OD-95) -- the plan pass reopens a SETTLED row only on a real
// override order change, the narrowing survives plan passes, and expiry restores with no flip-flop.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias -- a worktree's node_modules junction can
// resolve the alias back to the PRIMARY checkout.
import * as schema from '../../../packages/shared/src/db/schema';
import {
  IpoFieldPlanRepository,
  type SettledOverrideIncomingRow,
} from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { walkFieldPlanForIPO, type FieldFetcher, type FieldPlanWalkDeps } from '../../src/services/field-plan-walk';
import { findSupersessorForReopenedRow } from '../../src/services/plan-supersession';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { fieldResult, consolidatedUpsertResultFixture } from '../helpers/consolidation-result-fixture';

/**
 * To run:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/settled-field-override-reopen.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN_LABEL = DATABASE_URL ? 'live' : '#968: SKIPPED -- DATABASE_URL not set';
const IPO_ID = '00000000-0000-4000-8000-000000968b01';
const SLUG = 'issue-968-settled-override-reopen';
const FAKE_REDIS = {} as never;

describe.skipIf(!DATABASE_URL)(`#968 settled rows under an override (${RUN_LABEL})`, () => {
  let pool: Pool | null = null;
  let db: ReturnType<typeof drizzle>;
  let repo: IpoFieldPlanRepository;

  beforeAll(async () => {
    if (!DATABASE_URL) return;
    pool = new Pool({
      connectionString: DATABASE_URL,
      max: 2,
      options: '-c timezone=UTC',
    });
    const current = (await pool.query('select current_database() d')).rows[0].d;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run against '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    repo = new IpoFieldPlanRepository(db as never, FAKE_REDIS);
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
      VALUES (${IPO_ID}::uuid, 'Issue 968 Override Reopen Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'OPEN', '2026-09-14', '2026-09-16')
    `);
  }, 60000);

  afterAll(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
    await pool.end();
  }, 60000);

  beforeEach(async () => {
    if (!pool) return;
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
  });

  async function seedSupplied(
    fieldName: string,
    chosen: string,
    ranks: (string | null)[],
    policyOrigin: string | null
  ) {
    const [row] = await db
      .insert(schema.ipoFieldPlan)
      .values({
        ipoId: IPO_ID,
        tableName: 'ipos',
        rowKey: '',
        fieldName,
        rank1Source: ranks[0],
        rank2Source: ranks[1],
        rank3Source: ranks[2],
        state: 'SUPPLIED',
        chosenSource: chosen,
        chosenRank: ranks.indexOf(chosen) + 1,
        attempts: 2,
        manifestVersion: 2,
        policyOrigin,
        chosenConfirmedAt: new Date('2026-09-20T05:00:00Z'),
      } as never)
      .returning({ id: schema.ipoFieldPlan.id });
    return row.id;
  }

  const readRow = async (id: string) =>
    (await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id)))[0];

  const incoming = (fieldName: string, ranks: (string | null)[], policyOrigin: string): SettledOverrideIncomingRow => ({
    ipoId: IPO_ID,
    tableName: 'ipos',
    rowKey: '',
    fieldName,
    rank1Source: ranks[0],
    rank2Source: ranks[1],
    rank3Source: ranks[2],
    policyOrigin,
  });

  // The 24 staging SUPPLIED rows #967 looped on (read-only query, 2026-09-24): chosen source is
  // rank 2 or 3 of the registry order, most with policy_origin registry:2, eight with NULL.
  const STAGING_SHAPES: Array<[string, string, (string | null)[], string | null]> = [
    ['issue_size', 'CHITTORGARH', ['DOC', 'CHITTORGARH', null], 'registry:2'],
    ['listing_date', 'CHITTORGARH', ['DOC', 'BSE', 'CHITTORGARH'], null],
    ['symbol', 'NSE', ['DOC', 'NSE', 'CHITTORGARH'], 'registry:2'],
    ['isin', 'NSE', ['DOC', 'NSE', 'BSE'], 'registry:2'],
    ['company_name', 'NSE', ['DOC', 'NSE', 'CHITTORGARH'], 'registry:2'],
  ];

  it('no-override-reopens-nothing: the staging-shaped rows, re-planned twice with the registry order, write 0 rows', async () => {
    const ids = [];
    for (const [f, c, r, o] of STAGING_SHAPES) ids.push(await seedSupplied(f, c, r, o));
    const before = await Promise.all(ids.map(readRow));
    for (let pass = 0; pass < 2; pass++) {
      const upsert = await repo.upsertGeneratedRows(
        STAGING_SHAPES.map(([f, , r]) => ({
          ...incoming(f, r, 'registry:2'),
          manifestVersion: 2,
        }))
      );
      const out = await repo.reconcileSettledToOverrides(
        STAGING_SHAPES.map(([f, , r]) => incoming(f, r, 'registry:2'))
      );
      expect(upsert).toEqual({ inserted: 0, updated: 0 });
      expect(out).toEqual({ reopened: 0, retargeted: 0, restoreDue: 0 });
    }
    expect(await Promise.all(ids.map(readRow))).toEqual(before);
  });

  it('the override reopens a DOC-settled row once; narrowing-survives-two-passes (ranks, origin and marker untouched)', async () => {
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', 'CHITTORGARH'], 'registry:2');
    const swap = ['CHITTORGARH', 'DOC', null];

    const first = await repo.reconcileSettledToOverrides([incoming('issue_size', swap, 'override:swap-968')]);
    expect(first).toEqual({ reopened: 1, retargeted: 0, restoreDue: 0 });
    const reopened = await readRow(id);
    expect(reopened.state).toBe('PENDING');
    expect(reopened.reopenedUnderPolicy).toBe('override:swap-968');
    expect(reopened.chosenSource).toBe('DOC');
    expect(reopened.nextDueAt).not.toBeNull();

    for (let pass = 0; pass < 2; pass++) {
      const upsert = await repo.upsertGeneratedRows([
        {
          ...incoming('issue_size', swap, 'override:swap-968'),
          manifestVersion: 2,
        },
      ]);
      const again = await repo.reconcileSettledToOverrides([incoming('issue_size', swap, 'override:swap-968')]);
      expect(upsert.updated).toBe(0);
      expect(again).toEqual({ reopened: 0, retargeted: 0, restoreDue: 0 });
    }
    const after = await readRow(id);
    expect(after.reopenedUnderPolicy).toBe('override:swap-968');
    expect([after.rank1Source, after.rank2Source, after.rank3Source, after.policyOrigin]).toEqual([
      'DOC',
      'BSE',
      'CHITTORGARH',
      'registry:2',
    ]);
    expect(after.chosenSource).toBe('DOC');
  });

  it('the claimed reopened row carries its narrowing to the walk; a SUPPLIED answer clears it', async () => {
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    await repo.reconcileSettledToOverrides([incoming('issue_size', ['CHITTORGARH', 'DOC', null], 'override:swap-968')]);
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(claimed?.id).toBe(id);
    expect(claimed?.reopenedUnderPolicy).toBe('override:swap-968');
    expect(claimed?.chosenSource).toBe('DOC');
    await repo.recordOutcome({
      planRowId: id,
      claimToken: claimed!.claimToken!,
      writeHappened: true,
      state: 'SUPPLIED',
      policyOrigin: 'override:swap-968',
      chosen: { source: 'CHITTORGARH', rank: 1 },
    } as never);
    const done = await readRow(id);
    expect(done.state).toBe('SUPPLIED');
    expect(done.chosenSource).toBe('CHITTORGARH');
    expect(done.reopenedUnderPolicy).toBeNull();
    // Expiry after re-supply: the registry re-plan leaves the new value alone.
    const out = await repo.reconcileSettledToOverrides([incoming('issue_size', ['DOC', 'BSE', null], 'registry:2')]);
    expect(out).toEqual({ reopened: 0, retargeted: 0, restoreDue: 0 });
    expect((await readRow(id)).chosenSource).toBe('CHITTORGARH');
  });

  // ------------------------------------------------ the walk, against the real repository ---

  const ANY_TRIED = {
    policyOrigin: 'override:swap-968',
    rank1Source: 'CHITTORGARH',
    rank2Source: 'DOC',
    rank3Source: null,
  };

  function realWalkDeps(opts: {
    ranks: string[];
    origin: string;
    fetchers: Record<string, FieldFetcher>;
    supersessionForReopened?: FieldPlanWalkDeps['supersessionForReopened'];
  }): FieldPlanWalkDeps {
    const [kind, id] = opts.origin.split(':');
    return {
      fieldPlanRepository: repo as never,
      orchestrator: {
        consolidatedUpsertIPO: async (scraped: any, source: any, _c?: any, _p?: any, only?: string[]) =>
          consolidatedUpsertResultFixture({
            ipoId: IPO_ID,
            fieldResults: [fieldResult(only![0], scraped[only![0]], source)],
          }),
        consolidatedUpsertChildRows: async () => {
          throw new Error('not used');
        },
      } as never,
      sourceFetchers: opts.fetchers as never,
      ipoRepository: {
        findById: async () => ({
          id: IPO_ID,
          companyName: 'Issue 968 Override Reopen Fixture Ltd.',
          symbol: 'I968',
          isin: 'INE000A09681',
          offeringType: 'IPO',
          openDate: '2026-09-14',
          segment: 'MAINBOARD',
          listingExchanges: ['NSE', 'BSE'],
        }),
      } as never,
      resolvePolicy: (() => ({
        ranks: opts.ranks,
        documentType: undefined,
        origin:
          kind === 'override'
            ? { kind: 'override', id, expiresAt: '2026-10-24T00:00:00Z' }
            : { kind: 'registry', version: Number(id) },
        na: false,
        incapable: {},
      })) as never,
      supersessionForReopened: opts.supersessionForReopened,
    } as FieldPlanWalkDeps;
  }

  const walkBudget = () => ({ deadlineMs: Date.now() + 60_000, now: () => Date.now() });
  const notPrinted: FieldFetcher = async () => ({ outcome: 'NOT_PRINTED' }) as never;

  it("round 1, finding 1 (the reviewer's probe): plan pass + walk + restore for 3 cycles under an ACTIVE override -> reopened 1, 0, 0", async () => {
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    const swap = ['CHITTORGARH', 'DOC', 'BSE'];
    const reopenedPerCycle: number[] = [];
    for (let cycle = 0; cycle < 3; cycle++) {
      const plan = await repo.reconcileSettledToOverrides([incoming('issue_size', swap, 'override:swap-968')]);
      reopenedPerCycle.push(plan.reopened);
      await walkFieldPlanForIPO(
        IPO_ID,
        realWalkDeps({ ranks: swap, origin: 'override:swap-968', fetchers: { CHITTORGARH: notPrinted } }),
        walkBudget()
      );
      const row = await readRow(id);
      expect(row.state).toBe('SUPPLIED');
      expect(row.chosenSource).toBe('DOC');
    }
    expect(reopenedPerCycle).toEqual([1, 0, 0]);
    const row = await readRow(id);
    expect([row.policyOrigin, row.rank1Source, row.rank2Source, row.rank3Source]).toEqual([
      'override:swap-968',
      ...swap,
    ]);
    expect(row.reopenedUnderPolicy).toBeNull();
  });

  it('override-expiry-no-flip-flop: expired before re-supply -> made due, the walk restores with its evidence, then every pass writes 0', async () => {
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    const seeded = await readRow(id);
    await repo.reconcileSettledToOverrides([incoming('issue_size', ['CHITTORGARH', 'DOC', null], 'override:swap-968')]);
    // The reopened row's walk failed transiently: CHECK_FAILED, next due at the next slot.
    await db
      .update(schema.ipoFieldPlan)
      .set({ state: 'CHECK_FAILED', nextDueAt: new Date(Date.now() + 3_600_000) } as never)
      .where(eq(schema.ipoFieldPlan.id, id));
    const registry = incoming('issue_size', ['DOC', 'BSE', null], 'registry:2');
    expect(await repo.reconcileSettledToOverrides([registry])).toEqual({ reopened: 0, retargeted: 0, restoreDue: 1 });
    // A second pass before the walk runs does not write the already-due row again.
    expect(await repo.reconcileSettledToOverrides([registry])).toEqual({ reopened: 0, retargeted: 0, restoreDue: 0 });
    await walkFieldPlanForIPO(
      IPO_ID,
      realWalkDeps({ ranks: ['DOC', 'BSE'], origin: 'registry:2', fetchers: {} }),
      walkBudget()
    );
    const restored = await readRow(id);
    expect(restored.state).toBe('SUPPLIED');
    expect(restored.reopenedUnderPolicy).toBeNull();
    expect(restored.nextDueAt).toBeNull();
    expect(restored.chosenSource).toBe(seeded.chosenSource);
    expect(restored.chosenConfirmedAt).toEqual(seeded.chosenConfirmedAt);
    expect(restored.policyOrigin).toBe('registry:2');
    for (let pass = 0; pass < 2; pass++) {
      expect(await repo.reconcileSettledToOverrides([registry])).toEqual({ reopened: 0, retargeted: 0, restoreDue: 0 });
    }
  });

  it('restoreSettledAfterReopen is guarded on the claim token and the marker', async () => {
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    await repo.reconcileSettledToOverrides([incoming('issue_size', ['CHITTORGARH', 'DOC', null], 'override:swap-968')]);
    const claimed = await repo.claimNextDueField({ ipoId: IPO_ID });
    expect(
      await repo.restoreSettledAfterReopen({ planRowId: id, claimToken: 'not-the-token', cause: 'x', tried: ANY_TRIED })
    ).toEqual({ restored: false, handedToSupersession: false });
    expect(
      await repo.restoreSettledAfterReopen({
        planRowId: id,
        claimToken: claimed!.claimToken!,
        cause: 'OVERRIDE_RESTORED: test',
        tried: ANY_TRIED,
      })
    ).toEqual({ restored: true, handedToSupersession: false });
    const row = await readRow(id);
    expect(row.state).toBe('SUPPLIED');
    expect(row.claimToken).toBeNull();
    expect(row.chosenSource).toBe('DOC');
  });

  it('round 1, finding 3: an RHP (with a receipt for the field) completed during the reopen -> handed to supersession, not restored', async () => {
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO_ID}::uuid`);
    const [drhp] = await db
      .insert(schema.documents)
      .values({
        ipoId: IPO_ID,
        type: 'DRHP',
        title: '968 DRHP',
        url: 'https://example.test/968-drhp.pdf',
        filingDate: '2026-06-01',
        extractionStatus: 'COMPLETED',
      } as never)
      .returning({ id: schema.documents.id });
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    await db
      .update(schema.ipoFieldPlan)
      .set({ chosenDocumentId: drhp.id, chosenDocumentType: 'DRHP' } as never)
      .where(eq(schema.ipoFieldPlan.id, id));
    await repo.reconcileSettledToOverrides([incoming('issue_size', ['CHITTORGARH', 'DOC', null], 'override:swap-968')]);
    // The better document lands WHILE the row is reopened (state PENDING): its COMPLETED-time
    // supersession skips the row, exactly the gap the review found.
    const [rhp] = await db
      .insert(schema.documents)
      .values({
        ipoId: IPO_ID,
        type: 'RHP',
        title: '968 RHP',
        url: 'https://example.test/968-rhp.pdf',
        filingDate: '2026-09-01',
        extractionStatus: 'COMPLETED',
      } as never)
      .returning({ id: schema.documents.id });
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value)
      VALUES (${rhp.id}::uuid, 'ipos', '', 'issueSize', '4500000000')
    `);
    try {
      await walkFieldPlanForIPO(
        IPO_ID,
        realWalkDeps({
          ranks: ['CHITTORGARH', 'DOC'],
          origin: 'override:swap-968',
          fetchers: { CHITTORGARH: notPrinted },
          supersessionForReopened: (ipoId, planRowId) => findSupersessorForReopenedRow(db as never, ipoId, planRowId),
        }),
        walkBudget()
      );
      const row = await readRow(id);
      expect(row.state).toBe('PENDING');
      expect(row.supersededBy).toBe(rhp.id);
      expect(row.reopenedUnderPolicy).toBeNull();
      expect(row.nextDueAt).not.toBeNull();
      expect(row.cause).toMatch(/^superseded by RHP/);
    } finally {
      await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
      await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO_ID}::uuid`);
    }
  });

  it('final review MAJOR: a matrix loss never overwrites an open HELD_DISPUTED_HIGH_VALUE_LIVE hold on the field', async () => {
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid`);
    const [hold] = (
      await db.execute(sql`
        INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2,
                                    resolved_source, resolution_reason, severity, detected_at)
        VALUES (${IPO_ID}::uuid, 'ipos', '', 'issueSize', 'NSE', '5000000000', 'DRHP', '4500000000',
                'DRHP', 'HELD_DISPUTED_HIGH_VALUE_LIVE', 'CRITICAL', now())
        RETURNING *
      `)
    ).rows as Array<Record<string, unknown>>;
    const id = await seedSupplied('issue_size', 'DOC', ['DOC', 'BSE', null], 'registry:2');
    await repo.reconcileSettledToOverrides([incoming('issue_size', ['CHITTORGARH', 'DOC', null], 'override:swap-968')]);
    const conflicts = new DataConflictsRepository(db as never, { del: async () => 0, keys: async () => [] } as never);
    const deps = realWalkDeps({
      ranks: ['CHITTORGARH', 'DOC'],
      origin: 'override:swap-968',
      fetchers: { CHITTORGARH: async () => ({ outcome: 'SUPPLIED', value: 5100000000 }) as never },
    });
    // The consolidator keeps the document value: a priority-matrix loss.
    (deps.orchestrator as any).consolidatedUpsertIPO = async (
      _s: any,
      _src: any,
      _c?: any,
      _p?: any,
      only?: string[]
    ) =>
      consolidatedUpsertResultFixture({
        ipoId: IPO_ID,
        fieldResults: [fieldResult(only![0], 4500000000, 'DRHP' as never)],
      });
    deps.logAdminConflict = (input) => conflicts.upsertConflict(input as never);
    try {
      await walkFieldPlanForIPO(IPO_ID, deps, walkBudget());
      const rows = (
        await db.execute(sql`SELECT * FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid ORDER BY detected_at`)
      ).rows as Array<Record<string, unknown>>;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(hold);
      expect((await readRow(id)).state).toBe('SUPPLIED');
    } finally {
      await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid`);
    }
  });
});
