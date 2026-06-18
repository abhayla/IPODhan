/**
 * Unit Tests: VerdictBadge Component (Story 4.7)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge } from '@/components/ipo/VerdictBadge';
import type { IPOVerdict } from '@/lib/db/types';

// Colour classes live on the inner badge div (the label's parent), not the
// cursor-help tooltip wrapper that container.querySelector('div') returns.
// Target the badge via its label text instead.

describe('VerdictBadge', () => {
  it('should render APPLY verdict', () => {
    const verdict: IPOVerdict = 'APPLY';
    render(<VerdictBadge verdict={verdict} />);
    expect(screen.getByText('Apply')).toBeInTheDocument();
  });

  it('should render CONSIDER verdict', () => {
    const verdict: IPOVerdict = 'CONSIDER';
    render(<VerdictBadge verdict={verdict} />);
    expect(screen.getByText('Consider')).toBeInTheDocument();
  });

  it('should render SKIP verdict', () => {
    const verdict: IPOVerdict = 'SKIP';
    render(<VerdictBadge verdict={verdict} />);
    expect(screen.getByText('Skip')).toBeInTheDocument();
  });

  it('should apply green classes for APPLY', () => {
    render(<VerdictBadge verdict={'APPLY'} />);
    expect(screen.getByText('Apply').closest('div')?.className).toContain('bg-green');
  });

  it('should apply yellow classes for CONSIDER', () => {
    render(<VerdictBadge verdict={'CONSIDER'} />);
    expect(screen.getByText('Consider').closest('div')?.className).toContain('bg-yellow');
  });

  it('should apply red classes for SKIP', () => {
    render(<VerdictBadge verdict={'SKIP'} />);
    expect(screen.getByText('Skip').closest('div')?.className).toContain('bg-red');
  });

  it('should render without tooltip when showTooltip=false', () => {
    const verdict: IPOVerdict = 'APPLY';
    render(<VerdictBadge verdict={verdict} showTooltip={false} />);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
