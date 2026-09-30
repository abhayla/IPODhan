/**
 * #1294 item 1 (spec row 134: `anchor_investors_count = len(investor_list)`; §9.2 item 8, OD-107):
 * the admin totals route saves through AnchorInvestorRepository.upsert with a count typed in the body.
 * While the investor list is admin-owned (or non-empty) the stored count must stay the list's length,
 * whatever the body says, and the save runs under the same IPO row lock the list editor takes.
 *
 *   cd web && DATABASE_URL=postgresql://<app>:<pw>@127.0.0.1:15432/ipodhan_test REDIS_HOST=127.0.0.1 \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/repositories/anchor-investor-derived-count-1294.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { AnchorInvestorRepository } from '@/lib/repositories/anchor-investor-repository';
import { writeAdminListChange, readAdminList, type AdminListChangeInput } from '@ipodhan/shared/services/admin-list-write';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000d1294';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const actor = { name: 'c4-1294-web-admin', adminId: 'admin-c4-1294-web' };
const inv = (name: string) => ({ name, type: 'Mutual Fund', shares: 10, amount: 1, percentOfIssue: 1 });
const totals = (count: number) => ({
  ipoId: IPO, bidDate: '2026-09-20', totalSharesOffered: 100, totalAmountRaised: '10.00', anchorInvestorsCount: count,
  lockIn50PercentDate: '2026-10-20', lockInRemainingDate: '2026-12-20',
});

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM anchor_investors WHERE ipo_id = ${IPO}::uuid`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function storedCount(): Promise<number | null> {
  const [r] = await db.select({ c: schema.anchorInvestors.anchorInvestorsCount }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO));
  return r ? r.c : null;
}

describe.skipIf(!DATABASE_URL)('#1294 item 1: the anchor count follows the list (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    await cleanup();
  });
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  });
  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector)
      VALUES (${IPO}::uuid, 'C4 1294 Web Proof Limited', 'c4-1294-web-anchor-count-proof', 'MAINBOARD', 'UPCOMING', 'Some Registrar Ltd', 'Old Sector')`);
  });

  async function adminAdd(row: Record<string, unknown>) {
    const { version } = await readAdminList(db as never, IPO, 'anchor_investors');
    const r = await writeAdminListChange(db as never, { ipoId: IPO, actor, entryPoint: 'test', expectedVersion: version, list: 'anchor_investors', op: { kind: 'add', row } } as AdminListChangeInput);
    expect(r.kind, JSON.stringify(r)).toBe('OK');
  }

  it('an admin-owned list: a totals save whose body count disagrees keeps the count at the list length', async () => {
    await db.insert(schema.anchorInvestors).values({ ...totals(2), investorList: [inv('Alpha Fund'), inv('Beta Fund')] } as never);
    await adminAdd(inv('Gamma Fund'));
    expect(await storedCount()).toBe(3);
    const repo = new AnchorInvestorRepository(db as never, noRedis);
    await repo.upsert(totals(99) as never);
    expect(await storedCount()).toBe(3);
  });

  it('a non-empty unowned list: the count is its length, not the body value', async () => {
    await db.insert(schema.anchorInvestors).values({ ...totals(2), investorList: [inv('Alpha Fund'), inv('Beta Fund')] } as never);
    const repo = new AnchorInvestorRepository(db as never, noRedis);
    await repo.upsert(totals(50) as never);
    expect(await storedCount()).toBe(2);
  });

  it('no list at all: there is nothing to derive from, so the typed count is stored', async () => {
    const repo = new AnchorInvestorRepository(db as never, noRedis);
    await repo.upsert(totals(7) as never);
    expect(await storedCount()).toBe(7);
  });
});
