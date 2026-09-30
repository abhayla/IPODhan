// implements: OD-144 (owner 2026-09-30, spec §2.8) on top of OD-142 -- the walk's REAL
// DataConsolidationOrchestrator against ipodhan_test, the Mopshop shape (MAINBOARD -> SME_BSE).
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
// Relative imports (field-plan-walk-real-writer.integration.test.ts: the worktree alias guard).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { SOURCE_NO_LONGER_FIRST } from '../../../packages/shared/src/services/source-no-longer-first';
import type { FieldFetcher, FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';
import { generateFieldPlan, type PlanIpo } from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';

/**
 * CORE (OD-144): after an admin corrects FPO/MAINBOARD -> IPO/SME (BSE-listed), `ipos.open_date`
 * keeps NSE's value and gets ONE "source no longer first" item (OD-142). When the plan's rank-1
 * source for the CURRENT type (BSE) answers through the real walk and the real consolidator, its
 * answer REPLACES the kept NSE value although the global matrix ranks NSE above BSE for openDate
 * (and although the IPO is OPEN, where a HIGH_VALUE dispute would otherwise HOLD), and the item
 * clears. No owner alert is raised for the item or for the replacement.
 *
 * NON-RANK-1 (Tier A mutant M1): when the new rank 1 fails and rank 2 (CHITTORGARH) answers, the
 * kept value stays and the item stays open.
 *
 * Flags bake at import (see field-plan-walk-real-writer.integration.test.ts), so the walk and the
 * orchestrator are imported dynamically after these lines. Run:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/od144-plan-rank-write.integration.test.ts
 */
process.env.ENABLE_POLICY_WRITER = 'true';
process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
process.env.ENABLE_CONFLICT_DETECTION = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000d1440';
const SLUG = 'od144-plan-rank-write-proof-ipo';
const manifest = loadFieldManifest();
const KEPT = '2026-10-05';
const BSE_ANSWER = '2026-10-09';
const CG_ANSWER = '2026-10-11';

// Cache reads miss and fall through to the database; the consolidator's per-IPO write lock needs a
// real Redis (the same local test Redis the real-writer suite uses, db 15).
const noRedis = new Proxy({}, { get: () => async () => null }) as never;
let redis: Redis | null = null;

type WalkFn = typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
type MonitorFn = typeof import('../../src/services/cross-source-disagreement-monitor.js').checkCrossSourceDisagreements;

describe.skipIf(!DATABASE_URL)('OD-144: the current type\'s rank 1 replaces a value kept under OD-142 (ipodhan_test)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let walk: WalkFn;
  let monitor: MonitorFn;
  let orchestrator: FieldPlanWalkOrchestrator;

  async function cleanup() {
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO}::uuid`);
    await db.delete(schema.ipoFieldPlan).where(inArray(schema.ipoFieldPlan.ipoId, [IPO]));
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
    await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
    await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
  }

  async function save(fieldName: string, value: unknown) {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', fieldName);
    const r = await writeAdminFieldValue(
      db as never,
      {
        ipoId: IPO,
        tableName: 'ipos',
        fieldName,
        value,
        mode: { kind: 'typed', sourceNote: 'RHP cover page' },
        expectedVersion: v!.version,
        actor: { name: 'od144-admin', adminId: 'admin-it' },
        entryPoint: 'test',
      },
      undefined,
      { planManifest: manifest }
    );
    expect(r.kind, JSON.stringify(r)).toBe('OK');
  }

  const openItems = async () =>
    (
      await db.execute(sql`
        SELECT field_name FROM data_conflicts
         WHERE ipo_id = ${IPO}::uuid AND resolved_at IS NULL AND resolution_reason = ${SOURCE_NO_LONGER_FIRST}
         ORDER BY field_name`)
    ).rows.map((r) => (r as { field_name: string }).field_name);

  const readOpenDate = async () => {
    const [row] = await db.select({ openDate: schema.ipos.openDate }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    return String(row.openDate);
  };

  function deps(fetchers: Record<string, FieldFetcher>) {
    return {
      fieldPlanRepository: new IpoFieldPlanRepository(db as never, noRedis) as never,
      orchestrator,
      sourceFetchers: fetchers,
      ipoRepository: {
        findById: async (id: string) => {
          const [row] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, id));
          return row ?? null;
        },
      } as never,
      // The walk asks in the rebuilt plan row's own order (SME_BSE: BSE, CHITTORGARH).
      resolvePolicy: (async () => ({ ranks: ['BSE', 'CHITTORGARH'], documentType: undefined, origin: { kind: 'registry' as const, version: manifest.version }, na: false })) as never,
    };
  }
  const budget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });
  const answer = (value: string): FieldFetcher => async () => ({ outcome: 'SUPPLIED', value, documentType: undefined, page: undefined });

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const cur = (await pool.query('select current_database() AS d')).rows[0].d as string;
    if (cur !== 'ipodhan_test') throw new Error(`Refusing to run against ${cur}; ipodhan_test only`);
    db = drizzle(pool, { schema });
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    ({ checkCrossSourceDisagreements: monitor } = await import('../../src/services/cross-source-disagreement-monitor.js'));
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    orchestrator = new DataConsolidationOrchestrator(
      new IPORepository(db as never, redis as never),
      new FieldSourcesRepository(db as never, redis as never),
      new DataConflictsRepository(db as never, redis as never),
      redis as never
    ) as unknown as FieldPlanWalkOrchestrator;
    await cleanup();
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    const keys = await redis!.keys(`*${IPO}*`);
    if (keys.length > 0) await redis!.del(...keys);
    // Mopshop shape, OPEN (live: a HIGH_VALUE dispute would HOLD), open_date from NSE.
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, listing_exchanges, open_date, close_date, lot_size)
      VALUES (${IPO}::uuid, 'OD144 Proof Distribution Limited', ${SLUG}, 'MAINBOARD', 'OPEN', 'FPO', 'MAINBOARD',
              '["BSE"]'::jsonb, ${KEPT}, '2026-10-12', 1200)`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_by)
      VALUES (${IPO}::uuid, 'ipos', '', 'openDate', 'NSE', 90, 'test')`);
    const planIpo: PlanIpo = { id: IPO, segment: 'MAINBOARD', listingExchanges: ['BSE'] };
    await db.insert(schema.ipoFieldPlan).values(
      generateFieldPlan(planIpo, manifest).map((r) => ({
        ipoId: IPO, tableName: r.tableName, rowKey: '', fieldName: r.fieldName,
        rank1Source: r.rank1Source, rank2Source: r.rank2Source, rank3Source: r.rank3Source,
        state: 'SUPPLIED' as const, chosenSource: r.rank1Source, chosenRank: 1, attempts: 1,
        lastAttemptAt: new Date('2026-09-20T05:00:00Z'), manifestVersion: r.manifestVersion, policyOrigin: r.policyOrigin,
      }))
    );
    await save('offeringType', 'IPO');
    await save('segment', 'SME');
    expect(await openItems()).toContain('openDate');
    // Only open_date is walked in this proof; the other re-planted rows are out of its scope.
    await db.execute(sql`DELETE FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid AND field_name <> 'open_date'`);
    const [plan] = (await db.execute(sql`SELECT rank1_source, state FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid`)).rows as Array<{ rank1_source: string; state: string }>;
    expect(plan).toEqual({ rank1_source: 'BSE', state: 'PENDING' });
  }, 120000);

  it('CORE: BSE (rank 1 for SME_BSE) replaces the kept NSE value, the item clears, and no alert fires', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    try {
      // MAJOR-1 on the real query: the open OD-142 item on an OPEN IPO pages nobody.
      const before = await monitor(db as never);
      expect(before.disagreements.filter((d) => d.ipoId === IPO)).toEqual([]);

      const result = await walk(IPO, deps({ BSE: answer(BSE_ANSWER), CHITTORGARH: answer(CG_ANSWER) }), budget());
      expect(result.fieldsSupplied).toBe(1);
      expect(result.fieldsCheckFailed).toBe(0);

      expect(await readOpenDate()).toContain(BSE_ANSWER);
      const fs = await db.execute(sql`
        SELECT source::text AS source, previous_source::text AS previous_source FROM field_sources
         WHERE ipo_id = ${IPO}::uuid AND table_name = 'ipos' AND field_name = 'openDate'`);
      expect(fs.rows).toEqual([{ source: 'BSE', previous_source: 'NSE' }]);
      expect(await openItems()).not.toContain('openDate');
      const closed = await db.execute(sql`
        SELECT admin_note FROM data_conflicts WHERE ipo_id = ${IPO}::uuid AND field_name = 'openDate' AND resolved_at IS NOT NULL`);
      expect(closed.rows).toEqual([{ admin_note: 'OD-142 RANK1_ANSWERED' }]);
      // The replacement is not a new dispute: no unresolved openDate row of any reason.
      const disputes = await db.execute(sql`
        SELECT resolution_reason FROM data_conflicts WHERE ipo_id = ${IPO}::uuid AND field_name = 'openDate' AND resolved_at IS NULL`);
      expect(disputes.rows).toEqual([]);

      const after = await monitor(db as never);
      expect(after.disagreements.filter((d) => d.ipoId === IPO)).toEqual([]);
      const notifierCalls = fetchSpy.mock.calls.filter((c) => String(c[1]?.body ?? '').includes('OD144 Proof'));
      expect(notifierCalls).toEqual([]);
    } finally {
      fetchSpy.mockRestore();
    }
  }, 120000);

  it('NON-RANK-1: rank 1 fails and CHITTORGARH (rank 2) answers: the kept value stays and the item stays open', async () => {
    const bseFails: FieldFetcher = async () => ({ outcome: 'CHECK_FAILED', reason: 'BSE timeout (test)', transient: true } as never);
    const result = await walk(IPO, deps({ BSE: bseFails, CHITTORGARH: answer(CG_ANSWER) }), budget());
    expect(result.fieldsSupplied).toBe(0);
    expect(await readOpenDate()).toContain(KEPT);
    expect(await openItems()).toContain('openDate');
    const fs = await db.execute(sql`SELECT source::text AS source FROM field_sources WHERE ipo_id = ${IPO}::uuid AND field_name = 'openDate'`);
    expect(fs.rows).toEqual([{ source: 'NSE' }]);
  }, 120000);

  // Tier A surviving mutant (PR #1327): the walk grants the plan-rank win only when the open item
  // NAMES the answering source as its new rank 1. Here the plan row's rank 1 is re-pointed to
  // CHITTORGARH (an override, say) while the item still names BSE; CHITTORGARH answers as rank 1.
  // The kept NSE value must stay (the matrix ranks NSE above CHITTORGARH and the IPO is OPEN).
  // MUTATION: drop the "item names this source" comparison (or the item read) -> CHITTORGARH
  // replaces the kept value -> RED.
  it('PLAN-RANK WIN NEEDS THE ITEM: rank 1 answering while the open item names another source keeps the kept value', async () => {
    await db.execute(sql`UPDATE ipo_field_plan SET rank1_source = 'CHITTORGARH', rank2_source = 'BSE' WHERE ipo_id = ${IPO}::uuid AND field_name = 'open_date'`);
    const d = deps({ BSE: answer(BSE_ANSWER), CHITTORGARH: answer(CG_ANSWER) });
    d.resolvePolicy = (async () => ({ ranks: ['CHITTORGARH', 'BSE'], documentType: undefined, origin: { kind: 'registry' as const, version: manifest.version }, na: false })) as never;
    await walk(IPO, d, budget());
    expect(await readOpenDate()).toContain(KEPT);
    expect(await readOpenDate()).not.toContain(CG_ANSWER);
    const fs = await db.execute(sql`SELECT source::text AS source FROM field_sources WHERE ipo_id = ${IPO}::uuid AND field_name = 'openDate'`);
    expect(fs.rows).toEqual([{ source: 'NSE' }]);
    expect(await openItems()).toContain('openDate');
  }, 120000);

  it('each clear guard discriminates alone: a rank-1 plan answer from a source that is not the item\'s new rank 1, and the item\'s source answering while not the plan\'s rank 1, both leave it open', async () => {
    const repo = new IpoFieldPlanRepository(db as never, noRedis);
    const [row] = (await db.execute(sql`SELECT id FROM ipo_field_plan WHERE ipo_id = ${IPO}::uuid`)).rows as Array<{ id: string }>;
    const claim = (t: string) => db.execute(sql`UPDATE ipo_field_plan SET claim_token = ${t}, claimed_at = now() WHERE id = ${row.id}::uuid`);

    // (1) The plan row's rank 1 is re-pointed to CHITTORGARH (an override, say); CHITTORGARH answers as
    // rank 1. recordOutcome's own rank-1 check passes; only the item's newRank1 (BSE) guard refuses.
    await db.execute(sql`UPDATE ipo_field_plan SET rank1_source = 'CHITTORGARH' WHERE id = ${row.id}::uuid`);
    await claim('g1');
    expect((await repo.recordOutcome({ planRowId: row.id, claimToken: 'g1', writeHappened: true, state: 'SUPPLIED', chosen: { source: 'CHITTORGARH', rank: 1 } } as never)).written).toBe(true);
    expect(await openItems()).toContain('openDate');

    // (2) BSE, the item's new rank 1, answers while the plan row's rank 1 is CHITTORGARH (BSE as rank 2).
    // The item's guard would pass; only recordOutcome's "chosen = plan rank 1" check refuses.
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'PENDING' WHERE id = ${row.id}::uuid`);
    await claim('g2');
    expect((await repo.recordOutcome({ planRowId: row.id, claimToken: 'g2', writeHappened: true, state: 'SUPPLIED', chosen: { source: 'BSE', rank: 2 } } as never)).written).toBe(true);
    expect(await openItems()).toContain('openDate');
  }, 120000);
});
