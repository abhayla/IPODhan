import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { writeAdminListChange, readAdminList } from '../../../packages/shared/src/services/admin-list-write';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { recordNewerDocumentSuggestions } from '../../src/services/newer-document-suggestions.js';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

/**
 * F-210, class `mixed-clock-ordering` (§9.2 item 3, the one shared admin write; consumed by item 9
 * and item 27): every time an admin save stores comes from the DATABASE clock, so "was the admin edit
 * before or after this document?" is decided on one clock.
 *
 * The app clock is faked 5 minutes BEHIND and then 5 minutes AHEAD of the database (only `Date` is
 * faked; timers and sockets stay real). Documents are stamped by the database (`now()`), exactly as
 * production's `documents.created_at` default does.
 *  - item 9: a document first seen BEFORE the save is never suggested; one first seen AFTER it is;
 *  - every stamp of the save (field_sources.updated_at, field_protection_metadata.manually_edited_at /
 *    updated_at, audit_logs.timestamp) lies between the database's now() read just before and just
 *    after the save, never at the faked app time.
 *
 * Runs only against `ipodhan_test` (refuses any other database).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-00000000c10c';
const SLUG = 'admin-write-database-clock-proof-ipo';
const SKEW_MS = 5 * 60_000;

function utc(text: unknown): number {
  return Date.parse(`${String(text).replace(' ', 'T')}Z`);
}

describe.skipIf(!DATABASE_URL)('admin writes stamp from the database clock (F-210, ipodhan_test)', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  async function cleanup() {
    await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
    await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
    await db.execute(sql`DELETE FROM documents WHERE ipo_id = ${IPO_ID}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO_ID}::uuid`);
  }

  async function dbNowMs(): Promise<number> {
    const r = await db.execute(sql`SELECT (now() AT TIME ZONE 'UTC')::text AS t`);
    return utc((r.rows[0] as { t: string }).t);
  }

  async function addDocument(title: string, value: string): Promise<string> {
    const r = await db.execute(sql`
      INSERT INTO documents (ipo_id, type, title, url, extraction_status, filing_date)
      VALUES (${IPO_ID}::uuid, 'RHP', ${title}, ${`https://example.invalid/${encodeURIComponent(title)}.pdf`}, 'COMPLETED', '2026-09-01'::date)
      RETURNING id::text AS id`);
    const id = String((r.rows[0] as { id: string }).id);
    await db.execute(sql`
      INSERT INTO document_field_receipts (document_id, table_name, row_key, field_name, value)
      VALUES (${id}::uuid, 'ipos', '', 'issueSize', ${value})`);
    return id;
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
      actor: { name: 'dbclock-test-admin', adminId: 'admin-dbclock-it' },
      entryPoint: 'test',
      overrideReason: 'proof fixture',
    });
    expect(saved.kind, JSON.stringify(saved)).toBe('OK');
  }

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const current = (await pool.query('select current_database()')).rows[0].current_database as string;
    if (current !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${current}', not 'ipodhan_test'.`);
    db = drizzle(pool, { schema });
    await cleanup();
  }, 60000);

  afterAll(async () => {
    vi.useRealTimers();
    if (db) await cleanup();
    await pool?.end();
  }, 60000);

  beforeEach(async () => {
    vi.useRealTimers();
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO_ID}::uuid, 'Admin Write Database Clock Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Proof Registrar Ltd', 'Proof Sector')`);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const [label, offset] of [
    ['app clock 5 min BEHIND the database', -SKEW_MS],
    ['app clock 5 min AHEAD of the database', SKEW_MS],
  ] as const) {
    it(`item 9 orders documents against the save on one clock (${label})`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(Date.now() + offset));

      const beforeDoc = await addDocument('Clock proof RHP before save', '999000000');
      await pause(30);
      const beforeSave = await dbNowMs();
      await adminSave('1230000000');
      const afterSave = await dbNowMs();
      await pause(30);
      const afterDoc = await addDocument('Clock proof RHP after save', '300000000');

      // (1) item 9: only the document first seen AFTER the save is suggested.
      const result = await recordNewerDocumentSuggestions(db as never, { ipoId: IPO_ID, tableName: 'ipos', rowKey: '', fieldName: 'issueSize' });
      const rows = await db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
      const suggested = rows.map((r) => r.documentId);
      expect(suggested, `before=${beforeDoc} after=${afterDoc} result=${JSON.stringify(result)}`).toEqual([afterDoc]);

      // (2) every stamp of the save is the database's now(), not the faked app time.
      const stamps = await db.execute(sql`
        SELECT (SELECT updated_at::text FROM field_sources
                 WHERE ipo_id = ${IPO_ID}::uuid AND table_name = 'ipos' AND field_name = 'issueSize' AND source = 'ADMIN') AS fs_updated,
               (SELECT created_at::text FROM field_sources
                 WHERE ipo_id = ${IPO_ID}::uuid AND table_name = 'ipos' AND field_name = 'issueSize' AND source = 'ADMIN') AS fs_created,
               (SELECT manually_edited_at::text FROM field_protection_metadata
                 WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'issueSize') AS hold_edited,
               (SELECT updated_at::text FROM field_protection_metadata
                 WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'issueSize') AS hold_updated,
               (SELECT max(timestamp)::text FROM audit_logs WHERE ipo_id = ${IPO_ID}::uuid) AS audit_at`);
      const s = stamps.rows[0] as Record<string, string>;
      for (const [name, text] of Object.entries(s)) {
        const at = utc(text);
        expect(at, `${name}=${text} must be >= db now before the save (${new Date(beforeSave).toISOString()})`).toBeGreaterThanOrEqual(beforeSave - 1);
        expect(at, `${name}=${text} must be <= db now after the save (${new Date(afterSave).toISOString()})`).toBeLessThanOrEqual(afterSave);
      }
      // One save, one instant: every stamp identical.
      expect(new Set(Object.values(s)).size, JSON.stringify(s)).toBe(1);
    }, 60000);
  }

  it('a source write stamps field_sources.updated_at from the database clock on INSERT, as its UPDATE already did', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() - SKEW_MS));
    const repo = new FieldSourcesRepository(db as never, noRedis);
    const beforeInsert = await dbNowMs();
    await repo.trackFieldUpdate({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source: 'NSE', updatedBy: 'dbclock-test' } as never);
    const afterInsert = await dbNowMs();
    const read = async () =>
      utc(((await db.execute(sql`SELECT updated_at::text AS t FROM field_sources WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'registrar'`)).rows[0] as { t: string }).t);
    const inserted = await read();
    expect(inserted, 'INSERT stamp').toBeGreaterThanOrEqual(beforeInsert - 1);
    expect(inserted, 'INSERT stamp').toBeLessThanOrEqual(afterInsert);
    await pause(30);
    await repo.trackFieldUpdate({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source: 'BSE', updatedBy: 'dbclock-test' } as never);
    // The column never runs backwards across its two write shapes (one clock).
    expect(await read(), 'UPDATE stamp after INSERT stamp').toBeGreaterThan(inserted);
  }, 60000);

  it('an admin list save stamps its hold and provenance from the database clock', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() - SKEW_MS));
    const current = await readAdminList(db as never, IPO_ID, 'lead_managers');
    const beforeSave = await dbNowMs();
    const saved = await writeAdminListChange(db as never, {
      ipoId: IPO_ID,
      list: 'lead_managers',
      op: { kind: 'add', row: { name: 'Clock Proof Capital Ltd' } },
      expectedVersion: current!.version,
      actor: { name: 'dbclock-test-admin', adminId: 'admin-dbclock-it' },
      entryPoint: 'test',
    } as never);
    const afterSave = await dbNowMs();
    expect((saved as { kind: string }).kind, JSON.stringify(saved)).toBe('OK');
    const r = await db.execute(sql`
      SELECT (SELECT manually_edited_at::text FROM field_protection_metadata WHERE ipo_id = ${IPO_ID}::uuid LIMIT 1) AS hold_edited,
             (SELECT updated_at::text FROM field_sources WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'leadManagers') AS fs_updated`);
    for (const [name, text] of Object.entries(r.rows[0] as Record<string, string>)) {
      const at = utc(text);
      expect(at, `${name}=${text}`).toBeGreaterThanOrEqual(beforeSave - 1);
      expect(at, `${name}=${text}`).toBeLessThanOrEqual(afterSave);
    }
  }, 60000);

  it('a conflict detected and resolved while the app clock is 5 min behind is stamped by the database (detected_at, resolved_at)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() - SKEW_MS));
    const repo = new DataConflictsRepository(db as never, noRedis);
    const read = async (col: 'detected_at' | 'resolved_at') =>
      utc(((await db.execute(sql`SELECT ${sql.raw(col)}::text AS t FROM data_conflicts WHERE ipo_id = ${IPO_ID}::uuid AND field_name = 'registrar'`)).rows[0] as { t: string }).t);

    const beforeLog = await dbNowMs();
    const logged = await repo.logConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source1: 'NSE', value1: 'A Ltd', source2: 'BSE', value2: 'B Ltd' });
    const afterLog = await dbNowMs();
    const detected = await read('detected_at');
    expect(detected, 'detected_at').toBeGreaterThanOrEqual(beforeLog - 1);
    expect(detected, 'detected_at').toBeLessThanOrEqual(afterLog);

    await pause(30);
    const beforeResolve = await dbNowMs();
    await repo.resolveConflict((logged as { id: string }).id, { resolvedSource: 'NSE', resolutionReason: 'proof', resolvedBy: 'dbclock-test-admin' });
    const afterResolve = await dbNowMs();
    const resolved = await read('resolved_at');
    expect(resolved, 'resolved_at').toBeGreaterThanOrEqual(beforeResolve - 1);
    expect(resolved, 'resolved_at').toBeLessThanOrEqual(afterResolve);
    expect(resolved, 'resolved after detected on one clock').toBeGreaterThan(detected);
  }, 60000);
});
