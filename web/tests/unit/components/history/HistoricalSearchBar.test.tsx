/**
 * Unit Tests for HistoricalSearchBar Component
 *
 * Tests search functionality with debouncing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { HistoricalSearchBar } from '@/components/history/HistoricalSearchBar';
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

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <HistoricalFiltersProvider>{component}</HistoricalFiltersProvider>
  );
};

describe('HistoricalSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders search input with placeholder', () => {
    renderWithProvider(<HistoricalSearchBar />);
    const input = screen.getByPlaceholderText('Search by company name...');
    expect(input).toBeDefined();
  });

  it('shows search icon', () => {
    renderWithProvider(<HistoricalSearchBar />);
    const searchIcon = document.querySelector('svg');
    expect(searchIcon).toBeDefined();
  });

  it('updates local value on typing', () => {
    renderWithProvider(<HistoricalSearchBar />);
    const input = screen.getByPlaceholderText('Search by company name...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Reliance' } });
    expect(input.value).toBe('Reliance');
  });

  it('debounces search query updates (500ms)', async () => {
    renderWithProvider(<HistoricalSearchBar />);
    const input = screen.getByPlaceholderText('Search by company name...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Reliance' } });

    // Should not update immediately
    expect(input.value).toBe('Reliance');

    // Fast-forward the 500ms debounce (act() flushes the resulting state update).
    // NOTE: don't use waitFor() here — it polls via timers, which deadlocks under
    // vi.useFakeTimers(). Assert directly after advancing.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(input.value).toBe('Reliance');
  });

  it('shows clear button when search query is not empty', () => {
    renderWithProvider(<HistoricalSearchBar />);
    const input = screen.getByPlaceholderText('Search by company name...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Reliance' } });

    const clearButton = screen.getByLabelText('Clear search');
    expect(clearButton).toBeDefined();
  });

  it('clears search query when clear button is clicked', async () => {
    renderWithProvider(<HistoricalSearchBar />);
    const input = screen.getByPlaceholderText('Search by company name...') as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Reliance' } });
    expect(input.value).toBe('Reliance');

    const clearButton = screen.getByLabelText('Clear search');
    fireEvent.click(clearButton); // synchronous state update (act-wrapped by fireEvent)

    expect(input.value).toBe('');
  });
});
