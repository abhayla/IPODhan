/**
 * Live Metrics Service
 *
 * Shared source of the persona's live decision data — latest GMP (grey market
 * premium) + total subscription — for a set of IPOs, keyed by ipoId. Sourced
 * from the real gmp_records / subscriptions tables via the cached findLatest
 * repository methods. A missing entry means no data yet (never fabricated).
 *
 * Used by the home live tables and the listing pages' Open/Upcoming tabs.
 */

import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { GMPRepository } from '@/lib/repositories/gmp-repository';
import { SubscriptionRepository } from '@/lib/repositories/subscription-repository';

export interface LiveMetric {
  gmp: number | null; // grey market premium in ₹
  gmpPercent: number | null; // GMP as % of issue price
  totalSubscription: number | null; // total subscription multiple (x)
}

export type LiveMetricsMap = Record<string, LiveMetric>;

/**
 * Fetch latest GMP + subscription for the given IPO ids.
 * Best-effort: a per-IPO failure degrades to null for that IPO; the call itself
 * never throws into a page render path.
 */
export async function getLiveMetricsByIds(ipoIds: string[]): Promise<LiveMetricsMap> {
  if (ipoIds.length === 0) return {};

  const redis = getRedisClient();
  const gmpRepo = new GMPRepository(db, redis);
  const subRepo = new SubscriptionRepository(db, redis);

  const toNum = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'string' ? parseFloat(v) : v;
    return Number.isFinite(n) ? n : null;
  };

  const entries = await Promise.all(
    ipoIds.map(async (id): Promise<[string, LiveMetric]> => {
      const [gmpRecord, subscription] = await Promise.all([
        gmpRepo.findLatest(id).catch(() => null),
        subRepo.findLatest(id).catch(() => null),
      ]);
      return [
        id,
        {
          gmp: toNum(gmpRecord?.gmp ?? null),
          gmpPercent: toNum(gmpRecord?.gmpPercentage ?? null),
          totalSubscription: toNum(subscription?.totalSubscription ?? null),
        },
      ];
    })
  );

  return Object.fromEntries(entries);
}
