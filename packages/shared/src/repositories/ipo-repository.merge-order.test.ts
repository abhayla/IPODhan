/**
 * DEFECT 2 (2026-09-16 staging dedupe repair, PM-C item 12): `mergeDuplicateInto`
 * wrote the carried-column UPDATE on the survivor BEFORE deleting the dropped
 * `ipos` row. Any column CARRY_IF_ABSENT_COLUMNS carries that is also
 * UNIQUE-constrained on `ipos` can then briefly exist on BOTH rows inside the
 * transaction, which Postgres refuses — crashing the whole merge (observed on
 * staging: icelectricals, symbol='ICELCO' on both rows, transaction rolled
 * back, nothing written).
 *
 * This test does not touch a database — it exercises the real
 * `IPORepository.mergeDuplicateInto` transaction body against a fake `db`
 * that records the ORDER of its calls, and asserts the dropped `ipos` row's
 * DELETE is issued before any UPDATE that could carry a unique-constrained
 * column onto the survivor. One case per column in CARRY_IF_ABSENT_COLUMNS
 * that intersects a real UNIQUE constraint on `ipos` (checked against
 * packages/shared/src/db/schema.ts + every migration under
 * web/drizzle/migrations/ — today the only such constraint is `ipos_slug_unique`
 * on `slug`, and `slug` is NEVER a carried column, so the intersection is
 * currently empty; the ordering fix and this test both stand as the guard for
 * the day a carried column IS added there). `symbol` is included as a red-line
 * regression case even though it carries no DB-level unique constraint today,
 * because it is exactly the column that crashed the real merge on staging.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';
import { CARRY_IF_ABSENT_COLUMNS } from '../utils/duplicate-ipo-merge';

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const DROP_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Columns in CARRY_IF_ABSENT_COLUMNS that carry a real UNIQUE constraint on
 * `ipos` today. Verified against schema.ts (only `.unique()` call inside the
 * `ipos` pgTable definition is on `slug`) and every migration under
 * web/drizzle/migrations/ (only `ipos_slug_unique` touches `ipos`). `slug` is
 * not itself in CARRY_IF_ABSENT_COLUMNS, so this list is empty by inspection —
 * recorded here, not asserted as non-empty, so a future column added to BOTH
 * a unique constraint and CARRY_IF_ABSENT_COLUMNS is caught by extending this
 * list, not by this test silently vacuously passing.
 */
const UNIQUE_CARRIED_COLUMNS: readonly string[] = CARRY_IF_ABSENT_COLUMNS.filter((c) =>
  (['slug'] as readonly string[]).includes(c)
);

type Op =
  | { kind: 'child-repoint-or-delete'; table: string }
  | { kind: 'delete-drop-ipos-row' }
  | { kind: 'update-carried-column'; column: string };

/**
 * A fake `db`/`tx` implementing exactly the call shapes
 * `IPORepository.mergeDuplicateInto` makes, recording every mutating
 * operation's kind + order. Reads return fixed fixtures; nothing here talks
 * to a real database.
 */
function buildFakeDb(carriedColumn: string) {
  const ops: Op[] = [];
  const keepRow = {
    id: KEEP_ID,
    companyName: 'Real Merge Co Ltd',
    slug: 'real-merge-co-ltd',
    openDate: '2026-09-09',
    [toCamel(carriedColumn)]: null, // survivor is missing it, so it gets carried
  } as Record<string, unknown>;
  const dropRow = {
    id: DROP_ID,
    companyName: 'Real Merge Co. Ltd',
    slug: 'real-merge-co-ltd-o',
    openDate: '2026-09-09',
    [toCamel(carriedColumn)]: 'CARRIED-VALUE',
  } as Record<string, unknown>;

  function toCamel(col: string): string {
    return col.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
  }

  // `direct` child tables discovered from the (fake) FK graph: one REPOINT
  // table and one plain scraper-owned table, matching the real shape.
  const directTables = [
    { table: 'user_watchlist', col: 'ipo_id' }, // in REPOINT_TABLES
    { table: 'subscriptions', col: 'ipo_id' }, // not in REPOINT_TABLES
  ];

  function makeQueryBuilder(kind: 'select-ipos' | 'select-field-sources' | 'other') {
    return {
      from: () => ({
        where: async () => {
          if (kind === 'select-ipos') return [keepRow, dropRow];
          if (kind === 'select-field-sources') return [];
          return [];
        },
      }),
    };
  }

  function makeTx(recordOps: boolean) {
    const record = (op: Op) => {
      if (recordOps) ops.push(op);
    };
    return {
      update: (_table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            // Only the survivor's carried-column UPDATE matters for this test;
            // `updatedAt` always rides along, so key off the carried column's
            // camelCase JS key being present in the set() payload.
            if (toCamel(carriedColumn) in values) {
              record({ kind: 'update-carried-column', column: carriedColumn });
            }
          },
        }),
      }),
      insert: (_table: unknown) => ({
        values: () => ({
          onConflictDoNothing: async () => undefined,
          onConflictDoUpdate: async () => undefined,
        }),
      }),
      delete: (_table: unknown) => ({
        where: async () => {
          record({ kind: 'delete-drop-ipos-row' });
        },
      }),
      execute: async (query: { queryChunks?: { value?: unknown }[] } | unknown) => {
        // Drizzle's `sql\`...\`` builds a `queryChunks` array of typed chunk
        // objects (StringChunk / Name / raw param value) — `String(query)`
        // does not reconstruct usable SQL text from it, so walk the chunks
        // and pull each one's identifier/string value instead.
        const chunks = (query as { queryChunks?: { value?: unknown }[] })?.queryChunks ?? [];
        const text = chunks
          .map((c) => (Array.isArray(c?.value) ? c.value.join('') : String(c?.value ?? '')))
          .join(' ');
        if (/^\s*savepoint/i.test(text) || /^\s*release savepoint/i.test(text) || /^\s*rollback to savepoint/i.test(text)) {
          return { rows: [] };
        }
        // information_schema FK discovery
        if (/information_schema/i.test(text)) {
          return {
            rows: directTables.map((t) => ({ child: t.table, col: t.col, parent: 'ipos' })),
          };
        }
        // per-table keep/drop counts for the plan report
        if (/count\(\*\) filter/i.test(text)) {
          return { rows: [{ keep: 0, drop: 1 }] };
        }
        // current_database() prod guard — not exercised (apply against non-prod)
        if (/current_database/i.test(text)) {
          return { rows: [{ current_database: 'ipodhan_test' }] };
        }
        // child-table repoint/delete statements issued via tx.execute(sql`...`)
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

  const db = {
    execute: makeTx(false).execute,
    select: (_cols?: unknown) => makeQueryBuilder('select-ipos'),
    transaction: async (cb: (tx: ReturnType<typeof makeTx>) => Promise<void>) => {
      const tx = makeTx(true);
      await cb(tx);
    },
  };

  // `this.db.select({...}).from(fieldSources)...` (provenance reads) must
  // return [] regardless of the projection object passed — override select
  // to detect the field_sources shape by checking for a `fieldName` key in
  // the projection.
  const realSelect = db.select.bind(db);
  db.select = ((cols?: Record<string, unknown>) => {
    if (cols && 'fieldName' in cols) return makeQueryBuilder('select-field-sources');
    return realSelect();
  }) as typeof db.select;

  return { db, ops };
}

describe('mergeDuplicateInto — dropped-row delete happens before a unique-constrained carried-column UPDATE (DEFECT 2)', () => {
  const casesToTest = Array.from(new Set([...UNIQUE_CARRIED_COLUMNS, 'symbol']));

  it.each(casesToTest)('column "%s": DELETE on the dropped ipos row is issued before its carried-column UPDATE', async (column) => {
    const { db, ops } = buildFakeDb(column);
    const repo = new IPORepository(db as never, { del: vi.fn() } as never);

    await repo.mergeDuplicateInto('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', {
      apply: true,
    });

    const deleteIdx = ops.findIndex((o) => o.kind === 'delete-drop-ipos-row');
    const updateIdx = ops.findIndex((o) => o.kind === 'update-carried-column' && o.column === column);

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(updateIdx);

    // MUTATION CHECK: reordering the transaction back to UPDATE-then-DELETE
    // (the original bug) makes deleteIdx > updateIdx and this assertion red.
  });

  it('every REPOINT_TABLES / child-table repoint-or-delete statement is also issued before the dropped ipos row delete', async () => {
    const { db, ops } = buildFakeDb('symbol');
    const repo = new IPORepository(db as never, { del: vi.fn() } as never);

    await repo.mergeDuplicateInto('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', {
      apply: true,
    });

    const deleteDropRowIdx = ops.findIndex((o) => o.kind === 'delete-drop-ipos-row');
    const childOpIdxs = ops
      .map((o, i) => (o.kind === 'child-repoint-or-delete' ? i : -1))
      .filter((i) => i >= 0);

    expect(childOpIdxs.length).toBeGreaterThan(0);
    for (const i of childOpIdxs) {
      expect(i).toBeLessThan(deleteDropRowIdx);
    }
    // WHY THIS ORDER: most FKs into `ipos` are ON DELETE CASCADE (schema.ts). Deleting
    // the dropped `ipos` row before repointing REPOINT_TABLES rows would let Postgres
    // cascade-delete person-created data (user_watchlist, ipo_reviews, ...) that this
    // loop exists to save by repointing, not deleting.
  });
});
