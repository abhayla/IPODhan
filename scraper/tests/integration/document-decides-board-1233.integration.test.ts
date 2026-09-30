/**
 * #1233 (OD-129, spec row 23, §2.8, §9) on the REAL write door: `upsertIPO` -> DataConsolidationService
 * -> field-priority matrix -> `ipos` + `field_sources` + `data_conflicts`, against `ipodhan_test`.
 *
 * Class: every IPO whose offer document states a board — a stored NULL segment, a feed-set
 * segment that disagrees with the document, a document-set segment a later filing supersedes
 * (OD-30), and an admin-held segment (never overwritten). After a document has set the board, a
 * feed naming another board is a data_conflicts row, never a silent overwrite.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/document-decides-board-1233.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
// Relative imports, not the `@ipodhan/shared` alias (worktree junction hazard).
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-000000001233';
const STAMP = '2026-09-20 00:00:00';
const CONTEXT = ['companyName', 'offeringType', 'status', 'openDate', 'closeDate'];

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

let pool: Pool | null = null;
const savedFlags: Record<string, unknown> = {};

/**
 * The write door reads `field_sources` through the shared Redis cache (the test Redis, db 15);
 * a previous case's cached provenance would otherwise decide this case. Dropped on every seed.
 */
async function dropCachedKeys() {
  const r = new Redis(process.env.REDIS_URL || 'redis://localhost:6379/15', { lazyConnect: true });
  try {
    await r.connect();
    const keys = await r.keys(`*${IPO_ID}*`);
    if (keys.length > 0) await r.del(...keys);
  } finally {
    r.disconnect();
  }
}

async function seed(segment: string | null, segmentSource: string | null, lineage: Record<string, unknown> | null = null) {
  const p = pool!;
  await dropCachedKeys();
  await p.query('DELETE FROM ipo_field_plan WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM field_protection_metadata WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM field_sources WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM data_conflicts WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM ipos WHERE id = $1', [IPO_ID]);
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, open_date, close_date)
     VALUES ($1, 'Board 1233 Fixture Ltd.', 'board-1233-fixture-ltd', 'MAINBOARD', 'UPCOMING', $2, '["NSE"]',
             '2026-10-12', '2026-10-14')`,
    [IPO_ID, segment]
  );
  if (segmentSource) {
    await p.query(
      `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, data_lineage, updated_at, created_at)
       VALUES ($1, 'ipos', '', 'segment', $2, 90, $3::jsonb, $4, $4)`,
      [IPO_ID, segmentSource, lineage === null ? null : JSON.stringify(lineage), STAMP]
    );
  }
}

async function write(source: string, segment: string, lineage: Record<string, unknown> | null = null) {
  const { upsertIPO } = await import('../../src/services/data-persister.js');
  const repo = new IPORepository(drizzle(pool!, { schema }) as never, noRedis);
  const stored = await repo.findById(IPO_ID);
  await upsertIPO(
    repo as never,
    {
      companyName: stored!.companyName,
      segment,
      offeringType: stored!.offeringType,
      status: stored!.status,
      openDate: '2026-10-12',
      closeDate: '2026-10-14',
    } as never,
    source as never,
    stored as never,
    CONTEXT,
    lineage
  );
}

async function state() {
  const seg = (await pool!.query('SELECT segment FROM ipos WHERE id = $1', [IPO_ID])).rows[0].segment as string | null;
  const src = (
    await pool!.query(
      `SELECT source::text AS source FROM field_sources WHERE ipo_id = $1 AND table_name = 'ipos' AND field_name = 'segment'`,
      [IPO_ID]
    )
  ).rows[0]?.source as string | undefined;
  const conflicts = (
    await pool!.query(
      `SELECT source1::text AS s1, value1, source2::text AS s2, value2 FROM data_conflicts WHERE ipo_id = $1 AND field_name = 'segment'`,
      [IPO_ID]
    )
  ).rows as Array<{ s1: string; value1: string; s2: string; value2: string }>;
  return { seg, src, conflicts };
}

const RHP = { method: 'FILING_EXTRACTION', docType: 'RHP', documentId: '11111111-2222-4333-8444-000000001233' };
const DRHP = { method: 'FILING_EXTRACTION', docType: 'DRHP', documentId: '11111111-2222-4333-8444-000000000001' };

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
}, 30000);

afterAll(async () => {
  for (const [k, v] of Object.entries(savedFlags)) (FEATURE_FLAGS as never as Record<string, unknown>)[k] = v;
  if (!pool) return;
  const db = drizzle(pool, { schema });
  await db.delete(schema.ipoFieldPlan).where(eq(schema.ipoFieldPlan.ipoId, IPO_ID));
  await db.delete(schema.fieldProtectionMetadata).where(eq(schema.fieldProtectionMetadata.ipoId, IPO_ID));
  await db.delete(schema.fieldSources).where(eq(schema.fieldSources.ipoId, IPO_ID));
  await db.delete(schema.dataConflicts).where(eq(schema.dataConflicts.ipoId, IPO_ID));
  await db.delete(schema.ipos).where(eq(schema.ipos.id, IPO_ID));
  await pool.end();
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

describe.skipIf(!DATABASE_URL)('#1233 the offer document decides ipos.segment (ipodhan_test)', () => {
  it('a document board replaces a feed-set board that disagrees (CHITTORGARH MAINBOARD -> document SME)', async () => {
    await seed('MAINBOARD', 'CHITTORGARH');
    await write('DRHP', 'SME', RHP);
    const s = await state();
    expect(s.seg).toBe('SME');
    expect(s.src).toBe('DRHP');
  });

  it('a document board replaces an exchange-feed board too (NSE MAINBOARD -> document SME)', async () => {
    await seed('MAINBOARD', 'NSE');
    await write('DRHP', 'SME', RHP);
    expect((await state()).seg).toBe('SME');
  });

  it('a document board fills a stored NULL segment', async () => {
    await seed(null, null);
    await write('DRHP', 'MAINBOARD', DRHP);
    const s = await state();
    expect(s.seg).toBe('MAINBOARD');
    expect(s.src).toBe('DRHP');
  });

  it('after a document set the board, a feed naming another board is a data_conflicts row, never an overwrite', async () => {
    await seed('SME', 'DRHP', RHP);
    await write('NSE', 'MAINBOARD');
    const s = await state();
    expect(s.seg).toBe('SME');
    expect(s.src).toBe('DRHP');
    expect(s.conflicts.length).toBe(1);
    expect(s.conflicts[0]).toMatchObject({ s2: 'NSE', value2: 'MAINBOARD' });
  });

  it('OD-30: a later, higher-ranked filing (RHP) replaces the board an earlier DRHP set', async () => {
    await seed('MAINBOARD', 'DRHP', DRHP);
    await write('DRHP', 'SME', RHP);
    expect((await state()).seg).toBe('SME');
  });

  // OD-30, the other direction (an older DRHP extracted after the RHP): stopped BEFORE this door by
  // the filing persister's listing-precedence gate, which claims no board for an outranked document
  // (unit: filing-persister-document-board-1233.test.ts). `upsertIPO` passes no docType to
  // consolidation, so this door alone would let the newer write win (deferred, PR body).

  it('§9: an ADMIN-held segment is never overwritten by a document', async () => {
    await seed('MAINBOARD', 'ADMIN');
    await write('DRHP', 'SME', RHP);
    const s = await state();
    expect(s.seg).toBe('MAINBOARD');
    expect(s.src).toBe('ADMIN');
  });

  it('§2.8: the plan rebuilder (the one rebuild path, under the row lock) rebuilds MAINBOARD -> SME_NSE', async () => {
    await seed('SME', 'DRHP', RHP);
    const { makePlanRebuilder } = await import('../../src/services/filing-persist-deps.js');
    const rebuild = makePlanRebuilder(undefined, drizzle(pool!, { schema }) as never);
    const r = await rebuild(IPO_ID, { segment: 'MAINBOARD', listingExchanges: ['NSE'], offeringType: 'IPO' });
    expect(r).toMatchObject({ rebuilt: true, typeKeyBefore: 'MAINBOARD', typeKeyAfter: 'SME_NSE' });
    const planned = (await pool!.query('SELECT count(*)::int AS n FROM ipo_field_plan WHERE ipo_id = $1', [IPO_ID])).rows[0].n;
    expect(planned).toBeGreaterThan(0);
  });
});
