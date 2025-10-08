/**
 * Unit Tests for ListingPerformance Component
 *
 * Tests:
 * - Renders issue price and listing price correctly
 * - Shows listing day return badge
 * - Displays current price and overall return when available
 * - Shows sector average comparison section
 * - Hides sector comparison when unavailable
 * - Formats currency values correctly
 * - Renders disclaimer text
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingPerformance } from '@/components/ipo/ListingPerformance';

describe('ListingPerformance', () => {
  const mockDataMinimal = {
    issuePrice: 100,
    listingPrice: 125,
    listingGainPercent: 25.0,
  };

  const mockDataComplete = {
    issuePrice: 100,
    listingPrice: 125,
    listingGainPercent: 25.0,
    currentPrice: 150,
    currentGainPercent: 50.0,
  };

  it('renders issue price and listing price', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('Issue Price')).toBeInTheDocument();
    expect(screen.getByText('Listing Price')).toBeInTheDocument();
    expect(screen.getByText('₹100')).toBeInTheDocument();
    expect(screen.getByText('₹125')).toBeInTheDocument();
  });

  it('displays listing day return badge', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('Listing Day Return')).toBeInTheDocument();
    expect(screen.getByText('+25.0%')).toBeInTheDocument();
  });

  it('shows current price and overall return when available', () => {
    render(
      <ListingPerformance
        data={mockDataComplete}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('Current Price')).toBeInTheDocument();
    expect(screen.getByText('Overall Return')).toBeInTheDocument();
    expect(screen.getByText('₹150')).toBeInTheDocument();
    expect(screen.getByText('+50.0%')).toBeInTheDocument();
  });

  it('hides current price section when not available', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.queryByText('Current Price')).not.toBeInTheDocument();
    expect(screen.queryByText('Overall Return')).not.toBeInTheDocument();
  });

  it('shows sector average comparison when available', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={20.0}
      />
    );

    expect(screen.getByText('Above Average')).toBeInTheDocument();
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText(/sector average/i)).toBeInTheDocument();
  });

  it('hides sector comparison when sector average is null', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.queryByText('Above Average')).not.toBeInTheDocument();
    expect(screen.queryByText('Below Average')).not.toBeInTheDocument();
  });

  it('hides sector comparison when sector is null', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector={null}
        sectorAverage={20.0}
      />
    );

    expect(screen.queryByText('Above Average')).not.toBeInTheDocument();
    expect(screen.queryByText('Below Average')).not.toBeInTheDocument();
  });

  it('renders disclaimer text', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(
      screen.getByText(/Listing performance is calculated based on the difference/i)
    ).toBeInTheDocument();
  });

  it('handles negative listing gain', () => {
    const negativeData = {
      issuePrice: 100,
      listingPrice: 85,
      listingGainPercent: -15.0,
    };

    render(
      <ListingPerformance
        data={negativeData}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('-15.0%')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
        className="custom-card"
      />
    );

    const card = container.querySelector('.custom-card');
    expect(card).toBeInTheDocument();
  });

  it('shows below average badge when underperforming sector', () => {
    render(
      <ListingPerformance
        data={{ ...mockDataMinimal, listingGainPercent: 10.0 }}
        sector="Technology"
        sectorAverage={25.0}
      />
    );

    expect(screen.getByText('Below Average')).toBeInTheDocument();
  });

  it('formats large currency values correctly', () => {
    const largeData = {
      issuePrice: 10000,
      listingPrice: 15000,
      listingGainPercent: 50.0,
    };

    render(
      <ListingPerformance
        data={largeData}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('₹10,000')).toBeInTheDocument();
    expect(screen.getByText('₹15,000')).toBeInTheDocument();
  });

  it('handles current price of 0', () => {
    const zeroCurrentPrice = {
      issuePrice: 100,
      listingPrice: 125,
      listingGainPercent: 25.0,
      currentPrice: 0,
      currentGainPercent: -100.0,
    };

    render(
      <ListingPerformance
        data={zeroCurrentPrice}
        sector="Technology"
        sectorAverage={null}
      />
    );

    // Should not show current price when it's 0
    expect(screen.queryByText('Current Price')).not.toBeInTheDocument();
  });

  it('renders card title', () => {
    render(
      <ListingPerformance
        data={mockDataMinimal}
        sector="Technology"
        sectorAverage={null}
      />
    );

    expect(screen.getByText('Listing Performance')).toBeInTheDocument();
  });
});
