/**
 * SME Calendar Service
 *
 * Service layer for fetching and aggregating SME IPO calendar data.
 * Generates monthly calendar grid with IPO events and market holidays.
 *
 * Story 9.13: SME IPO Calendar Page
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

// ==================== TYPES ====================

/**
 * Calendar event types
 * Story 4.12: Added extended timeline event types
 * Standardized to singular forms (consistent with Mainboard calendar)
 */
export type CalendarEventType = 'OPEN' | 'CLOSE' | 'ALLOTMENT' | 'BASIS_OF_ALLOTMENT' | 'REFUND' | 'CREDIT_OF_SHARES' | 'LISTING' | 'HOLIDAY';

/**
 * Calendar event data structure
 */
export interface CalendarEvent {
  date: Date;
  eventType: CalendarEventType;
  ipo?: IPO;
  description: string;
  slug?: string;
}

/**
 * Calendar day data structure (represents one cell in calendar grid)
 */
export interface CalendarDay {
  date: Date;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if two dates are the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check if date is in specified month/year
 */
function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getFullYear() === year && date.getMonth() === month - 1;
}

/**
 * Find day index in calendar grid for a given date
 */
function findDayIndex(calendarDays: CalendarDay[], targetDate: Date): number {
  return calendarDays.findIndex((day) => isSameDay(day.date, targetDate));
}

/**
 * Get month name from month number (1-12)
 */
export function getMonthName(month: number): string {
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return monthNames[month - 1] || 'Unknown';
}

/**
 * Parse date string to Date object (handles both ISO strings and date-only strings)
 */
function parseDate(dateString: string | null | undefined): Date | null {
  if (!dateString) return null;

  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;
    return date;
  } catch {
    return null;
  }
}

// ==================== MAIN SERVICE FUNCTION ====================

/**
 * Get SME IPO events for a specific month/year
 *
 * Fetches SME IPOs and market holidays, then builds a 42-day calendar grid (6 weeks × 7 days)
 * with all IPO events (opens, closes, allotment, listing) and holidays aggregated by date.
 *
 * @param month - Month number (1-12)
 * @param year - Year (e.g., 2025)
 * @returns Array of 42 CalendarDay objects representing the calendar grid
 */
export async function getSMEIPOEvents(
  month: number,
  year: number
): Promise<CalendarDay[]> {
  try {
    // Calculate month boundaries
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth = new Date(year, month, 0);
    const firstDayOfWeek = firstDayOfMonth.getDay(); // 0=Sunday, 6=Saturday

    // Calculate grid start date (may be in previous month to fill first week)
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - firstDayOfWeek);

    // Build 42-day calendar grid (6 weeks × 7 days)
    const calendarDays: CalendarDay[] = [];
    const today = new Date();

    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);

      calendarDays.push({
        date: currentDate,
        events: [],
        isCurrentMonth: currentDate.getMonth() === month - 1,
        isToday: isSameDay(currentDate, today),
        isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6,
      });
    }

    // Initialize repositories (Services use repositories directly)
    const redis = getRedisClient();
    const ipoRepository = new IPORepository(db, redis);
    const holidayRepository = new MarketHolidayRepository(db, redis);

    // Fetch SME IPOs using repository pattern
    const ipoResult = await ipoRepository.findAll({
      segment: ['SME'], // ⭐ SME filter - critical for this page
      limit: 1000, // Get all SME IPOs for calendar
      page: 1,
    });

    const smeIPOs = ipoResult.data;

    // Fetch market holidays for the calendar year
    const holidays = await holidayRepository.findByYear(year);

    // Aggregate IPO events by date
    smeIPOs.forEach((ipo) => {
      // Parse dates from IPO
      const openDate = parseDate(ipo.openDate);
      const closeDate = parseDate(ipo.closeDate);
      const allotmentDate = parseDate(ipo.allotmentDate);
      const listingDate = parseDate(ipo.listingDate);

      // Story 4.12: Parse extended timeline dates from ipoDetails
      const ipoWithDetails = ipo as typeof ipo & { ipoDetails?: { basisOfAllotmentDate?: string | null; initiationOfRefundsDate?: string | null; creditOfSharesDate?: string | null } | null };
      const basisOfAllotmentDate = parseDate(ipoWithDetails.ipoDetails?.basisOfAllotmentDate);
      const refundsDate = parseDate(ipoWithDetails.ipoDetails?.initiationOfRefundsDate);
      const creditOfSharesDate = parseDate(ipoWithDetails.ipoDetails?.creditOfSharesDate);

      // Add "Opens" event
      if (openDate && isSameMonth(openDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, openDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: openDate,
            eventType: 'OPEN',
            ipo,
            description: `${ipo.companyName} IPO Opens`,
            slug: ipo.slug,
          });
        }
      }

      // Add "Closes" event
      if (closeDate && isSameMonth(closeDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, closeDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: closeDate,
            eventType: 'CLOSE',
            ipo,
            description: `${ipo.companyName} IPO Closes`,
            slug: ipo.slug,
          });
        }
      }

      // Add "Allotment" event
      if (allotmentDate && isSameMonth(allotmentDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, allotmentDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: allotmentDate,
            eventType: 'ALLOTMENT',
            ipo,
            description: `${ipo.companyName} Allotment Status`,
            slug: ipo.slug,
          });
        }
      }

      // Story 4.12: Add "Basis of Allotment" event
      if (basisOfAllotmentDate && isSameMonth(basisOfAllotmentDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, basisOfAllotmentDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: basisOfAllotmentDate,
            eventType: 'BASIS_OF_ALLOTMENT',
            ipo,
            description: `${ipo.companyName} Basis of Allotment`,
            slug: ipo.slug,
          });
        }
      }

      // Story 4.12: Add "Refunds Initiated" event
      if (refundsDate && isSameMonth(refundsDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, refundsDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: refundsDate,
            eventType: 'REFUND',
            ipo,
            description: `${ipo.companyName} Refunds Initiated`,
            slug: ipo.slug,
          });
        }
      }

      // Story 4.12: Add "Credit of Shares" event
      if (creditOfSharesDate && isSameMonth(creditOfSharesDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, creditOfSharesDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: creditOfSharesDate,
            eventType: 'CREDIT_OF_SHARES',
            ipo,
            description: `${ipo.companyName} Shares Credited`,
            slug: ipo.slug,
          });
        }
      }

      // Add "Lists" event
      if (listingDate && isSameMonth(listingDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, listingDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: listingDate,
            eventType: 'LISTING',
            ipo,
            description: `${ipo.companyName} Lists`,
            slug: ipo.slug,
          });
        }
      }
    });

    // Add holiday events
    holidays.forEach((holiday) => {
      const holidayDate = parseDate(holiday.date);

      if (holidayDate && isSameMonth(holidayDate, year, month)) {
        const dayIndex = findDayIndex(calendarDays, holidayDate);
        if (dayIndex >= 0) {
          calendarDays[dayIndex].events.push({
            date: holidayDate,
            eventType: 'HOLIDAY',
            description: `Holiday - ${holiday.description}`,
          });
        }
      }
    });

    return calendarDays;
  } catch (error) {
    // Graceful degradation - return empty calendar on error
    console.error('Error fetching SME calendar events:', error);

    // Still return calendar grid structure with no events
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const firstDayOfWeek = firstDayOfMonth.getDay();
    const startDate = new Date(firstDayOfMonth);
    startDate.setDate(startDate.getDate() - firstDayOfWeek);

    const emptyCalendarDays: CalendarDay[] = [];
    const today = new Date();

    for (let i = 0; i < 42; i++) {
      const currentDate = new Date(startDate);
      currentDate.setDate(currentDate.getDate() + i);

      emptyCalendarDays.push({
        date: currentDate,
        events: [],
        isCurrentMonth: currentDate.getMonth() === month - 1,
        isToday: isSameDay(currentDate, today),
        isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6,
      });
    }

    return emptyCalendarDays;
  }
}
