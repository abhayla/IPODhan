/**
 * CalendarEvent Component
 *
 * Displays a single calendar event (IPO event or holiday) in a calendar cell.
 * Reusable component for both SME and Mainboard calendars.
 *
 * Story 9.13: SME IPO Calendar Page
 */

import Link from 'next/link';
import type { CalendarEvent } from '@/lib/services/sme-calendar-service';

// ==================== TYPES ====================

export interface CalendarEventProps {
  event: CalendarEvent;
}

// ==================== COMPONENT ====================

/**
 * CalendarEvent component displays a single event in the calendar
 *
 * - IPO events (OPENS, CLOSES, ALLOTMENT, LISTS): Rendered as clickable links with icon
 * - Holiday events: Rendered as plain text with italic styling
 *
 * @param event - Calendar event data
 */
export function CalendarEvent({ event }: CalendarEventProps) {
  // Holiday events: Display as plain text (no link)
  if (event.eventType === 'HOLIDAY') {
    return (
      <div className="text-xs text-gray-600 italic py-0.5">
        {event.description}
      </div>
    );
  }

  // IPO events: Display as clickable link with icon
  return (
    <Link
      href={`/ipos/${event.slug}`}
      className="flex items-start gap-1 text-xs hover:bg-gray-100 p-1 rounded transition-colors"
    >
      <span className="text-sm shrink-0">📅</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-blue-600 hover:underline truncate">
          {event.ipo?.companyName}
        </div>
        <div className="text-gray-600 text-[10px]">
          {event.eventType === 'OPENS' && 'Opens'}
          {event.eventType === 'CLOSES' && 'Closes'}
          {event.eventType === 'ALLOTMENT' && 'Allotment'}
          {event.eventType === 'LISTS' && 'Lists'}
        </div>
      </div>
    </Link>
  );
}
