/**
 * Unit Tests: IPOScoreSection Component (Story 4.7, T-489)
 *
 * T-489: the component now renders an IPOScoreDisplayModel (0-10 scale, the
 * API's own scale) rather than the raw `ipo_scores` row directly — see
 * web/lib/adapters/ipo-score-display-adapter.ts.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOScoreSection } from '@/components/ipo/IPOScoreSection';
import type { IPOScoreDisplayModel } from '@/lib/adapters/ipo-score-display-adapter';

function makeDisplayScore(overrides: Partial<IPOScoreDisplayModel> = {}): IPOScoreDisplayModel {
  return {
    totalScore: 6.2,
    maxScore: 10,
    ratingLabel: 'Good (Moderate)',
    confidencePercent: 70,
    components: [
      { label: 'Financial Strength', score: 1.5, maxScore: 3 },
      { label: 'Valuation', score: 1.0, maxScore: 2 },
      { label: 'Subscription Demand', score: 1.2, maxScore: 2 },
      { label: 'Market Performance', score: 1.0, maxScore: 2 },
      { label: 'Fundamentals', score: 0.3, maxScore: 1 },
    ],
    reasoning: null,
    calculatedAt: new Date('2026-09-01T10:00:00Z'),
    algorithmVersion: 'realtime-v1.0',
    source: 'realtime',
    ...overrides,
  };
}

describe('IPOScoreSection', () => {
  it('renders the total score on the 0-10 scale, not 0-100', () => {
    render(<IPOScoreSection score={makeDisplayScore({ totalScore: 6.2 })} />);
    expect(screen.getByText('IPODhan Score')).toBeInTheDocument();
    expect(screen.getByText('6.2/10')).toBeInTheDocument();
  });

  it('matches the T-458/#167 staging example (tempsens: 6.2, Good (Moderate))', () => {
    render(
      <IPOScoreSection
        score={makeDisplayScore({ totalScore: 6.2, ratingLabel: 'Good (Moderate)' })}
      />
    );
    expect(screen.getByText('6.2/10')).toBeInTheDocument();
    // Rating label renders twice (header + radar-chart caption) — presence,
    // not uniqueness, is the assertion.
    expect(screen.getAllByText('Good (Moderate)').length).toBeGreaterThan(0);
  });

  it('matches the T-458/#167 staging example (hy-tech: 5, Average (Neutral))', () => {
    render(
      <IPOScoreSection
        score={makeDisplayScore({ totalScore: 5, ratingLabel: 'Average (Neutral)' })}
      />
    );
    expect(screen.getByText('5/10')).toBeInTheDocument();
    expect(screen.getAllByText('Average (Neutral)').length).toBeGreaterThan(0);
  });

  it('renders every component bar with its own max score', () => {
    render(<IPOScoreSection score={makeDisplayScore()} />);
    // The radar chart (ScoreBreakdown) renders the same score/max text a
    // second time as SVG labels — assert presence via getAllByText, not
    // uniqueness, since both are legitimate renderings of the same data.
    expect(screen.getAllByText('1.5/3').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1/2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1.2/2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.3/1').length).toBeGreaterThan(0);
  });

  it('shows an honest "computed from financial data" caption for a realtime score', () => {
    render(<IPOScoreSection score={makeDisplayScore({ source: 'realtime' })} />);
    expect(screen.getByText(/Computed from financial data/)).toBeInTheDocument();
  });

  it('shows an "Editorial score" caption for a stored score', () => {
    render(<IPOScoreSection score={makeDisplayScore({ source: 'stored' })} />);
    expect(screen.getByText('Editorial score')).toBeInTheDocument();
  });

  it('displays confidence as a percentage', () => {
    render(<IPOScoreSection score={makeDisplayScore({ confidencePercent: 70 })} />);
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('displays reasoning only when present (stored editorial scores)', () => {
    render(<IPOScoreSection score={makeDisplayScore({ reasoning: 'Strong fundamentals' })} />);
    expect(screen.getByText('Strong fundamentals')).toBeInTheDocument();
  });

  it('shows Score Pending when no score exists (empty state — neither stored nor realtime)', () => {
    render(<IPOScoreSection score={null} />);
    expect(screen.getByText(/Score Pending/)).toBeInTheDocument();
    expect(screen.getByText(/being calculated/)).toBeInTheDocument();
  });
});
