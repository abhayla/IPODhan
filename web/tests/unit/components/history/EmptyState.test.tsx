import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/history/EmptyState';

describe('EmptyState', () => {
  it('renders empty state message', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState onClearFilters={onClearFilters} />);

    expect(screen.getByText('No IPOs Found')).toBeInTheDocument();
    expect(screen.getByText(/We couldn't find any historical IPOs/)).toBeInTheDocument();
  });

  it('displays clear filters button', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState onClearFilters={onClearFilters} />);

    const button = screen.getByRole('button', { name: /Clear All Filters/i });
    expect(button).toBeInTheDocument();
  });

  it('calls onClearFilters when button is clicked', () => {
    const onClearFilters = vi.fn();
    render(<EmptyState onClearFilters={onClearFilters} />);

    const button = screen.getByRole('button', { name: /Clear All Filters/i });
    fireEvent.click(button);

    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('renders icon', () => {
    const onClearFilters = vi.fn();
    const { container } = render(<EmptyState onClearFilters={onClearFilters} />);

    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });
});
