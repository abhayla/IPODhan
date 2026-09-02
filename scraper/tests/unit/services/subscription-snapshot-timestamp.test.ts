/**
 * W-38 (2026-09-02) — `createSubscriptionSnapshot` was stamping
 * `subscriptions.timestamp` with the persistence time instead of the source's
 * own observation time (`scrapedSubscription.timestamp`), so a payload NSE
 * stamped `2026-09-02T12:32:26.913Z` was stored as a much-later wall-clock
 * value. Charts/freshness checks read the wrong observation time, and a
 * stale re-write looked fresh.
 *
 * `resolveSubscriptionSnapshotTimestamp` is the pure decision function
 * `createSubscriptionSnapshot` now delegates to. Tested directly (no DB/repo
 * mocking needed) so the timestamp-resolution logic itself is covered
 * in isolation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSubscriptionSnapshotTimestamp } from '../../../src/services/data-persister.js';

describe('resolveSubscriptionSnapshotTimestamp (W-38)', () => {
  const ctx = { ipoId: 'ipo-1', companyName: 'Deepa Jewellers' };

  beforeEach(() => {
    vi.useRealTimers();
  });

  it('honours a present, parseable source timestamp instead of now()', () => {
    const sourceIso = '2026-09-02T12:32:26.913Z';
    const result = resolveSubscriptionSnapshotTimestamp(sourceIso, ctx);

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.toISOString()).toBe(sourceIso);
  });

  it('accepts a Date instance as the source timestamp', () => {
    const sourceDate = new Date('2026-09-01T00:00:00.000Z');
    const result = resolveSubscriptionSnapshotTimestamp(sourceDate, ctx);

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBe(sourceDate.getTime());
  });

  it('falls back to now() when the source timestamp is absent', () => {
    const before = Date.now();
    const result = resolveSubscriptionSnapshotTimestamp(undefined, ctx);
    const after = Date.now();

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it('falls back to now() when the source timestamp is unparseable', () => {
    const before = Date.now();
    const result = resolveSubscriptionSnapshotTimestamp('not-a-date', ctx);
    const after = Date.now();

    expect('skip' in result).toBe(false);
    if ('skip' in result) throw new Error('unreachable');
    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(after);
  });

  it('skips with a reason when the source timestamp is more than 5 minutes in the future', () => {
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(future, ctx);

    expect('skip' in result).toBe(true);
    if (!('skip' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/future/i);
  });

  it('skips with a reason when the source timestamp is older than 30 days', () => {
    const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(stale, ctx);

    expect('skip' in result).toBe(true);
    if (!('skip' in result)) throw new Error('unreachable');
    expect(result.reason).toMatch(/30 days/i);
  });

  it('accepts a source timestamp within the 5-minute future tolerance', () => {
    const nearFuture = new Date(Date.now() + 4 * 60 * 1000).toISOString();
    const result = resolveSubscriptionSnapshotTimestamp(nearFuture, ctx);

    expect('skip' in result).toBe(false);
  });
});
