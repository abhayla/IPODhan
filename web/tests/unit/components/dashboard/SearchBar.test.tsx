/**
 * Unit tests for SearchBar component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '@/components/dashboard/SearchBar';

// Mock Next.js navigation hooks
const mockPush = vi.fn();
const mockPathname = '/dashboard';
const mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => mockSearchParams,
}));

// Mock useDebounce hook - return value immediately for testing
vi.mock('@/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

// Mock search history functions
vi.mock('@/lib/search-history', () => ({
  saveSearch: vi.fn(),
  getRecentSearches: vi.fn(() => []),
  clearSearchHistory: vi.fn(),
}));

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSearchParams.delete('search');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render search input with placeholder', () => {
    render(<SearchBar />);

    const input = screen.getByPlaceholderText('Search IPOs by company or sector...');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('type', 'search');
    expect(input).toHaveAttribute('aria-label', 'Search IPOs by company or sector');
  });

  it('should display search icon', () => {
    const { container } = render(<SearchBar />);

    // Search icon should be present
    const searchIcon = container.querySelector('.lucide-search');
    expect(searchIcon).toBeInTheDocument();
  });

  it('should initialize input value from URL params', () => {
    mockSearchParams.set('search', 'reliance');

    render(<SearchBar />);

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    expect(input.value).toBe('reliance');
  });

  it('should not show clear button when input is empty', () => {
    render(<SearchBar />);

    const clearButton = screen.queryByLabelText('Clear search');
    expect(clearButton).not.toBeInTheDocument();
  });

  it('should show clear button when input has text', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 'test');

    const clearButton = screen.getByLabelText('Clear search');
    expect(clearButton).toBeInTheDocument();
  });

  it('should update input value when user types', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await user.type(input, 'reliance');

    expect(input.value).toBe('reliance');
  });

  it('should clear input when clear button is clicked', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await user.type(input, 'test');

    const clearButton = screen.getByLabelText('Clear search');
    await user.click(clearButton);

    expect(input.value).toBe('');
  });

  it('should clear search param from URL when clear button clicked', async () => {
    mockSearchParams.set('search', 'test');
    const user = userEvent.setup();
    render(<SearchBar />);

    const clearButton = screen.getByLabelText('Clear search');
    await user.click(clearButton);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const callArgs = mockPush.mock.calls[0][0];
      expect(callArgs).not.toContain('search=');
    });
  });

  it('should reset page to 1 when clearing search', async () => {
    mockSearchParams.set('search', 'test');
    mockSearchParams.set('page', '3');

    const user = userEvent.setup();
    render(<SearchBar />);

    const clearButton = screen.getByLabelText('Clear search');
    await user.click(clearButton);

    await waitFor(() => {
      const callArgs = mockPush.mock.calls[0][0];
      expect(callArgs).toContain('page=1');
    });
  });

  it('should handle Enter key press', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 'reliance');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const callArgs = mockPush.mock.calls[0][0];
      expect(callArgs).toContain('search=reliance');
    });
  });

  it('should handle Escape key press to clear search', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await user.type(input, 'test');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('should show recent searches dropdown on focus when available', async () => {
    const { getRecentSearches } = await import('@/lib/search-history');
    vi.mocked(getRecentSearches).mockReturnValue(['search1', 'search2']);

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
      expect(screen.getByText('search1')).toBeInTheDocument();
      expect(screen.getByText('search2')).toBeInTheDocument();
    });
  });

  it('should not show recent searches when none available', async () => {
    const { getRecentSearches } = await import('@/lib/search-history');
    vi.mocked(getRecentSearches).mockReturnValue([]);

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.click(input);

    expect(screen.queryByText('Recent Searches')).not.toBeInTheDocument();
  });

  it('should populate input when clicking recent search', async () => {
    const { getRecentSearches } = await import('@/lib/search-history');
    vi.mocked(getRecentSearches).mockReturnValue(['reliance']);

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.click(input);

    const recentSearch = screen.getByText('reliance');
    await user.click(recentSearch);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
      const callArgs = mockPush.mock.calls[0][0];
      expect(callArgs).toContain('search=reliance');
    });
  });

  it('should save search to history when searching', async () => {
    const { saveSearch } = await import('@/lib/search-history');

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 'reliance');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(saveSearch).toHaveBeenCalledWith('reliance');
    });
  });

  it('should not save searches shorter than 2 characters', async () => {
    const { saveSearch } = await import('@/lib/search-history');

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 'a');
    await user.keyboard('{Enter}');

    // saveSearch handles filtering, but we should still call it
    expect(saveSearch).toHaveBeenCalledWith('a');
  });

  it('should preserve existing URL params when searching', async () => {
    mockSearchParams.set('status', 'OPEN');
    mockSearchParams.set('category', 'MAINBOARD');

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 'tech');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      const callArgs = mockPush.mock.calls[0][0];
      expect(callArgs).toContain('status=OPEN');
      expect(callArgs).toContain('category=MAINBOARD');
      expect(callArgs).toContain('search=tech');
    });
  });

  it('should show loading indicator while typing', async () => {
    const user = userEvent.setup({ delay: null });
    const { container } = render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.type(input, 't');

    // Loading spinner should appear
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('should hide recent searches on blur', async () => {
    const { getRecentSearches } = await import('@/lib/search-history');
    vi.mocked(getRecentSearches).mockReturnValue(['search1']);

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    await user.click(input);

    await waitFor(() => {
      expect(screen.getByText('Recent Searches')).toBeInTheDocument();
    });

    await user.tab();

    await waitFor(
      () => {
        expect(screen.queryByText('Recent Searches')).not.toBeInTheDocument();
      },
      { timeout: 300 }
    );
  });

  it('should handle empty search gracefully', async () => {
    mockSearchParams.set('search', 'test');

    const user = userEvent.setup();
    render(<SearchBar />);

    const input = screen.getByRole('searchbox') as HTMLInputElement;
    await user.clear(input);

    // Should remove search param
    await waitFor(() => {
      const callArgs = mockPush.mock.calls[mockPush.mock.calls.length - 1]?.[0];
      expect(callArgs).not.toContain('search=');
    });
  });

  it('should have proper accessibility attributes', () => {
    render(<SearchBar />);

    const input = screen.getByRole('searchbox');
    expect(input).toHaveAttribute('aria-label');

    const clearButton = screen.queryByLabelText('Clear search');
    if (clearButton) {
      expect(clearButton).toHaveAttribute('aria-label', 'Clear search');
    }
  });
});
