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
import { notifyOwner } from './owner-notify.js';

/** Snapshots this far below the persisted total are float/rounding noise, not a real drop. */
const MATERIAL_DROP_EPSILON = 0.005;

// T-306 F4 follow-up: a non-authoritative candidate that jumps to more than
// this many times the last persisted total in ONE snapshot is far more likely
// to be a source/parsing glitch than a genuine surge — a real subscription
// curve does not typically 10x between two ~30-min scrape cycles.
export const MAX_UPWARD_JUMP_FACTOR = 10;

// How many CONSECUTIVE cycles a lower/blocked candidate must be suppressed for
// this IPO before we page the owner — a single suppression is normal (the
// persisted total is usually correct); a run of them means the floor is
// probably wrong and needs manual review.
export const SUPPRESSION_ALERT_THRESHOLD = 5;

const SUPPRESSION_COUNT_KEY_PREFIX = 'subscription:suppressed-cycles:';
// Auto-reset if the IPO is abandoned/delisted mid-streak so the counter key
// does not live forever.
const SUPPRESSION_COUNT_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SubscriptionSnapshotCandidate {
  totalSubscription: number;
  totalSharesBid?: number | null;
}

/**
 * Minimal store interface the consecutive-suppression counter needs — matches
 * ioredis's `get`/`set`/`del` signatures so the real Redis client satisfies it
 * without an adapter, while tests can pass a trivial in-memory fake.
 */
export interface SuppressionCounterStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * T-306 upper-anomaly guard (F4 follow-up). Flags a candidate that jumps to
 * more than `factor`x the last persisted total in a single snapshot — the
 * same class of bogus-spike write that, once persisted, becomes a permanent
 * floor no lower (correct) figure can pass. Only applies when a persisted
 * total already exists; the very first snapshot for an IPO has nothing to
 * jump from and is never anomalous by this check.
 */
export function isAnomalousUpwardJump(
  candidateTotal: number,
  persistedTotal: number | null,
  factor: number = MAX_UPWARD_JUMP_FACTOR
): boolean {
  if (persistedTotal === null || persistedTotal <= 0) return false;
  return candidateTotal > persistedTotal * factor;
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

  const isFreshAuthoritative =
    coverage === 'CONSOLIDATED' && candidate.totalSharesBid != null;

  const wouldReduce = candidate.totalSubscription < persistedTotal - MATERIAL_DROP_EPSILON;
  if (wouldReduce) {
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

  // T-306 F4 follow-up: reject an implausible upward SPIKE too, unless it is
  // fresh-authoritative — otherwise a bogus high figure lands as a permanent
  // floor that suppresses every correct (lower) figure afterward.
  if (!isFreshAuthoritative && isAnomalousUpwardJump(candidate.totalSubscription, persistedTotal)) {
    logger.warn(
      {
        ipoId,
        companyName: context.companyName,
        source: context.source,
        coverage: coverage ?? 'unlabelled',
        persistedTotal,
        candidateTotal: candidate.totalSubscription,
        maxUpwardJumpFactor: MAX_UPWARD_JUMP_FACTOR,
      },
      'Subscription snapshot suppressed - implausible upward jump without a consolidated, share-count-backed payload (T-306 upper-anomaly guard)'
    );
    return false;
  }

  return true;
}

/**
 * T-306 F4 follow-up. Tracks, per IPO, how many CONSECUTIVE cycles in a row
 * `shouldPersistSubscriptionSnapshot` suppressed a write, and pages the owner
 * once the streak crosses `SUPPRESSION_ALERT_THRESHOLD` (and again every
 * multiple of it, via the dedupeKey + Notifier's own cooldown, so a
 * still-stuck floor keeps escalating rather than alerting once and going
 * silent forever). A successful (non-suppressed) write resets the streak to 0.
 *
 * Fail-open by design (redis-best-effort-fail-open.md): a missing store, or
 * any store error, is logged and treated as "no streak" — this NEVER blocks
 * or delays the write path it observes. Call this AFTER the write decision is
 * known, fire-and-forget from the caller.
 *
 * MANUAL UN-STICK PROCEDURE (when this alert fires): the persisted total is
 * probably a bogus spike that landed before this guard existed, or before a
 * genuine large correction. To clear it: 1) confirm the correct figure against
 * the source site/NSE/BSE directly, 2) `DELETE FROM subscriptions WHERE ipo_id
 * = '<id>' AND total_subscription = '<bad total>'` (or insert a corrected row
 * with a newer timestamp and a value >= the bad one, then let the next cycle's
 * genuine data supersede it), 3) `DEL subscription:suppressed-cycles:<ipoId>`
 * in Redis to clear the streak counter.
 */
export async function recordSuppressionOutcome(
  store: SuppressionCounterStore | null | undefined,
  ipoId: string,
  suppressed: boolean,
  context: { companyName?: string; persistedTotal?: number | null; candidateTotal?: number } = {}
): Promise<{ consecutiveCount: number; alerted: boolean }> {
  if (!store) return { consecutiveCount: 0, alerted: false };
  const key = `${SUPPRESSION_COUNT_KEY_PREFIX}${ipoId}`;

  try {
    if (!suppressed) {
      await store.del(key);
      return { consecutiveCount: 0, alerted: false };
    }

    const prevRaw = await store.get(key);
    const prev = prevRaw ? parseInt(prevRaw, 10) : 0;
    const count = Number.isFinite(prev) ? prev + 1 : 1;
    await store.set(key, String(count), 'EX', SUPPRESSION_COUNT_TTL_SECONDS);

    if (count >= SUPPRESSION_ALERT_THRESHOLD && count % SUPPRESSION_ALERT_THRESHOLD === 0) {
      notifyOwner(
        'P2',
        `Subscription figure stuck for ${context.companyName ?? ipoId}`,
        {
          body: `Suppressed for ${count} consecutive cycles - persisted=${context.persistedTotal ?? 'unknown'}, latest blocked candidate=${context.candidateTotal ?? 'unknown'}. See recordSuppressionOutcome() in subscription-coverage-registry.ts for the manual un-stick procedure.`,
          type: 'subscription-floor-stuck',
          dedupeKey: `subscription-floor-stuck:${ipoId}`,
        }
      );
      return { consecutiveCount: count, alerted: true };
    }
    return { consecutiveCount: count, alerted: false };
  } catch (err) {
    logger.debug(
      { ipoId, error: err instanceof Error ? err.message : String(err) },
      'subscription suppression counter failed (non-fatal)'
    );
    return { consecutiveCount: 0, alerted: false };
  }
}
