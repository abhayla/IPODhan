/**
 * Unit Tests for HolidayCard Component
 * Story 5.4: Market Holidays Calendar
 *
 * Tests:
 * - Rendering of holiday information (date, name, exchange)
 * - Date format display (DD MMM YYYY)
 * - Day of week display
 * - Upcoming badge display logic
 * - Past holiday muted styling
 * - Exchange badge display (NSE, BSE, Both)
 * - Holiday type display
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HolidayCard } from '@/components/market-holidays/HolidayCard';
import type { MarketHoliday } from '@/lib/db/types';

// Helper function to create mock holiday data
const mockHoliday = (overrides?: Partial<MarketHoliday>): MarketHoliday => ({
  id: 'holiday-123',
  date: '2025-01-26',
  description: 'Republic Day',
  exchange: 'BOTH',
  type: 'TRADING',
  year: 2025,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

describe('HolidayCard', () => {
  describe('Rendering', () => {
    it('should render holiday description', () => {
      const holiday = mockHoliday();
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('Republic Day')).toBeInTheDocument();
    });

    it('should render formatted date (DD MMM YYYY)', () => {
      const holiday = mockHoliday({ date: '2025-01-26' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('26 Jan 2025')).toBeInTheDocument();
    });

    it('should render day of week', () => {
      const holiday = mockHoliday({ date: '2025-01-26' }); // Sunday
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('Sunday')).toBeInTheDocument();
    });
  });

  describe('Upcoming Badge', () => {
    it('should display "Upcoming" badge when isUpcoming is true', () => {
      const holiday = mockHoliday();
      render(<HolidayCard holiday={holiday} isUpcoming={true} isPast={false} />);

      expect(screen.getByText('Upcoming')).toBeInTheDocument();
    });

    it('should not display "Upcoming" badge when isUpcoming is false', () => {
      const holiday = mockHoliday();
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.queryByText('Upcoming')).not.toBeInTheDocument();
    });

    it('should not display "Upcoming" badge when isPast is true', () => {
      const holiday = mockHoliday();
      render(<HolidayCard holiday={holiday} isUpcoming={true} isPast={true} />);

      expect(screen.queryByText('Upcoming')).not.toBeInTheDocument();
    });
  });

  describe('Past Holiday Styling', () => {
    it('should apply opacity styling when isPast is true', () => {
      const holiday = mockHoliday();
      const { container } = render(
        <HolidayCard holiday={holiday} isUpcoming={false} isPast={true} />
      );

      const card = container.querySelector('[class*="opacity"]');
      expect(card).toBeInTheDocument();
    });

    it('should not apply opacity styling when isPast is false', () => {
      const holiday = mockHoliday();
      const { container } = render(
        <HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />
      );

      const card = container.querySelector('[class*="opacity-60"]');
      expect(card).not.toBeInTheDocument();
    });
  });

  describe('Exchange Badge Display', () => {
    it('should display "NSE" badge for NSE exchange', () => {
      const holiday = mockHoliday({ exchange: 'NSE' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('NSE')).toBeInTheDocument();
    });

    it('should display "BSE" badge for BSE exchange', () => {
      const holiday = mockHoliday({ exchange: 'BSE' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('BSE')).toBeInTheDocument();
    });

    it('should display "NSE & BSE" badge for BOTH exchange', () => {
      const holiday = mockHoliday({ exchange: 'BOTH' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('NSE & BSE')).toBeInTheDocument();
    });
  });

  describe('Holiday Type Display', () => {
    it('should not display type for TRADING holidays', () => {
      const holiday = mockHoliday({ type: 'TRADING' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.queryByText(/Type:/)).not.toBeInTheDocument();
    });

    it('should display "Settlement Only" for SETTLEMENT type', () => {
      const holiday = mockHoliday({ type: 'SETTLEMENT' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('Type: Settlement Only')).toBeInTheDocument();
    });

    it('should display "Trading & Settlement" for BOTH type', () => {
      const holiday = mockHoliday({ type: 'BOTH' });
      render(<HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />);

      expect(screen.getByText('Type: Trading & Settlement')).toBeInTheDocument();
    });
  });

  describe('Multiple Holidays', () => {
    it('should render different holiday dates correctly', () => {
      const holiday1 = mockHoliday({ date: '2025-03-14', description: 'Holi' });
      const holiday2 = mockHoliday({ date: '2025-08-15', description: 'Independence Day' });

      const { rerender } = render(
        <HolidayCard holiday={holiday1} isUpcoming={false} isPast={false} />
      );
      expect(screen.getByText('14 Mar 2025')).toBeInTheDocument();
      expect(screen.getByText('Holi')).toBeInTheDocument();

      rerender(<HolidayCard holiday={holiday2} isUpcoming={false} isPast={false} />);
      expect(screen.getByText('15 Aug 2025')).toBeInTheDocument();
      expect(screen.getByText('Independence Day')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper structure for screen readers', () => {
      const holiday = mockHoliday();
      render(
        <HolidayCard holiday={holiday} isUpcoming={false} isPast={false} />
      );

      // Check that date, description, and exchange are all rendered
      expect(screen.getByText('26 Jan 2025')).toBeInTheDocument();
      expect(screen.getByText('Republic Day')).toBeInTheDocument();
      expect(screen.getByText('NSE & BSE')).toBeInTheDocument();
      expect(screen.getByText('Sunday')).toBeInTheDocument();
    });
  });
});
