/**
 * #488 — Drizzle's `.where()` REPLACES the previous where clause rather than
 * ANDing it. `MarketHolidayRepository.findAll` applied year/exchange/upcoming
 * filters via three INDEPENDENT `if` blocks, each calling `.where()` again on
 * the same builder — so year+exchange together silently dropped the earlier
 * filter and returned the wrong holiday set (which feeds IPO date arithmetic).
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape),
 * so this stays a unit test — no Postgres, no Redis.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { MarketHolidayRepository } from './market-holiday-repository';

function makeDb(selectResult: any[] = []) {
  const whereArgs: any[] = [];
  const db: any = {
    select: vi.fn(() => {
      const chain: any = {
        from: () => chain,
        where: (w: any) => {
          whereArgs.push(w);
          return chain;
        },
        orderBy: () => Promise.resolve(selectResult),
      };
      return chain;
    }),
  };
  return { db, whereArgs };
}

function makeRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
  } as any;
}

function flattenSql(node: any, out: { text: string[]; params: unknown[] } = { text: [], params: [] }) {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const n of node) flattenSql(n, out);
    return out;
  }
  if (Array.isArray(node.queryChunks)) {
    for (const chunk of node.queryChunks) flattenSql(chunk, out);
    return out;
  }
  if (Array.isArray(node.value)) {
    out.text.push(node.value.join(''));
    return out;
  }
  if ('value' in node && typeof node.value !== 'object') {
    out.params.push(node.value);
    return out;
  }
  if (typeof node.name === 'string') {
    out.text.push(node.name);
    return out;
  }
  return out;
}

describe('MarketHolidayRepository — "today" is the IST calendar day, not UTC (#687 slice 3)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('findAll({ upcoming: true }): the date bound uses the IST day at 02:00 IST (still "yesterday" in UTC)', async () => {
    // 2026-09-15T20:30:00Z is 02:00 IST 16-Sep. The UTC calendar day
    // (`new Date().toISOString().split('T')[0]`) reads 2026-09-15 here —
    // one day behind — so a holiday row dated 2026-09-16 would be wrongly
    // excluded as "in the past" by the old code.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'));

    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new MarketHolidayRepository(db, redis);

    await repo.findAll({ upcoming: true });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('2026-09-16');
    expect(where.params).not.toContain('2026-09-15');
  });

  it('findUpcoming(): positive control — a holiday dated one IST day later is not excluded as "today"', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'));

    const { db, whereArgs } = makeDb([]);
    db.select.mockImplementationOnce(() => {
      const chain: any = {
        from: () => chain,
        where: (w: any) => {
          whereArgs.push(w);
          return chain;
        },
        orderBy: () => chain,
        limit: () => Promise.resolve([]),
      };
      return chain;
    });
    const redis = makeRedis();
    const repo = new MarketHolidayRepository(db, redis);

    await repo.findUpcoming(5);

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('2026-09-16');
  });
});

describe('MarketHolidayRepository.findAll — year + exchange filters must combine', () => {
  it('year AND exchange together: the generated where() carries BOTH predicates', async () => {
    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new MarketHolidayRepository(db, redis);

    await repo.findAll({ year: 2026, exchange: 'NSE' });

    // Exactly one where() call — a second call would mean the first filter
    // is still being silently discarded.
    expect(whereArgs.length).toBe(1);

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain(2026);
    expect(where.params).toContain('NSE');
    expect(where.params).toContain('BOTH');
  });

  it('year + exchange + upcoming together: all three predicates survive', async () => {
    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new MarketHolidayRepository(db, redis);

    await repo.findAll({ year: 2026, exchange: 'BSE', upcoming: true });

    expect(whereArgs.length).toBe(1);
    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain(2026);
    expect(where.params).toContain('BSE');
    // upcoming adds a `date >= today` bound param (an ISO date string).
    expect(where.params.some((p) => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p))).toBe(true);
  });

  it('no filters: where() is not called with an empty condition set', async () => {
    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new MarketHolidayRepository(db, redis);

    await repo.findAll();

    // where(undefined) is a valid single call (no-op filter) — never zero.
    expect(whereArgs.length).toBe(1);
    expect(whereArgs[0]).toBeUndefined();
  });
});
