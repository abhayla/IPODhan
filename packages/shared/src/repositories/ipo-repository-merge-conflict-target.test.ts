/**
 * Item 1 slice s18, review round 2: a unit guard for `mergeDuplicateInto`'s
 * `field_sources` ON CONFLICT arbiter.
 *
 * Why this exists as a UNIT test even though
 * `scraper/tests/integration/duplicate-ipo-merge.integration.test.ts` already
 * proves the same thing against real Postgres: that file runs only in the
 * `scraper-document-integration` job. This one runs in the shared-package unit
 * job, which is on every PR. The two catch different things — this one catches
 * the target list drifting from the constraint; the integration one catches the
 * constraint itself being wrong.
 *
 * It is not a shim that fakes a constraint. It drives the REAL
 * `mergeDuplicateInto` with a stub db and asserts what the real code passes as
 * the arbiter, exactly as `scraper/tests/unit/scripts/repair-tool.test.ts`
 * MUTATION 4 does for `upsertFieldSource`.
 *
 * The failure it guards against: after slice s18 the only unique index on
 * `field_sources` is (ipo_id, table_name, row_key, field_name). Postgres
 * resolves ON CONFLICT to an arbiter index matching the target list EXACTLY,
 * and `idx_field_sources_ipo_table_field` is not unique, so a 3-column target
 * here raises 42P10 — inside the transaction that also carries the value write,
 * which therefore rolls back with it.
 */
import { describe, it, expect, vi } from 'vitest';
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

/**
 * A stub whose `execute` answers the three raw queries mergeDuplicateInto makes
 * (current_database, the FK discovery, and the per-child counts) and whose
 * `select` answers the two builder reads (the two ipos rows, then the
 * provenance rows). Returning NO foreign keys keeps `direct` empty, so the
 * repoint/delete loop is skipped and the transaction body reduces to the value
 * update, the provenance upsert this test is about, and the redirect.
 */
function makeStubDb() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const insertValues = vi.fn().mockReturnValue({
    onConflictDoUpdate,
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  });
  const txInsert = vi.fn().mockReturnValue({ values: insertValues });

  const tx = {
    insert: txInsert,
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    execute: vi.fn().mockResolvedValue({ rows: [] }),
  };

  const execute = vi.fn(async (query: unknown) => {
    const text = JSON.stringify(query ?? '');
    if (text.includes('current_database')) {
      return { rows: [{ current_database: 'ipodhan_test' }] };
    }
    // FK discovery and the per-child counts both tolerate an empty result.
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

describe('IPORepository.mergeDuplicateInto — field_sources ON CONFLICT arbiter (item 1 slice s18)', () => {
  it('MUTATION: dropping rowKey from the target turns this red — the arbiter must name (ipo_id, table_name, row_key, field_name)', async () => {
    const { db, onConflictDoUpdate } = makeStubDb();
    const repo = new IPORepository(db, mockRedis);

    // setIssueSize forces exactly one patch entry, so the provenance upsert runs
    // without depending on the carry-if-absent planner's field choices.
    const result = await repo.mergeDuplicateInto(KEEP_ID, DROP_ID, {
      apply: true,
      setIssueSize: '123.45',
    });

    expect(result.applied).toBe(true);
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);

    const target = onConflictDoUpdate.mock.calls[0][0].target as Array<{ name: string }>;
    expect(target.map((c) => c.name)).toEqual(['ipo_id', 'table_name', 'row_key', 'field_name']);
  });
});
