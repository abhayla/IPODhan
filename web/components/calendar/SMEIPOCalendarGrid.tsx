/**
 * SME IPO Calendar Grid Component
 *
 * Monthly calendar grid displaying SME IPO events.
 * Features:
 * - 7×6 grid (42 days) with days of week header
 * - Multiple events per day support
 * - Color coding (yellow for 2+ events)
 * - Responsive: desktop (grid) and mobile (list)
 * - Empty state and loading skeleton
 *
 * Story 9.13: SME IPO Calendar Page
 */

import { cn } from '@/lib/utils';
import { CalendarEvent } from './CalendarEvent';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CalendarDay } from '@/lib/services/sme-calendar-service';
import { getMonthName } from '@/lib/services/sme-calendar-service';

// ==================== TYPES ====================

export interface SMEIPOCalendarGridProps {
  calendarDays: CalendarDay[];
  currentMonth: number;
  currentYear: number;
  loading?: boolean;
}

// ==================== CONSTANTS ====================

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ==================== HELPER FUNCTIONS ====================

/**
 * Format date for mobile list view (e.g., "Mon, Jan 15")
 */
function formatDateForMobile(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// ==================== MAIN COMPONENT ====================

/**
 * SME IPO Calendar Grid Component
 *
 * Displays monthly calendar with SME IPO events and holidays.
 * Desktop: 7-column calendar grid | Mobile: Vertical list of days with events
 */
export function SMEIPOCalendarGrid({
  calendarDays,
  currentMonth,
  currentYear,
  loading = false,
}: SMEIPOCalendarGridProps) {
  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4">
        {/* Desktop Loading Skeleton */}
        <div className="hidden md:block">
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 42 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>

        {/* Mobile Loading Skeleton */}
        <div className="md:hidden space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Empty state: No events in current month
  const hasAnyEvents = calendarDays.some((day) => day.events.length > 0);
  if (!hasAnyEvents && !loading) {
    return (
      <div className="text-center py-16 text-muted-foreground bg-gray-50 rounded-lg border-2 border-dashed">
        <div className="text-4xl mb-4">📅</div>
        <p className="text-lg font-medium mb-2">
          No SME IPO events in {getMonthName(currentMonth)} {currentYear}
        </p>
        <p className="text-sm">
          Check other months for upcoming SME IPO events
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* DESKTOP: Calendar Grid View */}
      <div className="hidden md:block">
        {/* Days of Week Header */}
        <div className="grid grid-cols-7 bg-green-600 text-white rounded-t-lg overflow-hidden">
          {DAYS_OF_WEEK.map((day) => (
            <div
              key={day}
              className="p-3 text-center font-semibold text-sm"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Days Grid */}
        <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200 rounded-b-lg overflow-hidden">
          {calendarDays.map((day, index) => (
            <div
              key={index}
              className={cn(
                'min-h-28 p-2 bg-white',
                // Gray out days not in current month
                !day.isCurrentMonth && 'bg-gray-50 text-gray-400',
                // Highlight today's date
                day.isToday && 'ring-2 ring-blue-500 ring-inset',
                // Weekend styling
                day.isWeekend && day.isCurrentMonth && 'bg-gray-50',
                // Highlight days with 2+ events (yellow background)
                day.events.length >= 2 && day.isCurrentMonth && 'bg-yellow-50'
              )}
            >
              {/* Day Number */}
              <div
                className={cn(
                  'text-sm font-semibold mb-1',
                  day.isToday && 'text-blue-600',
                  !day.isCurrentMonth && 'text-gray-400'
                )}
              >
                {day.date.getDate()}
              </div>

              {/* Events List */}
              <div className="space-y-1 overflow-y-auto max-h-20">
                {day.events.map((event, eventIndex) => (
                  <CalendarEvent key={eventIndex} event={event} />
                ))}
              </div>

              {/* Event count indicator for days with many events */}
              {day.events.length > 3 && (
                <div className="text-[10px] text-gray-500 text-center mt-1">
                  +{day.events.length - 3} more
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* MOBILE: List View */}
      <div className="md:hidden space-y-3">
        {calendarDays
          .filter((day) => day.events.length > 0 && day.isCurrentMonth)
          .map((day, index) => (
            <Card key={index}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>{formatDateForMobile(day.date)}</span>
                  {day.isToday && (
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
                      Today
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {day.events.map((event, eventIndex) => (
                  <CalendarEvent key={eventIndex} event={event} />
                ))}
              </CardContent>
            </Card>
          ))}

        {/* Empty state for mobile: No events in visible days */}
        {calendarDays.filter((day) => day.events.length > 0 && day.isCurrentMonth)
          .length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No SME IPO events in this month</p>
          </div>
        )}
      </div>
    </div>
  );
}
