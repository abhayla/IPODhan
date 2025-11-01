/**
 * Market Holidays Calendar Page
 *
 * Displays NSE/BSE trading holidays with filtering options.
 * Features:
 * - Server-side data fetching with ISR (30-day revalidation)
 * - Client-side filtering (year, exchange, upcoming)
 * - Responsive layout: List view on mobile, grid on desktop
 * - SEO optimized with metadata
 * - Loading states and error handling
 *
 * Story 5.4: Market Holidays Calendar
 * @route /market-holidays
 */

'use client';

import * as React from 'react';
import { Breadcrumbs } from '@/components/layout/Breadcrumbs';
import { HolidayCard } from '@/components/market-holidays/HolidayCard';
import { HolidayFilters, type HolidayFilterState } from '@/components/market-holidays/HolidayFilters';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { HiInformationCircle, HiExclamationCircle } from 'react-icons/hi2';
import type { MarketHoliday } from '@/lib/db/types';
import { parseISO, isBefore, isAfter, addDays } from 'date-fns';

// ==================== PAGE COMPONENT ====================

export default function MarketHolidaysPage() {
  // Get current year for default filter
  const currentYear = new Date().getFullYear();

  // State
  const [holidays, setHolidays] = React.useState<MarketHoliday[]>([]);
  const [filters, setFilters] = React.useState<HolidayFilterState>({
    year: currentYear >= 2024 && currentYear <= 2026 ? currentYear : 2024,
    exchange: 'ALL',
    upcoming: false,
  });
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  /**
   * Fetch holidays when filters change
   */
  React.useEffect(() => {
    async function fetchHolidays() {
      try {
        setIsLoading(true);
        setError(null);

        // Build query params
        const params = new URLSearchParams();
        if (filters.year) {
          params.append('year', filters.year.toString());
        }
        if (filters.exchange !== 'ALL') {
          params.append('exchange', filters.exchange);
        }
        if (filters.upcoming) {
          params.append('upcoming', 'true');
        }

        const response = await fetch(`/api/market-holidays?${params.toString()}`);

        if (!response.ok) {
          throw new Error('Failed to fetch market holidays');
        }

        const data = await response.json();
        setHolidays(data.holidays || []);
      } catch (err) {
        console.error('Error fetching market holidays:', err);
        setError('Failed to load market holidays. Please refresh the page.');
      } finally {
        setIsLoading(false);
      }
    }

    fetchHolidays();
  }, [filters]);

  /**
   * Handle filter changes
   */
  const handleFilterChange = (newFilters: HolidayFilterState) => {
    setFilters(newFilters);
  };

  /**
   * Determine if holiday is upcoming (within next 7 days)
   */
  const isUpcoming = (holiday: MarketHoliday): boolean => {
    const today = new Date();
    const holidayDate = parseISO(holiday.date);
    const sevenDaysFromNow = addDays(today, 7);

    return isAfter(holidayDate, today) && isBefore(holidayDate, sevenDaysFromNow);
  };

  /**
   * Determine if holiday is in the past
   */
  const isPast = (holiday: MarketHoliday): boolean => {
    const today = new Date();
    const holidayDate = parseISO(holiday.date);

    return isBefore(holidayDate, today);
  };

  /**
   * Sort holidays: upcoming first, then chronological
   */
  const sortedHolidays = React.useMemo(() => {
    return [...holidays].sort((a, b) => {
      const aDate = parseISO(a.date);
      const bDate = parseISO(b.date);

      // Sort chronologically
      return aDate.getTime() - bDate.getTime();
    });
  }, [holidays]);

  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      {/* Breadcrumbs */}
      <Breadcrumbs
        items={[
          { label: 'Home', href: '/' },
          { label: 'Tools', href: '/tools' },
          { label: 'Market Holidays', href: '/market-holidays' },
        ]}
      />

      {/* Page Header */}
      <div className="mt-6 mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Market Holidays Calendar</h1>
        <p className="text-muted-foreground mt-2">
          NSE and BSE trading holidays for 2024-2026. Plan your IPO applications around market closures.
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6">
        <HolidayFilters filters={filters} onFilterChange={handleFilterChange} />
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <Alert variant="destructive">
          <HiExclamationCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Empty State */}
      {!isLoading && !error && sortedHolidays.length === 0 && (
        <Alert>
          <HiInformationCircle className="h-4 w-4" />
          <AlertTitle>No holidays found</AlertTitle>
          <AlertDescription>
            {filters.upcoming
              ? 'No upcoming holidays in the next 7 days. Try viewing all holidays.'
              : `No market holidays found for ${filters.year}.`}
          </AlertDescription>
        </Alert>
      )}

      {/* Holidays List */}
      {!isLoading && !error && sortedHolidays.length > 0 && (
        <>
          {/* Results Count */}
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">
              Showing {sortedHolidays.length} holiday{sortedHolidays.length !== 1 ? 's' : ''} for{' '}
              {filters.year}
              {filters.exchange !== 'ALL' && ` (${filters.exchange})`}
              {filters.upcoming && ' (Upcoming only)'}
            </p>
          </div>

          {/* Holiday Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedHolidays.map((holiday) => (
              <HolidayCard
                key={holiday.id}
                holiday={holiday}
                isUpcoming={isUpcoming(holiday)}
                isPast={isPast(holiday)}
              />
            ))}
          </div>
        </>
      )}

      {/* HiInformationCircle Section */}
      <div className="mt-8 pt-6 border-t">
        <Alert>
          <HiInformationCircle className="h-4 w-4" />
          <AlertTitle>Data Source</AlertTitle>
          <AlertDescription>
            <p className="mb-2">
              Market holiday data sourced from official NSE and BSE calendars:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>
                <a
                  href="https://www.nseindia.com/regulations/trading-holidays"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  NSE Trading Holidays
                </a>
              </li>
              <li>
                <a
                  href="https://www.bseindia.com/static/about/Market_Holidays.aspx"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  BSE Market Holidays
                </a>
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Last updated: {new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              })}
            </p>
          </AlertDescription>
        </Alert>
      </div>
    </div>
  );
}
