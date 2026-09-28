import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { PeerCompanyRepository } from '../../src/repositories/peer-company-repository';
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
  await db.delete(schema.peerCompanies).where(inArray(schema.peerCompanies.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

const base = (over: Partial<AdminFieldWriteInput> = {}): AdminFieldWriteInput => ({
  ipoId: IPO,
  tableName: 'ipos',
  fieldName: 'registrar',
  value: 'Admin Registrar Pvt Ltd',
  mode: { kind: 'typed', sourceNote: 'RHP page 12' },
  expectedVersion: '',
  actor: { name: 'a2-test-admin', adminId: 'admin-it' },
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
    const a = await writeAdminFieldValue(db as never, base({ value: 'Other Admin Value', expectedVersion: opened!.version, actor: { name: 'other-admin', adminId: 'admin-it' } }));
    expect(a.kind).toBe('OK');
    const back = await writeAdminFieldValue(db as never, base({ value: 'Scraper Registrar Ltd', expectedVersion: (a as { version: string }).version, actor: { name: 'other-admin', adminId: 'admin-it' } }));
    expect(back.kind).toBe('OK');
    expect(await registrar()).toBe('Scraper Registrar Ltd'); // same value as when "opened"
    const stale = await writeAdminFieldValue(db as never, base({ expectedVersion: opened!.version }));
    expect(stale).toMatchObject({ kind: 'CONFLICT', currentValue: 'Scraper Registrar Ltd', setBy: 'other-admin' });
    expect(await registrar()).toBe('Scraper Registrar Ltd');
  });

  it('F-169: a child-table field (ipo_details) is written with provenance, protection and audit', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipo_details', 'designatedExchange');
    const r = await writeAdminFieldValue(db as never, base({ tableName: 'ipo_details', fieldName: 'designatedExchange', value: 'NSE', mode: { kind: 'storedPick', sourceLabel: 'NSE', readDate: '2026-09-28', value: 'NSE' }, expectedVersion: v!.version }));
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

  it('item 12 / OD-108: a typed value runs the SAME check the scraper runs (validateIPOData); refused unless a reason is written', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'lotSize');
    const refused = await writeAdminFieldValue(db as never, base({ fieldName: 'lotSize', value: 1, expectedVersion: v!.version }));
    expect(refused.kind).toBe('INVALID');
    expect((refused as { reason: string }).reason).toMatch(/lot_size = 1 is NEVER valid/);
    expect(await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO))).toHaveLength(0);

    const kept = await writeAdminFieldValue(db as never, base({ fieldName: 'lotSize', value: 1, overrideReason: 'RHP p.4 really says 1', expectedVersion: v!.version }));
    expect(kept.kind).toBe('OK');
    const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    expect(audit.details).toMatchObject({ overrideReason: 'RHP p.4 really says 1', checkFailure: expect.stringMatching(/NEVER valid/) });
  });

  const seedPeer = async () =>
    (await db.insert(schema.peerCompanies).values({ ipoId: IPO, companyName: 'Acme Ltd', normalizedName: 'acme', isListed: true, peRatio: '10.00', dataSource: 'DRHP' }).returning())[0];
  const peerRow = async (key: string) =>
    (await db.select().from(schema.peerCompanies).where(and(eq(schema.peerCompanies.ipoId, IPO), eq(schema.peerCompanies.normalizedName, key))))[0];

  it('OD-104: the admin id is stored with the write (audit details and provenance lineage)', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    expect((await writeAdminFieldValue(db as never, base({ expectedVersion: v!.version }))).kind).toBe('OK');
    const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    expect(audit.details).toMatchObject({ adminId: 'admin-it', by: 'a2-test-admin' });
    const [prov] = await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO), eq(schema.fieldSources.fieldName, 'registrar')));
    expect(prov.dataLineage).toMatchObject({ adminId: 'admin-it' });
    const noId = await writeAdminFieldValue(db as never, base({ expectedVersion: 'x', actor: { name: 'a2-test-admin', adminId: '' } }));
    expect(noId.kind).toBe('INVALID');
  });

  it('row key: a peer_companies field is saved under the row key (provenance, hold, audit, version)', async () => {
    const peer = await seedPeer();
    const v = await readAdminFieldVersion(db as never, IPO, 'peer_companies', 'peRatio', { recordId: peer.id });
    expect(v).toMatchObject({ rowKey: 'acme', currentValue: '10.00' });
    const r = await writeAdminFieldValue(db as never, base({ tableName: 'peer_companies', row: { recordId: peer.id }, fieldName: 'peRatio', value: '22.5', expectedVersion: v!.version }));
    expect(r).toMatchObject({ kind: 'OK', rowKey: 'acme' });
    expect((await peerRow('acme')).peRatio).toBe('22.50');
    const [prov] = await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO), eq(schema.fieldSources.tableName, 'peer_companies')));
    expect(prov).toMatchObject({ rowKey: 'acme', fieldName: 'peRatio', source: 'ADMIN' });
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot).toMatchObject({ tableName: 'peer_companies:acme', fieldName: 'peRatio', isProtected: true });
    // a stale token for the ROW is refused (the version is per row, not per table)
    const stale = await writeAdminFieldValue(db as never, base({ tableName: 'peer_companies', row: { rowKey: 'acme' }, fieldName: 'peRatio', value: '1', expectedVersion: v!.version }));
    expect(stale.kind).toBe('CONFLICT');
  });

  it('row key: a company_name rename re-derives the row key and moves the row\'s provenance and holds', async () => {
    const peer = await seedPeer();
    const v1 = await readAdminFieldVersion(db as never, IPO, 'peer_companies', 'peRatio', { recordId: peer.id });
    await writeAdminFieldValue(db as never, base({ tableName: 'peer_companies', row: { recordId: peer.id }, fieldName: 'peRatio', value: '22.5', expectedVersion: v1!.version }));
    const v2 = await readAdminFieldVersion(db as never, IPO, 'peer_companies', 'companyName', { recordId: peer.id });
    const r = await writeAdminFieldValue(db as never, base({ tableName: 'peer_companies', row: { recordId: peer.id }, fieldName: 'companyName', value: 'Beta Industries Ltd', expectedVersion: v2!.version }));
    expect(r.kind).toBe('OK');
    const newKey = (r as { rowKey: string }).rowKey;
    expect(newKey).not.toBe('acme');
    const holds = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(holds.map((h) => `${h.tableName}.${h.fieldName}`).sort()).toEqual([`peer_companies:${newKey}.companyName`, `peer_companies:${newKey}.peRatio`]);
  });

  // MEASURED GAP (2026-09-28, round 3): the scraper peer writer deletes and re-inserts the list and
  // reads no hold, so it overwrites the admin row value ('99.00' read back, not '22.50'). Fixing the
  // WRITER is item 19 (another builder); this case is expected to fail until then, and turns red —
  // telling that builder to make it a plain it() — the moment replaceForIpo honours
  // protectionTableName('peer_companies', rowKey).
  it('CORE row key (item 19): the admin peer value survives the scraper peer writer (PeerCompanyRepository.replaceForIpo)', async () => {
    const peer = await seedPeer();
    const v = await readAdminFieldVersion(db as never, IPO, 'peer_companies', 'peRatio', { recordId: peer.id });
    await writeAdminFieldValue(db as never, base({ tableName: 'peer_companies', row: { recordId: peer.id }, fieldName: 'peRatio', value: '22.5', expectedVersion: v!.version }));
    // The document path's call (filing-persister): nullNeverOverwrites merge of a new peer table.
    await new PeerCompanyRepository(db as never).replaceForIpo(
      IPO,
      [{ ipoId: IPO, companyName: 'Acme Ltd', normalizedName: 'acme', isListed: true, peRatio: '99.00', dataSource: 'DRHP' } as never],
      { nullNeverOverwrites: true }
    );
    expect((await peerRow('acme')).peRatio).toBe('22.50');
  });

  it('OD-121: holdShown holds the shown value as a PICK from its source; a field showing nothing is refused', async () => {
    await db.insert(schema.fieldSources).values({ ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName: 'registrar', source: 'NSE', confidence: 90 } as never);
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    const r = await writeAdminFieldValue(db as never, base({ value: undefined, mode: { kind: 'holdShown' }, expectedVersion: v!.version }));
    expect(r).toMatchObject({ kind: 'OK', newValue: 'Scraper Registrar Ltd' });
    expect(await registrar()).toBe('Scraper Registrar Ltd');
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot.editNote).toMatch(/^Picked from NSE/);
    const vs = await readAdminFieldVersion(db as never, IPO, 'ipos', 'sector');
    const empty = await writeAdminFieldValue(db as never, base({ fieldName: 'sector', mode: { kind: 'holdShown' }, expectedVersion: vs!.version }));
    expect(empty.kind).toBe('INVALID');
    expect(await db.select().from(schema.fieldProtectionMetadata).where(and(eq(schema.fieldProtectionMetadata.ipoId, IPO), eq(schema.fieldProtectionMetadata.fieldName, 'sector')))).toHaveLength(0);
  });

  const seedRegistrarWitnesses = () =>
    db.insert(schema.fieldSources).values({
      ipoId: IPO,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'registrar',
      source: 'CHITTORGARH',
      confidence: 80,
      witnesses: [
        { source: 'CHITTORGARH', value: 'Scraper Registrar Ltd', at: '2026-09-21T04:00:00.000Z', outcome: 'SUPPLIED' },
        { source: 'NSE', value: 'NSE Registrar Ltd', at: '2026-09-20T10:00:00.000Z', outcome: 'SUPPLIED' },
        { source: 'BSE', value: null, at: '2026-09-20T10:05:00.000Z', outcome: 'NOT_PRINTED', cause: 'not printed' },
      ],
    } as never);
  const rowsWritten = async () => ({
    audit: (await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO))).length,
    holds: (await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO))).length,
    adminProv: (await db.select().from(schema.fieldSources).where(and(eq(schema.fieldSources.ipoId, IPO), eq(schema.fieldSources.source, 'ADMIN')))).length,
  });

  it('M1 / OD-109: a pick stores the source STORED answer and read date; a forged client value is ignored', async () => {
    await seedRegistrarWitnesses();
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    const r = await writeAdminFieldValue(db as never, base({ value: 'FORGED 1', mode: { kind: 'pick', sourceLabel: 'NSE' }, expectedVersion: v!.version }));
    expect(r).toMatchObject({ kind: 'OK', newValue: 'NSE Registrar Ltd' });
    expect(await registrar()).toBe('NSE Registrar Ltd');
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot.editNote).toBe('Picked from NSE, read 2026-09-20T10:00:00.000Z');
    const [audit] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.ipoId, IPO));
    expect(audit.details).toMatchObject({ mode: 'pick', sourceLabel: 'NSE', readDate: '2026-09-20T10:00:00.000Z' });
  });

  it('M1: a pick of a source with no stored answer (abstained or absent) is refused and writes nothing', async () => {
    await seedRegistrarWitnesses();
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    for (const label of ['BSE', 'MONEYCONTROL']) {
      const r = await writeAdminFieldValue(db as never, base({ value: 1, mode: { kind: 'pick', sourceLabel: label }, expectedVersion: v!.version }));
      expect(r.kind).toBe('INVALID');
      expect((r as { reason: string }).reason).toMatch(/has no stored answer/);
    }
    expect(await registrar()).toBe('Scraper Registrar Ltd');
    expect(await rowsWritten()).toEqual({ audit: 0, holds: 0, adminProv: 0 });
  });

  it('M1 / OD-137: a field with no stored value is picked from the plan row answers', async () => {
    await db.insert(schema.ipoFieldPlan).values({
      ipoId: IPO,
      tableName: 'ipos',
      rowKey: '',
      fieldName: 'sector',
      manifestVersion: 1,
      answers: [{ source: 'BSE', value: 'Financial Services', at: '2026-09-22T06:30:00.000Z', outcome: 'SUPPLIED' }],
    } as never);
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'sector');
    const r = await writeAdminFieldValue(db as never, base({ fieldName: 'sector', value: 'FORGED', mode: { kind: 'pick', sourceLabel: 'bse' }, expectedVersion: v!.version }));
    expect(r).toMatchObject({ kind: 'OK', newValue: 'Financial Services' });
    const [prot] = await db.select().from(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
    expect(prot.editNote).toBe('Picked from bse, read 2026-09-22T06:30:00.000Z');
  });

  it('m4: a scraper rewrite of a child row that records no provenance still changes the token', async () => {
    await db.insert(schema.ipoDetails).values({ ipoId: IPO, designatedExchange: 'BSE', dataSource: 'NSE' } as never);
    const opened = await readAdminFieldVersion(db as never, IPO, 'ipo_details', 'designatedExchange');
    await db.execute(sql`UPDATE ipo_details SET designated_exchange = 'NSE', updated_at = updated_at + interval '1 second' WHERE ipo_id = ${IPO}::uuid`);
    const later = await readAdminFieldVersion(db as never, IPO, 'ipo_details', 'designatedExchange');
    expect(later!.version).not.toBe(opened!.version);
    const r = await writeAdminFieldValue(db as never, base({ tableName: 'ipo_details', fieldName: 'designatedExchange', value: 'BSE', expectedVersion: opened!.version }));
    expect(r).toMatchObject({ kind: 'CONFLICT', currentValue: 'NSE' });
  });

  it('m10: a value that passes coercion but Postgres refuses (int4 overflow) maps to INVALID via the SQLSTATE and writes nothing', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'lotSize');
    const r = await writeAdminFieldValue(db as never, base({ fieldName: 'lotSize', value: 3000000000, overrideReason: 'test overflow', expectedVersion: v!.version }));
    expect(r.kind).toBe('INVALID');
    expect((r as { reason: string }).reason).toMatch(/the database refused the value \(22003\)/);
    expect(await rowsWritten()).toEqual({ audit: 0, holds: 0, adminProv: 0 });
  });

  it('m10: a failure AFTER the value write rolls the whole transaction back (value, provenance, hold, audit)', async () => {
    const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'registrar');
    // jsonb refuses a NUL escape (22P05) at the provenance insert, which runs after the value update.
    const r = await writeAdminFieldValue(db as never, base({ value: 'Rolled Back Registrar', detail: { note: 'bad\u0000byte' }, expectedVersion: v!.version }));
    expect(r.kind).toBe('INVALID');
    expect((r as { reason: string }).reason).toMatch(/the database refused the value \(22/);
    expect(await registrar()).toBe('Scraper Registrar Ltd');
    expect(await rowsWritten()).toEqual({ audit: 0, holds: 0, adminProv: 0 });
  });
});
