import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoricalIPOTable } from '@/components/history/HistoricalIPOTable';
import type { HistoricalIPO } from '@/lib/repositories/types';

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
  lastScrapedAt: null,
};

describe('HistoricalIPOTable', () => {
  it('renders table headers', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[]} onSort={onSort} />);

    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByText('Issue Price')).toBeInTheDocument();
    expect(screen.getByText('Listing Date')).toBeInTheDocument();
    expect(screen.getByText('Listing Gain')).toBeInTheDocument();
    expect(screen.getByText('Subscription')).toBeInTheDocument();
  });

  it('displays empty state when no IPOs', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[]} onSort={onSort} />);

    expect(screen.getByText('No historical IPOs found.')).toBeInTheDocument();
  });

  it('renders IPO data correctly', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('MAINBOARD')).toBeInTheDocument();
    expect(screen.getByText('+25.50%')).toBeInTheDocument();
    expect(screen.getByText('45.50x')).toBeInTheDocument();
  });

  it('formats currency correctly', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    expect(screen.getByText('₹100')).toBeInTheDocument();
  });

  it('formats date correctly', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    expect(screen.getByText('15 Jan 2024')).toBeInTheDocument();
  });

  it('displays N/A for null values', () => {
    const ipoWithNulls: HistoricalIPO = {
      ...mockIPO,
      issuePrice: null,
      listingGainPercent: null,
      subscription: null,
      sector: null,
    };

    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[ipoWithNulls]} onSort={onSort} />);

    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBeGreaterThanOrEqual(3);
  });

  it('displays positive gains in green', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    const gainCell = screen.getByText('+25.50%');
    expect(gainCell).toHaveClass('text-green-600');
  });

  it('displays negative gains in red', () => {
    const negativeIPO: HistoricalIPO = {
      ...mockIPO,
      listingGainPercent: -15.5,
    };

    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[negativeIPO]} onSort={onSort} />);

    const gainCell = screen.getByText('-15.50%');
    expect(gainCell).toHaveClass('text-red-600');
  });

  it('calls onSort when listing date header is clicked', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    const listingDateButton = screen.getByRole('button', { name: /Listing Date/i });
    fireEvent.click(listingDateButton);

    expect(onSort).toHaveBeenCalledWith('listing_date');
  });

  it('calls onSort when listing gain header is clicked', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    const listingGainButton = screen.getByRole('button', { name: /Listing Gain/i });
    fireEvent.click(listingGainButton);

    expect(onSort).toHaveBeenCalledWith('listing_gain');
  });

  it('calls onSort when subscription header is clicked', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    const subscriptionButton = screen.getByRole('button', { name: /Subscription/i });
    fireEvent.click(subscriptionButton);

    expect(onSort).toHaveBeenCalledWith('subscription');
  });

  it('displays sort icon on active column', () => {
    const onSort = vi.fn();
    render(
      <HistoricalIPOTable
        ipos={[mockIPO]}
        sortColumn="listing_date"
        sortOrder="desc"
        onSort={onSort}
      />
    );

    const listingDateButton = screen.getByRole('button', { name: /Listing Date/i });
    const svg = listingDateButton.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders company name as link', () => {
    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={[mockIPO]} onSort={onSort} />);

    const link = screen.getByRole('link', { name: /Reliance Industries/i });
    expect(link).toHaveAttribute('href', '/ipos/reliance-industries');
  });

  it('renders multiple IPOs correctly', () => {
    const mockIPOs: HistoricalIPO[] = [
      mockIPO,
      {
        ...mockIPO,
        id: '2',
        companyName: 'Tata Motors',
        slug: 'tata-motors',
      },
      {
        ...mockIPO,
        id: '3',
        companyName: 'HDFC Bank',
        slug: 'hdfc-bank',
      },
    ];

    const onSort = vi.fn();
    render(<HistoricalIPOTable ipos={mockIPOs} onSort={onSort} />);

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('Tata Motors')).toBeInTheDocument();
    expect(screen.getByText('HDFC Bank')).toBeInTheDocument();
  });
});
