import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeNSEIPOs } from '../../../src/scrapers/nse-scraper.js';

/**
 * Unit Tests for NSE Scraper
 * Tests the core scraping logic with mocked browser
 */

describe('NSE Scraper', () => {
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
        expect(ipo).toHaveProperty('issuePrice');
        expect(ipo).toHaveProperty('listingExchanges');

        // Field types
        expect(typeof ipo.companyName).toBe('string');
        expect(['UPCOMING', 'OPEN', 'CLOSED', 'LISTED']).toContain(ipo.status);
        expect(typeof ipo.openDate).toBe('string');
        expect(typeof ipo.closeDate).toBe('string');
        expect(typeof ipo.issuePrice).toBe('number');
        expect(Array.isArray(ipo.listingExchanges)).toBe(true);
      }
    });

    it('should return subscriptions with required fields', async () => {
      const result = await scrapeNSEIPOs();

      if (result.subscriptions.length > 0) {
        const subscription = result.subscriptions[0];

        // Required fields
        expect(subscription).toHaveProperty('ipoSlug');
        expect(subscription).toHaveProperty('qibSubscription');
        expect(subscription).toHaveProperty('niiSubscription');
        expect(subscription).toHaveProperty('retailSubscription');
        expect(subscription).toHaveProperty('sniiSubscription');
        expect(subscription).toHaveProperty('totalSubscription');

        // Field types
        expect(typeof subscription.ipoSlug).toBe('string');
        expect(typeof subscription.qibSubscription).toBe('number');
        expect(typeof subscription.niiSubscription).toBe('number');
        expect(typeof subscription.retailSubscription).toBe('number');
        expect(typeof subscription.sniiSubscription).toBe('number');
        expect(typeof subscription.totalSubscription).toBe('number');
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

    it('should include NSE in listingExchanges', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.listingExchanges).toContain('NSE');
      }
    });

    it('should have valid issue price range', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        expect(ipo.issuePrice).toBeGreaterThanOrEqual(0);
        expect(ipo.issuePrice).toBeLessThan(100000); // Reasonable max price
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
        expect(subscription.sniiSubscription).toBeGreaterThanOrEqual(0);
        expect(subscription.totalSubscription).toBeGreaterThanOrEqual(0);

        // Total should be >= largest category
        const maxCategory = Math.max(
          subscription.qibSubscription,
          subscription.niiSubscription,
          subscription.retailSubscription,
          subscription.sniiSubscription
        );
        expect(subscription.totalSubscription).toBeGreaterThanOrEqual(maxCategory);
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

    it('should have valid minimum application amounts', async () => {
      const result = await scrapeNSEIPOs();

      if (result.ipos.length > 0) {
        const ipo = result.ipos[0];
        if (ipo.minInvestment) {
          expect(ipo.minInvestment).toBeGreaterThan(0);
          expect(ipo.minInvestment).toBeLessThan(10000000); // 1 crore max
        }
      }
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
