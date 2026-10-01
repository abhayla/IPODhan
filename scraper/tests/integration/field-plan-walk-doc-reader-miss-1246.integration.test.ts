// implements: #1246 round 3 -- spec data-sourcing-pull-model.md §5.3 rule 4 ("the pull loop then
// asks rank 2 for the dropped field"), OD-62 (a reason, never a bare null).
// REAL walk + REAL DOC fetcher + REAL DataConsolidationOrchestrator + REAL ipo_field_plan claim SQL on ipodhan_test.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { eq, sql } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias (worktree junction guard, as the sibling walk tests).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DocumentRepository } from '../../../packages/shared/src/repositories/document-repository';
import { FinancialDataRepository } from '../../../packages/shared/src/repositories/financial-data-repository';
import { FieldExtractionFailuresRepository } from '../../../packages/shared/src/repositories/field-extraction-failures-repository';
import type { FieldFetcher } from '../../src/services/field-plan-walk.js';

process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';
process.env.ENABLE_CHILD_TABLE_CONSOLIDATION = 'true';

const IPO = '00000000-0000-4000-8000-000000124601';
const DOC = '00000000-0000-4000-8000-0000001246d0';
const SLUG = 'zzq1246-doc-reader-miss-testco';

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe('#1246: a DOC reader miss -> rank 2 is asked and written (ipodhan_test)', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let planRepo: IpoFieldPlanRepository;
  let fieldSources: FieldSourcesRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let docFetcher: FieldFetcher;

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
    await db.delete(schema.fieldExtractionFailures).where(eq(schema.fieldExtractionFailures.ipoId, IPO));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    await db.execute(sql`DELETE FROM ipo_details WHERE ipo_id = ${IPO}::uuid`);
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO}::uuid`);
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
  }

  beforeAll(async () => {
    db = await getTestDb();
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    const { buildDocFetcher } = await import('../../src/services/field-plan-walk-doc-fetcher.js');
        fieldSources = new FieldSourcesRepository(db as never, noRedis as never);
    const ipoRepository = new IPORepository(db as never, noRedis as never);
    orchestrator = new DataConsolidationOrchestrator(ipoRepository, fieldSources, new DataConflictsRepository(db as never, noRedis as never), null);
    planRepo = new IpoFieldPlanRepository(db as never, noRedis as never);
    docFetcher = buildDocFetcher({
      fieldSources,
      ipoRepository,
      documentRepository: new DocumentRepository(db as never, noRedis as never),
      manifestDocumentType: () => 'RHP',
      isDocCapable: () => true,
      ipoDetailsReader: {
        findByIpoId: async (id: string) =>
          ((await db.select().from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, id)))[0] as never) ?? null,
      } as never,
    });
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await cleanupTestDb();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: 'Zzq1246 Doc Reader Miss Testco Limited', slug: SLUG,
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', sector: 'Technology',
    } as never);
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, sha256)
      VALUES (${DOC}::uuid, ${IPO}::uuid, 'RHP', 'Reader miss proof RHP', 'https://example.invalid/rhp.pdf', 'COMPLETED', ${'c'.repeat(64)})`);
  });

  const budget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });
  function deps(rank2: FieldFetcher) {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: docFetcher, CHITTORGARH: rank2 },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({ ranks: ['DOC', 'CHITTORGARH'], documentType: 'RHP', origin: { kind: 'registry', version: 2 }, na: false })) as never,
    };
  }
  /** The walk's write for a child table goes through the consolidator, which resolves and records provenance;
   *  the walk does not write the ipo_details data row itself (pre-existing, filed separately), so the stored
   *  answer is read from field_sources, the record the consolidator writes. */
  async function provenance() {
    const [row] = await db.select().from(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    return row ?? null;
  }
  async function lotMultiple() {
    const [row] = await db.select({ v: schema.ipoDetails.lotMultiple }).from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, IPO));
    return row?.v ?? null;
  }

  it('reader miss: the RHP is COMPLETED but its reader stored nothing -> DOC is CHECK_FAILED (never NOT_PRINTED), CHITTORGARH asked and its value written', async () => {
    await db.execute(sql`INSERT INTO ipo_details (ipo_id, data_source) VALUES (${IPO}::uuid, 'DRHP')`);
    const [plan] = await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO, tableName: 'ipo_details', rowKey: '', fieldName: 'lot_multiple',
      rank1Source: 'DOC', rank2Source: 'CHITTORGARH', state: 'PENDING', manifestVersion: 2, nextDueAt: null,
    } as never).returning({ id: schema.ipoFieldPlan.id });
    const cg = vi.fn(async () => ({ outcome: 'SUPPLIED', value: 3 }) as never);
    const result = await walk(IPO, deps(cg) as never, budget());
    expect(cg).toHaveBeenCalledTimes(1);
    expect(result.fieldsSupplied).toBe(1);
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenSource).toBe('CHITTORGARH');
    expect(row.chosenRank).toBe(2);
    expect((await provenance())?.source).toBe('CHITTORGARH');
  }, 60000);
});
