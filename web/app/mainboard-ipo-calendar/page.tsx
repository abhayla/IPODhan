/**
 * Mainboard IPO Calendar Page
 *
 * Server component displaying monthly calendar of Mainboard IPO events.
 * Features:
 * - Month/year navigation with URL state
 * - Event search by company name
 * - 7-column grid (desktop) / list view (mobile)
 * - ISR with 5-minute revalidation
 * - SEO optimized with metadata
 */

import { Metadata } from 'next';
import { getMainboardIPOEvents, searchCalendarEvents } from '@/lib/services/mainboard-calendar-service';
import MainboardIPOCalendarGrid from '@/components/calendar/MainboardIPOCalendarGrid';
import MonthNavigation from '@/components/calendar/MonthNavigation';
import EventSearch from '@/components/calendar/EventSearch';

// ==================== ISR CONFIGURATION ====================

export const revalidate = 300; // 5 minutes

// ==================== SEO METADATA ====================

export const metadata: Metadata = {
  title: 'Mainboard IPO Calendar 2025 - Event Schedule & Important Dates | IPODhan',
  description:
    'View the complete Mainboard IPO calendar with all important dates - open, close, allotment, refund, and listing dates. Plan your IPO investments with our comprehensive event schedule.',
  keywords:
    'mainboard ipo calendar, ipo schedule, ipo dates, ipo timeline, ipo events, listing dates, allotment dates, India',
  openGraph: {
    title: 'Mainboard IPO Calendar 2025 - Event Schedule & Important Dates',
    description:
      'Complete Mainboard IPO calendar with open, close, allotment, refund, and listing dates',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Mainboard IPO Calendar 2025',
    description: 'View all Mainboard IPO events and important dates in one calendar',
  },
};

// ==================== PAGE COMPONENT ====================

interface PageProps {
  searchParams: Promise<{
    month?: string;
    year?: string;
    search?: string;
  }>;
}

export default async function MainboardIPOCalendarPage({ searchParams }: PageProps) {
  // Await searchParams
  const params = await searchParams;

  // Parse month/year from URL or default to current month
  const now = new Date();
  const currentMonth = parseInt(params.month || String(now.getMonth() + 1), 10);
  const currentYear = parseInt(params.year || String(now.getFullYear()), 10);
  const searchQuery = params.search || '';

  // Validate month/year
  const month = currentMonth >= 1 && currentMonth <= 12 ? currentMonth : now.getMonth() + 1;
  const year =
    currentYear >= 2020 && currentYear <= now.getFullYear() + 2
      ? currentYear
      : now.getFullYear();

  // Fetch calendar data
  let calendarData;
  try {
    if (searchQuery.trim()) {
      calendarData = await searchCalendarEvents(month, year, searchQuery);
    } else {
      calendarData = await getMainboardIPOEvents(month, year);
    }
  } catch (error) {
    console.error('Error loading calendar:', error);
    // Fallback to empty calendar
    calendarData = {
      month,
      year,
      monthName: new Date(year, month - 1).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
      }),
      dates: [],
      totalEvents: 0,
    };
  }

  const hasEvents = calendarData.totalEvents > 0;

  return (
    <main className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="space-y-2 mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Mainboard IPO Calendar</h1>
        <p className="text-gray-600">
          View all important dates for Mainboard IPOs - open, close, allotment, refund, and
          listing dates.
        </p>
      </div>

      {/* Event Legend */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm font-semibold text-gray-700 mb-2">Event Types:</p>
        <div className="flex flex-wrap gap-4 text-sm">
          <span>📝 Open</span>
          <span>🔒 Close</span>
          <span>🎯 Allotment</span>
          <span>💰 Refund</span>
          <span>🎉 Listing</span>
          <span>🏖️ Holiday</span>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <EventSearch initialSearch={searchQuery} />
      </div>

      {/* Month Navigation */}
      <MonthNavigation currentMonth={month} currentYear={year} />

      {/* Calendar Grid */}
      {hasEvents ? (
        <div className="mt-6">
          <MainboardIPOCalendarGrid dates={calendarData.dates} monthName={calendarData.monthName} />
        </div>
      ) : (
        <div className="text-center py-12 text-gray-500">
          <p className="text-lg">No Mainboard IPO events found for {calendarData.monthName}</p>
          {searchQuery && (
            <p className="text-sm mt-2">
              Try adjusting your search or browsing a different month
            </p>
          )}
        </div>
      )}

      {/* Event Count */}
      {hasEvents && (
        <div className="mt-6 text-center text-sm text-gray-600">
          <p>
            {calendarData.totalEvents} event{calendarData.totalEvents !== 1 ? 's' : ''} in{' '}
            {calendarData.monthName}
          </p>
        </div>
      )}
    </main>
  );
}
