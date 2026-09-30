import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, and, eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { FinancialStatementsRepository } from '@ipodhan/shared/repositories/financial-statements-repository';
import { AnchorInvestorRepository } from '../../src/repositories/anchor-investor-repository';
import { writeNormalizedNameUnlessHeld } from '../../scripts/backfill-normalized-name';
import { writeHashRepairUnlessHeld } from '../../scripts/repair-risk-factor-heading-hash';
import {
  writeAdminListChange,
  ADMIN_LIST_SUGGESTION_REASON,
  readAdminList,
  type AdminListChangeInput,
} from '@ipodhan/shared/services/admin-list-write';

/**
 * #1294 follow-ups to item 8 (OD-107), proven on ipodhan_test against the real writers:
 *  - item 6: FinancialStatementsRepository.upsert on an admin-owned list returns what it STORED
 *    (the admin's row, with its id), or null when nothing was stored - never the incoming row.
 *  - item 3: the suggestion an anchor writer raises names THAT writer, not always NSE.
 *
 *   cd scraper && DATABASE_URL=postgresql://<app>:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-list-followups-1294.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000c1294';
const SLUG = 'c4-1294-admin-list-followups-proof';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const actor = { name: 'c4-1294-admin', adminId: 'admin-c4-1294' };

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function adminAdd(list: AdminListChangeInput['list'], add: Record<string, unknown>) {
  const { version } = await readAdminList(db as never, IPO, list);
  const r = await writeAdminListChange(db as never, { ipoId: IPO, actor, entryPoint: 'test', expectedVersion: version, list, op: { kind: 'add', row: add } } as AdminListChangeInput);
  expect(r.kind, JSON.stringify(r)).toBe('OK');
}

const inv = (name: string) => ({ name, type: 'Mutual Fund', shares: 10, amount: 1, percentOfIssue: 1 });
const fs = (fiscalYear: number, revenue = '100.00') => ({ ipoId: IPO, fiscalYear, basis: 'RESTATED', unit: 'LAKH', revenue });

describe.skipIf(!DATABASE_URL)('#1294 admin-owned list follow-ups (ipodhan_test)', () => {
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
      VALUES (${IPO}::uuid, 'C4 1294 Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Some Registrar Ltd', 'Old Sector')`);
  });

  describe('item 6: upsert on an owned list returns what it stored', () => {
    it('a year the admin lacks: nothing stored, nothing returned (no id-less phantom row)', async () => {
      await db.insert(schema.financialStatements).values([fs(2023), fs(2024)] as never);
      await adminAdd('financial_statements', { fiscalYear: 2025, basis: 'RESTATED', unit: 'LAKH', revenue: '300.00' });
      const repo = new FinancialStatementsRepository(db as never, noRedis);
      const out = await repo.upsert(fs(2022) as never);
      expect(out).toBeNull();
      const years = (await db.select({ y: schema.financialStatements.fiscalYear }).from(schema.financialStatements).where(eq(schema.financialStatements.ipoId, IPO))).map((r) => r.y).sort();
      expect(years).toEqual([2023, 2024, 2025]);
    });

    it('a year the admin has with different values: returns the ADMIN row (with its id), unchanged', async () => {
      await db.insert(schema.financialStatements).values([fs(2023)] as never);
      await adminAdd('financial_statements', { fiscalYear: 2025, basis: 'RESTATED', unit: 'LAKH', revenue: '300.00' });
      const repo = new FinancialStatementsRepository(db as never, noRedis);
      const out = await repo.upsert(fs(2023, '999.00') as never);
      const [stored] = await db.select().from(schema.financialStatements).where(and(eq(schema.financialStatements.ipoId, IPO), eq(schema.financialStatements.fiscalYear, 2023)));
      expect(out).not.toBeNull();
      expect(out!.id).toBe(stored.id);
      expect(String(out!.revenue)).toBe(String(stored.revenue));
      expect(String(stored.revenue)).toBe('100.00');
    });

    it('an unowned list still upserts and returns the written row', async () => {
      const repo = new FinancialStatementsRepository(db as never, noRedis);
      const out = await repo.upsert(fs(2022) as never);
      expect(out).not.toBeNull();
      expect(out!.id).toBeTruthy();
    });
  });

  describe('item 3: an anchor suggestion names the writer that produced it', () => {
    async function seedOwnedAnchor() {
      await db.insert(schema.anchorInvestors).values({
        ipoId: IPO, bidDate: '2026-09-20', totalSharesOffered: 100, totalAmountRaised: '10.00', anchorInvestorsCount: 2,
        lockIn50PercentDate: '2026-10-20', lockInRemainingDate: '2026-12-20', investorList: [inv('Alpha Fund'), inv('Beta Fund')],
      } as never);
      await adminAdd('anchor_investors', inv('Gamma Fund'));
      const [row] = await db.select({ id: schema.anchorInvestors.id }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO));
      return row.id;
    }
    async function anchorSuggestions() {
      return db.select().from(schema.dataConflicts).where(and(eq(schema.dataConflicts.ipoId, IPO), eq(schema.dataConflicts.tableName, 'anchor_investors'), eq(schema.dataConflicts.resolutionReason, ADMIN_LIST_SUGGESTION_REASON)));
    }
    it('a document writer (DRHP) is recorded as DRHP in the row and in the evidence', async () => {
      const id = await seedOwnedAnchor();
      const repo = new AnchorInvestorRepository(db as never);
      await repo.update(id, { investorList: JSON.stringify([inv('Alpha Fund'), inv('Delta Fund')]) }, { writer: 'DRHP' });
      const s = await anchorSuggestions();
      expect(s).toHaveLength(1);
      expect(s[0].source2).toBe('DRHP');
      expect((s[0].evidence as { writer?: string }).writer).toBe('DRHP');
    });
    it('the NSE anchor job still records NSE', async () => {
      const id = await seedOwnedAnchor();
      const repo = new AnchorInvestorRepository(db as never);
      await repo.update(id, { investorList: JSON.stringify([inv('Alpha Fund'), inv('Delta Fund')]) }, { writer: 'NSE' });
      const s = await anchorSuggestions();
      expect(s).toHaveLength(1);
      expect(s[0].source2).toBe('NSE');
    });
    it('a writer that names no source is never silently NSE', async () => {
      const id = await seedOwnedAnchor();
      const repo = new AnchorInvestorRepository(db as never);
      await repo.update(id, { investorList: JSON.stringify([inv('Alpha Fund'), inv('Delta Fund')]) });
      const s = await anchorSuggestions();
      expect(s).toHaveLength(1);
      expect(s[0].source2).not.toBe('NSE');
    });
  });

  describe('item 5: key-column repairs take the IPO row lock and leave an admin-owned list alone', () => {
    it('normalized_name repair: an owned promoters list is left as it is; an unowned one is written', async () => {
      const [p] = await db.insert(schema.promoters).values({ ipoId: IPO, name: 'Ramesh Kumar', normalizedName: 'stale', sharesHeld: 1, isPromoterGroup: false } as never).returning();
      const row = { id: p.id, ipoId: IPO, currentNormalizedName: 'stale', recomputedNormalizedName: 'ramesh kumar' };
      // Unowned: written.
      expect(await db.transaction((tx) => writeNormalizedNameUnlessHeld(tx as never, 'promoters', schema.promoters, row))).toBe('written');
      expect((await db.select().from(schema.promoters).where(eq(schema.promoters.id, p.id)))[0].normalizedName).toBe('ramesh kumar');
      // The admin then changes the list (it becomes admin-owned): a repair planned earlier is refused.
      await adminAdd('promoters', { name: 'Mahesh Kumar', sharesHeld: 5 });
      const again = { ...row, currentNormalizedName: 'ramesh kumar', recomputedNormalizedName: 'changed-after-plan' };
      expect(await db.transaction((tx) => writeNormalizedNameUnlessHeld(tx as never, 'promoters', schema.promoters, again))).toBe('held');
      expect((await db.select().from(schema.promoters).where(eq(schema.promoters.id, p.id)))[0].normalizedName).toBe('ramesh kumar');
    });

    it('heading_hash repair: a risk list that became admin-owned after the plan was read is not written', async () => {
      const [r1] = await db.insert(schema.ipoRiskFactors).values({ ipoId: IPO, seq: 1, heading: 'We depend on one customer', headingHash: 'old', body: null, kpis: null } as never).returning();
      await adminAdd('ipo_risk_factors', { seq: 2, heading: 'We have negative cash flow' });
      const outcome = await db.transaction((tx) => writeHashRepairUnlessHeld(tx as never, { id: r1.id, ipoId: IPO, headingHash: 'new' }));
      expect(outcome).toBe('held');
      expect((await db.select().from(schema.ipoRiskFactors).where(eq(schema.ipoRiskFactors.id, r1.id)))[0].headingHash).toBe('old');
    });

    it('heading_hash repair: an unowned list is written', async () => {
      const [r1] = await db.insert(schema.ipoRiskFactors).values({ ipoId: IPO, seq: 1, heading: 'We depend on one customer', headingHash: 'old', body: null, kpis: null } as never).returning();
      const outcome = await db.transaction((tx) => writeHashRepairUnlessHeld(tx as never, { id: r1.id, ipoId: IPO, headingHash: 'new' }));
      expect(outcome).toBe('written');
    });
  });
});
