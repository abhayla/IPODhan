import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoricalIPOsPageClient } from '@/app/history/page-client';
import type { HistoricalIPO } from '@/lib/repositories/types';

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => ({
    get: vi.fn(() => null),
  }),
}));

const mockIPO: HistoricalIPO = {
  id: '1',
  companyName: 'Reliance Industries',
  slug: 'reliance-industries',
  category: 'MAINBOARD' as const,
  sector: 'Technology',
  status: 'LISTED' as const,
  issuePrice: 100,
  listingDate: '2024-01-15',
  listingGainPercent: 25.5,
  subscription: 45.5,
  year: 2024,
  priceRangeMin: 95,
  priceRangeMax: 105,
  lotSize: 100,
  openDate: '2024-01-10',
  closeDate: '2024-01-12',
  allotmentDate: null,
  companyDescription: null,
  faceValue: null,
  listingExchanges: null,
  registrar: null,
  registrarId: null,
  leadManagers: null,
  rating: null,
  ratingRationale: null,
  ratingOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  issueSize: null,
  listingClose: null,
};

const mockInitialData = {
  data: [mockIPO],
  pagination: {
    page: 1,
    limit: 20,
    total: 1,
    hasMore: false,
  },
};

describe('Historical IPOs Page Integration', () => {
  beforeAll(() => {
    // Mock fetch for API calls
    global.fetch = vi.fn();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('renders page with initial data', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText('Historical IPOs')).toBeInTheDocument();
    expect(screen.getByText(/Browse past IPO performance/)).toBeInTheDocument();
  });

  it('displays IPO data in table on desktop', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
  });

  it('displays filter sidebar', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByText('Year')).toBeInTheDocument();
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByText('Listing Performance')).toBeInTheDocument();
  });

  it('displays search bar', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search by company name...');
    expect(searchInput).toBeInTheDocument();
  });

  it('displays results count', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText(/Showing/)).toBeInTheDocument();
    expect(screen.getByText('1-1')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('displays empty state when no results', () => {
    const emptyData = {
      data: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        hasMore: false,
      },
    };

    render(
      <HistoricalIPOsPageClient
        initialData={emptyData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText('No IPOs Found')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Clear All Filters/i })).toBeInTheDocument();
  });

  it('includes structured data for SEO', () => {
    const { container } = render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).toBeInTheDocument();

    if (script && script.textContent) {
      const structuredData = JSON.parse(script.textContent);
      expect(structuredData['@context']).toBe('https://schema.org');
      expect(structuredData['@type']).toBe('CollectionPage');
      expect(structuredData.name).toBe('Historical IPOs Database');
    }
  });

  it('initializes filters from search params', () => {
    render(
      <HistoricalIPOsPageClient
        initialData={mockInitialData}
        availableSectors={['Technology', 'Finance']}
        availableYears={['2023', '2024']}
        searchParams={{
          year: '2024',
          sector: 'Technology',
          performance: 'Positive',
        }}
      />
    );

    // Filters should be initialized with these values
    expect(screen.getByText('Historical IPOs')).toBeInTheDocument();
  });

  it('displays pagination when needed', () => {
    const multiPageData = {
      data: Array(20).fill(mockIPO).map((ipo, index) => ({
        ...ipo,
        id: String(index + 1),
        companyName: `Company ${index + 1}`,
        slug: `company-${index + 1}`,
      })),
      pagination: {
        page: 1,
        limit: 20,
        total: 100,
        hasMore: true,
      },
    };

    render(
      <HistoricalIPOsPageClient
        initialData={multiPageData}
        availableSectors={['Technology']}
        availableYears={['2024']}
        searchParams={{}}
      />
    );

    expect(screen.getByText(/Next/)).toBeInTheDocument();
  });
});
