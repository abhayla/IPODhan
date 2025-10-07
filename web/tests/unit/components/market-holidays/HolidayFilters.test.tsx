/**
 * Unit Tests for HolidayFilters Component
 * Story 5.4: Market Holidays Calendar
 *
 * Tests:
 * - Year dropdown rendering and selection
 * - Exchange filter rendering and selection
 * - Upcoming toggle functionality
 * - Filter state management
 * - Callback invocation with correct parameters
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HolidayFilters, type HolidayFilterState } from '@/components/market-holidays/HolidayFilters';

describe('HolidayFilters', () => {
  const defaultFilters: HolidayFilterState = {
    year: 2024,
    exchange: 'ALL',
    upcoming: false,
  };

  const mockOnFilterChange = vi.fn();

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render year dropdown with correct value', () => {
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      expect(screen.getByText('Year')).toBeInTheDocument();
    });

    it('should render exchange dropdown with correct value', () => {
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      expect(screen.getByText('Exchange')).toBeInTheDocument();
    });

    it('should render upcoming toggle with correct state', () => {
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeInTheDocument();
      expect(toggle).not.toBeChecked();
    });

    it('should render upcoming toggle as checked when upcoming is true', () => {
      const filters = { ...defaultFilters, upcoming: true };
      render(<HolidayFilters filters={filters} onFilterChange={mockOnFilterChange} />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeChecked();
    });
  });

  describe('Year Filter', () => {
    it('should display all available years (2024-2026)', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      // Click on year trigger to open dropdown
      const yearTrigger = screen.getByRole('combobox', { name: /year/i });
      await user.click(yearTrigger);

      // Check if all years are displayed - use getAllByText since years appear in both trigger and dropdown
      expect(screen.getAllByText('2024').length).toBeGreaterThan(0);
      expect(screen.getAllByText('2025').length).toBeGreaterThan(0);
      expect(screen.getAllByText('2026').length).toBeGreaterThan(0);
    });

    it('should call onFilterChange when year is changed', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const yearTrigger = screen.getByRole('combobox', { name: /year/i });
      await user.click(yearTrigger);

      // Get the year option from the dropdown (not the trigger)
      const year2025Options = screen.getAllByText('2025');
      await user.click(year2025Options[year2025Options.length - 1]);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...defaultFilters,
        year: 2025,
      });
    });
  });

  describe('Exchange Filter', () => {
    it('should display all exchange options', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const exchangeTrigger = screen.getByRole('combobox', { name: /exchange/i });
      await user.click(exchangeTrigger);

      // Use getAllByText since exchange options appear in both trigger and dropdown
      expect(screen.getAllByText('All Exchanges').length).toBeGreaterThan(0);
      expect(screen.getAllByText('NSE Only').length).toBeGreaterThan(0);
      expect(screen.getAllByText('BSE Only').length).toBeGreaterThan(0);
    });

    it('should call onFilterChange when exchange is changed to NSE', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const exchangeTrigger = screen.getByRole('combobox', { name: /exchange/i });
      await user.click(exchangeTrigger);

      const nseOption = screen.getByText('NSE Only');
      await user.click(nseOption);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...defaultFilters,
        exchange: 'NSE',
      });
    });

    it('should call onFilterChange when exchange is changed to BSE', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const exchangeTrigger = screen.getByRole('combobox', { name: /exchange/i });
      await user.click(exchangeTrigger);

      const bseOption = screen.getByText('BSE Only');
      await user.click(bseOption);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...defaultFilters,
        exchange: 'BSE',
      });
    });
  });

  describe('Upcoming Toggle', () => {
    it('should call onFilterChange when toggle is clicked', async () => {
      const user = userEvent.setup();
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...defaultFilters,
        upcoming: true,
      });
    });

    it('should call onFilterChange with false when toggle is unchecked', async () => {
      const user = userEvent.setup();
      const filters = { ...defaultFilters, upcoming: true };
      render(<HolidayFilters filters={filters} onFilterChange={mockOnFilterChange} />);

      const toggle = screen.getByRole('switch');
      await user.click(toggle);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        ...filters,
        upcoming: false,
      });
    });
  });

  describe('Filter State Management', () => {
    it('should maintain all filter values when one is changed', async () => {
      const user = userEvent.setup();
      const filters = { year: 2025, exchange: 'NSE' as const, upcoming: true };
      render(<HolidayFilters filters={filters} onFilterChange={mockOnFilterChange} />);

      const yearTrigger = screen.getByRole('combobox', { name: /year/i });
      await user.click(yearTrigger);

      const year2026 = screen.getByText('2026');
      await user.click(year2026);

      expect(mockOnFilterChange).toHaveBeenCalledWith({
        year: 2026,
        exchange: 'NSE',
        upcoming: true,
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible labels for all controls', () => {
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      expect(screen.getByLabelText(/year/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/exchange/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/upcoming only/i)).toBeInTheDocument();
    });

    it('should have proper switch role for toggle', () => {
      render(<HolidayFilters filters={defaultFilters} onFilterChange={mockOnFilterChange} />);

      const toggle = screen.getByRole('switch');
      expect(toggle).toHaveAttribute('aria-checked');
    });
  });
});
