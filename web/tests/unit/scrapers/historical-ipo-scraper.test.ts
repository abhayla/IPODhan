/**
 * Unit Tests for Historical IPO Scraper
 * Story 7.10: Historical IPO Data Scraper Implementation
 *
 * Tests:
 * - Company name normalization
 * - Fuzzy matching with various scenarios
 * - Data parsing (subscription, GMP, percentages)
 * - Zod validation
 * - Year determination logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoricalIPOScraper } from '@/lib/scrapers/sources/historical-ipo-scraper';

describe('HistoricalIPOScraper', () => {
  let scraper: HistoricalIPOScraper;

  beforeEach(() => {
    scraper = new HistoricalIPOScraper();
  });

  // ==================== COMPANY NAME NORMALIZATION TESTS ====================

  describe('normalizeCompanyName', () => {
    it('should normalize "Tech Corp Limited" to "tech"', () => {
      const normalized = (scraper as any).normalizeCompanyName('Tech Corp Limited');
      expect(normalized).toBe('tech');
    });

    it('should normalize "ABC Pvt. Ltd." to "abc"', () => {
      const normalized = (scraper as any).normalizeCompanyName('ABC Pvt. Ltd.');
      expect(normalized).toBe('abc');
    });

    it('should normalize "XYZ Industries Inc" to "xyz industries"', () => {
      const normalized = (scraper as any).normalizeCompanyName('XYZ Industries Inc');
      expect(normalized).toBe('xyz industries');
    });

    it('should remove special characters', () => {
      const normalized = (scraper as any).normalizeCompanyName('Tech-Corp (India) Pvt. Ltd.');
      expect(normalized).toBe('techcorp india');
    });

    it('should normalize multiple spaces', () => {
      const normalized = (scraper as any).normalizeCompanyName('Tech   Corp    Limited');
      expect(normalized).toBe('tech');
    });
  });

  // ==================== FUZZY MATCHING TESTS ====================

  describe('calculateSimilarity', () => {
    it('should return 100 for identical names', () => {
      const score = (scraper as any).calculateSimilarity('Tech Corp Limited', 'Tech Corp Limited');
      expect(score).toBe(100);
    });

    it('should match "Tech Corp Limited" and "Tech Corp Ltd" with high score', () => {
      const score = (scraper as any).calculateSimilarity('Tech Corp Limited', 'Tech Corp Ltd');
      expect(score).toBeGreaterThanOrEqual(85);
    });

    it('should match "Tech Corporation" and "Tech Corp" with high score', () => {
      const score = (scraper as any).calculateSimilarity('Tech Corporation', 'Tech Corp');
      expect(score).toBeGreaterThanOrEqual(85);
    });

    it('should not match "ABC Industries" and "XYZ Industries"', () => {
      const score = (scraper as any).calculateSimilarity('ABC Industries', 'XYZ Industries');
      expect(score).toBeLessThan(85);
    });

    it('should return 0 for empty strings', () => {
      const score = (scraper as any).calculateSimilarity('', 'Tech Corp');
      expect(score).toBe(0);
    });

    it('should match case-insensitively', () => {
      const score = (scraper as any).calculateSimilarity('TECH CORP LIMITED', 'tech corp limited');
      expect(score).toBe(100);
    });
  });

  // ==================== DATA PARSING TESTS ====================

  describe('parseNumber', () => {
    it('should parse "150" to 150', () => {
      const num = (scraper as any).parseNumber('150');
      expect(num).toBe(150);
    });

    it('should parse "₹150" to 150', () => {
      const num = (scraper as any).parseNumber('₹150');
      expect(num).toBe(150);
    });

    it('should parse "Rs.1,500.50" to 1500.50', () => {
      const num = (scraper as any).parseNumber('Rs.1,500.50');
      expect(num).toBe(1500.50);
    });

    it('should return null for "—"', () => {
      const num = (scraper as any).parseNumber('—');
      expect(num).toBeNull();
    });

    it('should return null for "-"', () => {
      const num = (scraper as any).parseNumber('-');
      expect(num).toBeNull();
    });

    it('should return null for "Not Listed"', () => {
      const num = (scraper as any).parseNumber('Not Listed');
      expect(num).toBeNull();
    });

    it('should return null for empty string', () => {
      const num = (scraper as any).parseNumber('');
      expect(num).toBeNull();
    });
  });

  describe('parseSubscription', () => {
    it('should parse "5.2x" to 5.2', () => {
      const num = (scraper as any).parseSubscription('5.2x');
      expect(num).toBe(5.2);
    });

    it('should parse "15X" to 15', () => {
      const num = (scraper as any).parseSubscription('15X');
      expect(num).toBe(15);
    });

    it('should parse "0.5x" to 0.5', () => {
      const num = (scraper as any).parseSubscription('0.5x');
      expect(num).toBe(0.5);
    });

    it('should return null for "—"', () => {
      const num = (scraper as any).parseSubscription('—');
      expect(num).toBeNull();
    });

    it('should return null for "-"', () => {
      const num = (scraper as any).parseSubscription('-');
      expect(num).toBeNull();
    });
  });

  describe('parsePercentage', () => {
    it('should parse "25%" to 25', () => {
      const num = (scraper as any).parsePercentage('25%');
      expect(num).toBe(25);
    });

    it('should parse "150.5%" to 150.5', () => {
      const num = (scraper as any).parsePercentage('150.5%');
      expect(num).toBe(150.5);
    });

    it('should parse "-10%" to -10', () => {
      const num = (scraper as any).parsePercentage('-10%');
      expect(num).toBe(-10);
    });

    it('should return null for "—"', () => {
      const num = (scraper as any).parsePercentage('—');
      expect(num).toBeNull();
    });
  });

  describe('parseDate', () => {
    it('should parse valid date string', () => {
      const date = (scraper as any).parseDate('2024-01-15');
      expect(date).toBeInstanceOf(Date);
      expect(date?.getFullYear()).toBe(2024);
    });

    it('should return null for "—"', () => {
      const date = (scraper as any).parseDate('—');
      expect(date).toBeNull();
    });

    it('should return null for "-"', () => {
      const date = (scraper as any).parseDate('-');
      expect(date).toBeNull();
    });

    it('should return null for empty string', () => {
      const date = (scraper as any).parseDate('');
      expect(date).toBeNull();
    });

    it('should return null for invalid date', () => {
      const date = (scraper as any).parseDate('invalid-date');
      expect(date).toBeNull();
    });
  });

  // ==================== YEAR DETERMINATION TESTS ====================

  describe('determineYearsToScrape', () => {
    it('should return provided years when specified', () => {
      const years = (scraper as any).determineYearsToScrape({ years: [2023, 2024] });
      expect(years).toEqual([2023, 2024]);
    });

    it('should return current and previous year for incremental update', () => {
      const currentYear = new Date().getFullYear();
      const years = (scraper as any).determineYearsToScrape({ incrementalUpdate: true });
      expect(years).toEqual([currentYear, currentYear - 1]);
    });

    it('should return years from 2020 to current for default (full scrape)', () => {
      const currentYear = new Date().getFullYear();
      const years = (scraper as any).determineYearsToScrape({});

      expect(years[0]).toBe(2020);
      expect(years[years.length - 1]).toBe(currentYear);
      expect(years.length).toBe(currentYear - 2020 + 1);
    });
  });

  // ==================== BATCH PROCESSING TEST ====================

  describe('batchProcess', () => {
    it('should process items in batches', async () => {
      const items = Array.from({ length: 125 }, (_, i) => i);
      const batches: number[][] = [];

      await (scraper as any).batchProcess(items, 50, async (batch: number[]) => {
        batches.push(batch);
      });

      expect(batches.length).toBe(3); // 50 + 50 + 25
      expect(batches[0].length).toBe(50);
      expect(batches[1].length).toBe(50);
      expect(batches[2].length).toBe(25);
    });

    it('should handle single batch', async () => {
      const items = Array.from({ length: 30 }, (_, i) => i);
      const batches: number[][] = [];

      await (scraper as any).batchProcess(items, 50, async (batch: number[]) => {
        batches.push(batch);
      });

      expect(batches.length).toBe(1);
      expect(batches[0].length).toBe(30);
    });

    it('should handle empty array', async () => {
      const items: number[] = [];
      const batches: number[][] = [];

      await (scraper as any).batchProcess(items, 50, async (batch: number[]) => {
        batches.push(batch);
      });

      expect(batches.length).toBe(0);
    });
  });

  // ==================== VALIDATION TESTS ====================

  describe('validateIPOData', () => {
    it('should validate valid IPO data', () => {
      const validData = {
        ipoName: 'Tech Corp Limited',
        issuePrice: 100,
        subscriptionRetail: 5.2,
        subscriptionHni: 10.5,
        subscriptionQib: 8.3,
        subscriptionTotal: 7.5,
        gmpPrice: 50,
        gmpPercentage: 50,
        listingPrice: 150,
        listingGainPercentage: 50,
        listingGainAmount: 50,
        listingDate: new Date('2024-01-15'),
        currentPrice: 180,
        currentGainPercentage: 80,
        currentGainAmount: 80,
        openDate: new Date('2024-01-10'),
        closeDate: new Date('2024-01-12'),
      };

      const validated = (scraper as any).validateIPOData(validData);
      expect(validated).not.toBeNull();
      expect(validated?.ipoName).toBe('Tech Corp Limited');
    });

    it('should reject data with missing ipoName', () => {
      const invalidData = {
        ipoName: '',
        issuePrice: 100,
        subscriptionRetail: 5.2,
        subscriptionHni: null,
        subscriptionQib: null,
        subscriptionTotal: null,
        gmpPrice: null,
        gmpPercentage: null,
        listingPrice: null,
        listingGainPercentage: null,
        listingGainAmount: null,
        listingDate: null,
        currentPrice: null,
        currentGainPercentage: null,
        currentGainAmount: null,
        openDate: null,
        closeDate: null,
      };

      const validated = (scraper as any).validateIPOData(invalidData);
      expect(validated).toBeNull();
    });

    it('should accept data with null optional fields', () => {
      const validData = {
        ipoName: 'Tech Corp Limited',
        issuePrice: 100,
        subscriptionRetail: null,
        subscriptionHni: null,
        subscriptionQib: null,
        subscriptionTotal: null,
        gmpPrice: null,
        gmpPercentage: null,
        listingPrice: null,
        listingGainPercentage: null,
        listingGainAmount: null,
        listingDate: null,
        currentPrice: null,
        currentGainPercentage: null,
        currentGainAmount: null,
        openDate: null,
        closeDate: null,
      };

      const validated = (scraper as any).validateIPOData(validData);
      expect(validated).not.toBeNull();
      expect(validated?.ipoName).toBe('Tech Corp Limited');
    });

    it('should reject negative subscription values', () => {
      const invalidData = {
        ipoName: 'Tech Corp Limited',
        issuePrice: 100,
        subscriptionRetail: -5.2, // Invalid: negative
        subscriptionHni: null,
        subscriptionQib: null,
        subscriptionTotal: null,
        gmpPrice: null,
        gmpPercentage: null,
        listingPrice: null,
        listingGainPercentage: null,
        listingGainAmount: null,
        listingDate: null,
        currentPrice: null,
        currentGainPercentage: null,
        currentGainAmount: null,
        openDate: null,
        closeDate: null,
      };

      const validated = (scraper as any).validateIPOData(invalidData);
      expect(validated).toBeNull();
    });
  });

  // ==================== SLEEP UTILITY TEST ====================

  describe('sleep', () => {
    it('should delay execution for specified milliseconds', async () => {
      // Fake timers instead of a real-time stopwatch: a wall-clock upper
      // bound measures OS scheduler jitter on the CI runner, not the code
      // under test, and is unfixable by widening the tolerance.
      vi.useFakeTimers();
      try {
        let resolved = false;
        (scraper as any).sleep(100).then(() => {
          resolved = true;
        });

        // Flush pending microtasks without advancing the clock: a broken
        // sleep() that resolves immediately would already be resolved here.
        await vi.advanceTimersByTimeAsync(0);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(99);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        expect(resolved).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
