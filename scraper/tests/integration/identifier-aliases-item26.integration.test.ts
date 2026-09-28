import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, resolveIpoRow, SourceKeySupersededError, type SourceKeyRef } from '@ipodhan/shared';
import { normalizeCompanyNameForMatching } from '@ipodhan/shared/utils/company-name-normalizer';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';

/**
 * Spec §9.2 item 26 core proof ("Editing an identifier keeps the old one", OD-68, OD-85, OD-35):
 * an admin edits a row's symbol / CIN / ISIN / BSE IPO number through the REAL admin write
 * (`writeAdminFieldValue`), then the scraper's REAL `resolveIpoRow` is given a record carrying the
 * OLD value — it must bind the same row (no second row). A remembered symbol must still pass OD-35
 * (180 days, same offering type) and OD-69 (no CIN contradiction), because symbols are reused.
 *
 * Runs against ipodhan_test through the tunnel (from scraper/):
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/identifier-aliases-item26.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const A = '00000000-0000-4000-8026-00000000000a';
const B = '00000000-0000-4000-8026-00000000000b';
const IDS = [A, B];
const CIN_OLD = 'U99999MH2020PLC926001';
const CIN_NEW = 'U99999MH2020PLC926002';
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
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid)`);
}

async function adminSet(fieldName: string, value: unknown) {
  const v = await readAdminFieldVersion(db as never, A, 'ipos', fieldName);
  return writeAdminFieldValue(db as never, {
    ipoId: A, tableName: 'ipos', fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP cover page' }, expectedVersion: v!.version,
    actor: { name: 'item26-admin', adminId: 'admin-item26' }, entryPoint: 'test',
  });
}

/** A scraped record with a name NO row carries, so only an identifier can bind it. */
function record(over: { symbol?: string; cin?: string; isin?: string; openDate?: string; offeringType?: string; sourceKeys?: SourceKeyRef[] }) {
  const companyName = 'Zqx Unrelated Item Twentysix Probe Limited';
  return resolveIpoRow(repo, {
    companyName,
    normalizedName: normalizeCompanyNameForMatching(companyName),
    slug: generateIPOSlug(companyName),
    symbol: over.symbol ?? null,
    isin: over.isin ?? null,
    cin: over.cin ?? null,
    openDate: over.openDate ?? '2026-09-12',
    priceRangeMin: null,
    segment: 'MAINBOARD',
    offeringType: over.offeringType ?? 'IPO',
    sourceKeys: over.sourceKeys ?? [],
  } as never);
}

const ipoCount = async () => Number(((await db.execute(sql`SELECT count(*)::int AS n FROM ipos`)) as unknown as { rows: { n: number }[] }).rows[0].n);

describe.skipIf(!DATABASE_URL)('§9.2 item 26: an edited identifier keeps the old one (ipodhan_test)', () => {
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
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, symbol, cin, isin, bse_ipo_no)
      VALUES (${A}::uuid, 'Item26 Alias Proof Limited', 'item26-alias-proof-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD',
              '2026-09-10', 'I26OLD', ${CIN_OLD}, 'INE926A01011', 99026)`);
    await db.insert(schema.ipoSourceKeys).values({
      ipoId: A, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '99026', bindingValue: '99026', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test',
    });
  }, 60_000);

  it('CORE symbol: after the admin edit, a record carrying the OLD symbol binds the same row; the new one does too', async () => {
    const before = await ipoCount();
    expect((await adminSet('symbol', 'I26NEW')).kind).toBe('OK');
    const aliases = await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, A));
    expect(aliases).toEqual([expect.objectContaining({ kind: 'SYMBOL', value: 'I26OLD', replacedByAdminId: 'admin-item26' })]);
    expect((await record({ symbol: 'I26OLD' }))?.id).toBe(A);
    expect((await record({ symbol: 'i26new ' }))?.id).toBe(A);
    expect(await ipoCount()).toBe(before);
  });

  it('CORE CIN: after the admin edit, a record carrying the OLD CIN binds the same row; the new one does too', async () => {
    const before = await ipoCount();
    expect((await adminSet('cin', CIN_NEW)).kind).toBe('OK');
    expect((await record({ cin: CIN_OLD }))?.id).toBe(A);
    expect((await record({ cin: CIN_NEW }))?.id).toBe(A);
    expect(await ipoCount()).toBe(before);
  });

  it('ISIN: the old ISIN still binds after the edit', async () => {
    expect((await adminSet('isin', 'INE926A01029')).kind).toBe('OK');
    expect((await record({ isin: 'INE926A01011' }))?.id).toBe(A);
    expect((await record({ isin: 'INE926A01029' }))?.id).toBe(A);
  });

  it('OD-35 / OD-69: a remembered symbol does NOT bind a different offering', async () => {
    expect((await adminSet('symbol', 'I26NEW')).kind).toBe('OK');
    // open date 300 days away: a new offering reusing the symbol
    expect((await record({ symbol: 'I26OLD', openDate: '2027-07-07' }))?.id).not.toBe(A);
    // a different offering type
    expect((await record({ symbol: 'I26OLD', offeringType: 'RIGHTS' }))?.id).not.toBe(A);
    // a CIN contradiction (another company)
    expect((await record({ symbol: 'I26OLD', cin: 'L11111DL1999PLC000001' }))?.id).not.toBe(A);
    // the control: the same record without the contradiction binds
    expect((await record({ symbol: 'I26OLD' }))?.id).toBe(A);
  });

  it('a new value another live IPO already carries is refused and names that IPO', async () => {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, symbol)
      VALUES (${B}::uuid, 'Item26 Other Holder Limited', 'item26-other-holder-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', 'I26TAKEN')`);
    const r = await adminSet('symbol', 'I26TAKEN');
    expect(r.kind).toBe('INVALID');
    expect((r as { reason: string }).reason).toContain('item26-other-holder-limited');
    const [row] = await db.select({ s: schema.ipos.symbol }).from(schema.ipos).where(eq(schema.ipos.id, A));
    expect(row.s).toBe('I26OLD');
    expect(await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, A))).toHaveLength(0);
  });

  it('source record number: the old BSE IPO_NO key is SUPERSEDED (admin_edit) and still binds the row, writing nothing', async () => {
    expect((await adminSet('bseIpoNo', 99027)).kind).toBe('OK');
    const keys = await db.select().from(schema.ipoSourceKeys).where(and(eq(schema.ipoSourceKeys.ipoId, A), eq(schema.ipoSourceKeys.keyType, 'BSE_IPO_NO')));
    const old = keys.find((k) => k.keyValue === '99026');
    const now = keys.find((k) => k.keyValue === '99027');
    expect(old).toMatchObject({ state: 'SUPERSEDED', bindingValue: '99026', supersededBy: now?.id });
    expect(old?.stateReason).toContain('admin_edit');
    expect(now).toMatchObject({ state: 'ACTIVE', boundVia: 'ADMIN_EDIT' });
    const err = await record({ sourceKeys: [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '99026' }] }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceKeySupersededError);
    expect((err as SourceKeySupersededError).message).toContain(A);
    expect((await record({ sourceKeys: [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '99027' }] }))?.id).toBe(A);
  });
});
