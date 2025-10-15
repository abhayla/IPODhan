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
    fundamentalScore: 80,
    sentimentScore: 90,
    subscriptionScore: 85,
    sectorScore: 85,
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

    expect(screen.getByText('IPODhan AI Score')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument(); // total score
    expect(screen.getByText(/Fundamental Analysis/)).toBeInTheDocument();
    expect(screen.getByText(/Market Sentiment/)).toBeInTheDocument();
    expect(screen.getByText(/Subscription Demand/)).toBeInTheDocument();
    expect(screen.getByText(/Sector Performance/)).toBeInTheDocument();
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
    expect(screen.getByText(/not yet available/)).toBeInTheDocument();
  });

  it('should display verdict and confidence badges', () => {
    render(<IPOScoreSection score={mockScore} />);
    expect(screen.getByText('Apply')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('should display component scores with progress bars', () => {
    render(<IPOScoreSection score={mockScore} />);

    // Check that scores are displayed
    expect(screen.getByText('80')).toBeInTheDocument(); // fundamental
    expect(screen.getByText('90')).toBeInTheDocument(); // sentiment
    expect(screen.getByText('85')).toBeInTheDocument(); // subscription & sector (same value)
  });
});
