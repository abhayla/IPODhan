import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, and, eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { PromotersRepository } from '@ipodhan/shared/repositories/promoters-repository';
import { IpoIntermediariesRepository } from '@ipodhan/shared/repositories/ipo-intermediaries-repository';
import { FinancialStatementsRepository } from '@ipodhan/shared/repositories/financial-statements-repository';
import { IpoRiskFactorsRepository } from '@ipodhan/shared/repositories/ipo-risk-factors-repository';
import { PeerCompanyRepository } from '../../src/repositories/peer-company-repository';
import { AnchorInvestorRepository } from '../../src/repositories/anchor-investor-repository';
import {
  writeAdminListChange,
  ADMIN_LIST_AUDIT_ACTION,
  ADMIN_LIST_SUGGESTION_REASON,
  listRowKey,
  type AdminListChangeInput,
} from '@ipodhan/shared/services/admin-list-write';

/**
 * Spec §9.2 item 8 (OD-107), item 28(b), item 9, item 19; F-174. Core proof for Phase B item 8:
 * once an admin changes a list for an IPO, the WHOLE list is admin-owned — the real scraper writer of
 * that list, run afterwards with a different list, changes nothing, and its list is recorded as a
 * suggestion (rows to add / remove) for the admin queue. Every admin add/remove writes an audit row.
 *
 *   cd scraper && DATABASE_URL=postgresql://<app>:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-owned-lists.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-0000000b0801';
const SLUG = 'b08-admin-owned-lists-proof-ipo';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const actor = { name: 'b08-test-admin', adminId: 'admin-b08-it' };

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function admin(input: Omit<AdminListChangeInput, 'ipoId' | 'actor' | 'entryPoint'>) {
  return writeAdminListChange(db as never, { ipoId: IPO, actor, entryPoint: 'test', ...input } as AdminListChangeInput);
}

async function suggestions(tableName: string) {
  return db
    .select()
    .from(schema.dataConflicts)
    .where(and(eq(schema.dataConflicts.ipoId, IPO), eq(schema.dataConflicts.tableName, tableName), eq(schema.dataConflicts.resolutionReason, ADMIN_LIST_SUGGESTION_REASON)));
}

async function audits(tableName: string) {
  return db
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.ipoId, IPO), eq(schema.auditLogs.tableName, tableName), eq(schema.auditLogs.actionType, ADMIN_LIST_AUDIT_ACTION)));
}

describe.skipIf(!DATABASE_URL)('item 8 (OD-107): an admin-changed list is admin-owned against every scraper writer (ipodhan_test)', () => {
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
      INSERT INTO ipos (id, company_name, slug, category, status, registrar, sector, lead_managers)
      VALUES (${IPO}::uuid, 'B08 Proof Limited', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'Some Registrar Ltd', 'Old Sector',
              '["Axis Capital Limited","ICICI Securities Limited"]'::jsonb)`);
    await db.insert(schema.promoters).values([
      { ipoId: IPO, name: 'Ramesh Kumar', normalizedName: 'ramesh kumar', sharesHeld: 1000, isPromoterGroup: false },
      { ipoId: IPO, name: 'Suresh Kumar', normalizedName: 'suresh kumar', sharesHeld: 500, isPromoterGroup: false },
    ] as never);
  });

  it('lead_managers (ipos array): admin add + remove-with-reason, then IPORepository.update with a different list changes nothing and records a suggestion', async () => {
    expect((await admin({ list: 'lead_managers', op: { kind: 'add', row: { name: 'Kotak Mahindra Capital Company Limited' } } })).kind).toBe('OK');
    const noReason = await admin({ list: 'lead_managers', op: { kind: 'remove', rowKeys: [listRowKey('lead_managers', { name: 'ICICI Securities Limited' })], reason: '' } });
    expect(noReason.kind).toBe('INVALID');
    const removed = await admin({ list: 'lead_managers', op: { kind: 'remove', rowKeys: [listRowKey('lead_managers', { name: 'ICICI Securities Limited' })], reason: 'not a BRLM on the RHP cover page' } });
    expect(removed.kind, JSON.stringify(removed)).toBe('OK');

    const repo = new IPORepository(db as never, noRedis);
    const scraped = ['Axis Capital Limited', 'ICICI Securities Limited', 'JM Financial Limited'];
    await repo.update(IPO, { leadManagers: scraped, sector: 'New Sector' }, { honourProtection: { source: 'BSE' } });
    await repo.update(IPO, { leadManagers: scraped }, { honourProtection: { source: 'BSE' } });

    const [row] = await db.select({ lm: schema.ipos.leadManagers, s: schema.ipos.sector }).from(schema.ipos).where(eq(schema.ipos.id, IPO));
    expect(row).toEqual({ lm: ['Axis Capital Limited', 'Kotak Mahindra Capital Company Limited'], s: 'New Sector' });

    const sug = await suggestions('ipos');
    expect(sug).toHaveLength(1); // the same list twice is one suggestion (item 25)
    expect(sug[0].fieldName).toBe('leadManagers');
    expect(sug[0].source2).toBe('BSE');
    expect(sug[0].evidence).toMatchObject({ add: ['ICICI Securities Limited', 'JM Financial Limited'], remove: ['Kotak Mahindra Capital Company Limited'] });

    const a = await audits('ipos');
    expect(a).toHaveLength(2);
    expect(a.map((r) => (r.details as { op: string }).op).sort()).toEqual(['add', 'remove']);
    expect(a.find((r) => (r.details as { op: string }).op === 'remove')!.details).toMatchObject({ reason: 'not a BRLM on the RHP cover page' });
  });

  it('promoters (child table): admin add + remove-with-reason, then PromotersRepository.replacePromoters with a different list changes nothing and records a suggestion', async () => {
    expect((await admin({ list: 'promoters', op: { kind: 'add', row: { name: 'Mahesh Kumar', sharesHeld: 250 } } })).kind).toBe('OK');
    const removed = await admin({ list: 'promoters', op: { kind: 'remove', rowKeys: [listRowKey('promoters', { normalizedName: 'suresh kumar' })], reason: 'ceased to be a promoter per the RHP' } });
    expect(removed.kind, JSON.stringify(removed)).toBe('OK');

    const repo = new PromotersRepository(db as never, noRedis);
    const scraped = [
      { ipoId: IPO, name: 'Ramesh Kumar', normalizedName: 'ramesh kumar', sharesHeld: 999999, waca: null, wacaLastYear: null, isPromoterGroup: false },
      { ipoId: IPO, name: 'Suresh Kumar', normalizedName: 'suresh kumar', sharesHeld: 500, waca: null, wacaLastYear: null, isPromoterGroup: false },
      { ipoId: IPO, name: 'Dinesh Kumar', normalizedName: 'dinesh kumar', sharesHeld: 1, waca: null, wacaLastYear: null, isPromoterGroup: true },
    ];
    await repo.replacePromoters(IPO, scraped);

    const rows = await db.select({ n: schema.promoters.name, s: schema.promoters.sharesHeld }).from(schema.promoters).where(eq(schema.promoters.ipoId, IPO));
    expect(rows.sort((x, y) => x.n.localeCompare(y.n))).toEqual([
      { n: 'Mahesh Kumar', s: 250 },
      { n: 'Ramesh Kumar', s: 1000 },
    ]);

    const sug = await suggestions('promoters');
    expect(sug).toHaveLength(1);
    expect(sug[0].evidence).toMatchObject({ add: ['Dinesh Kumar', 'Suresh Kumar'], remove: ['Mahesh Kumar'] });

    expect(await audits('promoters')).toHaveLength(2);
  });

  it('removing every row leaves the list admin-EMPTY, which the scraper never refills (item 28(b), OD-121)', async () => {
    const r = await admin({ list: 'promoters', op: { kind: 'remove', rowKeys: ['ramesh kumar', 'suresh kumar'].map((n) => listRowKey('promoters', { normalizedName: n })), reason: 'the issuer is professionally managed, no promoters' } });
    expect(r.kind, JSON.stringify(r)).toBe('OK');
    await new PromotersRepository(db as never, noRedis).replacePromoters(IPO, [
      { ipoId: IPO, name: 'Ramesh Kumar', normalizedName: 'ramesh kumar', sharesHeld: 1, waca: null, wacaLastYear: null, isPromoterGroup: false },
    ]);
    const rows = await db.select().from(schema.promoters).where(eq(schema.promoters.ipoId, IPO));
    expect(rows).toHaveLength(0);
    expect(await suggestions('promoters')).toHaveLength(1);
  });

  /**
   * The same proof for the other five lists of OD-107, each against its real writer. `seed` stores
   * two rows A and B; the admin adds C and removes B (with a reason); the writer then brings A, B
   * and D (twice). Expected: stored rows are exactly A and C, one suggestion, two audit rows.
   */
  const inv = (name: string) => ({ name, type: 'Mutual Fund', shares: 10, amount: 1, percentOfIssue: 1 });
  const fs = (fiscalYear: number) => ({ ipoId: IPO, fiscalYear, basis: 'RESTATED', unit: 'LAKH', revenue: '100.00' });
  const peerRow = (companyName: string) => ({ ipoId: IPO, companyName, normalizedName: listRowKey('peer_companies', { companyName }), isListed: true });
  const brlm = (name: string) => ({ ipoId: IPO, role: 'BRLM', name, normalizedName: listRowKey('peer_companies', { companyName: name }) });
  const risk = (seq: number, heading: string, body: string | null = null) => ({ ipoId: IPO, seq, heading, body, kpis: null });
  const cases: Array<{
    list: 'peer_companies' | 'ipo_intermediaries' | 'financial_statements' | 'ipo_risk_factors' | 'anchor_investors';
    seed: () => Promise<unknown>;
    add: Record<string, unknown>;
    removeKey: string;
    write: () => Promise<unknown>;
    stored: () => Promise<string[]>;
    expectStored: string[];
    expectAdd: string[];
    expectRemove: string[];
  }> = [
    {
      list: 'peer_companies',
      seed: () => db.insert(schema.peerCompanies).values([peerRow('Alpha Peer Ltd'), peerRow('Beta Peer Ltd')] as never),
      add: { companyName: 'Gamma Peer Ltd', isListed: true },
      removeKey: listRowKey('peer_companies', { companyName: 'Beta Peer Ltd' }),
      write: () => new PeerCompanyRepository(db as never).replaceForIpo(IPO, ['Alpha Peer Ltd', 'Beta Peer Ltd', 'Delta Peer Ltd'].map(peerRow) as never),
      stored: async () => (await db.select({ n: schema.peerCompanies.companyName }).from(schema.peerCompanies).where(eq(schema.peerCompanies.ipoId, IPO))).map((r) => r.n),
      expectStored: ['Alpha Peer Ltd', 'Gamma Peer Ltd'],
      expectAdd: ['Beta Peer Ltd', 'Delta Peer Ltd'],
      expectRemove: ['Gamma Peer Ltd'],
    },
    {
      list: 'ipo_intermediaries',
      seed: () => db.insert(schema.ipoIntermediaries).values([brlm('Alpha Capital Ltd'), brlm('Beta Capital Ltd')] as never),
      add: { role: 'BRLM', name: 'Gamma Capital Ltd' },
      removeKey: listRowKey('ipo_intermediaries', { role: 'BRLM', name: 'Beta Capital Ltd' }),
      write: () =>
        new IpoIntermediariesRepository(db as never, noRedis).replaceForIpo(IPO, ['Alpha Capital Ltd', 'Beta Capital Ltd', 'Delta Capital Ltd'].map(brlm) as never),
      stored: async () => (await db.select({ n: schema.ipoIntermediaries.name }).from(schema.ipoIntermediaries).where(eq(schema.ipoIntermediaries.ipoId, IPO))).map((r) => r.n),
      expectStored: ['Alpha Capital Ltd', 'Gamma Capital Ltd'],
      expectAdd: ['Beta Capital Ltd (BRLM)', 'Delta Capital Ltd (BRLM)'],
      expectRemove: ['Gamma Capital Ltd (BRLM)'],
    },
    {
      list: 'financial_statements',
      seed: () => db.insert(schema.financialStatements).values([fs(2023), fs(2024)] as never),
      add: { fiscalYear: 2025, basis: 'RESTATED', unit: 'LAKH', revenue: '300.00' },
      removeKey: listRowKey('financial_statements', { fiscalYear: 2024, basis: 'RESTATED' }),
      write: async () => {
        const repo = new FinancialStatementsRepository(db as never, noRedis);
        await repo.upsert({ ...fs(2023), revenue: '999.00' } as never);
        await repo.upsert(fs(2022) as never);
      },
      stored: async () =>
        (await db.select({ y: schema.financialStatements.fiscalYear, r: schema.financialStatements.revenue }).from(schema.financialStatements).where(eq(schema.financialStatements.ipoId, IPO))).map((r) => `${r.y}:${r.r}`),
      expectStored: ['2023:100.00', '2025:300.00'],
      expectAdd: ['FY2022 RESTATED'],
      expectRemove: [],
    },
    {
      list: 'ipo_risk_factors',
      seed: () => new IpoRiskFactorsRepository(db as never, noRedis).replaceForIpo(IPO, [risk(1, 'We depend on one customer'), risk(2, 'Our promoters have pledged shares')] as never),
      add: { seq: 3, heading: 'We have negative operating cash flow' },
      removeKey: listRowKey('ipo_risk_factors', { heading: 'Our promoters have pledged shares' }),
      write: () =>
        new IpoRiskFactorsRepository(db as never, noRedis).replaceForIpo(IPO, [
          risk(1, 'We depend on one customer', 'changed'),
          risk(2, 'Our promoters have pledged shares'),
          risk(3, 'Our plant is in a flood zone'),
        ] as never),
      stored: async () => (await db.select({ h: schema.ipoRiskFactors.heading }).from(schema.ipoRiskFactors).where(eq(schema.ipoRiskFactors.ipoId, IPO))).map((r) => r.h),
      expectStored: ['We depend on one customer', 'We have negative operating cash flow'],
      expectAdd: ['Our plant is in a flood zone', 'Our promoters have pledged shares'],
      expectRemove: ['We have negative operating cash flow'],
    },
    {
      list: 'anchor_investors',
      seed: () =>
        db.insert(schema.anchorInvestors).values({
          ipoId: IPO,
          bidDate: '2026-09-20',
          totalSharesOffered: 100,
          totalAmountRaised: '10.00',
          anchorInvestorsCount: 2,
          lockIn50PercentDate: '2026-10-20',
          lockInRemainingDate: '2026-12-20',
          investorList: [inv('Alpha Fund'), inv('Beta Fund')],
        } as never),
      add: inv('Gamma Fund'),
      removeKey: listRowKey('anchor_investors', { name: 'Beta Fund' }),
      write: async () => {
        const repo = new AnchorInvestorRepository(db as never);
        const [row] = await db.select({ id: schema.anchorInvestors.id }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO));
        await repo.update(row.id, { investorList: JSON.stringify([inv('Alpha Fund'), inv('Beta Fund'), inv('Delta Fund')]), anchorInvestorsCount: 3, totalSharesOffered: 300 });
        await repo.deleteByIPOId(IPO);
      },
      stored: async () => {
        const [r] = await db.select({ l: schema.anchorInvestors.investorList, t: schema.anchorInvestors.totalSharesOffered }).from(schema.anchorInvestors).where(eq(schema.anchorInvestors.ipoId, IPO));
        return [...(r?.l ?? []).map((x) => x.name), `total:${r?.t}`];
      },
      // OD-117: the totals still follow the writer (exchange); the investor rows do not.
      expectStored: ['Alpha Fund', 'Gamma Fund', 'total:300'],
      expectAdd: ['Beta Fund', 'Delta Fund'],
      expectRemove: ['Gamma Fund'],
    },
  ];

  it.each(cases.map((c) => [c.list, c] as const))('%s: admin add + remove-with-reason, then the real writer with a different list changes nothing and records a suggestion', async (_name, c) => {
    await c.seed();
    const added = await admin({ list: c.list, op: { kind: 'add', row: c.add } });
    expect(added.kind, JSON.stringify(added)).toBe('OK');
    const removed = await admin({ list: c.list, op: { kind: 'remove', rowKeys: [c.removeKey], reason: 'not in the RHP of 2026-09-18' } });
    expect(removed.kind, JSON.stringify(removed)).toBe('OK');
    await c.write();
    await c.write();
    expect((await c.stored()).sort()).toEqual(c.expectStored);
    const sug = await suggestions(c.list);
    expect(sug).toHaveLength(1);
    expect(sug[0].evidence).toMatchObject({ add: c.expectAdd, remove: c.expectRemove });
    expect(await audits(c.list)).toHaveLength(2);
  });

  it('an unowned list is still written by the scraper (no hold, no suggestion)', async () => {
    await new PromotersRepository(db as never, noRedis).replacePromoters(IPO, [
      { ipoId: IPO, name: 'Dinesh Kumar', normalizedName: 'dinesh kumar', sharesHeld: 1, waca: null, wacaLastYear: null, isPromoterGroup: true },
    ]);
    const rows = await db.select({ n: schema.promoters.name }).from(schema.promoters).where(eq(schema.promoters.ipoId, IPO));
    expect(rows).toEqual([{ n: 'Dinesh Kumar' }]);
    expect(await suggestions('promoters')).toHaveLength(0);
  });
});
