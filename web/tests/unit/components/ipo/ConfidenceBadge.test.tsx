/**
 * Unit Tests: ConfidenceBadge Component (Story 4.7)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfidenceBadge } from '@/components/ipo/ConfidenceBadge';
import type { ConfidenceLevel } from '@/lib/db/types';

describe('ConfidenceBadge', () => {
  it('should render HIGH confidence', () => {
    const confidence: ConfidenceLevel = 'HIGH';
    render(<ConfidenceBadge confidence={confidence} />);
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('should render MEDIUM confidence', () => {
    const confidence: ConfidenceLevel = 'MEDIUM';
    render(<ConfidenceBadge confidence={confidence} />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
  });

  it('should render LOW confidence', () => {
    const confidence: ConfidenceLevel = 'LOW';
    render(<ConfidenceBadge confidence={confidence} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it('should apply correct color classes', () => {
    const high: ConfidenceLevel = 'HIGH';
    const medium: ConfidenceLevel = 'MEDIUM';
    const low: ConfidenceLevel = 'LOW';

    const { container, rerender } = render(<ConfidenceBadge confidence={high} />);
    let badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-green');

    rerender(<ConfidenceBadge confidence={medium} />);
    badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-yellow');

    rerender(<ConfidenceBadge confidence={low} />);
    badge = container.querySelector('div');
    expect(badge?.className).toContain('bg-red');
  });
});
