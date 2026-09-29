/**
 * CalendarEvent Component
 *
 * Displays a single calendar event (IPO event or holiday) in a calendar cell.
 * Reusable component for both SME and Mainboard calendars.
 *
 * Story 9.13: SME IPO Calendar Page
 *
 * 'use client' (§9.2 item 14, OD-110): the admin-only Edit link needs the browser's own
 * client-side admin check. The check itself (`useAdminSession`) is called ONCE by the
 * calendar grid that renders this component in a loop, and `isAdmin` is passed down as a
 * prop — calling the hook here would fire one `/api/admin/auth/me` request per rendered
 * event instead of one per page load (Tier B review, PR #1286).
 */
'use client';

import Link from 'next/link';
import type { CalendarEvent } from '@/lib/services/sme-calendar-service';
import { AdminRowEditLink } from '@/components/admin/AdminRowEditLink';

// ==================== TYPES ====================

export interface CalendarEventProps {
  event: CalendarEvent;
  isAdmin: boolean;
}

// ==================== COMPONENT ====================

/**
 * CalendarEvent component displays a single event in the calendar
 * Story 4.12: Added extended timeline event types
 * Standardized to singular forms: OPEN, CLOSE, LISTING, REFUND (consistent with Mainboard)
 *
 * - IPO events (OPEN, CLOSE, ALLOTMENT, BASIS_OF_ALLOTMENT, REFUND, CREDIT_OF_SHARES, LISTING): Rendered as clickable links with icon
 * - Holiday events: Rendered as plain text with italic styling
 *
 * @param event - Calendar event data
 */
export function CalendarEvent({ event, isAdmin }: CalendarEventProps) {
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
    <div className="flex items-start gap-1">
      <Link
        href={`/ipos/${event.slug}`}
        className="flex min-w-0 flex-1 items-start gap-1 text-xs hover:bg-gray-100 p-1 rounded transition-colors"
      >
        <span className="text-sm shrink-0">📅</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium text-blue-600 hover:underline truncate">
            {event.ipo?.companyName}
          </div>
          <div className="text-gray-600 text-[10px]">
            {event.eventType === 'OPEN' && 'Opens'}
            {event.eventType === 'CLOSE' && 'Closes'}
            {event.eventType === 'ALLOTMENT' && 'Allotment'}
            {event.eventType === 'BASIS_OF_ALLOTMENT' && 'Basis of Allotment'} {/* Story 4.12 */}
            {event.eventType === 'REFUND' && 'Refunds Initiated'} {/* Story 4.12 */}
            {event.eventType === 'CREDIT_OF_SHARES' && 'Shares Credited'} {/* Story 4.12 */}
            {event.eventType === 'LISTING' && 'Lists'}
          </div>
        </div>
      </Link>
      {event.slug && (
        <AdminRowEditLink slug={event.slug} isAdmin={isAdmin} className="mt-1 inline-flex shrink-0 items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100" />
      )}
    </div>
  );
}
