/**
 * Freshness monitor (T-195) — evaluates each source's last successful scrape
 * (per `ScraperLogRepository.getLastSuccess`, the SAME source the admin
 * `/api/admin/scraper/status` route already reads — see
 * `web/app/api/admin/scraper/status/route.ts`) against the SLO config in
 * `freshness-slo.ts`. Breach -> notifyOwner P1, once per source per hour
 * (dedupeKey), fail-open/non-fatal per `.claude/rules/non-fatal-side-effects.md`.
 *
 * Cold-start rule: a source that has NEVER logged a successful scrape
 * (`lastSuccess === null`) is NOT alerted on — that is either a genuinely new
 * source or a fresh/empty database (e.g. a fresh deploy or a local dev DB),
 * and alerting on "never ran yet" would be a guaranteed false-positive alert
 * storm on every cold environment. This mirrors the existing
 * `/api/admin/scraper/status` null-lastRun handling (GitHub #3): "a null
 * lastRun means 'never ran', NOT 'stale'".
 */
import type { ScraperLogRepository } from '@ipodhan/shared';
import { getActiveFreshnessSLOs, type FreshnessSLO } from '../config/freshness-slo.js';
import { isMarketHoursIST } from '../scheduler/due-step-cycle.js';
import { notifyOwner } from './owner-notify.js';
import logger from '../utils/logger.js';

export interface FreshnessEvaluation {
  source: string;
  dataClass: string;
  maxStalenessMs: number;
  lastSuccessAt: Date | null;
  stalenessMs: number | null;
  breached: boolean;
  coldStart: boolean;
  /** Round-3 C4: true when the source was skipped because it is off-duty at `now` (marketHoursOnly). */
  outsideEvaluationWindow?: boolean;
}

/**
 * Evaluate every source in `FRESHNESS_SLOS` and fire a P1 owner alert for
 * each breach. Returns the full evaluation array (used by tests and by
 * callers that want to log/report without re-deriving the state).
 */
export async function evaluateFreshness(
  scraperLogRepository: Pick<ScraperLogRepository, 'getLastSuccess'>,
  now: Date = new Date()
): Promise<FreshnessEvaluation[]> {
  const evaluations: FreshnessEvaluation[] = [];

  for (const slo of getActiveFreshnessSLOs()) {
    const evaluation = await evaluateSource(scraperLogRepository, slo, now);
    evaluations.push(evaluation);

    if (evaluation.breached) {
      const hours = (evaluation.stalenessMs! / (60 * 60 * 1000)).toFixed(1);
      notifyOwner(
        'P1',
        `Freshness SLO breach: ${slo.source} (${slo.dataClass})`,
        {
          body: `Last successful scrape was ${hours}h ago; SLO is ${(slo.maxStalenessMs / (60 * 1000)).toFixed(0)}min. ${slo.justification}`,
          type: 'freshness-breach',
          // Hourly dedupe bucket — one page per source per hour, not one per cycle (every 30 min).
          dedupeKey: `freshness:${slo.source}:${now.toISOString().slice(0, 13)}`,
        }
      );
      logger.error(
        { source: slo.source, dataClass: slo.dataClass, stalenessMs: evaluation.stalenessMs, maxStalenessMs: slo.maxStalenessMs },
        'Freshness SLO breach'
      );
    }
  }

  return evaluations;
}

async function evaluateSource(
  scraperLogRepository: Pick<ScraperLogRepository, 'getLastSuccess'>,
  slo: FreshnessSLO,
  now: Date
): Promise<FreshnessEvaluation> {
  // Round-3 C4: a `marketHoursOnly` source is only SCHEDULED inside weekday
  // 10:00-17:00 IST. Outside that window it is not stale, it is off-duty —
  // evaluating it there is how a correctly-behaving system pages the owner P1
  // at 02:00 on a Saturday.
  if (slo.marketHoursOnly && !isMarketHoursIST(now)) {
    return {
      source: slo.source,
      dataClass: slo.dataClass,
      maxStalenessMs: slo.maxStalenessMs,
      lastSuccessAt: null,
      stalenessMs: null,
      breached: false,
      coldStart: false,
      outsideEvaluationWindow: true,
    };
  }

  try {
    const lastSuccess = await scraperLogRepository.getLastSuccess(slo.source);

    if (!lastSuccess) {
      // Cold start: this source has never logged a success. Do not alert —
      // see module doc comment.
      return {
        source: slo.source,
        dataClass: slo.dataClass,
        maxStalenessMs: slo.maxStalenessMs,
        lastSuccessAt: null,
        stalenessMs: null,
        breached: false,
        coldStart: true,
      };
    }

    const stalenessMs = now.getTime() - new Date(lastSuccess.createdAt).getTime();

    return {
      source: slo.source,
      dataClass: slo.dataClass,
      maxStalenessMs: slo.maxStalenessMs,
      lastSuccessAt: new Date(lastSuccess.createdAt),
      stalenessMs,
      breached: stalenessMs > slo.maxStalenessMs,
      coldStart: false,
    };
  } catch (error) {
    // A DB read failure must not crash the watchdog cycle (non-fatal-side-effects.md).
    logger.warn(
      { source: slo.source, error: error instanceof Error ? error.message : String(error) },
      'Freshness evaluation failed for source (non-fatal)'
    );
    return {
      source: slo.source,
      dataClass: slo.dataClass,
      maxStalenessMs: slo.maxStalenessMs,
      lastSuccessAt: null,
      stalenessMs: null,
      breached: false,
      coldStart: true,
    };
  }
}
