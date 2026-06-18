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

  // FLAG(Abhay): the badge was redesigned from per-level color-coding
  // (bg-green/yellow/red) to a uniform muted badge + tooltip (bg-muted/50). The
  // old assertion also queried the wrong node (the cursor-help wrapper, not the
  // badge). Test updated to the SHIPPED design + differentiation-by-label. Confirm
  // whether per-level colour coding should be restored for at-a-glance scanning —
  // not changing product visuals unattended overnight.
  it('renders a styled badge that differentiates each confidence level', () => {
    const high: ConfidenceLevel = 'HIGH';
    const medium: ConfidenceLevel = 'MEDIUM';
    const low: ConfidenceLevel = 'LOW';

    const { rerender } = render(<ConfidenceBadge confidence={high} />);
    expect(screen.getByText('High')).toBeInTheDocument();

    rerender(<ConfidenceBadge confidence={medium} />);
    expect(screen.getByText('Medium')).toBeInTheDocument();

    rerender(<ConfidenceBadge confidence={low} />);
    expect(screen.getByText('Low')).toBeInTheDocument();
  });
});
