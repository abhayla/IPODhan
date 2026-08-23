/**
 * Unit tests for moneycontrol-scraper.ts
 *
 * The scraper was rewritten 2025-10-17 for Moneycontrol's new React/Next.js
 * IPO page (see the header comment in src/scrapers/moneycontrol-scraper.ts):
 * it now drives a real Puppeteer browser and extracts data via
 * `page.evaluate()` instead of fetching static HTML and parsing it with
 * Cheerio. The old Cheerio-based mocks in this file (`vi.spyOn(scraperUtils,
 * 'retryWithExponentialBackoff').mockResolvedValue(cheerio.load(...))`) mock
 * a function the current source no longer calls at all, so every test fell
 * through to the REAL Puppeteer path and hit the live moneycontrol.com site
 * - explaining both the wrong assertions (comparing live scraped data
 * against fixture expectations) and the 5s test timeouts (repeated real
 * page loads).
 *
 * These tests instead mock `../../../src/utils/browser.js` (launchBrowser /
 * createPage / closeBrowser / navigateToUrl) and stub `page.evaluate()` to
 * resolve the extracted-row shape directly, bypassing the real DOM
 * extraction closure (which only ever runs inside an actual browser and is
 * not independently unit-testable). `rating` extraction was dropped in the
 * rewrite (no `rating` field is set anywhere in moneycontrol-scraper.ts
 * anymore) - the two rating-specific tests from the old suite are removed,
 * not rewritten.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMoneycontrolIPOs } from '../../../src/scrapers/moneycontrol-scraper.js';
import * as browser from '../../../src/utils/browser.js';

/** Shape of one row produced by the in-browser page.evaluate() extraction. */
function rawIpo(overrides: Record<string, any> = {}) {
  return {
    companyName: 'ABC Company Limited',
    companyUrl: '/company/abc',
    category: 'MAINBOARD',
    tableType: 'CLOSED',
    issuePrice: '₹250',
    qibSubscription: '3.1x',
    niiSubscription: '2.0x',
    retailSubscription: '1.5x',
    totalSubscription: '2.5x',
    allotmentDate: '15 Oct 25',
    listingDate: '17 Oct 25',
    status: 'CLOSED',
    issueSize: '₹1000 Cr',
    ...overrides,
  };
}

/**
 * Mock the Puppeteer browser utilities so scrapeMoneycontrolIPOs() runs its
 * real transform logic against `rows` without touching a real browser.
 */
function mockBrowserExtraction(rows: any[]) {
  const page = {
    waitForSelector: vi.fn().mockResolvedValue(undefined),
    $$: vi.fn().mockResolvedValue([]), // no "Show More" buttons
    evaluate: vi.fn().mockResolvedValue(rows),
  };
  vi.spyOn(browser, 'launchBrowser').mockResolvedValue({} as any);
  vi.spyOn(browser, 'createPage').mockResolvedValue(page as any);
  vi.spyOn(browser, 'navigateToUrl').mockResolvedValue(undefined);
  vi.spyOn(browser, 'closeBrowser').mockResolvedValue(undefined);
  return page;
}

describe('moneycontrol-scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scrapeMoneycontrolIPOs', () => {
    it('should successfully parse IPO data from a mock extraction', async () => {
      mockBrowserExtraction([rawIpo()]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('ABC Company Limited');
      expect(result.ipos[0].issueSize).toBe(10000000000); // 1000 Cr
      // Current extraction only yields a single issue price (no min/max
      // range), so both bounds equal it - see priceRangeMin/Max assignment
      // in moneycontrol-scraper.ts.
      expect(result.ipos[0].priceRangeMin).toBe(250);
      expect(result.ipos[0].priceRangeMax).toBe(250);
      expect(result.ipos[0].segment).toBe('MAINBOARD');
      expect(result.ipos[0].offeringType).toBe('IPO');
      expect(result.ipos[0].totalSubscription).toBe(2.5);
      expect(result.ipos[0].dataSource).toBe('MONEYCONTROL');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle an empty extraction result', async () => {
      mockBrowserExtraction([]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should extract listing gains when present', async () => {
      mockBrowserExtraction([
        rawIpo({ tableType: 'LISTED', status: 'LISTED', listingGain: '+15.5%' }),
      ]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].listingGains).toBe(15.5);
    });

    it('should preserve an OPEN status from the extraction', async () => {
      mockBrowserExtraction([rawIpo({ status: 'OPEN' })]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('OPEN');
    });

    it('should preserve an UPCOMING status from the extraction', async () => {
      mockBrowserExtraction([rawIpo({ tableType: 'DRAFT', status: 'UPCOMING' })]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('UPCOMING');
    });

    it('should default to zero/undefined fields when a row carries no data for them', async () => {
      mockBrowserExtraction([
        {
          companyName: 'Minimal Row Ltd',
          companyUrl: '/company/minimal',
          category: 'MAINBOARD',
          tableType: 'DRAFT',
          status: 'UPCOMING',
        },
      ]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Minimal Row Ltd');
      expect(result.ipos[0].issueSize).toBe(0);
      expect(result.ipos[0].priceRangeMin).toBe(0);
      expect(result.ipos[0].priceRangeMax).toBe(0);
      expect(result.ipos[0].totalSubscription).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should identify SME segment when the category cell says SME', async () => {
      mockBrowserExtraction([rawIpo({ category: 'SME' })]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].segment).toBe('SME');
    });

    it('should handle scraping errors gracefully', async () => {
      vi.spyOn(browser, 'launchBrowser').mockRejectedValue(new Error('Network error'));

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('Scraper error: Network error');
    });

    it('should skip a row that throws while parsing but keep the others', async () => {
      mockBrowserExtraction([
        rawIpo({ companyName: 'Valid Company' }),
        // A non-string companyName makes sanitizeText() throw
        // (String.prototype.replace on a number), exercising the
        // per-row try/catch in the transform loop.
        rawIpo({ companyName: 12345 as any }),
      ]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Valid Company');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should handle an unparseable price with a zero fallback', async () => {
      mockBrowserExtraction([rawIpo({ issuePrice: 'N/A' })]);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].priceRangeMin).toBe(0);
      expect(result.ipos[0].priceRangeMax).toBe(0);
    });
  });
});
