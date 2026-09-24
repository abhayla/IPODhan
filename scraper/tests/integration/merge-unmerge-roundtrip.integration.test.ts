import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared';

/**
 * Item 19 / OD-92 (spec §2.3.3.3: "a merge log, not a diff ... the rows themselves"; "`unmerge
 * <merge-id>`: it restores both rows from the log and re-points the slug redirect"): merge then
 * unmerge through the REAL `IPORepository.mergeDuplicateInto` / `unmergeDuplicate` against real
 * Postgres, and compare every affected table row by row with a snapshot taken before the merge.
 *
 * The fixture covers the classes a merge removes or changes: scraper-derived children (gmp_records
 * history, subscriptions, ipo_field_plan, data_conflicts, field_sources), a document with a page
 * (removed by an FK CASCADE from documents, one level below the ipos child), a conflict row tied to
 * that document, a survivor-side document_fetch_state row whose document_id a SET NULL cascade
 * clears, person-created rows (audit_logs, ipo_source_keys) that are repointed, carried columns
 * on the survivor, and an OD-86 relaunch merge whose older source key is superseded.
 *
 * SKIPS CLEANLY when no DATABASE_URL is set. Run from `scraper/`:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/merge-unmerge-roundtrip.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const K = '00000000-0000-4000-9920-0000000000a1';
const D = '00000000-0000-4000-9920-0000000000a2';
const DOC = '00000000-0000-4000-9920-0000000000d1';
const SLUG_PREFIX = 't-unmerge-';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

const CHILD_TABLES = [
  'gmp_records',
  'subscriptions',
  'ipo_field_plan',
  'data_conflicts',
  'field_sources',
  'documents',
  'document_fetch_state',
  'audit_logs',
  'ipo_source_keys',
  'ipo_slug_redirects',
];

async function pairIds(): Promise<string[]> {
  const r = await pool!.query(`SELECT id::text FROM ipos WHERE slug LIKE $1`, [`${SLUG_PREFIX}%`]);
  return [...new Set([K, D, ...r.rows.map((x) => x.id as string)])];
}

async function cleanup() {
  const ids = await pairIds();
  await pool!.query(`DELETE FROM ipo_merge_log WHERE drop_ipo_id = ANY($1::uuid[]) OR keep_ipo_id = ANY($1::uuid[])`, [ids]);
  await pool!.query(`DELETE FROM audit_logs WHERE ipo_id = ANY($1::uuid[])`, [ids]);
  await pool!.query(`DELETE FROM ipos WHERE id = ANY($1::uuid[])`, [ids]);
}

/** Every row of every affected table for the given IPO ids, as sorted to_jsonb text per table. */
async function snapshot(ids: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  const q = async (name: string, text: string, params: unknown[]) => {
    const r = await pool!.query(text, params);
    out[name] = r.rows.map((x) => x.row as string).sort();
  };
  await q('ipos', `SELECT to_jsonb(t.*)::text AS row FROM ipos t WHERE id = ANY($1::uuid[])`, [ids]);
  for (const t of CHILD_TABLES) {
    await q(t, `SELECT to_jsonb(t.*)::text AS row FROM ${t} t WHERE ipo_id = ANY($1::uuid[])`, [ids]);
  }
  await q(
    'document_pages',
    `SELECT to_jsonb(p.*)::text AS row FROM document_pages p JOIN documents d ON d.id = p.document_id WHERE d.ipo_id = ANY($1::uuid[])`,
    [ids]
  );
  return out;
}

async function plantPair() {
  await pool!.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date, issue_size, face_value, cin)
     VALUES ($1, 'Unmerge Proof Company (India) Limited', $3, 'IPO', 'MAINBOARD', 'CLOSED', '2026-08-03', '2026-08-05', 4500000000.00, NULL, NULL),
            ($2, 'Unmerge Proof Co. (India) Ltd',          $4, 'IPO', 'MAINBOARD', 'CLOSED', '2026-08-03', '2026-08-05', 4500000000.00, 10.00, 'U65999MH2002PLC138246')`,
    [K, D, `${SLUG_PREFIX}keep`, `${SLUG_PREFIX}drop`]
  );
  // scraper-derived history on the row the merge removes
  for (const [i, gmp] of [45, 52, 61].entries()) {
    await pool!.query(`INSERT INTO gmp_records (ipo_id, source, timestamp, gmp) VALUES ($1, 'INVESTORGAIN', $2, $3)`, [
      D,
      `2026-08-0${i + 1}T10:00:00Z`,
      gmp,
    ]);
  }
  await pool!.query(`INSERT INTO subscriptions (ipo_id, timestamp) VALUES ($1, '2026-08-05T17:00:00Z')`, [D]);
  await pool!.query(
    `INSERT INTO documents (id, ipo_id, title, type, url) VALUES ($1, $2, 'Red Herring Prospectus', 'RHP', 'https://example.invalid/unmerge-proof-rhp.pdf')`,
    [DOC, D]
  );
  await pool!.query(`INSERT INTO document_pages (document_id, page_number, text) VALUES ($1, 1, 'page one'), ($1, 2, 'page two')`, [DOC]);
  await pool!.query(
    `INSERT INTO data_conflicts (ipo_id, table_name, field_name, source1, source2) VALUES ($1, 'ipos', 'issue_size', 'NSE', 'BSE')`,
    [D]
  );
  // a conflict row on the SURVIVOR tied to the dropped row's document: removed by the documents CASCADE
  await pool!.query(
    `INSERT INTO data_conflicts (ipo_id, table_name, field_name, source1, source2, document_id) VALUES ($1, 'ipos', 'lot_size', 'NSE', 'BSE', $2)`,
    [K, DOC]
  );
  await pool!.query(
    `INSERT INTO ipo_field_plan (ipo_id, table_name, field_name, manifest_version, chosen_document_id) VALUES ($1, 'ipos', 'issue_size', 1, $2), ($1, 'ipos', 'lot_size', 1, NULL)`,
    [D, DOC]
  );
  await pool!.query(`INSERT INTO field_sources (ipo_id, table_name, field_name, source) VALUES ($1, 'ipos', 'faceValue', 'NSE'), ($1, 'ipos', 'cin', 'BSE')`, [D]);
  // a SURVIVOR-side row whose document_id points at the dropped row's document: SET NULL on merge
  await pool!.query(`INSERT INTO document_fetch_state (ipo_id, doc_type, document_id) VALUES ($1, 'RHP', $2)`, [K, DOC]);
  // person-created rows: repointed, not deleted
  await pool!.query(`INSERT INTO audit_logs (ipo_id, admin_user, action_type) VALUES ($1, 'unmerge.test', 'EDIT')`, [D]);
  await repo!.bindSourceKeys(D, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: '99201' }], {
    boundVia: 'BACKFILL',
    boundBy: 'unmerge.test',
  } as never);
}

async function mergeLogId(drop: string): Promise<string> {
  const r = await pool!.query(`SELECT id::text FROM ipo_merge_log WHERE drop_ipo_id = $1`, [drop]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0].id;
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  db = drizzle(pool, { schema });
  repo = new IPORepository(db as never, noRedis);
});
beforeEach(async () => {
  if (pool) await cleanup();
});
afterAll(async () => {
  if (pool) await cleanup();
  await pool?.end();
});

describe.skipIf(!DATABASE_URL)('OD-92 merge then unmerge restores every row exactly (ipodhan_test)', () => {
  it('round trip: 0-row diff over ipos, gmp history, documents + pages, conflicts, plan rows, provenance, keys, redirects', async () => {
    await plantPair();
    const before = await snapshot([K, D]);
    expect(before.gmp_records).toHaveLength(3);
    expect(before.document_pages).toHaveLength(2);

    await repo!.mergeDuplicateInto(K, D, { apply: true, mergedBy: 'unmerge.test' });
    const merged = await snapshot([K, D]);
    expect(merged.gmp_records).toHaveLength(0);
    expect(merged.document_pages).toHaveLength(0);
    const id = await mergeLogId(D);

    const dry = await repo!.unmergeDuplicate(id, { apply: false });
    expect(dry.applied).toBe(false);
    expect(dry.missing).toEqual([]);
    expect(await snapshot([K, D])).toEqual(merged);

    const res = await repo!.unmergeDuplicate(id, { apply: true, unmergedBy: 'unmerge.test' });
    expect(res.applied).toBe(true);
    const after = await snapshot([K, D]);
    for (const t of Object.keys(before)) expect({ table: t, rows: after[t] }).toEqual({ table: t, rows: before[t] });

    const log = await pool!.query(`SELECT unmerged_at, unmerged_by FROM ipo_merge_log WHERE id = $1`, [id]);
    expect(log.rows[0].unmerged_at).not.toBeNull();
    expect(log.rows[0].unmerged_by).toBe('unmerge.test');
  });

  it('a second unmerge of the same entry is refused', async () => {
    await plantPair();
    await repo!.mergeDuplicateInto(K, D, { apply: true, mergedBy: 'unmerge.test' });
    const id = await mergeLogId(D);
    await repo!.unmergeDuplicate(id, { apply: true, unmergedBy: 'unmerge.test' });
    await expect(repo!.unmergeDuplicate(id, { apply: true })).rejects.toThrow(/already unmerged/);
  });

  it('refuses when the survivor changed after the merge, unless the column is forced', async () => {
    await plantPair();
    await repo!.mergeDuplicateInto(K, D, { apply: true, mergedBy: 'unmerge.test' });
    const id = await mergeLogId(D);
    await pool!.query(`UPDATE ipos SET lot_size = 150 WHERE id = $1`, [K]);
    await expect(repo!.unmergeDuplicate(id, { apply: true })).rejects.toThrow(/changed after the merge in lot_size/);
    expect((await pool!.query(`SELECT count(*)::int n FROM ipos WHERE id = $1`, [D])).rows[0].n).toBe(0);
    const res = await repo!.unmergeDuplicate(id, { apply: true, forceFields: ['lot_size'] });
    expect(res.drift).toEqual(['lot_size']);
  });

  it('an entry logged before OD-92 is refused as partly reversible without --partial, and restores the rows with it', async () => {
    await plantPair();
    await repo!.mergeDuplicateInto(K, D, { apply: true, mergedBy: 'unmerge.test' });
    const id = await mergeLogId(D);
    await pool!.query(`UPDATE ipo_merge_log SET restore_data = NULL WHERE id = $1`, [id]);
    await expect(repo!.unmergeDuplicate(id, { apply: true })).rejects.toThrow(/partly reversible:.*gmp_records: 3 deleted row/);
    const res = await repo!.unmergeDuplicate(id, { apply: true, partial: true });
    expect(res.partial).toBe(true);
    const back = await pool!.query(`SELECT slug FROM ipos WHERE id = $1`, [D]);
    expect(back.rows[0].slug).toBe(`${SLUG_PREFIX}drop`);
    const redirect = await pool!.query(`SELECT count(*)::int n FROM ipo_slug_redirects WHERE old_slug = $1`, [`${SLUG_PREFIX}drop`]);
    expect(redirect.rows[0].n).toBe(0);
  });

  it('OD-86 relaunch merge round trip: the superseded older key goes back to ACTIVE with its original fields', async () => {
    const mk = async (slug: string, open: string, ipoNo: string) => {
      const [r] = await db!
        .insert(schema.ipos)
        .values({
          companyName: 'Unmerge Relaunch Seeds Ltd',
          slug,
          offeringType: 'IPO',
          segment: 'SME',
          status: 'UPCOMING',
          openDate: open,
          priceRangeMin: 95,
          priceRangeMax: 99,
          symbol: 'UNMRGRL',
        } as never)
        .returning();
      await repo!.bindSourceKeys(
        r.id,
        [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed: open < '2026-08-01' } }],
        { boundVia: 'BACKFILL', boundBy: 'unmerge.test' } as never
      );
      return r;
    };
    const older = await mk(`${SLUG_PREFIX}relaunch`, '2026-06-23', '99794');
    const newer = await mk(`${SLUG_PREFIX}relaunch-o`, '2026-08-19', '99900');
    const before = await snapshot([older.id, newer.id]);
    await repo!.mergeDuplicateInto(newer.id, older.id, { apply: true, mergedBy: 'unmerge.test' });
    const keys = await db!.select().from(schema.ipoSourceKeys).where(eq(schema.ipoSourceKeys.ipoId, newer.id));
    expect(keys.find((k) => k.keyValue === '99794')?.state).toBe('SUPERSEDED');
    const id = await mergeLogId(older.id);
    await repo!.unmergeDuplicate(id, { apply: true, unmergedBy: 'unmerge.test' });
    const after = await snapshot([older.id, newer.id]);
    for (const t of Object.keys(before)) expect({ table: t, rows: after[t] }).toEqual({ table: t, rows: before[t] });
  });
});
