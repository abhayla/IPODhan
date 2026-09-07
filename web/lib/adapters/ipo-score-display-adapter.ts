/**
 * IPO Score Display Adapter (T-489)
 *
 * The platform has two IPO score shapes that never agreed on a scale:
 *  - `ipo_scores` (packages/shared/src/db/schema.ts): editorial/stored row,
 *    totalScore 0-100, four components 0-25 each. Empty on staging/prod today.
 *  - `/api/ipos/[slug]/score` (web/lib/services/ipo-scoring-realtime.ts):
 *    realtime score computed from financial data, totalScore 0-10, five
 *    components (financialStrength 0-3, valuation 0-2, subscriptionDemand
 *    0-2, marketPerformance 0-2, fundamentals 0-1).
 *
 * IPOScoreSection renders ONE display model on the API's 0-10 scale — the
 * live source, and the scale a `/score` caller already sees — never the
 * stored table's 0-100 scale. Both adapters below normalise into it, and
 * both derive the rating label from the SAME `getRatingLabel` the API uses
 * (web/lib/services/ipo-scoring-realtime.ts), so the section's band text can
 * never drift from what `/api/ipos/[slug]/score` itself reports.
 */

import type { IPOScore } from '@/lib/db/types';
import { getRatingLabel, type ScoreComponents } from '@/lib/services/ipo-scoring-realtime';

export interface IPOScoreDisplayComponent {
  label: string;
  score: number;
  maxScore: number;
  /** Set when the value is not a real measurement (e.g. an untracked placeholder). */
  note?: string;
}

export interface IPOScoreDisplayModel {
  /** 0-10, one decimal — the API's own scale. */
  totalScore: number;
  maxScore: 10;
  ratingLabel: string;
  confidencePercent: number;
  components: IPOScoreDisplayComponent[];
  reasoning: string | null;
  calculatedAt: Date;
  algorithmVersion: string;
  /** Whether this came from the stored editorial row or a live calculation. */
  source: 'stored' | 'realtime';
}

/**
 * Confidence-level -> percentage. Mirrors
 * IPOScoreRealtimeRepository.getConfidencePercentage (the repository's own
 * inverse of this mapping) so a stored row's confidence band renders the
 * same percentage the realtime path would have reported.
 */
function confidenceLevelToPercent(level: IPOScore['confidence']): number {
  switch (level) {
    case 'HIGH':
      return 85;
    case 'MEDIUM':
      return 65;
    case 'LOW':
      return 40;
    default:
      return 50;
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Adapt a stored `ipo_scores` row (0-100 total, 0-25 components) into the
 * section's 0-10 display model. The 4 real columns map onto 4 of the 5
 * realtime components — Valuation reads `sentimentScore` and Market
 * Performance reads `sectorScore` (a deliberate swap, not a bug: the stored
 * schema's 4 columns don't line up 1:1 by name with the realtime 5, so the
 * mapping pairs them by the closest semantic match instead of by name).
 * There is no 5th stored column for Fundamentals, so unlike
 * IPOScoreRealtimeRepository.parseStoredScore (which reuses fundamentalScore
 * a second time, double-counting it against Financial Strength) this adapter
 * uses the SAME 0.5 placeholder the repository's own saveScore path treats
 * as "no fundamentals data" and marks it with an explicit note, rather than
 * silently double-counting a real column as two different bars.
 */
export function adaptStoredScore(row: IPOScore): IPOScoreDisplayModel {
  const totalScore = round1((row.totalScore / 100) * 10);

  return {
    totalScore,
    maxScore: 10,
    ratingLabel: getRatingLabel(totalScore),
    confidencePercent: confidenceLevelToPercent(row.confidence),
    components: [
      { label: 'Financial Strength', score: round1((row.fundamentalScore / 25) * 3), maxScore: 3 },
      { label: 'Valuation', score: round1((row.sentimentScore / 25) * 2), maxScore: 2 },
      { label: 'Subscription Demand', score: round1((row.subscriptionScore / 25) * 2), maxScore: 2 },
      { label: 'Market Performance', score: round1((row.sectorScore / 25) * 2), maxScore: 2 },
      { label: 'Fundamentals', score: 0.5, maxScore: 1, note: 'Not tracked in the editorial score — placeholder' },
    ],
    reasoning: row.reasoning,
    calculatedAt: row.calculatedAt,
    algorithmVersion: row.algorithmVersion,
    source: 'stored',
  };
}

/**
 * Adapt the realtime `ScoreComponents` (already 0-10) into the section's
 * display model — mostly identity, since this IS the target scale.
 */
export function adaptRealtimeScore(
  score: ScoreComponents,
  calculatedAt: Date,
  algorithmVersion: string
): IPOScoreDisplayModel {
  const totalScore = round1(score.total);

  return {
    totalScore,
    maxScore: 10,
    ratingLabel: getRatingLabel(totalScore),
    confidencePercent: Math.round(score.confidence),
    components: [
      { label: 'Financial Strength', score: round1(score.financialStrength), maxScore: 3 },
      { label: 'Valuation', score: round1(score.valuation), maxScore: 2 },
      { label: 'Subscription Demand', score: round1(score.subscriptionDemand), maxScore: 2 },
      { label: 'Market Performance', score: round1(score.marketPerformance), maxScore: 2 },
      { label: 'Fundamentals', score: round1(score.fundamentals), maxScore: 1 },
    ],
    reasoning: null,
    calculatedAt,
    algorithmVersion,
    source: 'realtime',
  };
}
