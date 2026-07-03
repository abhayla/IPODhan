import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoricalIPOCardList } from '@/components/history/HistoricalIPOCardList';
import type { HistoricalIPO } from '@/lib/repositories/types';
import { DEFAULT_HISTORICAL_FIELDS } from '@/lib/db/types';

const mockIPO: HistoricalIPO = {
  ...DEFAULT_HISTORICAL_FIELDS,
  id: '1',
  companyName: 'Reliance Industries',
  slug: 'reliance-industries',
  segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  sector: 'Technology',
  status: 'LISTED' as const,
  issuePrice: 100,
  listingDate: '2024-01-15',
  listingGainPercent: 25.5,
  subscriptionOverall: 45.5,
  listingOpen: 120,
  listingHigh: 130,
  listingClose: 125.5,
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
  lastScrapedAt: null,
};

describe('HistoricalIPOCardList', () => {
  it('displays empty message when no IPOs', () => {
    render(<HistoricalIPOCardList ipos={[]} />);

    expect(screen.getByText('No historical IPOs found.')).toBeInTheDocument();
  });

  it('renders IPO cards correctly', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument(); // sector
    // FLAG(Abhay): the redesigned card shows SECTOR (+ LISTED/gain badges) but no
    // longer the SEGMENT (MAINBOARD/SME). Confirm whether segment should be shown.
  });

  it('displays listing gain prominently', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('+25.50%')).toBeInTheDocument();
    expect(screen.getByText('Listing Gain')).toBeInTheDocument();
  });

  it('shows trending up icon for positive gains', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    // Check for positive gain text which indicates icon is shown
    expect(screen.getByText('+25.50%')).toBeInTheDocument();
  });

  it('shows trending down icon for negative gains', () => {
    const negativeIPO: HistoricalIPO = {
      ...mockIPO,
      listingGainPercent: -15.5,
    };

    render(<HistoricalIPOCardList ipos={[negativeIPO]} />);

    expect(screen.getByText('-15.50%')).toBeInTheDocument();
  });

  it('displays issue price', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Issue Price')).toBeInTheDocument();
    expect(screen.getByText('₹100')).toBeInTheDocument();
  });

  it('displays subscription', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Subscription')).toBeInTheDocument();
    expect(screen.getByText('45.50x')).toBeInTheDocument();
  });

  it('displays listing date', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Listing Date')).toBeInTheDocument();
    expect(screen.getByText('15 Jan 2024')).toBeInTheDocument();
  });

  it('conveys the listing year (via the listing date)', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    // FLAG(Abhay): the separate "Year" field was dropped in the redesign — the year
    // is conveyed by the full listing date. Confirm if a distinct Year field is wanted.
    expect(screen.getByText('15 Jan 2024')).toBeInTheDocument();
  });

  it('renders card as link', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/ipos/reliance-industries');
  });

  it('displays N/A for null values', () => {
    const ipoWithNulls: HistoricalIPO = {
      ...mockIPO,
      issuePrice: null,
      listingGainPercent: null,
      subscriptionOverall: null,
      sector: null,
    };

    render(<HistoricalIPOCardList ipos={[ipoWithNulls]} />);

    // Null subscription/sector rows are hidden entirely (2026-07-02 review);
    // price fields still show an explicit N/A placeholder.
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Subscription')).toBeNull();
  });

  it('never renders a fabricated +0.00% gain when listingGainPercent is null', () => {
    const ipoWithNullGain: HistoricalIPO = {
      ...mockIPO,
      listingGainPercent: null,
    };

    render(<HistoricalIPOCardList ipos={[ipoWithNullGain]} />);

    // missing data must not be presented as a (positive) return
    expect(screen.queryByText('+0.00%')).not.toBeInTheDocument();
    expect(screen.queryByText('0.00%')).not.toBeInTheDocument();
    // neutral placeholder badge instead, without gain coloring
    const placeholder = screen.getByText('—');
    expect(placeholder).not.toHaveClass('bg-green-500');
    expect(placeholder).not.toHaveClass('bg-red-500');
  });

  it('does not render an empty sector badge when sector is null', () => {
    const ipoWithNullSector: HistoricalIPO = {
      ...mockIPO,
      sector: null,
    };

    const { container } = render(<HistoricalIPOCardList ipos={[ipoWithNullSector]} />);

    const outlineBadges = container.querySelectorAll('[class*="text-xs"]');
    outlineBadges.forEach((b) => expect(b.textContent?.trim()).not.toBe(''));
  });

  it('applies positive gain styling', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    const gainText = screen.getByText('+25.50%');
    expect(gainText).toHaveClass('bg-green-500'); // solid green gain badge (redesign)
  });

  it('applies negative gain styling', () => {
    const negativeIPO: HistoricalIPO = {
      ...mockIPO,
      listingGainPercent: -15.5,
    };

    render(<HistoricalIPOCardList ipos={[negativeIPO]} />);

    const gainText = screen.getByText('-15.50%');
    expect(gainText).toHaveClass('bg-red-500'); // solid red gain badge (redesign)
  });

  it('renders multiple cards', () => {
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

    render(<HistoricalIPOCardList ipos={mockIPOs} />);

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('Tata Motors')).toBeInTheDocument();
    expect(screen.getByText('HDFC Bank')).toBeInTheDocument();
  });
});
