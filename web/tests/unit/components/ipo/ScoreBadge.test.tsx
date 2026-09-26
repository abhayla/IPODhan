/**
 * Unit Tests: ScoreBadge Component (Story 4.7)
 *
 * OD-125 (#167): the badge renders on the 0-10 scale
 * `/api/ipos/[slug]/score` and IPOScoreSection use, not the stored
 * `ipo_scores` row's raw 0-100 total — callers convert via
 * `adaptStoredScore(...)` before passing `score` in.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge } from '@/components/ipo/ScoreBadge';

// The badge is wrapped in a cursor-help tooltip trigger; the colour + size
// classes live on the inner badge div (the score text's parent), NOT the
// wrapper. `container.querySelector('div')` returns the wrapper, so target the
// badge via the score text instead. ScoreBadge formats the score as `${n}/10`.
const badgeOf = (score: number) => screen.getByText(`${score}/10`).closest('div');

describe('ScoreBadge', () => {
  it('should render score value', () => {
    render(<ScoreBadge score={8.5} />);
    expect(screen.getByText('8.5/10')).toBeInTheDocument();
  });

  it('should apply correct color classes for excellent score', () => {
    render(<ScoreBadge score={8.5} />);
    expect(badgeOf(8.5)?.className).toContain('bg-green');
  });

  it('should apply correct color classes for good score', () => {
    render(<ScoreBadge score={6.5} />);
    expect(badgeOf(6.5)?.className).toContain('bg-yellow');
  });

  it('should apply correct color classes for fair score', () => {
    render(<ScoreBadge score={4} />);
    expect(badgeOf(4)?.className).toContain('bg-orange');
  });

  it('should apply correct color classes for poor score', () => {
    render(<ScoreBadge score={1.5} />);
    expect(badgeOf(1.5)?.className).toContain('bg-red');
  });

  it('should render without tooltip when showTooltip=false', () => {
    render(<ScoreBadge score={8.5} showTooltip={false} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should apply correct size classes', () => {
    const { rerender } = render(<ScoreBadge score={8.5} size="sm" />);
    expect(badgeOf(8.5)?.className).toContain('text-xs');

    rerender(<ScoreBadge score={8.5} size="md" />);
    expect(badgeOf(8.5)?.className).toContain('text-sm');

    rerender(<ScoreBadge score={8.5} size="lg" />);
    expect(badgeOf(8.5)?.className).toContain('text-base');
  });
});
