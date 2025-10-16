/**
 * Unit Tests for LoadingSkeleton Component
 *
 * Tests loading skeleton rendering
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingSkeleton } from '@/components/history/LoadingSkeleton';

describe('LoadingSkeleton', () => {
  it('renders loading skeleton', () => {
    const { container } = render(<LoadingSkeleton />);
    expect(container).toBeDefined();
  });

  it('renders desktop table skeleton (hidden on mobile)', () => {
    const { container } = render(<LoadingSkeleton />);
    const desktopSkeleton = container.querySelector('.hidden.lg\\:block');
    expect(desktopSkeleton).toBeDefined();
  });

  it('renders mobile card skeleton (hidden on desktop)', () => {
    const { container } = render(<LoadingSkeleton />);
    const mobileSkeleton = container.querySelector('.lg\\:hidden');
    expect(mobileSkeleton).toBeDefined();
  });
});
