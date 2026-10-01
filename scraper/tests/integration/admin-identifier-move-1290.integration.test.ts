import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, resolveIpoRow, type SourceKeyRef } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';

/**
 * #1290 item 1, spec §9.2 item 26 (clarified 2026-10-01): an admin removes identifier X from row A
 * because X belongs to row B. A keeps X as an admin-removed alias (a SUPERSEDED source key, or an
 * `ipo_identifier_aliases` row). When the admin then types X into B's editor, X MOVES to B: A's
 * admin-removed copy is closed, X binds to B, and an audit row on A records the move. X held by
 * another row in any other way (ACTIVE key, live column, OD-83 supersede) is refused, naming that row.
 *
 * Every identifier type item 26 covers: BSE IPO number (source record number), NSE symbol (its
 * SYMBOL|SERIES source record numbers + the symbol alias), CIN, ISIN.
 *
 * Runs against ipodhan_test through the tunnel (from scraper/, `.env.test` supplies DATABASE_URL):
 *   npx vitest run -c vitest.integration.config.ts tests/integration/admin-identifier-move-1290.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const A = '00000000-0000-4000-8129-00000000000a';
const B = '00000000-0000-4000-8129-00000000000b';
const C = '00000000-0000-4000-8129-00000000000c';
const IDS = [A, B, C];
const B_NAME = 'Move1290 Owner Row Limited';
const CIN_X = 'U99999MH2020PLC129001';
const ISIN_X = 'INE129A01011';
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []],
} as never;

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repo: IPORepository;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, IDS));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, IDS));
  await db.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, IDS));
  await db.delete(schema.ipoIdentifierAliases).where(inArray(schema.ipoIdentifierAliases.ipoId, IDS));
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid, ${C}::uuid)`);
}

async function adminSet(ipoId: string, fieldName: string, value: unknown) {
  const v = await readAdminFieldVersion(db as never, ipoId, 'ipos', fieldName);
  return writeAdminFieldValue(db as never, {
    ipoId, tableName: 'ipos', fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP cover page' }, expectedVersion: v!.version,
    actor: { name: 'move1290-admin', adminId: 'admin-move1290' }, entryPoint: 'test',
  });
}

function bRecord(over: { symbol?: string; cin?: string; isin?: string; sourceKeys?: SourceKeyRef[] }) {
  return resolveIpoRow(repo, {
    companyName: B_NAME,
    normalizedName: normalizeCompanyNameForMatching(B_NAME),
    slug: generateIPOSlug(B_NAME),
    symbol: over.symbol ?? null,
    isin: over.isin ?? null,
    cin: over.cin ?? null,
    openDate: '2026-10-05',
    priceRangeMin: null,
    priceRangeMax: null,
    segment: 'MAINBOARD',
    offeringType: 'IPO',
    sourceKeys: over.sourceKeys ?? [],
  } as never);
}

const keysOf = (ipoId: string) => db.select().from(schema.ipoSourceKeys).where(eq(schema.ipoSourceKeys.ipoId, ipoId));
const aliasesOf = (ipoId: string) => db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, ipoId));
const movedAudit = (ipoId: string) =>
  db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.ipoId, ipoId), eq(schema.auditLogs.actionType, 'ADMIN_IDENTIFIER_MOVED')));
const heldAudit = (ipoId: string) =>
  db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.ipoId, ipoId), eq(schema.auditLogs.actionType, 'IDENTITY_HELD_FOR_REVIEW')));

describe.skipIf(!DATABASE_URL)('#1290: an identifier an admin removed from A moves to B when typed into B (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    repo = new IPORepository(db as never, noRedis);
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  }, 60_000);
  beforeEach(async () => {
    await cleanup();
    // A carried every identifier X (wrongly); B is the real owner and carries none; C is a third row.
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, price_range_min, symbol, cin, isin, bse_ipo_no)
      VALUES (${A}::uuid, 'Move1290 Wrong Row Limited', 'move1290-wrong-row-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD',
              '2026-10-02', 100, 'M1290X', ${CIN_X}, ${ISIN_X}, 91290),
             (${B}::uuid, ${B_NAME}, 'move1290-owner-row-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD',
              '2026-10-05', 200, 'M1290B', NULL, NULL, NULL),
             (${C}::uuid, 'Move1290 Third Row Limited', 'move1290-third-row-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD',
              '2026-10-06', 300, 'M1290C', NULL, NULL, 91291)`);
    await db.insert(schema.ipoSourceKeys).values([
      { ipoId: A, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91290', bindingValue: '91290', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test' },
      { ipoId: A, source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'M1290X|EQ', bindingValue: 'M1290X|EQ', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test' },
      { ipoId: B, source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'M1290B|EQ', bindingValue: 'M1290B|EQ', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test' },
      { ipoId: C, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91291', bindingValue: '91291', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test' },
    ]);
  }, 60_000);

  it('CORE bseIpoNo: removed from A, typed into B -> A key RELEASED, B key ACTIVE, audit on A, B record binds B (not held)', async () => {
    expect((await adminSet(A, 'bseIpoNo', null)).kind).toBe('OK');
    const aKeyBefore = (await keysOf(A)).find((k) => k.keyValue === '91290')!;
    expect(aKeyBefore.state).toBe('SUPERSEDED');
    // Before the move, B's BSE record is held every cycle (the #1290 scenario).
    await bRecord({ sourceKeys: [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91290' }] }).catch(() => null);
    expect((await heldAudit(A)).length + (await heldAudit(B)).length).toBeGreaterThan(0);

    const res = await adminSet(B, 'bseIpoNo', 91290);
    expect(res).toMatchObject({ kind: 'OK' });
    const aKey = (await keysOf(A)).find((k) => k.id === aKeyBefore.id)!;
    expect(aKey.state).toBe('RELEASED');
    expect(aKey.bindingValue).toBeNull();
    expect(aKey.stateReason).toContain('moved to move1290-owner-row-limited');
    expect((await keysOf(B)).filter((k) => k.keyType === 'BSE_IPO_NO')).toEqual([
      expect.objectContaining({ keyValue: '91290', state: 'ACTIVE', boundVia: 'ADMIN_EDIT' }),
    ]);
    const audit = await movedAudit(A);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fieldName: 'bseIpoNo', oldValue: '91290', adminUser: 'move1290-admin', success: true });
    expect(audit[0].details).toMatchObject({ movedToIpoId: B, releasedKeyIds: [aKeyBefore.id] });

    const bound = await bRecord({ sourceKeys: [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91290' }] });
    expect(bound?.id).toBe(B);
  });

  it('bseIpoNo held ACTIVE by another row C -> refused naming C; C key untouched; nothing moved', async () => {
    // only the KEY holds it (no live column), so this proves the key check, not the column check
    await db.execute(sql`UPDATE ipos SET bse_ipo_no = NULL WHERE id = ${C}::uuid`);
    const res = await adminSet(B, 'bseIpoNo', 91291);
    expect(res.kind).toBe('INVALID');
    expect((res as { reason: string }).reason).toContain('move1290-third-row-limited');
    expect((await keysOf(C)).find((k) => k.keyValue === '91291')).toMatchObject({ state: 'ACTIVE', bindingValue: '91291' });
    expect(await movedAudit(C)).toHaveLength(0);
    expect((await keysOf(B)).filter((k) => k.keyType === 'BSE_IPO_NO')).toHaveLength(0);
  });

  it('bseIpoNo SUPERSEDED on another row by OD-83 (not an admin removal) -> refused, never stolen', async () => {
    await db.execute(sql`UPDATE ipos SET bse_ipo_no = NULL WHERE id = ${C}::uuid`);
    await db.update(schema.ipoSourceKeys).set({ state: 'SUPERSEDED', stateReason: 'OD-83 relaunch: superseded by 91299 (test)' })
      .where(and(eq(schema.ipoSourceKeys.ipoId, C), eq(schema.ipoSourceKeys.keyValue, '91291')));
    const res = await adminSet(B, 'bseIpoNo', 91291);
    expect(res.kind).toBe('INVALID');
    expect((res as { reason: string }).reason).toContain('move1290-third-row-limited');
    expect((await keysOf(C)).find((k) => k.keyValue === '91291')).toMatchObject({ state: 'SUPERSEDED', bindingValue: '91291' });
  });

  it('symbol: removed from A, typed into B -> A NSE key RELEASED and A alias closed, B NSE key ACTIVE, audit on A, B record binds B', async () => {
    expect((await adminSet(A, 'symbol', 'M1290A2')).kind).toBe('OK');
    expect(await aliasesOf(A)).toEqual([expect.objectContaining({ kind: 'SYMBOL', value: 'M1290X' })]);
    const res = await adminSet(B, 'symbol', 'M1290X');
    expect(res).toMatchObject({ kind: 'OK' });
    const aOld = (await keysOf(A)).find((k) => k.keyValue === 'M1290X|EQ')!;
    expect(aOld).toMatchObject({ state: 'RELEASED', bindingValue: null });
    expect((await keysOf(A)).find((k) => k.keyValue === 'M1290A2|EQ')).toMatchObject({ state: 'ACTIVE' });
    expect((await aliasesOf(A)).filter((a) => a.value === 'M1290X')).toHaveLength(0);
    expect((await keysOf(B)).find((k) => k.keyValue === 'M1290X|EQ')).toMatchObject({ state: 'ACTIVE' });
    const audit = await movedAudit(A);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fieldName: 'symbol', oldValue: 'M1290X' });
    expect((audit[0].details as { closedAliasIds: string[] }).closedAliasIds).toHaveLength(1);
    const bound = await bRecord({ symbol: 'M1290X', sourceKeys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'M1290X|EQ' }] });
    expect(bound?.id).toBe(B);
  });

  it('symbol whose NSE key is ACTIVE on another row C -> refused naming C', async () => {
    await db.insert(schema.ipoSourceKeys).values({
      ipoId: C, source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'M1290Q|EQ', bindingValue: 'M1290Q|EQ', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test',
    });
    const res = await adminSet(B, 'symbol', 'M1290Q');
    expect(res.kind).toBe('INVALID');
    expect((res as { reason: string }).reason).toContain('move1290-third-row-limited');
  });

  it.each([
    ['cin', CIN_X, 'U99999MH2020PLC129009', 'CIN'],
    ['isin', ISIN_X, 'INE129A01099', 'ISIN'],
  ] as const)('%s: removed from A, typed into B -> A alias closed, audit on A, B carries it live', async (field, x, aNew, kind) => {
    expect((await adminSet(A, field, aNew)).kind).toBe('OK');
    expect((await aliasesOf(A)).filter((a) => a.kind === kind && a.value === x)).toHaveLength(1);
    const res = await adminSet(B, field, x);
    expect(res).toMatchObject({ kind: 'OK' });
    expect((await aliasesOf(A)).filter((a) => a.kind === kind && a.value === x)).toHaveLength(0);
    const audit = await movedAudit(A);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ fieldName: field, oldValue: x });
    const [bRow] = await db.select().from(schema.ipos).where(eq(schema.ipos.id, B));
    expect((bRow as Record<string, unknown>)[field]).toBe(x);
  });

  it('cin carried LIVE by another row of the same offering -> refused naming it (unchanged)', async () => {
    await db.execute(sql`UPDATE ipos SET cin = 'U99999MH2020PLC129077' WHERE id = ${C}::uuid`);
    const res = await adminSet(B, 'cin', 'U99999MH2020PLC129077');
    expect(res.kind).toBe('INVALID');
    expect((res as { reason: string }).reason).toContain('move1290-third-row-limited');
  });
});
