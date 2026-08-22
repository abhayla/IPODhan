import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createSubscriptionSnapshot } from '../../../src/services/data-persister.js';
import {
  hasConsolidatedSubscription,
  markConsolidatedSubscription,
  resetSubscriptionCoverageRegistry,
  shouldPersistSubscriptionSnapshot,
} from '../../../src/services/subscription-coverage-registry.js';

/**
 * T-266 — the guard that stops a one-exchange figure being republished as the
 * whole-market number.
 *
 * `subscriptions` has no source column and every read path takes the newest row
 * by timestamp. In a `--source=all` run NSE writes first and BSE writes second,
 * so without this guard BSE's partial book always lands last and wins the
 * display. That is precisely how prod ended up telling investors Augmont was
 * 0.95x subscribed when it was 2.74x covered (T-264 P1-2).
 */
describe('T-266 subscription coverage guard', () => {
  beforeEach(() => {
    resetSubscriptionCoverageRegistry();
  });

  it('starts empty', () => {
    expect(hasConsolidatedSubscription('ipo-1')).toBe(false);
  });

  it('lets a consolidated snapshot through and remembers it', () => {
    expect(shouldPersistSubscriptionSnapshot('ipo-1', 'CONSOLIDATED')).toBe(true);
    markConsolidatedSubscription('ipo-1');
    expect(hasConsolidatedSubscription('ipo-1')).toBe(true);
  });

  it('suppresses a later EXCHANGE_ONLY snapshot for the same IPO', () => {
    markConsolidatedSubscription('ipo-1');
    expect(
      shouldPersistSubscriptionSnapshot('ipo-1', 'EXCHANGE_ONLY', { source: 'BSE' })
    ).toBe(false);
  });

  it('suppresses an UNLABELLED snapshot too (every pre-T-266 source is unlabelled)', () => {
    markConsolidatedSubscription('ipo-1');
    expect(shouldPersistSubscriptionSnapshot('ipo-1', undefined, { source: 'BSE' })).toBe(false);
  });

  it('still lets a consolidated snapshot through after one already landed', () => {
    // A later cycle within the same long-running process must be able to
    // refresh the figure - the guard is about coverage, not about writing once.
    markConsolidatedSubscription('ipo-1');
    expect(shouldPersistSubscriptionSnapshot('ipo-1', 'CONSOLIDATED')).toBe(true);
  });

  it('does not leak across IPOs', () => {
    markConsolidatedSubscription('ipo-1');
    expect(shouldPersistSubscriptionSnapshot('ipo-2', 'EXCHANGE_ONLY')).toBe(true);
  });

  it('does not leak across runs', () => {
    markConsolidatedSubscription('ipo-1');
    resetSubscriptionCoverageRegistry();
    expect(shouldPersistSubscriptionSnapshot('ipo-1', 'EXCHANGE_ONLY')).toBe(true);
  });

  it('permits a partial snapshot when NSE produced nothing at all', () => {
    // NSE down -> no consolidated snapshot -> BSE's partial figure is the best
    // available and MUST still be written. Suppression is conditional, not a
    // blanket ban on BSE.
    expect(
      shouldPersistSubscriptionSnapshot('ipo-1', 'EXCHANGE_ONLY', { source: 'BSE' })
    ).toBe(true);
  });
});

/**
 * The same guard, exercised through the real persister entry point the
 * orchestrators call, so the wiring is proven and not just the helper.
 */
describe('T-266 createSubscriptionSnapshot honours the guard', () => {
  const makeSub = (coverage?: 'CONSOLIDATED' | 'EXCHANGE_ONLY', total = 1) => ({
    ipoCompanyName: 'Augmont Enterprises Limited',
    ipoSymbol: 'AUGMONT',
    qibSubscription: 1,
    niiSubscription: 1,
    retailSubscription: 1,
    totalSubscription: total,
    coverage,
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    resetSubscriptionCoverageRegistry();
  });

  it('writes the consolidated snapshot, then suppresses the partial one', async () => {
    const createSnapshot = vi.fn().mockImplementation(async () => ({ id: 'snap-1' }));
    const repo = { createSnapshot } as any;

    const consolidatedId = await createSubscriptionSnapshot(
      repo,
      'ipo-1',
      makeSub('CONSOLIDATED', 2.74) as any,
      { source: 'NSE' }
    );
    expect(consolidatedId).toBe('snap-1');
    expect(createSnapshot).toHaveBeenCalledTimes(1);

    const partialId = await createSubscriptionSnapshot(
      repo,
      'ipo-1',
      makeSub('EXCHANGE_ONLY', 0.95) as any,
      { source: 'BSE' }
    );
    expect(partialId).toBeNull();
    // The critical assertion: no second insert, so the newest row - the one
    // every read path serves - is still the whole-market figure.
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes the partial snapshot when no consolidated one landed', async () => {
    const createSnapshot = vi.fn().mockImplementation(async () => ({ id: 'snap-2' }));
    const repo = { createSnapshot } as any;

    const id = await createSubscriptionSnapshot(
      repo,
      'ipo-9',
      makeSub('EXCHANGE_ONLY', 0.95) as any,
      { source: 'BSE' }
    );
    expect(id).toBe('snap-2');
    expect(createSnapshot).toHaveBeenCalledTimes(1);
  });
});
