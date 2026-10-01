/**
 * #1296 (spec §2.8, §9.2 item 18): a SCRAPER consolidated write (`upsertIPO` -> DataConsolidationService
 * -> `ipos`, with NO caller-supplied `inIposWriteTx`) that changes `ipos.segment` on an existing IPO
 * rebuilds that IPO's `ipo_field_plan` rows for the new type, through the one rebuild door
 * (`rebuildIpoPlanInTx`), in the write's own transaction.
 *
 * Class: every scraper code path that can change ipos.segment / listing_exchanges / offering_type on an
 * existing IPO (the consolidation door and the fallback door of `upsertIPO`); a feed source and a
 * document source alike.
 *
 *   npx vitest run --config vitest.integration.config.ts tests/integration/scraper-write-rebuilds-plan-1296.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { generateFieldPlan } from '../../src/services/field-plan-generator';
import { loadFieldManifest } from '../../src/config/field-manifest-loader';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';
import { getTestDb, cleanupTestDb } from '../test-utils/db';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8000-000000001296';
const SLUG = 'plan-rebuild-1296-fixture-ltd';
const STAMP = '2026-09-20 00:00:00';
const CONTEXT = ['companyName', 'offeringType', 'status', 'openDate', 'closeDate'];
const RHP = { method: 'FILING_EXTRACTION', docType: 'RHP', documentId: '11111111-2222-4333-8444-000000001296' };
const manifest = loadFieldManifest();
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [] } as never;

type Db = Awaited<ReturnType<typeof getTestDb>>;
let db: Db;
const savedFlags: Record<string, unknown> = {};

async function dropCachedKeys() {
  const r = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
  try {
    await r.connect();
    const keys = await r.keys(`*${IPO}*`);
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

async function cleanup() {
  await dropCachedKeys();
  await db.execute(sql`DELETE FROM field_source_overrides WHERE ipo_id = ${IPO}::uuid`);
  await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
  await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO));
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO));
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function seed(segment: string, segmentSource: string, exchanges: string[]) {
  await cleanup();
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, listing_exchanges, open_date, close_date)
    VALUES (${IPO}::uuid, 'Plan Rebuild 1296 Fixture Ltd.', ${SLUG}, 'MAINBOARD', 'UPCOMING', 'IPO', ${segment},
            ${JSON.stringify(exchanges)}::jsonb, '2026-10-12', '2026-10-14')`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
    VALUES (${IPO}::uuid, 'ipos', '', 'segment', ${segmentSource}, 90, ${STAMP}::timestamp, ${STAMP}::timestamp)`);
  const rows = generateFieldPlan({ id: IPO, segment, listingExchanges: exchanges, offeringType: 'IPO' }, manifest);
  const at = new Date('2026-09-20T05:00:00Z');
  await db.insert(schema.ipoFieldPlan).values(
    rows.map((r) => ({
      ipoId: r.ipoId, tableName: r.tableName, rowKey: '', fieldName: r.fieldName,
      rank1Source: r.rank1Source, rank2Source: r.rank2Source, rank3Source: r.rank3Source,
      state: 'SUPPLIED' as const, chosenSource: r.rank1Source, chosenRank: 1, attempts: 1, lastAttemptAt: at,
      manifestVersion: r.manifestVersion, policyOrigin: r.policyOrigin,
    }))
  );
  return rows;
}

async function write(source: string, segment: string, lineage: Record<string, unknown> | null) {
  const { upsertIPO } = await import('../../src/services/data-persister.js');
  const repo = new IPORepository(db as never, noRedis);
  const stored = await repo.findById(IPO);
  await upsertIPO(
    repo as never,
    { companyName: stored!.companyName, segment, offeringType: stored!.offeringType, status: stored!.status, openDate: '2026-10-12', closeDate: '2026-10-14' } as never,
    source as never,
    stored as never,
    CONTEXT,
    lineage
  );
}

const project = (rows: { tableName: string; fieldName: string; rank1Source: string | null; rank2Source: string | null; rank3Source: string | null }[]) =>
  rows.map((r) => `${r.tableName}.${r.fieldName}|${r.rank1Source}|${r.rank2Source}|${r.rank3Source}`).sort();

const planRows = () => db.select().from(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO));
const storedSegment = async () => (await db.execute(sql`SELECT segment FROM ipos WHERE id = ${IPO}::uuid`)).rows[0]?.segment as string | null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  db = await getTestDb();
}, 30000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
  if (!db) return;
  await cleanup();
  await cleanupTestDb();
}, 30000);

beforeEach(() => {
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  for (const k of ['ENABLE_DATA_CONSOLIDATION', 'ENABLE_SOURCE_TRACKING', 'ENABLE_CONFLICT_DETECTION', 'CONSOLIDATION_PERCENTAGE']) {
    if (!(k in savedFlags)) savedFlags[k] = f[k];
  }
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  f.ENABLE_CONFLICT_DETECTION = true;
  f.CONSOLIDATION_PERCENTAGE = 100;
});

describe.skipIf(!DATABASE_URL)('#1296 a scraper segment change rebuilds the plan (ipodhan_test)', () => {
  it('a document-sourced board change MAINBOARD -> SME rebuilds the plan to the SME type, keeping unchanged rank-1 rows', async () => {
    const before = await seed('MAINBOARD', 'CHITTORGARH', ['BSE']);
    await write('DRHP', 'SME', RHP);
    expect(await storedSegment()).toBe('SME');

    const expected = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['BSE'], offeringType: 'IPO' }, manifest);
    const after = await planRows();
    expect(project(after)).toEqual(project(expected));

    const beforeRank1 = new Map(before.map((r) => [`${r.tableName}.${r.fieldName}`, r.rank1Source]));
    const rebuilt = after.filter((r) => beforeRank1.get(`${r.tableName}.${r.fieldName}`) !== r.rank1Source);
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const r of rebuilt) expect(r).toMatchObject({ state: 'PENDING', chosenSource: null, attempts: 0 });
  });

  it('a feed-sourced board change (NSE over a stored CHITTORGARH value) rebuilds the plan too', async () => {
    await seed('MAINBOARD', 'CHITTORGARH', ['NSE']);
    await write('NSE', 'SME', null);
    expect(await storedSegment()).toBe('SME');
    const expected = generateFieldPlan({ id: IPO, segment: 'SME', listingExchanges: ['NSE'], offeringType: 'IPO' }, manifest);
    expect(project(await planRows())).toEqual(project(expected));
  });

  it('a write that leaves the type unchanged touches no plan row', async () => {
    await seed('SME', 'NSE', ['BSE']);
    await write('NSE', 'SME', null);
    const rows = await planRows();
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toMatchObject({ state: 'SUPPLIED', attempts: 1 });
  });
});
