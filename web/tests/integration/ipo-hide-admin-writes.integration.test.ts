/**
 * OD-150 (§9.2 item 23): an admin field save and an admin list write to a HIDDEN IPO are refused with
 * IPO_HIDDEN (HTTP 409) and change nothing. Real writers on ipodhan_test, row read back after.
 *
 * To run (from web/): DATABASE_URL=<ipodhan_test url> IPODHAN_ACCEPT_TEST_DB_DRIFT=1 \
 *   npx vitest run -c vitest.integration.config.ts tests/integration/ipo-hide-admin-writes.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { writeAdminFieldValue } from '@ipodhan/shared/services/admin-field-write';
import { writeAdminListChange } from '@ipodhan/shared/services/admin-list-write';
import { adminWriteResponse } from '@/lib/admin/admin-field-save';

const DATABASE_URL = process.env.DATABASE_URL;
const ID = '00000000-0000-4000-9023-000000000011';
const SLUG = 'item23-hidden-admin-write-probe';
const ACTOR = { name: 'item23-test', adminId: '00000000-0000-4000-9023-0000000000aa' };

describe.skipIf(!DATABASE_URL)('OD-150: admin writes to a hidden IPO are refused', () => {
  let pool: Pool;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  const readRow = async () => {
    const r = await pool.query(
      'select registrar, lead_managers, hidden_at is not null as hidden from ipos where id = $1',
      [ID]
    );
    return r.rows[0];
  };
  const auditCount = async () =>
    (await pool.query('select count(*)::int n from audit_logs where ipo_id = $1', [ID])).rows[0].n as number;

  async function cleanup() {
    await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [ID]));
    await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [ID]));
    await db.delete(schema.ipos).where(eq(schema.ipos.id, ID));
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
    const { rows } = await pool.query('select current_database() as d');
    if (rows[0].d !== 'ipodhan_test') throw new Error(`Refusing to run against ${rows[0].d}`);
    db = drizzle(pool, { schema });
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, category, status, sector, registrar, lead_managers, hidden_at, hidden_reason)
      VALUES (${ID}::uuid, 'Item23 Hidden Admin Write Probe Ltd', ${SLUG}, 'IPO', 'MAINBOARD', 'MAINBOARD', 'LISTED', 'Probe',
              'Original Registrar', '["Original LM"]'::jsonb, now(), 'probe')
    `);
  }, 60000);

  afterAll(async () => {
    if (!db) return;
    await cleanup();
    await pool.end();
  }, 60000);

  it('a field save is refused IPO_HIDDEN / 409 and the row and audit log are unchanged', async () => {
    const before = await readRow();
    const audits = await auditCount();
    const result = await writeAdminFieldValue(db as never, {
      ipoId: ID,
      tableName: 'ipos',
      fieldName: 'registrar',
      value: 'Changed Registrar',
      mode: { kind: 'typed', sourceNote: 'item23 test' },
      expectedVersion: 'v0',
      actor: ACTOR,
      entryPoint: 'item23-test',
    } as never);
    expect(result.kind).toBe('HIDDEN');
    const res = adminWriteResponse(result);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('IPO_HIDDEN');
    expect(await readRow()).toEqual(before);
    expect(before.hidden).toBe(true);
    expect(await auditCount()).toBe(audits);
  });

  it('a list write is refused HIDDEN (route maps it to IPO_HIDDEN / 409) and the row is unchanged', async () => {
    const before = await readRow();
    const audits = await auditCount();
    const result = await writeAdminListChange(db as never, {
      ipoId: ID,
      list: 'lead_managers',
      op: { kind: 'add', row: { name: 'Sneaky LM' } },
      actor: ACTOR,
      entryPoint: 'item23-test',
      expectedVersion: 'v0',
    } as never);
    expect(result.kind).toBe('HIDDEN');
    expect(await readRow()).toEqual(before);
    expect(before.lead_managers).toEqual(['Original LM']);
    expect(await auditCount()).toBe(audits);
  });
});
