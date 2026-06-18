/**
 * Unit Tests: ScoreBadge Component (Story 4.7)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge } from '@/components/ipo/ScoreBadge';

// The badge is wrapped in a cursor-help tooltip trigger; the colour + size
// classes live on the inner badge div (the score text's parent), NOT the
// wrapper. `container.querySelector('div')` returns the wrapper, so target the
// badge via the score text instead. ScoreBadge formats the score as `${n}/100`.
const badgeOf = (score: number) => screen.getByText(`${score}/100`).closest('div');

describe('ScoreBadge', () => {
  it('should render score value', () => {
    render(<ScoreBadge score={85} />);
    expect(screen.getByText('85/100')).toBeInTheDocument();
  });

  it('should apply correct color classes for excellent score', () => {
    render(<ScoreBadge score={85} />);
    expect(badgeOf(85)?.className).toContain('bg-green');
  });

  it('should apply correct color classes for good score', () => {
    render(<ScoreBadge score={65} />);
    expect(badgeOf(65)?.className).toContain('bg-yellow');
  });

  it('should apply correct color classes for fair score', () => {
    render(<ScoreBadge score={40} />);
    expect(badgeOf(40)?.className).toContain('bg-orange');
  });

  it('should apply correct color classes for poor score', () => {
    render(<ScoreBadge score={15} />);
    expect(badgeOf(15)?.className).toContain('bg-red');
  });

  it('should render without tooltip when showTooltip=false', () => {
    render(<ScoreBadge score={85} showTooltip={false} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should apply correct size classes', () => {
    const { rerender } = render(<ScoreBadge score={85} size="sm" />);
    expect(badgeOf(85)?.className).toContain('text-xs');

    rerender(<ScoreBadge score={85} size="md" />);
    expect(badgeOf(85)?.className).toContain('text-sm');

    rerender(<ScoreBadge score={85} size="lg" />);
    expect(badgeOf(85)?.className).toContain('text-base');
  });
});
