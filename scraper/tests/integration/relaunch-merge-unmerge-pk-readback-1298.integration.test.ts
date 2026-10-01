/**
 * #1298 round 3 (PR #1425 re-review) on the real database (ipodhan_test only):
 *  - MINOR-1: the unmerge looks child rows up by the table's PRIMARY KEY with a typed comparison, so
 *    field_sources is reached by an index, not a Seq Scan over `to_jsonb(t.*) ->> 'id'` (EXPLAIN probe);
 *  - MINOR-2: a survivor with a row in a table whose primary key is not `id` (closed_ipo_resourcing,
 *    key ipo_id) merges, and an unmerge restores such a row from a logged delta keyed by that key;
 *  - MINOR-3: the read-back check fires (rollback + the row named) when a restored row does not read back
 *    equal to the logged one.
 *
 *   npx vitest run --config vitest.integration.config.ts tests/integration/relaunch-merge-unmerge-pk-readback-1298.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, cleanupTestDb } from '../test-utils/db';
// Relative imports, not the `@ipodhan/shared` alias (a worktree's junctions can resolve it to main).
import { IPORepository } from '../../../packages/shared/src/repositories';
import { writeAdminFieldValue, readAdminFieldVersion } from '../../../packages/shared/src/services/admin-field-write';
import { readPostponedRelaunchState } from '../../../packages/shared/src/services/relaunch-admin-clear';

const DATABASE_URL = process.env.DATABASE_URL;
const OLD = '00000000-0000-4000-8000-00000000a9f1'; // the older, postponed record (the survivor)
const NEW = '00000000-0000-4000-8000-00000000a9f2'; // the newer relaunch record (merged away)
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
      VALUES (${id}::uuid, 'Unmerge Pk 1298 Seeds Ltd', ${slug}, 'UPCOMING', 'SME', 'IPO', 'UNMPK1298', '["BSE"]', ${size}, ${lot},
              ${postponed ? 10 : null}, ${open}, 95, 99)`);
    await db.execute(sql`
      INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
      VALUES (${id}::uuid, 'ipos', '', 'issueSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days'),
             (${id}::uuid, 'ipos', '', 'lotSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
    await repo.bindSourceKeys(id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed } }] as never, {
      boundVia: 'BACKFILL', boundBy: 'issue1298.r3.test',
    } as never);
  };
  await mk(OLD, 'unmerge-pk-1298', '2026-06-23', '98795', 267300000, 1200, true);
  await mk(NEW, 'unmerge-pk-1298-o', '2026-08-19', '98901', null, 1000, false);

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

let isRelaunchDocumentField: any;

describe.skipIf(!DATABASE_URL)('#1298 round 3: primary-key row identity and the unmerge read-back (ipodhan_test)', () => {
  beforeAll(async () => {
    ({ isRelaunchDocumentField } = await import('../../src/services/relaunch-clear'));
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

  it('MINOR-1: a typed primary-key lookup is an index scan on field_sources; the to_jsonb(t.*) ->> id form is a Seq Scan', async () => {
    const plan = async (q: ReturnType<typeof sql>) => {
      let text = '';
      await db.transaction(async (tx: any) => {
        await tx.execute(sql`SET LOCAL enable_seqscan = off`);
        text = rows(await tx.execute(q)).map((r: any) => r['QUERY PLAN']).join(String.fromCharCode(10));
      });
      return text;
    };
    const id = '00000000-0000-4000-8000-00000000a9f0';
    const oldForm = await plan(sql`EXPLAIN SELECT 1 FROM field_sources t WHERE (to_jsonb(t.*) ->> 'id') = ${id}`);
    const newForm = await plan(sql`EXPLAIN SELECT 1 FROM field_sources t, jsonb_populate_record(null::field_sources, ${JSON.stringify({ id })}::jsonb) r WHERE t.id = r.id`);
    console.log(['EXPLAIN old form:', oldForm, 'EXPLAIN new form:', newForm].join(String.fromCharCode(10)));
    expect(oldForm).toMatch(/Seq Scan on field_sources/);
    expect(newForm).not.toMatch(/Seq Scan on field_sources/);
    expect(newForm).toMatch(/Index (Only )?Scan using \w+ on field_sources/);
  });

  it('MINOR-2: a survivor with a closed_ipo_resourcing row (primary key ipo_id, no id column) merges, and a logged delta keyed by ipo_id unmerges exactly', async () => {
    await cleanup();
    const repo = new IPORepository(db as never, noRedis);
    await seedPair(repo);
    await db.execute(sql`INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, resourced_at_version)
                         VALUES (${OLD}::uuid, now() - interval '3 days', now() - interval '2 days', 2, 'PARTIAL', 'v-test')`);
    const cirBefore = async () =>
      rows(await db.execute(sql`SELECT to_jsonb(c.*)::text AS r FROM closed_ipo_resourcing c WHERE ipo_id = ${OLD}::uuid`))[0].r as string;
    const original = await cirBefore();
    // Before the fix the capture refused here: "closed_ipo_resourcing has no id column".
    await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.r3.test', isRelaunchDocumentField });
    expect(await cirBefore()).toBe(original);

    // Simulate a step that changed that row: the live row now holds the "after" and the log holds a delta
    // keyed by the table's real primary key.
    await db.execute(sql`UPDATE closed_ipo_resourcing SET attempts = 9 WHERE ipo_id = ${OLD}::uuid`);
    const changed = await cirBefore();
    const mergeId = await mergeIdOf();
    await db.execute(sql`
      UPDATE ipo_merge_log SET restore_data = jsonb_set(restore_data, '{relaunchDelta}',
        restore_data->'relaunchDelta' || jsonb_build_array(jsonb_build_object(
          'table', 'closed_ipo_resourcing', 'pk', jsonb_build_array('ipo_id'),
          'deleted', '[]'::jsonb, 'inserted', '[]'::jsonb,
          'updated', jsonb_build_array(jsonb_build_object('before', ${original}::jsonb, 'after', ${changed}::jsonb)))))
      WHERE id = ${mergeId}::uuid`);
    const out = await repo.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'issue1298.r3.test' });
    expect(out.applied).toBe(true);
    expect(await cirBefore()).toBe(original);
  }, 180_000);

  it('MINOR-3: when a restored row does not read back equal, the unmerge rolls back and names the row', async () => {
    await cleanup();
    const repo = new IPORepository(db as never, noRedis);
    await seedPair(repo);
    await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.r3.test', isRelaunchDocumentField });
    const mergeId = await mergeIdOf();
    const promoterId = rows(await db.execute(sql`
      SELECT e->>'id' AS id FROM ipo_merge_log l, jsonb_array_elements(l.restore_data->'relaunchDelta') d,
             jsonb_array_elements(d->'deleted') e WHERE l.id = ${mergeId}::uuid AND d->>'table' = 'promoters'`))[0].id as string;
    // promoters.waca is numeric(18,2): the logged 1.2345 is stored as 1.23, so the row reads back different.
    await db.execute(sql`
      UPDATE ipo_merge_log SET restore_data = jsonb_set(restore_data, '{relaunchDelta}',
        (SELECT jsonb_agg(CASE WHEN d->>'table' = 'promoters' THEN jsonb_set(d, '{deleted,0,waca}', '1.2345'::jsonb) ELSE d END)
           FROM jsonb_array_elements(restore_data->'relaunchDelta') d))
      WHERE id = ${mergeId}::uuid`);
    const snap = await snapshot();
    await expect(repo.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'issue1298.r3.test' })).rejects.toThrow(
      `promoters rows changed by the relaunch clear did not restore exactly (${promoterId}) — rolled back`
    );
    expect(await snapshot()).toEqual(snap);
    expect(rows(await db.execute(sql`SELECT count(*)::int AS n FROM ipos WHERE id = ${NEW}::uuid`))[0].n).toBe(0);
    expect(rows(await db.execute(sql`SELECT count(*)::int AS n FROM ipo_merge_log WHERE id = ${mergeId}::uuid AND unmerged_at IS NOT NULL`))[0].n).toBe(0);
  }, 180_000);
});
