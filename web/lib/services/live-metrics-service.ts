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
  gmp: number | null; // grey market premium in ₹ (latest)
  gmpPercent: number | null; // GMP as % of issue price (latest)
  gmpUpdatedAt: string | null; // ISO timestamp of the latest GMP snapshot
  gmpTrend: 'up' | 'down' | 'flat' | null; // latest vs the prior snapshot
  gmpSeries: number[]; // GMP values, oldest→newest, for a sparkline
  totalSubscription: number | null; // total subscription multiple (x)
}

export type LiveMetricsMap = Record<string, LiveMetric>;

const GMP_TREND_WINDOW_DAYS = 30;

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
      const [gmpHistory, subscription] = await Promise.all([
        // newest→oldest, last 30d — one fetch gives latest + prior + series
        gmpRepo.findByIPO({ ipoId: id, days: GMP_TREND_WINDOW_DAYS, limit: 60 }).catch(() => []),
        subRepo.findLatest(id).catch(() => null),
      ]);

      const latest = gmpHistory[0] ?? null;
      const prior = gmpHistory[1] ?? null;
      const latestGmp = toNum(latest?.gmp ?? null);
      const priorGmp = toNum(prior?.gmp ?? null);

      let gmpTrend: LiveMetric['gmpTrend'] = null;
      if (latestGmp !== null && priorGmp !== null) {
        gmpTrend = latestGmp > priorGmp ? 'up' : latestGmp < priorGmp ? 'down' : 'flat';
      }

      // oldest→newest for the sparkline; drop non-finite points
      const gmpSeries = [...gmpHistory]
        .reverse()
        .map((r) => toNum(r.gmp))
        .filter((n): n is number => n !== null);

      return [
        id,
        {
          gmp: latestGmp,
          gmpPercent: toNum(latest?.gmpPercentage ?? null),
          gmpUpdatedAt: latest?.timestamp ? new Date(latest.timestamp).toISOString() : null,
          gmpTrend,
          gmpSeries,
          totalSubscription: toNum(subscription?.totalSubscription ?? null),
        },
      ];
    })
  );

  return Object.fromEntries(entries);
}
