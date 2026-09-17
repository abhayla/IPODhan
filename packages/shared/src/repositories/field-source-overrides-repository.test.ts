// implements: item 3 slice S4 -- field_source_overrides repository, table-absent safety property
import { describe, it, expect, vi } from 'vitest';
import { FieldSourceOverridesRepository, isMissingTableError } from './field-source-overrides-repository';

function undefinedTableError(): Error & { code: string } {
  const e = new Error('relation "field_source_overrides" does not exist') as Error & { code: string };
  e.code = '42P01';
  return e;
}

describe('isMissingTableError', () => {
  it('true for postgres 42P01 (undefined_table)', () => {
    expect(isMissingTableError(undefinedTableError())).toBe(true);
  });
  it('false for any other error', () => {
    expect(isMissingTableError(new Error('connection refused'))).toBe(false);
    expect(isMissingTableError({ code: '23505' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

describe('FieldSourceOverridesRepository -- table-absent safety property (S4 DoD row S4-4)', () => {
  function throwingDb() {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockRejectedValue(undefinedTableError()),
    };
    return chain as never;
  }

  it('MUTATION TARGET: listActiveFor never throws when the table is absent -- returns [] and warns ONCE', async () => {
    const onTableAbsent = vi.fn();
    const repo = new FieldSourceOverridesRepository({ db: throwingDb(), onTableAbsent });

    const first = await repo.listActiveFor('ipos', 'issue_size');
    const second = await repo.listActiveFor('ipos', 'lot_size');

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(onTableAbsent).toHaveBeenCalledTimes(1); // logged ONCE, never per query
  });

  it('listActive never throws when the table is absent -- returns []', async () => {
    const repo = new FieldSourceOverridesRepository({ db: throwingDb(), onTableAbsent: vi.fn() });
    await expect(repo.listActive()).resolves.toEqual([]);
  });

  it('a REAL (non-missing-table) error still propagates -- the resolver must see a real DB outage, not silence it', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockRejectedValue(new Error('connection refused')),
    };
    const repo = new FieldSourceOverridesRepository({ db: chain as never });
    await expect(repo.listActiveFor('ipos', 'issue_size')).rejects.toThrow(/connection refused/);
  });
});
