/**
 * Unit tests for the IPO list live-metrics merge (T-261, issue #89).
 *
 * Regression guard for the defect these tests were written against: `/api/ipos`
 * served the permanently-NULL `ipos.gmp_price` / `ipos.subscription_*` columns,
 * so every open IPO looked like it had no GMP and no subscription even though
 * `gmp_records` / `subscriptions` held fresh rows for it.
 */

import { describe, it, expect } from 'vitest';
import {
  mergeLiveMetrics,
  type LiveMetricsSnapshot,
} from '@/lib/repositories/live-metrics-merge';

const snapshot = (over: Partial<LiveMetricsSnapshot> = {}): LiveMetricsSnapshot => ({
  gmp: 310,
  gmpPercentage: 39.34,
  gmpTimestamp: new Date('2026-08-21T18:06:00.000Z'),
  gmpSource: 'INVESTORGAIN_GMP',
  subscriptionTotal: '0.95',
  subscriptionRetail: '0.67',
  subscriptionQib: '1.69',
  subscriptionHni: '0.63',
  subscriptionTimestamp: new Date('2026-08-21T23:44:23.400Z'),
  ...over,
});

const emptyRow = () => ({
  id: 'ipo-1',
  companyName: 'Augmont Enterprises Ltd.',
  gmpPrice: null,
  gmpPercentageHistorical: null,
  subscriptionTotal: null,
  subscriptionRetail: null,
  subscriptionQib: null,
  subscriptionHni: null,
});

describe('mergeLiveMetrics', () => {
  it('fills the NULL list columns from the newest time-series snapshot', () => {
    const merged = mergeLiveMetrics(emptyRow(), snapshot());

    expect(merged.gmpPrice).toBe(310);
    expect(merged.gmpPercentageHistorical).toBe(39.34);
    expect(merged.subscriptionTotal).toBe('0.95');
    expect(merged.subscriptionRetail).toBe('0.67');
    expect(merged.subscriptionQib).toBe('1.69');
    expect(merged.subscriptionHni).toBe('0.63');
  });

  it('records honest attribution for the derived values', () => {
    const merged = mergeLiveMetrics(emptyRow(), snapshot());

    expect(merged.gmpSource).toBe('INVESTORGAIN_GMP');
    expect(merged.gmpUpdatedAt).toBe('2026-08-21T18:06:00.000Z');
    expect(merged.subscriptionUpdatedAt).toBe('2026-08-21T23:44:23.400Z');
  });

  it('keeps a stored value and does NOT claim it came from the time series', () => {
    const merged = mergeLiveMetrics(
      { ...emptyRow(), gmpPrice: '42.00', subscriptionTotal: '3.10' },
      snapshot()
    );

    expect(merged.gmpPrice).toBe('42.00');
    expect(merged.subscriptionTotal).toBe('3.10');
    expect(merged.gmpSource).toBeNull();
    expect(merged.gmpUpdatedAt).toBeNull();
    expect(merged.subscriptionUpdatedAt).toBeNull();
  });

  it('preserves a real GMP of 0 — a flat grey market is a value, not a miss', () => {
    const merged = mergeLiveMetrics(emptyRow(), snapshot({ gmp: 0, gmpPercentage: 0 }));

    expect(merged.gmpPrice).toBe(0);
    expect(merged.gmpPercentageHistorical).toBe(0);
    expect(merged.gmpSource).toBe('INVESTORGAIN_GMP');
  });

  it('leaves everything null when the IPO has no time-series rows — never fabricates', () => {
    const merged = mergeLiveMetrics(emptyRow(), undefined);

    expect(merged.gmpPrice).toBeNull();
    expect(merged.gmpPercentageHistorical).toBeNull();
    expect(merged.subscriptionTotal).toBeNull();
    expect(merged.subscriptionRetail).toBeNull();
    expect(merged.subscriptionQib).toBeNull();
    expect(merged.subscriptionHni).toBeNull();
    expect(merged.gmpSource).toBeNull();
    expect(merged.gmpUpdatedAt).toBeNull();
    expect(merged.subscriptionUpdatedAt).toBeNull();
  });

  it('fills GMP even when only subscription is missing, and vice versa', () => {
    const gmpOnly = mergeLiveMetrics(
      emptyRow(),
      snapshot({ subscriptionTotal: null, subscriptionRetail: null, subscriptionQib: null, subscriptionHni: null, subscriptionTimestamp: null })
    );
    expect(gmpOnly.gmpPrice).toBe(310);
    expect(gmpOnly.subscriptionTotal).toBeNull();
    expect(gmpOnly.subscriptionUpdatedAt).toBeNull();

    const subOnly = mergeLiveMetrics(
      emptyRow(),
      snapshot({ gmp: null, gmpPercentage: null, gmpTimestamp: null, gmpSource: null })
    );
    expect(subOnly.subscriptionTotal).toBe('0.95');
    expect(subOnly.gmpPrice).toBeNull();
    expect(subOnly.gmpSource).toBeNull();
    expect(subOnly.gmpUpdatedAt).toBeNull();
  });

  it('does not drop the row\'s other columns', () => {
    const merged = mergeLiveMetrics(emptyRow(), snapshot());
    expect(merged.id).toBe('ipo-1');
    expect(merged.companyName).toBe('Augmont Enterprises Ltd.');
  });

  it('tolerates an unparseable timestamp by reporting no freshness rather than a bad one', () => {
    const merged = mergeLiveMetrics(emptyRow(), snapshot({ gmpTimestamp: 'not-a-date' }));
    expect(merged.gmpPrice).toBe(310);
    expect(merged.gmpUpdatedAt).toBeNull();
  });
});
