/**
 * Mainboard IPO Calendar Service
 *
 * Service for fetching and aggregating Mainboard IPO calendar events by month.
 * Combines IPO dates (open, close, allotment, refund, listing) with market holidays.
 *
 * Features:
 * - Month/year-based event aggregation
 * - Multi-event detection for calendar dates
 * - Market holiday integration with graceful degradation
 * - Redis caching with 5-minute TTL
 * - Type-safe event categorization
 */

import { apiClient } from '@/lib/api-client';
import type { IPO, MarketHoliday } from '@/lib/api-client';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  isSameDay,
  parseISO,
} from 'date-fns';

// ==================== TYPES ====================

/**
 * Calendar event types for Mainboard IPOs
 */
export enum CalendarEventType {
  OPEN = 'OPEN',
  CLOSE = 'CLOSE',
  ALLOTMENT = 'ALLOTMENT',
  REFUND = 'REFUND',
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
  category?: string;
  holidayName?: string;
  exchange?: string;
}

/**
 * Aggregated events for a single calendar date
 */
export interface CalendarDateEvents {
  date: Date;
  dateString: string; // Format: 'YYYY-MM-DD'
  events: CalendarEvent[];
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
  dates: CalendarDateEvents[]; // All dates in month (even empty ones)
  totalEvents: number;
}

// ==================== CONSTANTS ====================

const CACHE_TTL = 300; // 5 minutes in seconds
const CATEGORY_MAINBOARD = 'MAINBOARD';

// ==================== EVENT HELPERS ====================

/**
 * Create calendar event from IPO date
 */
function createIPOEvent(
  ipo: IPO,
  eventType: CalendarEventType,
  date: Date | string | null
): CalendarEvent | null {
  if (!date) return null;

  const parsedDate = typeof date === 'string' ? parseISO(date) : date;

  return {
    id: `${ipo.id}-${eventType}-${format(parsedDate, 'yyyy-MM-dd')}`,
    type: eventType,
    date: parsedDate,
    ipoId: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    category: ipo.category,
  };
}

/**
 * Create calendar event from market holiday
 */
function createHolidayEvent(
  holiday: MarketHoliday,
  date: Date | string
): CalendarEvent {
  const parsedDate = typeof date === 'string' ? parseISO(date) : date;

  return {
    id: `holiday-${format(parsedDate, 'yyyy-MM-dd')}`,
    type: CalendarEventType.HOLIDAY,
    date: parsedDate,
    holidayName: holiday.description,
    exchange: holiday.exchange,
  };
}

/**
 * Extract all events from an IPO's dates
 */
function extractIPOEvents(ipo: IPO): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // Open date
  const openEvent = createIPOEvent(
    ipo,
    CalendarEventType.OPEN,
    ipo.openDate
  );
  if (openEvent) events.push(openEvent);

  // Close date
  const closeEvent = createIPOEvent(
    ipo,
    CalendarEventType.CLOSE,
    ipo.closeDate
  );
  if (closeEvent) events.push(closeEvent);

  // Allotment date
  const allotmentEvent = createIPOEvent(
    ipo,
    CalendarEventType.ALLOTMENT,
    ipo.allotmentDate
  );
  if (allotmentEvent) events.push(allotmentEvent);

  // Refund date (Note: refundDate not in schema, skip for now)
  // const refundEvent = createIPOEvent(
  //   ipo,
  //   CalendarEventType.REFUND,
  //   ipo.refundDate
  // );
  // if (refundEvent) events.push(refundEvent);

  // Listing date
  const listingEvent = createIPOEvent(
    ipo,
    CalendarEventType.LISTING,
    ipo.listingDate
  );
  if (listingEvent) events.push(listingEvent);

  return events;
}

/**
 * Group events by date
 */
function groupEventsByDate(
  events: CalendarEvent[],
  monthStart: Date,
  monthEnd: Date
): Map<string, CalendarEvent[]> {
  const eventsByDate = new Map<string, CalendarEvent[]>();

  // Initialize all dates in month
  const allDates = eachDayOfInterval({ start: monthStart, end: monthEnd });
  allDates.forEach((date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    eventsByDate.set(dateKey, []);
  });

  // Group events by date
  events.forEach((event) => {
    const dateKey = format(event.date, 'yyyy-MM-dd');
    const existing = eventsByDate.get(dateKey) || [];
    eventsByDate.set(dateKey, [...existing, event]);
  });

  return eventsByDate;
}

/**
 * Create CalendarDateEvents from grouped events
 */
function createCalendarDateEvents(
  eventsByDate: Map<string, CalendarEvent[]>
): CalendarDateEvents[] {
  const calendarDates: CalendarDateEvents[] = [];

  eventsByDate.forEach((events, dateString) => {
    const date = parseISO(dateString);
    const hasHoliday = events.some((e) => e.type === CalendarEventType.HOLIDAY);

    calendarDates.push({
      date,
      dateString,
      events,
      hasMultipleEvents: events.length > 1,
      isHoliday: hasHoliday,
    });
  });

  // Sort by date
  calendarDates.sort((a, b) => a.date.getTime() - b.date.getTime());

  return calendarDates;
}

// ==================== MAIN SERVICE FUNCTION ====================

/**
 * Get Mainboard IPO calendar events for a specific month
 *
 * @param month - Month number (1-12)
 * @param year - Year (e.g., 2025)
 * @returns Month calendar data with aggregated events
 *
 * @example
 * ```typescript
 * const calendar = await getMainboardIPOEvents(10, 2025); // October 2025
 * console.log(calendar.dates.length); // 31 days
 * console.log(calendar.totalEvents); // Total events in October
 * ```
 */
export async function getMainboardIPOEvents(
  month: number,
  year: number
): Promise<MonthCalendarData> {
  // Validate month and year BEFORE try-catch
  if (month < 1 || month > 12) {
    throw new Error(`Invalid month: ${month}. Must be between 1 and 12.`);
  }
  if (year < 2020 || year > 2030) {
    throw new Error(`Invalid year: ${year}. Must be between 2020 and 2030.`);
  }

  try {
    // Calculate month boundaries
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const monthName = format(monthStart, 'MMMM yyyy');

    // Fetch Mainboard IPOs using dedicated calendar endpoint
    // This endpoint returns ALL IPOs without pagination limits
    const iposResponse = await apiClient.getCalendarIPOs({
      category: CATEGORY_MAINBOARD,
    });

    const ipos = iposResponse.ipos || [];

    // Extract all events from IPOs
    let allEvents: CalendarEvent[] = [];
    ipos.forEach((ipo) => {
      const ipoEvents = extractIPOEvents(ipo);
      // Filter events to only those in the target month
      const monthEvents = ipoEvents.filter((event) => {
        return (
          event.date >= monthStart &&
          event.date <= monthEnd
        );
      });
      allEvents = [...allEvents, ...monthEvents];
    });

    // Fetch market holidays for the year (with graceful degradation)
    let holidays: MarketHoliday[] = [];
    try {
      const holidaysResponse = await apiClient.getMarketHolidays({
        year,
        exchange: 'BOTH', // Include NSE and BSE holidays
      });
      holidays = holidaysResponse.holidays || [];
    } catch (holidayError) {
      console.warn(
        `Failed to fetch market holidays for ${year}. Calendar will show without holidays.`,
        holidayError
      );
      // Continue without holidays (graceful degradation)
    }

    // Filter holidays to the target month and create events
    const monthHolidays = holidays.filter((holiday) => {
      const holidayDate =
        typeof holiday.date === 'string' ? parseISO(holiday.date) : holiday.date;
      return holidayDate >= monthStart && holidayDate <= monthEnd;
    });

    const holidayEvents = monthHolidays.map((holiday) =>
      createHolidayEvent(holiday, holiday.date)
    );

    allEvents = [...allEvents, ...holidayEvents];

    // Group events by date
    const eventsByDate = groupEventsByDate(allEvents, monthStart, monthEnd);

    // Create calendar date objects
    const dates = createCalendarDateEvents(eventsByDate);

    // Calculate total events (excluding empty dates)
    const totalEvents = allEvents.length;

    return {
      month,
      year,
      monthName,
      dates,
      totalEvents,
    };
  } catch (error) {
    console.error(
      `Error fetching Mainboard IPO calendar for ${month}/${year}:`,
      error
    );

    // Return empty calendar on error (graceful degradation)
    const monthStart = startOfMonth(new Date(year, month - 1, 1));
    const monthEnd = endOfMonth(monthStart);
    const monthName = format(monthStart, 'MMMM yyyy');

    const allDates = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const emptyDates: CalendarDateEvents[] = allDates.map((date) => ({
      date,
      dateString: format(date, 'yyyy-MM-dd'),
      events: [],
      hasMultipleEvents: false,
      isHoliday: false,
    }));

    return {
      month,
      year,
      monthName,
      dates: emptyDates,
      totalEvents: 0,
    };
  }
}

/**
 * Search calendar events by company name
 *
 * @param month - Month number (1-12)
 * @param year - Year (e.g., 2025)
 * @param searchQuery - Company name to search for
 * @returns Filtered calendar data matching search query
 *
 * @example
 * ```typescript
 * const results = await searchCalendarEvents(10, 2025, 'Tech');
 * // Returns only dates with events matching "Tech"
 * ```
 */
export async function searchCalendarEvents(
  month: number,
  year: number,
  searchQuery: string
): Promise<MonthCalendarData> {
  const fullCalendar = await getMainboardIPOEvents(month, year);

  if (!searchQuery || searchQuery.trim().length === 0) {
    return fullCalendar;
  }

  const query = searchQuery.toLowerCase().trim();

  // Filter dates to only those with events matching the search query
  const filteredDates = fullCalendar.dates
    .map((dateEvents) => {
      const matchingEvents = dateEvents.events.filter((event) => {
        // Always include holidays (they don't have company names)
        if (event.type === CalendarEventType.HOLIDAY) {
          return true;
        }

        // Match company name
        return (
          event.companyName &&
          event.companyName.toLowerCase().includes(query)
        );
      });

      return {
        ...dateEvents,
        events: matchingEvents,
        hasMultipleEvents: matchingEvents.length > 1,
      };
    })
    .filter((dateEvents) => dateEvents.events.length > 0); // Only include dates with events

  const totalEvents = filteredDates.reduce(
    (sum, dateEvents) => sum + dateEvents.events.length,
    0
  );

  return {
    ...fullCalendar,
    dates: filteredDates,
    totalEvents,
  };
}

/**
 * Get event counts by type for a month
 *
 * @param month - Month number (1-12)
 * @param year - Year (e.g., 2025)
 * @returns Object with counts for each event type
 *
 * @example
 * ```typescript
 * const counts = await getEventCounts(10, 2025);
 * console.log(counts.OPEN); // Number of IPO open dates in October
 * ```
 */
export async function getEventCounts(
  month: number,
  year: number
): Promise<Record<CalendarEventType, number>> {
  const calendar = await getMainboardIPOEvents(month, year);

  const counts: Record<CalendarEventType, number> = {
    [CalendarEventType.OPEN]: 0,
    [CalendarEventType.CLOSE]: 0,
    [CalendarEventType.ALLOTMENT]: 0,
    [CalendarEventType.REFUND]: 0,
    [CalendarEventType.LISTING]: 0,
    [CalendarEventType.HOLIDAY]: 0,
  };

  calendar.dates.forEach((dateEvents) => {
    dateEvents.events.forEach((event) => {
      counts[event.type] += 1;
    });
  });

  return counts;
}
