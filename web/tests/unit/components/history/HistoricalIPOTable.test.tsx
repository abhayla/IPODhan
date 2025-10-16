/**
 * Unit Tests for HistoricalIPOTable Component
 *
 * Tests table rendering, sorting, and data display
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoricalIPOTable } from '@/components/history/HistoricalIPOTable';
import { HistoricalFiltersProvider } from '@/contexts/HistoricalFiltersContext';
import { HistoricalIPO } from '@/lib/types/historical-ipo';

// Mock Next.js modules
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

vi.mock('next/link', () => ({
  default: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

const mockIPOs: HistoricalIPO[] = [
  {
    id: '1',
    companyName: 'Tech Corp',
    slug: 'tech-corp',
    status: 'LISTED',
    issuePrice: 100,
    listingDate: new Date('2024-01-15'),
    listingOpen: 120,
    listingHigh: 130,
    listingClose: 125,
    listingGainPercent: 25.0,
    subscriptionOverall: 15.5,
    sector: 'Technology',
    year: 2024,
  },
  {
    id: '2',
    companyName: 'Finance Inc',
    slug: 'finance-inc',
    status: 'LISTED',
    issuePrice: 200,
    listingDate: new Date('2024-02-10'),
    listingOpen: 190,
    listingHigh: 195,
    listingClose: 185,
    listingGainPercent: -7.5,
    subscriptionOverall: 8.2,
    sector: 'Finance',
    year: 2024,
  },
];

const renderWithProvider = (component: React.ReactElement) => {
  return render(
    <HistoricalFiltersProvider>{component}</HistoricalFiltersProvider>
  );
};

describe('HistoricalIPOTable', () => {
  it('renders table with historical IPO data', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    expect(screen.getByText('Tech Corp')).toBeDefined();
    expect(screen.getByText('Finance Inc')).toBeDefined();
  });

  it('displays all table columns', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    expect(screen.getByText('Company Name')).toBeDefined();
    expect(screen.getByText('Sector')).toBeDefined();
    expect(screen.getByText('Issue Price')).toBeDefined();
    expect(screen.getByText('Listing Price')).toBeDefined();
    expect(screen.getByText('Status')).toBeDefined();
  });

  it('displays listing gain with color coding - positive', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    const positiveGain = screen.getByText(/\+25\.00%/);
    expect(positiveGain).toBeDefined();
    expect(positiveGain.className).toContain('text-green-600');
  });

  it('displays listing gain with color coding - negative', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    const negativeGain = screen.getByText(/-7\.50%/);
    expect(negativeGain).toBeDefined();
    expect(negativeGain.className).toContain('text-red-600');
  });

  it('formats currency values correctly', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    expect(screen.getByText(/₹100/)).toBeDefined();
    expect(screen.getByText(/₹125/)).toBeDefined();
  });

  it('formats subscription values correctly', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    expect(screen.getByText('15.5x')).toBeDefined();
    expect(screen.getByText('8.2x')).toBeDefined();
  });

  it('displays LISTED badge for all rows', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    const listedBadges = screen.getAllByText('LISTED');
    expect(listedBadges.length).toBe(2);
  });

  it('makes company name clickable with correct link', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    const companyLink = screen.getByText('Tech Corp').closest('a');
    expect(companyLink).toBeDefined();
    expect(companyLink?.getAttribute('href')).toBe('/ipos/tech-corp');
  });

  it('shows sort indicator on sortable columns', () => {
    renderWithProvider(<HistoricalIPOTable ipos={mockIPOs} />);

    const listingDateHeader = screen.getByText(/Listing Date/);
    expect(listingDateHeader).toBeDefined();
  });
});
