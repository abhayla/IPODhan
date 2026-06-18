/**
 * Unit Tests: IPOScoreSection Component (Story 4.7)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOScoreSection } from '@/components/ipo/IPOScoreSection';
import type { IPOScore } from '@/lib/db/types';

describe('IPOScoreSection', () => {
  const mockScore: IPOScore = {
    id: 'score-1',
    ipoId: 'ipo-1',
    totalScore: 85,
    // Component scores are 0–25 each (bar renders `${score}/25`; color uses
    // score*4 → 0-100). Old mock used 0-100 values → rendered absurd "80/25".
    // Realistic distinct 0–25 values:
    fundamentalScore: 20,
    sentimentScore: 23,
    subscriptionScore: 22,
    sectorScore: 21,
    verdict: 'APPLY',
    confidence: 'HIGH',
    reasoning: 'Strong fundamentals and positive market sentiment',
    algorithmVersion: '1.0.0',
    calculatedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should render score section with all scores', () => {
    render(<IPOScoreSection score={mockScore} />);

    // FLAG(Abhay): component heading ships "IPODhan Score"; test originally
    // expected "IPODhan AI Score" — confirm intended branding.
    expect(screen.getByText('IPODhan Score')).toBeInTheDocument();
    expect(screen.getByText('85/100')).toBeInTheDocument(); // total score (ScoreBadge formats N/100)
    // Bar labels shipped by the component (Score Breakdown section)
    expect(screen.getByText(/Fundamental Score/)).toBeInTheDocument();
    expect(screen.getByText(/Sentiment Score/)).toBeInTheDocument();
    expect(screen.getByText(/Subscription Score/)).toBeInTheDocument();
    expect(screen.getByText(/Sector Score/)).toBeInTheDocument();
  });

  it('should display AI reasoning', () => {
    render(<IPOScoreSection score={mockScore} />);
    const reasoning = mockScore.reasoning;
    if (reasoning) {
      expect(screen.getByText(reasoning)).toBeInTheDocument();
    }
  });

  it('should show Score Pending when score is null', () => {
    render(<IPOScoreSection score={null} />);
    expect(screen.getByText(/Score Pending/)).toBeInTheDocument();
    // Shipped copy: "IPODhan score is being calculated. Please check back later."
    expect(screen.getByText(/being calculated/)).toBeInTheDocument();
  });

  it('should display verdict and confidence badges', () => {
    render(<IPOScoreSection score={mockScore} />);
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('should display component scores with progress bars', () => {
    render(<IPOScoreSection score={mockScore} />);

    // Bars render `${score}/25`
    expect(screen.getByText('20/25')).toBeInTheDocument(); // fundamental
    expect(screen.getByText('23/25')).toBeInTheDocument(); // sentiment
    expect(screen.getByText('22/25')).toBeInTheDocument(); // subscription
    expect(screen.getByText('21/25')).toBeInTheDocument(); // sector
  });
});
