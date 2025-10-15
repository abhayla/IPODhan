/**
 * Unit Tests: ScoreBadge Component (Story 4.7)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge } from '@/components/ipo/ScoreBadge';

describe('ScoreBadge', () => {
  it('should render score value', () => {
    render(<ScoreBadge score={85} />);
    expect(screen.getByText('85')).toBeInTheDocument();
  });

  it('should apply correct color classes for excellent score', () => {
    const { container } = render(<ScoreBadge score={85} />);
    const badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-green');
  });

  it('should apply correct color classes for good score', () => {
    const { container } = render(<ScoreBadge score={65} />);
    const badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-yellow');
  });

  it('should apply correct color classes for fair score', () => {
    const { container } = render(<ScoreBadge score={40} />);
    const badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-orange');
  });

  it('should apply correct color classes for poor score', () => {
    const { container } = render(<ScoreBadge score={15} />);
    const badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-red');
  });

  it('should render without tooltip when showTooltip=false', () => {
    render(<ScoreBadge score={85} showTooltip={false} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('should apply correct size classes', () => {
    const { rerender, container } = render(<ScoreBadge score={85} size="sm" />);
    let badge = container.querySelector('div');
    expect(badge?.className).toContain('text-xs');

    rerender(<ScoreBadge score={85} size="md" />);
    badge = container.querySelector('div');
    expect(badge?.className).toContain('text-sm');

    rerender(<ScoreBadge score={85} size="lg" />);
    badge = container.querySelector('div');
    expect(badge?.className).toContain('text-base');
  });
});
