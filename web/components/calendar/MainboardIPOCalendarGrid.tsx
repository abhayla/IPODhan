/**
 * Mainboard IPO Calendar Grid Component
 *
 * Server component that displays monthly calendar with IPO events.
 * Features:
 * - 7-column grid layout for desktop (Sun-Sat)
 * - List view for mobile devices
 * - Event highlighting with type-based icons
 * - Multi-event detection (yellow background)
 * - Click-through links to IPO detail pages
 */

import Link from 'next/link';
import { format, getDay } from 'date-fns';
import type { CalendarDateEvents, CalendarEventType } from '@/lib/services/mainboard-calendar-service';
import { CalendarEventType as EventType } from '@/lib/services/mainboard-calendar-service';

// ==================== TYPES ====================

interface MainboardIPOCalendarGridProps {
  dates: CalendarDateEvents[];
  monthName: string;
}

// ==================== EVENT STYLING ====================

/**
 * Get event icon and color based on event type
 * Story 4.12: Added extended timeline event types
 */
function getEventDisplay(type: CalendarEventType): {
  icon: string;
  label: string;
  color: string;
} {
  switch (type) {
    case EventType.OPEN:
      return { icon: '📝', label: 'Open', color: 'text-green-600' };
    case EventType.CLOSE:
      return { icon: '🔒', label: 'Close', color: 'text-red-600' };
    case EventType.ALLOTMENT:
      return { icon: '🎯', label: 'Allotment', color: 'text-blue-600' };
    case EventType.BASIS_OF_ALLOTMENT:
      return { icon: '📊', label: 'Basis of Allotment', color: 'text-indigo-600' }; // Story 4.12
    case EventType.REFUND:
      return { icon: '💰', label: 'Refunds Initiated', color: 'text-purple-600' }; // Story 4.12
    case EventType.CREDIT_OF_SHARES:
      return { icon: '💳', label: 'Shares Credited', color: 'text-teal-600' }; // Story 4.12
    case EventType.LISTING:
      return { icon: '🎉', label: 'Listing', color: 'text-amber-600' };
    case EventType.HOLIDAY:
      return { icon: '🏖️', label: 'Holiday', color: 'text-gray-500' };
    default:
      return { icon: '📅', label: 'Event', color: 'text-gray-600' };
  }
}

// ==================== CALENDAR CELL COMPONENT ====================

/**
 * Single calendar cell (date) with events
 */
function CalendarCell({ dateEvents }: { dateEvents: CalendarDateEvents }) {
  const dayNumber = format(dateEvents.date, 'd');
  const isToday = format(new Date(), 'yyyy-MM-dd') === dateEvents.dateString;
  const hasEvents = dateEvents.events.length > 0;
  const hasMultiple = dateEvents.hasMultipleEvents;

  return (
    <div
      className={`
        min-h-[100px] border border-gray-200 p-2 rounded-lg
        ${isToday ? 'bg-blue-50 border-blue-300' : 'bg-white'}
        ${hasMultiple ? 'bg-yellow-50' : ''}
        ${dateEvents.isHoliday && !hasMultiple ? 'bg-gray-50' : ''}
      `}
    >
      {/* Day number */}
      <div
        className={`text-sm font-semibold mb-2 ${
          isToday ? 'text-blue-600' : 'text-gray-700'
        }`}
      >
        {dayNumber}
      </div>

      {/* Events list */}
      {hasEvents && (
        <div className="space-y-1">
          {dateEvents.events.map((event) => {
            const display = getEventDisplay(event.type);

            // Holiday event (no link)
            if (event.type === EventType.HOLIDAY) {
              return (
                <div
                  key={event.id}
                  className={`text-xs ${display.color} flex items-start gap-1`}
                >
                  <span>{display.icon}</span>
                  <span className="line-clamp-2">{event.holidayName}</span>
                </div>
              );
            }

            // IPO event (with link)
            return (
              <Link
                key={event.id}
                href={`/ipos/${event.slug}`}
                className={`
                  text-xs ${display.color} hover:underline flex items-start gap-1
                  block
                `}
              >
                <span>{display.icon}</span>
                <span className="line-clamp-2">
                  {event.companyName} - {display.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

/**
 * Mainboard IPO Calendar Grid
 *
 * Displays calendar in:
 * - Desktop: 7-column grid (Sun-Sat)
 * - Mobile: List view with dates
 */
export default function MainboardIPOCalendarGrid({
  dates,
  monthName,
}: MainboardIPOCalendarGridProps) {
  // Organize dates into weeks for grid layout
  const weeks: CalendarDateEvents[][] = [];
  let currentWeek: CalendarDateEvents[] = [];

  // Fill empty cells before first day of month
  const firstDayOfWeek = getDay(dates[0]?.date || new Date());
  for (let i = 0; i < firstDayOfWeek; i++) {
    // Push empty placeholder (we'll skip rendering these)
    currentWeek.push({
      date: new Date(),
      dateString: '',
      events: [],
      hasMultipleEvents: false,
      isHoliday: false,
    });
  }

  // Add all dates to weeks
  dates.forEach((dateEvents, index) => {
    currentWeek.push(dateEvents);

    // Start new week on Saturday (day 6) or at end of month
    const dayOfWeek = getDay(dateEvents.date);
    if (dayOfWeek === 6 || index === dates.length - 1) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
  });

  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <>
      {/* Desktop Grid View (7 columns) */}
      <div className="hidden md:block">
        {/* Calendar header */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-center font-semibold text-gray-700 py-2 bg-gray-100 rounded-lg"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="space-y-2">
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className="grid grid-cols-7 gap-2">
              {week.map((dateEvents, dayIndex) => {
                // Render empty cell for placeholders
                if (!dateEvents.dateString) {
                  return <div key={`empty-${dayIndex}`} className="min-h-[100px]" />;
                }

                return <CalendarCell key={dateEvents.dateString} dateEvents={dateEvents} />;
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile List View */}
      <div className="md:hidden space-y-3">
        {dates
          .filter((dateEvents) => dateEvents.events.length > 0)
          .map((dateEvents) => {
            const dayLabel = format(dateEvents.date, 'EEE, MMM d');
            const isToday = format(new Date(), 'yyyy-MM-dd') === dateEvents.dateString;

            return (
              <div
                key={dateEvents.dateString}
                className={`
                  border rounded-lg p-4
                  ${isToday ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200'}
                  ${dateEvents.hasMultipleEvents ? 'bg-yellow-50' : ''}
                  ${dateEvents.isHoliday && !dateEvents.hasMultipleEvents ? 'bg-gray-50' : ''}
                `}
              >
                {/* Date header */}
                <div className={`font-semibold mb-2 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                  {dayLabel}
                </div>

                {/* Events */}
                <div className="space-y-2">
                  {dateEvents.events.map((event) => {
                    const display = getEventDisplay(event.type);

                    if (event.type === EventType.HOLIDAY) {
                      return (
                        <div key={event.id} className={`text-sm ${display.color} flex items-center gap-2`}>
                          <span>{display.icon}</span>
                          <span>{event.holidayName}</span>
                        </div>
                      );
                    }

                    return (
                      <Link
                        key={event.id}
                        href={`/ipos/${event.slug}`}
                        className={`text-sm ${display.color} hover:underline flex items-center gap-2`}
                      >
                        <span>{display.icon}</span>
                        <span>
                          {event.companyName} - {display.label}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {/* Empty state for mobile */}
        {dates.filter((d) => d.events.length > 0).length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>No events scheduled for {monthName}</p>
          </div>
        )}
      </div>
    </>
  );
}
