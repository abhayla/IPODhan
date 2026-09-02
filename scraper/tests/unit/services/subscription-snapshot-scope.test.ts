/**
 * W-03 (2026-09-02) — `subscriptions` rows from BSE (own book) and NSE
 * (consolidated across exchanges) were stored under one shape with no scope
 * label. `resolveSubscriptionScope` is the pure decision function
 * `createSubscriptionSnapshot` delegates to; tested directly (no DB/repo
 * mocking needed), the same pattern as
 * `subscription-snapshot-timestamp.test.ts` for W-38.
 */
import { describe, it, expect } from 'vitest';
import { resolveSubscriptionScope } from '../../../src/services/data-persister.js';

describe('resolveSubscriptionScope (W-03)', () => {
  it('labels a CONSOLIDATED payload CONSOLIDATED regardless of source', () => {
    expect(
      resolveSubscriptionScope({ coverage: 'CONSOLIDATED' }, { source: 'BSE' })
    ).toBe('CONSOLIDATED');
    expect(
      resolveSubscriptionScope({ coverage: 'CONSOLIDATED' }, { source: 'NSE' })
    ).toBe('CONSOLIDATED');
    expect(
      resolveSubscriptionScope({ coverage: 'CONSOLIDATED' }, {})
    ).toBe('CONSOLIDATED');
  });

  it('labels a BSE-sourced, non-consolidated payload BSE_ONLY', () => {
    expect(
      resolveSubscriptionScope({ coverage: undefined }, { source: 'BSE' })
    ).toBe('BSE_ONLY');
    expect(
      resolveSubscriptionScope({ coverage: 'EXCHANGE_ONLY' }, { source: 'BSE' })
    ).toBe('BSE_ONLY');
  });

  it('labels an NSE-sourced, non-consolidated payload NSE_ONLY', () => {
    expect(
      resolveSubscriptionScope({ coverage: 'EXCHANGE_ONLY' }, { source: 'NSE' })
    ).toBe('NSE_ONLY');
  });

  it('is case-insensitive on the source name', () => {
    expect(
      resolveSubscriptionScope({ coverage: undefined }, { source: 'bse' })
    ).toBe('BSE_ONLY');
    expect(
      resolveSubscriptionScope({ coverage: undefined }, { source: 'nse' })
    ).toBe('NSE_ONLY');
  });

  it('returns null for an unrecognized or absent source', () => {
    expect(
      resolveSubscriptionScope({ coverage: undefined }, { source: 'MONEYCONTROL' })
    ).toBeNull();
    expect(
      resolveSubscriptionScope({ coverage: undefined }, {})
    ).toBeNull();
  });
});
