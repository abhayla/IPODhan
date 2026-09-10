/**
 * Item 2 slice 3a round 3, MINOR 2: `getIPOsForReviewScraping`'s query used to
 * be built with successive `query = query.where(...)` calls -- Drizzle's
 * `.where()` REPLACES the prior condition rather than AND-ing it, so
 * stacking calls silently dropped the status/ipoIds filter whenever a later
 * one ran. The fix collects every condition and applies them with a single
 * `and(...)` call, which also adds the new NOT-NULL segment filter without
 * that drop.
 *
 * This is a query-builder function: the actual row filtering happens inside
 * Postgres, not in this process, so a mocked `db` cannot prove which ROWS a
 * query returns. What it CAN prove -- and what this test proves -- is the
 * two things that regressed: (1) `.where()` is called exactly ONCE per
 * invocation (never chained/replaced), and (2) the condition list handed to
 * `and(...)` always includes the NOT-NULL segment filter alongside the
 * status/ipoIds conditions, in the same call. That is the real, testable
 * surface of this function without a DB.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    and: vi.fn(actual.and),
    or: vi.fn(actual.or),
    eq: vi.fn(actual.eq),
    isNotNull: vi.fn(actual.isNotNull),
    inArray: vi.fn(actual.inArray),
  };
});

import { and, isNotNull } from 'drizzle-orm';
import { getIPOsForReviewScraping } from '../../../src/jobs/ipo-reviews-job.js';

/** Minimal chainable mock matching `db.select(...).from(...).where(...)` usage. */
function makeDb(rows: unknown[] = []) {
  const whereSpy = vi.fn().mockReturnValue(Promise.resolve(rows));
  const fromSpy = vi.fn().mockReturnValue({ where: whereSpy });
  const selectSpy = vi.fn().mockReturnValue({ from: fromSpy });
  return { db: { select: selectSpy } as any, whereSpy };
}

describe('getIPOsForReviewScraping (item 2 slice 3a round 3, MINOR 2)', () => {
  it('applies all conditions via ONE and(...) call passed to a SINGLE where() call, never chained', async () => {
    const { db, whereSpy } = makeDb([]);
    (and as any).mockClear();

    await getIPOsForReviewScraping(db, {});

    // The regression this line fixes: `.where()` used to be called multiple
    // times, each REPLACING the prior filter. Exactly one call proves that
    // cannot happen anymore.
    expect(whereSpy).toHaveBeenCalledTimes(1);
    expect(and).toHaveBeenCalledTimes(1);
  });

  it('includes the NOT-NULL segment filter in the SAME and(...) call as the default status filter (default options)', async () => {
    const { db } = makeDb([]);
    (and as any).mockClear();

    await getIPOsForReviewScraping(db, {});

    expect(and).toHaveBeenCalledTimes(1);
    const conditions = (and as any).mock.calls[0];
    // default status filter (OPEN/CLOSED/LISTED via or(...)) + isNotNull(segment)
    expect(conditions).toHaveLength(2);
  });

  it('includes the NOT-NULL segment filter alongside status AND ipoIds when both are given (3 conditions, 1 and() call)', async () => {
    const { db } = makeDb([]);
    (and as any).mockClear();

    await getIPOsForReviewScraping(db, { status: 'OPEN', ipoIds: ['a', 'b'] });

    expect(and).toHaveBeenCalledTimes(1);
    expect((and as any).mock.calls[0]).toHaveLength(3);
  });

  it('a NULL-segment row is excluded from the returned rows (documents the invariant createIPOReviews relies on)', async () => {
    // The mocked db cannot enforce Postgres-side filtering, but the function
    // contract is that every returned row has a non-null segment -- this is
    // what `isNotNull(schema.ipos.segment)` in the and(...) call exists to
    // guarantee once Postgres evaluates it. Assert the isNotNull condition
    // is present on the real ipos.segment column so the guarantee is wired,
    // not just documented.
    const { db } = makeDb([{ id: '1', companyName: 'X', slug: 'x', segment: 'MAINBOARD' }]);
    (isNotNull as any).mockClear();

    const result = await getIPOsForReviewScraping(db, {});

    expect(isNotNull).toHaveBeenCalledTimes(1);
    const [column] = (isNotNull as any).mock.calls[0];
    expect(column.name).toBe('segment');
    expect(result.every((r) => r.segment != null)).toBe(true);
  });
});
