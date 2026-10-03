// implements: R-285
// #1498 follow-up -- spec data-sourcing-pull-model.md OD-171 (amended: a change to the DOC fetcher's answer
// logic, DOC_FETCHER_LOGIC_SINCE, counts like a re-read), §2.5.1 trigger 8, F-240.
// REAL claim SQL + REAL walk + REAL DOC fetcher (receipts and versions read by the production queries) on ipodhan_test.
//
// The class: a DOC-ranked plan row in PENDING / NOT_AVAILABLE_YET / CHECK_FAILED last attempted BEFORE the current
// DOC-fetcher logic shipped, whose document of the type the DOC rank reads holds a non-empty record read at or above
// that type's re-read floor. #1501's leg re-opens a row only when the document was re-read after the last attempt, so
// a row the OLD fetcher answered CHECK_FAILED from a record it could not use (F-240: an empty unowned column) was never
// asked again. Staging 2026-10-03: nityas-gems-and-jewellery-ltd ipos.objectives CHECK_FAILED, last attempt 08:27 IST,
// RHP read 05:48 IST holding the value, ipos.objectives NULL.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { eq, sql } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias (worktree junction guard, as the sibling walk tests).
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DocumentRepository } from '../../../packages/shared/src/repositories/document-repository';
import type { FieldFetcher } from '../../src/services/field-plan-walk.js';
import { buildDocFetcherChangeReask, rereadSinceFor, REREAD_SINCE_DEFAULT } from '../../src/services/extractor-version-floors.js';

process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const IPO = '00000000-0000-4000-8000-000000150601';
const DOC = '00000000-0000-4000-8000-0000001506d0';
const SLUG = 'zzq1506-fetcher-change-reask-testco';

const RECEIPT_DOC_TYPES = { 'ipos.price_range_min': ['RHP'], 'ipos.price_range_max': ['RHP'], 'ipos.lot_size': ['RHP'] };
const HOUR = 3_600_000;

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe('#1498 follow-up: a DOC-fetcher logic change re-asks a row attempted before it, once (ipodhan_test)', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let docFetcher: FieldFetcher;
  // The fetcher logic "shipped" one hour ago in every case below; built by the production builder.
  let fetcherChange: ReturnType<typeof buildDocFetcherChangeReask>;

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ${IPO}::uuid`);
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO}::uuid`);
    await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO));
  }

  beforeAll(async () => {
    db = await getTestDb();
    const { DataConsolidationOrchestrator } = await import('../../src/services/data-consolidation-orchestrator.js');
    ({ walkFieldPlanForIPO: walk } = await import('../../src/services/field-plan-walk.js'));
    const { buildDocFetcher } = await import('../../src/services/field-plan-walk-doc-fetcher.js');
    const { loadSupersessionInputs } = await import('../../src/services/plan-supersession.js');
    const fieldSources = new FieldSourcesRepository(db as never, noRedis as never);
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
      receiptReader: async (ipoId: string) => (await loadSupersessionInputs(db as never, ipoId)).receipts,
      // makeRecordedVersionReader's query, on the test database (that factory reads the app's global pool).
      recordedVersionReader: async (ipoId: string) => {
        const r = await db.execute(sql`
          SELECT d.id AS "documentId",
                 COALESCE((SELECT s.extractor_version FROM document_fetch_state s WHERE s.document_id = d.id LIMIT 1),
                          (SELECT s.extractor_version FROM document_fetch_state s
                            WHERE s.ipo_id = d.ipo_id AND s.doc_type::text = d.type::text LIMIT 1)) AS "recordedVersion"
            FROM documents d WHERE d.ipo_id = ${ipoId}`);
        const rows = ((r as unknown as { rows?: unknown[] }).rows ?? []) as Array<{ documentId: string; recordedVersion: string | null }>;
        return new Map(rows.map((x) => [String(x.documentId), x.recordedVersion ?? null]));
      },
    } as never);
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await cleanupTestDb();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    fetcherChange = buildDocFetcherChangeReask(RECEIPT_DOC_TYPES, new Date(Date.now() - HOUR).toISOString());
    // The nityas shape: the column is EMPTY and nobody owns it (no field_sources row).
    await db.insert(schema.ipos).values({
      id: IPO, companyName: 'Zzq1506 Fetcher Change Reask Testco Limited', slug: SLUG,
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'OPEN', sector: 'Technology',
    } as never);
    // The RHP was read 3 h ago: BEFORE the row's last attempt in every case, so #1501's re-read leg never fires.
    const read = new Date(Date.now() - 3 * HOUR).toISOString();
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, sha256, extracted_at)
      VALUES (${DOC}::uuid, ${IPO}::uuid, 'RHP', 'Fetcher change proof RHP', 'https://example.invalid/rhp.pdf', 'COMPLETED', ${'a'.repeat(64)}, ${read}::timestamp)`);
  });

  const budget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });
  function deps(over: Record<string, unknown> = {}) {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: docFetcher },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({ ranks: ['DOC'], documentType: 'RHP', origin: { kind: 'registry', version: 2 }, na: false })) as never,
      receiptDocTypes: RECEIPT_DOC_TYPES,
      fetcherChange,
      ...over,
    };
  }
  /** A plan row last attempted `agoMs` before now (bound as an ISO string: naive column, ist-timezone rule). */
  async function seedPlan(fieldName: string, over: Record<string, unknown>, agoMs: number) {
    const last = new Date(Date.now() - agoMs).toISOString();
    const [row] = await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName,
      rank1Source: 'DOC', state: 'CHECK_FAILED', manifestVersion: 2, nextDueAt: null,
      cause: 'rank1:DOC:CHECK_FAILED:no document provenance',
      ...over,
    } as never).returning({ id: schema.ipoFieldPlan.id });
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = ${last}::timestamp WHERE id = ${row.id}::uuid`);
    return row.id;
  }
  async function seedReceipt(camelField: string, value: string) {
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value, source_text)
      VALUES (${DOC}::uuid, 'ipos', '', ${camelField}, ${value}, 'TEXT')`);
  }
  /** The extractor version that read the RHP (document_fetch_state, the row item 45's re-read selection reads). */
  async function seedVersion(version: string | null) {
    await db.execute(sql`
      INSERT INTO document_fetch_state (ipo_id, doc_type, state, document_id, extractor_version)
      VALUES (${IPO}::uuid, 'RHP', 'EXTRACTED', ${DOC}::uuid, ${version})`);
  }
  async function plan(id: string) {
    return (await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id)))[0];
  }

  it('a row attempted BEFORE the fetcher change, with a current-version record, is offered once and answered from the record', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMin', '70');
    await seedVersion(rereadSinceFor('RHP'));

    expect((await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).map((r) => r.id)).toEqual([id]);
    const result = await walk(IPO, deps() as never, budget());

    expect(result.fieldsAttempted).toBe(1);
    expect(result.receiptReopened).toEqual([
      { tableName: 'ipos', rowKey: '', fieldName: 'price_range_min', stateBefore: 'CHECK_FAILED', attemptsBefore: 16, outcome: 'SUPPLIED' },
    ]);
    const row = await plan(id);
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenDocumentId).toBe(DOC);
    const [ipo] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(String(ipo.priceRangeMin)).toBe('70');
  }, 60000);

  it('no loop: after the attempt (last_attempt_at now past the marker) the same row is not offered again', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMin', '70');
    await seedVersion(rereadSinceFor('RHP'));
    expect((await walk(IPO, deps() as never, budget())).fieldsAttempted).toBe(1);
    // Force the row back to the stuck shape, keeping the walk's last_attempt_at.
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'CHECK_FAILED', attempts = 16 WHERE id = ${id}::uuid`);

    const second = await walk(IPO, deps() as never, budget());
    expect(second.fieldsAttempted).toBe(0);
    expect(second.receiptReopened).toEqual([]);
  }, 60000);

  it('a dropped write: the walk stamps the attempt, so the row is not offered again', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMin', '71');
    await seedVersion(rereadSinceFor('RHP'));
    const docWrites: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 71, documentId: DOC, documentType: 'RHP' }) as never;
    const dropping = {
      consolidatedUpsertIPO: async () => ({ ipoId: '', isNew: false, locked: false, skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: unknown[]) => ({
        rowsProcessed: rows.length, rowsUpdated: 0, rowsSkipped: rows.length, conflictsDetected: 0, rows: [],
      }),
    };

    const result = await walk(IPO, deps({ orchestrator: dropping, sourceFetchers: { DOC: docWrites } }) as never, budget());

    expect(result.receiptReopened?.[0]?.outcome).toBe('write-dropped');
    expect((await plan(id)).lastAttemptAt!.getTime()).toBeGreaterThan(Date.now() - HOUR);
    expect(await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).toEqual([]);
  }, 60000);

  it('a row attempted AFTER the fetcher change is not offered (the current logic already answered it)', async () => {
    await seedPlan('price_range_min', { attempts: 16 }, HOUR / 2);
    await seedReceipt('priceRangeMin', '70');
    await seedVersion(rereadSinceFor('RHP'));
    expect(await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).toEqual([]);
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).toBeNull();
  }, 60000);

  it('fail closed: a record read below its type floor, with no recorded version, or empty is not offered; nor without the marker', async () => {
    await seedPlan('price_range_min', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMin', '70');
    await seedPlan('price_range_max', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMax', '');
    // Below the RHP floor (the baseline version every type was read at).
    expect(rereadSinceFor('RHP') > REREAD_SINCE_DEFAULT).toBe(true);
    await seedVersion(REREAD_SINCE_DEFAULT);
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).toBeNull();

    await db.execute(sql`DELETE FROM document_fetch_state WHERE ipo_id = ${IPO}::uuid`);
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange })).toBeNull();

    await seedVersion(rereadSinceFor('RHP'));
    // Current version now, but no marker passed: #1501's leg alone (no re-read after the attempt) offers nothing.
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES })).toBeNull();
    // A type with no floor in the map: fail closed.
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange: { ...fetcherChange, currentVersionFloors: {} } })).toBeNull();
    // With the marker, only the non-empty record's row is offered.
    const listed = await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange });
    expect(listed.map((r) => r.fieldName)).toEqual(['price_range_min']);
  }, 60000);

  it('live tier first: the IPO\'s ordinary PENDING row is claimed before the fetcher-change re-ask', async () => {
    const pendingId = await seedPlan('lot_size', { state: 'PENDING', attempts: 0 }, 2 * HOUR);
    const reaskId = await seedPlan('price_range_min', { attempts: 16 }, 2 * HOUR);
    await seedReceipt('priceRangeMin', '70');
    await seedVersion(rereadSinceFor('RHP'));
    const first = await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange });
    expect(first?.id).toBe(pendingId);
    const second = await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, fetcherChange, excludeIds: [pendingId] });
    expect(second?.id).toBe(reaskId);
    await planRepo.releaseClaimUnrecorded({ planRowId: first!.id, claimToken: first!.claimToken });
    await planRepo.releaseClaimUnrecorded({ planRowId: second!.id, claimToken: second!.claimToken });
  }, 60000);
});
