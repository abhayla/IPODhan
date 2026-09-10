/**
 * Item 1 slice s18, review round 2: a DB-free guard on the ON CONFLICT arbiter
 * of `FieldSourcesRepository.trackFieldUpdate` — the WEB copy (web/lib/repositories/field-sources-repository.ts), the byte-parallel twin the Next.js app consumes.
 *
 * Round 2 found the asymmetry this closes: the two sites s18 fixed late
 * (ipo-repository.ts, repair-tool.ts) each got a stub-db unit guard, while the
 * two ORIGINAL trackFieldUpdate targets — the ones this whole slice exists for
 * — had none. They were covered only by the integration job, which needs a live
 * Postgres AND the file's presence in a hand-maintained allow-list in
 * pr-gate.yml. Both of those dependencies had already failed this slice once.
 *
 * Same technique as scraper/tests/unit/scripts/repair-tool.test.ts MUTATION 4:
 * drive the REAL method with a stub db and assert what it passes as the
 * arbiter. It is not a shim that fakes a constraint.
 */
import { describe, it, expect, vi } from 'vitest';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';

function makeStubDb() {
  const returning = vi.fn().mockResolvedValue([{ id: 'row-1', rowKey: '' }]);
  const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  const insert = vi.fn().mockReturnValue({ values });
  const db = { insert, select: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() } as unknown as never;
  return { db, onConflictDoUpdate };
}

const stubRedis = {
  get: vi.fn(),
  set: vi.fn(),
  setex: vi.fn(),
  del: vi.fn().mockResolvedValue(0),
  keys: vi.fn().mockResolvedValue([]),
} as unknown as never;

describe('FieldSourcesRepository.trackFieldUpdate — ON CONFLICT arbiter, web copy (item 1 slice s18)', () => {
  it('MUTATION: dropping rowKey from the target turns this red — the arbiter must name (ipo_id, table_name, row_key, field_name)', async () => {
    const { db, onConflictDoUpdate } = makeStubDb();
    const repo = new FieldSourcesRepository(db, stubRedis);

    await repo.trackFieldUpdate({
      ipoId: '00000000-0000-4000-8000-000000000001',
      tableName: 'financial_statements',
      rowKey: 'FY2025',
      fieldName: 'revenue',
      source: 'DRHP',
    } as never);

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const target = onConflictDoUpdate.mock.calls[0][0].target as Array<{ name: string }>;
    expect(target.map((c) => c.name)).toEqual(['ipo_id', 'table_name', 'row_key', 'field_name']);
  });
});
