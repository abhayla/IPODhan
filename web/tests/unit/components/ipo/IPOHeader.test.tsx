import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IPOHeader } from '@/components/ipo/IPOHeader';
import type { IPO } from '@/lib/db/types';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

// IPOHeader renders <AddToCompareButton>, which calls useRouter() from
// next/navigation — unmounted in jsdom → "invariant expected app router to be
// mounted". Mock the App Router (canonical pattern, see tests/unit/app/ipos/slug/page.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  })),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  usePathname: vi.fn(() => '/ipos/test-company'),
}));

const mockIPO: IPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: '1',
  companyName: 'Test Company Ltd',
  slug: 'test-company',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  sector: 'Technology',
  issueSize: '500.00',
  priceRangeMin: 100,
  priceRangeMax: 120,
  lotSize: 100,
  status: 'OPEN',
  openDate: '2025-01-10',
  closeDate: '2025-01-12',
  allotmentDate: '2025-01-15',
  listingDate: '2025-01-20',
  companyDescription: 'A technology company',
  faceValue: 10,
  listingExchanges: ['NSE', 'BSE'],
  registrar: 'Link Intime',
  registrarId: null,
  leadManagers: ['Manager 1', 'Manager 2'],
  rating: 4.5,
  ratingRationale: 'Strong fundamentals',
  ratingOverride: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastScrapedAt: null,
};

describe('IPOHeader', () => {
  it('should render company name as h1', () => {
    render(<IPOHeader ipo={mockIPO} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Company Ltd');
  });

  it('should display correct status badge for OPEN status', () => {
    render(<IPOHeader ipo={mockIPO} />);
    expect(screen.getByText('Open Now')).toBeInTheDocument();
  });

  it('should display category badge', () => {
    render(<IPOHeader ipo={mockIPO} />);
    expect(screen.getByText('MAINBOARD')).toBeInTheDocument();
  });

  it('should display sector information', () => {
    render(<IPOHeader ipo={mockIPO} />);
    expect(screen.getByText('Technology')).toBeInTheDocument();
  });

  it('should render RatingDisplay component', () => {
    render(<IPOHeader ipo={mockIPO} />);
    expect(screen.getByText('4.5')).toBeInTheDocument();
  });

  it('should handle missing logo gracefully', () => {
    const { container } = render(<IPOHeader ipo={mockIPO} />);
    // Should show Building2 icon as placeholder
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
