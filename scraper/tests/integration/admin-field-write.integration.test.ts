import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import {
  writeAdminFieldValue,
  readAdminFieldVersion,
  type AdminFieldWriteInput,
} from '@ipodhan/shared/services/admin-field-write';

/**
 * Contract 2 item A2 core proof (spec §9.2 items 3, 11, 19, 20; §2.7):
 *   an admin save outranks every scraper and survives the next cycle.
 * Runs against ipodhan_test through the tunnel:
 *   DATABASE_URL=postgresql://ipodhan_app:$PW@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-field-write.integration.test.ts
 * The scraper write used here is `IPORepository.update(id, patch, { honourProtection })` — the exact
 * call `DataConsolidationOrchestrator.consolidatedUpsertIPO` makes for an existing IPO.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000a2a01';
const SLUG = 'a2-admin-write-proof-ipo';
const noRedis = { get: async () => null, set: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;

let pool: Pool;
let pool2: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.delete(schema.ipoDetails).where(inArray(schema.ipoDetails.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

const base = (over: Partial<AdminFieldWriteInput> = {}): AdminFieldWriteInput => ({
  ipoId: IPO,
  tableName: 'ipos',
  fieldName: 'registrar',
  value: 'Admin Registrar Pvt Ltd',
  mode: { kind: 'typed', sourceNote: 'RHP page 12' },
  expectedVersion: '',
  actor: { name: 'a2-test-admin', adminId: null },
  entryPoint: 'test',
  ...over,
});

const registrar = async () =>
  (await db.select({ v: schema.ipos.registrar }).from(schema.ipos).where(eq(schema.ipos.id, IPO)))[0]?.v;

describe.skipIf(!DATABASE_URL)('A2 admin field write (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    pool2 = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    await cleanup();
  });
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    await pool2?.end();
  });
  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar)
      VALUES (${IPO}::uuid, 'A2 Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Scraper Registrar Ltd')`);
  });

  it('CORE: an admin save outranks a later scraper write with a different value and is read back', async () => {
    const v0 = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    const saved = await writeAdminFieldValue(db as never, base({ expectedVersion: v0!.version }));
    expect(saved.kind).toBe('OK');

    const scraperRepo = new IPORepository(db as never, noRedis);
    await scraperRepo.update(IPO, { registrar: 'Different Scraper Registrar', sector: 'Scraped Sector' }, { honourProtection: { source: 'NSE' } });

    expect(await registrar()).toBe('Admin Registrar Pvt Ltd');
    // the unprotected field in the same scraper patch still lands
    const [row] = await db.select({ sector: schema.ipos.sector }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row.sector).toBe('Scraped Sector');

    const [prov] = await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO), eq(schema.fieldSources.fieldName, 'registrar')));
    expect(prov).toMatchObject({ source: 'ADMIN', tableName: 'ipos', rowKey: '', updatedBy: 'a2-test-admin' });
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot).toMatchObject({ tableName: 'ipos', fieldName: 'registrar', isProtected: true, manuallyEditedBy: 'a2-test-admin', editNote: 'Typed: RHP page 12' });
    const audits = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ adminUser: 'a2-test-admin', tableName: 'ipos', fieldName: 'registrar', oldValue: 'Scraper Registrar Ltd', newValue: 'Admin Registrar Pvt Ltd', success: true });
  });

  it('item 19: an admin save committed while the scraper waits is NOT overwritten by that scraper write', async () => {
    // Admin transaction on connection 1: lock + value + protection, held open.
    const c1 = await pool.connect();
    await c1.query('BEGIN');
    await c1.query(`SELECT 1 FROM ipos WHERE id = $1 FOR NO KEY UPDATE`, [IPO]);
    await c1.query(`UPDATE ipos SET registrar = 'Held Admin Value' WHERE id = $1`, [IPO]);
    await c1.query(
      `INSERT INTO field_protection_metadata (table_name, field_name, ipo_id, is_protected) VALUES ('ipos','registrar',$1,true)`,
      [IPO]
    );
    // Scraper on connection 2 starts while the admin transaction is open. Its orchestrator-level
    // protection read (outside any transaction) would have seen "not protected" at this moment.
    const scraperRepo = new IPORepository(drizzle(pool2, { schema }) as never, noRedis);
    let scraperDone = false;
    const scraper = scraperRepo
      .update(IPO, { registrar: 'Scraper Overwrite' }, { honourProtection: { source: 'NSE' } })
      .then(() => { scraperDone = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(scraperDone).toBe(false); // it is waiting on the admin's row lock, not skipping
    await c1.query('COMMIT');
    c1.release();
    await scraper;
    expect(await registrar()).toBe('Held Admin Value');
  });

  it('item 20: a save with a stale version is refused with CONFLICT naming the newer value and setter, even after change-and-back', async () => {
    const opened = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    const a = await writeAdminFieldValue(db as never, base({ value: 'Other Admin Value', expectedVersion: opened!.version, actor: { name: 'other-admin', adminId: null } }));
    expect(a.kind).toBe('OK');
    const back = await writeAdminFieldValue(db as never, base({ value: 'Scraper Registrar Ltd', expectedVersion: (a as { version: string }).version, actor: { name: 'other-admin', adminId: null } }));
    expect(back.kind).toBe('OK');
    expect(await registrar()).toBe('Scraper Registrar Ltd'); // same value as when "opened"
    const stale = await writeAdminFieldValue(db as never, base({ expectedVersion: opened!.version }));
    expect(stale).toMatchObject({ kind: 'CONFLICT', currentValue: 'Scraper Registrar Ltd', setBy: 'other-admin' });
    expect(await registrar()).toBe('Scraper Registrar Ltd');
  });

  it('F-169: a child-table field (ipo_details) is written with provenance, protection and audit', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipo_details', 'designatedExchange');
    const r = await writeAdminFieldValue(db as never, base({ tableName: 'ipo_details', fieldName: 'designatedExchange', value: 'NSE', mode: { kind: 'pick', sourceLabel: 'NSE', readDate: '2026-09-28' }, expectedVersion: v!.version }));
    expect(r.kind).toBe('OK');
    const [d] = await db.select({ v: schema.ipoDetails.designatedExchange }).from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, IPO));
    expect(d.v).toBe('NSE');
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot).toMatchObject({ tableName: 'ipo_details', fieldName: 'designatedExchange', isProtected: true, editNote: 'Picked from NSE, read 2026-09-28' });
  });

  it('#1159: a value the column refuses returns INVALID and writes nothing', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'lotSize');
    const r = await writeAdminFieldValue(db as never, base({ fieldName: 'lotSize', value: 'twelve', expectedVersion: v!.version }));
    expect(r.kind).toBe('INVALID');
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO))).toHaveLength(0);
    expect(await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO))).toHaveLength(0);
  });
});
