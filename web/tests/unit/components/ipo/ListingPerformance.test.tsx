/**
 * Unit Tests: ListingPerformance Component
 *
 * Tests for the listing performance detail component (Story 6.3)
 * Coverage: Metric display, percentage calculations, color coding, date formatting
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingPerformance } from '@/components/ipo/ListingPerformance';

describe('ListingPerformance', () => {
  const mockProps = {
    issuePrice: 300,
    listingOpen: 315,
    listingHigh: 350,
    listingClose: 340,
    listingDate: new Date('2024-12-15'),
    listingGainPercent: 13.33,
  };

  describe('Rendering', () => {
    it('renders with complete listing data', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Listing Day Performance')).toBeInTheDocument();
      expect(screen.getByText(/Listing Date:/)).toBeInTheDocument();
    });

    it('does not render if listingDate is null', () => {
      const { container } = render(
        <ListingPerformance {...mockProps} listingDate={null as unknown as Date} />
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe('Price Display', () => {
    it('displays issue price', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Issue Price')).toBeInTheDocument();
      expect(screen.getByText('₹300')).toBeInTheDocument();
    });

    it('displays listing open price', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Listing Open')).toBeInTheDocument();
      expect(screen.getByText('₹315')).toBeInTheDocument();
    });

    it('displays listing high price', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Listing High')).toBeInTheDocument();
      expect(screen.getByText('₹350')).toBeInTheDocument();
    });

    it('displays listing close price', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Listing Close')).toBeInTheDocument();
      expect(screen.getByText('₹340')).toBeInTheDocument();
    });

    it('formats currency with comma separators for large numbers', () => {
      render(
        <ListingPerformance
          {...mockProps}
          issuePrice={1500}
          listingClose={2000}
        />
      );

      expect(screen.getByText('₹1,500')).toBeInTheDocument();
      expect(screen.getByText('₹2,000')).toBeInTheDocument();
    });
  });

  describe('Percentage Gain Calculations', () => {
    it('calculates open gain correctly', () => {
      render(<ListingPerformance {...mockProps} />);

      // Open gain: ((315 - 300) / 300) * 100 = 5%
      expect(screen.getByText('+5.00%')).toBeInTheDocument();
    });

    it('calculates high gain correctly', () => {
      render(<ListingPerformance {...mockProps} />);

      // High gain: ((350 - 300) / 300) * 100 = 16.67%
      expect(screen.getByText('+16.67%')).toBeInTheDocument();
    });

    it('calculates close gain correctly', () => {
      render(<ListingPerformance {...mockProps} />);

      // Close gain: ((340 - 300) / 300) * 100 = 13.33%
      expect(screen.getByText('+13.33%')).toBeInTheDocument();
    });

    it('displays day return prominently', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('Day Return')).toBeInTheDocument();
      // Day return should appear at least twice (desktop table + mobile)
      const dayReturns = screen.getAllByText('+13.33%');
      expect(dayReturns.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Color Coding', () => {
    it('color-codes positive gains as green', () => {
      const { container } = render(<ListingPerformance {...mockProps} />);

      // Find elements with text-green-600 class
      const greenElements = container.querySelectorAll('.text-green-600');
      expect(greenElements.length).toBeGreaterThan(0);
    });

    it('color-codes negative losses as red', () => {
      const { container } = render(
        <ListingPerformance
          {...mockProps}
          listingOpen={280}
          listingHigh={290}
          listingClose={285}
          listingGainPercent={-5.0}
        />
      );

      // Find elements with text-red-600 class
      const redElements = container.querySelectorAll('.text-red-600');
      expect(redElements.length).toBeGreaterThan(0);
    });
  });

  describe('Date Formatting', () => {
    it('displays listing date in DD MMM YYYY format', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('15 Dec 2024')).toBeInTheDocument();
    });

    it('handles different date formats correctly', () => {
      render(
        <ListingPerformance {...mockProps} listingDate={new Date('2023-01-05')} />
      );

      expect(screen.getByText('05 Jan 2023')).toBeInTheDocument();
    });
  });

  describe('Percentage Formatting', () => {
    it('formats percentages with + sign for gains', () => {
      render(<ListingPerformance {...mockProps} />);

      expect(screen.getByText('+5.00%')).toBeInTheDocument();
      expect(screen.getByText('+16.67%')).toBeInTheDocument();
    });

    it('formats percentages with - sign for losses', () => {
      render(
        <ListingPerformance
          {...mockProps}
          listingOpen={280}
          listingHigh={290}
          listingClose={285}
          listingGainPercent={-5.0}
        />
      );

      expect(screen.getByText('-6.67%')).toBeInTheDocument();
      expect(screen.getByText('-3.33%')).toBeInTheDocument();
      expect(screen.getByText('-5.00%')).toBeInTheDocument();
    });

    it('formats percentages with 2 decimal places', () => {
      render(<ListingPerformance {...mockProps} />);

      // Check that all percentages have 2 decimal places
      const percentages = screen.getAllByText(/[+-]?\d+\.\d{2}%/);
      expect(percentages.length).toBeGreaterThan(0);
    });
  });

  describe('Responsive Design', () => {
    it('renders desktop table layout', () => {
      const { container } = render(<ListingPerformance {...mockProps} />);

      // Check for table elements (visible on md and above)
      const table = container.querySelector('table');
      expect(table).toBeInTheDocument();
    });

    it('renders mobile stacked layout', () => {
      const { container } = render(<ListingPerformance {...mockProps} />);

      // Check for mobile layout divs
      const mobileLayout = container.querySelector('.md\\:hidden');
      expect(mobileLayout).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles zero gain correctly', () => {
      render(
        <ListingPerformance
          {...mockProps}
          issuePrice={300}
          listingOpen={300}
          listingHigh={300}
          listingClose={300}
          listingGainPercent={0}
        />
      );

      // Zero should be displayed without sign
      expect(screen.getByText('0.00%')).toBeInTheDocument();
    });

    it('handles very large gains', () => {
      render(
        <ListingPerformance
          {...mockProps}
          listingOpen={600}
          listingHigh={900}
          listingClose={750}
          listingGainPercent={150.0}
        />
      );

      expect(screen.getByText('+100.00%')).toBeInTheDocument(); // Open gain
      expect(screen.getByText('+200.00%')).toBeInTheDocument(); // High gain
      expect(screen.getByText('+150.00%')).toBeInTheDocument(); // Close/day return
    });

    it('handles very small gains', () => {
      render(
        <ListingPerformance
          {...mockProps}
          listingOpen={300.5}
          listingHigh={301}
          listingClose={300.75}
          listingGainPercent={0.25}
        />
      );

      expect(screen.getByText('+0.17%')).toBeInTheDocument(); // Open gain
      expect(screen.getByText('+0.33%')).toBeInTheDocument(); // High gain
      expect(screen.getByText('+0.25%')).toBeInTheDocument(); // Close/day return
    });
  });
});
