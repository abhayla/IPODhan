import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, inArray, eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared/repositories';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import { writeAdminListChange, readAdminList, type AdminListChangeInput } from '@ipodhan/shared/services/admin-list-write';
import { moveAdminRemovedCopies } from '@ipodhan/shared/services/admin-identifier-alias';

/**
 * PR #1371 Tier A round 2: an admin write that checks a condition and then writes on it must run the
 * check under the lock the write holds. Each race is interleaved deterministically (a held commit plus
 * a wait for the second transaction to block on a lock), never by timing.
 *
 *  1. MAJOR-1 (§9.2 items 8, 28(b)): an admin list edit commits between the merge's early refusal check
 *     and its FOR UPDATE on both rows -> the merge must still refuse, and the list must survive.
 *  2. MINOR-1 (OD-68): two admins save the same CIN / ISIN / symbol / BSE IPO number on two different
 *     rows at once -> exactly one succeeds; the other is refused naming the holder.
 *  3. MINOR-2 (#1290): the move releases ONLY admin-removed copies; a SUPERSEDED key with another
 *     reason (OD-83 / OD-86) is never released, even when the caller's holder check did not see it.
 *
 * Runs against ipodhan_test through the tunnel (from scraper/, `.env.test` supplies DATABASE_URL):
 *   npx vitest run -c vitest.integration.config.ts tests/integration/admin-write-races-1371.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const KEEP = '00000000-0000-4000-8137-1000000000a1';
const DROP = '00000000-0000-4000-8137-1000000000d1';
const B = '00000000-0000-4000-8137-10000000000b';
const C = '00000000-0000-4000-8137-10000000000c';
const IDS = [KEEP, DROP, B, C];
const B_APP = 'race1371-second-writer';
const noRedis = { get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0, keys: async () => [], scan: async () => ['0', []] } as never;
const actor = { name: 'race1371-admin', adminId: 'admin-race1371' };

let pool: Pool;
let poolB: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let dbB: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, IDS));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, IDS));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, IDS));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, IDS));
  await db.delete(schema.ipoSourceKeys).where(inArray(schema.ipoSourceKeys.ipoId, IDS));
  await db.delete(schema.ipoIdentifierAliases).where(inArray(schema.ipoIdentifierAliases.ipoId, IDS));
  await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id IN (${KEEP}::uuid, ${DROP}::uuid) OR drop_ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM promoters WHERE ipo_id IN (${KEEP}::uuid, ${DROP}::uuid)`);
  await db.execute(sql`DELETE FROM ipos WHERE id IN (${KEEP}::uuid, ${DROP}::uuid, ${B}::uuid, ${C}::uuid)`);
}

/** A db whose FIRST transaction runs `before` (committed on its own connection) and then proceeds. */
function beforeFirstTransaction<T extends object>(real: T, before: () => Promise<unknown>): T {
  let fired = false;
  return new Proxy(real, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (prop === 'transaction') {
        return async (...args: unknown[]) => {
          if (!fired) {
            fired = true;
            await before();
          }
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/** A db whose transaction does all its work, then waits for `gate` before it commits. */
function commitAfter<T extends object>(real: T, gate: Promise<void>, workDone: () => void): T {
  return new Proxy(real, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target) as unknown;
      if (prop === 'transaction') {
        return (cb: (tx: unknown) => Promise<unknown>, ...rest: unknown[]) =>
          (v as (...a: unknown[]) => Promise<unknown>).call(target, async (tx: unknown) => {
            const out = await cb(tx);
            workDone();
            await gate;
            return out;
          }, ...rest);
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

async function adminSave(on: typeof db, ipoId: string, fieldName: string, value: unknown) {
  const v = await readAdminFieldVersion(db as never, ipoId, 'ipos', fieldName);
  return writeAdminFieldValue(on as never, {
    ipoId, tableName: 'ipos', fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP cover page' }, expectedVersion: v!.version,
    actor, entryPoint: 'test',
  });
}

/** Resolves once the second writer's connection is waiting on a lock (or `done` settles first). */
async function secondWriterBlockedOr(done: Promise<unknown>) {
  let settled = false;
  void done.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 400 && !settled; i++) {
    const r = await db.execute(sql`
      SELECT count(*)::int AS n FROM pg_stat_activity
       WHERE application_name = ${B_APP} AND wait_event_type = 'Lock'`);
    if ((r as unknown as { rows: { n: number }[] }).rows[0].n > 0) return 'blocked';
    await new Promise((res) => setTimeout(res, 25));
  }
  return settled ? 'settled' : 'timeout';
}

describe.skipIf(!DATABASE_URL)('PR #1371 round 2: admin write races are serialised (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    poolB = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC', application_name: B_APP });
    db = drizzle(pool, { schema });
    dbB = drizzle(poolB, { schema });
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
    await poolB?.end();
  }, 60_000);
  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, close_date, lead_managers)
      VALUES (${KEEP}::uuid, 'Race1371 Merge Proof Limited', 't-r1371-keep', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-10-12', '2026-10-14', NULL),
             (${DROP}::uuid, 'Race1371 Merge Proof Ltd', 't-r1371-drop', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-10-12', '2026-10-14', NULL),
             (${B}::uuid, 'Race1371 Row B Limited', 't-r1371-row-b', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-10-20', '2026-10-22', NULL),
             (${C}::uuid, 'Race1371 Row C Limited', 't-r1371-row-c', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-10-21', '2026-10-23', NULL)`);
  }, 60_000);

  it('MAJOR-1: a list edit committed between the early check and the lock -> the merge (apply) refuses; the list survives', async () => {
    const addOnDrop = async () => {
      const { version } = await readAdminList(db as never, DROP, 'promoters');
      const r = await writeAdminListChange(db as never, {
        ipoId: DROP, list: 'promoters', op: { kind: 'add', row: { name: 'Race Typed Promoter' } }, actor, entryPoint: 'test', expectedVersion: version,
      } as AdminListChangeInput);
      expect(r.kind).toBe('OK');
    };
    const repo = new IPORepository(beforeFirstTransaction(db, addOnDrop) as never, noRedis);
    const err = await repo.mergeDuplicateInto(KEEP, DROP, { apply: true }).then(() => null, (e: Error) => e);
    expect(err?.message).toContain('mergeDuplicateInto: refused');
    expect(err?.message).toContain('t-r1371-drop has an admin-owned promoters list');
    const left = await db.execute(sql`SELECT count(*)::int AS n FROM promoters WHERE ipo_id = ${DROP}::uuid`);
    expect((left as unknown as { rows: { n: number }[] }).rows[0].n).toBe(1);
    const dropRow = await db.execute(sql`SELECT 1 FROM ipos WHERE id = ${DROP}::uuid`);
    expect((dropRow as unknown as { rows: unknown[] }).rows).toHaveLength(1);
  });

  const SAME_VALUE: Array<[string, unknown, string]> = [
    ['cin', 'U99999MH2020PLC137001', 'U99999MH2020PLC137001'],
    ['isin', 'INE137A01011', 'INE137A01011'],
    ['symbol', 'R1371SYM', 'R1371SYM'],
    ['bseIpoNo', 91371, '91371'],
  ];
  for (const [fieldName, value, shown] of SAME_VALUE) {
    it(`MINOR-1 ${fieldName}: two concurrent saves of one value on two rows -> exactly one succeeds, the other names the holder`, async () => {
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      let firstDone!: () => void;
      const firstWorkDone = new Promise<void>((res) => { firstDone = res; });

      const first = adminSave(commitAfter(db, gate, firstDone), B, fieldName, value);
      await firstWorkDone; // B's save has checked and written, and holds its transaction open
      const second = adminSave(dbB, C, fieldName, value);
      const state = await secondWriterBlockedOr(second);
      release();
      const [r1, r2] = await Promise.all([first, second.catch((e: Error) => ({ kind: 'THREW', reason: e.message }))]);

      expect(r1.kind).toBe('OK');
      expect(r2.kind).toBe('INVALID');
      expect((r2 as { reason: string }).reason).toContain(`already carried by another IPO: t-r1371-row-b`);
      expect((r2 as { reason: string }).reason).toContain(shown);
      expect(state).toBe('blocked');
      const col = fieldName === 'bseIpoNo' ? 'bse_ipo_no' : fieldName;
      const c = await db.execute(sql`SELECT ${sql.raw(col)}::text AS v FROM ipos WHERE id = ${C}::uuid`);
      expect((c as unknown as { rows: { v: string | null }[] }).rows[0].v).toBeNull();
    }, 60_000);
  }

  it('MINOR-2: the move never releases a SUPERSEDED key whose reason is not an admin edit (OD-83 relaunch)', async () => {
    const [od83] = await db.insert(schema.ipoSourceKeys).values({
      ipoId: C, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91372', bindingValue: '91372',
      state: 'SUPERSEDED', stateReason: 'OD-83 relaunch: a new offering took this record', boundVia: 'BACKFILL', boundBy: 'test',
    } as never).returning({ id: schema.ipoSourceKeys.id });
    const [adminRemoved] = await db.insert(schema.ipoSourceKeys).values({
      ipoId: KEEP, source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '91373', bindingValue: '91373',
      state: 'SUPERSEDED', stateReason: 'admin_edit: bseIpoNo 91373 -> (empty) by race1371-admin', boundVia: 'BACKFILL', boundBy: 'test',
    } as never).returning({ id: schema.ipoSourceKeys.id });

    const moved = await db.transaction(async (tx) =>
      moveAdminRemovedCopies(tx as never, { ipoId: B, fieldName: 'bseIpoNo', oldValue: null, newValue: 91372, adminId: 'a', adminName: 'race1371-admin' }, '91372', 't-r1371-row-b'));
    expect(moved).toEqual([]);
    const [kept] = await db.select().from(schema.ipoSourceKeys).where(eq(schema.ipoSourceKeys.id, od83.id));
    expect(kept).toMatchObject({ state: 'SUPERSEDED', bindingValue: '91372' });

    // control: the admin-removed copy of another value IS released by the same call shape
    const movedControl = await db.transaction(async (tx) =>
      moveAdminRemovedCopies(tx as never, { ipoId: B, fieldName: 'bseIpoNo', oldValue: null, newValue: 91373, adminId: 'a', adminName: 'race1371-admin' }, '91373', 't-r1371-row-b'));
    expect(movedControl).toEqual([expect.objectContaining({ fromIpoId: KEEP, releasedKeyIds: [adminRemoved.id] })]);
  });
});
