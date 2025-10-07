import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOGridSkeleton } from '@/components/shared/IPOGridSkeleton';

describe('IPOGridSkeleton', () => {
  it('renders without crashing', () => {
    render(<IPOGridSkeleton />);
    expect(screen.getByTestId('ipo-grid-skeleton')).toBeInTheDocument();
  });

  it('renders default 12 skeleton cards', () => {
    render(<IPOGridSkeleton />);
    const skeletonCards = screen.getAllByTestId('ipo-card-skeleton');
    expect(skeletonCards).toHaveLength(12);
  });

  it('renders custom count of skeleton cards', () => {
    render(<IPOGridSkeleton count={6} />);
    const skeletonCards = screen.getAllByTestId('ipo-card-skeleton');
    expect(skeletonCards).toHaveLength(6);
  });

  it('has grid layout classes', () => {
    render(<IPOGridSkeleton />);
    const grid = screen.getByTestId('ipo-grid-skeleton');
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'md:grid-cols-2', 'lg:grid-cols-3', 'gap-6');
  });

  it('renders with count of 0', () => {
    render(<IPOGridSkeleton count={0} />);
    const skeletonCards = screen.queryAllByTestId('ipo-card-skeleton');
    expect(skeletonCards).toHaveLength(0);
  });
});
