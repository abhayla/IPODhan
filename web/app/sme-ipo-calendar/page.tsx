/**
 * SME IPO Calendar Page
 *
 * Interactive monthly calendar showing SME IPO events.
 * Features:
 * - Monthly calendar grid with SME IPO events (opens, closes, allotment, listing)
 * - Market holidays display
 * - Month navigation (Previous/Next)
 * - Company name search filter
 * - ISR with 5-minute revalidation
 * - SEO optimized with metadata and structured data
 * - Responsive: grid on desktop, list on mobile
 *
 * Story 9.13: SME IPO Calendar Page
 */

import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SMEIPOCalendarGrid } from '@/components/calendar/SMEIPOCalendarGrid';
import MonthNavigation from '@/components/calendar/MonthNavigation';
import EventSearch from '@/components/calendar/EventSearch';
import { getSMEIPOEvents, getMonthName } from '@/lib/services/sme-calendar-service';

// ==================== ISR CONFIGURATION ====================

/**
 * ISR: Revalidate page every 5 minutes
 * Balance between fresh data and performance
 */
export const revalidate = 300; // 5 minutes in seconds

// ==================== PAGE METADATA ====================

/**
 * SEO Metadata for SME IPO Calendar page
 */
export const metadata: Metadata = {
  title: `SME IPO Calendar ${new Date().getFullYear()} - Monthly Event Schedule | IPODhan`,
  description:
    'View SME IPO calendar with monthly grid showing opening dates, closing dates, allotment status, and listing dates. Plan your SME IPO applications with our interactive calendar.',
  keywords: [
    'sme ipo calendar',
    'ipo events',
    'ipo schedule',
    'sme ipo dates',
    'india ipo calendar',
    'ipo opening dates',
    'ipo closing dates',
    'sme ipo allotment',
    'sme ipo listing',
  ],
  openGraph: {
    title: `SME IPO Calendar ${new Date().getFullYear()} - Monthly Event Schedule`,
    description: 'View SME IPO calendar with monthly grid showing all important dates',
    type: 'website',
  },
};

// ==================== TYPES ====================

interface SMECalendarPageProps {
  searchParams: Promise<{
    month?: string;
    year?: string;
    search?: string;
  }>;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get current date or parse from search params
 */
function getCurrentMonthYear(searchParams: {
  month?: string;
  year?: string;
}): { month: number; year: number } {
  const today = new Date();

  // Parse month from URL or default to current month
  const month = searchParams.month
    ? parseInt(searchParams.month, 10)
    : today.getMonth() + 1;

  // Parse year from URL or default to current year
  const year = searchParams.year
    ? parseInt(searchParams.year, 10)
    : today.getFullYear();

  // Validate month (1-12)
  const validMonth = month >= 1 && month <= 12 ? month : today.getMonth() + 1;

  // Validate year (2020-2030)
  const validYear = year >= 2020 && year <= 2030 ? year : today.getFullYear();

  return { month: validMonth, year: validYear };
}

/**
 * Filter calendar days by search query
 */
function filterCalendarDaysBySearch(
  calendarDays: Awaited<ReturnType<typeof getSMEIPOEvents>>,
  searchQuery: string
) {
  if (!searchQuery) return calendarDays;

  const lowerSearchQuery = searchQuery.toLowerCase();

  return calendarDays.map((day) => ({
    ...day,
    events: day.events.filter((event) => {
      // Always show holidays
      if (event.eventType === 'HOLIDAY') return true;

      // Filter IPO events by company name
      return event.ipo?.companyName.toLowerCase().includes(lowerSearchQuery);
    }),
  }));
}

// ==================== MAIN PAGE COMPONENT ====================

/**
 * SME IPO Calendar Page Component
 *
 * Server component that fetches and displays SME IPO calendar data
 */
export default async function SMECalendarPage({
  searchParams,
}: SMECalendarPageProps) {
  // Await searchParams (Next.js 15 requirement)
  const params = await searchParams;

  // Parse current month/year from URL or use current date
  const { month, year } = getCurrentMonthYear(params);

  // Get search query from URL
  const searchQuery = params.search || '';

  // Fetch SME IPO calendar events (server-side with ISR)
  let calendarDays = await getSMEIPOEvents(month, year);

  // Apply search filter if query exists
  if (searchQuery) {
    calendarDays = filterCalendarDaysBySearch(calendarDays, searchQuery);
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-3 text-gray-900">
          SME IPO Calendar
        </h1>
        <p className="text-base md:text-lg text-gray-600 leading-relaxed">
          View SME IPO events including opening dates, closing dates, allotment
          status, and listing dates. Plan your SME IPO applications with our
          monthly event calendar.
        </p>
      </div>

      {/* Month Navigation */}
      <Suspense fallback={<div className="h-12 bg-gray-100 rounded animate-pulse" />}>
        <MonthNavigation currentMonth={month} currentYear={year} />
      </Suspense>

      {/* Event Search */}
      <div className="mb-6">
        <Suspense fallback={<div className="h-10 bg-gray-100 rounded animate-pulse" />}>
          <EventSearch initialSearch={searchQuery} />
        </Suspense>
      </div>

      {/* Calendar Grid */}
      <Suspense
        fallback={
          <div className="space-y-4">
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 42 }).map((_, i) => (
                <div key={i} className="h-24 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          </div>
        }
      >
        <SMEIPOCalendarGrid
          calendarDays={calendarDays}
          currentMonth={month}
          currentYear={year}
        />
      </Suspense>

      {/* SEO Structured Data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Event',
            name: `SME IPO Calendar - ${getMonthName(month)} ${year}`,
            description:
              'SME IPO events including opening dates, closing dates, allotment, and listing dates',
            startDate: new Date(year, month - 1, 1).toISOString(),
            endDate: new Date(year, month, 0).toISOString(),
            eventStatus: 'https://schema.org/EventScheduled',
            eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
            location: {
              '@type': 'VirtualLocation',
              url: `https://ipodhan.com/sme-ipo-calendar?month=${month}&year=${year}`,
            },
            subEvent: calendarDays
              .flatMap((day) =>
                day.events.filter((e) => e.eventType !== 'HOLIDAY')
              )
              .slice(0, 10)
              .map((event) => ({
                '@type': 'Event',
                name: event.description,
                startDate: event.date.toISOString(),
                url: `https://ipodhan.com/ipos/${event.slug}`,
              })),
          }),
        }}
      />
    </div>
  );
}
