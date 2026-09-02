/**
 * W-03 follow-up — subscription chart reads default to CONSOLIDATED rows.
 *
 * `subscriptions.scope` (BSE_ONLY | NSE_ONLY | CONSOLIDATED, nullable for
 * pre-W-03 rows) exists so a BSE-only book (e.g. 1.23x) is not plotted as if
 * it were the same series as the consolidated book (e.g. 3.61x). The chart
 * data path (`findByIPO`/`findLatest`) MUST default to CONSOLIDATED-or-null
 * rows, with an explicit `{ scope }` escape hatch — including `'ALL'` for a
 * caller that wants every row regardless of scope — and MUST NOT let a
 * cached CONSOLIDATED result leak into an ALL/BSE_ONLY/NSE_ONLY read (or
 * vice versa).
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape),
 * so this stays a unit test — no Postgres, no Redis.
 */
import { describe, it, expect, vi } from 'vitest';
import { SubscriptionRepository } from './subscription-repository';

const IPO_ID = '0b7e81cd-3426-4376-9bc8-1b3b07fa9a93';

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
        orderBy: () => chain,
        limit: () => Promise.resolve(selectResult),
        then: (resolve: any, reject: any) =>
          Promise.resolve(selectResult).then(resolve, reject),
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

function makeRepo(selectResult: any[] = []) {
  const { db, whereArgs } = makeDb(selectResult);
  const redis = makeRedis();
  return { repo: new SubscriptionRepository(db, redis), whereArgs, redis };
}

/**
 * Flatten a drizzle SQL fragment into the literal text it carries plus every
 * bound parameter value, so a test can assert on what actually reaches
 * Postgres rather than on the builder object's shape.
 */
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

describe('SubscriptionRepository.findByIPO — scope filtering', () => {
  it('defaults to CONSOLIDATED-or-null rows (excludes BSE_ONLY/NSE_ONLY)', async () => {
    const { repo, whereArgs } = makeRepo();

    await repo.findByIPO({ ipoId: IPO_ID });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('CONSOLIDATED');
    expect(where.params).not.toContain('BSE_ONLY');
    expect(where.params).not.toContain('NSE_ONLY');
    // The null branch (pre-W-03 rows) must still be present in the OR.
    expect(where.text.join(' ')).toMatch(/is null/i);
  });

  it('scope: "ALL" carries no scope predicate at all', async () => {
    const { repo, whereArgs } = makeRepo();

    await repo.findByIPO({ ipoId: IPO_ID, scope: 'ALL' });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).not.toContain('CONSOLIDATED');
    expect(where.params).not.toContain('BSE_ONLY');
    expect(where.params).not.toContain('NSE_ONLY');
  });

  it('scope: "BSE_ONLY" filters to exactly that exchange book', async () => {
    const { repo, whereArgs } = makeRepo();

    await repo.findByIPO({ ipoId: IPO_ID, scope: 'BSE_ONLY' });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('BSE_ONLY');
    expect(where.params).not.toContain('CONSOLIDATED');
  });

  it('scope: "NSE_ONLY" filters to exactly that exchange book', async () => {
    const { repo, whereArgs } = makeRepo();

    await repo.findByIPO({ ipoId: IPO_ID, scope: 'NSE_ONLY' });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('NSE_ONLY');
    expect(where.params).not.toContain('CONSOLIDATED');
  });

  it('cache key differs by scope option — a CONSOLIDATED read and an ALL read never collide', async () => {
    const redis = makeRedis();
    const { db } = makeDb();
    const repo = new SubscriptionRepository(db, redis);

    await repo.findByIPO({ ipoId: IPO_ID });
    await repo.findByIPO({ ipoId: IPO_ID, scope: 'ALL' });
    await repo.findByIPO({ ipoId: IPO_ID, scope: 'BSE_ONLY' });

    const getKeys = redis.get.mock.calls.map((c: any[]) => c[0]);
    expect(new Set(getKeys).size).toBe(getKeys.length);
    expect(getKeys.some((k: string) => k.includes('CONSOLIDATED'))).toBe(true);
    expect(getKeys.some((k: string) => k.includes('ALL'))).toBe(true);
    expect(getKeys.some((k: string) => k.includes('BSE_ONLY'))).toBe(true);
  });
});

describe('SubscriptionRepository.findLatest — scope filtering', () => {
  it('defaults to CONSOLIDATED-or-null rows', async () => {
    const { repo, whereArgs } = makeRepo([{ id: 'row-1' }]);

    await repo.findLatest(IPO_ID);

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('CONSOLIDATED');
    expect(where.params).not.toContain('BSE_ONLY');
    expect(where.text.join(' ')).toMatch(/is null/i);
  });

  it('scope: "ALL" carries no scope predicate', async () => {
    const { repo, whereArgs } = makeRepo([{ id: 'row-1' }]);

    await repo.findLatest(IPO_ID, { scope: 'ALL' });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).not.toContain('CONSOLIDATED');
  });

  it('scope: "NSE_ONLY" filters to exactly that exchange book', async () => {
    const { repo, whereArgs } = makeRepo([{ id: 'row-1' }]);

    await repo.findLatest(IPO_ID, { scope: 'NSE_ONLY' });

    const where = flattenSql(whereArgs[0]);
    expect(where.params).toContain('NSE_ONLY');
    expect(where.params).not.toContain('CONSOLIDATED');
  });

  it('cache key differs by scope option', async () => {
    const redis = makeRedis();
    const { db } = makeDb([{ id: 'row-1' }]);
    const repo = new SubscriptionRepository(db, redis);

    await repo.findLatest(IPO_ID);
    await repo.findLatest(IPO_ID, { scope: 'ALL' });

    const getKeys = redis.get.mock.calls.map((c: any[]) => c[0]);
    expect(new Set(getKeys).size).toBe(getKeys.length);
    expect(getKeys.some((k: string) => k.includes('CONSOLIDATED'))).toBe(true);
    expect(getKeys.some((k: string) => k.includes('ALL'))).toBe(true);
  });
});
