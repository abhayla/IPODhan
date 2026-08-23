/**
 * Guard that stops a subscription write from REDUCING the figure the site
 * already publishes for an IPO (T-266, hardened T-299).
 *
 * WHY THIS EXISTS
 * ----------------
 * `subscriptions` has no source column and every read path takes the newest
 * row by timestamp (`ipo-repository.ts` DISTINCT ON, `findLatest`, the detail
 * query). Subscription is cumulative - it can only go up until the book
 * closes - so a newer row with a LOWER total is definitionally a partial or
 * corrupt snapshot, never new information.
 *
 * T-266's original guard was an in-process `Set` that suppressed a partial
 * snapshot only if a consolidated one had already landed *in this run*. That
 * has no memory of what is already in the database, so the very first write
 * of a cycle - before anything else has landed - passes unchecked. That is
 * exactly how prod regressed twice on 2026-08-23: at 01:30 UTC a partial
 * payload wrote first (NSE logged SUCCESS but shipped no subscription figure
 * that cycle), landed unopposed, and the site published Tempsens at 8.15x
 * for 30 minutes when it was actually 21.66x. The same pattern recurred 40+
 * times since June (`db-subs-regressions.txt`, T-296 P1-1).
 *
 * FIX (T-299): compare the incoming total against the LAST PERSISTED row for
 * this IPO, not in-process memory. A total below the persisted total is
 * rejected unless the incoming snapshot is explicitly CONSOLIDATED *and*
 * carries `totalSharesBid` - the two signals together are what "a fresh
 * authoritative payload for this cycle" means for this source shape. Process
 * lifetime no longer matters: the check is correct on the very first write of
 * a cold process, mid-run, or after a restart.
 */

import logger from '../utils/logger.js';

/** Snapshots this far below the persisted total are float/rounding noise, not a real drop. */
const MATERIAL_DROP_EPSILON = 0.005;

export interface SubscriptionSnapshotCandidate {
  totalSubscription: number;
  totalSharesBid?: number | null;
}

/**
 * Decide whether a snapshot may be written.
 *
 * @param persistedTotal - the `totalSubscription` of the last persisted row
 *   for this IPO (null when no prior snapshot exists - always write in that
 *   case, there is nothing to regress against).
 */
export function shouldPersistSubscriptionSnapshot(
  ipoId: string,
  coverage: 'CONSOLIDATED' | 'EXCHANGE_ONLY' | undefined,
  candidate: SubscriptionSnapshotCandidate,
  persistedTotal: number | null,
  context: { companyName?: string; source?: string } = {}
): boolean {
  if (persistedTotal === null) return true;

  const wouldReduce = candidate.totalSubscription < persistedTotal - MATERIAL_DROP_EPSILON;
  if (!wouldReduce) return true;

  const isFreshAuthoritative =
    coverage === 'CONSOLIDATED' && candidate.totalSharesBid != null;
  if (isFreshAuthoritative) return true;

  logger.warn(
    {
      ipoId,
      companyName: context.companyName,
      source: context.source,
      coverage: coverage ?? 'unlabelled',
      persistedTotal,
      candidateTotal: candidate.totalSubscription,
    },
    'Subscription snapshot suppressed - would REDUCE the persisted total without a consolidated, share-count-backed payload (T-299)'
  );
  return false;
}
