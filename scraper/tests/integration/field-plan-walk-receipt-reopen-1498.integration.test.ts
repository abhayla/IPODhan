// implements: R-281
// #1498 -- spec data-sourcing-pull-model.md OD-171 (a newer document record re-opens a non-settled
// DOC-ranked plan row once), OD-161 (the DOC answer is judged by the document's own record), §2.5.1 trigger 8.
// REAL claim SQL + REAL walk + REAL DOC fetcher (receipts read by the production loader) on ipodhan_test.
//
// The class: a DOC-ranked plan row that is not SUPPLIED while one of the IPO's documents holds a record for the
// field newer than the row's last attempt. Before the fix no claim leg offered it once the row had hit the
// CHECK_FAILED attempts cap or carried a gap stamp the re-read did not change (staging 2026-10-03 06:40 IST: 232 DOC
// rank-1 rows / 52 IPOs, e.g. nityas-gems-and-jewellery-ltd price_range_min at 16 attempts with a 70 record from 2026-10-03).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
import { eq, sql } from 'drizzle-orm';
// Relative imports, NOT the `@ipodhan/shared` alias (worktree junction guard, as the sibling walk tests).
import * as schema from '../../../packages/shared/src/db/schema';
import {
  IpoFieldPlanRepository,
  FIELD_PLAN_RECLAIM_MAX_ATTEMPTS,
} from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DocumentRepository } from '../../../packages/shared/src/repositories/document-repository';
import type { FieldFetcher } from '../../src/services/field-plan-walk.js';

process.env.ENABLE_FIELD_PLAN = 'true';
process.env.ENABLE_FIELD_PLAN_WALK = 'true';
process.env.ENABLE_DATA_CONSOLIDATION = 'true';
process.env.CONSOLIDATION_PERCENTAGE = '100';
process.env.ENABLE_SOURCE_TRACKING = 'true';

const IPO = '00000000-0000-4000-8000-000000149801';
const DOC = '00000000-0000-4000-8000-0000001498d0';
const SLUG = 'zzq1498-receipt-reopen-testco';

const RECEIPT_DOC_TYPES = { 'ipos.price_range_min': ['RHP'], 'ipos.price_range_max': ['RHP'], 'ipos.lot_size': ['RHP'], 'ipos.cin': ['RHP'] };

const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] };

describe('#1498: a newer document record re-opens a non-settled DOC-ranked row once (ipodhan_test)', () => {
  let db: Awaited<ReturnType<typeof getTestDb>>;
  let planRepo: IpoFieldPlanRepository;
  let orchestrator: any;
  let walk: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let docFetcher: FieldFetcher;

  async function cleanup() {
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    await db.delete(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
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
      // The production receipt loader (field-plan-walk-deps.ts), on the test database.
      receiptReader: async (ipoId: string) => (await loadSupersessionInputs(db as never, ipoId)).receipts,
    });
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await cleanupTestDb();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.insert(schema.ipos).values({
      id: IPO, companyName: 'Zzq1498 Receipt Reopen Testco Limited', slug: SLUG,
      segment: 'MAINBOARD', offeringType: 'IPO', status: 'OPEN', sector: 'Technology',
      priceRangeMin: '70', priceRangeMax: '75',
    } as never);
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, sha256)
      VALUES (${DOC}::uuid, ${IPO}::uuid, 'RHP', 'Receipt reopen proof RHP', 'https://example.invalid/rhp.pdf', 'COMPLETED', ${'e'.repeat(64)})`);
    // The stored band belongs to a website (the nityas shape: an NSE/CG-owned value, the RHP record equal).
    for (const f of ['priceRangeMin', 'priceRangeMax']) {
      await db.execute(sql`
        INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source)
        VALUES (${IPO}::uuid, 'ipos', '', ${f}, 'CHITTORGARH')`);
    }
  });

  const budget = () => ({ deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 });
  function deps() {
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      sourceFetchers: { DOC: docFetcher },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({ ranks: ['DOC'], documentType: 'RHP', origin: { kind: 'registry', version: 2 }, na: false })) as never,
      receiptDocTypes: RECEIPT_DOC_TYPES,
    };
  }
  /** A plan row last attempted `lastAttemptAgo` ms before now (bound as an ISO string: naive column, ist-timezone rule). */
  async function seedPlan(fieldName: string, over: Record<string, unknown>, lastAttemptAgoMs: number) {
    const last = new Date(Date.now() - lastAttemptAgoMs).toISOString();
    const [row] = await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName,
      rank1Source: 'DOC', state: 'CHECK_FAILED', manifestVersion: 2, nextDueAt: null,
      ...over,
    } as never).returning({ id: schema.ipoFieldPlan.id });
    await db.execute(sql`UPDATE ipo_field_plan SET last_attempt_at = ${last}::timestamp WHERE id = ${row.id}::uuid`);
    return row.id;
  }
  async function seedReceipt(camelField: string, value: string, agoMs: number, documentId = DOC) {
    const at = new Date(Date.now() - agoMs).toISOString();
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value, source_text, created_at)
      VALUES (${documentId}::uuid, 'ipos', '', ${camelField}, ${value}, 'TEXT', ${at}::timestamp)`);
  }
  async function plan(id: string) {
    return (await db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.id, id)))[0];
  }

  it('a row at the attempts cap with a NEWER record is claimed and answered from the record (equal value -> credited SUPPLIED)', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16, cause: 'rank2:NSE:CHECK_FAILED:NSE board empty' }, 3 * 86_400_000);
    await seedReceipt('priceRangeMin', '70', 60_000);
    expect(16).toBeGreaterThanOrEqual(FIELD_PLAN_RECLAIM_MAX_ATTEMPTS);

    const result = await walk(IPO, deps() as never, budget());

    expect(result.fieldsAttempted).toBe(1);
    const row = await plan(id);
    expect(row.state).toBe('SUPPLIED');
    expect(row.chosenSource).toBe('DOC');
    expect(row.chosenDocumentId).toBe(DOC);
    expect(result.receiptReopened).toEqual([
      { tableName: 'ipos', rowKey: '', fieldName: 'price_range_min', stateBefore: 'CHECK_FAILED', attemptsBefore: 16, outcome: 'SUPPLIED' },
    ]);
    const [ipo] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(String(ipo.priceRangeMin)).toBe('70');
  }, 60000);

  it('a gap-stamped row asked earlier THIS slot is re-opened by a newer record (no slot wait, no gap-key change needed)', async () => {
    const id = await seedPlan(
      'price_range_max',
      { attempts: 1, cause: '[gap-key:eunchanged|f|xextract_filing.py@2026-10-04|p:none|o:none|d0] rank1:DOC:CHECK_FAILED:no document provenance [gap:NO_DOCUMENT_PROVENANCE]' },
      120_000
    );
    await seedReceipt('priceRangeMax', '75', 30_000);

    const claimed = await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES, gapKeys: { 'ipos.price_range_max': ['eunchanged|f|xextract_filing.py@2026-10-04|p:none|o:none|d0'] } });
    expect(claimed?.id).toBe(id);
    await planRepo.releaseClaimUnrecorded({ planRowId: claimed!.id, claimToken: claimed!.claimToken });
  }, 60000);

  it('no loop: once the walk attempted the row, the same record does not offer it again', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16 }, 3 * 86_400_000);
    await seedReceipt('priceRangeMin', '70', 60_000);
    await walk(IPO, deps() as never, budget());
    // Force the row back to the stuck shape, keeping the walk's last_attempt_at (now later than the record).
    await db.execute(sql`UPDATE ipo_field_plan SET state = 'CHECK_FAILED', attempts = 16 WHERE id = ${id}::uuid`);

    const second = await walk(IPO, deps() as never, budget());
    expect(second.fieldsAttempted).toBe(0);
    expect(second.receiptReopened).toEqual([]);
  }, 60000);

  it('fail closed: a record OLDER than the last attempt, a SUPPLIED row, and a row with no DOC rank are never re-opened', async () => {
    await seedPlan('price_range_min', { attempts: 16 }, 60_000);
    await seedReceipt('priceRangeMin', '70', 3 * 86_400_000);
    await seedPlan('price_range_max', { state: 'SUPPLIED', attempts: 1 }, 3 * 86_400_000);
    await seedReceipt('priceRangeMax', '75', 60_000);
    await seedPlan('lot_size', { rank1Source: 'NSE', attempts: 16 }, 3 * 86_400_000);
    await seedReceipt('lotSize', '200', 60_000);

    expect(await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES })).toEqual([]);
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES })).toBeNull();
  }, 60000);

  it('only a record from the document type the DOC rank reads re-opens a row; no type map re-opens nothing', async () => {
    const OTHER = '00000000-0000-4000-8000-0000001498d1';
    await db.execute(sql`
      INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, sha256)
      VALUES (${OTHER}::uuid, ${IPO}::uuid, 'PRICE_BAND_AD', 'Advert', 'https://example.invalid/ad.pdf', 'COMPLETED', ${'f'.repeat(64)})`);
    const id = await seedPlan('lot_size', { attempts: 16 }, 3 * 86_400_000);
    await seedReceipt('lotSize', '200', 60_000, OTHER);

    // lot_size reads RHP here; the advert's record is not that document type.
    expect(await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES })).toBeNull();
    expect(await planRepo.claimNextDueField({ ipoId: IPO })).toBeNull();
    const claimed = await planRepo.claimNextDueField({ ipoId: IPO, receiptDocTypes: { 'ipos.lot_size': ['PRICE_BAND_AD'] } });
    expect(claimed?.id).toBe(id);
    await planRepo.releaseClaimUnrecorded({ planRowId: claimed!.id, claimToken: claimed!.claimToken });
  }, 60000);

  it('live tier first: with budget for ONE claim, the IPO's ordinary due row is asked before the receipt re-open', async () => {
    const pendingId = await seedPlan('cin', { state: 'PENDING', attempts: 0 }, 3 * 86_400_000);
    await db.execute(sql`UPDATE ipo_field_plan SET next_due_at = NULL WHERE id = ${pendingId}::uuid`);
    const reopenId = await seedPlan('price_range_min', { attempts: 16 }, 3 * 86_400_000);
    await seedReceipt('priceRangeMin', '70', 60_000);
    let calls = 0;
    const oneClaim = { deadlineMs: 1, now: () => (calls++ === 0 ? 0 : 2) };

    const result = await walk(IPO, deps() as never, oneClaim);

    expect(result.fieldsAttempted).toBe(1);
    expect((await plan(pendingId)).lastAttemptAt).not.toBeNull();
    const reopen = await plan(reopenId);
    expect(reopen.state).toBe('CHECK_FAILED');
    expect(reopen.attempts).toBe(16);
    expect(result.receiptReopened?.[0]?.outcome).toBe('not-claimed');
  }, 60000);

  it('a dropped write on a receipt-re-opened row: the walk stamps the attempt, so the same record does not offer it again', async () => {
    const id = await seedPlan('price_range_min', { attempts: 16 }, 3 * 86_400_000);
    await seedReceipt('priceRangeMin', '71', 60_000);
    const before = (await plan(id)).lastAttemptAt;
    // A DOC answer that needs a write, and a write path that drops it (LOCK_NOT_ACQUIRED).
    const docWrites: FieldFetcher = async () => ({ outcome: 'SUPPLIED', value: 71, documentId: DOC, documentType: 'RHP' }) as never;
    const dropping = {
      consolidatedUpsertIPO: async () => ({ ipoId: '', isNew: false, locked: false, skipped: true, skipReason: 'LOCK_NOT_ACQUIRED' }),
      consolidatedUpsertChildRows: async (_i: string, _t: string, rows: unknown[]) => ({
        rowsProcessed: rows.length, rowsUpdated: 0, rowsSkipped: rows.length, conflictsDetected: 0, rows: [],
      }),
    };

    const result = await walk(IPO, { ...deps(), orchestrator: dropping, sourceFetchers: { DOC: docWrites } } as never, budget());

    expect(result.receiptReopened?.[0]?.outcome).toBe('write-dropped');
    const after = await plan(id);
    expect(after.state).toBe('PENDING');
    expect(after.lastAttemptAt!.getTime()).toBeGreaterThan(before!.getTime());
    expect(await planRepo.listReceiptNewerRows({ ipoId: IPO, receiptDocTypes: RECEIPT_DOC_TYPES })).toEqual([]);
  }, 60000);
});
