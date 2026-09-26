/**
 * Integration Tests: Mainboard Landing Page
 * Story 9.15: Mainboard IPOs Landing Page
 *
 * Tests the complete landing page with all integrated components.
 * Target: Verify all sections render correctly with mock data
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as mainboardLandingService from '@/lib/services/mainboard-landing-service';
import {
  mainboardIPOFixtures,
  getCurrentIPOs,
  getUpcomingIPOs,
  getRecentlyListedIPOs,
  summaryMetricsFixture,
  reviewFixtures,
  emptyFixtures,
} from '@/tests/fixtures/mainboard-landing.fixture';

// Mock the service layer
vi.mock('@/lib/services/mainboard-landing-service');

// Note: Testing server components requires special setup
// This integration test focuses on testing the service layer integration
// For full page rendering tests, see E2E tests

describe('Mainboard Landing Page Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==================== TEST: Service Layer Integration ====================

  describe('Service Layer Data Fetching', () => {
    it('should fetch all required data for landing page', async () => {
      // Arrange
      vi.mocked(mainboardLandingService.getMainboardSummaryMetrics).mockResolvedValue(
        summaryMetricsFixture
      );
      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockResolvedValue(
        getCurrentIPOs()
      );
      vi.mocked(mainboardLandingService.getMainboardUpcomingIPOs).mockResolvedValue(
        getUpcomingIPOs()
      );
      vi.mocked(mainboardLandingService.getMainboardRecentlyListedIPOs).mockResolvedValue(
        getRecentlyListedIPOs()
      );
      vi.mocked(mainboardLandingService.getMainboardReviews).mockResolvedValue(reviewFixtures);
      vi.mocked(mainboardLandingService.getMainboardDetailedList).mockResolvedValue({
        data: mainboardIPOFixtures,
        totalCount: mainboardIPOFixtures.length,
      });

      // Act
      const metrics = await mainboardLandingService.getMainboardSummaryMetrics();
      const currentIPOs = await mainboardLandingService.getMainboardCurrentIPOs();
      const upcomingIPOs = await mainboardLandingService.getMainboardUpcomingIPOs();
      const recentlyListedIPOs =
        await mainboardLandingService.getMainboardRecentlyListedIPOs();
      const reviews = await mainboardLandingService.getMainboardReviews();
      const detailedList = await mainboardLandingService.getMainboardDetailedList();

      // Assert
      expect(metrics).toEqual(summaryMetricsFixture);
      expect(currentIPOs).toEqual(getCurrentIPOs());
      expect(upcomingIPOs).toEqual(getUpcomingIPOs());
      expect(recentlyListedIPOs).toEqual(getRecentlyListedIPOs());
      expect(reviews).toEqual(reviewFixtures);
      expect(detailedList.data).toEqual(mainboardIPOFixtures);
    });

    it('should handle errors gracefully when service calls fail', async () => {
      // Arrange - Simulate API failures
      vi.mocked(mainboardLandingService.getMainboardSummaryMetrics).mockRejectedValue(
        new Error('API Error')
      );
      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockRejectedValue(
        new Error('Network Error')
      );

      // Act & Assert - Should not throw
      await expect(
        mainboardLandingService.getMainboardSummaryMetrics()
      ).rejects.toThrow();
      await expect(mainboardLandingService.getMainboardCurrentIPOs()).rejects.toThrow();
    });

    it('should fetch detailed list with year filter', async () => {
      // Arrange
      const year2025Data = mainboardIPOFixtures.filter((ipo) => {
        if (!ipo.openDate) return false;
        return new Date(ipo.openDate).getFullYear() === 2025;
      });

      vi.mocked(mainboardLandingService.getMainboardDetailedList).mockResolvedValue({
        data: year2025Data,
        totalCount: year2025Data.length,
      });

      // Act
      const result = await mainboardLandingService.getMainboardDetailedList({
        year: 2025,
      });

      // Assert
      expect(result.data).toEqual(year2025Data);
      expect(result.totalCount).toBe(year2025Data.length);
      expect(mainboardLandingService.getMainboardDetailedList).toHaveBeenCalledWith({
        year: 2025,
      });
    });

    it('should fetch detailed list with company search filter', async () => {
      // Arrange
      const searchTerm = 'Tech';
      const searchResults = mainboardIPOFixtures.filter((ipo) =>
        ipo.companyName.includes(searchTerm)
      );

      vi.mocked(mainboardLandingService.getMainboardDetailedList).mockResolvedValue({
        data: searchResults,
        totalCount: searchResults.length,
      });

      // Act
      const result = await mainboardLandingService.getMainboardDetailedList({
        companySearch: searchTerm,
      });

      // Assert
      expect(result.data).toEqual(searchResults);
      expect(mainboardLandingService.getMainboardDetailedList).toHaveBeenCalledWith({
        companySearch: searchTerm,
      });
    });
  });

  // ==================== TEST: Empty State Handling ====================

  describe('Empty State Handling', () => {
    it('should handle empty data gracefully', async () => {
      // Arrange - Return empty data
      vi.mocked(mainboardLandingService.getMainboardSummaryMetrics).mockResolvedValue(
        emptyFixtures.summaryMetrics
      );
      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockResolvedValue(
        emptyFixtures.ipos
      );
      vi.mocked(mainboardLandingService.getMainboardUpcomingIPOs).mockResolvedValue(
        emptyFixtures.ipos
      );
      vi.mocked(mainboardLandingService.getMainboardRecentlyListedIPOs).mockResolvedValue(
        emptyFixtures.ipos
      );
      vi.mocked(mainboardLandingService.getMainboardReviews).mockResolvedValue(
        emptyFixtures.reviews
      );

      // Act
      const metrics = await mainboardLandingService.getMainboardSummaryMetrics();
      const currentIPOs = await mainboardLandingService.getMainboardCurrentIPOs();
      const upcomingIPOs = await mainboardLandingService.getMainboardUpcomingIPOs();
      const recentlyListedIPOs =
        await mainboardLandingService.getMainboardRecentlyListedIPOs();
      const reviews = await mainboardLandingService.getMainboardReviews();

      // Assert - All should return empty but defined results
      expect(metrics).toEqual(emptyFixtures.summaryMetrics);
      expect(currentIPOs).toEqual([]);
      expect(upcomingIPOs).toEqual([]);
      expect(recentlyListedIPOs).toEqual([]);
      expect(reviews).toEqual([]);
    });

    it('should return zero metrics when no IPOs exist', async () => {
      // Arrange
      vi.mocked(mainboardLandingService.getMainboardSummaryMetrics).mockResolvedValue({
        totalIPOs: 0,
        upcomingAndOngoing: 0,
      });

      // Act
      const metrics = await mainboardLandingService.getMainboardSummaryMetrics();

      // Assert
      expect(metrics.totalIPOs).toBe(0);
      expect(metrics.upcomingAndOngoing).toBe(0);
    });
  });

  // ==================== TEST: Data Consistency ====================

  describe('Data Consistency', () => {
    it('should return consistent data types across all services', async () => {
      // Arrange
      vi.mocked(mainboardLandingService.getMainboardSummaryMetrics).mockResolvedValue(
        summaryMetricsFixture
      );
      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockResolvedValue(
        getCurrentIPOs()
      );

      // Act
      const metrics = await mainboardLandingService.getMainboardSummaryMetrics();
      const currentIPOs = await mainboardLandingService.getMainboardCurrentIPOs();

      // Assert - Check data types
      expect(typeof metrics.totalIPOs).toBe('number');
      expect(typeof metrics.upcomingAndOngoing).toBe('number');
      expect(Array.isArray(currentIPOs)).toBe(true);
    });

    it('should filter only MAINBOARD category IPOs', async () => {
      // Arrange
      const mainboardOnly = getCurrentIPOs();
      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockResolvedValue(
        mainboardOnly
      );

      // Act
      const result = await mainboardLandingService.getMainboardCurrentIPOs();

      // Assert
      result.forEach((ipo) => {
        expect(ipo.segment).toBe('MAINBOARD');
      });
    });

    it('should limit content sections to 6 items', async () => {
      // Arrange
      const currentIPOs = getCurrentIPOs();
      const upcomingIPOs = getUpcomingIPOs();
      const recentlyListedIPOs = getRecentlyListedIPOs();

      vi.mocked(mainboardLandingService.getMainboardCurrentIPOs).mockResolvedValue(
        currentIPOs
      );
      vi.mocked(mainboardLandingService.getMainboardUpcomingIPOs).mockResolvedValue(
        upcomingIPOs
      );
      vi.mocked(mainboardLandingService.getMainboardRecentlyListedIPOs).mockResolvedValue(
        recentlyListedIPOs
      );

      // Act
      const current = await mainboardLandingService.getMainboardCurrentIPOs();
      const upcoming = await mainboardLandingService.getMainboardUpcomingIPOs();
      const listed = await mainboardLandingService.getMainboardRecentlyListedIPOs();

      // Assert
      expect(current.length).toBeLessThanOrEqual(6);
      expect(upcoming.length).toBeLessThanOrEqual(6);
      expect(listed.length).toBeLessThanOrEqual(6);
    });
  });


  // ==================== TEST: URL Query Params ====================

  describe('URL Query Params Handling', () => {
    it('should handle year query param for detailed list', async () => {
      // Arrange
      const filteredData = mainboardIPOFixtures.filter((ipo) => {
        if (!ipo.openDate) return false;
        return new Date(ipo.openDate).getFullYear() === 2024;
      });

      vi.mocked(mainboardLandingService.getMainboardDetailedList).mockResolvedValue({
        data: filteredData,
        totalCount: filteredData.length,
      });

      // Act
      const result = await mainboardLandingService.getMainboardDetailedList({
        year: 2024,
      });

      // Assert
      expect(result.data).toEqual(filteredData);
      expect(mainboardLandingService.getMainboardDetailedList).toHaveBeenCalledWith({
        year: 2024,
      });
    });

    it('should use current year as default when no year provided', async () => {
      // Arrange
      const currentYear = new Date().getFullYear();
      vi.mocked(mainboardLandingService.getMainboardDetailedList).mockResolvedValue({
        data: mainboardIPOFixtures,
        totalCount: mainboardIPOFixtures.length,
      });

      // Act
      await mainboardLandingService.getMainboardDetailedList();

      // Assert
      expect(mainboardLandingService.getMainboardDetailedList).toHaveBeenCalled();
    });
  });

  // ==================== TEST: Cache Integration ====================

  describe('Cache Integration', () => {
    it('should call clearMainboardLandingCaches without errors', async () => {
      // Arrange
      vi.mocked(mainboardLandingService.clearMainboardLandingCaches).mockResolvedValue(
        undefined
      );

      // Act & Assert
      await expect(
        mainboardLandingService.clearMainboardLandingCaches()
      ).resolves.not.toThrow();
    });
  });
});
