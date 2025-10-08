import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardContent } from '@/components/dashboard/DashboardContent';
import { IPO } from '@/lib/api-client';

// Mock Next.js navigation hooks
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => '/dashboard')
}));

// Mock child components
vi.mock('@/components/ipo/IPOGrid', () => ({
  IPOGrid: ({ ipos, view }: { ipos: IPO[]; view: string }) => (
    <div data-testid="ipo-grid" data-view={view}>
      {ipos.length} IPOs
    </div>
  )
}));

vi.mock('@/components/ui/pagination', () => ({
  Pagination: ({ currentPage, totalPages }: { currentPage: number; totalPages: number }) => (
    <div data-testid="pagination">
      Page {currentPage} of {totalPages}
    </div>
  )
}));

vi.mock('@/components/ui/view-toggle', () => ({
  ViewToggle: ({ currentView }: { currentView: string }) => (
    <div data-testid="view-toggle" data-view={currentView}>
      View Toggle
    </div>
  )
}));

vi.mock('@/components/dashboard/FilterBar', () => ({
  FilterBar: () => (
    <div data-testid="filter-bar">
      Filter Bar
    </div>
  )
}));

const mockIPO = (): IPO => ({
  id: '123',
  companyName: 'Test Company',
  slug: 'test-company',
  category: 'MAINBOARD',
  sector: 'Technology',
  issueSize: '500',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN',
  openDate: '2025-10-10',
  closeDate: '2025-10-12',
  allotmentDate: null,
  listingDate: null,
  companyDescription: null,
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  registrarId: null,
  leadManagers: [],
  rating: 4,
  ratingRationale: null,
  ratingOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastScrapedAt: null
});

describe('DashboardContent', () => {
  const mockPagination = {
    page: 1,
    limit: 12,
    total: 24,
    hasMore: true
  };

  it('should render dashboard header', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="grid"
      />
    );

    expect(screen.getByText('IPO Dashboard')).toBeInTheDocument();
    expect(screen.getByText(/24 IPOs found/i)).toBeInTheDocument();
  });

  it('should render IPOGrid component', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="grid"
      />
    );

    expect(screen.getByTestId('ipo-grid')).toBeInTheDocument();
  });

  it('should render ViewToggle component', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="grid"
      />
    );

    expect(screen.getByTestId('view-toggle')).toBeInTheDocument();
  });

  it('should render Pagination when totalPages > 1', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="grid"
      />
    );

    expect(screen.getByTestId('pagination')).toBeInTheDocument();
  });

  it('should not render Pagination when totalPages = 1', () => {
    const singlePagePagination = {
      ...mockPagination,
      total: 10,
      hasMore: false
    };

    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={singlePagePagination}
        initialView="grid"
      />
    );

    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
  });

  it('should pass correct view prop to IPOGrid (grid)', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="grid"
      />
    );

    const grid = screen.getByTestId('ipo-grid');
    expect(grid).toHaveAttribute('data-view', 'grid');
  });

  it('should pass correct view prop to IPOGrid (list)', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="list"
      />
    );

    const grid = screen.getByTestId('ipo-grid');
    expect(grid).toHaveAttribute('data-view', 'list');
  });

  it('should default to grid view when invalid view provided', () => {
    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={mockPagination}
        initialView="invalid"
      />
    );

    const grid = screen.getByTestId('ipo-grid');
    expect(grid).toHaveAttribute('data-view', 'grid');
  });

  it('should display correct total IPO count', () => {
    const paginationWith50 = { ...mockPagination, total: 50 };

    render(
      <DashboardContent
        initialIPOs={[mockIPO()]}
        initialPagination={paginationWith50}
        initialView="grid"
      />
    );

    expect(screen.getByText(/50 IPOs found/i)).toBeInTheDocument();
  });

  it('should render with empty IPO array', () => {
    render(
      <DashboardContent
        initialIPOs={[]}
        initialPagination={{ ...mockPagination, total: 0 }}
        initialView="grid"
      />
    );

    expect(screen.getByText('IPO Dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('ipo-grid')).toHaveTextContent('0 IPOs');
  });
});
