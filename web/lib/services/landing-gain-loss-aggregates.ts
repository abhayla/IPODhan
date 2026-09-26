/**
 * Landing gain/loss aggregates (#98)
 *
 * Computes the "listed in gain / listed in loss" counts and the average
 * gain / average loss that the Mainboard and SME landing summary cards show,
 * from REAL `listing_performance` rows — replacing the mocked 60/40 (Mainboard)
 * and 55/45 (SME) splits and mocked averages (25%/15%, 30%/20%) that were later
 * replaced with nulls as an interim step.
 *
 * Class this fixes: every summary metric derived from a hard-coded split or
 * average instead of stored data, on both segments (MAINBOARD, SME).
 *
 * Source of truth is `listing_performance.listing_gain_percent` (the listing
 * gain, not `current_gain_percent`) — the same column `listing-gains-service.ts`
 * already serves for the per-IPO gain column. A missing row or a null
 * `listing_gain_percent` is EXCLUDED, never counted as 0 or as a loss. A gain
 * of exactly 0.00% counts as neither a gain nor a loss (a flat close is not a
 * gain and not a loss).
 */

import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { ListingPerformanceRepository } from '@/lib/repositories/listing-performance-repository';

export interface GainLossAggregates {
  listedInGain: number | null;
  listedInLoss: number | null;
  gainAOT: number | null;
  lossAOT: number | null;
}

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

/**
 * @param listedIpoIds ids of IPOs already filtered to `status === 'LISTED'`
 *   for the segment being summarized.
 */
export async function computeGainLossAggregates(
  listedIpoIds: string[]
): Promise<GainLossAggregates> {
  if (listedIpoIds.length === 0) {
    // A genuinely empty LISTED population: zero in gain and zero in loss are
    // both true counts (not "unknown"); there is nothing to average.
    return { listedInGain: 0, listedInLoss: 0, gainAOT: null, lossAOT: null };
  }

  try {
    const redis = getRedisClient();
    const repo = new ListingPerformanceRepository(db, redis);
    const rows = await repo.findByIPOIds(listedIpoIds);

    const gains: number[] = [];
    const losses: number[] = [];

    for (const row of rows) {
      const pct = toNum(row.listingGainPercent);
      if (pct === null) continue; // no listing_performance row / null value — excluded, never 0
      if (pct > 0) gains.push(pct);
      else if (pct < 0) losses.push(pct);
      // pct === 0: flat close, counted in neither bucket
    }

    return {
      listedInGain: gains.length,
      listedInLoss: losses.length,
      gainAOT: average(gains),
      // lossAOT is the signed average of the losers' listing_gain_percent
      // values (always <= 0) — never sign-flipped to a fabricated "magnitude".
      lossAOT: average(losses),
    };
  } catch (error) {
    console.error('Error computing gain/loss aggregates:', error);
    return { listedInGain: null, listedInLoss: null, gainAOT: null, lossAOT: null };
  }
}
