/**
 * #1298 round 2 (OD-92 "a merge log ... the rows themselves"; "every automatic merge is reversible";
 * "the unmerge restores all of it") on the real database (ipodhan_test only).
 *
 * An OD-86 relaunch merge of a POSTPONED survivor runs the §2.9 relaunch clear inside the merge
 * transaction. Besides the `ipos` columns it empties, the clear deletes admin holds (OD-116/OD-151) and
 * their provenance, deletes the old offer's document lists and their provenance, empties one-row child
 * values, writes the `Relaunch Filing` / `Relaunch Cleared` audit marks (which make a POSTPONED IPO read
 * RELAUNCHED), re-asks plan rows and reopens document-fetch rows. The unmerge must put every one of these
 * back exactly as it was before the merge, and refuse when one of them changed after the merge.
 *
 *   npx vitest run --config vitest.integration.config.ts tests/integration/relaunch-merge-unmerge-restores-clear-1298.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
// Relative imports, not the `@ipodhan/shared` alias (a worktree's junctions can resolve it to main).
import { IPORepository } from '../../../packages/shared/src/repositories';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { readPostponedRelaunchState } from '../../../packages/shared/src/services/relaunch-admin-clear';

const DATABASE_URL = process.env.DATABASE_URL;
const OLD = '00000000-0000-4000-8000-00000000a9e1'; // the older, postponed record (the survivor)
const NEW = '00000000-0000-4000-8000-00000000a9e2'; // the newer relaunch record (merged away)
const actor = { name: 'Issue1298 Round2 Admin', adminId: 'issue1298-r2-admin' };
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;
let db: any;
const rows = (r: any) => (r.rows ?? r) as any[];
const tick = () => new Promise((r) => setTimeout(r, 25));

/** Every survivor child table the clear can change, grouped by the part of the fix that restores it. */
const PARTS: Record<string, string[]> = {
  hold: ['field_protection_metadata'],
  auditMarks: ['audit_logs'],
  lists: ['promoters', 'peer_companies', 'ipo_intermediaries', 'ipo_risk_factors', 'financial_statements'],
  oneRowChildValues: ['ipo_details', 'financial_data'],
  planState: ['ipo_field_plan', 'document_fetch_state'],
  provenance: ['field_sources'],
  sourceKeys: ['ipo_source_keys'],
};
const ALL_TABLES = Object.values(PARTS).flat();

const survivorRow = async () =>
  rows(await db.execute(sql`SELECT to_jsonb(i.*) - 'updated_at' AS r FROM ipos i WHERE id = ${OLD}::uuid`))[0].r as Record<string, unknown>;
/** The survivor's rows in one table, whole (jsonb text, ordered by id) - exact values, not a count. */
const tableRows = async (table: string) =>
  rows(await db.execute(sql`
    SELECT coalesce(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)::text AS r
      FROM ${sql.identifier(table)} t WHERE t.ipo_id = ${OLD}::uuid`))[0].r as string;
const snapshot = async () => {
  const out: Record<string, string> = {};
  for (const t of ALL_TABLES) out[t] = await tableRows(t);
  return out;
};

async function adminWrite(tableName: string, fieldName: string, value: string) {
  const v = await readAdminFieldVersion(db as never, OLD, tableName, fieldName);
  const res = await writeAdminFieldValue(db as never, {
    ipoId: OLD, tableName, fieldName, value,
    mode: { kind: 'typed', sourceNote: 'RHP p.9 (#1298 round 2 test)' },
    overrideReason: '#1298 round 2 test value', expectedVersion: v!.version, actor, entryPoint: 'issue1298-r2-test',
  });
  expect(res.kind, JSON.stringify(res)).toBe('OK');
}

async function cleanup() {
  for (const id of [OLD, NEW]) {
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id = ${id}::uuid OR drop_ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
  }
}

async function seedPair(repo: IPORepository) {
  const mk = async (id: string, slug: string, open: string, ipoNo: string, size: number | null, lot: number, postponed: boolean) => {
    await db.execute(sql`
      INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, symbol, listing_exchanges, issue_size, lot_size,
                        face_value, open_date, price_range_min, price_range_max)
      VALUES (${id}::uuid, 'Unmerge Clear 1298 Seeds Ltd', ${slug}, 'UPCOMING', 'SME', 'IPO', 'UNMCL1298', '["BSE"]', ${size}, ${lot},
              ${postponed ? 10 : null}, ${open}, 95, 99)`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${id}::uuid, 'ipos', '', 'issueSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days'),
             (${id}::uuid, 'ipos', '', 'lotSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
    await repo.bindSourceKeys(id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed } }] as never, {
      boundVia: 'BACKFILL', boundBy: 'issue1298.r2.test',
    } as never);
  };
  await mk(OLD, 'unmerge-clear-1298', '2026-06-23', '98795', 267300000, 1200, true);
  await mk(NEW, 'unmerge-clear-1298-o', '2026-08-19', '98901', null, 1000, false);

  // Admin holds (OD-116 / OD-151): an `ipos` column and a one-row child column.
  await adminWrite('ipos', 'faceValue', '10');
  await db.execute(sql`INSERT INTO ipo_details (ipo_id, data_source) VALUES (${OLD}::uuid, 'DRHP')`);
  await adminWrite('ipo_details', 'freshIssue', '267300000');
  // A non-admin one-row child value from the old offer document.
  await db.execute(sql`INSERT INTO financial_data (ipo_id, revenue_fy2024) VALUES (${OLD}::uuid, 123.45)`);
  // The old offer's document lists, each with DRHP provenance, read 10 days ago.
  const old = sql`now() - interval '10 days'`;
  await db.execute(sql`INSERT INTO promoters (ipo_id, name, normalized_name, created_at, updated_at)
                       VALUES (${OLD}::uuid, 'Old Offer Promoter', 'old offer promoter', ${old}, ${old})`);
  await db.execute(sql`INSERT INTO peer_companies (ipo_id, company_name, normalized_name, is_listed, created_at)
                       VALUES (${OLD}::uuid, 'Old Peer Ltd', 'old peer', true, ${old})`);
  await db.execute(sql`INSERT INTO ipo_intermediaries (ipo_id, role, name, normalized_name, created_at, updated_at)
                       VALUES (${OLD}::uuid, 'BRLM', 'Old Lead Manager', 'old lead manager', ${old}, ${old})`);
  await db.execute(sql`INSERT INTO ipo_risk_factors (ipo_id, seq, heading, created_at, updated_at)
                       VALUES (${OLD}::uuid, 1, 'Old offer risk', ${old}, ${old})`);
  await db.execute(sql`INSERT INTO financial_statements (ipo_id, fiscal_year, basis, unit, created_at, updated_at)
                       VALUES (${OLD}::uuid, 2024, 'RESTATED', 'LAKH', ${old}, ${old})`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
    VALUES (${OLD}::uuid, 'financial_data', '', 'revenueFy2024', 'DRHP', 95, ${old}, ${old}),
           (${OLD}::uuid, 'promoters', 'old offer promoter', 'name', 'DRHP', 95, ${old}, ${old}),
           (${OLD}::uuid, 'peer_companies', 'old peer', 'companyName', 'DRHP', 95, ${old}, ${old}),
           (${OLD}::uuid, 'ipo_intermediaries', 'BRLM|old lead manager', 'name', 'DRHP', 95, ${old}, ${old}),
           (${OLD}::uuid, 'ipo_risk_factors', '1', 'heading', 'DRHP', 95, ${old}, ${old}),
           (${OLD}::uuid, 'financial_statements', '2024|RESTATED', 'unit', 'DRHP', 95, ${old}, ${old})`);
  // Plan rows the clear re-asks, and document-fetch rows it reopens.
  for (const [t, f] of [['ipos', 'issueSize'], ['ipos', 'lotSize'], ['ipos', 'faceValue'], ['financial_data', 'revenueFy2024'], ['promoters', 'name']]) {
    await db.execute(sql`
      INSERT INTO ipo_field_plan (ipo_id, table_name, row_key, field_name, state, manifest_version)
      VALUES (${OLD}::uuid, ${t}, '', ${f}, 'SUPPLIED', 1)
      ON CONFLICT DO NOTHING`);
  }
  await db.execute(sql`
    INSERT INTO document_fetch_state (ipo_id, doc_type, state, attempts, first_seen_at)
    VALUES (${OLD}::uuid, 'RHP', 'EXTRACTED', 2, ${old}), (${OLD}::uuid, 'DRHP', 'NOT_APPLICABLE', 1, ${old})`);

  // The exchange marks the survivor POSTPONED now (postponed_at is stamped by the status write).
  await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${OLD}::uuid`);
  await db.execute(sql`
    INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
    VALUES (${OLD}::uuid, 'ipos', '', 'status', 'BSE', now())
    ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE SET source = 'BSE', updated_at = now()`);
  await tick();
}

const mergeIdOf = async () =>
  rows(await db.execute(sql`SELECT id FROM ipo_merge_log WHERE drop_ipo_id = ${NEW}::uuid AND unmerged_at IS NULL`))[0].id as string;

describe.skipIf(!DATABASE_URL)('#1298 round 2: unmerge of an OD-86 relaunch merge restores everything the relaunch clear changed (ipodhan_test)', () => {
  beforeAll(async () => {
    db = await getTestDb();
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (!db) return;
    await cleanup();
    await cleanupTestDb();
  }, 60_000);

  it('merge -> unmerge: the survivor row and every child row the clear touched equal their pre-merge state exactly', async () => {
    await cleanup();
    const repo = new IPORepository(db as never, noRedis);
    await seedPair(repo);
    const rowBefore = await survivorRow();
    const before = await snapshot();
    const stateBefore = await readPostponedRelaunchState(db as never, OLD);
    expect(stateBefore).toBe('NO_RELAUNCH');

    const { isRelaunchDocumentField } = await import('../../src/services/relaunch-clear');
    const res = await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.r2.test', isRelaunchDocumentField });
    // The clear ran and changed every part this test restores (otherwise the restore proves nothing).
    expect(res.relaunchCleared?.cleared.map((c) => `${c.tableName}.${c.fieldName}`).sort()).toEqual(['ipo_details.freshIssue', 'ipos.faceValue']);
    const merged = await snapshot();
    for (const [part, tables] of Object.entries(PARTS)) {
      if (part === 'sourceKeys') continue;
      expect(tables.some((t) => merged[t] !== before[t]), `the merge changed ${part}`).toBe(true);
    }
    expect(await readPostponedRelaunchState(db as never, OLD)).toBe('RELAUNCHED');

    // The refill's log entry carries the source it was written with, not ADMIN/100 (round 1 MINOR-6).
    const logged = rows(await db.execute(sql`
      SELECT p->>'column' AS c, p->>'source' AS s, (p->>'confidence')::int AS n FROM ipo_merge_log l,
             jsonb_array_elements(l.survivor_patch->'patch') p WHERE l.drop_ipo_id = ${NEW}::uuid ORDER BY 1`));
    expect(logged).toEqual([
      { c: 'face_value', s: 'RELAUNCH_CLEAR', n: 0 },
      { c: 'issue_size', s: 'RELAUNCH_CLEAR', n: 0 },
      { c: 'lot_size', s: 'DRHP', n: 95 },
    ]);

    const out = await repo.unmergeDuplicate(await mergeIdOf(), { apply: true, unmergedBy: 'issue1298.r2.test' });
    expect(out.applied).toBe(true);

    const after = await snapshot();
    for (const [part, tables] of Object.entries(PARTS)) {
      for (const t of tables) expect(after[t], `${part}: ${t} restored exactly`).toBe(before[t]);
    }
    expect(await survivorRow()).toEqual(rowBefore);
    expect(await readPostponedRelaunchState(db as never, OLD)).toBe(stateBefore);
  }, 180_000);

  it('refuses (nothing written) when a row the clear changed was changed again after the merge, and names it', async () => {
    await cleanup();
    const repo = new IPORepository(db as never, noRedis);
    await seedPair(repo);
    const { isRelaunchDocumentField } = await import('../../src/services/relaunch-clear');
    await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.r2.test', isRelaunchDocumentField });
    // A scraper answers a re-asked one-row child value the clear emptied (financial_data.revenue_fy2024).
    await db.execute(sql`UPDATE financial_data SET revenue_fy2024 = 999.99 WHERE ipo_id = ${OLD}::uuid`);
    const fdId = rows(await db.execute(sql`SELECT id::text AS id FROM financial_data WHERE ipo_id = ${OLD}::uuid`))[0].id as string;
    const mergeId = await mergeIdOf();
    const snap = await snapshot();
    await expect(repo.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'issue1298.r2.test' })).rejects.toThrow(
      new RegExp(`relaunch:financial_data:${fdId}`)
    );
    expect(await snapshot()).toEqual(snap);
    expect(rows(await db.execute(sql`SELECT count(*)::int AS n FROM ipos WHERE id = ${NEW}::uuid`))[0].n).toBe(0);

    // A hold the clear deleted that an admin set again after the merge: re-inserting the old one would
    // collide, so the unmerge refuses even with the drift forced.
    await adminWrite('ipo_details', 'freshIssue', '1');
    const idId = rows(await db.execute(sql`SELECT id::text AS id FROM ipo_details WHERE ipo_id = ${OLD}::uuid`))[0].id as string;
    const snap2 = await snapshot();
    await expect(
      repo.unmergeDuplicate(mergeId, {
        apply: true, unmergedBy: 'issue1298.r2.test',
        forceFields: [`relaunch:financial_data:${fdId}`, `relaunch:ipo_details:${idId}`],
      })
    ).rejects.toThrow(/refused: field_protection_metadata/);
    expect(await snapshot()).toEqual(snap2);
  }, 180_000);
});
