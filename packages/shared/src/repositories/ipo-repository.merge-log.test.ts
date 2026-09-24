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
  | { kind: 'update-survivor' }
  | { kind: 'locked-reread'; mode: string };

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

  // What a FOR UPDATE re-read inside the transaction returns. Defaults to the same row the
  // pre-transaction read saw; a test overrides it to model a concurrent writer that changed
  // the row after that first read — the class the lock exists to close.
  let lockedDropRow: Record<string, unknown> | null = null;

  function makeTx(recordOps: boolean) {
    const record = (op: Op) => {
      if (recordOps) ops.push(op);
    };
    return {
      // The transaction-scoped locked re-read of the dropped row.
      select: () => ({
        from: () => ({
          where: () => {
            const rows = [lockedDropRow ?? dropRow];
            // Drizzle's builder is awaitable directly AND chainable via .for('update');
            // model both so the test cannot pass against a shape the real code never uses.
            return Object.assign(Promise.resolve(rows), {
              for: (mode: string) => {
                record({ kind: 'locked-reread', mode });
                return Promise.resolve(rows);
              },
            });
          },
        }),
      }),
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
              // The snapshots are written as `sql\`${text}::jsonb\`` so Postgres parses the exact
              // JSON text; decode that bound text back to an object for the assertions.
              const decoded: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(values)) {
                const chunks = (v as { queryChunks?: unknown[] })?.queryChunks;
                const bound = Array.isArray(chunks) ? chunks.find((c) => typeof c === 'string') : undefined;
                decoded[k] = typeof bound === 'string' ? JSON.parse(bound) : v;
              }
              record({ kind: 'insert-merge-log', values: decoded });
            } else if (values && 'oldSlug' in values) {
              record({ kind: 'insert-slug-redirect' });
            }
            void tableName;
            // OD-92: the log insert and the redirect insert both RETURN the new row's id.
            const returning = async () => [{ id: 'inserted-1' }];
            return {
              onConflictDoNothing: () => ({ returning, then: (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res) }),
              onConflictDoUpdate: async () => undefined,
              returning,
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
        // #900: the in-transaction lock + whole-row snapshot of BOTH ipos rows, one statement.
        if (/to_jsonb\(i\.\*\)/i.test(text)) {
          if (/for update/i.test(text)) record({ kind: 'locked-reread', mode: 'update' });
          return {
            rows: [keepRow, lockedDropRow ?? dropRow].map((r) => ({ id: String(r.id), row: JSON.stringify(r) })),
          };
        }
        if (/information_schema/i.test(text)) {
          return { rows: directTables.map((t) => ({ child: t.table, col: t.col, parent: 'ipos' })) };
        }
        if (/count\(\*\) filter/i.test(text)) return { rows: [{ keep: 0, drop: 1 }] };
        // OD-92: the capture reads (FK edges, whole-row captures, source keys) find nothing in this fake.
        if (/pg_constraint|to_jsonb\(t\.\*\)::text as row|ipo_source_keys/i.test(text)) return { rows: [] };
        if (/current_database/i.test(text)) return { rows: [{ current_database: 'ipodhan_test' }] };
        // #900: unique-key introspection for the conflict predicate — no unique key here.
        if (/pg_index/i.test(text)) return { rows: [] };
        for (const t of directTables) {
          if (text.includes(t.table)) {
            record({ kind: 'child-repoint-or-delete', table: t.table });
            // What the real statements RETURN, which is what the log now records.
            if (/returning to_jsonb\(d\.\*\) ->> 'id'/i.test(text)) return { rows: [{ id: `${t.table}-row-1` }] };
            if (/with d as/i.test(text)) return { rows: [{ n: 1 }] };
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

  return { db, ops, keepRow, dropRow, setLockedDropRow: (r) => { lockedDropRow = r; } };
}

async function runMerge(lockedRow?: Record<string, unknown>) {
  const { db, ops, dropRow, setLockedDropRow } = buildFakeDb();
  if (lockedRow) setLockedDropRow(lockedRow);
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

describe('the snapshot is taken at DELETE time, under a lock', () => {
  it('re-reads the dropped row INSIDE the transaction with FOR UPDATE', async () => {
    // Found by the PR #888 review. The first read of `drop` happens on `this.db` OUTSIDE
    // any transaction, with several awaited round-trips before the transaction opens, at
    // READ COMMITTED (nothing in this codebase sets an isolation level). Without a locked
    // re-read, a concurrent writer in that window has its write deleted AND missing from
    // the snapshot — a log that reads complete and is not.
    const { ops } = await runMerge();
    const reread = ops.find((o) => o.kind === 'locked-reread') as
      | { kind: 'locked-reread'; mode: string }
      | undefined;
    expect(reread, 'the dropped row must be re-read inside the transaction').toBeTruthy();
    expect(reread?.mode).toBe('update');
  });

  it('re-reads BEFORE writing the log, and the log BEFORE the delete', async () => {
    const { ops } = await runMerge();
    const rereadAt = ops.findIndex((o) => o.kind === 'locked-reread');
    const logAt = ops.findIndex((o) => o.kind === 'insert-merge-log');
    const delAt = ops.findIndex((o) => o.kind === 'delete-drop-ipos-row');
    expect(rereadAt).toBeGreaterThanOrEqual(0);
    expect(rereadAt).toBeLessThan(logAt);
    expect(logAt).toBeLessThan(delAt);
  });

  it('snapshots the CONCURRENTLY-CHANGED value, not the stale pre-transaction read', async () => {
    // The class itself: another writer set symbol between the first read and the
    // transaction. The log must record what is about to be deleted, not what was read
    // earlier. Without the FOR UPDATE re-read this assertion fails with the stale value.
    const { ops } = await runMerge({
      id: DROP_ID,
      companyName: 'Real Merge Co. Ltd',
      slug: 'real-merge-co-ltd-o',
      openDate: '2026-09-09',
      symbol: 'CHANGED-BY-CONCURRENT-WRITER',
      faceValue: '10.00',
    });
    const log = ops.find((o) => o.kind === 'insert-merge-log') as
      | { kind: 'insert-merge-log'; values: Record<string, unknown> }
      | undefined;
    const snap = log?.values.dropRow as Record<string, unknown>;
    expect(snap.symbol).toBe('CHANGED-BY-CONCURRENT-WRITER');
  });
});
