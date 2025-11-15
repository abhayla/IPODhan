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
 *
 * ⚠️ ARCHITECTURAL NOTE: Services should use repositories directly,
 * not HTTP API calls. This follows the 3-layer architecture:
 * Service → Repository (not Service → HTTP → API → Repository)
 */

import { db } from '@/lib/db/index';
import { getRedisClient } from '@/lib/cache/redis-client';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { MarketHolidayRepository } from '@/lib/repositories/market-holiday-repository';
import type { IPO, MarketHoliday } from '@/lib/db/types';
import {
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  isSameDay,
  parseISO,
  max,
  min,
} from 'date-fns';

// ==================== TYPES ====================

// Import types for use within this file
import { CalendarEventType } from './mainboard-calendar-types';
import type {
  CalendarEvent,
  CalendarEventGroup,
  CalendarDateEvents,
  MonthCalendarData,
} from './mainboard-calendar-types';

// Re-export types from separate file to avoid bundling server dependencies in client components
export {
  CalendarEventType,
  type CalendarEvent,
  type CalendarEventGroup,
  type CalendarDateEvents,
  type MonthCalendarData,
} from './mainboard-calendar-types';

// Type alias for backward compatibility
export type EventGroup = CalendarEventGroup;

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
  date: Date | string | null,
  closeDate?: string | null
): CalendarEvent | null {
  if (!date) return null;

  const parsedDate = typeof date === 'string' ? parseISO(date) : date;
  const parsedCloseDate = closeDate ? parseISO(closeDate) : undefined;

  return {
    id: `${ipo.id}-${eventType}-${format(parsedDate, 'yyyy-MM-dd')}`,
    type: eventType,
    date: parsedDate,
    ipoId: ipo.id,
    companyName: ipo.companyName,
    slug: ipo.slug,
    segment: ipo.segment,
    offeringType: ipo.offeringType,
    closeDate: parsedCloseDate, // Include close date for sorting
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
 * Story 4.12: Added extended timeline dates from ipoDetails
 * Story 15.1: Added continuous application period events
 *
 * @param ipo - IPO data with optional ipoDetails
 * @param monthStart - Start of the month for filtering continuous events
 * @param monthEnd - End of the month for filtering continuous events
 * @returns Array of calendar events including continuous application period events
 */
function extractIPOEvents(
  ipo: IPO & { ipoDetails?: { basisOfAllotmentDate?: string | null; initiationOfRefundsDate?: string | null; creditOfSharesDate?: string | null } | null },
  monthStart: Date,
  monthEnd: Date
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  // Story 15.1: CONTINUOUS EVENTS - Application Period (openDate to closeDate)
  // IPO appears every day from opening to closing
  if (ipo.openDate && ipo.closeDate) {
    const openDate = parseISO(ipo.openDate);
    const closeDate = parseISO(ipo.closeDate);

    // Generate events for EVERY day in the application period (within the month)
    const periodStart = max([openDate, monthStart]);
    const periodEnd = min([closeDate, monthEnd]);

    // Only proceed if the period overlaps with the month
    if (periodStart <= periodEnd) {
      const daysInPeriod = eachDayOfInterval({
        start: periodStart,
        end: periodEnd,
      });

      daysInPeriod.forEach((date) => {
        let eventType: CalendarEventType;

        if (isSameDay(date, openDate)) {
          // Opening day - special event type
          eventType = CalendarEventType.OPENING_TODAY;
        } else if (isSameDay(date, closeDate)) {
          // Closing day - special event type
          eventType = CalendarEventType.CLOSING_TODAY;
        } else {
          // Days in between - ongoing application period
          eventType = CalendarEventType.OPEN_FOR_APPLICATION;
        }

        const event = createIPOEvent(ipo, eventType, date, ipo.closeDate);
        if (event) events.push(event);
      });
    }
  } else if (ipo.openDate && !ipo.closeDate) {
    // If only openDate exists, create OPENING_TODAY event
    const openEvent = createIPOEvent(
      ipo,
      CalendarEventType.OPENING_TODAY,
      ipo.openDate
    );
    if (openEvent) events.push(openEvent);
  } else if (!ipo.openDate && ipo.closeDate) {
    // If only closeDate exists, create CLOSING_TODAY event
    const closeEvent = createIPOEvent(
      ipo,
      CalendarEventType.CLOSING_TODAY,
      ipo.closeDate
    );
    if (closeEvent) events.push(closeEvent);
  }

  // DISCRETE EVENTS - Post-application timeline events

  // Allotment date
  const allotmentEvent = createIPOEvent(
    ipo,
    CalendarEventType.ALLOTMENT,
    ipo.allotmentDate
  );
  if (allotmentEvent) events.push(allotmentEvent);

  // Story 4.12: Basis of Allotment Date
  if (ipo.ipoDetails?.basisOfAllotmentDate) {
    const basisOfAllotmentEvent = createIPOEvent(
      ipo,
      CalendarEventType.BASIS_OF_ALLOTMENT,
      ipo.ipoDetails.basisOfAllotmentDate
    );
    if (basisOfAllotmentEvent) events.push(basisOfAllotmentEvent);
  }

  // Story 4.12: Initiation of Refunds Date
  if (ipo.ipoDetails?.initiationOfRefundsDate) {
    const refundEvent = createIPOEvent(
      ipo,
      CalendarEventType.REFUND,
      ipo.ipoDetails.initiationOfRefundsDate
    );
    if (refundEvent) events.push(refundEvent);
  }

  // Story 4.12: Credit of Shares Date
  if (ipo.ipoDetails?.creditOfSharesDate) {
    const creditEvent = createIPOEvent(
      ipo,
      CalendarEventType.CREDIT_OF_SHARES,
      ipo.ipoDetails.creditOfSharesDate
    );
    if (creditEvent) events.push(creditEvent);
  }

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
 * Get event type priority for section ordering
 * Story 15.1: Priority-based ordering (lower number = higher priority)
 */
function getEventTypePriority(type: CalendarEventType): number {
  const priorities = {
    [CalendarEventType.CLOSING_TODAY]: 1, // Most urgent
    [CalendarEventType.OPENING_TODAY]: 2,
    [CalendarEventType.OPEN_FOR_APPLICATION]: 3,
    [CalendarEventType.LISTING]: 4, // Excitement factor
    [CalendarEventType.ALLOTMENT]: 5,
    [CalendarEventType.BASIS_OF_ALLOTMENT]: 6,
    [CalendarEventType.REFUND]: 7,
    [CalendarEventType.CREDIT_OF_SHARES]: 8,
    [CalendarEventType.HOLIDAY]: 9, // Lowest priority
  };
  return priorities[type] ?? 99;
}

/**
 * Get display label for event type section
 * Story 15.1: Human-readable section headers
 */
function getEventGroupLabel(type: CalendarEventType): string {
  const labels = {
    [CalendarEventType.CLOSING_TODAY]: 'Closing Today',
    [CalendarEventType.OPENING_TODAY]: 'Opening Today',
    [CalendarEventType.OPEN_FOR_APPLICATION]: 'Open for Application',
    [CalendarEventType.LISTING]: 'Listing',
    [CalendarEventType.ALLOTMENT]: 'Allotment',
    [CalendarEventType.BASIS_OF_ALLOTMENT]: 'Basis of Allotment',
    [CalendarEventType.REFUND]: 'Refund Initiation',
    [CalendarEventType.CREDIT_OF_SHARES]: 'Credit of Shares',
    [CalendarEventType.HOLIDAY]: 'Market Holiday',
  };
  return labels[type] ?? 'Other Events';
}

/**
 * Sort events within a group by priority
 * Story 15.1: Within each event type, sort by relevance
 */
function sortEventsWithinGroup(
  events: CalendarEvent[],
  groupType: CalendarEventType
): CalendarEvent[] {
  if (events.length === 0) return events;

  // For OPEN_FOR_APPLICATION and CLOSING_TODAY: Sort by close date proximity (sooner = higher)
  if (
    groupType === CalendarEventType.OPEN_FOR_APPLICATION ||
    groupType === CalendarEventType.CLOSING_TODAY
  ) {
    return [...events].sort((a, b) => {
      // Sort by close date (sooner = higher priority)
      const closeDateA = a.closeDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const closeDateB = b.closeDate?.getTime() ?? Number.MAX_SAFE_INTEGER;

      if (closeDateA !== closeDateB) {
        return closeDateA - closeDateB; // Earlier dates first
      }

      // If close dates are equal or missing, fall back to alphabetical by company name
      const nameA = a.companyName?.toLowerCase() ?? '';
      const nameB = b.companyName?.toLowerCase() ?? '';
      return nameA.localeCompare(nameB);
    });
  }

  // For LISTING: Sort by company name (alphabetical)
  if (groupType === CalendarEventType.LISTING) {
    return [...events].sort((a, b) => {
      const nameA = a.companyName?.toLowerCase() ?? '';
      const nameB = b.companyName?.toLowerCase() ?? '';
      return nameA.localeCompare(nameB);
    });
  }

  // Default: Keep original order
  return events;
}

/**
 * Group events by type and create EventGroup objects
 * Story 15.1: Organize events into sections for better UX
 */
function groupEventsByType(events: CalendarEvent[]): EventGroup[] {
  if (events.length === 0) return [];

  // Group events by type
  const eventsByType = events.reduce((acc, event) => {
    const type = event.type;
    if (!acc.has(type)) {
      acc.set(type, []);
    }
    acc.get(type)!.push(event);
    return acc;
  }, new Map<CalendarEventType, CalendarEvent[]>());

  // Convert to EventGroup array with priority and labels
  const eventGroups: EventGroup[] = [];

  eventsByType.forEach((groupEvents, type) => {
    const sortedEvents = sortEventsWithinGroup(groupEvents, type);

    eventGroups.push({
      type,
      priority: getEventTypePriority(type),
      label: getEventGroupLabel(type),
      events: sortedEvents,
    });
  });

  // Sort groups by priority (lower number = higher priority)
  eventGroups.sort((a, b) => a.priority - b.priority);

  return eventGroups;
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
 * Story 15.1: Added eventGroups for organized display
 */
function createCalendarDateEvents(
  eventsByDate: Map<string, CalendarEvent[]>
): CalendarDateEvents[] {
  const calendarDates: CalendarDateEvents[] = [];

  eventsByDate.forEach((events, dateString) => {
    const date = parseISO(dateString);
    const hasHoliday = events.some((e) => e.type === CalendarEventType.HOLIDAY);

    // Story 15.1: Group events by type for organized display
    const eventGroups = groupEventsByType(events);

    calendarDates.push({
      date,
      dateString,
      events, // Keep for backward compatibility
      eventGroups, // Story 15.1: Grouped and sorted events
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

    // Initialize repositories (Services use repositories directly)
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);

    // Fetch Mainboard IPOs with ipoDetails using repository pattern
    // Story 4.12: Use findAllWithDetails to get extended timeline dates
    // (basisOfAllotmentDate, initiationOfRefundsDate, creditOfSharesDate)
    // Performance optimization: Filter by date range at database level
    const ipos = await ipoRepository.findAllWithDetails({
      category: ['MAINBOARD'],
      year: undefined, // Get all years
      dateFrom: monthStart, // Only fetch IPOs with events in this month
      dateTo: monthEnd,
    });

    // Extract all events from IPOs
    // Story 15.1: Pass monthStart/monthEnd for continuous event generation
    // Performance: Repository filters IPOs, extractIPOEvents now handles month boundaries
    let allEvents: CalendarEvent[] = [];
    ipos.forEach((ipo) => {
      const ipoEvents = extractIPOEvents(ipo, monthStart, monthEnd);
      // Events are already filtered by extractIPOEvents for the target month
      allEvents = [...allEvents, ...ipoEvents];
    });

    // Fetch market holidays for the year (with graceful degradation)
    let holidays: MarketHoliday[] = [];
    try {
      // Fetch market holidays using repository pattern
      const holidayRepository = new MarketHolidayRepository(db, redis);
      holidays = await holidayRepository.findByYear(year) || [];
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
      eventGroups: [],
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
    [CalendarEventType.OPENING_TODAY]: 0, // Story 15.1
    [CalendarEventType.CLOSING_TODAY]: 0, // Story 15.1
    [CalendarEventType.OPEN_FOR_APPLICATION]: 0, // Story 15.1
    [CalendarEventType.ALLOTMENT]: 0,
    [CalendarEventType.BASIS_OF_ALLOTMENT]: 0, // Story 4.12
    [CalendarEventType.REFUND]: 0,
    [CalendarEventType.CREDIT_OF_SHARES]: 0, // Story 4.12
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
