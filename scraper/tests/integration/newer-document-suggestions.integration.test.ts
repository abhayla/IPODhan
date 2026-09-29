import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, and, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import * as schema from '../../../packages/shared/src/db/schema';
import { IpoFieldPlanRepository } from '../../../packages/shared/src/repositories/ipo-field-plan-repository';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { rowKeyForName } from '../../../packages/shared/src/utils/company-name-normalizer';
import {
  acceptCorrigendumSuggestion,
  dismissCorrigendumSuggestion,
  NEWER_DOCUMENT_ORIGIN,
} from '../../../packages/shared/src/services/corrigendum-suggestions';
import { recordNewerDocumentSuggestions } from '../../src/services/newer-document-suggestions.js';
import type { FieldPlanWalkOrchestrator } from '../../src/services/field-plan-walk.js';

/**
 * §9.2 item 9 (a newer document after an admin save), item 25 (suggestions do not repeat), OD-66
 * (a new document is judged on its own fields), OD-90 (the suggestion row and its accept/dismiss).
 *
 * The admin holds `ipos.issue_size` through the REAL admin write. The REAL walk (production DOC
 * fetcher over document_field_receipts, production hold deps) then reads the field:
 *  - a document first seen BEFORE the save never raises a suggestion (the admin decided after it);
 *  - a newer document whose value equals the admin value raises none;
 *  - a newer document with a different value keeps the admin value, stores the document's value as
 *    the DOC witness, and records ONE suggestion naming that document;
 *  - after a dismiss, re-reading the same document raises nothing; a newer second document does.
 * Accept writes the document's value through writeAdminFieldValue.
 *
 * Runs only against `ipodhan_test` (refuses any other database).
 */
process.env.ENABLE_VERDICT_WRITER = 'true';

const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const IPO_ID = '00000000-0000-4000-8000-0000000009d9';
const SLUG = 'newer-document-suggestion-proof-ipo';
const ADMIN_VALUE = '1230000000';
const OLD_DOC_VALUE = '999000000';
const NEW_DOC_VALUE = '300000000';
const SECOND_DOC_VALUE = '310000000';

function openBudget() {
  return { deadlineMs: Number.MAX_SAFE_INTEGER, now: () => 0 };
}

describe.skipIf(!DATABASE_URL)('a newer document after an admin save becomes a queue suggestion (§9.2 item 9, ipodhan_test)', () => {
  let pool: Pool;
  let redis: Redis;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let planRepo: IpoFieldPlanRepository;
  let walkFieldPlanForIPO: typeof import('../../src/services/field-plan-walk.js').walkFieldPlanForIPO;
  let depsMod: typeof import('../../src/services/field-plan-walk-deps.js');

  async function cleanup() {
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
    const keys = await redis.keys(`*${IPO_ID}*`);
    if (keys.length > 0) await redis.del(...keys);
  }

  // Filing dates increase with each document, so the DOC rank's best document (OD-91 comparator,
  // a later filing of the same type supersedes) is always the newest one added.
  async function addDocument(title: string, value: string, age: 'before-save' | 'now', filingDate: string): Promise<string> {
    const created = age === 'before-save' ? sql`now() - interval '1 day'` : sql`now()`;
    const r = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, filing_date, created_at, uploaded_at)
      VALUES (${IPO_ID}::uuid, 'RHP', ${title}, ${`https://example.invalid/${encodeURIComponent(title)}.pdf`}, 'COMPLETED', ${filingDate}::date, ${created}, ${created})
      RETURNING id::text AS id`);
    const id = String((r.rows[0] as { id: string }).id);
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value)
      VALUES (${id}::uuid, 'ipos', '', 'issueSize', ${value})`);
    return id;
  }

  async function suggestions() {
    const rows = await db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
    return rows.filter((r) => (r.evidence as { origin?: string } | null)?.origin === NEWER_DOCUMENT_ORIGIN);
  }

  async function adminSave(value: string) {
    const v = await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'issueSize');
    const saved = await writeAdminFieldValue(db as never, {
      ipoId: IPO_ID,
      tableName: 'ipos',
      fieldName: 'issueSize',
      value,
      mode: { kind: 'typed', sourceNote: 'RHP page 7' },
      expectedVersion: v!.version,
      actor: { name: 'item9-test-admin', adminId: 'admin-item9-it' },
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    });
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');
  }

  function walkDeps() {
    const orchestrator = {
      consolidatedUpsertIPO: async () => {
        throw new Error('a held field must never reach the writer');
      },
      consolidatedUpsertChildRows: async () => {
        throw new Error('a held field must never reach the writer');
      },
    } as unknown as FieldPlanWalkOrchestrator;
    return {
      fieldPlanRepository: planRepo as never,
      orchestrator,
      // The REAL fetchers: DOC answers a held field from document_field_receipts.
      sourceFetchers: { DOC: depsMod.buildFieldPlanWalkFetchers(redis as never).DOC },
      ipoRepository: {
        findById: async (id: string) => (await db.select().from(schema.ipos).where(eq(schema.ipos.id, id)))[0] ?? null,
      } as never,
      resolvePolicy: (async () => ({
        ranks: ['DOC'],
        documentType: 'PRICE_BAND_AD' as const,
        origin: { kind: 'registry' as const, version: 2 },
        na: false,
      })) as never,
      ...depsMod.buildFieldPlanWalkHoldDeps(redis as never),
    };
  }

  async function issueSize(): Promise<number> {
    const [ipo] = await db.select({ v: schema.ipos.issueSize }).from(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
    return Number(ipo.v);
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const current = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    redis = new Redis(REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
    await redis.connect();
    ({ walkFieldPlanForIPO } = await import('../../src/services/field-plan-walk.js'));
    depsMod = await import('../../src/services/field-plan-walk-deps.js');
    planRepo = new IpoFieldPlanRepository(db as never, redis as never);
    await cleanup();
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    if (redis) await redis.quit();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO_ID}::uuid, 'Newer Document Suggestion Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Proof Registrar Ltd', 'Proof Sector')`);
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO_ID,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'issue_size',
      rank1Source: 'DOC',
      state: 'PENDING',
      manifestVersion: 2,
      nextDueAt: null,
    } as never);
  });

  it('keeps the admin value, stores the newer document as the witness, suggests it once, dismiss is final for that document only', async () => {
    const oldDoc = await addDocument('Item9 old RHP', OLD_DOC_VALUE, 'before-save', '2026-09-01');
    await adminSave(ADMIN_VALUE);
    const equalDoc = await addDocument('Item9 equal RHP', ADMIN_VALUE, 'now', '2026-09-20');
    const newDoc = await addDocument('Item9 newer RHP', NEW_DOC_VALUE, 'now', '2026-09-21');

    const result = await walkFieldPlanForIPO(IPO_ID, walkDeps(), openBudget());
    expect(result.fieldsSkippedProtected).toBe(1);

    // The admin value stays.
    expect(await issueSize()).toBe(Number(ADMIN_VALUE));
    const [fs] = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.fieldName, 'issueSize')));
    expect(fs.source).toBe('ADMIN');
    // The document's value is stored as the DOC witness (ENABLE_VERDICT_WRITER on).
    const witnesses = fs.witnesses as Array<{ source: string; outcome?: string; value: unknown }>;
    const docWitness = witnesses.find((w) => w.source === 'DOC');
    expect(docWitness?.outcome, JSON.stringify(witnesses)).toBe('SUPPLIED');
    expect(Number(docWitness?.value)).toBe(Number(NEW_DOC_VALUE));

    // One suggestion, naming the newer document; none for the older or the equal one.
    const first = await suggestions();
    expect(first.map((s) => s.documentId), JSON.stringify(first)).toEqual([newDoc]);
    expect(first.map((s) => s.documentId)).not.toContain(oldDoc);
    expect(first.map((s) => s.documentId)).not.toContain(equalDoc);
    const s1 = first[0];
    expect(s1.tableName).toBe('ipos');
    expect(s1.rowKey).toBe('');
    expect(s1.fieldName).toBe('issueSize');
    expect(s1.source1).toBe('ADMIN');
    expect(Number(s1.value1)).toBe(Number(ADMIN_VALUE));
    expect(Number(s1.value2)).toBe(Number(NEW_DOC_VALUE));
    expect(s1.resolvedAt).toBeNull();
    expect(s1.evidence).toMatchObject({ origin: NEWER_DOCUMENT_ORIGIN, documentTitle: 'Item9 newer RHP', documentType: 'RHP', page: null });

    // Dismiss: nothing is written.
    const dismissed = await dismissCorrigendumSuggestion(db as never, s1.id, 'item9-test-admin', 'not relevant');
    expect(dismissed.ok, JSON.stringify(dismissed)).toBe(true);
    expect(await issueSize()).toBe(Number(ADMIN_VALUE));

    // The same document read again (a stage change reopens the held read): no new suggestion.
    await db.execute(sql`UPDATE ipos SET status = 'OPEN' WHERE id = ${IPO_ID}::uuid`);
    await walkFieldPlanForIPO(IPO_ID, walkDeps(), openBudget());
    const afterReread = await suggestions();
    expect(afterReread).toHaveLength(1);
    expect(afterReread[0].resolvedAt).not.toBeNull();

    // A newer second document with its own different value raises a new one (OD-66).
    const secondDoc = await addDocument('Item9 second RHP', SECOND_DOC_VALUE, 'now', '2026-09-22');
    await walkFieldPlanForIPO(IPO_ID, walkDeps(), openBudget());
    const open = (await suggestions()).filter((s) => s.resolvedAt === null);
    expect(open.map((s) => s.documentId), JSON.stringify(open)).toEqual([secondDoc]);
    expect(Number(open[0].value2)).toBe(Number(SECOND_DOC_VALUE));
    expect(await issueSize()).toBe(Number(ADMIN_VALUE));
  }, 90000);

  it('accept writes the document value as an ADMIN value through the one admin write', async () => {
    await adminSave(ADMIN_VALUE);
    const newDoc = await addDocument('Item9 accept RHP', NEW_DOC_VALUE, 'now', '2026-09-21');
    await walkFieldPlanForIPO(IPO_ID, walkDeps(), openBudget());
    const [s] = await suggestions();
    expect(s?.documentId).toBe(newDoc);

    const version = (await readAdminFieldVersion(db as never, IPO_ID, 'ipos', 'issueSize'))!.version;
    const accepted = await acceptCorrigendumSuggestion(db as never, s.id, 'item9-test-admin', 'the RHP is right', version, 'admin-item9-it');
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    expect(await issueSize()).toBe(Number(NEW_DOC_VALUE));
    const [fs] = await db
      .select()
      .from(schema.fieldSources)
      .where(and(eq(schema.fieldSources.ipoId, IPO_ID), eq(schema.fieldSources.fieldName, 'issueSize')));
    expect(fs.source).toBe('ADMIN');
    const [row] = await db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.id, s.id));
    expect(row.resolvedAt).not.toBeNull();
    expect(row.resolutionReason).toBe('CORRIGENDUM_ACCEPTED');
  }, 90000);
});

/**
 * Core proof: `recordNewerDocumentSuggestions` (the walk's `onHeldFieldAnswers` seam, see the
 * module docstring) works on a ROW TABLE — several rows per IPO, addressed by a row key — exactly
 * as it does for `ipos`. Calls the seam function directly (it IS the newer-document suggestion
 * path; the walk only invokes it after every held-field read) against a REAL admin-held
 * `peer_companies.peRatio` value and a REAL newer-document receipt, both through the production
 * `writeAdminFieldValue` / `readAdminFieldVersion` and the real `document_field_receipts` table.
 */
describe.skipIf(!DATABASE_URL)('a newer document creates a suggestion for an admin-held field on a row table (§9.2 item 9, peer_companies, ipodhan_test)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const IPO = '00000000-0000-4000-8000-0000000009e1';
  const SLUG = 'newer-document-suggestion-row-table-proof-ipo';
  const COMPANY_NAME = 'Item9 Row Table Peer Ltd';
  const ROW_KEY = rowKeyForName(COMPANY_NAME)!;
  const ADMIN_PE = '21.50';
  const DIFFERENT_PE = '18.75';
  // The receipt's raw value is compared against normalizeReceiptValue(adminValue) verbatim (the
  // service does not re-normalize the receipt side) — peer_companies.pe_ratio is numeric(10,2), so
  // a read-back of '21.50' normalizes to '21.5'; the "equal" receipt must be written already in
  // that normalized form to prove the equality path, not a formatting mismatch.
  const EQUAL_PE = '21.5';
  const actor = { name: 'item9-row-table-test-admin', adminId: 'admin-item9-row-it' };

  async function cleanup() {
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO}::uuid`);
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${IPO}::uuid`);
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO}::uuid`);
    await db.delete(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO));
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
  }

  async function addDocument(title: string, value: string, filingDate: string): Promise<string> {
    const r = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, filing_date, created_at, uploaded_at)
      VALUES (${IPO}::uuid, 'RHP', ${title}, ${`https://example.invalid/${encodeURIComponent(title)}.pdf`}, 'COMPLETED', ${filingDate}::date, now(), now())
      RETURNING id::text AS id`);
    const id = String((r.rows[0] as { id: string }).id);
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value)
      VALUES (${id}::uuid, 'peer_companies', ${ROW_KEY}, 'peRatio', ${value})`);
    return id;
  }

  async function suggestions() {
    const rows = await db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
    return rows.filter((r) => (r.evidence as { origin?: string } | null)?.origin === NEWER_DOCUMENT_ORIGIN);
  }

  async function adminSavePeRatio(value: string) {
    const v = await readAdminFieldVersion(db as never, IPO, 'peer_companies', 'peRatio', { rowKey: ROW_KEY });
    expect(v, 'readAdminFieldVersion must resolve the peer_companies row before the admin can save it').not.toBeNull();
    const saved = await writeAdminFieldValue(db as never, {
      ipoId: IPO,
      tableName: 'peer_companies',
      fieldName: 'peRatio',
      value,
      row: { rowKey: ROW_KEY },
      mode: { kind: 'typed', sourceNote: 'RHP page 120' },
      expectedVersion: v!.version,
      actor,
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    });
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const current = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    await cleanup();
  }, 60000);

  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  }, 60000);

  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO}::uuid, 'Row Table Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Proof Registrar Ltd', 'Proof Sector')`);
    await db.insert(schema.peerCompanies).values({
      ipoId: IPO,
      companyName: COMPANY_NAME,
      normalizedName: ROW_KEY,
      isListed: true,
      peRatio: '15.00',
    } as never);
  });

  it('a newer document with a DIFFERENT value inserts exactly one suggestion naming the document; an EQUAL value inserts none', async () => {
    await adminSavePeRatio(ADMIN_PE);

    const equalDoc = await addDocument('Item9 row-table equal RHP', EQUAL_PE, '2026-09-20');
    const resultEqual = await recordNewerDocumentSuggestions(db as never, {
      ipoId: IPO,
      tableName: 'peer_companies',
      rowKey: ROW_KEY,
      fieldName: 'pe_ratio',
    });
    expect(resultEqual.newerDocuments).toBe(1);
    expect(resultEqual.equal).toBe(1);
    expect(resultEqual.inserted).toBe(0);
    expect(await suggestions()).toHaveLength(0);

    const newerDoc = await addDocument('Item9 row-table newer RHP', DIFFERENT_PE, '2026-09-21');
    const resultDifferent = await recordNewerDocumentSuggestions(db as never, {
      ipoId: IPO,
      tableName: 'peer_companies',
      rowKey: ROW_KEY,
      fieldName: 'pe_ratio',
    });
    expect(resultDifferent.newerDocuments).toBe(2); // both the equal and the different doc are newer than the save
    expect(resultDifferent.equal).toBe(1);
    expect(resultDifferent.inserted).toBe(1);

    const open = await suggestions();
    expect(open.map((s) => s.documentId), JSON.stringify(open)).toEqual([newerDoc]);
    expect(open.map((s) => s.documentId)).not.toContain(equalDoc);
    const s1 = open[0];
    expect(s1.tableName).toBe('peer_companies');
    expect(s1.rowKey).toBe(ROW_KEY);
    expect(s1.fieldName).toBe('peRatio');
    expect(s1.source1).toBe('ADMIN');
    expect(Number(s1.value1)).toBe(Number(ADMIN_PE));
    expect(Number(s1.value2)).toBe(Number(DIFFERENT_PE));
    expect(s1.resolvedAt).toBeNull();

    // A repeat run raises no duplicate for the already-suggested document (item 25).
    const resultAgain = await recordNewerDocumentSuggestions(db as never, {
      ipoId: IPO,
      tableName: 'peer_companies',
      rowKey: ROW_KEY,
      fieldName: 'pe_ratio',
    });
    expect(resultAgain.inserted).toBe(0);
    expect(resultAgain.duplicates).toBe(1);
    expect(await suggestions()).toHaveLength(1);
  }, 90000);
});
