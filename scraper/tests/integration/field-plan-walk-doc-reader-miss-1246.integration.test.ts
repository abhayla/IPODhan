// implements: #1246 round 2 + OD-153 -- spec data-sourcing-pull-model.md §5.3 rule 4 ("the pull loop then
// asks rank 2 for the dropped field"), OD-62 (a reason, never a bare null), OD-153 (a re-read refusal of an
// older stored value clears it with the refusal as its reason and the next-ranked source is asked).
// REAL walk + REAL DOC fetcher + REAL DataConsolidationOrchestrator + REAL ipo_field_plan claim SQL +
// the PRODUCTION OD-153 clear deps (makeRereadRefusalClear) on ipodhan_test.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
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

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-000000124601';
const DOC = '00000000-0000-4000-8000-0000001246d0';
const SLUG = 'zzq1246-doc-reader-miss-testco';

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe.skipIf(!DATABASE_URL)('#1246 / OD-153: a DOC reader miss or a re-read refusal -> rank 2 is asked and written (ipodhan_test)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let planRepo: IpoFieldPlanRepository;
  let fieldSources: FieldSourcesRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let docFetcher: FieldFetcher;
  let clearDeps: import('../../src/services/reread-refusal-clear.js').RereadRefusalClearDeps;
  let clearRefused: typeof import('../../src/services/reread-refusal-clear.js').clearRefusedStoredValues;

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
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const cur = (await pool.query('select current_database() AS d')).rows[0].d as string;
    if (cur !== 'ipodhan_test') throw new Error(`Refusing to run against ${cur}; ipodhan_test only`);
    db = drizzle(pool, { schema });
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    const { buildDocFetcher } = await import('../../src/services/field-plan-walk-doc-fetcher.js');
    const { makeRereadRefusalClear, makeIpoDetailsWriter } = await import('../../src/services/filing-persist-deps.js');
    ({ clearRefusedStoredValues: clearRefused } = await import('../../src/services/reread-refusal-clear.js'));
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
    clearDeps = makeRereadRefusalClear({
      db: db as never,
      fieldSources,
      fieldExtractionFailures: new FieldExtractionFailuresRepository(db as never, noRedis as never),
      financialData: new FinancialDataRepository(db as never, noRedis as never),
      ipoDetailsWriter: makeIpoDetailsWriter(db as never),
      // No admin hold in this fixture: the gate passes everything (the hold case is the unit test's).
      protectionFilter: async (_id, _t, data) => ({ filtered: data }),
    });
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
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

  it('OD-153: an older reader of the SAME document stored 7, the newer reader refuses it -> cleared with reason, plan reopened, rank 2 asked and written', async () => {
    // The older read: value 7 in the column, its provenance naming THIS document and extractor v1,
    // and a SUPPLIED plan row chosen from this document.
    await db.execute(sql`INSERT INTO ipo_details (ipo_id, lot_multiple, data_source) VALUES (${IPO}::uuid, 7, 'DRHP')`);
    await fieldSources.trackFieldUpdate({
      ipoId: IPO, tableName: 'ipo_details', fieldName: 'lotMultiple', source: 'DRHP', confidence: 100,
      dataLineage: { method: 'FILING_EXTRACTION', docType: 'RHP', documentId: DOC, sourceSha: 'c'.repeat(64), extractorVersion: 'v1' },
      updatedBy: 'FILING_PERSISTER',
    } as never);
    const [plan] = await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO, tableName: 'ipo_details', rowKey: '', fieldName: 'lot_multiple',
      rank1Source: 'DOC', rank2Source: 'CHITTORGARH', state: 'SUPPLIED', manifestVersion: 2, nextDueAt: null,
      chosenSource: 'DOC', chosenRank: 1, chosenDocumentId: DOC,
    } as never).returning({ id: schema.ipoFieldPlan.id });

    // The re-read by extractor v2 refuses the field.
    const cleared = await clearRefused(
      {
        ipoId: IPO, docType: 'RHP', documentId: DOC, sourceSha: 'c'.repeat(64), extractorVersion: 'v2',
        fields: { lot_multiple: { value: 7, check: { passed: false, detail: 'lot_multiple_not_on_cover' } } },
      },
      clearDeps
    );
    expect(cleared.cleared).toEqual(['ipo_details.lotMultiple']);
    expect(cleared.reopenedPlanRowIds).toEqual([plan.id]);
    expect(await lotMultiple()).toBeNull();
    const failures = await db.select().from(schema.fieldExtractionFailures).where(eq(schema.fieldExtractionFailures.ipoId, IPO));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ tableName: 'ipo_details', fieldName: 'lotMultiple', ruleId: 'FAILED_VALIDATION', documentId: DOC });
    expect(failures[0].cause).toMatch(/^OD-153: RHP re-read \(extractor v2\) refused lot_multiple; stored 7 from extractor v1/);
    const [reopened] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(reopened.state).toBe('PENDING');

    // The walk: DOC (provenance over an empty column) is a reader gap, CHITTORGARH supplies 4.
    const cg = vi.fn(async () => ({ outcome: 'SUPPLIED', value: 4 }) as never);
    await walk(IPO, deps(cg) as never, budget());
    expect(cg).toHaveBeenCalledTimes(1);
    const [row] = await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, plan.id));
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenSource).toBe('CHITTORGARH');
    expect((await provenance())?.source).toBe('CHITTORGARH');
  }, 60000);
});
