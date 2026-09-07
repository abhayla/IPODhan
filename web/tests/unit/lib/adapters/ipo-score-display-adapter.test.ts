/**
 * Unit Tests: IPO Score Display Adapter (T-489)
 *
 * The bug: IPOScoreSection rendered the static `ipo_scores` table (0-100
 * scale, 0 rows on staging/prod) while /api/ipos/[slug]/score computes a
 * realtime 0-10 score from financial data. These tests prove both shapes
 * normalise into the SAME 0-10 display model with the SAME band labels the
 * API itself returns (getRatingLabel), for the full class of IPOs: every
 * rating band, high/medium/low confidence, and both segments/statuses (the
 * adapter is status/segment-agnostic — it only reads score fields).
 */

import { describe, it, expect } from 'vitest';
import {
  adaptStoredScore,
  adaptRealtimeScore,
} from '@/lib/adapters/ipo-score-display-adapter';
import { getRatingLabel } from '@/lib/services/ipo-scoring-realtime';
import type { IPOScore } from '@/lib/db/types';
import type { ScoreComponents } from '@/lib/services/ipo-scoring-realtime';

function makeStoredScore(overrides: Partial<IPOScore> = {}): IPOScore {
  return {
    id: 'score-1',
    ipoId: 'ipo-1',
    totalScore: 85,
    fundamentalScore: 20,
    sentimentScore: 23,
    subscriptionScore: 22,
    sectorScore: 21,
    verdict: 'APPLY',
    confidence: 'HIGH',
    reasoning: 'Strong fundamentals and positive market sentiment',
    algorithmVersion: '1.0.0',
    calculatedAt: new Date('2026-09-01T10:00:00Z'),
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides,
  };
}

function makeRealtimeScore(overrides: Partial<ScoreComponents> = {}): ScoreComponents {
  return {
    financialStrength: 1.5,
    valuation: 1.0,
    subscriptionDemand: 1.2,
    marketPerformance: 1.0,
    fundamentals: 0.3,
    total: 6.2,
    rating: 'Good (Moderate)',
    confidence: 70,
    breakdown: {},
    ...overrides,
  };
}

describe('adaptStoredScore', () => {
  it('normalises the 0-100 stored total onto the 0-10 scale', () => {
    const display = adaptStoredScore(makeStoredScore({ totalScore: 85 }));
    expect(display.totalScore).toBe(8.5);
    expect(display.maxScore).toBe(10);
  });

  it('derives the rating label from the SAME function the API uses (no drift)', () => {
    const display = adaptStoredScore(makeStoredScore({ totalScore: 85 }));
    expect(display.ratingLabel).toBe(getRatingLabel(8.5));
  });

  it('marks the source as stored', () => {
    const display = adaptStoredScore(makeStoredScore());
    expect(display.source).toBe('stored');
  });

  it('carries the reasoning and metadata through unchanged', () => {
    const row = makeStoredScore({ reasoning: 'custom note', algorithmVersion: '2.0.0' });
    const display = adaptStoredScore(row);
    expect(display.reasoning).toBe('custom note');
    expect(display.algorithmVersion).toBe('2.0.0');
    expect(display.calculatedAt).toEqual(row.calculatedAt);
  });

  it.each([
    ['HIGH', 85],
    ['MEDIUM', 65],
    ['LOW', 40],
  ] as const)('maps confidence %s to %i%%', (confidence, expected) => {
    const display = adaptStoredScore(makeStoredScore({ confidence }));
    expect(display.confidencePercent).toBe(expected);
  });

  it.each([
    [100, 'Exceptional (Invest)'],
    [80, 'Strong (Consider)'],
    [65, 'Good (Moderate)'],
    [50, 'Average (Neutral)'],
    [35, 'Below Average (Caution)'],
    [10, 'Poor (Avoid)'],
  ])('renders every rating band consistently: total %i -> %s', (totalScore, expectedLabel) => {
    const display = adaptStoredScore(makeStoredScore({ totalScore }));
    expect(display.ratingLabel).toBe(expectedLabel);
  });

  it('produces four real components scaled from the 0-25 component columns', () => {
    const display = adaptStoredScore(
      makeStoredScore({ fundamentalScore: 25, sentimentScore: 25, subscriptionScore: 25, sectorScore: 25 })
    );
    expect(display.components.slice(0, 4)).toEqual([
      { label: 'Financial Strength', score: 3, maxScore: 3 },
      { label: 'Valuation', score: 2, maxScore: 2 },
      { label: 'Subscription Demand', score: 2, maxScore: 2 },
      { label: 'Market Performance', score: 2, maxScore: 2 },
    ]);
  });

  it('does NOT double-count fundamentalScore into a fabricated Fundamentals bar — uses the honest placeholder instead', () => {
    // Regression (round 2): fundamentalScore already backs "Financial
    // Strength"; the stored schema has no 5th column, so reusing it for
    // "Fundamentals" too would double-count one real column as two bars and
    // make the five bars sum to more than the headline total.
    const display = adaptStoredScore(makeStoredScore({ fundamentalScore: 25 }));
    const fundamentals = display.components.find((c) => c.label === 'Fundamentals');
    expect(fundamentals).toEqual({
      label: 'Fundamentals',
      score: 0.5,
      maxScore: 1,
      note: 'Not tracked in the editorial score — placeholder',
    });
  });
});

describe('adaptRealtimeScore', () => {
  const calculatedAt = new Date('2026-09-07T00:00:00Z');

  it('is near-identity on the total (already 0-10)', () => {
    const display = adaptRealtimeScore(makeRealtimeScore({ total: 6.2 }), calculatedAt, 'realtime-v1.0');
    expect(display.totalScore).toBe(6.2);
    expect(display.maxScore).toBe(10);
  });

  it('marks the source as realtime', () => {
    const display = adaptRealtimeScore(makeRealtimeScore(), calculatedAt, 'realtime-v1.0');
    expect(display.source).toBe('realtime');
  });

  it('derives the rating label from the SAME function the API uses (no drift)', () => {
    const display = adaptRealtimeScore(makeRealtimeScore({ total: 6.2 }), calculatedAt, 'realtime-v1.0');
    expect(display.ratingLabel).toBe(getRatingLabel(6.2));
    expect(display.ratingLabel).toBe('Good (Moderate)');
  });

  it('matches the T-458/#167 staging example: hy-tech 5 -> Average (Neutral)', () => {
    const display = adaptRealtimeScore(makeRealtimeScore({ total: 5 }), calculatedAt, 'realtime-v1.0');
    expect(display.totalScore).toBe(5);
    expect(display.ratingLabel).toBe('Average (Neutral)');
  });

  it('matches the T-458/#167 staging example: tempsens 6.2 -> Good (Moderate)', () => {
    const display = adaptRealtimeScore(makeRealtimeScore({ total: 6.2 }), calculatedAt, 'realtime-v1.0');
    expect(display.totalScore).toBe(6.2);
    expect(display.ratingLabel).toBe('Good (Moderate)');
  });

  it('carries components straight through with their fixed max scores', () => {
    const display = adaptRealtimeScore(
      makeRealtimeScore({
        financialStrength: 2.1,
        valuation: 1.4,
        subscriptionDemand: 1.8,
        marketPerformance: 0.9,
        fundamentals: 0.6,
      }),
      calculatedAt,
      'realtime-v1.0'
    );
    expect(display.components).toEqual([
      { label: 'Financial Strength', score: 2.1, maxScore: 3 },
      { label: 'Valuation', score: 1.4, maxScore: 2 },
      { label: 'Subscription Demand', score: 1.8, maxScore: 2 },
      { label: 'Market Performance', score: 0.9, maxScore: 2 },
      { label: 'Fundamentals', score: 0.6, maxScore: 1 },
    ]);
  });

  it('rounds the numeric confidence percentage', () => {
    const display = adaptRealtimeScore(makeRealtimeScore({ confidence: 66.6 }), calculatedAt, 'realtime-v1.0');
    expect(display.confidencePercent).toBe(67);
  });

  it('has no editorial reasoning (honest — never fabricates AI commentary)', () => {
    const display = adaptRealtimeScore(makeRealtimeScore(), calculatedAt, 'realtime-v1.0');
    expect(display.reasoning).toBeNull();
  });
});
