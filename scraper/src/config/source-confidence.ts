/**
 * Per-source field confidence (F6, W-37).
 *
 * Spec: `docs/specs/per-ipo-due-step-pipeline.md` section 6, D-10.
 *
 * Every `field_sources` row carries a `confidence` column that, until this
 * module existed, was written as a constant 100 for EVERY field of EVERY
 * source — so a value scraped from an aggregator was indistinguishable from
 * one read out of a filing. The number is only useful if it says something,
 * so it is derived from three things:
 *
 *  1. the TIER of the source that actually won the field (filings > exchange
 *     APIs > aggregators > the API fallback);
 *  2. how much the sources DISAGREED about it (a value asserted over a
 *     CRITICAL conflict is worth less than an uncontested one);
 *  3. whether a SECOND source independently reported the same value
 *     (confirmation earns a small bonus).
 *
 * `confidenceFor` is a pure function so the rule can be tested as a table and
 * reused anywhere a confidence has to be reported without a DB round-trip.
 */

import type { ScraperSource } from './field-priority-matrix';

export type ConflictSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

/**
 * Base confidence per source tier (D-10).
 *
 * DRHP is the FILING tier: the DRHP source value is what the filing pipeline
 * writes for every prospectus-family document (RHP / PBA / Prospectus), so
 * one entry covers the tier.
 */
export const BASE_SOURCE_CONFIDENCE: Record<ScraperSource, number> = {
  ADMIN: 100, // explicit human override — never in dispute
  DRHP: 100, // filings (DRHP/RHP/PBA/Prospectus)
  NSE: 90, // exchange API
  BSE: 90, // exchange API
  CHITTORGARH: 60, // aggregator
  MONEYCONTROL: 60, // aggregator
  INVESTORGAIN_GMP: 60, // aggregator
  API_FALLBACK: 40, // last-resort fallback
};

/** Confidence for a source the tier table does not know (never fabricate a high number). */
export const UNKNOWN_SOURCE_CONFIDENCE = 40;

export const CRITICAL_CONFLICT_PENALTY = 10;
export const WARNING_CONFLICT_PENALTY = 5;
export const CONFIRMATION_BONUS = 5;
export const CONFIDENCE_FLOOR = 20;
export const CONFIDENCE_CEILING = 100;

export interface ConfidenceAdjustments {
  /** Severities of the conflicts this field's chosen value had to win. */
  conflicts?: ConflictSeverity[];
  /** Number of OTHER sources that independently reported an equal value. */
  confirmations?: number;
}

function penaltyFor(severity: ConflictSeverity): number {
  if (severity === 'CRITICAL') return CRITICAL_CONFLICT_PENALTY;
  if (severity === 'WARNING') return WARNING_CONFLICT_PENALTY;
  return 0; // INFO — a sub-5% numeric wobble is not evidence of unreliability
}

/**
 * Confidence (0-100) to write into `field_sources.confidence` for a value
 * owned by `source`.
 *
 * Order is load-bearing: conflict penalties apply to the base and are clamped
 * at the floor (a disputed value never reads as worthless), THEN confirmations
 * are added and clamped at the ceiling.
 */
export function confidenceFor(
  source: ScraperSource,
  adjustments: ConfidenceAdjustments = {}
): number {
  const base = BASE_SOURCE_CONFIDENCE[source] ?? UNKNOWN_SOURCE_CONFIDENCE;

  const penalty = (adjustments.conflicts ?? []).reduce(
    (sum, severity) => sum + penaltyFor(severity),
    0
  );
  const confirmations = Math.max(0, Math.trunc(adjustments.confirmations ?? 0));

  const afterConflicts = Math.max(CONFIDENCE_FLOOR, base - penalty);
  return Math.min(CONFIDENCE_CEILING, afterConflicts + confirmations * CONFIRMATION_BONUS);
}
