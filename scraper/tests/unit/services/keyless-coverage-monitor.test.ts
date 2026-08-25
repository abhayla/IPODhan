/**
 * T-318 (ITEM 2): keyless-coverage-monitor.ts tests.
 *
 * `getKeylessCoverage` reports how many `ipos` rows have neither a symbol
 * nor an isin — the rows the T-318 key-first identity tiers can never
 * resolve via a natural key, and which therefore rely on name-based
 * matching as the fallback tail of the resolver chain.
 */
import { describe, it, expect, vi } from 'vitest';
import { getKeylessCoverage } from '../../../src/services/keyless-coverage-monitor.js';

/** Minimal chainable mock matching `db.select(...).from(...).where(...)` usage. */
function makeDb(totalCount: number, keylessCount: number) {
  const select = vi.fn();
  select
    .mockReturnValueOnce({
      from: () => Promise.resolve([{ value: totalCount }]),
    })
    .mockReturnValueOnce({
      from: () => ({
        where: () => Promise.resolve([{ value: keylessCount }]),
      }),
    });
  return { select } as any;
}

describe('getKeylessCoverage', () => {
  it('returns 0/0/0% for an empty table (cold-start / fresh DB) without dividing by zero', async () => {
    const db = makeDb(0, 0);

    const report = await getKeylessCoverage(db);

    expect(report).toEqual({ totalCount: 0, keylessCount: 0, keylessPct: 0 });
  });

  it('computes the correct percentage for a mixed table (69/303 measured in prod)', async () => {
    const db = makeDb(303, 69);

    const report = await getKeylessCoverage(db);

    expect(report.totalCount).toBe(303);
    expect(report.keylessCount).toBe(69);
    expect(report.keylessPct).toBeCloseTo(22.8, 1);
  });

  it('returns 0% keyless when every row has a natural key', async () => {
    const db = makeDb(100, 0);

    const report = await getKeylessCoverage(db);

    expect(report.keylessPct).toBe(0);
  });

  it('returns 100% keyless when no row has a natural key', async () => {
    const db = makeDb(50, 50);

    const report = await getKeylessCoverage(db);

    expect(report.keylessPct).toBe(100);
  });
});
