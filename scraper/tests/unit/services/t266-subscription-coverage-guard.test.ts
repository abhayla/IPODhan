import { describe, it, expect, vi } from 'vitest';

import { createSubscriptionSnapshot } from '../../../src/services/data-persister.js';
import { shouldPersistSubscriptionSnapshot } from '../../../src/services/subscription-coverage-registry.js';

/**
 * T-266/T-299 — the guard that stops a subscription write from REDUCING the
 * figure the site already publishes for an IPO.
 *
 * `subscriptions` has no source column and every read path takes the newest
 * row by timestamp. Subscription is cumulative - it cannot fall - so a newer
 * row with a lower total is definitionally a partial or corrupt snapshot.
 *
 * T-266's original guard only had in-process memory of "did a consolidated
 * snapshot land THIS run" - it had no memory of what is already in the
 * database, so the FIRST write of a cycle always passed unchecked. That is
 * how prod regressed Tempsens 21.66x -> 8.15x and Augmont 2.74x -> 0.98x on
 * 2026-08-23 (T-296 P1-1, 40+ recurrences since June). T-299 replaces the
 * in-run memory with a comparison against the last PERSISTED row.
 */
describe('T-299 subscription regression guard (persisted-row comparison)', () => {
  it('always writes the first snapshot for an IPO (nothing to regress against)', () => {
    expect(
      shouldPersistSubscriptionSnapshot('ipo-1', undefined, { totalSubscription: 0.5 }, null)
    ).toBe(true);
  });

  it('writes a snapshot that is >= the persisted total', () => {
    expect(
      shouldPersistSubscriptionSnapshot('ipo-1', 'EXCHANGE_ONLY', { totalSubscription: 5 }, 2.74)
    ).toBe(true);
  });

  it('REJECTS a partial snapshot below the persisted total (the T-296 regression, reproduced)', () => {
    // Tempsens: persisted 21.66x; the 01:30 UTC cycle offered 8.15x with no
    // totalSharesBid. Under the old Set-based guard this was the FIRST write
    // of the run, so it passed. It must now be rejected.
    expect(
      shouldPersistSubscriptionSnapshot(
        'tempsens',
        undefined,
        { totalSubscription: 8.15, totalSharesBid: null },
        21.66
      )
    ).toBe(false);
  });

  it('REJECTS a same-labelled EXCHANGE_ONLY drop even without any consolidated snapshot this run', () => {
    // Augmont: persisted 2.74x; candidate 0.98x, EXCHANGE_ONLY, no share count.
    expect(
      shouldPersistSubscriptionSnapshot(
        'augmont',
        'EXCHANGE_ONLY',
        { totalSubscription: 0.98 },
        2.74
      )
    ).toBe(false);
  });

  it('ALLOWS a drop only when the candidate is CONSOLIDATED and carries totalSharesBid', () => {
    // The one shape that is trusted as "a fresh authoritative payload for
    // this cycle" - whole-market coverage plus the raw share count backing it.
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'CONSOLIDATED',
        { totalSubscription: 1.0, totalSharesBid: 100000 },
        2.74
      )
    ).toBe(true);
  });

  it('still rejects a CONSOLIDATED drop that lacks totalSharesBid', () => {
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'CONSOLIDATED',
        { totalSubscription: 1.0, totalSharesBid: null },
        2.74
      )
    ).toBe(false);
  });

  it('tolerates float/rounding noise below the epsilon', () => {
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'EXCHANGE_ONLY',
        { totalSubscription: 2.739 },
        2.74
      )
    ).toBe(true);
  });
});

/**
 * The same guard, exercised through the real persister entry point the
 * orchestrators call, so the wiring is proven and not just the helper.
 */
describe('T-299 createSubscriptionSnapshot honours the persisted-row guard', () => {
  const makeSub = (
    coverage: 'CONSOLIDATED' | 'EXCHANGE_ONLY' | undefined,
    total: number,
    totalSharesBid?: number
  ) => ({
    ipoCompanyName: 'Augmont Enterprises Limited',
    ipoSymbol: 'AUGMONT',
    qibSubscription: 1,
    niiSubscription: 1,
    retailSubscription: 1,
    totalSubscription: total,
    totalSharesBid,
    coverage,
    timestamp: new Date().toISOString(),
  });

  it('rejects a snapshot that would reduce the persisted total, without inserting', async () => {
    const createSnapshot = vi.fn().mockImplementation(async () => ({ id: 'snap-1' }));
    const findLatest = vi.fn().mockResolvedValue({ totalSubscription: '21.66' });
    const repo = { createSnapshot, findLatest } as any;

    const id = await createSubscriptionSnapshot(
      repo,
      'tempsens-id',
      makeSub(undefined, 8.15) as any,
      { source: 'NSE' }
    );

    expect(id).toBeNull();
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it('writes a snapshot that is >= the persisted total', async () => {
    const createSnapshot = vi.fn().mockImplementation(async () => ({ id: 'snap-2' }));
    const findLatest = vi.fn().mockResolvedValue({ totalSubscription: '2.74' });
    const repo = { createSnapshot, findLatest } as any;

    const id = await createSubscriptionSnapshot(
      repo,
      'augmont-id',
      makeSub('CONSOLIDATED', 3.1, 500000) as any,
      { source: 'NSE' }
    );

    expect(id).toBe('snap-2');
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes the first-ever snapshot for an IPO (findLatest returns null)', async () => {
    const createSnapshot = vi.fn().mockImplementation(async () => ({ id: 'snap-3' }));
    const findLatest = vi.fn().mockResolvedValue(null);
    const repo = { createSnapshot, findLatest } as any;

    const id = await createSubscriptionSnapshot(
      repo,
      'ipo-9',
      makeSub('EXCHANGE_ONLY', 0.95) as any,
      { source: 'BSE' }
    );

    expect(id).toBe('snap-3');
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });
});
