/**
 * Test Fixtures for SME Calendar Service
 *
 * Provides sample data for testing SME IPO calendar functionality.
 * Story 9.13: SME IPO Calendar Page
 */

import type { IPO } from '@/lib/api-client';
import type { MarketHoliday } from '@/lib/api-client';
import type { CalendarDay } from '@/lib/services/sme-calendar-service';

// ==================== SME IPO FIXTURES ====================

/**
 * Sample SME IPO data for testing
 */
export const smeIPOFixtures: IPO[] = [
  {
    id: '1',
    companyName: 'ABC SME Limited',
    slug: 'abc-sme-limited',
    category: 'SME',
    sector: 'Technology',
    issueSize: '50',
    priceRangeMin: 100,
    priceRangeMax: 120,
    priceBandLow: 100,
    priceBandHigh: 120,
    symbol: 'ABCSME',
    lotSize: 1000,
    status: 'OPEN',
    openDate: '2025-10-05',
    closeDate: '2025-10-10',
    allotmentDate: '2025-10-15',
    listingDate: '2025-10-20',
    companyDescription: 'ABC SME Limited is a technology company',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Link Intime',
    registrarId: null,
    leadManagers: ['ICICI Securities'],
    rating: 4,
    ratingRationale: 'Good fundamentals',
    ratingOverride: false,
    lastScrapedAt: '2025-10-01T00:00:00Z',
    createdAt: '2025-09-01T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: '2',
    companyName: 'XYZ SME Corp',
    slug: 'xyz-sme-corp',
    category: 'SME',
    sector: 'Manufacturing',
    issueSize: '75',
    priceRangeMin: 150,
    priceRangeMax: 180,
    priceBandLow: 150,
    priceBandHigh: 180,
    symbol: 'XYZSME',
    lotSize: 800,
    status: 'UPCOMING',
    openDate: '2025-10-12',
    closeDate: '2025-10-18',
    allotmentDate: '2025-10-22',
    listingDate: '2025-10-25',
    companyDescription: 'XYZ SME Corp is a manufacturing company',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'KFin Technologies',
    registrarId: null,
    leadManagers: ['HDFC Securities'],
    rating: 3,
    ratingRationale: 'Average fundamentals',
    ratingOverride: false,
    lastScrapedAt: '2025-10-01T00:00:00Z',
    createdAt: '2025-09-01T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: '3',
    companyName: 'PQR SME Industries',
    slug: 'pqr-sme-industries',
    category: 'SME',
    sector: 'Healthcare',
    issueSize: '100',
    priceRangeMin: 200,
    priceRangeMax: 250,
    priceBandLow: 200,
    priceBandHigh: 250,
    symbol: 'PQRSME',
    lotSize: 600,
    status: 'LISTED',
    openDate: '2025-09-10',
    closeDate: '2025-09-15',
    allotmentDate: '2025-09-20',
    listingDate: '2025-09-25',
    companyDescription: 'PQR SME Industries is a healthcare company',
    faceValue: 10,
    listingExchanges: ['NSE', 'BSE'],
    registrar: 'Bigshare Services',
    registrarId: null,
    leadManagers: ['Axis Capital'],
    rating: 5,
    ratingRationale: 'Excellent fundamentals',
    ratingOverride: false,
    lastScrapedAt: '2025-10-01T00:00:00Z',
    createdAt: '2025-08-01T00:00:00Z',
    updatedAt: '2025-10-01T00:00:00Z',
  },
];

// ==================== MARKET HOLIDAY FIXTURES ====================

/**
 * Sample market holiday data for testing
 */
export const marketHolidayFixtures: MarketHoliday[] = [
  {
    id: '1',
    date: '2025-10-02',
    description: 'Gandhi Jayanti',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
  {
    id: '2',
    date: '2025-10-24',
    description: 'Dussehra',
    exchange: 'BOTH',
    type: 'TRADING',
    year: 2025,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  },
];

// ==================== CALENDAR DAY FIXTURES ====================

/**
 * Sample calendar days with events for testing
 */
export function generateCalendarDaysFixture(
  month: number,
  year: number
): CalendarDay[] {
  const firstDayOfMonth = new Date(year, month - 1, 1);
  const firstDayOfWeek = firstDayOfMonth.getDay();
  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(startDate.getDate() - firstDayOfWeek);

  const calendarDays: CalendarDay[] = [];
  const today = new Date();

  for (let i = 0; i < 42; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(currentDate.getDate() + i);

    calendarDays.push({
      date: currentDate,
      events: [],
      isCurrentMonth: currentDate.getMonth() === month - 1,
      isToday:
        currentDate.getFullYear() === today.getFullYear() &&
        currentDate.getMonth() === today.getMonth() &&
        currentDate.getDate() === today.getDate(),
      isWeekend: currentDate.getDay() === 0 || currentDate.getDay() === 6,
    });
  }

  return calendarDays;
}

// ==================== API RESPONSE FIXTURES ====================

/**
 * Mock API response for getIPOs (SME category)
 */
export const mockGetIPOsResponse = {
  data: smeIPOFixtures,
  pagination: {
    page: 1,
    limit: 1000,
    total: 3,
    hasMore: false,
  },
};

/**
 * Mock API response for getMarketHolidays
 */
export const mockGetMarketHolidaysResponse = {
  holidays: marketHolidayFixtures,
  fetchedAt: '2025-10-01T00:00:00Z',
};
