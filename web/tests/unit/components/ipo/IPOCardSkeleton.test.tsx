import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOCardSkeleton } from '@/components/ipo/IPOCardSkeleton';

describe('IPOCardSkeleton', () => {
  it('should render skeleton with test id', () => {
    render(<IPOCardSkeleton />);
    expect(screen.getByTestId('ipo-card-skeleton')).toBeInTheDocument();
  });

  it('should render multiple skeleton elements', () => {
    const { container } = render(<IPOCardSkeleton />);

    // Check for skeleton elements (using class selector since Skeleton doesn't have semantic meaning)
    const skeletons = container.querySelectorAll('[class*="animate-pulse"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('should be wrapped in Card component', () => {
    const { container } = render(<IPOCardSkeleton />);

    // Card component uses specific structure
    const card = container.querySelector('[class*="rounded"]');
    expect(card).toBeInTheDocument();
  });

  it('should render with proper structure', () => {
    render(<IPOCardSkeleton />);
    const skeleton = screen.getByTestId('ipo-card-skeleton');

    // Should be a card
    expect(skeleton).toBeInTheDocument();
  });
});
