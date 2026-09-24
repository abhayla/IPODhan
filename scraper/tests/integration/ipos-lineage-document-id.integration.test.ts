/**
 * #993 on the real write path: DataConsolidationService with the REAL FieldSourcesRepository
 * against `ipodhan_test`. The filing persister now hands its lineage to `upsertIPO`
 * (`incomingLineage`); this reads back what lands in `field_sources.data_lineage`.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/ipos-lineage-document-id.integration.test.ts
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

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-0000000d0993';
const STAMP = '2026-09-20 00:00:00';
const LINEAGE = {
  method: 'FILING_EXTRACTION',
  docType: 'RHP',
  documentId: '11111111-2222-4333-8444-555555555555',
  sourceSha: 'b'.repeat(64),
  extractorVersion: 'v-993',
  sourceDoc: 'rhp.pdf',
};

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

type SeedRow = [fieldName: string, source: string, previous: string | null, lineage: Record<string, unknown> | null];

async function seed(fields: SeedRow[], row: Record<string, string | null> = {}) {
  const p = pool!;
  await p.query('DELETE FROM field_sources WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM data_conflicts WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM ipos WHERE id = $1', [IPO_ID]);
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, open_date, close_date,
                       lot_size, issue_size)
     VALUES ($1, 'Lineage 993 Fixture Ltd.', 'lineage-993-fixture-ltd', 'MAINBOARD', 'UPCOMING', 'MAINBOARD', '["NSE"]',
             '2026-09-29', '2026-10-01', $2, $3)`,
    [IPO_ID, row.lotSize ?? null, row.issueSize ?? null]
  );
  for (const [fieldName, source, previous, lineage] of fields) {
    await p.query(
      `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, previous_value, data_lineage, updated_at, created_at)
       VALUES ($1, 'ipos', '', $2, $3, 60, $4, $5::jsonb, $6, $6)`,
      [IPO_ID, fieldName, source, previous, lineage === null ? null : JSON.stringify(lineage), STAMP]
    );
  }
}

async function rowOf(
  fieldName: string
): Promise<{ source: string; updatedAt: string; lineage: Record<string, unknown> | null } | undefined> {
  const r = await pool!.query(
    `SELECT source::text AS source, updated_at::text AS "updatedAt", data_lineage AS lineage
       FROM field_sources WHERE ipo_id = $1 AND table_name = 'ipos' AND field_name = $2`,
    [IPO_ID, fieldName]
  );
  return r.rows[0];
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
  for (const k of ['ENABLE_DATA_CONSOLIDATION', 'ENABLE_SOURCE_TRACKING', 'ENABLE_CONFLICT_DETECTION', 'CONSOLIDATION_PERCENTAGE']) {
    if (!(k in savedFlags)) savedFlags[k] = f[k];
  }
  f.ENABLE_DATA_CONSOLIDATION = true;
  f.ENABLE_SOURCE_TRACKING = true;
  f.ENABLE_CONFLICT_DETECTION = true;
  f.CONSOLIDATION_PERCENTAGE = 100;
});

describe.skipIf(!DATABASE_URL)('#993 ipos provenance carries the document id (ipodhan_test)', () => {
  it('A: a document value filling an empty field is stamped with that document', async () => {
    await seed([]);
    await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'DRHP', confidence: 100,
      incomingData: { lotSize: 115 },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', lotSize: null },
      incomingLineage: LINEAGE,
      scrapedAt: new Date('2026-09-25T03:15:00Z'),
    });
    const row = await rowOf('lotSize');
    expect(row?.source).toBe('DRHP');
    expect(row?.lineage).toMatchObject({ documentId: LINEAGE.documentId, sourceSha: LINEAGE.sourceSha, docType: 'RHP' });
  });

  it('B: a document value replacing a lower-ranked source is stamped, and stored lineage keys survive (merge)', async () => {
    await seed([['issueSize', 'CHITTORGARH', '200000000', { sourceKeyIds: ['k-1'] }]], { issueSize: '200000000' });
    await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'DRHP', confidence: 100,
      incomingData: { issueSize: 222000000 },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', issueSize: '200000000' },
      incomingLineage: LINEAGE,
      scrapedAt: new Date('2026-09-25T03:15:00Z'),
    });
    const row = await rowOf('issueSize');
    expect(row?.source).toBe('DRHP');
    expect(row?.lineage).toMatchObject({ documentId: LINEAGE.documentId, sourceKeyIds: ['k-1'] });
  });

  it('C: OD-73 — an identical value is not re-stamped, so no document id lands on the settled row', async () => {
    await seed([['lotSize', 'NSE', '115', null]], { lotSize: '115' });
    await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'DRHP', confidence: 100,
      incomingData: { lotSize: 115 },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', lotSize: 115 },
      incomingLineage: LINEAGE,
      scrapedAt: new Date('2026-09-25T03:15:00Z'),
    });
    expect(await rowOf('lotSize')).toEqual({ source: 'NSE', updatedAt: STAMP, lineage: null });
  });

  it('E: upsertIPO hands its lineage argument to consolidation (the filing persister door)', async () => {
    await seed([]);
    const { upsertIPO } = await import('../../src/services/data-persister.js');
    const { IPORepository } = await import('../../../packages/shared/src/repositories/ipo-repository');
    const existing = (await pool!.query('SELECT * FROM ipos WHERE id = $1', [IPO_ID])).rows[0];
    const repo = new IPORepository(drizzle(pool!, { schema }) as never, noRedis);
    const stored = await repo.findById(IPO_ID);
    expect(stored?.id).toBe(existing.id);
    await upsertIPO(
      repo as never,
      {
        companyName: stored!.companyName,
        segment: stored!.segment,
        offeringType: stored!.offeringType,
        status: stored!.status,
        openDate: '2026-09-29',
        closeDate: '2026-10-01',
        lotSize: 115,
      } as never,
      'DRHP',
      stored as never,
      ['companyName', 'segment', 'offeringType', 'status', 'openDate', 'closeDate'],
      LINEAGE
    );
    const row = await rowOf('lotSize');
    expect(row?.source).toBe('DRHP');
    expect(row?.lineage).toMatchObject({ documentId: LINEAGE.documentId });
  });

  it('D: a caller that passes no lineage writes exactly what it wrote before (no document id)', async () => {
    await seed([]);
    await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'DRHP', confidence: 100,
      incomingData: { lotSize: 115 },
      existingData: { status: 'UPCOMING', segment: 'MAINBOARD', lotSize: null },
      scrapedAt: new Date('2026-09-25T03:15:00Z'),
    });
    const row = await rowOf('lotSize');
    expect(row?.source).toBe('DRHP');
    expect((row?.lineage as { documentId?: unknown } | null)?.documentId).toBeUndefined();
  });
});
