import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { DataConflictsRepository } from '@ipodhan/shared/repositories';
import { dbQueueCountsLoader, dbAuditEventsLoader, dbNewConflictsLoader } from '../../src/services/admin-alerts.js';

/**
 * §9.2 item 16 (PR #1284 review MINOR 6): the admin-alert SQL loaders against a real Postgres.
 * SKIPS CLEANLY when no database is configured.
 *
 * To run:
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@127.0.0.1:15432/ipodhan_test \
 *     npx vitest run -c vitest.integration.config.ts tests/integration/admin-alerts-loaders.integration.test.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const IPO_OPEN = '00000000-0000-4000-8000-00000016a001';
const IPO_LISTED = '00000000-0000-4000-8000-00000016a002';
const IDS = [IPO_OPEN, IPO_LISTED];

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

async function cleanup(): Promise<void> {
  if (!db) return;
  await db.execute(sql`DELETE FROM data_conflicts WHERE ipo_id = ANY(${`{${IDS.join(',')}}`}::uuid[])`);
  await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ANY(${`{${IDS.join(',')}}`}::uuid[])`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ANY(${`{${IDS.join(',')}}`}::uuid[])`);
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 2, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  await cleanup();
  await db.execute(sql`
    INSERT INTO ipos (id, company_name, slug, category, status, open_date, close_date)
    VALUES (${IPO_OPEN}::uuid, 'Item16 Open Ltd', 'item16-open-ltd', 'SME', 'OPEN', '2026-09-28', '2026-09-30'),
           (${IPO_LISTED}::uuid, 'Item16 Listed Ltd', 'item16-listed-ltd', 'SME', 'LISTED', '2026-08-01', '2026-08-03')
  `);
  // A real cross-source disagreement, a same-source row (never counted), a bookkeeping field (F-181),
  // an old row created before the scan window, and a corrigendum suggestion on an ADMIN value.
  await db.execute(sql`
    INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2, severity, created_at, detected_at)
    VALUES (${IPO_OPEN}::uuid, 'ipos', '', 'issueSize', 'NSE', '100', 'BSE', '120', 'WARNING', '2026-09-29 08:00:00', '2026-09-29 08:00:00'),
           (${IPO_OPEN}::uuid, 'ipos', '', 'lotSize', 'NSE', '10', 'NSE', '12', 'INFO', '2026-09-29 08:00:00', '2026-09-29 08:00:00'),
           (${IPO_OPEN}::uuid, 'ipos', '', 'lastScrapedAt', 'NSE', 'a', 'BSE', 'b', 'INFO', '2026-09-29 08:00:00', '2026-09-29 08:00:00'),
           (${IPO_LISTED}::uuid, 'ipos', '', 'priceRangeMax', 'NSE', '50', 'BSE', '51', 'WARNING', '2026-09-20 08:00:00', '2026-09-20 08:00:00')
  `);
  await db.execute(sql`
    INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2, severity, document_id, suggestion_key, created_at, detected_at)
    VALUES (${IPO_OPEN}::uuid, 'ipos', '', 'closeDate', 'ADMIN', '2026-09-30', 'DRHP', '2026-10-02', 'WARNING', NULL, 'item16-it-suggestion', '2026-09-29 08:05:00', '2026-09-29 08:05:00')
  `);
  await db.execute(sql`
    INSERT INTO audit_logs (timestamp, admin_user, action_type, ipo_id, table_name, field_name, old_value, new_value)
    VALUES ('2026-09-29 07:00:00', 'system', 'Exchange Override', ${IPO_OPEN}::uuid, 'ipos', 'closeDate', '2026-09-30', '2026-10-01'),
           ('2026-09-27 07:00:00', 'system', 'Exchange Override', ${IPO_OPEN}::uuid, 'ipos', 'openDate', 'x', 'y'),
           ('2026-09-29 07:00:00', 'system', 'Field Updated', ${IPO_OPEN}::uuid, 'ipos', 'lotSize', '1', '2')
  `);
});

afterAll(async () => {
  if (!pool) return;
  await cleanup();
  await pool.end();
});

describe.skipIf(!DATABASE_URL)('admin-alert loaders on a real database', () => {
  it('dbQueueCountsLoader counts only real open disagreements per IPO', async () => {
    const rows = await dbQueueCountsLoader(db as never)();
    const open = rows.find((r) => r.ipoId === IPO_OPEN);
    const listed = rows.find((r) => r.ipoId === IPO_LISTED);
    // issueSize + closeDate (ADMIN vs DRHP); not the same-source lotSize, not lastScrapedAt.
    expect(open).toMatchObject({ slug: 'item16-open-ltd', status: 'OPEN', disagreements: 2, missing: 0, nearest: '2026-09-30' });
    expect(listed).toMatchObject({ status: 'LISTED', disagreements: 1 });
  });

  it('dbAuditEventsLoader returns only digest actions since the bound instant, read as UTC', async () => {
    const events = await dbAuditEventsLoader(db as never)(new Date('2026-09-29T06:59:00Z'));
    const mine = events.filter((e) => e.ipoId === IPO_OPEN);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ type: 'od106-exchange-replaced', field: 'ipos.closeDate', detail: '2026-09-30 -> 2026-10-01', status: 'OPEN' });
    expect(mine[0].at.startsWith('2026-09-29 07:00:00')).toBe(true);
  });

  it('dbNewConflictsLoader returns only rows detected since the mark that are real disagreements', async () => {
    const rows = (await dbNewConflictsLoader(db as never)(new Date('2026-09-29T07:59:00Z')))
      .filter((r) => IDS.includes(r.ipoId))
      .filter((r) => r.detectedAt!.startsWith('2026-09-29'));
    expect(rows.map((r) => r.fieldName)).toEqual(['issueSize', 'closeDate']);
    expect(rows[1]).toMatchObject({ source1: 'ADMIN', value1: '2026-09-30', source2: 'DRHP', value2: '2026-10-02', status: 'OPEN' });
    const later = (await dbNewConflictsLoader(db as never)(new Date('2026-09-29T08:01:00Z')))
      .filter((r) => IDS.includes(r.ipoId))
      .filter((r) => r.detectedAt!.startsWith('2026-09-29'));
    expect(later.map((r) => r.fieldName)).toEqual(['closeDate']);
  });

  it('round 3: an OLD open row refreshed in place by the REAL upsertConflict is returned with its new pair', async () => {
    // Created 2026-09-20: created_at is days before any mark, as for most live disagreements.
    await db!.execute(sql`
      INSERT INTO data_conflicts (ipo_id, table_name, row_key, field_name, source1, value1, source2, value2, severity, created_at, detected_at)
      VALUES (${IPO_LISTED}::uuid, 'ipos', '', 'priceRangeMin', 'NSE', '40', 'BSE', '41', 'WARNING', '2026-09-20 08:00:00', '2026-09-20 08:00:00')
    `);
    const since = new Date(Date.now() - 60_000);
    const before = (await dbNewConflictsLoader(db as never)(since)).filter((r) => r.ipoId === IPO_LISTED);
    expect(before.map((r) => r.fieldName)).toEqual([]);
    const redisStub = { del: async () => 0, keys: async () => [] as string[] };
    const repo = new DataConflictsRepository(db as never, redisStub as never);
    await repo.upsertConflict({
      ipoId: IPO_LISTED,
      tableName: 'ipos',
      fieldName: 'priceRangeMin',
      source1: 'NSE',
      value1: '40',
      source2: 'BSE',
      value2: '44',
      severity: 'WARNING',
    } as never);
    const after = (await dbNewConflictsLoader(db as never)(since)).filter((r) => r.ipoId === IPO_LISTED);
    expect(after.map((r) => r.fieldName)).toEqual(['priceRangeMin']);
    expect(after[0]).toMatchObject({ source1: 'NSE', value1: '40', source2: 'BSE', value2: '44', status: 'LISTED' });
    const created = await db!.execute(sql`
      SELECT created_at::text AS c FROM data_conflicts WHERE ipo_id = ${IPO_LISTED}::uuid AND field_name = 'priceRangeMin'
    `);
    expect(String((created as { rows: Array<{ c: string }> }).rows[0].c)).toBe('2026-09-20 08:00:00');
  });
});
