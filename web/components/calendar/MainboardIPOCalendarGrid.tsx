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
 * - Event count limiting to prevent excessive cell heights (Story 15.4)
 *
 * Responsive behavior: Uses CSS media queries to ensure only one view shows at a time
 */

import Link from 'next/link';
import { format, getDay } from 'date-fns';
import type { CalendarDateEvents, CalendarEventType } from '@/lib/services/mainboard-calendar-types';
import { CalendarEventType as EventType } from '@/lib/services/mainboard-calendar-types';
import CalendarEventGroup from './CalendarEventGroup';
import styles from './MainboardIPOCalendarGrid.module.css';

// ==================== CONSTANTS ====================

/**
 * Story 15.4: Event count limiting to prevent massive calendar cells
 * Max events to show per group before requiring "show more" click
 */
const MAX_EVENTS_PER_GROUP = 3;

// ==================== TYPES ====================

interface MainboardIPOCalendarGridProps {
  dates: CalendarDateEvents[];
  monthName: string;
  currentDate: string; // Format: 'yyyy-MM-dd' (from server to prevent hydration errors)
}

// ==================== EVENT STYLING ====================

/**
 * Get event icon and color based on event type
 * Story 4.12: Added extended timeline event types
 * Story 15.1: Added continuous application period event types
 */
function getEventDisplay(type: CalendarEventType): {
  icon: string;
  label: string;
  color: string;
} {
  switch (type) {
    case EventType.OPENING_TODAY:
      return { icon: '🟢', label: 'Opening', color: 'text-green-600' }; // Story 15.1
    case EventType.CLOSING_TODAY:
      return { icon: '🔴', label: 'Closing', color: 'text-red-600' }; // Story 15.1
    case EventType.OPEN_FOR_APPLICATION:
      return { icon: '📝', label: 'Open', color: 'text-blue-600' }; // Story 15.1
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
 * Story 15.1: Updated to render grouped events with section headers
 * Story 15.4: Uses CalendarEventGroup client component for expand/collapse
 */
function CalendarCell({
  dateEvents,
  currentDate,
}: {
  dateEvents: CalendarDateEvents;
  currentDate: string;
}) {
  const dayNumber = format(dateEvents.date, 'd');
  const isToday = currentDate === dateEvents.dateString;
  const hasEvents = dateEvents.eventGroups.length > 0;
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

      {/* Event groups - Story 15.4: Using client component */}
      {hasEvents && (
        <div className="space-y-2">
          {dateEvents.eventGroups.map((group) => (
            <CalendarEventGroup
              key={group.type}
              group={group}
              dateString={dateEvents.dateString}
              maxEvents={MAX_EVENTS_PER_GROUP}
              size="compact"
            />
          ))}
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
  currentDate,
}: MainboardIPOCalendarGridProps) {
  // Organize dates into weeks for grid layout
  const weeks: CalendarDateEvents[][] = [];
  let currentWeek: CalendarDateEvents[] = [];

  // Fill empty cells before first day of month
  const firstDayOfWeek = getDay(dates[0]?.date || new Date());
  for (let i = 0; i < firstDayOfWeek; i++) {
    // Push empty placeholder (we'll skip rendering these) - Story 15.1: Added eventGroups
    currentWeek.push({
      date: new Date(),
      dateString: '',
      events: [],
      eventGroups: [], // Story 15.1
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
      {/* Desktop Grid View (7 columns) - Only shown on lg screens (≥1024px) */}
      <div className={styles['calendar-desktop-grid']}>
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

                return (
                  <CalendarCell
                    key={dateEvents.dateString}
                    dateEvents={dateEvents}
                    currentDate={currentDate}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Mobile List View - Story 15.1: Updated with grouped sections - Hidden on lg screens (≥1024px) */}
      <div className={`${styles['calendar-mobile-list']} space-y-3`}>
        {dates
          .filter((dateEvents) => dateEvents.eventGroups.length > 0)
          .map((dateEvents) => {
            const dayLabel = format(dateEvents.date, 'EEE, MMM d');
            const isToday = currentDate === dateEvents.dateString;

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
                <div className={`font-semibold mb-3 ${isToday ? 'text-blue-600' : 'text-gray-700'}`}>
                  {dayLabel}
                </div>

                {/* Event groups - Story 15.4: Using client component */}
                <div className="space-y-3">
                  {dateEvents.eventGroups.map((group) => (
                    <CalendarEventGroup
                      key={group.type}
                      group={group}
                      dateString={dateEvents.dateString}
                      maxEvents={MAX_EVENTS_PER_GROUP}
                      size="normal"
                    />
                  ))}
                </div>
              </div>
            );
          })}

        {/* Empty state for mobile */}
        {dates.filter((d) => d.eventGroups.length > 0).length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p>No events scheduled for {monthName}</p>
          </div>
        )}
      </div>
    </>
  );
}
