/**
 * #457 round 2 (proofs b + c) on ipodhan_test: each tool's ledger records ONLY the rows its
 * guarded write actually changed — a row that changes between plan and write (a race) is
 * absent — with the true row identity and every changed column. And a decorated-slugs apply,
 * restored from its own ledger (ipos columns + the redirect row it inserted), returns both
 * tables to the pre-apply snapshot.
 *
 *   DATABASE_URL=postgresql://ipodhan_app:<pw>@localhost:15432/ipodhan_test \
 *     npx vitest run --config vitest.integration.config.ts tests/integration/repair-ledger-written-rows.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../packages/shared/src/db/schema';
import { IPORepository } from '../../../packages/shared/src/repositories/ipo-repository';
import type { RepairLedgerFieldChange } from '../../scripts/lib/repair-tool';

const DATABASE_URL = process.env.DATABASE_URL;
const IPO = {
  slugA: '00000000-0000-4000-8000-0000004570a1',
  slugB: '00000000-0000-4000-8000-0000004570a2',
  closedA: '00000000-0000-4000-8000-0000004570c1',
  closedB: '00000000-0000-4000-8000-0000004570c2',
  lineage: '00000000-0000-4000-8000-0000004570d1',
};
const FS = { a: '00000000-0000-4000-8000-0000004570f1', b: '00000000-0000-4000-8000-0000004570f2' };
const DOC = { a: '00000000-0000-4000-8000-0000004570e1', b: '00000000-0000-4000-8000-0000004570e2' };
const ALL_IPOS = Object.values(IPO);

// A no-op cache: the repository's invalidation is not what these tests measure.
const noRedis = new Proxy({}, { get: () => async () => [] }) as never;

let pool: Pool | null = null;

async function cleanup(p: Pool) {
  await p.query('DELETE FROM ipo_slug_redirects WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM closed_ipo_resourcing WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM field_sources WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM documents WHERE ipo_id = ANY($1::uuid[])', [ALL_IPOS]);
  await p.query('DELETE FROM ipos WHERE id = ANY($1::uuid[])', [ALL_IPOS]);
}

async function seedIpo(p: Pool, id: string, slug: string, status = 'UPCOMING') {
  await p.query(
    `INSERT INTO ipos (id, company_name, slug, category, status, segment, listing_exchanges, updated_at)
     VALUES ($1, $2, $3, 'MAINBOARD', $4, 'MAINBOARD', '["NSE"]', '2026-09-01 08:00:00')`,
    [id, `Repair 457 ${slug}`, slug, status]
  );
}

beforeAll(async () => {
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, max: 3, options: '-c timezone=UTC' });
  const currentDb = (await pool.query('select current_database()')).rows[0].current_database as string;
  if (currentDb !== 'ipodhan_test') throw new Error(`Refusing to run: connected to '${currentDb}', not 'ipodhan_test'.`);
  await cleanup(pool);
}, 30000);

afterAll(async () => {
  if (!pool) return;
  await cleanup(pool);
  await pool.end();
}, 30000);

describe.skipIf(!DATABASE_URL)('#457 round 2: ledgers hold only rows actually written', () => {
  it('decorated-slugs: a raced row is absent; a written row records slug + updated_at + the redirect it inserted; restore returns both tables to the snapshot', async () => {
    const p = pool!;
    await seedIpo(p, IPO.slugA, 'repair-457-a-ltd-ipo');
    await seedIpo(p, IPO.slugB, 'repair-457-b-ltd-ipo');
    const snapIpos = async () =>
      (await p.query(`SELECT id::text, slug, updated_at::text AS updated_at FROM ipos WHERE id = ANY($1::uuid[]) ORDER BY id`, [[IPO.slugA, IPO.slugB]])).rows;
    const snapRedirects = async () =>
      (await p.query(`SELECT id::text, old_slug, ipo_id::text, reason FROM ipo_slug_redirects WHERE ipo_id = ANY($1::uuid[]) ORDER BY old_slug`, [[IPO.slugA, IPO.slugB]])).rows;

    const { applyRename } = await import('../../scripts/repair-decorated-slugs.js');
    const repo = new IPORepository(drizzle(p, { schema }) as never, noRedis);
    const plans = [
      { id: IPO.slugA, companyName: 'A', oldSlug: 'repair-457-a-ltd-ipo', newSlug: 'repair-457-a-ltd', outcome: 'planned' as const },
      { id: IPO.slugB, companyName: 'B', oldSlug: 'repair-457-b-ltd-ipo', newSlug: 'repair-457-b-ltd', outcome: 'planned' as const },
    ];
    // B changes between plan and write: a concurrent writer renamed it.
    await p.query(`UPDATE ipos SET slug = 'repair-457-b-concurrent' WHERE id = $1`, [IPO.slugB]);
    const beforeIpos = await snapIpos();
    const beforeRedirects = await snapRedirects();

    const changes: RepairLedgerFieldChange[] = [];
    const outcomes: string[] = [];
    for (const plan of plans) {
      const r = await applyRename(plan, 'ipodhan_test', repo);
      outcomes.push(r.outcome);
      changes.push(...r.changes);
    }
    expect(outcomes).toEqual(['written', 'skipped-raced']);
    expect(changes.every((c) => c.rowKey !== IPO.slugB)).toBe(true);
    expect(changes.map((c) => `${c.table}.${c.field}`)).toEqual(['ipos.slug', 'ipos.updated_at', 'ipo_slug_redirects.(row)']);
    expect(changes[0]).toMatchObject({ rowKey: IPO.slugA, before: 'repair-457-a-ltd-ipo', after: 'repair-457-a-ltd' });
    expect(changes[1].before).toBe('2026-09-01 08:00:00');
    // eslint-disable-next-line no-console
    console.log(`#457 PROOF decorated-slugs ledger: ${JSON.stringify(changes)}`);

    // Restore FROM THE LEDGER ONLY: a (row) insert is deleted by its key; a column is set back to `before`.
    for (const c of [...changes].reverse()) {
      if (c.field === '(row)' && c.before === null) {
        await p.query(`DELETE FROM ${c.table} WHERE id = $1`, [c.rowKey]);
      } else {
        await p.query(`UPDATE ${c.table} SET ${c.field} = $1 WHERE id = $2`, [c.before, c.rowKey]);
      }
    }
    expect(await snapIpos()).toEqual(beforeIpos);
    expect(await snapRedirects()).toEqual(beforeRedirects);
  });

  it('ipos-lineage-document-id: a raced row is absent; the stamped row records field_sources.data_lineage with its true prior value', async () => {
    const p = pool!;
    await seedIpo(p, IPO.lineage, 'repair-457-lineage');
    // Two rows, each with exactly one COMPLETED filing 1 s after it (hours apart, so neither is ambiguous).
    for (const [id, doc, hour] of [[FS.a, DOC.a, '10'], [FS.b, DOC.b, '12']] as const) {
      await p.query(
        `INSERT INTO documents (id, ipo_id, type, title, url, extraction_status, extracted_at)
         VALUES ($1::uuid, $2, 'RHP', 'fixture', 'repair-457-' || $1::text || '.pdf', 'COMPLETED', $3)`,
        [doc, IPO.lineage, `2026-09-20 ${hour}:00:01`]
      );
      await p.query(
        `INSERT INTO field_sources (id, ipo_id, table_name, field_name, source, data_lineage, updated_at)
         VALUES ($1, $2, 'ipos', $3, 'DRHP', '{"policyOrigin":"manifest@1"}', $4)`,
        [id, IPO.lineage, id === FS.a ? 'issueSize' : 'lotSize', `2026-09-20 ${hour}:00:00`]
      );
    }
    const { planLineageRepair, applyStamps, REPAIR_MARKER } = await import('../../scripts/repair-ipos-lineage-document-id.js');
    const dbx = drizzle(p, { schema }) as never;
    const plan = await planLineageRepair(dbx);
    const ours = plan.toStamp.filter((d: { row: { ipoId: string } }) => d.row.ipoId === IPO.lineage);
    expect(ours).toHaveLength(2);
    // FS.b is rewritten between plan and write.
    await p.query(`UPDATE field_sources SET updated_at = '2026-09-20 18:30:00' WHERE id = $1`, [FS.b]);
    const { stampedIds, changes } = await applyStamps(dbx, ours);
    expect(stampedIds).toEqual([FS.a]);
    expect(changes).toEqual([
      {
        table: 'field_sources',
        rowKey: FS.a,
        field: 'data_lineage',
        before: { policyOrigin: 'manifest@1' },
        after: { policyOrigin: 'manifest@1', documentId: DOC.a, documentIdRepair: REPAIR_MARKER },
      },
    ]);
  });

  it('closed-ipo-false-done: a raced row is absent; the reopened row records every column the UPDATE set', async () => {
    const p = pool!;
    await seedIpo(p, IPO.closedA, 'repair-457-closed-a', 'LISTED');
    await seedIpo(p, IPO.closedB, 'repair-457-closed-b', 'LISTED');
    for (const id of [IPO.closedA, IPO.closedB]) {
      await p.query(
        `INSERT INTO closed_ipo_resourcing (ipo_id, first_attempt_at, last_attempt_at, attempts, outcome, fields_written, fields_left_empty, resourced_at_version, updated_at)
         VALUES ($1::uuid, now(), now(), 1, 'DONE', 0, 0, 'closed-ipo-job@2026-09-21', '2026-09-21 09:00:00')`,
        [id]
      );
    }
    // B settles between the read and the write (another writer marked it PARTIAL).
    await p.query(`UPDATE closed_ipo_resourcing SET outcome = 'PARTIAL' WHERE ipo_id = $1`, [IPO.closedB]);
    const { reopenFalseDoneRowsWithChanges, REPAIR_MARKER } = await import('../../scripts/repair-closed-ipo-false-done.js');
    const r = await reopenFalseDoneRowsWithChanges(drizzle(p, { schema }) as never, [IPO.closedA, IPO.closedB]);
    expect(r.changedIds).toEqual([IPO.closedA]);
    expect(r.changes.every((c: RepairLedgerFieldChange) => (c.rowKey as { ipo_id: string }).ipo_id === IPO.closedA)).toBe(true);
    const byField = Object.fromEntries(r.changes.map((c: RepairLedgerFieldChange) => [c.field, c]));
    expect(Object.keys(byField).sort()).toEqual(['cause_class', 'cause_detail', 'outcome', 'resourced_at_version', 'updated_at']);
    expect(byField.outcome).toMatchObject({ before: 'DONE', after: 'PARTIAL' });
    expect(byField.cause_class).toMatchObject({ before: null, after: 'EXTRACTOR_MISSING' });
    expect(byField.resourced_at_version).toMatchObject({ before: 'closed-ipo-job@2026-09-21', after: `${REPAIR_MARKER}closed-ipo-job@2026-09-21` });
    expect(byField.updated_at.before).toBe('2026-09-21 09:00:00+00');
  });
});
