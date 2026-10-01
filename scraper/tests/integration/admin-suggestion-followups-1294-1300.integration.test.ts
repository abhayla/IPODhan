import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, and, eq, inArray } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { writeAdminListChange, readAdminList, ADMIN_LIST_SUGGESTION_REASON, type AdminListChangeInput } from '@ipodhan/shared/services/admin-list-write';
import { recordListSuggestion } from '@ipodhan/shared/services/admin-list-hold';
import { writeAdminFieldValue, readAdminFieldVersion } from '@ipodhan/shared/services/admin-field-write';
import { ACCEPTED_BY_ADMIN_EDIT } from '@ipodhan/shared/services/suggestion-admin-save-close';
import { NEWER_DOCUMENT_ORIGIN, CORRIGENDUM_DISMISSED } from '@ipodhan/shared/services/corrigendum-suggestions';

/**
 * #1300 (rest) and #1294 item 2, spec §9.2 items 8, 9 and 25 (clarified 2026-10-01), through the
 * REAL admin writes on ipodhan_test:
 *  - an OPEN document suggestion closes (ACCEPTED_BY_ADMIN_EDIT) only when the admin saves the
 *    field to the value it proposes; another save leaves it open; a dismissed one is never touched.
 *  - an OPEN list suggestion is recomputed against the admin's CURRENT list when the admin edits
 *    the list, and closes when the document's list now equals the admin's; its key never changes,
 *    so a dismissed list suggestion for the same document list never returns.
 *
 *   cd scraper && npx vitest run -c vitest.integration.config.ts tests/integration/admin-suggestion-followups-1294-1300.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = '00000000-0000-4000-8130-000000001300';
const actor = { name: 'fu1300-admin', adminId: 'admin-fu1300' };

let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function cleanup() {
  await db.delete(schema.auditLogs).where(inArray(schema.auditLogs.ipoId, [IPO]));
  await db.delete(schema.dataConflicts).where(inArray(schema.dataConflicts.ipoId, [IPO]));
  await db.delete(schema.fieldSources).where(inArray(schema.fieldSources.ipoId, [IPO]));
  await db.delete(schema.fieldProtectionMetadata).where(inArray(schema.fieldProtectionMetadata.ipoId, [IPO]));
  await db.execute(sql`DELETE FROM promoters WHERE ipo_id = ${IPO}::uuid`);
  await db.execute(sql`DELETE FROM ipos WHERE id = ${IPO}::uuid`);
}

async function saveLotSize(value: number) {
  const v = await readAdminFieldVersion(db as never, IPO, 'ipos', 'lotSize');
  return writeAdminFieldValue(db as never, {
    ipoId: IPO, tableName: 'ipos', fieldName: 'lotSize', value,
    mode: { kind: 'typed', sourceNote: 'RHP page 3' }, expectedVersion: v!.version,
    overrideReason: 'test fixture', actor, entryPoint: 'test',
  });
}

async function suggest(key: string, value2: string, resolved?: { reason: string }) {
  const [row] = await db.insert(schema.dataConflicts).values({
    ipoId: IPO, tableName: 'ipos', rowKey: '', fieldName: 'lotSize', source1: 'ADMIN', value1: '100', source2: 'DRHP', value2,
    severity: 'WARNING', resolutionReason: resolved?.reason ?? null, suggestionKey: key,
    evidence: { origin: NEWER_DOCUMENT_ORIGIN, page: null },
    ...(resolved ? { resolvedAt: new Date(), resolvedBy: 'earlier-admin' } : {}),
  } as never).returning();
  return row as { id: string };
}

const conflict = async (id: string) => (await db.select().from(schema.dataConflicts).where(eq(schema.dataConflicts.id, id)))[0];

async function adminList(op: AdminListChangeInput['op']) {
  const { version } = await readAdminList(db as never, IPO, 'promoters');
  return writeAdminListChange(db as never, { ipoId: IPO, list: 'promoters', op, actor, entryPoint: 'test', expectedVersion: version } as AdminListChangeInput);
}

async function listSuggestion(names: string[]) {
  const stored = (await readAdminList(db as never, IPO, 'promoters')).rows.map((r) => r.row);
  return db.transaction(async (tx) =>
    recordListSuggestion(tx as never, { ipoId: IPO, list: 'promoters', source: 'DRHP', stored, incoming: names.map((name) => ({ name })) })
  );
}

const listRows = () =>
  db.select().from(schema.dataConflicts)
    .where(and(eq(schema.dataConflicts.ipoId, IPO), eq(schema.dataConflicts.resolutionReason, ADMIN_LIST_SUGGESTION_REASON)));

describe.skipIf(!DATABASE_URL)('#1300 / #1294 item 2: suggestions follow the admin save and the admin list (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (db) await cleanup();
    await pool?.end();
  }, 60_000);
  beforeEach(async () => {
    await cleanup();
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, category, status, offering_type, segment, open_date, lot_size)
      VALUES (${IPO}::uuid, 'Followup1300 Proof Limited', 'followup1300-proof-limited', 'MAINBOARD', 'UPCOMING', 'IPO', 'MAINBOARD', '2026-10-10', 100)`);
  }, 60_000);

  it('#1300: a save of a DIFFERENT value leaves the open suggestion open', async () => {
    const s150 = await suggest('fu1300-a', '150');
    expect((await saveLotSize(170)).kind).toBe('OK');
    expect(await conflict(s150.id)).toMatchObject({ resolvedAt: null, resolutionReason: null });
  });

  it('#1300: a save EQUAL to the proposed value closes that suggestion only (ACCEPTED_BY_ADMIN_EDIT); a dismissed one is untouched', async () => {
    const s150 = await suggest('fu1300-b', '150');
    const s160 = await suggest('fu1300-c', '160');
    const dismissed = await suggest('fu1300-d', '150', { reason: CORRIGENDUM_DISMISSED });
    const before = await conflict(dismissed.id);
    expect((await saveLotSize(150)).kind).toBe('OK');
    expect(await conflict(s150.id)).toMatchObject({ resolutionReason: ACCEPTED_BY_ADMIN_EDIT, resolvedBy: 'fu1300-admin', resolvedSource: 'ADMIN' });
    expect((await conflict(s150.id)).resolvedAt).not.toBeNull();
    expect(await conflict(s160.id)).toMatchObject({ resolvedAt: null, resolutionReason: null });
    expect(await conflict(dismissed.id)).toMatchObject({ resolutionReason: CORRIGENDUM_DISMISSED, resolvedBy: 'earlier-admin', resolvedAt: before.resolvedAt });
  });

  it('#1294 item 2: an admin edit recomputes an open list suggestion (rows left to add), and closes it when the lists are equal', async () => {
    expect((await adminList({ kind: 'add', row: { name: 'Alpha Promoter' } })).kind).toBe('OK');
    expect((await listSuggestion(['Alpha Promoter', 'Beta Promoter', 'Gamma Promoter'])).recorded).toBe(true);
    const [open] = await listRows();
    expect(open.evidence).toMatchObject({ add: ['Beta Promoter', 'Gamma Promoter'], remove: [] });

    expect((await adminList({ kind: 'add', row: { name: 'Beta Promoter' } })).kind).toBe('OK');
    const [afterOne] = await listRows();
    expect(afterOne.id).toBe(open.id);
    expect(afterOne.suggestionKey).toBe(open.suggestionKey);
    expect(afterOne.resolvedAt).toBeNull();
    expect(afterOne.evidence).toMatchObject({ add: ['Gamma Promoter'], remove: [] });
    expect(JSON.parse(afterOne.value1!)).toEqual(['Alpha Promoter', 'Beta Promoter']);

    expect((await adminList({ kind: 'add', row: { name: 'Gamma Promoter' } })).kind).toBe('OK');
    const [closed] = await listRows();
    expect(closed.resolvedAt).not.toBeNull();
    expect(closed.resolvedBy).toBe('fu1300-admin');
    expect(closed.evidence).toMatchObject({ add: [], remove: [], closedBecause: 'ADMIN_LIST_NOW_EQUAL' });
  });

  it('#1294 item 2 + item 25: a DISMISSED list suggestion is never recomputed and the same document list never returns it', async () => {
    expect((await adminList({ kind: 'add', row: { name: 'Alpha Promoter' } })).kind).toBe('OK');
    expect((await listSuggestion(['Alpha Promoter', 'Beta Promoter'])).recorded).toBe(true);
    const [row] = await listRows();
    await db.update(schema.dataConflicts).set({ resolvedAt: new Date(), resolvedBy: 'earlier-admin' } as never).where(eq(schema.dataConflicts.id, row.id));
    const dismissed = await conflict(row.id);
    // the admin's list changes; the dismissed row is not touched
    expect((await adminList({ kind: 'add', row: { name: 'Delta Promoter' } })).kind).toBe('OK');
    expect(await conflict(row.id)).toMatchObject({ value1: dismissed.value1, evidence: dismissed.evidence, resolvedBy: 'earlier-admin' });
    // the same document list read again records nothing new (same key)
    expect((await listSuggestion(['Alpha Promoter', 'Beta Promoter'])).recorded).toBe(false);
    expect(await listRows()).toHaveLength(1);
  });
});
