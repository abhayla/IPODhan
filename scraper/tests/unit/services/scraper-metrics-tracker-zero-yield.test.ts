/**
 * T-309 (T-305 round-6 P3) — API_FALLBACK (and any source) that returns 0 rows
 * for consecutive cycles while throwing nothing was logged 'SUCCESS' forever,
 * invisible to the freshness/health monitors. `recordZeroYieldCycle()` tracks
 * the streak; `isZeroYieldDegraded()` is the threshold check
 * `BaseScraperOrchestrator.logSuccess()` uses to downgrade the logged status.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScraperMetricsTracker } from '../../../src/services/scraper-metrics-tracker.js';

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    incr: vi.fn(async (key: string) => {
      const next = (parseInt(store.get(key) ?? '0', 10) + 1);
      store.set(key, String(next));
      return next;
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
    expire: vi.fn(async () => 1),
    setex: vi.fn(async () => 'OK'),
  };
}

describe('ScraperMetricsTracker — zero-yield streak (T-309)', () => {
  let redis: ReturnType<typeof createMockRedis>;
  let tracker: ScraperMetricsTracker;

  beforeEach(() => {
    redis = createMockRedis();
    tracker = new ScraperMetricsTracker(redis as any);
  });

  it('increments the streak on a 0-row cycle', async () => {
    expect(await tracker.recordZeroYieldCycle('API_FALLBACK', 0)).toBe(1);
    expect(await tracker.recordZeroYieldCycle('API_FALLBACK', 0)).toBe(2);
    expect(await tracker.recordZeroYieldCycle('API_FALLBACK', 0)).toBe(3);
  });

  it('resets the streak to 0 on any non-zero yield', async () => {
    await tracker.recordZeroYieldCycle('API_FALLBACK', 0);
    await tracker.recordZeroYieldCycle('API_FALLBACK', 0);
    expect(await tracker.recordZeroYieldCycle('API_FALLBACK', 5)).toBe(0);
    expect(await tracker.getConsecutiveZeroYield('API_FALLBACK')).toBe(0);
  });

  it('is NOT degraded below the 3-strike threshold', () => {
    expect(tracker.isZeroYieldDegraded(0)).toBe(false);
    expect(tracker.isZeroYieldDegraded(1)).toBe(false);
    expect(tracker.isZeroYieldDegraded(2)).toBe(false);
  });

  it('IS degraded at/above the 3-strike threshold (the real API_FALLBACK shape)', () => {
    expect(tracker.isZeroYieldDegraded(3)).toBe(true);
    expect(tracker.isZeroYieldDegraded(10)).toBe(true);
  });

  it('tracks sources independently', async () => {
    await tracker.recordZeroYieldCycle('API_FALLBACK', 0);
    await tracker.recordZeroYieldCycle('API_FALLBACK', 0);
    await tracker.recordZeroYieldCycle('API_FALLBACK', 0);
    expect(await tracker.recordZeroYieldCycle('NSE', 42)).toBe(0);
    expect(await tracker.getConsecutiveZeroYield('API_FALLBACK')).toBe(3);
  });
});
