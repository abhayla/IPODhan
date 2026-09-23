import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@ipodhan/shared/db/schema';
import { IPORepository } from '@ipodhan/shared';

/**
 * #900 (item 19 / #807 step A): a merge must move person-created rows ROW BY ROW, and its log
 * must record what actually moved — against real Postgres, through the REAL
 * `IPORepository.mergeDuplicateInto`.
 *
 * The defect: REPOINT_TABLES were repointed with ONE table-wide UPDATE; on a unique violation the
 * code rolled back and ran `DELETE ... WHERE ipo_id = drop`, deleting EVERY dropped-side row. With
 * `user_watchlist UNIQUE (user_id, ipo_id)` (on production), one user watching both IPOs cost every
 * other watcher of the duplicate their watch.
 *
 * `user_watchlist` exists on production but NOT in schema.ts or the migration journal, so a
 * journal-built database (ipodhan_test, CI's postgres:16) does not have it. This file creates it
 * with production's definition (minus the FK to `users`, which is also absent there) when it is
 * missing, and LEAVES it in place: other integration files run in parallel and discover child
 * tables from the catalog, so dropping it mid-run made a concurrent merge query a table that had
 * just vanished (measured: 42P01 in identity-matching-od68). Only this file's rows are removed.
 * The merge discovers child tables from the live catalog, so the fixture table is exercised
 * exactly as production's would be.
 *
 * Also asserted: the log's `drop_row` carries every live `ipos` column (checked against
 * information_schema, not schema.ts), the survivor's pre-merge row and both sides' field_sources
 * are in the log whole, and the counts come from what the transaction RETURNED.
 *
 * SKIPS CLEANLY when no DATABASE_URL is set. Run from `scraper/`:
 *   npx vitest run -c vitest.integration.config.ts tests/integration/merge-repoint-conflict.integration.test.ts
 */

const DATABASE_URL = process.env.DATABASE_URL;
const SKIP_REASON = 'merge-repoint-conflict: DATABASE_URL not set';

const K1 = '00000000-0000-4000-9900-0000000000b1';
const D1 = '00000000-0000-4000-9900-0000000000b2';
const K2 = '00000000-0000-4000-9900-0000000000c1';
const D2 = '00000000-0000-4000-9900-0000000000c2';
const IDS = [K1, D1, K2, D2];
const U1 = '00000000-0000-4000-9900-00000000a001';
const U2 = '00000000-0000-4000-9900-00000000a002';
const U3 = '00000000-0000-4000-9900-00000000a003';

let pool: Pool | null = null;
let repo: IPORepository | null = null;

const noRedis = {
  get: async () => null,
  set: async () => 'OK',
  setex: async () => 'OK',
  del: async () => 0,
  keys: async () => [],
} as never;

async function cleanup(p: Pool) {
  await p.query(`DELETE FROM ipo_merge_log WHERE drop_ipo_id = ANY($1::uuid[]) OR keep_ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM ipo_slug_redirects WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM audit_logs WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM user_watchlist WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM subscriptions WHERE ipo_id = ANY($1::uuid[])`, [IDS]);
  await p.query(`DELETE FROM ipos WHERE id = ANY($1::uuid[])`, [IDS]);
}

async function plantPair(p: Pool, keep: string, drop: string, tag: string) {
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, offering_type, segment, status, open_date, close_date, issue_size, face_value, cin)
     VALUES ($1, 'Repoint Proof Company (India) Limited', $3, 'IPO', 'MAINBOARD', 'OPEN', '2026-09-09', '2026-09-11', 4500000000.00, NULL, NULL),
            ($2, 'Repoint Proof Co. (India) Ltd',          $4, 'IPO', 'MAINBOARD', 'OPEN', '2026-09-09', '2026-09-11', 4500000000.00, 10.00, 'U65999MH2002PLC138245')`,
    [keep, drop, `t-repoint-keep-${tag}`, `t-repoint-drop-${tag}`]
  );
}

async function merge(keep: string, drop: string) {
  return repo!.mergeDuplicateInto(keep, drop, { apply: true, mergedBy: 'merge-repoint-conflict.test' });
}

async function readLog(p: Pool, drop: string) {
  const r = await p.query(`SELECT * FROM ipo_merge_log WHERE drop_ipo_id = $1`, [drop]);
  expect(r.rows).toHaveLength(1);
  return r.rows[0];
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 4, options: '-c timezone=UTC' });
  repo = new IPORepository(drizzle(pool, { schema }) as never, noRedis);

  const exists = await pool.query(`SELECT to_regclass('public.user_watchlist') IS NOT NULL AS e`);
  if (!exists.rows[0].e) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.user_watchlist (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        user_id uuid NOT NULL,
        ipo_id uuid NOT NULL REFERENCES ipos(id) ON DELETE CASCADE,
        added_at timestamp DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT user_watchlist_user_id_ipo_id_key UNIQUE (user_id, ipo_id)
      )`);
  }
  await cleanup(pool);
});

afterAll(async () => {
  if (!pool) return;
  await cleanup(pool);
  await pool.end();
});

describe.skipIf(!DATABASE_URL)(`mergeDuplicateInto repoints row by row and logs what moved (${SKIP_REASON})`, () => {
  it('#900: 3 watchers on the duplicate, 1 also on the survivor -> survivor has 3, exactly 1 duplicate removed', async () => {
    const p = pool!;
    await plantPair(p, K1, D1, 'a');
    await p.query(
      `INSERT INTO user_watchlist (user_id, ipo_id) VALUES ($1, $4), ($2, $4), ($3, $4), ($1, $5)`,
      [U1, U2, U3, D1, K1]
    );
    const dropRows = (await p.query(`SELECT id, user_id, to_jsonb(w.*)::text AS row FROM user_watchlist w WHERE ipo_id = $1`, [D1])).rows;
    const u1DropRow = dropRows.find((r) => r.user_id === U1)!;
    const movedIds = dropRows.filter((r) => r.user_id !== U1).map((r) => r.id).sort();

    const result = await merge(K1, D1);
    expect(result.applied).toBe(true);

    const keepWatchers = (await p.query(`SELECT user_id FROM user_watchlist WHERE ipo_id = $1 ORDER BY user_id`, [K1])).rows;
    expect(keepWatchers.map((r) => r.user_id)).toEqual([U1, U2, U3]);
    const left = await p.query(`SELECT count(*)::int AS n FROM user_watchlist WHERE ipo_id = $1`, [D1]);
    expect(left.rows[0].n).toBe(0);
    // The two repointed rows kept their identity (moved, not re-created).
    const moved = (await p.query(`SELECT id FROM user_watchlist WHERE id = ANY($1::uuid[]) AND ipo_id = $2`, [movedIds, K1])).rows;
    expect(moved).toHaveLength(2);

    const log = await readLog(p, D1);
    const w = (log.repointed_child_counts as Record<string, unknown>[]).find((e) => e.table === 'user_watchlist')!;
    expect(w).toBeTruthy();
    expect(w.count).toBe(2);
    expect([...(w.repointedIds as string[])].sort()).toEqual(movedIds);
    expect(w.deletedOnConflictCount).toBe(1);
    // The removed duplicate is in the log WHOLE — compared server-side, so no JS rounding.
    const same = await p.query(`SELECT ($1::jsonb) = ($2::jsonb) AS eq`, [
      JSON.stringify((w.deletedOnConflictRows as unknown[])[0]),
      u1DropRow.row,
    ]);
    expect(same.rows[0].eq).toBe(true);
  });

  it('a merge with no conflicts repoints every person-created row and deletes none of them', async () => {
    const p = pool!;
    await plantPair(p, K2, D2, 'b');
    await p.query(`INSERT INTO user_watchlist (user_id, ipo_id) VALUES ($1, $3), ($2, $3)`, [U1, U2, D2]);
    await p.query(
      `INSERT INTO audit_logs (admin_user, action_type, ipo_id) VALUES ('t', 'T_REPOINT_PROOF', $1)`,
      [D2]
    );
    await p.query(`INSERT INTO subscriptions (ipo_id, timestamp, total_subscription) VALUES ($1, now(), 1.5), ($1, now() - interval '1 hour', 1.2)`, [D2]);
    await p.query(
      `INSERT INTO field_sources (ipo_id, table_name, field_name, source) VALUES ($1, 'ipos', 'issueSize', 'NSE'), ($2, 'ipos', 'faceValue', 'BSE')`,
      [K2, D2]
    );
    const keepBefore = (await p.query(`SELECT to_jsonb(i.*)::text AS row FROM ipos i WHERE id = $1`, [K2])).rows[0].row;
    const dropBefore = (await p.query(`SELECT to_jsonb(i.*)::text AS row FROM ipos i WHERE id = $1`, [D2])).rows[0].row;
    // The row's own text form: every column, in Postgres's output format, so numeric scale and
    // timestamp text are compared exactly (jsonb equality alone treats 10 and 10.00 as equal).
    const dropRecordBefore = (await p.query(`SELECT i::text AS rec FROM ipos i WHERE id = $1`, [D2])).rows[0].rec;
    const fsBefore = (await p.query(`SELECT ipo_id::text AS ipo_id, to_jsonb(f.*)::text AS row FROM field_sources f WHERE ipo_id = ANY($1::uuid[])`, [[K2, D2]])).rows;

    const result = await merge(K2, D2);
    expect(result.applied).toBe(true);

    const n = await p.query(`SELECT count(*)::int AS n FROM user_watchlist WHERE ipo_id = $1`, [K2]);
    expect(n.rows[0].n).toBe(2);
    const a = await p.query(`SELECT count(*)::int AS n FROM audit_logs WHERE ipo_id = $1 AND action_type = 'T_REPOINT_PROOF'`, [K2]);
    expect(a.rows[0].n).toBe(1);

    const log = await readLog(p, D2);
    const rep = log.repointed_child_counts as Record<string, unknown>[];
    const w = rep.find((e) => e.table === 'user_watchlist')!;
    expect(w.count).toBe(2);
    expect(w.deletedOnConflictCount).toBe(0);
    expect(rep.find((e) => e.table === 'audit_logs')?.count).toBe(1);
    // Scraper-derived rows: counted from what the DELETE returned.
    const del = log.deleted_child_counts as { table: string; count: number }[];
    expect(del.find((d) => d.table === 'subscriptions')?.count).toBe(2);

    // Every live ipos column is in drop_row, and drop_row IS the pre-merge row.
    const cols = (await p.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ipos' ORDER BY 1`
    )).rows.map((r) => r.column_name);
    expect(Object.keys(log.drop_row).sort()).toEqual(cols);
    const eq = await p.query(
      `SELECT (SELECT drop_row FROM ipo_merge_log WHERE drop_ipo_id = $1) = $2::jsonb AS drop_eq,
              (SELECT survivor_patch -> 'keepRowBefore' FROM ipo_merge_log WHERE drop_ipo_id = $1) = $3::jsonb AS keep_eq,
              (SELECT jsonb_populate_record(null::ipos, drop_row)::text FROM ipo_merge_log WHERE drop_ipo_id = $1) AS restored`,
      [D2, dropBefore, keepBefore]
    );
    expect(eq.rows[0].drop_eq).toBe(true);
    expect(eq.rows[0].keep_eq).toBe(true);
    // The restore path an unmerge will use reproduces the deleted row byte for byte.
    expect(eq.rows[0].restored).toBe(dropRecordBefore);

    // Both sides' provenance rows, whole.
    const fsEq = await p.query(
      `SELECT survivor_patch -> 'fieldSourcesBefore' -> 'keep' = $2::jsonb AS k,
              survivor_patch -> 'fieldSourcesBefore' -> 'drop' = $3::jsonb AS d
       FROM ipo_merge_log WHERE drop_ipo_id = $1`,
      [
        D2,
        `[${fsBefore.filter((r) => r.ipo_id === K2).map((r) => r.row).join(',')}]`,
        `[${fsBefore.filter((r) => r.ipo_id === D2).map((r) => r.row).join(',')}]`,
      ]
    );
    expect(fsEq.rows[0].k).toBe(true);
    expect(fsEq.rows[0].d).toBe(true);
  });
});
