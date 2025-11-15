/**
 * Calendar Event Group Component
 * Story 15.4: Client component for interactive expand/collapse of event groups
 *
 * This component handles state management for showing/hiding events
 * within a single event group (e.g., "Opening Today" or "Listing")
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CalendarEventGroup as EventGroup } from '@/lib/services/mainboard-calendar-types';
import { CalendarEventType } from '@/lib/services/mainboard-calendar-types';

// ==================== TYPES ====================

interface CalendarEventGroupProps {
  group: EventGroup;
  dateString: string;
  maxEvents: number;
  size: 'compact' | 'normal'; // compact for desktop grid, normal for mobile list
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
    case CalendarEventType.OPENING_TODAY:
      return { icon: '🟢', label: 'Opening', color: 'text-green-600' };
    case CalendarEventType.CLOSING_TODAY:
      return { icon: '🔴', label: 'Closing', color: 'text-red-600' };
    case CalendarEventType.OPEN_FOR_APPLICATION:
      return { icon: '📝', label: 'Open', color: 'text-blue-600' };
    case CalendarEventType.ALLOTMENT:
      return { icon: '🎯', label: 'Allotment', color: 'text-blue-600' };
    case CalendarEventType.BASIS_OF_ALLOTMENT:
      return { icon: '📊', label: 'Basis of Allotment', color: 'text-indigo-600' };
    case CalendarEventType.REFUND:
      return { icon: '💰', label: 'Refunds Initiated', color: 'text-purple-600' };
    case CalendarEventType.CREDIT_OF_SHARES:
      return { icon: '💳', label: 'Shares Credited', color: 'text-teal-600' };
    case CalendarEventType.LISTING:
      return { icon: '🎉', label: 'Listing', color: 'text-amber-600' };
    case CalendarEventType.HOLIDAY:
      return { icon: '🏖️', label: 'Holiday', color: 'text-gray-500' };
    default:
      return { icon: '📅', label: 'Event', color: 'text-gray-600' };
  }
}

// ==================== COMPONENT ====================

export default function CalendarEventGroup({
  group,
  dateString,
  maxEvents,
  size,
}: CalendarEventGroupProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const eventsToShow = isExpanded ? group.events : group.events.slice(0, maxEvents);
  const hasMore = group.events.length > maxEvents;

  // Compact mode (desktop grid cells)
  if (size === 'compact') {
    return (
      <div className="border-l-2 border-gray-300 pl-1.5">
        {/* Section header */}
        <div className="text-[10px] font-semibold text-gray-600 mb-0.5 uppercase tracking-wide">
          {group.label} ({group.events.length})
        </div>

        {/* Events in this group */}
        <div className="space-y-0.5">
          {eventsToShow.map((event) => {
            const display = getEventDisplay(event.type);

            // Holiday event (no link)
            if (event.type === CalendarEventType.HOLIDAY) {
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
                className={`text-xs ${display.color} hover:underline flex items-start gap-1 block`}
              >
                <span>{display.icon}</span>
                <span className="line-clamp-2">{event.companyName}</span>
              </Link>
            );
          })}

          {/* Show more/less button */}
          {hasMore && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-[10px] text-blue-600 hover:text-blue-800 font-medium mt-0.5"
            >
              {isExpanded
                ? '▲ Show less'
                : `▼ +${group.events.length - maxEvents} more`
              }
            </button>
          )}
        </div>
      </div>
    );
  }

  // Normal mode (mobile list view)
  return (
    <div className="border-l-3 border-gray-300 pl-3">
      {/* Section header */}
      <div className="text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">
        {group.label} ({group.events.length})
      </div>

      {/* Events in this group */}
      <div className="space-y-1.5">
        {eventsToShow.map((event) => {
          const display = getEventDisplay(event.type);

          // Holiday event (no link)
          if (event.type === CalendarEventType.HOLIDAY) {
            return (
              <div
                key={event.id}
                className={`text-sm ${display.color} flex items-center gap-2`}
              >
                <span>{display.icon}</span>
                <span>{event.holidayName}</span>
              </div>
            );
          }

          // IPO event (with link)
          return (
            <Link
              key={event.id}
              href={`/ipos/${event.slug}`}
              className={`text-sm ${display.color} hover:underline flex items-center gap-2`}
            >
              <span>{display.icon}</span>
              <span>{event.companyName}</span>
            </Link>
          );
        })}

        {/* Show more/less button */}
        {hasMore && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium mt-1"
          >
            {isExpanded
              ? '▲ Show less'
              : `▼ +${group.events.length - maxEvents} more`
            }
          </button>
        )}
      </div>
    </div>
  );
}
