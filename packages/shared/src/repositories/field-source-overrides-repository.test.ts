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

// ---- MAJOR-4 fix (S4 review round 2): fast unit-level expiry-predicate guard --------------------
// The DB integration test proves expiry is enforced end-to-end, but a total mutation that DELETES
// the expiry predicate from both queries left all 38 pre-existing unit tests green -- only the
// slow integration test caught it. This asserts the ACTUAL `where(...)` condition object built by
// each query contains the `expires_at` column and a `>` comparison, so removing/weakening the
// predicate fails HERE, at unit speed, without a DB.
function safeStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[circular]';
      seen.add(val);
    }
    return val;
  });
}

describe('FieldSourceOverridesRepository -- expiry predicate is present in the built query (MAJOR-4, mutation-proof)', () => {
  function capturingDb() {
    const captured: { where?: unknown } = {};
    const chain = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn((cond: unknown) => {
        captured.where = cond;
        return chain;
      }),
      orderBy: vi.fn().mockResolvedValue([]),
    };
    return { db: chain as never, captured };
  }

  it('MUTATION TARGET: listActiveFor builds a where() clause referencing expires_at with a > comparison', async () => {
    const { db, captured } = capturingDb();
    const repo = new FieldSourceOverridesRepository({ db });
    await repo.listActiveFor('ipos', 'issue_size', new Date('2026-01-01T00:00:00.000Z'));

    const serialized = safeStringify(captured.where);
    // The exact assertion that a `.filter((row) => true)` or a predicate-stripped mutation fails:
    // both the timestamp column name and a strict-greater-than operator must appear together.
    expect(serialized).toContain('expires_at');
    expect(serialized).toMatch(/expires_at[\s\S]*?>|>[\s\S]*?expires_at/);
    expect(serialized).toContain('2026-01-01T00:00:00.000Z');
  });

  it('MUTATION TARGET: listActive builds a where() clause referencing expires_at with a > comparison', async () => {
    const { db, captured } = capturingDb();
    const repo = new FieldSourceOverridesRepository({ db });
    await repo.listActive(new Date('2026-01-01T00:00:00.000Z'));

    const serialized = safeStringify(captured.where);
    expect(serialized).toContain('expires_at');
    expect(serialized).toMatch(/expires_at[\s\S]*?>|>[\s\S]*?expires_at/);
    expect(serialized).toContain('2026-01-01T00:00:00.000Z');
  });
});

// ---- MAJOR-5 fix (S4 review round 2): deterministic tiebreak on the ORDER BY itself ------------
describe('FieldSourceOverridesRepository -- orderBy has a deterministic secondary key (MAJOR-5, mutation-proof)', () => {
  function capturingOrderByDb() {
    const captured: { orderByArgs?: unknown[] } = {};
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn((...args: unknown[]) => {
        captured.orderByArgs = args;
        return Promise.resolve([]);
      }),
    };
    return { db: chain as never, captured };
  }

  it('MUTATION TARGET: listActiveFor orders by TWO columns (setAt desc, then id desc) -- a single-column setAt-only sort is not a deterministic tiebreak', async () => {
    const { db, captured } = capturingOrderByDb();
    const repo = new FieldSourceOverridesRepository({ db });
    await repo.listActiveFor('ipos', 'issue_size');
    expect(captured.orderByArgs).toBeDefined();
    expect(captured.orderByArgs!.length).toBe(2);
  });

  it('MUTATION TARGET: listActive orders by TWO columns (setAt desc, then id desc)', async () => {
    const { db, captured } = capturingOrderByDb();
    const repo = new FieldSourceOverridesRepository({ db });
    await repo.listActive();
    expect(captured.orderByArgs).toBeDefined();
    expect(captured.orderByArgs!.length).toBe(2);
  });
});
