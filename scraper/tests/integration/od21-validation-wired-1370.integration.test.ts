// implements: OD-21 (owner 2026-09-09, spec §5.3 "one bad field must not discard the row, and must not loop")
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';

/**
 * #1370 / F-216: the OD-21 per-field validation gate ran in unit tests only, because no PRODUCTION
 * construction of the consolidator was given the field-extraction-failures repository, and the gate
 * does not run without one. This suite drives the PRODUCTION wiring on ipodhan_test, never a
 * hand-built service:
 *   - the persister's consolidation door (`upsertIPO`, data-persister.ts),
 *   - the persister's fallback door (consolidation throws; the pre-rank checks still run),
 *   - the orchestrator the scraper cycle, the pull walk and the document persister all build
 *     (`createConsolidationOrchestrator`, consolidation-factory.ts).
 *
 * Spec §5.3 rules asserted on every door, with the flag ENABLE_FIELD_EXTRACTION_VALIDATION on:
 *   1-2. the failing field (faceValue 3 on an equity IPO; rule face_value_equity_enum, which the field
 *        matrix bounds alone would accept) is dropped and a field_extraction_failures row records the
 *        rule, the source, the value as extracted and the cause in words;
 *   3.   the other fields on the same write ARE written (lotSize 50);
 *   5.   nothing is scheduled by time: no document_fetch_state row with a next_retry_at appears.
 * And the control: with the flag OFF the same value is written and no failure row appears (the gate
 * is the thing that drops it, so the proof can fail).
 *
 * ipodhan_test held no real out-of-rule value when this was written (measured 2026-10-01: 0 ipos rows
 * with face_value outside {1,2,5,10}), so the value is constructed against a real rule from
 * scraper/config/validation-rules.json; the real-data proof is the staging cycle once the flag is on.
 */
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };
vi.mock('@ipodhan/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ipodhan/shared')>()),
  getRedisClient: () => noRedis,
}));

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-000000137001';
const NAME = 'Zzqod21 Wired Gate Testco Limited';
const SLUG = 'zzqod21-wired-gate-testco-limited';

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let savedFlags: Record<string, unknown> = {};

async function cleanup() {
  await db.delete(schema.fieldExtractionFailures).where(inArray(schema.fieldExtractionFailures.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ${IPO}::uuid`);
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
}

async function setGate(on: boolean) {
  const { FEATURE_FLAGS } = await import('../../src/config/feature-flags');
  (FEATURE_FLAGS as Record<string, unknown>).ENABLE_FIELD_EXTRACTION_VALIDATION = on;
}

describe.skipIf(!DATABASE_URL)('#1370: OD-21 validation runs on every production consolidator construction (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    const cur = (await pool.query('select current_database() AS d')).rows[0].d as string;
    if (cur !== 'ipodhan_test') throw new Error(`Refusing to run against ${cur}; ipodhan_test only`);
    db = drizzle(pool, { schema });
    await cleanup();
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags');
    const flags = FEATURE_FLAGS as Record<string, unknown>;
    savedFlags = {
      ENABLE_DATA_CONSOLIDATION: flags.ENABLE_DATA_CONSOLIDATION,
      CONSOLIDATION_PERCENTAGE: flags.CONSOLIDATION_PERCENTAGE,
      ENABLE_SOURCE_TRACKING: flags.ENABLE_SOURCE_TRACKING,
      ENABLE_FIELD_EXTRACTION_VALIDATION: flags.ENABLE_FIELD_EXTRACTION_VALIDATION,
    };
    flags.ENABLE_DATA_CONSOLIDATION = true;
    flags.CONSOLIDATION_PERCENTAGE = 100;
    flags.ENABLE_SOURCE_TRACKING = true;
  });
  afterAll(async () => {
    const { FEATURE_FLAGS } = await import('../../src/config/feature-flags');
    Object.assign(FEATURE_FLAGS as Record<string, unknown>, savedFlags);
    if (db) await cleanup();
    await pool?.end();
  });
  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: NAME, slug: SLUG, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', sector: 'Technology',
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  async function stored(): Promise<{ faceValue: unknown; lotSize: unknown }> {
    const [row] = await db
      .select({ faceValue: schema.ipos.faceValue, lotSize: schema.ipos.lotSize })
      .from(schema.ipos)
      .where(eq(schema.ipos.id, IPO));
    return { faceValue: row?.faceValue ?? null, lotSize: row?.lotSize ?? null };
  }

  async function failures() {
    return db
      .select()
      .from(schema.fieldExtractionFailures)
      .where(eq(schema.fieldExtractionFailures.ipoId, IPO));
  }

  async function timedRetries(): Promise<number> {
    const r = await db.execute(sql`SELECT count(*)::int AS n FROM document_fetch_state WHERE ipo_id = ${IPO}::uuid AND next_retry_at IS NOT NULL`);
    return Number((r.rows[0] as { n: number }).n);
  }

  async function viaPersister(door: 'primary' | 'fallback') {
    const { DataConsolidationService } = await import('../../src/services/data-consolidation-service');
    const spy = door === 'fallback'
      ? vi.spyOn(DataConsolidationService.prototype, 'consolidateIPOData').mockRejectedValue(new Error('consolidation failed (simulated)'))
      : null;
    const { upsertIPO } = await import('../../src/services/data-persister');
    const repo = new IPORepository(db as never, noRedis as never);
    const existing = await repo.findByIdUncached(IPO);
    await upsertIPO(
      repo,
      { companyName: NAME, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', faceValue: 3, lotSize: 50 } as never,
      'NSE',
      existing as never
    );
    if (spy) expect(spy).toHaveBeenCalled();
  }

  async function viaFactoryOrchestrator() {
    const { createConsolidationOrchestrator, buildConsolidationDeps } = await import('../../src/services/consolidation-factory');
    const ipoRepository = new IPORepository(db as never, noRedis as never);
    const orchestrator = createConsolidationOrchestrator(
      ipoRepository as never,
      buildConsolidationDeps(db as never, noRedis as never),
      null
    );
    await orchestrator.consolidatedUpsertIPO(
      { companyName: NAME, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING', faceValue: 3, lotSize: 50 } as never,
      'NSE' as never,
      100,
      { id: IPO, companyName: NAME, slug: SLUG, segment: 'MAINBOARD', offeringType: 'IPO', status: 'UPCOMING' } as never
    );
  }

  async function expectDroppedAndRecorded() {
    const s = await stored();
    expect(s.faceValue, 'the failing field is dropped (spec §5.3 rule 2)').toBeNull();
    expect(Number(s.lotSize), 'the other fields are written (spec §5.3 rule 3)').toBe(50);
    const rows = await failures();
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      tableName: 'ipos',
      fieldName: 'faceValue',
      rowKey: '',
      ruleId: 'face_value_equity_enum',
      rankAttempted: 'NSE',
      extractedValue: '3',
      resolvedAt: null,
    });
    expect(rows[0].cause).toContain('face_value 3 is not one of the equity denominations');
    expect(await timedRetries(), 'no retry is scheduled by time (spec §5.3 rule 5)').toBe(0);
  }

  it('persister consolidation door: faceValue 3 is dropped with a failure row; lotSize is written', async () => {
    await setGate(true);
    await viaPersister('primary');
    await expectDroppedAndRecorded();
  });

  it('persister fallback door: the same drop and record when consolidation throws', async () => {
    await setGate(true);
    await viaPersister('fallback');
    await expectDroppedAndRecorded();
  });

  it('factory orchestrator (scraper cycle, pull walk, document persister): the same drop and record', async () => {
    await setGate(true);
    await viaFactoryOrchestrator();
    await expectDroppedAndRecorded();
  });

  it('control: with the flag OFF the same value is written and no failure row appears', async () => {
    await setGate(false);
    await viaPersister('primary');
    expect(Number((await stored()).faceValue)).toBe(3);
    expect((await failures()).length).toBe(0);
  });
});
