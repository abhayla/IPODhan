/**
 * Integration Tests for Historical IPOs Page
 *
 * Tests page rendering, filter state, and API integration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { HistoricalIPOsContent } from '@/app/history/HistoricalIPOsContent';
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

// Mock fetch
global.fetch = vi.fn();

const mockHistoricalIPOsResponse = {
  data: {
    ipos: [
      {
        id: '1',
        companyName: 'Tech Corp',
        slug: 'tech-corp',
        status: 'LISTED',
        issuePrice: 100,
        listingDate: '2024-01-15',
        listingOpen: 120,
        listingHigh: 130,
        listingClose: 125,
        listingGainPercent: 25.0,
        subscriptionOverall: 15.5,
        sector: 'Technology',
        year: 2024,
      },
    ],
    pagination: {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    },
  },
};

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <HistoricalFiltersProvider>{component}</HistoricalFiltersProvider>
  );
};

describe('Historical IPOs Page Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockHistoricalIPOsResponse,
    });
  });

  it('renders page at /history route', () => {
    renderWithProvider(<HistoricalIPOsContent />);
    expect(screen.getByText('IPO History')).toBeDefined();
  });

  it('fetches and displays historical IPOs on initial load', async () => {
    renderWithProvider(<HistoricalIPOsContent />);

    await waitFor(() => {
      expect(screen.getByText('Tech Corp')).toBeDefined();
    });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ipos/history')
    );
  });

  it('shows loading state during data fetch', () => {
    renderWithProvider(<HistoricalIPOsContent />);

    const loadingElement = screen.getByText(/Loading results/i);
    expect(loadingElement).toBeDefined();
  });

  it('displays empty state when no results', async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          ipos: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
        },
      }),
    });

    renderWithProvider(<HistoricalIPOsContent />);

    await waitFor(() => {
      expect(screen.getByText('No Historical IPOs Found')).toBeDefined();
    });
  });

  it('handles API errors gracefully', async () => {
    (global.fetch as any).mockRejectedValueOnce(new Error('API Error'));

    renderWithProvider(<HistoricalIPOsContent />);

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load historical IPOs/)
      ).toBeDefined();
    });
  });

  it('calls API with correct query parameters', async () => {
    renderWithProvider(<HistoricalIPOsContent />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/sort=listing_date/)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/sortOrder=DESC/)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/page=1/)
      );
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/limit=20/)
      );
    });
  });
});
