import { describe, it, expect, vi } from 'vitest';

import { createSubscriptionSnapshot } from '../../../src/services/data-persister.js';
import {
  shouldPersistSubscriptionSnapshot,
  isAnomalousUpwardJump,
  recordSuppressionOutcome,
  SUPPRESSION_ALERT_THRESHOLD,
  MAX_UPWARD_JUMP_FACTOR,
} from '../../../src/services/subscription-coverage-registry.js';

vi.mock('../../../src/services/owner-notify.js', () => ({
  notifyOwner: vi.fn(),
}));
import { notifyOwner } from '../../../src/services/owner-notify.js';

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

describe('T-306 F4 follow-up — upper-anomaly guard (reject an implausible spike, not just a drop)', () => {
  it('isAnomalousUpwardJump: flags a candidate more than the configured factor above the persisted total', () => {
    expect(isAnomalousUpwardJump(30, 2)).toBe(true); // 15x jump
    expect(isAnomalousUpwardJump(15, 2)).toBe(false); // 7.5x, under the 10x default
    expect(isAnomalousUpwardJump(5, null)).toBe(false); // no persisted total, nothing to jump from
    expect(isAnomalousUpwardJump(5, 0)).toBe(false); // persisted 0 is not a real anchor
  });

  it('isAnomalousUpwardJump honours a custom factor', () => {
    expect(isAnomalousUpwardJump(6, 2, 2)).toBe(true); // 3x > factor 2
    expect(isAnomalousUpwardJump(3, 2, 2)).toBe(false); // 1.5x <= factor 2
  });

  it('REJECTS a non-authoritative candidate that spikes >10x the persisted total (the un-sticking bug source)', () => {
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'EXCHANGE_ONLY',
        { totalSubscription: 25 }, // 12.5x
        2
      )
    ).toBe(false);
  });

  it('ALLOWS a large jump when the candidate is CONSOLIDATED and carries totalSharesBid (fresh authoritative)', () => {
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'CONSOLIDATED',
        { totalSubscription: 25, totalSharesBid: 100000 },
        2
      )
    ).toBe(true);
  });

  it(`does not flag a normal jump under the ${MAX_UPWARD_JUMP_FACTOR}x factor`, () => {
    expect(
      shouldPersistSubscriptionSnapshot(
        'ipo-1',
        'EXCHANGE_ONLY',
        { totalSubscription: 8 }, // 4x — a real late-book-building surge
        2
      )
    ).toBe(true);
  });
});

describe('T-306 F4 follow-up — recordSuppressionOutcome (consecutive-suppression alert + un-stick)', () => {
  function makeFakeStore() {
    const data = new Map<string, string>();
    return {
      data,
      get: vi.fn(async (key: string) => data.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        data.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        data.delete(key);
        return 1;
      }),
    };
  }

  it('no-ops (never throws) when no store is provided', async () => {
    const r = await recordSuppressionOutcome(null, 'ipo-1', true);
    expect(r).toEqual({ consecutiveCount: 0, alerted: false });
  });

  it('resets the streak to 0 on a successful (non-suppressed) write', async () => {
    const store = makeFakeStore();
    store.data.set('subscription:suppressed-cycles:ipo-1', '3');
    const r = await recordSuppressionOutcome(store, 'ipo-1', false);
    expect(r).toEqual({ consecutiveCount: 0, alerted: false });
    expect(store.del).toHaveBeenCalledWith('subscription:suppressed-cycles:ipo-1');
  });

  it(`does NOT alert before ${SUPPRESSION_ALERT_THRESHOLD} consecutive suppressions`, async () => {
    const store = makeFakeStore();
    let last;
    for (let i = 0; i < SUPPRESSION_ALERT_THRESHOLD - 1; i++) {
      last = await recordSuppressionOutcome(store, 'ipo-1', true, { companyName: 'Acme' });
    }
    expect(last!.consecutiveCount).toBe(SUPPRESSION_ALERT_THRESHOLD - 1);
    expect(last!.alerted).toBe(false);
    expect(notifyOwner).not.toHaveBeenCalled();
  });

  it(`fires a Notifier P2 alert with a stable dedupeKey at the ${SUPPRESSION_ALERT_THRESHOLD}th consecutive suppression`, async () => {
    const store = makeFakeStore();
    let last;
    for (let i = 0; i < SUPPRESSION_ALERT_THRESHOLD; i++) {
      last = await recordSuppressionOutcome(store, 'ipo-1', true, {
        companyName: 'Acme',
        persistedTotal: 21.66,
        candidateTotal: 8.15,
      });
    }
    expect(last!.consecutiveCount).toBe(SUPPRESSION_ALERT_THRESHOLD);
    expect(last!.alerted).toBe(true);
    expect(notifyOwner).toHaveBeenCalledTimes(1);
    expect(notifyOwner).toHaveBeenCalledWith(
      'P2',
      expect.stringContaining('Acme'),
      expect.objectContaining({ dedupeKey: 'subscription-floor-stuck:ipo-1', type: 'subscription-floor-stuck' })
    );
  });

  it('is fail-open: a store that throws is swallowed, never rejects', async () => {
    const throwing = {
      get: vi.fn().mockRejectedValue(new Error('redis down')),
      set: vi.fn(),
      del: vi.fn(),
    };
    await expect(recordSuppressionOutcome(throwing as any, 'ipo-1', true)).resolves.toEqual({
      consecutiveCount: 0,
      alerted: false,
    });
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
