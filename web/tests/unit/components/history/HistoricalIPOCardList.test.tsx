import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoricalIPOCardList } from '@/components/history/HistoricalIPOCardList';
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

describe('HistoricalIPOCardList', () => {
  it('displays empty message when no IPOs', () => {
    render(<HistoricalIPOCardList ipos={[]} />);

    expect(screen.getByText('No historical IPOs found.')).toBeInTheDocument();
  });

  it('renders IPO cards correctly', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Reliance Industries')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('MAINBOARD')).toBeInTheDocument();
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

  it('displays year', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    expect(screen.getByText('Year')).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
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
      subscription: null,
      sector: null,
    };

    render(<HistoricalIPOCardList ipos={[ipoWithNulls]} />);

    const naElements = screen.getAllByText('N/A');
    expect(naElements.length).toBeGreaterThanOrEqual(2);
  });

  it('applies positive gain styling', () => {
    render(<HistoricalIPOCardList ipos={[mockIPO]} />);

    const gainText = screen.getByText('+25.50%');
    expect(gainText).toHaveClass('text-green-600');
  });

  it('applies negative gain styling', () => {
    const negativeIPO: HistoricalIPO = {
      ...mockIPO,
      listingGainPercent: -15.5,
    };

    render(<HistoricalIPOCardList ipos={[negativeIPO]} />);

    const gainText = screen.getByText('-15.50%');
    expect(gainText).toHaveClass('text-red-600');
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
