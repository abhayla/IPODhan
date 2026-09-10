/**
 * #488 — Drizzle's `.where()` REPLACES the previous where clause rather than
 * ANDing it. `RegistrarRepository.search(query, activeOnly: true)` called
 * `.where(eq(active, true))` then `.where(nameCondition)` on the SAME builder
 * in the SAME branch — the active filter was unconditionally discarded, so a
 * search with `activeOnly = true` returned INACTIVE registrars too.
 *
 * The db is a hand-rolled chainable mock (the drizzle query builder shape),
 * so this stays a unit test — no Postgres, no Redis.
 */
import { describe, it, expect, vi } from 'vitest';
import { RegistrarRepository } from './registrar-repository';

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

/**
 * Flatten a drizzle SQL fragment into the literal text it carries plus every
 * bound parameter value, so a test can assert on what actually reaches
 * Postgres rather than on the builder object's shape.
 */
function flattenSql(node: any, out: { text: string[]; params: unknown[] } = { text: [], params: [] }) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
    // A queryChunks array can carry a raw literal value (not wrapped in a
    // Param/StringChunk) — capture it as a bound parameter.
    out.params.push(node);
    return out;
  }
  if (typeof node !== 'object') return out;
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

describe('RegistrarRepository.search — activeOnly must combine with the name filter', () => {
  it('activeOnly=true: the generated where() carries BOTH the active predicate AND the name search', async () => {
    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new RegistrarRepository(db, redis);

    await repo.search('kfin', true);

    // Exactly one where() call must have been made on the final query — a
    // second call would mean the first is still being silently discarded.
    expect(whereArgs.length).toBe(1);

    const where = flattenSql(whereArgs[0]);
    // The active=true predicate.
    expect(where.params).toContain(true);
    // The name search pattern.
    expect(where.params.some((p) => typeof p === 'string' && p.includes('kfin'))).toBe(true);
  });

  it('activeOnly=false: only the name filter applies (no active predicate)', async () => {
    const { db, whereArgs } = makeDb([]);
    const redis = makeRedis();
    const repo = new RegistrarRepository(db, redis);

    await repo.search('kfin', false);

    expect(whereArgs.length).toBe(1);
    const where = flattenSql(whereArgs[0]);
    expect(where.params).not.toContain(true);
    expect(where.params.some((p) => typeof p === 'string' && p.includes('kfin'))).toBe(true);
  });
});

