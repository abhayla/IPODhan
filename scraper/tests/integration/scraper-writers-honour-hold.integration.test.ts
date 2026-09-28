import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository, FinancialDataRepository } from '@ipodhan/shared/repositories';
import { ListingPerformanceRepository } from '@ipodhan/shared/repositories/listing-performance-repository';
import {
  writeAdminFieldValue,
  readAdminFieldVersion,
  type AdminFieldWriteInput,
} from '@ipodhan/shared/services/admin-field-write';
import { makeIpoDetailsWriter } from '../../src/services/filing-persist-deps';
import { recordDiscoveredLeadManagers, type TransactionalIposWriter } from '../../src/services/data-persister';

/**
 * Contract 2 item A2 part E — spec §9.2 item 19 (§2.7) for EVERY scraper writer shape, not only
 * consolidatedUpsertIPO: "the scraper re-checks the protection row inside the same transaction as its
 * write, so an admin save that lands in the middle of a cycle is never overwritten by that cycle."
 *
 * Each case: the writer's cycle has already decided its patch (its orchestrator-level protection
 * read saw no hold), then the admin saves through the REAL shared admin function
 * (`writeAdminFieldValue`), then the writer writes. Only an in-transaction re-read can keep the admin
 * value; remove it (field-hold.ts) and every case goes red on the stored value. The lock case holds
 * an admin transaction open and asserts the writer WAITS and then keeps the admin value (a blocking
 * loser looks like a skipping loser: the final stored value is what is asserted).
 *
 *   cd scraper && DATABASE_URL=postgresql://<app>:<pw>@127.0.0.1:15432/ipodhan_test REDIS_URL=redis://localhost:6379 \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/scraper-writers-honour-hold.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000a2e01';
const SLUG = 'a2e-writers-honour-hold-proof-ipo';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;

let pool: Pool;
let pool2: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let db2: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`); // cascades the child rows
}

async function adminSave(tableName: string, fieldName: string, value: unknown, empty = false) {
  const v = await readAdminFieldVersion(db as never, IPO, tableName, fieldName);
  const input: AdminFieldWriteInput = {
    ipoId: IPO,
    tableName,
    fieldName,
    ...(empty ? { empty: { reason: 'does not apply to this issue' } } : { value }),
    mode: { kind: 'typed', sourceNote: 'RHP page 7' },
    expectedVersion: v!.version,
    actor: { name: 'a2e-test-admin', adminId: 'admin-a2e-it' },
    entryPoint: 'test',
    overrideReason: 'proof fixture',
  };
  const r = await writeAdminFieldValue(db as never, input);
  expect(r.kind, JSON.stringify(r)).toBe('OK');
}

const one = async <T>(q: Promise<T[]>) => (await q)[0];

describe.skipIf(!DATABASE_URL)('A2e: every scraper writer honours the admin hold inside its write transaction (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    pool2 = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    db2 = drizzle(pool2, { schema });
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
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO}::uuid, 'A2E Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Scraper Registrar Ltd', 'Scraper Sector')`);
  });

  it('IPORepository.update WITHOUT any option (base orchestrator, data-persister, rating, hints) keeps the admin value; unprotected fields still land', async () => {
    const repo = new IPORepository(db2 as never, noRedis);
    await adminSave('ipos', 'registrar', 'Admin Registrar Pvt Ltd');
    await repo.update(IPO, { registrar: 'Scraper Overwrite', sector: 'New Scraped Sector' });
    const row = await one(db.select({ r: schema.ipos.registrar, s: schema.ipos.sector }).from(schema.ipos).where(eq(schema.ipos.id, IPO)));
    expect(row).toEqual({ r: 'Admin Registrar Pvt Ltd', s: 'New Scraped Sector' });

    await adminSave('ipos', 'companyWebsite', 'https://admin.example.in');
    await repo.updateDocumentSourceHints(IPO, { companyWebsite: 'https://scraped.example.in', verifierUrl: 'https://v.example.in' });
    const hints = await one(db.select({ w: schema.ipos.companyWebsite, v: schema.ipos.verifierUrl }).from(schema.ipos).where(eq(schema.ipos.id, IPO)));
    expect(hints).toEqual({ w: 'https://admin.example.in', v: 'https://v.example.in' });
  });

  it('recordDiscoveredLeadManagers (raw ipos transaction, write-once guard) does not refill a list the admin cleared (OD-121)', async () => {
    await adminSave('ipos', 'leadManagers', null, true);
    const r = await recordDiscoveredLeadManagers(
      { invalidateIpoCache: async () => undefined },
      IPO,
      ['Axis Capital Limited'],
      'BSE',
      db2 as unknown as TransactionalIposWriter
    );
    expect(r.written).toBe(false);
    const row = await one(db.select({ lm: schema.ipos.leadManagers }).from(schema.ipos).where(eq(schema.ipos.id, IPO)));
    expect(row.lm === null || (Array.isArray(row.lm) && row.lm.length === 0)).toBe(true);
  });

  it('ipo_details writer: upsert keeps the admin value, and fillIssueTypeIfNull does not refill a cleared issueType', async () => {
    await db.execute(sql`INSERT INTO ipo_details (ipo_id, designated_exchange, data_source) VALUES (${IPO}::uuid, 'BSE', 'NSE')`);
    const writer = makeIpoDetailsWriter();
    await adminSave('ipo_details', 'designatedExchange', 'NSE');
    await writer.upsert(IPO, { designatedExchange: 'BSE', issueType: 'BOOK_BUILDING', dataSource: 'NSE' } as never);
    const d = await one(db.select({ x: schema.ipoDetails.designatedExchange, t: schema.ipoDetails.issueType }).from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, IPO)));
    expect(d).toEqual({ x: 'NSE', t: 'BOOK_BUILDING' });

    await adminSave('ipo_details', 'issueType', null, true);
    expect(await writer.fillIssueTypeIfNull(IPO, 'FIXED_PRICE')).toBe(false);
    const d2 = await one(db.select({ t: schema.ipoDetails.issueType }).from(schema.ipoDetails).where(eq(schema.ipoDetails.ipoId, IPO)));
    expect(d2.t).toBeNull();
  });

  it('FinancialDataRepository.upsert keeps the admin-held field; others update', async () => {
    await db.execute(sql`INSERT INTO financial_data (ipo_id, revenue_fy2024, eps) VALUES (${IPO}::uuid, 100.00, 1.00)`);
    await adminSave('financial_data', 'revenueFy2024', '250.50');
    await new FinancialDataRepository(db2 as never, noRedis).upsert({ ipoId: IPO, revenueFy2024: '999.99', eps: '2.50' } as never);
    const f = await one(db.select({ r: schema.financialData.revenueFy2024, e: schema.financialData.eps }).from(schema.financialData).where(eq(schema.financialData.ipoId, IPO)));
    expect(f).toEqual({ r: '250.50', e: '2.50' });
  });

  it('ListingPerformanceRepository.upsert waits on an OPEN admin transaction, then keeps the admin value', async () => {
    await db.execute(sql`INSERT INTO listing_performance (ipo_id, listing_price, issue_price) VALUES (${IPO}::uuid, 100, 90)`);
    // Admin transaction on connection 1 (the writeAdminFieldValue lock order), held open.
    const c1 = await pool.connect();
    await c1.query('BEGIN');
    await c1.query(`SELECT 1 FROM ipos WHERE id = $1 FOR NO KEY UPDATE`, [IPO]);
    await c1.query(`UPDATE listing_performance SET listing_price = 123 WHERE ipo_id = $1`, [IPO]);
    await c1.query(`INSERT INTO field_protection_metadata (table_name, field_name, ipo_id, is_protected) VALUES ('listing_performance','listingPrice',$1,true)`, [IPO]);
    let done = false;
    const writer = new ListingPerformanceRepository(db2 as never, noRedis)
      .upsert({ ipoId: IPO, listingPrice: 150, issuePrice: 95 } as never)
      .then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(done).toBe(false);
    await c1.query('COMMIT');
    c1.release();
    await writer;
    const lp = await one(db.select({ l: schema.listingPerformance.listingPrice, i: schema.listingPerformance.issuePrice }).from(schema.listingPerformance).where(eq(schema.listingPerformance.ipoId, IPO)));
    expect(lp).toEqual({ l: 123, i: 95 });
  });
});
