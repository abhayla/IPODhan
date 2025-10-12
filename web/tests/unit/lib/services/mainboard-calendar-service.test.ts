/**
 * Unit Tests for Mainboard Calendar Service
 *
 * Tests for getMainboardIPOEvents, searchCalendarEvents, and getEventCounts functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getMainboardIPOEvents,
  searchCalendarEvents,
  getEventCounts,
  CalendarEventType,
} from '@/lib/services/mainboard-calendar-service';
import * as apiClient from '@/lib/api-client';
import {
  mockMainboardIPOs,
  mockMarketHolidays,
} from '@/tests/fixtures/mainboard-calendar.fixture';

// ==================== MOCKS ====================

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    getIPOs: vi.fn(),
    getMarketHolidays: vi.fn(),
  },
}));

// ==================== TESTS ====================

describe('Mainboard Calendar Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getMainboardIPOEvents', () => {
    it('should fetch and aggregate Mainboard IPO events for a month', async () => {
      // Mock API responses
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: mockMarketHolidays as any[],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      expect(result.monthName).toBe('October 2025');
      expect(result.dates.length).toBe(31); // October has 31 days
      expect(result.totalEvents).toBeGreaterThan(0);
    });

    it('should return 31 dates for October', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 500, total: 0, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.dates.length).toBe(31);
    });

    it('should group events by date correctly', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: mockMarketHolidays as any[],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await getMainboardIPOEvents(10, 2025);

      // Find date with events
      const dateWithEvents = result.dates.find((d) => d.events.length > 0);
      expect(dateWithEvents).toBeDefined();

      if (dateWithEvents) {
        expect(dateWithEvents.dateString).toMatch(/2025-10-\d{2}/);
        expect(dateWithEvents.events[0]).toHaveProperty('type');
        expect(dateWithEvents.events[0]).toHaveProperty('date');
      }
    });

    it('should detect multi-event dates', async () => {
      // Create IPO with multiple events on same date
      const multiEventIPO = {
        ...mockMainboardIPOs[0],
        id: '99',
        companyName: 'Multi Event Co',
        openDate: '2025-10-15',
        closeDate: '2025-10-15', // Same date as open
        allotmentDate: '2025-10-20',
        listingDate: '2025-10-22',
      };

      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: [multiEventIPO] as any[],
        pagination: { page: 1, limit: 500, total: 1, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await getMainboardIPOEvents(10, 2025);

      const oct15 = result.dates.find((d) => d.dateString === '2025-10-15');
      expect(oct15).toBeDefined();
      if (oct15) {
        expect(oct15.hasMultipleEvents).toBe(true);
        expect(oct15.events.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should integrate market holidays', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 500, total: 0, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: mockMarketHolidays as any[],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

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

    it('should handle holiday API failure gracefully', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockRejectedValue(
        new Error('Holiday API failed')
      );

      // Should not throw error
      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      // Calendar should work without holidays
      expect(result.dates.length).toBe(31);
    });

    it('should validate month and year parameters', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 500, total: 0, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      // Invalid month
      await expect(getMainboardIPOEvents(13, 2025)).rejects.toThrow('Invalid month');

      // Invalid year
      await expect(getMainboardIPOEvents(10, 1999)).rejects.toThrow('Invalid year');
    });

    it('should return empty calendar on API error', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockRejectedValue(
        new Error('API failed')
      );

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await getMainboardIPOEvents(10, 2025);

      expect(result.month).toBe(10);
      expect(result.year).toBe(2025);
      expect(result.dates.length).toBe(31);
      expect(result.totalEvents).toBe(0);
    });
  });

  describe('searchCalendarEvents', () => {
    it('should filter events by company name', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await searchCalendarEvents(10, 2025, 'Tech');

      // Should only include dates with "Tech" events
      const techEvents = result.dates.flatMap((d) =>
        d.events.filter((e) => e.companyName?.includes('Tech'))
      );
      expect(techEvents.length).toBeGreaterThan(0);
    });

    it('should return all events for empty search query', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const result = await searchCalendarEvents(10, 2025, '');

      expect(result.totalEvents).toBeGreaterThan(0);
    });

    it('should be case-insensitive', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: [],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const resultLower = await searchCalendarEvents(10, 2025, 'tech');
      const resultUpper = await searchCalendarEvents(10, 2025, 'TECH');

      expect(resultLower.totalEvents).toBe(resultUpper.totalEvents);
    });
  });

  describe('getEventCounts', () => {
    it('should return counts for all event types', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: mockMainboardIPOs as any[],
        pagination: { page: 1, limit: 500, total: 3, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: mockMarketHolidays as any[],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const counts = await getEventCounts(10, 2025);

      expect(counts).toHaveProperty(CalendarEventType.OPEN);
      expect(counts).toHaveProperty(CalendarEventType.CLOSE);
      expect(counts).toHaveProperty(CalendarEventType.ALLOTMENT);
      expect(counts).toHaveProperty(CalendarEventType.REFUND);
      expect(counts).toHaveProperty(CalendarEventType.LISTING);
      expect(counts).toHaveProperty(CalendarEventType.HOLIDAY);

      // All counts should be non-negative
      Object.values(counts).forEach((count) => {
        expect(count).toBeGreaterThanOrEqual(0);
      });
    });

    it('should count holiday events', async () => {
      vi.mocked(apiClient.apiClient.getIPOs).mockResolvedValue({
        data: [],
        pagination: { page: 1, limit: 500, total: 0, hasMore: false },
      });

      vi.mocked(apiClient.apiClient.getMarketHolidays).mockResolvedValue({
        holidays: mockMarketHolidays as any[],
        fetchedAt: '2025-01-01T00:00:00Z',
      });

      const counts = await getEventCounts(10, 2025);

      expect(counts[CalendarEventType.HOLIDAY]).toBeGreaterThan(0);
    });
  });
});
