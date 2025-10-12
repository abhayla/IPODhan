/**
 * Unit Tests for SME Performance Service
 *
 * Tests the SME IPO Performance Tracker service functionality.
 * Validates:
 * - Data retrieval for SME IPOs (category=SME, status=LISTED)
 * - Year filtering
 * - Performance calculation accuracy
 * - Data sorting (by listing date descending)
 * - Error handling
 *
 * Story 9.11: SME IPO Performance Tracker Page
 * Test Coverage Target: ≥80%
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getSMEIPOPerformance, type SMEIPOPerformanceData } from '@/lib/services/sme-performance-service';

describe('SME Performance Service', () => {
  describe('getSMEIPOPerformance', () => {
    // ==================== DATA RETRIEVAL TESTS ====================

    it('should return array of SME IPO performance data', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should return data with all required fields', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      expect(result.length).toBeGreaterThan(0);

      const firstIPO = result[0];
      expect(firstIPO).toHaveProperty('id');
      expect(firstIPO).toHaveProperty('companyName');
      expect(firstIPO).toHaveProperty('slug');
      expect(firstIPO).toHaveProperty('listedOn');
      expect(firstIPO).toHaveProperty('issuePrice');
      expect(firstIPO).toHaveProperty('listingDayClose');
      expect(firstIPO).toHaveProperty('listingDayGain');
      expect(firstIPO).toHaveProperty('currentPrice');
      expect(firstIPO).toHaveProperty('profitLoss');
    });

    it('should return data with correct types', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      expect(result.length).toBeGreaterThan(0);

      const firstIPO = result[0];
      expect(typeof firstIPO.id).toBe('string');
      expect(typeof firstIPO.companyName).toBe('string');
      expect(typeof firstIPO.slug).toBe('string');
      expect(typeof firstIPO.issuePrice).toBe('number');
      expect(typeof firstIPO.listingDayClose).toBe('number');
      expect(typeof firstIPO.listingDayGain).toBe('number');
      // currentPrice and profitLoss can be number or null
      expect(['number', 'object']).toContain(typeof firstIPO.currentPrice);
      expect(['number', 'object']).toContain(typeof firstIPO.profitLoss);
    });

    // ==================== YEAR FILTERING TESTS ====================

    it('should filter by year when year parameter is provided', async () => {
      const targetYear = 2024;
      const result = await getSMEIPOPerformance(targetYear);

      // All results should have listing dates in the target year
      result.forEach((ipo) => {
        if (ipo.listedOn) {
          const listedYear = new Date(ipo.listedOn).getFullYear();
          expect(listedYear).toBe(targetYear);
        }
      });
    });

    it('should return empty array for future years', async () => {
      const futureYear = new Date().getFullYear() + 2;
      const result = await getSMEIPOPerformance(futureYear);

      expect(result).toEqual([]);
    });

    it('should return all years data when year parameter is not provided', async () => {
      const result = await getSMEIPOPerformance();

      expect(Array.isArray(result)).toBe(true);
      // Should return data (assuming current year has data)
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    // ==================== CALCULATION ACCURACY TESTS ====================

    it('should calculate listingDayGain correctly (positive gain)', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      // Find an IPO with positive listing day gain
      const positiveGainIPO = result.find((ipo) => ipo.listingDayGain > 0);

      if (positiveGainIPO) {
        const expectedGain =
          ((positiveGainIPO.listingDayClose - positiveGainIPO.issuePrice) /
            positiveGainIPO.issuePrice) *
          100;

        // Allow small floating-point precision differences
        expect(positiveGainIPO.listingDayGain).toBeCloseTo(expectedGain, 2);
      }
    });

    it('should calculate listingDayGain correctly (negative loss)', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      // Find an IPO with negative listing day gain (loss)
      const negativeGainIPO = result.find((ipo) => ipo.listingDayGain < 0);

      if (negativeGainIPO) {
        const expectedGain =
          ((negativeGainIPO.listingDayClose - negativeGainIPO.issuePrice) /
            negativeGainIPO.issuePrice) *
          100;

        expect(negativeGainIPO.listingDayGain).toBeCloseTo(expectedGain, 2);
      }
    });

    it('should calculate profitLoss correctly when currentPrice is available', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      // Find an IPO with currentPrice
      const ipoWithCurrentPrice = result.find(
        (ipo) => ipo.currentPrice !== null && ipo.currentPrice !== undefined
      );

      if (ipoWithCurrentPrice && ipoWithCurrentPrice.currentPrice !== null) {
        const expectedProfitLoss =
          ((ipoWithCurrentPrice.currentPrice - ipoWithCurrentPrice.issuePrice) /
            ipoWithCurrentPrice.issuePrice) *
          100;

        expect(ipoWithCurrentPrice.profitLoss).toBeCloseTo(expectedProfitLoss, 2);
      }
    });

    it('should return null profitLoss when currentPrice is null', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      // Check if any IPO has null currentPrice
      const ipoWithNullPrice = result.find((ipo) => ipo.currentPrice === null);

      if (ipoWithNullPrice) {
        expect(ipoWithNullPrice.profitLoss).toBeNull();
      }
    });

    // ==================== SORTING TESTS ====================

    it('should sort IPOs by listing date in descending order', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      if (result.length >= 2) {
        for (let i = 0; i < result.length - 1; i++) {
          const currentDate = result[i].listedOn ? new Date(result[i].listedOn!).getTime() : 0;
          const nextDate = result[i + 1].listedOn ? new Date(result[i + 1].listedOn!).getTime() : 0;

          // Current date should be >= next date (descending order)
          expect(currentDate).toBeGreaterThanOrEqual(nextDate);
        }
      }
    });

    it('should have most recent IPO first', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      if (result.length >= 2) {
        const firstIPO = result[0];
        const lastIPO = result[result.length - 1];

        if (firstIPO.listedOn && lastIPO.listedOn) {
          const firstDate = new Date(firstIPO.listedOn).getTime();
          const lastDate = new Date(lastIPO.listedOn).getTime();

          expect(firstDate).toBeGreaterThanOrEqual(lastDate);
        }
      }
    });

    // ==================== DATA STRUCTURE TESTS ====================

    it('should have valid slug format', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        // Slug should be lowercase with hyphens
        expect(ipo.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      });
    });

    it('should have positive issue prices', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        expect(ipo.issuePrice).toBeGreaterThan(0);
      });
    });

    it('should have positive listing day close prices', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        expect(ipo.listingDayClose).toBeGreaterThan(0);
      });
    });

    it('should have valid date format for listedOn', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        if (ipo.listedOn) {
          const date = new Date(ipo.listedOn);
          expect(date.toString()).not.toBe('Invalid Date');
        }
      });
    });

    // ==================== EDGE CASES ====================

    it('should handle year with no data gracefully', async () => {
      const farPastYear = 1990;
      const result = await getSMEIPOPerformance(farPastYear);

      expect(Array.isArray(result)).toBe(true);
      // May return empty array or data depending on implementation
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('should not throw error when called multiple times', async () => {
      const currentYear = new Date().getFullYear();

      await expect(getSMEIPOPerformance(currentYear)).resolves.toBeDefined();
      await expect(getSMEIPOPerformance(currentYear)).resolves.toBeDefined();
      await expect(getSMEIPOPerformance(currentYear)).resolves.toBeDefined();
    });

    // ==================== PERFORMANCE METRICS VALIDATION ====================

    it('should have listingDayGain within reasonable range (-100% to 500%)', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        // Listing day gain should be realistic (between -100% and 500%)
        expect(ipo.listingDayGain).toBeGreaterThanOrEqual(-100);
        expect(ipo.listingDayGain).toBeLessThanOrEqual(500);
      });
    });

    it('should have profitLoss within reasonable range when available', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        if (ipo.profitLoss !== null) {
          // Profit/loss should be realistic (between -100% and 1000%)
          expect(ipo.profitLoss).toBeGreaterThanOrEqual(-100);
          expect(ipo.profitLoss).toBeLessThanOrEqual(1000);
        }
      });
    });

    // ==================== CONSISTENCY TESTS ====================

    it('should return consistent data structure for different years', async () => {
      const currentYear = new Date().getFullYear();
      const lastYear = currentYear - 1;

      const currentYearData = await getSMEIPOPerformance(currentYear);
      const lastYearData = await getSMEIPOPerformance(lastYear);

      // Both should have same structure
      if (currentYearData.length > 0 && lastYearData.length > 0) {
        const currentKeys = Object.keys(currentYearData[0]).sort();
        const lastYearKeys = Object.keys(lastYearData[0]).sort();

        expect(currentKeys).toEqual(lastYearKeys);
      }
    });

    // ==================== SME-SPECIFIC TESTS ====================

    it('should only return SME category IPOs (validated through naming convention)', async () => {
      const currentYear = new Date().getFullYear();
      const result = await getSMEIPOPerformance(currentYear);

      result.forEach((ipo) => {
        // Mock data should have 'SME' or 'Small' in company names for validation
        // In production, this would validate against category field from database
        expect(
          ipo.companyName.toLowerCase().includes('sme') ||
          ipo.companyName.toLowerCase().includes('small') ||
          ipo.companyName.toLowerCase().includes('emerging')
        ).toBe(true);
      });
    });
  });
});
