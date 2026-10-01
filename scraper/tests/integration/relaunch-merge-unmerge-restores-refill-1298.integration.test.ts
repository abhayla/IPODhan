/**
 * #1298 follow-up (OD-92 "a merge log, not a diff ... the rows themselves"; "every automatic merge is
 * reversible") on the real database (ipodhan_test only).
 *
 * An OD-86 relaunch merge of a POSTPONED survivor clears the old offer's document values and refills
 * them from the newer record INSIDE the merge transaction. The merge log used to be written before that
 * clear + refill, so an unmerge restored only the columns the log named and left the refilled lot size
 * and the emptied issue size as the relaunch left them. The unmerge must restore the exact pre-merge row.
 *
 *   npx vitest run --config vitest.integration.config.ts tests/integration/relaunch-merge-unmerge-restores-refill-1298.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories';

const DATABASE_URL = process.env.DATABASE_URL;
const OLD = '00000000-0000-4000-8000-00000000a9d1'; // the older, postponed record (the survivor)
const NEW = '00000000-0000-4000-8000-00000000a9d2'; // the newer relaunch record (merged away)
const noRedis = {
  get: async () => null, set: async () => 'OK', setex: async () => 'OK', del: async () => 0,
  keys: async () => [], scan: async () => ['0', []],
} as never;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const rows = (r: any) => (r.rows ?? r) as any[];
const tick = () => new Promise((r) => setTimeout(r, 25));

const survivorRow = async () =>
  rows(await db.execute(sql`SELECT to_jsonb(i.*) - 'updated_at' AS r FROM ipos i WHERE id = ${OLD}::uuid`))[0].r as Record<string, unknown>;
const survivorProvenance = async () =>
  rows(await db.execute(sql`
    SELECT field_name, source, confidence FROM field_sources
     WHERE ipo_id = ${OLD}::uuid AND table_name = 'ipos' AND row_key = '' AND field_name IN ('issueSize', 'lotSize')
     ORDER BY field_name`));

async function cleanup() {
  for (const id of [OLD, NEW]) {
    await db.execute(sql`DELETE FROM audit_logs WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipo_merge_log WHERE keep_ipo_id = ${id}::uuid OR drop_ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipo_slug_redirects WHERE ipo_id = ${id}::uuid`);
    await db.execute(sql`DELETE FROM ipos WHERE id = ${id}::uuid`);
  }
}

describe.skipIf(!DATABASE_URL)('#1298: unmerge of an OD-86 relaunch merge restores what the relaunch refill wrote (ipodhan_test)', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
    db = drizzle(pool, { schema });
    const name = rows(await db.execute(sql`SELECT current_database() AS d`))[0].d;
    if (name !== 'ipodhan_test') throw new Error(`refusing to run against ${name}`);
    await cleanup();
  }, 60_000);
  afterAll(async () => {
    if (!pool) return;
    await cleanup();
    await pool.end();
  }, 60_000);

  it('relaunch-merge a POSTPONED survivor with a refill, unmerge: every column equals its pre-merge value', async () => {
    const repo = new IPORepository(db as never, noRedis);
    const mk = async (id: string, slug: string, open: string, ipoNo: string, size: number | null, lot: number, postponed: boolean) => {
      await db.execute(sql`
        INSERT INTO ipos (id, company_name, slug, status, segment, offering_type, symbol, listing_exchanges, issue_size, lot_size,
                          open_date, price_range_min, price_range_max)
        VALUES (${id}::uuid, 'Unmerge Refill 1298 Seeds Ltd', ${slug}, 'UPCOMING', 'SME', 'IPO', 'UNMRF1298', '["BSE"]', ${size}, ${lot}, ${open}, 95, 99)`);
      await db.execute(sql`
        INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, confidence, updated_at, created_at)
        VALUES (${id}::uuid, 'ipos', '', 'issueSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days'),
               (${id}::uuid, 'ipos', '', 'lotSize', 'DRHP', 95, now() - interval '10 days', now() - interval '10 days')`);
      await repo.bindSourceKeys(id, [{ source: 'BSE', keyType: 'BSE_IPO_NO', keyValue: ipoNo, attrs: { shares: 2_700_000, priceMin: 95, priceMax: 99, postponed } }] as never, {
        boundVia: 'BACKFILL', boundBy: 'issue1298.unmerge.test',
      } as never);
      if (postponed) {
        await db.execute(sql`UPDATE ipos SET status = 'POSTPONED' WHERE id = ${id}::uuid`);
        await db.execute(sql`
          INSERT INTO field_sources (ipo_id, table_name, row_key, field_name, source, updated_at)
          VALUES (${id}::uuid, 'ipos', '', 'status', 'BSE', now())
          ON CONFLICT (ipo_id, table_name, row_key, field_name) DO UPDATE SET source = 'BSE', updated_at = now()`);
        await tick();
      }
    };
    await mk(OLD, 'unmerge-refill-1298', '2026-06-23', '98794', 267300000, 1200, true);
    await mk(NEW, 'unmerge-refill-1298-o', '2026-08-19', '98900', null, 1000, false);
    const before = await survivorRow();
    const provBefore = await survivorProvenance();
    expect(before).toMatchObject({ lot_size: 1200, status: 'POSTPONED' });
    expect(Number(before.issue_size)).toBe(267300000);
    expect(provBefore).toEqual([
      { field_name: 'issueSize', source: 'DRHP', confidence: 95 },
      { field_name: 'lotSize', source: 'DRHP', confidence: 95 },
    ]);

    const { isRelaunchDocumentField } = await import('../../src/services/relaunch-clear');
    await repo.mergeDuplicateInto(OLD, NEW, { apply: true, mergedBy: 'issue1298.unmerge.test', isRelaunchDocumentField });
    // The relaunch emptied the issue size and refilled the lot size from the newer record.
    const merged = await survivorRow();
    expect(merged.issue_size).toBeNull();
    expect(merged.lot_size).toBe(1000);

    const mergeId = rows(await db.execute(sql`SELECT id FROM ipo_merge_log WHERE drop_ipo_id = ${NEW}::uuid AND unmerged_at IS NULL`))[0].id as string;
    const res = await repo.unmergeDuplicate(mergeId, { apply: true, unmergedBy: 'issue1298.unmerge.test' });
    expect(res.applied).toBe(true);

    const after = await survivorRow();
    expect(after.lot_size).toBe(1200);
    expect(Number(after.issue_size)).toBe(267300000);
    expect(after).toEqual(before); // every column, exact
    expect(await survivorProvenance()).toEqual(provBefore);
  }, 120_000);
});
