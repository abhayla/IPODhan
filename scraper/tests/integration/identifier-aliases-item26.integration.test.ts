import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq, and } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, resolveIpoRow, SourceKeySupersededError, IdentityHeldForReviewError, type SourceKeyRef } from '@ipodhan/shared';
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
const C = '00000000-0000-4000-8026-000000000009'; // sorts BEFORE A, so a limit-1 lookup returns it first
const IDS = [A, B, C];
const A_NAME = 'Item26 Alias Proof Limited';
const CIN_OLD = 'U99999MH2020PLC926001';
const CIN_NEW = 'U99999MH2020PLC926002';
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []],
} as never;

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repo: IPORepository;

async function cleanup() {
  await db.delete(schema.ipoMergeLog).where(inArray(schema.ipoMergeLog.dropIpoId, IDS));
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, IDS));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, IDS));
  await db.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, IDS));
  await db.delete(schema.ipoIdentifierAliases).where(inArray(schema.ipoIdentifierAliases.ipoId, IDS));
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${A}::uuid, ${B}::uuid, ${C}::uuid)`);
}

async function adminSet(fieldName: string, value: unknown) {
  const v = await readAdminFieldVersion(db as never, A, 'ipos', fieldName);
  return writeAdminFieldValue(db as never, {
    ipoId: A, tableName: 'ipos', fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP cover page' }, expectedVersion: v!.version,
    actor: { name: 'item26-admin', adminId: 'admin-item26' }, entryPoint: 'test',
  });
}

/**
 * A scraped record. By default its name is one NO row carries, so only an identifier can bind it;
 * `companyName: A_NAME` is the OD-68 name corroboration of row A.
 */
function record(over: {
  symbol?: string; cin?: string; isin?: string; openDate?: string | null; offeringType?: string; sourceKeys?: SourceKeyRef[];
  companyName?: string; priceRangeMin?: number | null;
}) {
  const companyName = over.companyName ?? 'Zqx Unrelated Item Twentysix Probe Limited';
  return resolveIpoRow(repo, {
    companyName,
    normalizedName: normalizeCompanyNameForMatching(companyName),
    slug: generateIPOSlug(companyName),
    symbol: over.symbol ?? null,
    isin: over.isin ?? null,
    cin: over.cin ?? null,
    openDate: 'openDate' in over ? over.openDate : '2026-09-12',
    priceRangeMin: over.priceRangeMin ?? null,
    segment: 'MAINBOARD',
    offeringType: over.offeringType ?? 'IPO',
    sourceKeys: over.sourceKeys ?? [],
  } as never);
}

const heldRows = async (ipoId: string) =>
  db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.ipoId, ipoId), eq(schema.auditLogs.actionType, 'IDENTITY_HELD_FOR_REVIEW')));

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
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, price_range_min, symbol, cin, isin, bse_ipo_no)
      VALUES (${A}::uuid, ${A_NAME}, 'item26-alias-proof-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD',
              '2026-09-10', 100, 'I26OLD', ${CIN_OLD}, 'INE926A01011', 99026)`);
    await db.insert(schema.ipoSourceKeys).values({
      ipoId: A, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '99026', bindingValue: '99026', state: 'ACTIVE', boundVia: 'BACKFILL', boundBy: 'test',
    });
  }, 60_000);

  it('CORE symbol: after the admin edit, a record carrying the OLD symbol binds the same row; the new one does too', async () => {
    const before = await ipoCount();
    expect((await adminSet('symbol', 'I26NEW')).kind).toBe('OK');
    const aliases = await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, A));
    expect(aliases).toEqual([expect.objectContaining({ kind: 'SYMBOL', value: 'I26OLD', replacedByAdminId: 'admin-item26' })]);
    expect((await record({ symbol: 'I26OLD', companyName: A_NAME }))?.id).toBe(A);
    expect((await record({ symbol: 'I26OLD', openDate: '2026-09-10', priceRangeMin: 100 }))?.id).toBe(A);
    expect((await record({ symbol: 'i26new ' }))?.id).toBe(A);
    expect(await ipoCount()).toBe(before);
  });

  it('CORE CIN: after the admin edit, a record carrying the OLD CIN binds the same row; the new one does too', async () => {
    const before = await ipoCount();
    expect((await adminSet('cin', CIN_NEW)).kind).toBe('OK');
    expect((await record({ cin: CIN_OLD, companyName: A_NAME }))?.id).toBe(A);
    expect((await record({ cin: CIN_OLD, openDate: '2026-09-10', priceRangeMin: 100 }))?.id).toBe(A);
    expect((await record({ cin: CIN_NEW }))?.id).toBe(A);
    expect(await ipoCount()).toBe(before);
  });

  it('ISIN: the old ISIN still binds after the edit', async () => {
    expect((await adminSet('isin', 'INE926A01029')).kind).toBe('OK');
    expect((await record({ isin: 'INE926A01011', companyName: A_NAME }))?.id).toBe(A);
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
    // the control: the same record without the contradiction, corroborated by date + band, binds
    expect((await record({ symbol: 'I26OLD', openDate: '2026-09-10', priceRangeMin: 100 }))?.id).toBe(A);
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

  // ---- Tier A review round 1 (REVISE) ----

  it('CRITICAL-1 CIN: a DIFFERENT company arriving with the CIN an admin corrected away is HELD (OD-68), not bound to A', async () => {
    expect((await adminSet('cin', CIN_NEW)).kind).toBe('OK');
    const before = await ipoCount();
    const err = await record({ cin: CIN_OLD }).catch((e) => e);
    expect(err).toBeInstanceOf(IdentityHeldForReviewError);
    expect(await ipoCount()).toBe(before);
    const held = await heldRows(A);
    expect(held).toHaveLength(1);
    expect(held[0].errorMessage).toContain('item 26');
    // same open date but no known band on the record: not corroborated either
    await expect(record({ cin: CIN_OLD, openDate: '2026-09-10' })).rejects.toBeInstanceOf(IdentityHeldForReviewError);
  });

  it('CRITICAL-1 ISIN and symbol: an uncorroborated alias-only match is HELD, never bound, never created', async () => {
    expect((await adminSet('isin', 'INE926A01029')).kind).toBe('OK');
    expect((await adminSet('symbol', 'I26NEW')).kind).toBe('OK');
    const before = await ipoCount();
    await expect(record({ isin: 'INE926A01011' })).rejects.toBeInstanceOf(IdentityHeldForReviewError);
    await expect(record({ symbol: 'I26OLD' })).rejects.toBeInstanceOf(IdentityHeldForReviewError);
    expect(await ipoCount()).toBe(before);
  });

  it('MINOR-1: an alias match with the incoming open date UNKNOWN is held, not bound', async () => {
    // the admin EMPTIED the symbol: the row has no current symbol, only the kept alias
    expect((await adminSet('symbol', null)).kind).toBe('OK');
    await expect(record({ symbol: 'I26OLD', openDate: null })).rejects.toBeInstanceOf(IdentityHeldForReviewError);
  });

  it('MINOR-2: a refused first alias candidate does not hide a valid second one', async () => {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, symbol)
      VALUES (${C}::uuid, 'Item26 Earlier Symbol Holder Limited', 'item26-earlier-symbol-holder-limited', 'MAINBOARD', 'LISTED', 'IPO', 'MAINBOARD',
              '2024-01-15', 'I26ZZC')`);
    await db.insert(schema.ipoIdentifierAliases).values([
      { ipoId: C, kind: 'SYMBOL', value: 'I26DUP', reason: 'test' },
      { ipoId: A, kind: 'SYMBOL', value: 'I26DUP', reason: 'test' },
    ]);
    expect((await record({ symbol: 'I26DUP', openDate: '2026-09-10', priceRangeMin: 100 }))?.id).toBe(A);
  });

  it('MAJOR-1: an ISIN / symbol shared with a later OFS of the company is allowed; a same-type row within 180 days refuses', async () => {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, symbol, isin)
      VALUES (${B}::uuid, 'Item26 Alias Proof Limited OFS', 'item26-alias-proof-limited-ofs-2026', 'MAINBOARD', 'UPCOMING', 'OFS', 'MAINBOARD',
              '2026-11-20', 'I26OFS', 'INE926A01037')`);
    expect((await adminSet('isin', 'INE926A01037')).kind).toBe('OK');
    expect((await adminSet('symbol', 'I26OFS')).kind).toBe('OK');
    await db.execute(sql`UPDATE ipos SET offering_type = 'IPO', open_date = '2026-10-01' WHERE id = ${B}::uuid`);
    await db.execute(sql`UPDATE ipos SET isin = 'INE926A01045', symbol = 'I26XXX' WHERE id = ${A}::uuid`);
    const r = await adminSet('isin', 'INE926A01037');
    expect(r.kind).toBe('INVALID');
    expect((r as { reason: string }).reason).toContain('item26-alias-proof-limited-ofs-2026');
  });

  it('MAJOR-2: a symbol edit moves the NSE key; the next NSE record with the new symbol binds and writes', async () => {
    await db.insert(schema.ipoSourceKeys).values({
      ipoId: A, source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'I26OLD|EQ', bindingValue: 'I26OLD|EQ', state: 'ACTIVE',
      boundVia: 'BACKFILL', boundBy: 'test', attrs: { shares: 1000, band: '95-100' } as never, recordOpenDate: '2026-09-10',
    });
    const r = await adminSet('symbol', 'I26NEW');
    expect(r.kind).toBe('OK');
    const keys = await db.select().from(schema.ipoSourceKeys).where(and(eq(schema.ipoSourceKeys.ipoId, A), eq(schema.ipoSourceKeys.keyType, 'NSE_ISSUE')));
    const old = keys.find((k) => k.keyValue === 'I26OLD|EQ');
    const now = keys.find((k) => k.keyValue === 'I26NEW|EQ');
    expect(now).toMatchObject({ state: 'ACTIVE', boundVia: 'ADMIN_EDIT', attrs: { shares: 1000, band: '95-100' } });
    expect(old).toMatchObject({ state: 'SUPERSEDED', supersededBy: now?.id });
    const bound = await record({ symbol: 'I26NEW', sourceKeys: [{ source: 'NSE', keyType: 'NSE_ISSUE', keyValue: 'I26NEW|EQ' }] });
    expect(bound?.id).toBe(A);
    // MINOR-3 (audit): the admin edit's audit row names what it kept
    const [audit] = await db.select().from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.ipoId, A), eq(schema.auditLogs.fieldName, 'symbol'), eq(schema.auditLogs.success, true)));
    const kept = (audit.details as { identifierAlias?: { aliasId: string; supersededKeyIds: string[] } }).identifierAlias;
    expect(kept?.aliasId).toBeTruthy();
    expect(kept?.supersededKeyIds).toEqual([old?.id]);
    // a SUPERSEDED NSE key still counts as held for the duplicate check
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date)
      VALUES (${B}::uuid, 'Item26 Other Holder Limited', 'item26-other-holder-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-09-11')`);
    await db.update(schema.ipoSourceKeys).set({ ipoId: B }).where(eq(schema.ipoSourceKeys.id, old!.id));
    const refused = await adminSet('symbol', 'I26OLD');
    expect(refused.kind).toBe('INVALID');
    expect((refused as { reason: string }).reason).toContain('item26-other-holder-limited');
  });

  it('MINOR-3: the merge tool moves kept aliases to the survivor and unmerge moves them back', async () => {
    expect((await adminSet('symbol', 'I26NEW')).kind).toBe('OK');
    const [alias] = await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.ipoId, A));
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date)
      VALUES (${B}::uuid, ${A_NAME}, 'item26-alias-proof-limited-survivor', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-09-10')`);
    // `ipos.category` is a legacy column schema.ts does not declare, so unmerge cannot restore a
    // non-default value (pre-existing, not item 26's): keep it at its default for this round trip.
    await db.execute(sql`UPDATE ipos SET category = DEFAULT WHERE id = ${A}::uuid`);
    await repo.mergeDuplicateInto(B, A, { apply: true, mergedBy: 'item26.test' });
    const moved = await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.id, alias.id));
    expect(moved[0]?.ipoId).toBe(B);
    const [log] = await db.select().from(schema.ipoMergeLog).where(eq(schema.ipoMergeLog.dropIpoId, A));
    expect(JSON.stringify(log.repointedChildCounts)).toContain(alias.id);
    await repo.unmergeDuplicate(log.id, { apply: true, unmergedBy: 'item26.test' });
    const back = await db.select().from(schema.ipoIdentifierAliases).where(eq(schema.ipoIdentifierAliases.id, alias.id));
    expect(back[0]?.ipoId).toBe(A);
    await db.delete(schema.ipoMergeLog).where(eq(schema.ipoMergeLog.id, log.id));
  });
});
