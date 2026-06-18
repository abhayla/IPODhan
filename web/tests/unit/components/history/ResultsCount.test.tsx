import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultsCount } from '@/components/history/ResultsCount';
import * as HistoricalFiltersContext from '@/contexts/HistoricalFiltersContext';

// Mock the context
vi.mock('@/contexts/HistoricalFiltersContext', () => ({
  useHistoricalFilters: vi.fn(() => ({
    hasActiveFilters: false,
  })),
}));

describe('ResultsCount', () => {
  it('displays total count', () => {
    render(<ResultsCount total={100} />);

    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    // "IPOs" is a bare text node in mixed content (not its own element) — assert
    // via the container's text rather than getByText (which can't match a split node).
    expect(screen.getByText(/Showing/).textContent).toContain('IPOs');
  });

  it('displays filtered state when filters are active', () => {
    vi.mocked(HistoricalFiltersContext.useHistoricalFilters).mockReturnValue({
      hasActiveFilters: true,
      filters: {} as any,
      setYear: vi.fn(),
      setSector: vi.fn(),
      setPerformance: vi.fn(),
      setSort: vi.fn(),
      setSortOrder: vi.fn(),
      setSearchQuery: vi.fn(),
      setSearch: vi.fn(),
      setPage: vi.fn(),
      clearFilters: vi.fn(),
      updateURL: vi.fn(),
    });

    render(<ResultsCount total={50} />);

    expect(screen.getByText(/filtered/)).toBeInTheDocument();
  });

  it('displays singular "IPO" for single result', () => {
    render(<ResultsCount total={1} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    const text = screen.getByText(/Showing/).textContent ?? '';
    expect(text).toContain('IPO');
    expect(text).not.toContain('IPOs'); // singular only
  });

  it('displays loading state', () => {
    render(<ResultsCount total={100} loading={true} />);

    expect(screen.getByText('Loading results...')).toBeInTheDocument();
  });
});
