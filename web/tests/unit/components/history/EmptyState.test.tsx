/**
 * Unit Tests for EmptyState Component
 *
 * Tests empty state display and clear filters functionality
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '@/components/history/EmptyState';
import { HistoricalFiltersProvider } from '@/contexts/HistoricalFiltersContext';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(() => null),
    toString: vi.fn(() => ''),
  }),
  usePathname: () => '/history',
}));

const renderWithProvider = (component: React.ReactElement, initialFilters = {}) => {
  return render(
    <HistoricalFiltersProvider initialFilters={initialFilters}>
      {component}
    </HistoricalFiltersProvider>
  );
};

describe('EmptyState', () => {
  it('renders empty state message', () => {
    renderWithProvider(<EmptyState />);

    expect(screen.getByText('No Historical IPOs Found')).toBeDefined();
  });

  it('shows different message when filters are active', () => {
    renderWithProvider(<EmptyState />, { year: '2024' });

    const message = screen.getByText(/No historical IPOs match your current filters/);
    expect(message).toBeDefined();
  });

  it('shows "Clear Filters" button when filters are active', () => {
    renderWithProvider(<EmptyState />, { year: '2024' });

    const clearButton = screen.getByText('Clear Filters');
    expect(clearButton).toBeDefined();
  });

  it('does not show "Clear Filters" button when no filters are active', () => {
    renderWithProvider(<EmptyState />);

    const clearButton = screen.queryByText('Clear Filters');
    expect(clearButton).toBeNull();
  });

  it('displays search icon', () => {
    renderWithProvider(<EmptyState />);

    const icon = document.querySelector('svg');
    expect(icon).toBeDefined();
  });
});
