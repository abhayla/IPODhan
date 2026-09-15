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
 * column onto the survivor.
 *
 * UNIQUE-CONSTRAINT INTERSECTION — CORRECTED (2026-09-16, coordinator
 * follow-up). `schema.ts` under-declares uniqueness on `ipos`: it has only
 * `.unique()` on `slug` and a plain (non-unique) `index('idx_ipos_symbol')`
 * on `symbol`. The LIVE database disagrees — `pg_indexes` on
 * `ipodhan_staging` lists a real unique index Drizzle's schema never
 * generated and nothing in `web/drizzle/migrations/` creates:
 *
 *     ipos_symbol_key: CREATE UNIQUE INDEX ipos_symbol_key ON public.ipos
 *                       USING btree (symbol)
 *
 * (alongside `ipos_pkey` and `ipos_slug_unique`). That is exactly the
 * constraint the real staging crash hit (icelectricals, `symbol='ICELCO'` on
 * both rows). A class check for "which carried columns are unique-constrained"
 * that only greps `schema.ts` misses this — the class must be read off the
 * LIVE catalog (`pg_indexes` / `information_schema`), not the schema file,
 * because Drizzle's schema and the real database have drifted apart on this
 * exact column. The corrected intersection with `CARRY_IF_ABSENT_COLUMNS` is:
 *   - `symbol` — unique via the undeclared live index `ipos_symbol_key`.
 *   - `slug`   — unique via `ipos_slug_unique` (declared in schema.ts AND
 *                live), but `slug` is never a member of
 *                `CARRY_IF_ABSENT_COLUMNS` — the merge never carries it, it
 *                only redirects it — so it contributes nothing to run here.
 * `schema.ts` is not changed by this PR (the coordinator's instruction) —
 * fixing the drift itself is a separate, schema-owning change.
 */
import { describe, it, expect, vi } from 'vitest';
import { IPORepository } from './ipo-repository';

const KEEP_ID = '11111111-1111-1111-1111-111111111111';
const DROP_ID = '22222222-2222-2222-2222-222222222222';

/**
 * Columns in CARRY_IF_ABSENT_COLUMNS that carry a real UNIQUE constraint on
 * `ipos` TODAY, read off the live database catalog (`pg_indexes` on
 * `ipodhan_staging`: `ipos_pkey`, `ipos_slug_unique`, `ipos_symbol_key`) —
 * not off `schema.ts`, which does not declare `ipos_symbol_key` at all. Only
 * `symbol` is in this list: `slug` is unique too but is never carried (see
 * header comment). This is the class this test guards; extend it the moment
 * another live unique index is found on a carried column, regardless of
 * whether schema.ts has caught up.
 */
const UNIQUE_CARRIED_COLUMNS: readonly string[] = ['symbol'];

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
  // The class guard: every column found unique on the LIVE catalog that is
  // also carried. Today that is exactly ['symbol'] (see header comment).
  it.each(UNIQUE_CARRIED_COLUMNS)('column "%s": DELETE on the dropped ipos row is issued before its carried-column UPDATE', async (column) => {
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

  // Dedicated, explicitly-named case for `symbol` (coordinator follow-up,
  // 2026-09-16): the exact column and value shape from the real staging
  // crash (icelectricals: keep.symbol=null, drop.symbol='ICELCO'), asserted
  // on its own rather than folded only into the generic parameterized loop
  // above, so this specific regression is never silently dropped if
  // UNIQUE_CARRIED_COLUMNS is ever edited.
  it('symbol: DELETE on the dropped ipos row is issued before the survivor is UPDATEd to carry the dropped row\'s symbol (ipos_symbol_key, live unique index, undeclared in schema.ts)', async () => {
    const { db, ops } = buildFakeDb('symbol');
    const repo = new IPORepository(db as never, { del: vi.fn() } as never);

    await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, { apply: true });

    const deleteIdx = ops.findIndex((o) => o.kind === 'delete-drop-ipos-row');
    const updateSymbolIdx = ops.findIndex((o) => o.kind === 'update-carried-column' && o.column === 'symbol');

    expect(deleteIdx).toBeGreaterThanOrEqual(0);
    expect(updateSymbolIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeLessThan(updateSymbolIdx);

    // MUTATION CHECK (verified 2026-09-16): reverting mergeDuplicateInto to
    // UPDATE-then-DELETE order makes deleteIdx > updateSymbolIdx and this
    // assertion goes red (`expected 3 to be less than 2` observed).
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
