/**
 * Unit Tests for Mainboard Calendar Service
 *
 * Tests for getMainboardIPOEvents, searchCalendarEvents, and getEventCounts functions.
 *
 * NOTE: the service uses the repository layer directly — IPORepository.findAllWithDetails
 * (returns an IPO[] array) and MarketHolidayRepository.findByYear (returns a holiday[]).
 * These tests mock those repositories, not the HTTP api-client.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMainboardIPOEvents,
  searchCalendarEvents,
  getEventCounts,
  CalendarEventType,
} from '@/lib/services/mainboard-calendar-service';
import {
  mockMainboardIPOs,
  mockMarketHolidays,
} from '@/tests/fixtures/mainboard-calendar.fixture';

// ==================== MOCKS ====================

const mockFindAllWithDetails = vi.fn();
const mockFindByYear = vi.fn();

vi.mock('@/lib/db/index', () => ({ db: {} }));
vi.mock('@/lib/cache/redis-client', () => ({
  getRedisClient: vi.fn(() => ({})),
}));
vi.mock('@/lib/repositories/ipo-repository', () => ({
  IPORepository: vi.fn().mockImplementation(() => ({
    findAllWithDetails: mockFindAllWithDetails,
  })),
}));
vi.mock('@/lib/repositories/market-holiday-repository', () => ({
  MarketHolidayRepository: vi.fn().mockImplementation(() => ({
    findByYear: mockFindByYear,
  })),
}));

// Convenience setters mirroring the service's repository contracts
const withIPOs = (rows: unknown[]) => mockFindAllWithDetails.mockResolvedValue(rows);
const withHolidays = (rows: unknown[]) => mockFindByYear.mockResolvedValue(rows);

// ==================== TESTS ====================

describe('Mainboard Calendar Service', () => {
  beforeEach(() => {
    // Do NOT restoreAllMocks — it wipes the repository factory implementations.
    vi.clearAllMocks();
    mockFindAllWithDetails.mockReset();
    mockFindByYear.mockReset();
  });

  describe('getMainboardIPOEvents', () => {
    it('should fetch and aggregate Mainboard IPO events for a month', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays(mockMarketHolidays as unknown[]);

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      expect(result.monthName).toBe('October 2025');
      expect(result.dates.length).toBe(31); // October has 31 days
      expect(result.totalEvents).toBeGreaterThan(0);
    });

    it('should return 31 dates for October', async () => {
      withIPOs([]);
      withHolidays([]);

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.dates.length).toBe(31);
    });

    it('should group events by date correctly', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays(mockMarketHolidays as unknown[]);

      const result = await getMainboardIPOEvents(10, 2025);

      const dateWithEvents = result.dates.find((d) => d.events.length > 0);
      expect(dateWithEvents).toBeDefined();

      if (dateWithEvents) {
        expect(dateWithEvents.dateString).toMatch(/2025-10-\d{2}/);
        expect(dateWithEvents.events[0]).toHaveProperty('type');
        expect(dateWithEvents.events[0]).toHaveProperty('date');
      }
    });

    it('should detect multi-event dates', async () => {
      // Two DISTINCT event types on the same date (ALLOTMENT + LISTING on 10-20)
      // genuinely produce a multi-event date. (open==close yields a single
      // OPENING_TODAY event, so it can't be used to test multi-event detection.)
      const multiEventIPO = {
        ...mockMainboardIPOs[0],
        id: '99',
        companyName: 'Multi Event Co',
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        allotmentDate: '2025-10-20',
        listingDate: '2025-10-20', // same date as allotment → 2 events on 10-20
      };

      withIPOs([multiEventIPO]);
      withHolidays([]);

      const result = await getMainboardIPOEvents(10, 2025);

      const oct20 = result.dates.find((d) => d.dateString === '2025-10-20');
      expect(oct20).toBeDefined();
      if (oct20) {
        expect(oct20.hasMultipleEvents).toBe(true);
        expect(oct20.events.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should integrate market holidays', async () => {
      withIPOs([]);
      withHolidays(mockMarketHolidays as unknown[]);

      const result = await getMainboardIPOEvents(10, 2025);

      const holidayDate = result.dates.find((d) => d.isHoliday);
      expect(holidayDate).toBeDefined();

      if (holidayDate) {
        const holidayEvent = holidayDate.events.find(
          (e) => e.type === CalendarEventType.HOLIDAY
        );
        expect(holidayEvent).toBeDefined();
        expect(holidayEvent?.holidayName).toBeDefined();
      }
    });

    it('should handle holiday repository failure gracefully', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      mockFindByYear.mockRejectedValue(new Error('Holiday repo failed'));

      // Should not throw — graceful degradation
      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      expect(result.dates.length).toBe(31);
    });

    it('should validate month and year parameters', async () => {
      withIPOs([]);
      withHolidays([]);

      await expect(getMainboardIPOEvents(13, 2025)).rejects.toThrow('Invalid month');
      await expect(getMainboardIPOEvents(10, 1999)).rejects.toThrow('Invalid year');
    });

    it('should return empty calendar on repository error', async () => {
      mockFindAllWithDetails.mockRejectedValue(new Error('DB failed'));
      withHolidays([]);

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      expect(result.dates.length).toBe(31);
      expect(result.totalEvents).toBe(0);
    });
  });

  describe('searchCalendarEvents', () => {
    it('should filter events by company name', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays([]);

      const result = await searchCalendarEvents(10, 2025, 'Tech');

      const techEvents = result.dates.flatMap((d) =>
        d.events.filter((e) => e.companyName?.includes('Tech'))
      );
      expect(techEvents.length).toBeGreaterThan(0);
    });

    it('should return all events for empty search query', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays([]);

      const result = await searchCalendarEvents(10, 2025, '');

      expect(result.totalEvents).toBeGreaterThan(0);
    });

    it('should be case-insensitive', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays([]);

      const resultLower = await searchCalendarEvents(10, 2025, 'tech');
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays([]);
      const resultUpper = await searchCalendarEvents(10, 2025, 'TECH');

      expect(resultLower.totalEvents).toBe(resultUpper.totalEvents);
    });
  });

  describe('getEventCounts', () => {
    it('should return counts for all event types', async () => {
      withIPOs(mockMainboardIPOs as unknown[]);
      withHolidays(mockMarketHolidays as unknown[]);

      const counts = await getEventCounts(10, 2025);

      // Enum members were renamed: OPEN→OPENING_TODAY, CLOSE→CLOSING_TODAY.
      expect(counts).toHaveProperty(CalendarEventType.OPENING_TODAY);
      expect(counts).toHaveProperty(CalendarEventType.CLOSING_TODAY);
      expect(counts).toHaveProperty(CalendarEventType.ALLOTMENT);
      expect(counts).toHaveProperty(CalendarEventType.REFUND);
      expect(counts).toHaveProperty(CalendarEventType.LISTING);
      expect(counts).toHaveProperty(CalendarEventType.HOLIDAY);

      Object.values(counts).forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });

    it('should count holiday events', async () => {
      withIPOs([]);
      withHolidays(mockMarketHolidays as unknown[]);

      const counts = await getEventCounts(10, 2025);

      expect(counts[CalendarEventType.HOLIDAY]).toBeGreaterThan(0);
    });
  });
});
