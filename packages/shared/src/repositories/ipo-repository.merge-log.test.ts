/**
 * Item 19 / #807 step 1 — the merge log.
 *
 * A merge is currently IRREVERSIBLE. `mergeDuplicateInto` deletes the dropped
 * `ipos` row inside its transaction and nothing snapshots it first, so if two
 * IPOs are merged wrongly the losing row's data is gone and the only recovery
 * is a database backup. `unmerge` (§2.3.3.3) cannot exist without a source of
 * truth to restore from — hence log first, unmerge second.
 *
 * Three things already survive a merge and none of them is enough:
 *   * `ipo_slug_redirects` keeps the dropped SLUG and names the survivor — the
 *     FACT of a merge, nothing about what was consumed;
 *   * `field_sources` rows for CARRIED columns carry previousValue/
 *     previousSource and `dataLineage.mergedFrom` — a value the survivor TOOK
 *     is traceable; a column the dropped row held and the survivor did not
 *     take appears nowhere;
 *   * `audit_logs` exists but the merge path writes nothing to it.
 *
 * This test drives the REAL `IPORepository.mergeDuplicateInto` against a fake
 * `db` that records the order and payload of every mutating call — the same
 * harness shape as ipo-repository.merge-order.test.ts — and asserts the log
 * row is written INSIDE the transaction and BEFORE the dropped row is deleted.
 * Order is the whole point: a log written after the commit can miss a merge
 * that crashed halfway, and one written before the transaction can record a
 * merge that never happened.
 */
import { describe, it, expect } from 'vitest';
import { IPORepository } from './ipo-repository';

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const DROP_ID = '22222222-2222-2222-2222-222222222222';

type Op =
  | { kind: 'child-repoint-or-delete'; table: string }
  | { kind: 'delete-drop-ipos-row' }
  | { kind: 'insert-merge-log'; values: Record<string, unknown> }
  | { kind: 'insert-slug-redirect' }
  | { kind: 'update-survivor' };

function buildFakeDb() {
  const ops: Op[] = [];
  const keepRow: Record<string, unknown> = {
    id: KEEP_ID,
    companyName: 'Real Merge Co Ltd',
    slug: 'real-merge-co-ltd',
    openDate: '2026-09-09',
    symbol: null,
  };
  const dropRow: Record<string, unknown> = {
    id: DROP_ID,
    companyName: 'Real Merge Co. Ltd',
    slug: 'real-merge-co-ltd-o',
    openDate: '2026-09-09',
    symbol: 'CARRIED-VALUE',
    faceValue: '10.00',
  };

  const directTables = [
    { table: 'user_watchlist', col: 'ipo_id' }, // in REPOINT_TABLES
    { table: 'subscriptions', col: 'ipo_id' }, // not in REPOINT_TABLES
  ];

  function makeTx(recordOps: boolean) {
    const record = (op: Op) => {
      if (recordOps) ops.push(op);
    };
    return {
      update: (_t: unknown) => ({
        set: () => ({
          where: async () => {
            record({ kind: 'update-survivor' });
          },
        }),
      }),
      insert: (table: unknown) => {
        // Identify the target table by the name Drizzle keeps on it, so the
        // test never depends on argument position or call order.
        const name = String(
          (table as { [k: symbol]: unknown; _?: { name?: string } })?._?.name ??
            (table as Record<string, unknown>)?.['_']?.toString?.() ??
            ''
        );
        const tableName =
          name ||
          String(
            Object.getOwnPropertySymbols(table as object)
              .map((s) => (table as Record<symbol, unknown>)[s])
              .find((v) => typeof v === 'string') ?? ''
          );
        return {
          values: (values: Record<string, unknown>) => {
            // A merge-log insert is identified by its payload, not its table
            // object: it is the only insert carrying a snapshot of the
            // dropped row.
            if (values && 'dropRow' in values) {
              record({ kind: 'insert-merge-log', values });
            } else if (values && 'oldSlug' in values) {
              record({ kind: 'insert-slug-redirect' });
            }
            void tableName;
            return {
              onConflictDoNothing: async () => undefined,
              onConflictDoUpdate: async () => undefined,
              then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res),
            };
          },
        };
      },
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
        if (/information_schema/i.test(text)) {
          return { rows: directTables.map((t) => ({ child: t.table, col: t.col, parent: 'ipos' })) };
        }
        if (/count\(\*\) filter/i.test(text)) return { rows: [{ keep: 0, drop: 1 }] };
        if (/current_database/i.test(text)) return { rows: [{ current_database: 'ipodhan_test' }] };
        for (const t of directTables) {
          if (text.includes(t.table)) {
            record({ kind: 'child-repoint-or-delete', table: t.table });
            return { rows: [] };
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

  return { db, ops, keepRow, dropRow };
}

async function runMerge() {
  const { db, ops, dropRow } = buildFakeDb();
  const repo = new IPORepository(
    db as never,
    { get: async () => null, set: async () => undefined, del: async () => 0, keys: async () => [] } as never
  );
  await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: true, mergedBy: 'merge-log-test' } as never);
  return { ops, dropRow };
}

describe('mergeDuplicateInto writes a merge log', () => {
  it('writes exactly one merge-log row', async () => {
    const { ops } = await runMerge();
    const logs = ops.filter((o) => o.kind === 'insert-merge-log');
    expect(logs).toHaveLength(1);
  });

  it('writes the log BEFORE the dropped ipos row is deleted', async () => {
    // The ordering that makes the log a snapshot rather than a guess. After
    // the delete the row is gone and there is nothing left to snapshot.
    const { ops } = await runMerge();
    const logAt = ops.findIndex((o) => o.kind === 'insert-merge-log');
    const delAt = ops.findIndex((o) => o.kind === 'delete-drop-ipos-row');
    expect(logAt).toBeGreaterThanOrEqual(0);
    expect(delAt).toBeGreaterThanOrEqual(0);
    expect(logAt).toBeLessThan(delAt);
  });

  it('writes the log INSIDE the transaction, not after it', async () => {
    // Only operations recorded by the transaction-scoped tx are in `ops`; a
    // write issued on `db` after the transaction would never appear here.
    const { ops } = await runMerge();
    expect(ops.some((o) => o.kind === 'insert-merge-log')).toBe(true);
  });

  it('snapshots the WHOLE dropped row, not just the carried columns', async () => {
    // The gap this table exists to close: `field_sources` already records
    // columns the survivor TOOK. A column the dropped row held and the
    // survivor did not take (faceValue here) appears nowhere else.
    const { ops, dropRow } = await runMerge();
    const log = ops.find((o) => o.kind === 'insert-merge-log') as
      | { kind: 'insert-merge-log'; values: Record<string, unknown> }
      | undefined;
    const snapshot = log?.values.dropRow as Record<string, unknown>;
    expect(snapshot).toBeTruthy();
    for (const key of Object.keys(dropRow)) {
      expect(snapshot).toHaveProperty(key);
    }
    expect(snapshot.faceValue).toBe('10.00');
  });

  it('records both ids and both slugs so the merge can be identified', async () => {
    const { ops } = await runMerge();
    const log = ops.find((o) => o.kind === 'insert-merge-log') as
      | { kind: 'insert-merge-log'; values: Record<string, unknown> }
      | undefined;
    expect(log?.values.keepIpoId).toBe(KEEP_ID);
    expect(log?.values.dropIpoId).toBe(DROP_ID);
    expect(log?.values.keepSlug).toBe('real-merge-co-ltd');
    expect(log?.values.dropSlug).toBe('real-merge-co-ltd-o');
  });

  it('records who ran the merge, from the caller — never inferred', async () => {
    const { ops } = await runMerge();
    const log = ops.find((o) => o.kind === 'insert-merge-log') as
      | { kind: 'insert-merge-log'; values: Record<string, unknown> }
      | undefined;
    expect(log?.values.mergedBy).toBe('merge-log-test');
  });

  it('records child-row counts split by deleted vs repointed', async () => {
    // An unmerge has to move repointed person-created rows BACK, and decide
    // what to do about deleted scraper-derived ones. Counts make that
    // decidable with numbers instead of guesses.
    const { ops } = await runMerge();
    const log = ops.find((o) => o.kind === 'insert-merge-log') as
      | { kind: 'insert-merge-log'; values: Record<string, unknown> }
      | undefined;
    const deleted = log?.values.deletedChildCounts as { table: string }[] | undefined;
    const repointed = log?.values.repointedChildCounts as { table: string }[] | undefined;
    expect(Array.isArray(deleted)).toBe(true);
    expect(Array.isArray(repointed)).toBe(true);
    expect(repointed?.some((r) => r.table === 'user_watchlist')).toBe(true);
    expect(deleted?.some((r) => r.table === 'subscriptions')).toBe(true);
  });

  it('writes NO log on a dry run — a plan is not a merge', async () => {
    const { db, ops } = buildFakeDb();
    const repo = new IPORepository(
      db as never,
      { get: async () => null, set: async () => undefined, del: async () => 0, keys: async () => [] } as never
    );
    await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: false } as never);
    expect(ops.filter((o) => o.kind === 'insert-merge-log')).toHaveLength(0);
  });
});
