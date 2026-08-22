/**
 * Per-run registry of IPOs for which a CONSOLIDATED (whole-market)
 * subscription snapshot has already been written this cycle (T-266).
 *
 * WHY THIS EXISTS
 * ---------------
 * `subscriptions` has no source column and every read path takes the newest
 * row by timestamp (`ipo-repository.ts` DISTINCT ON, `findLatest`, the detail
 * query). In a `--source=all` run NSE writes first and BSE writes second, so
 * without a guard the BSE-only figure - one side of the bid book, typically a
 * third to a half of the real demand - lands last and becomes the number the
 * site publishes as "subscribed N times".
 *
 * That is exactly the T-264 P1-2 defect: Augmont shown at 0.95x while it was
 * 2.74x covered. The registry makes the rule explicit and cheap: once a
 * consolidated snapshot exists for an IPO in this run, a partial snapshot for
 * the same IPO is suppressed rather than allowed to supersede it.
 *
 * Deliberately in-process and per-run. The scraper is a one-shot CLI
 * (`ipodhan-scraper` is PM2 fork + cron_restart, see
 * `.claude/rules/pm2-scheduled-one-shot-scraper.md`), so process lifetime IS
 * the cycle. Nothing to persist, nothing to expire.
 */

import logger from '../utils/logger.js';

const consolidatedThisRun = new Set<string>();

/** Record that a whole-market snapshot was written for this IPO. */
export function markConsolidatedSubscription(ipoId: string): void {
  consolidatedThisRun.add(ipoId);
}

/** Has a whole-market snapshot already been written for this IPO this run? */
export function hasConsolidatedSubscription(ipoId: string): boolean {
  return consolidatedThisRun.has(ipoId);
}

/** Test/CLI helper - clears the registry between runs. */
export function resetSubscriptionCoverageRegistry(): void {
  consolidatedThisRun.clear();
}

/**
 * Decide whether a snapshot may be written.
 *
 * A partial (EXCHANGE_ONLY, or unlabelled - which every pre-T-266 source is)
 * snapshot is suppressed when a consolidated one already landed for the same
 * IPO in this run. Anything consolidated always writes.
 */
export function shouldPersistSubscriptionSnapshot(
  ipoId: string,
  coverage: 'CONSOLIDATED' | 'EXCHANGE_ONLY' | undefined,
  context: { companyName?: string; source?: string } = {}
): boolean {
  if (coverage === 'CONSOLIDATED') return true;

  if (hasConsolidatedSubscription(ipoId)) {
    logger.warn(
      {
        ipoId,
        companyName: context.companyName,
        source: context.source,
        coverage: coverage ?? 'unlabelled',
      },
      'Partial subscription snapshot suppressed - a consolidated whole-market snapshot already landed this run (T-266)'
    );
    return false;
  }

  return true;
}
