/**
 * #996 — a chain merge (A merged into B, then B merged into C) deleted the
 * A-into-B `ipo_merge_log` row instead of keeping it.
 *
 * RCA: `mergeDuplicateInto`'s child sweep discovers `ipo_merge_log` as a
 * direct child of `ipos` (its `keep_ipo_id` column is a real FK,
 * `ON DELETE SET NULL` — see migration 0051 / schema.ts). Before this fix,
 * `ipo_merge_log` was not in `REPOINT_TABLES`, so when B is later merged into
 * C (dropId = B), the sweep ran `DELETE FROM ipo_merge_log WHERE
 * keep_ipo_id = B` — removing the A-into-B history row instead of keeping it,
 * even though the migration 0051 comment and OD-92 require merge history to
 * outlive the survivor.
 *
 * Class: every chain merge, any depth — this test only needs one link (a
 * pre-existing log row whose `keep_ipo_id` equals the row about to be merged
 * away) to reproduce it.
 *
 * Fix: `ipo_merge_log` is added to `REPOINT_TABLES`
 * (packages/shared/src/utils/duplicate-ipo-merge.ts), so the sweep repoints
 * `keep_ipo_id` from the dropped id onto the new survivor instead of
 * deleting the row. `ipo_merge_log` has no unique index on `keep_ipo_id`
 * (only `idx_ipo_merge_log_keep`, non-unique), so the repoint never conflicts.
 *
 * This test drives the REAL `IPORepository.mergeDuplicateInto` (not a
 * reimplementation) against a fake `db`/`tx` that records the SQL kind
 * (repoint vs delete) issued for `ipo_merge_log`, modelled on the harness in
 * `ipo-repository.merge-log.test.ts` / `ipo-repository.merge-order.test.ts`.
 *
 * MUTATION CHECK: removing `ipo_merge_log` from `REPOINT_TABLES` (the
 * pre-#996 state) makes the "repointed, not deleted" assertion below fail —
 * verified by hand before this file was finalized.
 */
import { describe, it, expect } from 'vitest';
import { IPORepository } from './ipo-repository';

const KEEP_ID = '11111111-1111-1111-1111-111111111111'; // C: the new survivor
const DROP_ID = '22222222-2222-2222-2222-222222222222'; // B: merged into C, was itself a survivor of A->B
const PRE_EXISTING_LOG_ID = '33333333-3333-3333-3333-333333333333'; // the A->B merge-log row

type Op =
  | { kind: 'ipo-merge-log-repoint' }
  | { kind: 'ipo-merge-log-delete' }
  | { kind: 'delete-drop-ipos-row' };

function buildFakeDb() {
  const ops: Op[] = [];
  const keepRow: Record<string, unknown> = {
    id: KEEP_ID,
    companyName: 'Real Merge Co Ltd',
    slug: 'real-merge-co-ltd',
    openDate: '2026-09-09',
  };
  const dropRow: Record<string, unknown> = {
    id: DROP_ID,
    companyName: 'Real Merge Co. Ltd',
    slug: 'real-merge-co-ltd-o',
    openDate: '2026-09-09',
  };

  // The single direct child in this fixture: ipo_merge_log via keep_ipo_id.
  // (A real merge also has user_watchlist/subscriptions/etc. as direct
  // children; they are irrelevant to this class and omitted to keep the
  // fixture minimal.)
  const directTables = [{ table: 'ipo_merge_log', col: 'keep_ipo_id' }];

  function makeTx(recordOps: boolean) {
    const record = (op: Op) => {
      if (recordOps) ops.push(op);
    };
    return {
      select: () => ({
        from: () => ({
          where: () => {
            const rows = [dropRow];
            return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) });
          },
        }),
      }),
      update: (_t: unknown) => ({
        set: () => ({ where: async () => undefined }),
      }),
      insert: (_t: unknown) => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: async () => [{ id: 'inserted-1' }],
            then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
          }),
          onConflictDoUpdate: async () => undefined,
          returning: async () => [{ id: 'inserted-1' }],
        }),
      }),
      delete: (_t: unknown) => ({
        where: async () => {
          record({ kind: 'delete-drop-ipos-row' });
        },
      }),
      execute: async (query: unknown) => {
        const chunks = (query as { queryChunks?: { value?: unknown }[] })?.queryChunks ?? [];
        const text = chunks
          .map((c) => (Array.isArray(c?.value) ? c.value.join('') : String(c?.value ?? '')))
          .join(' ');
        if (/savepoint/i.test(text)) return { rows: [] };
        if (/to_jsonb\(i\.\*\)/i.test(text)) {
          return { rows: [keepRow, dropRow].map((r) => ({ id: String(r.id), row: JSON.stringify(r) })) };
        }
        if (/information_schema/i.test(text)) {
          return { rows: directTables.map((t) => ({ child: t.table, col: t.col, parent: 'ipos' })) };
        }
        if (/count\(\*\) filter/i.test(text)) return { rows: [{ keep: 0, drop: 1 }] };
        if (/pg_constraint|to_jsonb\(t\.\*\)::text as row|ipo_source_keys/i.test(text)) return { rows: [] };
        if (/current_database/i.test(text)) return { rows: [{ current_database: 'ipodhan_test' }] };
        // #900's unique-key introspection for the repoint conflict predicate: `ipo_merge_log`
        // has no unique index on `keep_ipo_id` (only the non-unique `idx_ipo_merge_log_keep`).
        if (/pg_index/i.test(text)) return { rows: [] };
        if (text.includes('ipo_merge_log')) {
          // Repoint path: `update ipo_merge_log d set keep_ipo_id = $keepId where ...`
          if (/update/i.test(text)) {
            record({ kind: 'ipo-merge-log-repoint' });
            // The pre-existing A->B log row: keep_ipo_id was DROP_ID (B), it has an `id` column.
            return { rows: [{ id: PRE_EXISTING_LOG_ID }] };
          }
          // Delete path: `with d as (delete from ipo_merge_log where keep_ipo_id = $dropId ...) select count(*)`
          if (/with d as/i.test(text) || /^\s*delete/i.test(text.trim())) {
            record({ kind: 'ipo-merge-log-delete' });
            return { rows: [{ n: 1 }] };
          }
        }
        return { rows: [] };
      },
    };
  }

  const baseTx = makeTx(false);
  const db: Record<string, unknown> = {
    execute: baseTx.execute,
    transaction: async (cb: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
      await cb(makeTx(true));
    },
  };
  db.select = (cols?: Record<string, unknown>) => ({
    from: () => ({
      where: async () => (cols && 'fieldName' in cols ? [] : [keepRow, dropRow]),
    }),
  });

  return { db, ops };
}

describe('#996 — a chain merge keeps the earlier merge-log row (repoint, not delete)', () => {
  it('repoints ipo_merge_log.keep_ipo_id onto the new survivor instead of deleting the row', async () => {
    const { db, ops } = buildFakeDb();
    const repo = new IPORepository(
      db as never,
      { get: async () => null, set: async () => undefined, del: async () => 0, keys: async () => [] } as never
    );

    // Simulates the second merge of a chain: B (DROP_ID, itself the survivor of an earlier
    // A->B merge, so ipo_merge_log has a row with keep_ipo_id = DROP_ID) is now merged into C
    // (KEEP_ID).
    await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: true, mergedBy: 'chain-merge-test' } as never);

    const repointed = ops.filter((o) => o.kind === 'ipo-merge-log-repoint');
    const deleted = ops.filter((o) => o.kind === 'ipo-merge-log-delete');

    expect(deleted, 'the A->B merge-log row must never be deleted by a later merge').toHaveLength(0);
    expect(repointed.length).toBeGreaterThan(0);
  });
});
