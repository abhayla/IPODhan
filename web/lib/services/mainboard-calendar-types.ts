/**
 * Mainboard IPO Calendar Types
 *
 * Shared types and enums for calendar functionality.
 * Extracted to avoid bundling server dependencies in client components.
 */

// ==================== TYPES ====================

/**
 * Calendar event types for Mainboard IPOs
 * Story 4.12: Added extended timeline events
 * Story 15.1: Added continuous application period events
 */
export enum CalendarEventType {
  OPENING_TODAY = 'OPENING_TODAY', // Story 15.1: IPO opening on this specific date
  CLOSING_TODAY = 'CLOSING_TODAY', // Story 15.1: IPO closing on this specific date
  OPEN_FOR_APPLICATION = 'OPEN_FOR_APPLICATION', // Story 15.1: IPO accepting applications (between open and close)
  ALLOTMENT = 'ALLOTMENT',
  BASIS_OF_ALLOTMENT = 'BASIS_OF_ALLOTMENT', // Story 4.12
  REFUND = 'REFUND', // Story 4.12: Initiation of Refunds
  CREDIT_OF_SHARES = 'CREDIT_OF_SHARES', // Story 4.12
  LISTING = 'LISTING',
  HOLIDAY = 'HOLIDAY',
}

/**
 * Individual calendar event with IPO details
 */
export interface CalendarEvent {
  id: string;
  type: CalendarEventType;
  date: Date;
  ipoId?: string;
  companyName?: string;
  slug?: string;
  segment?: string | null;
  offeringType?: string;
  closeDate?: Date; // For sorting OPEN_FOR_APPLICATION events by urgency
  holidayName?: string;
  exchange?: string;
}

/**
 * Event group for organizing events by type (Story 15.1)
 */
export interface CalendarEventGroup {
  type: CalendarEventType;
  priority: number; // For sorting sections (lower = higher priority)
  label: string; // Display label (e.g., "Closing Today")
  events: CalendarEvent[];
}

/**
 * Aggregated events for a single calendar date
 * Story 15.1: Added eventGroups for organized display
 */
export interface CalendarDateEvents {
  date: Date;
  dateString: string; // Format: 'YYYY-MM-DD'
  events: CalendarEvent[]; // Kept for backward compatibility
  eventGroups: CalendarEventGroup[]; // Story 15.1: Grouped and sorted events
  hasMultipleEvents: boolean; // True if >1 event on this date
  isHoliday: boolean;
}

/**
 * Full calendar data for a month
 */
export interface MonthCalendarData {
  month: number; // 1-12
  year: number;
  monthName: string; // "October 2025"
  dates: CalendarDateEvents[];
  totalEvents: number;
}
