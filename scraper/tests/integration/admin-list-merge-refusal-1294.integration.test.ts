import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { writeAdminListChange, readAdminList, type AdminListChangeInput } from '@ipodhan/shared/services/admin-list-write';

/**
 * #1294 item 4, spec §9.2 items 8 and 28(b) (clarified 2026-10-01): the OD-38 duplicate merge
 * (`IPORepository.mergeDuplicateInto`, the one every merge CLI calls) REFUSES, dry run and apply, when
 * it would delete the dropped row's admin-owned list or replace the survivor's admin-owned list, and
 * names the IPO and the list. Nothing is deleted. A merge touching no admin-owned list still plans.
 *
 *   cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/admin-list-merge-refusal-1294.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const KEEP = '00000000-0000-4000-8129-4000000000a1';
const DROP = '00000000-0000-4000-8129-4000000000d1';
const IDS = [KEEP, DROP];
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const actor = { name: 'm1294-admin', adminId: 'admin-m1294' };

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repo: IPORepository;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, IDS));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, IDS));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, IDS));
  await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id IN (${KEEP}::uuid, ${DROP}::uuid) OR drop_ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM promoters WHERE ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${KEEP}::uuid, ${DROP}::uuid)`);
}

async function adminAdd(ipoId: string, name: string) {
  const { version } = await readAdminList(db as never, ipoId, 'promoters');
  return writeAdminListChange(db as never, {
    ipoId, list: 'promoters', op: { kind: 'add', row: { name } }, actor, entryPoint: 'test', expectedVersion: version,
  } as AdminListChangeInput);
}

const promoterCount = async (ipoId: string) =>
  Number(((await db.execute(sql`SELECT count(*)::int AS n FROM promoters WHERE ipo_id = ${ipoId}::uuid`)) as unknown as { rows: { n: number }[] }).rows[0].n);
const exists = async (ipoId: string) =>
  ((await db.execute(sql`SELECT 1 FROM ipos WHERE id = ${ipoId}::uuid`)) as unknown as { rows: unknown[] }).rows.length === 1;

describe.skipIf(!DATABASE_URL)('#1294 item 4: the duplicate merge never deletes or replaces an admin-owned list (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    repo = new IPORepository(db as never, noRedis);
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  }, 60_000);
  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date, lead_managers)
      VALUES (${KEEP}::uuid, 'Merge1294 Proof Limited', 't-m1294-keep', 'IPO', 'MAINBOARD', 'UPCOMING', '2026-10-12', '2026-10-14', NULL),
             (${DROP}::uuid, 'Merge1294 Proof Ltd', 't-m1294-drop', 'IPO', 'MAINBOARD', 'UPCOMING', '2026-10-12', '2026-10-14', '["Drop Capital Ltd"]'::jsonb)`);
  }, 60_000);

  it('control: no admin-owned list -> the merge plans as before', async () => {
    const plan = await repo.mergeDuplicateInto(KEEP, DROP, { apply: false });
    expect(plan.applied).toBe(false);
  });

  it('the DROPPED row has an admin-owned promoters list -> dry run and apply both refused, naming the IPO and the list; nothing deleted', async () => {
    expect((await adminAdd(DROP, 'Admin Typed Promoter')).kind).toBe('OK');
    for (const apply of [false, true]) {
      const err = await repo.mergeDuplicateInto(KEEP, DROP, { apply }).then(() => null, (e: Error) => e);
      expect(err?.message).toContain('mergeDuplicateInto: refused');
      expect(err?.message).toContain('t-m1294-drop');
      expect(err?.message).toContain('promoters');
    }
    expect(await exists(DROP)).toBe(true);
    expect(await promoterCount(DROP)).toBe(1);
  });

  it('the dropped row\'s admin-EMPTY list (every row removed) is still admin work -> refused', async () => {
    expect((await adminAdd(DROP, 'Admin Typed Promoter')).kind).toBe('OK');
    const { version, rows } = await readAdminList(db as never, DROP, 'promoters');
    const removed = await writeAdminListChange(db as never, {
      ipoId: DROP, list: 'promoters', op: { kind: 'remove', rowKeys: rows.map((r) => r.key), reason: 'not a promoter' },
      actor, entryPoint: 'test', expectedVersion: version,
    } as AdminListChangeInput);
    expect(removed.kind).toBe('OK');
    const err = await repo.mergeDuplicateInto(KEEP, DROP, { apply: false }).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('t-m1294-drop has an admin-owned promoters list');
  });

  it('the SURVIVOR\'s admin-owned lead managers would receive the dropped row\'s list -> refused, naming the survivor', async () => {
    await db.insert(schema.fieldProtectionMetadata).values({
      ipoId: KEEP, tableName: 'ipos', fieldName: 'leadManagers', isProtected: true, autoProtected: true, manuallyEditedBy: 'm1294-admin',
    } as never);
    const err = await repo.mergeDuplicateInto(KEEP, DROP, { apply: false }).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('t-m1294-keep has an admin-owned lead_managers list, which the merge would replace');
  });

  it('the survivor\'s admin-owned promoters list is untouched by a merge -> the merge plans', async () => {
    expect((await adminAdd(KEEP, 'Survivor Promoter')).kind).toBe('OK');
    const plan = await repo.mergeDuplicateInto(KEEP, DROP, { apply: false });
    expect(plan.applied).toBe(false);
  });
});
