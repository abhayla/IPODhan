/**
 * Test Fixtures for Mainboard IPO Calendar
 *
 * Mock data for testing calendar functionality.
 */

import type { IPO, MarketHoliday } from '@/lib/api-client';
import type { CalendarEvent, CalendarDateEvents, MonthCalendarData } from '@/lib/services/mainboard-calendar-service';
import { CalendarEventType } from '@/lib/services/mainboard-calendar-service';

// ==================== MOCK IPO DATA ====================

export const mockMainboardIPOs: any[] = [
  {
    id: '1',
    companyName: 'Tech Innovations Ltd',
    slug: 'tech-innovations-ltd',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'OPEN',
    openDate: '2025-10-15',
    closeDate: '2025-10-17',
    allotmentDate: '2025-10-22',
    listingDate: '2025-10-24',
    sector: 'Technology',
    issueSize: '500',
    priceRangeMin: 100,
    priceRangeMax: 120,
    lotSize: 100,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '2',
    companyName: 'Green Energy Solutions',
    slug: 'green-energy-solutions',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'UPCOMING',
    openDate: '2025-10-20',
    closeDate: '2025-10-22',
    allotmentDate: '2025-10-27',
    listingDate: '2025-10-29',
    sector: 'Energy',
    issueSize: '300',
    priceRangeMin: 80,
    priceRangeMax: 100,
    lotSize: 150,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '3',
    companyName: 'Finance Corp India',
    slug: 'finance-corp-india',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
    status: 'CLOSED',
    openDate: '2025-10-01',
    closeDate: '2025-10-03',
    allotmentDate: '2025-10-08',
    listingDate: '2025-10-10',
    sector: 'Finance',
    issueSize: '400',
    priceRangeMin: 150,
    priceRangeMax: 180,
    lotSize: 75,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// ==================== MOCK MARKET HOLIDAYS ====================

export const mockMarketHolidays: any[] = [
  {
    id: '1',
    date: '2025-10-02',
    description: 'Gandhi Jayanti',
    exchange: 'BOTH',
    type: 'BOTH',
    year: 2025,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: '2',
    date: '2025-10-24',
    description: 'Diwali',
    exchange: 'BOTH',
    type: 'BOTH',
    year: 2025,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// ==================== MOCK CALENDAR EVENTS ====================

export const mockCalendarEvents: CalendarEvent[] = [
  {
    id: '1-OPEN-2025-10-15',
    type: CalendarEventType.OPEN,
    date: new Date('2025-10-15'),
    ipoId: '1',
    companyName: 'Tech Innovations Ltd',
    slug: 'tech-innovations-ltd',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  },
  {
    id: '1-CLOSE-2025-10-17',
    type: CalendarEventType.CLOSE,
    date: new Date('2025-10-17'),
    ipoId: '1',
    companyName: 'Tech Innovations Ltd',
    slug: 'tech-innovations-ltd',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  },
  {
    id: '1-ALLOTMENT-2025-10-22',
    type: CalendarEventType.ALLOTMENT,
    date: new Date('2025-10-22'),
    ipoId: '1',
    companyName: 'Tech Innovations Ltd',
    slug: 'tech-innovations-ltd',
    segment: 'MAINBOARD' as const,
  offeringType: 'IPO' as const,
  },
  {
    id: 'holiday-2025-10-02',
    type: CalendarEventType.HOLIDAY,
    date: new Date('2025-10-02'),
    holidayName: 'Gandhi Jayanti',
    exchange: 'BOTH',
  },
];

// ==================== MOCK CALENDAR DATE EVENTS ====================

export const mockCalendarDateEvents: CalendarDateEvents[] = [
  {
    date: new Date('2025-10-15'),
    dateString: '2025-10-15',
    events: [mockCalendarEvents[0]],
    hasMultipleEvents: false,
    isHoliday: false,
  },
  {
    date: new Date('2025-10-17'),
    dateString: '2025-10-17',
    events: [mockCalendarEvents[1]],
    hasMultipleEvents: false,
    isHoliday: false,
  },
  {
    date: new Date('2025-10-22'),
    dateString: '2025-10-22',
    events: [mockCalendarEvents[2]],
    hasMultipleEvents: false,
    isHoliday: false,
  },
  {
    date: new Date('2025-10-02'),
    dateString: '2025-10-02',
    events: [mockCalendarEvents[3]],
    hasMultipleEvents: false,
    isHoliday: true,
  },
];

// ==================== MOCK MONTH CALENDAR DATA ====================

export const mockMonthCalendarData: MonthCalendarData = {
  month: 10,
  year: 2025,
  monthName: 'October 2025',
  dates: mockCalendarDateEvents,
  totalEvents: 4,
};

// ==================== EXPORTS ====================

export default {
  mockMainboardIPOs,
  mockMarketHolidays,
  mockCalendarEvents,
  mockCalendarDateEvents,
  mockMonthCalendarData,
};
