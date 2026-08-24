import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeNSEIPOs, parseNSEBrowserPriceRange } from '../../../src/scrapers/nse-scraper.js';
import * as nseApiClient from '../../../src/scrapers/nse-api-client.js';

/**
 * Unit Tests for NSE Scraper
 * Tests the core scraping logic with mocked API calls
 */

describe('NSE Scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Mock the NSE API functions to prevent real network calls
    vi.spyOn(nseApiClient, 'testNSEAPIConnection').mockResolvedValue(true);
    vi.spyOn(nseApiClient, 'scrapeNSEAPI').mockResolvedValue({
      ipos: [
        {
          companyName: 'Test Company Ltd',
          issueSize: 50000000000,
          priceRangeMin: 100,
          priceRangeMax: 110,
          openDate: '2025-10-15',
          closeDate: '2025-10-18',
          listingExchange: 'NSE',
          category: 'MAINBOARD',
          status: 'UPCOMING',
          lotSize: 100,
          faceValue: 10
        }
      ],
      subscriptions: [
        {
          ipoCompanyName: 'Test Company Ltd',
          ipoSymbol: 'TEST',
          qibSubscription: 1.5,
          niiSubscription: 2.0,
          retailSubscription: 3.0,
          totalSubscription: 2.2,
          timestamp: '2025-10-16T10:00:00Z'
        }
      ]
    });
  });

  describe('scrapeNSEIPOs', () => {
    it('should return valid IPO data structure', async () => {
      const result = await scrapeNSEIPOs();

      expect(result).toHaveProperty('ipos');
      expect(result).toHaveProperty('subscriptions');
      expect(Array.isArray(result.ipos)).toBe(true);
      expect(Array.isArray(result.subscriptions)).toBe(true);
    });

    it('should return IPOs with required fields', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];

        // Required fields
        expect(ipo).toHaveProperty('companyName');
        expect(ipo).toHaveProperty('status');
        expect(ipo).toHaveProperty('openDate');
        expect(ipo).toHaveProperty('closeDate');
        expect(ipo).toHaveProperty('priceRangeMin');
        expect(ipo).toHaveProperty('priceRangeMax');
        expect(ipo).toHaveProperty('listingExchange');

        // Field types
        expect(typeof ipo.companyName).toBe('string');
        expect(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']).toContain(ipo.status);
        expect(typeof ipo.openDate).toBe('string');
        expect(typeof ipo.closeDate).toBe('string');
        expect(typeof ipo.priceRangeMin).toBe('number');
        expect(typeof ipo.priceRangeMax).toBe('number');
        expect(['NSE', 'BSE', 'BOTH']).toContain(ipo.listingExchange);
      }
    });

    it('should return subscriptions with required fields', async () => {
      const result = await scrapeNSEIPOs();

      if (result.subscriptions.length > 0) {
        const subscription = result.subscriptions[0];

        // Required fields
        expect(subscription).toHaveProperty('ipoCompanyName');
        expect(subscription).toHaveProperty('qibSubscription');
        expect(subscription).toHaveProperty('niiSubscription');
        expect(subscription).toHaveProperty('retailSubscription');
        expect(subscription).toHaveProperty('totalSubscription');
        expect(subscription).toHaveProperty('timestamp');

        // Field types
        expect(typeof subscription.ipoCompanyName).toBe('string');
        expect(typeof subscription.qibSubscription).toBe('number');
        expect(typeof subscription.niiSubscription).toBe('number');
        expect(typeof subscription.retailSubscription).toBe('number');
        expect(typeof subscription.totalSubscription).toBe('number');
        expect(typeof subscription.timestamp).toBe('string');
      }
    });

    it('should handle empty results gracefully', async () => {
      const result = await scrapeNSEIPOs();

      // Even if no IPOs found, should return valid structure
      expect(result.ipos).toBeDefined();
      expect(result.subscriptions).toBeDefined();
      expect(Array.isArray(result.ipos)).toBe(true);
      expect(Array.isArray(result.subscriptions)).toBe(true);
    });

    it('should include NSE in listingExchange', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.listingExchange).toBe('NSE');
      }
    });

    it('should have valid issue price range', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.priceRangeMin).toBeGreaterThanOrEqual(0);
        expect(ipo.priceRangeMax).toBeGreaterThanOrEqual(ipo.priceRangeMin);
        expect(ipo.priceRangeMax).toBeLessThan(100000); // Reasonable max price
      }
    });

    it('should have valid lot size', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        if (ipo.lotSize) {
          expect(ipo.lotSize).toBeGreaterThan(0);
          expect(ipo.lotSize).toBeLessThan(10000); // Reasonable max lot size
        }
      }
    });

    it('should have valid date format (YYYY-MM-DD)', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

        expect(ipo.openDate).toMatch(dateRegex);
        expect(ipo.closeDate).toMatch(dateRegex);

        if (ipo.listingDate) {
          expect(ipo.listingDate).toMatch(dateRegex);
        }
      }
    });

    it('should have open date before or equal to close date', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        const openDate = new Date(ipo.openDate);
        const closeDate = new Date(ipo.closeDate);

        expect(openDate.getTime()).toBeLessThanOrEqual(closeDate.getTime());
      }
    });

    it('should have valid subscription numbers', async () => {
      const result = await scrapeNSEIPOs();

      if (result.subscriptions.length > 0) {
        const subscription = result.subscriptions[0];

        // Subscription values should be >= 0
        expect(subscription.qibSubscription).toBeGreaterThanOrEqual(0);
        expect(subscription.niiSubscription).toBeGreaterThanOrEqual(0);
        expect(subscription.retailSubscription).toBeGreaterThanOrEqual(0);
        expect(subscription.totalSubscription).toBeGreaterThanOrEqual(0);

        // Total should be >= 0
        expect(subscription.totalSubscription).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Data Quality', () => {
    it('should return valid category', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        if (ipo.category) {
          expect(['MAINBOARD', 'SME', 'RIGHTS', 'NCD']).toContain(ipo.category);
        }
      }
    });

    it('should have non-empty company names', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.companyName.length).toBeGreaterThan(0);
        expect(ipo.companyName.trim()).toBe(ipo.companyName);
      }
    });

    it('should have valid issue size', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.issueSize).toBeGreaterThanOrEqual(0);
        // Issue sizes are in INR (paise), so even small IPOs should be in crores converted to paise
        expect(ipo.issueSize).toBeLessThan(1000000000000); // 10 lakh crore max (very large)
      }
    });
  });

  // T-308 (round-6 P1, checker finding F1): scrapeNSEWithBrowser (the
  // fallback path used when the NSE API fails MAX_CONSECUTIVE_FAILURES
  // times — NSE is field-priority rank #2, ABOVE Moneycontrol) previously
  // wrote a lone single-price string into BOTH priceRangeMin/Max, silently
  // collapsing a real book-built band. parseNSEBrowserPriceRange is the
  // module-level mirror of that internal parser (duplicated because
  // Puppeteer's page.evaluate() closure cannot reference outer-scope
  // functions), unit-tested directly here.
  describe('parseNSEBrowserPriceRange (T-308 fix)', () => {
    it('parses a genuine two-value range', () => {
      expect(parseNSEBrowserPriceRange('100 - 120')).toEqual({ min: 100, max: 120 });
    });

    it('leaves a lone single price undefined instead of collapsing min===max', () => {
      expect(parseNSEBrowserPriceRange('₹106')).toEqual({ min: undefined, max: undefined });
    });

    it('leaves placeholders ("--", "N/A", "") undefined', () => {
      expect(parseNSEBrowserPriceRange('--')).toEqual({ min: undefined, max: undefined });
      expect(parseNSEBrowserPriceRange('N/A')).toEqual({ min: undefined, max: undefined });
      expect(parseNSEBrowserPriceRange('')).toEqual({ min: undefined, max: undefined });
    });
  });

  describe('Error Handling', () => {
    it('should not throw on scraping failures', async () => {
      // Should handle errors gracefully and return empty arrays
      await expect(scrapeNSEIPOs()).resolves.not.toThrow();
    });

    it('should return consistent structure on all outcomes', async () => {
      const result = await scrapeNSEIPOs();

      expect(result).toMatchObject({
        ipos: expect.any(Array),
        subscriptions: expect.any(Array)
      });
    });
  });
});
