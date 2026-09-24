/**
 * OD-73 / #908 on the real write path: DataConsolidationService with the REAL
 * FieldSourcesRepository and DataConflictsRepository against `ipodhan_test`.
 *
 * Reads back what the unit test cannot see: `field_sources.updated_at` (the "re-stamp" #908
 * measured on staging) and the `data_conflicts` row an ignored lower-ranked value leaves.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/od73-settled-field.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
// Relative imports, not the `@ipodhan/shared` alias — a worktree's junctioned node_modules can
// resolve the alias to the main checkout's copy.
import * as schema from '../../../packages/shared/src/db/schema';
import { FieldSourcesRepository } from '../../../packages/shared/src/repositories/field-sources-repository';
import { DataConflictsRepository } from '../../../packages/shared/src/repositories/data-conflicts-repository';
import { DataConsolidationService } from '../../src/services/data-consolidation-service';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';
import { isAdminOnlyConflict } from '../../../packages/shared/src/utils/conflict-reasons';
// @ts-expect-error -- untyped .mjs script module; the SQL it exports is exactly what the nightly floor runs
import { unresolvedConflictCountSql, conflictsInserted24hSql } from '../../../scripts/lib/conflict-reasons.mjs';
// @ts-expect-error -- untyped .mjs script module
import { adminQueueSize } from '../../../scripts/ops/admin-queue-size.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-0000000d0073';
const STAMP = '2026-09-20 00:00:00';

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

let pool: Pool | null = null;
let service: DataConsolidationService | null = null;
const savedFlags: Record<string, unknown> = {};

async function seed(status: string, fields: Array<[string, string, string]>, row: Record<string, string> = {}) {
  const p = pool!;
  await p.query('DELETE FROM field_sources WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM data_conflicts WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM ipos WHERE id = $1', [IPO_ID]);
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, open_date, close_date,
                       price_range_min, price_range_max, lot_size, issue_size)
     VALUES ($1, 'OD73 Settled Fixture Ltd.', 'od73-settled-fixture-ltd', 'MAINBOARD', $2, 'MAINBOARD', '["NSE","BSE"]',
             $3, $4, $5, $6, 100, $7)`,
    [IPO_ID, status, row.openDate ?? '2026-09-24', row.closeDate ?? '2026-09-26', row.priceRangeMin ?? '126',
      row.priceRangeMax ?? '130', row.issueSize ?? '192000000']
  );
  for (const [fieldName, source, previous] of fields) {
    await p.query(
      `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, previous_value, updated_at, created_at)
       VALUES ($1, 'ipos', '', $2, $3, 60, $4, $5, $5)`,
      [IPO_ID, fieldName, source, previous, STAMP]
    );
  }
}

async function stampOf(fieldName: string): Promise<{ updatedAt: string; source: string } | undefined> {
  const r = await pool!.query(
    `SELECT updated_at::text AS "updatedAt", source::text AS source FROM field_sources WHERE ipo_id = $1 AND field_name = $2`,
    [IPO_ID, fieldName]
  );
  return r.rows[0];
}

async function conflictsFor(fieldName: string): Promise<Array<{ source1: string; source2: string; resolved: string }>> {
  const r = await pool!.query(
    `SELECT source1::text AS source1, source2::text AS source2, resolved_source::text AS resolved
       FROM data_conflicts WHERE ipo_id = $1 AND field_name = $2`,
    [IPO_ID, fieldName]
  );
  return r.rows;
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') {
    throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  }
  const db = drizzle(pool, { schema });
  service = new DataConsolidationService(
    new FieldSourcesRepository(db as never, noRedis) as never,
    new DataConflictsRepository(db as never, noRedis) as never
  );
}, 30000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
  await pool.end();
}, 30000);

beforeEach(() => {
  const f = FEATURE_FLAGS as never as Record<string, unknown>;
  for (const k of ['ENABLE_DATA_CONSOLIDATION', 'ENABLE_SOURCE_TRACKING', 'ENABLE_CONFLICT_DETECTION', 'CONSOLIDATION_PERCENTAGE', 'ENABLE_POLICY_WRITER']) {
    if (!(k in savedFlags)) savedFlags[k] = f[k];
  }
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  f.ENABLE_CONFLICT_DETECTION = true;
  f.CONSOLIDATION_PERCENTAGE = 100;
  f.ENABLE_POLICY_WRITER = true;
});

describe.skipIf(!DATABASE_URL)('OD-73 settled fields on the real write path (ipodhan_test)', () => {
  it('A: an identical value from another source leaves field_sources.updated_at untouched (Adroit 126 -> 126)', async () => {
    await seed('OPEN', [['priceRangeMin', 'CHITTORGARH', '126'], ['openDate', 'CHITTORGARH', '2026-09-24']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { priceRangeMin: 126, openDate: '2026-09-24' },
      existingData: { status: 'OPEN', segment: 'MAINBOARD', priceRangeMin: 126, openDate: '2026-09-24' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(result.fieldsUpdated).toBe(0);
    expect(await stampOf('priceRangeMin')).toEqual({ updatedAt: STAMP, source: 'CHITTORGARH' });
    expect(await stampOf('openDate')).toEqual({ updatedAt: STAMP, source: 'CHITTORGARH' });
  });

  it('B: a higher-ranked source replaces the issue size (Vivekanand BSE 19.2 cr -> CHITTORGARH 22.2 cr)', async () => {
    await seed('OPEN', [['issueSize', 'BSE', '192000000']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'CHITTORGARH', confidence: 60,
      incomingData: { issueSize: 222000000 },
      existingData: { status: 'OPEN', segment: 'MAINBOARD', issueSize: '192000000' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(result.consolidatedData.issueSize).toBe(222000000);
    const s = await stampOf('issueSize');
    expect(s!.source).toBe('CHITTORGARH');
    expect(s!.updatedAt).not.toBe(STAMP);
  });

  it('C: a lower-ranked website differing from the document is not written and lands in data_conflicts', async () => {
    await seed('CLOSED', [['priceRangeMin', 'DRHP', '126']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'CHITTORGARH', confidence: 60,
      incomingData: { priceRangeMin: 131 },
      existingData: { status: 'CLOSED', segment: 'MAINBOARD', priceRangeMin: 126 },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(Number(result.consolidatedData.priceRangeMin)).toBe(126);
    expect(result.fieldsUpdated).toBe(0);
    expect(await stampOf('priceRangeMin')).toEqual({ updatedAt: STAMP, source: 'DRHP' });
    expect(await conflictsFor('priceRangeMin')).toEqual([{ source1: 'DRHP', source2: 'CHITTORGARH', resolved: 'DRHP' }]);
  });

  it('D: the exchange that stated the open date moves it (postponement, same row)', async () => {
    await seed('UPCOMING', [['openDate', 'NSE', '2026-09-24']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { openDate: '2026-09-29' },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', openDate: '2026-09-24' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(result.consolidatedData.openDate).toBe('2026-09-29');
    expect(result.fieldsUpdated).toBe(1);
    expect((await stampOf('openDate'))!.updatedAt).not.toBe(STAMP);
  });

  it('E: status is a live figure and still refreshes', async () => {
    await seed('UPCOMING', [['status', 'NSE', 'UPCOMING']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { status: 'OPEN' },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(result.consolidatedData.status).toBe('OPEN');
    expect(result.fieldsUpdated).toBe(1);
  });

  it('OD-75: a website changing its own date keeps the old value and writes ONE SOURCE_CHANGED_OWN_VALUE row (INFO) through the real repository', async () => {
    await seed('CLOSED', [['closeDate', 'CHITTORGARH', '2026-09-26']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'CHITTORGARH', confidence: 60,
      incomingData: { closeDate: '2026-09-27' },
      existingData: { status: 'CLOSED', segment: 'MAINBOARD', closeDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T03:15:00Z'),
    });
    expect(result.consolidatedData.closeDate).toBe('2026-09-26');
    expect(result.fieldsUpdated).toBe(0);
    expect(await stampOf('closeDate')).toEqual({ updatedAt: STAMP, source: 'CHITTORGARH' });
    const rows = await pool!.query(
      `SELECT source1::text AS s1, source2::text AS s2, value1, value2, resolution_reason AS reason, severity::text AS severity
         FROM data_conflicts WHERE ipo_id = $1 AND field_name = 'closeDate'`,
      [IPO_ID]
    );
    expect(rows.rows).toEqual([{ s1: 'CHITTORGARH', s2: 'CHITTORGARH', value1: '2026-09-26', value2: '2026-09-27', reason: 'SOURCE_CHANGED_OWN_VALUE', severity: 'INFO' }]);

    // A second cycle repeating the change refreshes the same row — never a second one (T-286).
    await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'CHITTORGARH', confidence: 60,
      incomingData: { closeDate: '2026-09-27' },
      existingData: { status: 'CLOSED', segment: 'MAINBOARD', closeDate: '2026-09-26' },
      scrapedAt: new Date('2026-09-23T09:15:00Z'),
    });
    const again = await pool!.query(`SELECT count(*)::int AS n FROM data_conflicts WHERE ipo_id = $1 AND field_name = 'closeDate'`, [IPO_ID]);
    expect(again.rows[0].n).toBe(1);
  });

  it('OD-75: the repository still refuses an UNNAMED same-source row (W-79), and a self-change never overwrites an open cross-source dispute', async () => {
    await seed('CLOSED', []);
    const repo = new DataConflictsRepository(drizzle(pool!, { schema }) as never, noRedis);
    const unnamed = await repo.upsertConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source1: 'CHITTORGARH', value1: 'a', source2: 'CHITTORGARH', value2: 'b', resolutionReason: 'DEFAULT_KEEP_EXISTING' });
    expect(unnamed).toEqual({ skipped: true, reason: 'same_source' });
    await repo.upsertConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source1: 'DRHP', value1: 'a', source2: 'CHITTORGARH', value2: 'b', resolutionReason: 'SOURCE_PRIORITY' });
    const self = await repo.upsertConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source1: 'CHITTORGARH', value1: 'b', source2: 'CHITTORGARH', value2: 'c', resolutionReason: 'SOURCE_CHANGED_OWN_VALUE', severity: 'INFO' });
    expect(self).toEqual({ skipped: true, reason: 'same_source' });
    expect(await conflictsFor('registrar')).toEqual([{ source1: 'DRHP', source2: 'CHITTORGARH', resolved: null }]);
  });

  // Review round 2 (PR #914): an OD-75 row is on the admin list and NOWHERE else. Each reader below is
  // run for real against ipodhan_test; the cross-source row added at the end proves each one CAN count.
  it('OD-75 round 2: an admin-only row shows on the admin list but never holds a transition or enters a count', async () => {
    await seed('OPEN', [['closeDate', 'CHITTORGARH', '2026-09-26']]);
    const repo = new DataConflictsRepository(drizzle(pool!, { schema }) as never, noRedis);
    // Scoped to this test's own IPO (#995): the shared count SQL runs UNCHANGED against a CTE that
    // shadows data_conflicts with this IPO's rows only, so the helper stays the single definition and
    // another integration file writing data_conflicts in parallel cannot move the number.
    const count = async (sql: string, key: string) =>
      (await pool!.query(`WITH data_conflicts AS (SELECT * FROM public.data_conflicts WHERE ipo_id = $1) ${sql}`, [IPO_ID]))
        .rows[0][key] as number;
    const backlog0 = await count(unresolvedConflictCountSql(), 'total');
    const inserted0 = await count(conflictsInserted24hSql(), 'inserted');

    await repo.upsertConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'closeDate', source1: 'CHITTORGARH', value1: '2026-09-26', source2: 'CHITTORGARH', value2: '2026-09-27', resolvedSource: 'CHITTORGARH', resolutionReason: 'SOURCE_CHANGED_OWN_VALUE', severity: 'INFO' });

    // Admin list (conflict-resolution.ts getConflictsForIPO / getConflicts) still shows it.
    const open = await repo.findUnresolvedForIPO(IPO_ID);
    expect(open.map((r) => r.resolutionReason)).toEqual(['SOURCE_CHANGED_OWN_VALUE']);
    expect((await repo.findUnresolved()).some((r) => r.ipoId === IPO_ID)).toBe(true);

    // Status transition: the rows isTransitionHeld sees after its admin-only filter hold nothing on closeDate.
    expect(open.filter((r) => r.fieldName === 'closeDate' && !isAdminOnlyConflict(r))).toEqual([]);

    // Counts: getConflictStats, admin-queue-size, the backlog ratchet and the inert-detector count.
    expect(await repo.getConflictStats(IPO_ID)).toMatchObject({ total: 0, unresolved: 0 });
    const queue = await adminQueueSize(pool!);
    expect(queue.byIpo.find((e: { slug: string }) => e.slug === 'od73-settled-fixture-ltd')).toBeUndefined();
    expect(await count(unresolvedConflictCountSql(), 'total')).toBe(backlog0);
    expect(await count(conflictsInserted24hSql(), 'inserted')).toBe(inserted0);

    // Positive control: a real cross-source dispute IS counted by every one of the same readers.
    await repo.upsertConflict({ ipoId: IPO_ID, tableName: 'ipos', fieldName: 'registrar', source1: 'DRHP', value1: 'a', source2: 'CHITTORGARH', value2: 'b', resolutionReason: 'SOURCE_PRIORITY' });
    expect(await repo.getConflictStats(IPO_ID)).toMatchObject({ total: 1, unresolved: 1 });
    const queue2 = await adminQueueSize(pool!);
    expect(queue2.byIpo.find((e: { slug: string }) => e.slug === 'od73-settled-fixture-ltd')).toMatchObject({ conflicts: 1 });
    expect(await count(unresolvedConflictCountSql(), 'total')).toBe(backlog0 + 1);
    expect(await count(conflictsInserted24hSql(), 'inserted')).toBe(inserted0 + 1);
  });
});
