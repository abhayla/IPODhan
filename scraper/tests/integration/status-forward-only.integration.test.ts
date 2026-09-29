/**
 * #1256 on the REAL write path: DataConsolidationService with the REAL FieldSourcesRepository and
 * DataConflictsRepository against `ipodhan_test`. Nothing here hand-inserts the previous value the
 * ladder reads — it is whatever the consolidation write records.
 *
 * Spec row 8 (`status`): "never regresses without an ADMIN row"; OD-83 / §2.9: an exchange moving
 * the window later (a relaunch) is the one sanctioned way back. The rule is ONE implementation,
 * packages/shared/src/utils/ipo-status-ladder.ts, used by the web ladder and this consolidation.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/status-forward-only.integration.test.ts
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
import {
  decideBackwardMove,
  LADDER_EVIDENCE_FIELDS,
  type StatusEvidence,
} from '../../../packages/shared/src/utils/ipo-status-ladder';
import { DataConsolidationService, BACKWARD_STATUS_KEPT } from '../../src/services/data-consolidation-service';
import { FEATURE_FLAGS } from '../../src/config/feature-flags';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-000000001256';
const STAMP = '2026-09-21 12:15:00'; // 17:45 IST, the close day

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

type Seed = { status: string; openDate?: string; closeDate?: string; listingDate?: string | null };

async function seed(row: Seed, fields: Array<[string, string]>) {
  const p = pool!;
  await p.query('DELETE FROM field_sources WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM data_conflicts WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM ipos WHERE id = $1', [IPO_ID]);
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, open_date, close_date, listing_date)
     VALUES ($1, 'Forward Only Fixture Ltd.', 'forward-only-fixture-ltd', 'MAINBOARD', $2, 'MAINBOARD', '["NSE","BSE"]', $3, $4, $5)`,
    [IPO_ID, row.status, row.openDate ?? '2026-09-17', row.closeDate ?? '2026-09-21', row.listingDate ?? null]
  );
  for (const [fieldName, source] of fields) {
    await p.query(
      `INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
       VALUES ($1, 'ipos', '', $2, $3, 90, $4, $4)`,
      [IPO_ID, fieldName, source, STAMP]
    );
  }
}

const existing = (row: Seed) => ({
  status: row.status,
  segment: 'MAINBOARD',
  listingExchanges: ['NSE', 'BSE'],
  openDate: row.openDate ?? '2026-09-17',
  closeDate: row.closeDate ?? '2026-09-21',
  listingDate: row.listingDate ?? null,
});

/** The same rows, same columns, the web ladder's `dbEvidenceLoader` reads. */
async function ladderEvidence(): Promise<StatusEvidence[]> {
  const r = await pool!.query(
    `SELECT field_name AS "fieldName", source::text AS source, previous_value AS "previousValue",
            previous_source::text AS "previousSource", updated_at AS "updatedAt"
       FROM field_sources WHERE ipo_id = $1 AND table_name = 'ipos' AND row_key = '' AND field_name = ANY($2)`,
    [IPO_ID, [...LADDER_EVIDENCE_FIELDS]]
  );
  return r.rows.map((x) => ({ ...x, updatedAt: new Date(x.updatedAt) }));
}

async function statusConflicts(): Promise<Array<{ source2: string; value2: string; reason: string }>> {
  const r = await pool!.query(
    `SELECT source2::text AS source2, value2, resolution_reason AS reason
       FROM data_conflicts WHERE ipo_id = $1 AND field_name = 'status'`,
    [IPO_ID]
  );
  return r.rows;
}

const field = (result: { fieldResults: Array<{ fieldName: string }> }, name: string) =>
  result.fieldResults.find((f) => f.fieldName === name) as
    | { fieldName: string; finalValue: unknown; conflictReason?: string }
    | undefined;

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

describe.skipIf(!DATABASE_URL)('#1256 status is forward-only on every writer (ipodhan_test)', () => {
  it('1: NSE extends the close date it already owns -> the real write records the old date, and the ladder may reopen', async () => {
    const row: Seed = { status: 'CLOSED', closeDate: '2026-09-21' };
    await seed(row, [['status', 'CHITTORGARH'], ['closeDate', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { closeDate: '2026-09-24' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-22T04:30:00Z'),
    });
    expect(field(result, 'closeDate')?.finalValue).toBe('2026-09-24');

    const closeRow = (await ladderEvidence()).find((e) => e.fieldName === 'closeDate');
    expect(closeRow).toMatchObject({ source: 'NSE', previousValue: '2026-09-21', previousSource: 'NSE' });

    // The orchestrator stores the decided value; the ladder then reads the stored date.
    await pool!.query('UPDATE ipos SET close_date = $2 WHERE id = $1', [IPO_ID, '2026-09-24']);
    const decision = decideBackwardMove(
      'CLOSED',
      'OPEN',
      { openDate: '2026-09-17', closeDate: '2026-09-24', listingDate: null },
      await ladderEvidence()
    );
    expect(decision).toEqual({ allowed: true, reason: 'relaunch: NSE moved closeDate 2026-09-21 -> 2026-09-24' });
  });

  it('2: CHITTORGARH reports its own status backwards (CLOSED -> OPEN), no date moved -> the consolidation keeps CLOSED', async () => {
    const row: Seed = { status: 'CLOSED' };
    await seed(row, [['status', 'CHITTORGARH'], ['closeDate', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'CHITTORGARH', confidence: 60,
      incomingData: { status: 'OPEN' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-22T04:30:00Z'),
    });
    expect(field(result, 'status')).toMatchObject({ finalValue: 'CLOSED', conflictReason: BACKWARD_STATUS_KEPT });
    // Same source contradicting itself: logged, never a data_conflicts row (T-286).
    expect(await statusConflicts()).toEqual([]);
  });

  it('3: NSE reports its own status backwards with the close date unchanged -> kept CLOSED', async () => {
    const row: Seed = { status: 'CLOSED' };
    await seed(row, [['status', 'NSE'], ['closeDate', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { status: 'OPEN', closeDate: '2026-09-21' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-22T04:30:00Z'),
    });
    expect(field(result, 'status')).toMatchObject({ finalValue: 'CLOSED', conflictReason: BACKWARD_STATUS_KEPT });
  });

  it('4: NSE sends "Open" with its own later close date in the same payload (relaunch) -> OPEN is written', async () => {
    const row: Seed = { status: 'CLOSED' };
    await seed(row, [['status', 'NSE'], ['closeDate', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { status: 'OPEN', closeDate: '2026-09-24' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-22T04:30:00Z'),
    });
    expect(field(result, 'status')?.finalValue).toBe('OPEN');
    expect(field(result, 'closeDate')?.finalValue).toBe('2026-09-24');
    expect(await statusConflicts()).toEqual([]);
  });

  it('5: NSE later close date over a CHITTORGARH-owned date is a takeover, not a relaunch -> kept CLOSED', async () => {
    const row: Seed = { status: 'CLOSED' };
    await seed(row, [['status', 'NSE'], ['closeDate', 'CHITTORGARH']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { status: 'OPEN', closeDate: '2026-09-24' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-22T04:30:00Z'),
    });
    expect(field(result, 'status')?.finalValue).toBe('CLOSED');
  });

  it('6: LISTED never goes back to CLOSED from a scraped source', async () => {
    const row: Seed = { status: 'LISTED', listingDate: '2026-09-24' };
    await seed(row, [['status', 'NSE'], ['listingDate', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'BSE', confidence: 90,
      incomingData: { status: 'CLOSED' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-25T04:30:00Z'),
    });
    expect(field(result, 'status')).toMatchObject({ finalValue: 'LISTED', conflictReason: BACKWARD_STATUS_KEPT });
    expect(await statusConflicts()).toEqual([{ source2: 'BSE', value2: 'CLOSED', reason: BACKWARD_STATUS_KEPT }]);
  });

  it('7: forward moves are untouched (CLOSED -> LISTED from NSE is written)', async () => {
    const row: Seed = { status: 'CLOSED', listingDate: '2026-09-24' };
    await seed(row, [['status', 'NSE']]);
    const result = await service!.consolidateIPOData({
      ipoId: IPO_ID, tableName: 'ipos', source: 'NSE', confidence: 90,
      incomingData: { status: 'LISTED' },
      existingData: existing(row),
      scrapedAt: new Date('2026-09-24T06:30:00Z'),
    });
    expect(field(result, 'status')?.finalValue).toBe('LISTED');
  });
});
