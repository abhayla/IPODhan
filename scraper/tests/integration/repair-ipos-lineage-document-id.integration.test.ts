/**
 * #993 repair tool on ipodhan_test: the four shapes the matching rule decides, the stamp it
 * writes, that `updated_at` is not bumped, and that a second run changes nothing.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/repair-ipos-lineage-document-id.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../packages/shared/src/db/schema';
import {
  planLineageRepair,
  applyStamps,
  REPAIR_MARKER,
  type RepairDb,
} from '../../scripts/repair-ipos-lineage-document-id';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO_ID = '00000000-0000-4000-8000-0000000e0993';
const DOC = {
  single: '00000000-0000-4000-8000-00000000d001',
  twinA: '00000000-0000-4000-8000-00000000d002',
  twinB: '00000000-0000-4000-8000-00000000d003',
  failed: '00000000-0000-4000-8000-00000000d004',
};
const FS = {
  single: '00000000-0000-4000-8000-00000000f001',
  twins: '00000000-0000-4000-8000-00000000f002',
  none: '00000000-0000-4000-8000-00000000f003',
  failed: '00000000-0000-4000-8000-00000000f004',
  stamped: '00000000-0000-4000-8000-00000000f005',
};

let pool: Pool | null = null;
let dbx: RepairDb | null = null;

async function cleanup(p: Pool) {
  await p.query('DELETE FROM field_sources WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM documents WHERE ipo_id = $1', [IPO_ID]);
  await p.query('DELETE FROM ipos WHERE id = $1', [IPO_ID]);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  dbx = drizzle(pool, { schema }) as unknown as RepairDb;
  const p = pool;
  await cleanup(p);
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges)
     VALUES ($1, 'Repair 993 Fixture Ltd.', 'repair-993-fixture-ltd', 'MAINBOARD', 'UPCOMING', 'MAINBOARD', '["NSE"]')`,
    [IPO_ID]
  );
  const doc = (id: string, type: string, status: string, extractedAt: string) =>
    p.query(
      `INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, extracted_at)
       VALUES ($1::uuid, $2, $3, 'fixture', 'repair-993-' || $1::text || '.pdf', $4, $5)`,
      [id, IPO_ID, type, status, extractedAt]
    );
  // Written at 10:00:00, its document completed 1.2 s later: the one exact match.
  await doc(DOC.single, 'RHP', 'COMPLETED', '2026-09-20 10:00:01.2');
  // Written at 11:00:00, two documents completed 1 s and 3 s later: ambiguous, left alone.
  await doc(DOC.twinA, 'RHP', 'COMPLETED', '2026-09-20 11:00:01');
  await doc(DOC.twinB, 'DRHP', 'COMPLETED', '2026-09-20 11:00:03');
  // Written at 13:00:00, the only document in the window FAILED: left alone.
  await doc(DOC.failed, 'PROSPECTUS', 'FAILED', '2026-09-20 13:00:02');
  const fs = (id: string, field: string, at: string, lineage: Record<string, unknown> | null) =>
    p.query(
      `INSERT INTO field_sources (id, ipo_id, table_name, row_key, field_name, source, confidence, data_lineage, updated_at, created_at)
       VALUES ($1, $2, 'ipos', '', $3, 'DRHP', 100, $4::jsonb, $5, $5)`,
      [id, IPO_ID, field, lineage === null ? null : JSON.stringify(lineage), at]
    );
  await fs(FS.single, 'lotSize', '2026-09-20 10:00:00', { policyOrigin: 'manifest@1' });
  await fs(FS.twins, 'faceValue', '2026-09-20 11:00:00', null);
  // Written at 12:00:00, no document completed within 10 s: left alone.
  await fs(FS.none, 'issueSize', '2026-09-20 12:00:00', null);
  await fs(FS.failed, 'priceRangeMin', '2026-09-20 13:00:00', null);
  // Already carries a documentId: never a candidate.
  await fs(FS.stamped, 'priceRangeMax', '2026-09-20 10:00:00', { documentId: DOC.twinA });
}, 30000);

afterAll(async () => {
  if (!pool) return;
  await cleanup(pool);
  await pool.end();
}, 30000);

describe.skipIf(!DATABASE_URL)('#993 repair: stamp documentId only on an exact single match', () => {
  it('decides each shape, stamps only the exact match, keeps updated_at, and is idempotent', async () => {
    const plan = await planLineageRepair(dbx!);
    const mine = (id: string) => [...plan.toStamp, ...plan.skipped].find((d) => d.row.id === id);
    expect(mine(FS.single)).toMatchObject({ kind: 'stamp', documentId: DOC.single });
    expect(mine(FS.twins)).toMatchObject({ kind: 'skip', reason: 'SEVERAL_CANDIDATES' });
    expect(mine(FS.none)).toMatchObject({ kind: 'skip', reason: 'NO_CANDIDATE' });
    expect(mine(FS.failed)).toMatchObject({ kind: 'skip', reason: 'NOT_A_COMPLETED_FILING' });
    expect(mine(FS.stamped)).toBeUndefined();

    const ours = plan.toStamp.filter((d) => d.row.ipoId === IPO_ID);
    const first = await applyStamps(dbx!, ours);
    expect(first.stampedIds).toEqual([FS.single]);

    const { rows } = await pool!.query(
      `SELECT id::text, updated_at::text AS at, data_lineage AS l FROM field_sources WHERE ipo_id = $1 ORDER BY id`,
      [IPO_ID]
    );
    const byId = new Map(rows.map((r: { id: string; at: string; l: unknown }) => [r.id, r]));
    expect(byId.get(FS.single)).toEqual({
      id: FS.single,
      at: '2026-09-20 10:00:00',
      l: { policyOrigin: 'manifest@1', documentId: DOC.single, documentIdRepair: REPAIR_MARKER },
    });
    for (const id of [FS.twins, FS.none, FS.failed]) expect((byId.get(id) as { l: unknown }).l).toBeNull();

    const again = await planLineageRepair(dbx!);
    expect(again.toStamp.filter((d) => d.row.ipoId === IPO_ID)).toEqual([]);
    expect((await applyStamps(dbx!, ours)).stampedIds).toEqual([]);
  });
});
