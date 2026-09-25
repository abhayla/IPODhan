/**
 * #1068 sweep finding (same class as #755/#753/#1065): `mergeDuplicateInto`'s `field_sources`
 * `onConflictDoUpdate` sets `dataLineage` to a plain object
 * (`{ tool: 'merge-duplicate-ipo', mergedFrom: dropId, ... }`), which REPLACES the whole jsonb
 * column on conflict instead of merging — destroying whatever `docType`/other keys an earlier
 * write on the SAME (ipo, table, row, field) had set.
 *
 * Stub reused from ipo-repository-merge-conflict-target.test.ts (item 1 slice s18): drives the
 * REAL `mergeDuplicateInto` with a stub db and asserts what it passes as the onConflictDoUpdate
 * `set` clause.
 *
 * RED before the fix: `set.dataLineage` is the caller's raw
 * `{ tool: 'merge-duplicate-ipo', ... }` object, with no reference to the existing row's
 * dataLineage at all.
 *
 * MAJOR 1 (Tier A round 2 on #1072): the "not a plain object" check alone is a mutation hole
 * (M3) -- a REPLACE written as raw SQL with no `COALESCE(...) ||` merge is also "not a plain
 * object" and would pass. Compile the actual SQL via drizzle's own `PgDialect` and assert it
 * contains the coalesce-merge over the EXISTING `field_sources.data_lineage` column.
 */
import { describe, it, expect, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { IPORepository } from './ipo-repository';

const KEEP_ID = '00000000-0000-4000-8000-00000000ke01';
const DROP_ID = '00000000-0000-4000-8000-00000000dr01';

function ipoRow(id: string, slug: string) {
  return {
    id,
    slug,
    companyName: 'Merge Fixture Ltd.',
    openDate: '2026-09-08',
    issueSize: null,
  } as unknown as Record<string, unknown>;
}

function makeStubDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate,
    onConflictDoNothing: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'redirect-1' }]) }),
    returning: vi.fn().mockResolvedValue([{ id: 'log-1' }]),
  });
  const txInsert = vi.fn().mockReturnValue({ values: insertValues });

  const txSelect = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockImplementation(() => {
        const rows = [{ id: DROP_ID, slug: 'drop-slug' }];
        return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) });
      }),
    }),
  });

  const tx = {
    insert: txInsert,
    select: txSelect,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    execute: vi.fn(async (query: unknown) =>
      JSON.stringify(query ?? '').includes('to_jsonb(i.*)')
        ? {
            rows: [ipoRow(KEEP_ID, 'merge-keep'), ipoRow(DROP_ID, 'merge-drop')].map((r) => ({
              id: (r as { id: string }).id,
              row: JSON.stringify(r),
            })),
          }
        : { rows: [] }
    ),
  };

  const execute = vi.fn(async (query: unknown) => {
    const text = JSON.stringify(query ?? '');
    if (text.includes('current_database')) {
      return { rows: [{ current_database: 'ipodhan_test' }] };
    }
    return { rows: [] };
  });

  let selectCall = 0;
  const select = vi.fn(() => {
    selectCall += 1;
    const rows = selectCall === 1 ? [ipoRow(KEEP_ID, 'merge-keep'), ipoRow(DROP_ID, 'merge-drop')] : [];
    return { from: () => ({ where: () => Promise.resolve(rows) }) };
  });

  const db = {
    execute,
    select,
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => cb(tx)),
  } as unknown as never;

  return { db, onConflictDoUpdate };
}

const mockRedis = {
  get: vi.fn(),
  setex: vi.fn(),
  set: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

describe('IPORepository.mergeDuplicateInto — field_sources dataLineage MERGE, never replace (#1068 sweep)', () => {
  it('the onConflictDoUpdate set.dataLineage is not a plain replacing object — it merges via SQL, preserving prior keys', async () => {
    const { db, onConflictDoUpdate } = makeStubDb();
    const repo = new IPORepository(db, mockRedis);

    const result = await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, {
      apply: true,
      setIssueSize: '123.45',
    });

    expect(result.applied).toBe(true);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);

    const setClause = onConflictDoUpdate.mock.calls[0][0].set as Record<string, unknown>;
    const isPlainReplacingObject =
      setClause.dataLineage !== null &&
      typeof setClause.dataLineage === 'object' &&
      !('queryChunks' in (setClause.dataLineage as object)) &&
      !('sql' in (setClause.dataLineage as object));
    expect(isPlainReplacingObject).toBe(false);

    // MAJOR 1: "not a plain object" is not enough (M3) -- assert the compiled SQL actually
    // merges over the EXISTING column rather than just wrapping the replacement in `sql`.
    const compiled = new PgDialect().sqlToQuery(setClause.dataLineage as SQL);
    expect(compiled.sql).toMatch(/COALESCE\("field_sources"\."data_lineage",\s*'\{\}'::jsonb\)\s*\|\|/i);
  });
});
