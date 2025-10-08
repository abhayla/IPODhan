import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * BSE Scraper Integration Tests
 * Tests the full BSE scraper workflow including:
 * - SME IPO processing with correct category tagging
 * - Data discrepancy handling between NSE and BSE
 * - Dual-listed IPO merge logic
 */

// Mock dependencies
vi.mock('../../src/utils/browser.js', () => ({
  launchBrowser: vi.fn(),
  createPage: vi.fn(),
  closeBrowser: vi.fn(),
  navigateToUrl: vi.fn(),
  waitForSelector: vi.fn()
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../src/config.js', () => ({
  config: {
    scraper: {
      bseUrl: 'https://www.bseindia.com/publicissue.html',
      timeout: 30000,
      retryAttempts: 3,
      retryDelays: [1000, 2000, 4000]
    }
  }
}));

describe('BSE Scraper Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SME IPO Workflow', () => {
    it('should process SME IPO with correct category tagging', async () => {
      // Mock browser and page
      const { launchBrowser, createPage, navigateToUrl, waitForSelector, closeBrowser } = await import('../../src/utils/browser.js');
      const mockBrowser = {};
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          ipos: [
            {
              companyName: 'Test SME Company Ltd',
              platform: 'SME',
              startDate: '08-10-2025',
              endDate: '10-10-2025',
              offerPrice: '100 - 120',
              faceValue: '10',
              typeOfIssue: 'IPO',
              issueStatus: 'OPEN',
              category: 'SME'
            }
          ],
          subscriptions: [],
          smeCount: 1,
          mainboardCount: 0
        })
      };

      vi.mocked(launchBrowser).mockResolvedValue(mockBrowser as any);
      vi.mocked(createPage).mockResolvedValue(mockPage as any);
      vi.mocked(navigateToUrl).mockResolvedValue(undefined);
      vi.mocked(waitForSelector).mockResolvedValue(undefined);
      vi.mocked(closeBrowser).mockResolvedValue(undefined);

      // Import and run scraper
      const { scrapeBSEIPOs } = await import('../../src/scrapers/bse-scraper.js');
      const result = await scrapeBSEIPOs();

      // Verify SME category is correctly tagged
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].category).toBe('SME');
      expect(result.ipos[0].listingExchange).toBe('BSE');
      expect(result.ipos[0].companyName).toBe('Test SME Company Ltd');

      // Verify SME count
      expect(result.smeCount).toBe(1);
      expect(result.mainboardCount).toBe(0);

      // Verify browser was launched and closed
      expect(launchBrowser).toHaveBeenCalledTimes(1);
      expect(closeBrowser).toHaveBeenCalledTimes(1);
    });

    it('should correctly count MAINBOARD IPOs', async () => {
      // Mock browser and page with MAINBOARD IPO
      const { launchBrowser, createPage, closeBrowser } = await import('../../src/utils/browser.js');
      const mockBrowser = {};
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          ipos: [
            {
              companyName: 'Test Mainboard Company Ltd',
              platform: 'MainBoard',
              startDate: '08-10-2025',
              endDate: '10-10-2025',
              offerPrice: '500 - 600',
              faceValue: '10',
              typeOfIssue: 'IPO',
              issueStatus: 'OPEN',
              category: 'MAINBOARD'
            }
          ],
          subscriptions: [],
          smeCount: 0,
          mainboardCount: 1
        })
      };

      vi.mocked(launchBrowser).mockResolvedValue(mockBrowser as any);
      vi.mocked(createPage).mockResolvedValue(mockPage as any);
      vi.mocked(closeBrowser).mockResolvedValue(undefined);

      // Import and run scraper
      const { scrapeBSEIPOs } = await import('../../src/scrapers/bse-scraper.js');
      const result = await scrapeBSEIPOs();

      // Verify MAINBOARD category
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].category).toBe('MAINBOARD');
      expect(result.mainboardCount).toBe(1);
      expect(result.smeCount).toBe(0);
    });

    it('should handle mixed SME and MAINBOARD IPOs', async () => {
      // Mock browser and page with both SME and MAINBOARD
      const { launchBrowser, createPage, closeBrowser } = await import('../../src/utils/browser.js');
      const mockBrowser = {};
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          ipos: [
            {
              companyName: 'SME Company',
              platform: 'SME',
              startDate: '08-10-2025',
              endDate: '10-10-2025',
              offerPrice: '100',
              faceValue: '10',
              typeOfIssue: 'IPO',
              issueStatus: 'OPEN',
              category: 'SME'
            },
            {
              companyName: 'Mainboard Company',
              platform: 'MainBoard',
              startDate: '08-10-2025',
              endDate: '10-10-2025',
              offerPrice: '500',
              faceValue: '10',
              typeOfIssue: 'IPO',
              issueStatus: 'OPEN',
              category: 'MAINBOARD'
            }
          ],
          subscriptions: [],
          smeCount: 1,
          mainboardCount: 1
        })
      };

      vi.mocked(launchBrowser).mockResolvedValue(mockBrowser as any);
      vi.mocked(createPage).mockResolvedValue(mockPage as any);
      vi.mocked(closeBrowser).mockResolvedValue(undefined);

      // Import and run scraper
      const { scrapeBSEIPOs } = await import('../../src/scrapers/bse-scraper.js');
      const result = await scrapeBSEIPOs();

      // Verify counts
      expect(result.ipos).toHaveLength(2);
      expect(result.smeCount).toBe(1);
      expect(result.mainboardCount).toBe(1);

      // Verify categories
      const smeIPO = result.ipos.find(ipo => ipo.companyName === 'SME Company');
      const mainboardIPO = result.ipos.find(ipo => ipo.companyName === 'Mainboard Company');

      expect(smeIPO?.category).toBe('SME');
      expect(mainboardIPO?.category).toBe('MAINBOARD');
    });
  });

  describe('Data Discrepancy Handling', () => {
    it('should prioritize NSE data when BSE data differs', async () => {
      // This test requires mocking the database layer
      // For MVP, we'll verify the logic through mocked repository behavior

      // Mock IPO Repository
      const mockIPORepository = {
        findBySlug: vi.fn().mockResolvedValue({
          id: 'existing-ipo-id',
          companyName: 'Dual Listed Company Ltd',
          slug: 'dual-listed-company-ltd',
          issueSize: '500', // NSE data
          listingExchanges: ['NSE']
        }),
        update: vi.fn().mockResolvedValue(undefined)
      };

      // Mock logger to verify warning is logged
      const logger = await import('../../src/utils/logger.js');

      // Simulate upsertIPO call with BSE data that differs
      const scrapedBSEIPO = {
        companyName: 'Dual Listed Company Ltd',
        issueSize: 600, // BSE data differs from NSE (500)
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-08',
        closeDate: '2025-10-10',
        listingExchange: 'BSE' as const,
        category: 'MAINBOARD' as const,
        sector: 'Technology',
        status: 'OPEN' as const,
        lotSize: 100,
        faceValue: 10
      };

      // Call upsertIPO with BSE source
      const { upsertIPO } = await import('../../src/services/data-persister.js');
      await upsertIPO(mockIPORepository as any, scrapedBSEIPO, 'BSE');

      // Verify warning was logged about discrepancy
      expect(logger.default.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          companyName: 'Dual Listed Company Ltd',
          nseIssueSize: '500',
          bseIssueSize: '600'
        }),
        expect.stringContaining('Data mismatch detected')
      );

      // Verify update was called with merged exchanges
      expect(mockIPORepository.update).toHaveBeenCalledWith(
        'existing-ipo-id',
        expect.objectContaining({
          listingExchanges: ['NSE', 'BSE']
        })
      );

      // Verify NSE data was retained (issueSize not in update)
      const updateCall = mockIPORepository.update.mock.calls[0][1];
      expect(updateCall.issueSize).toBeUndefined(); // Should not overwrite NSE data
    });

    it('should update listingExchanges to include both NSE and BSE', async () => {
      // Mock IPO Repository with existing NSE IPO
      const mockIPORepository = {
        findBySlug: vi.fn().mockResolvedValue({
          id: 'existing-ipo-id',
          companyName: 'Dual Listed Company Ltd',
          slug: 'dual-listed-company-ltd',
          issueSize: '500',
          listingExchanges: ['NSE']
        }),
        update: vi.fn().mockResolvedValue(undefined)
      };

      const scrapedBSEIPO = {
        companyName: 'Dual Listed Company Ltd',
        issueSize: 500, // Same as NSE
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-08',
        closeDate: '2025-10-10',
        listingExchange: 'BSE' as const,
        category: 'MAINBOARD' as const,
        sector: 'Technology',
        status: 'OPEN' as const,
        lotSize: 100,
        faceValue: 10
      };

      // Call upsertIPO with BSE source
      const { upsertIPO } = await import('../../src/services/data-persister.js');
      const result = await upsertIPO(mockIPORepository as any, scrapedBSEIPO, 'BSE');

      // Verify update was called with merged exchanges
      expect(mockIPORepository.update).toHaveBeenCalledWith(
        'existing-ipo-id',
        expect.objectContaining({
          listingExchanges: ['NSE', 'BSE']
        })
      );

      // Verify result is the existing IPO ID
      expect(result).toBe('existing-ipo-id');
    });

    it('should not duplicate exchange if already present', async () => {
      // Mock IPO Repository with both exchanges already present
      const mockIPORepository = {
        findBySlug: vi.fn().mockResolvedValue({
          id: 'existing-ipo-id',
          companyName: 'Dual Listed Company Ltd',
          slug: 'dual-listed-company-ltd',
          issueSize: '500',
          listingExchanges: ['NSE', 'BSE']
        }),
        update: vi.fn().mockResolvedValue(undefined)
      };

      const scrapedBSEIPO = {
        companyName: 'Dual Listed Company Ltd',
        issueSize: 500,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-08',
        closeDate: '2025-10-10',
        listingExchange: 'BSE' as const,
        category: 'MAINBOARD' as const,
        sector: 'Technology',
        status: 'OPEN' as const,
        lotSize: 100,
        faceValue: 10
      };

      // Call upsertIPO with BSE source
      const { upsertIPO } = await import('../../src/services/data-persister.js');
      await upsertIPO(mockIPORepository as any, scrapedBSEIPO, 'BSE');

      // Verify update was called with same exchanges (no duplication)
      expect(mockIPORepository.update).toHaveBeenCalledWith(
        'existing-ipo-id',
        expect.objectContaining({
          listingExchanges: ['NSE', 'BSE']
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle empty IPO table gracefully', async () => {
      // Mock browser returning no IPOs
      const { launchBrowser, createPage, closeBrowser } = await import('../../src/utils/browser.js');
      const mockBrowser = {};
      const mockPage = {
        evaluate: vi.fn().mockResolvedValue({
          ipos: [],
          subscriptions: [],
          smeCount: 0,
          mainboardCount: 0
        })
      };

      vi.mocked(launchBrowser).mockResolvedValue(mockBrowser as any);
      vi.mocked(createPage).mockResolvedValue(mockPage as any);
      vi.mocked(closeBrowser).mockResolvedValue(undefined);

      // Import and run scraper
      const { scrapeBSEIPOs } = await import('../../src/scrapers/bse-scraper.js');
      const result = await scrapeBSEIPOs();

      // Verify empty result is handled
      expect(result.ipos).toHaveLength(0);
      expect(result.smeCount).toBe(0);
      expect(result.mainboardCount).toBe(0);

      // Verify no errors thrown
      expect(closeBrowser).toHaveBeenCalledTimes(1);
    });

    it('should close browser on scraper error', async () => {
      // Mock browser throwing error
      const { launchBrowser, createPage, closeBrowser } = await import('../../src/utils/browser.js');
      const mockBrowser = {};
      const mockPage = {
        evaluate: vi.fn().mockRejectedValue(new Error('Page evaluation failed'))
      };

      vi.mocked(launchBrowser).mockResolvedValue(mockBrowser as any);
      vi.mocked(createPage).mockResolvedValue(mockPage as any);
      vi.mocked(closeBrowser).mockResolvedValue(undefined);

      // Import and run scraper
      const { scrapeBSEIPOs } = await import('../../src/scrapers/bse-scraper.js');

      // Verify error is thrown
      await expect(scrapeBSEIPOs()).rejects.toThrow('Page evaluation failed');

      // Verify browser was still closed
      expect(closeBrowser).toHaveBeenCalledTimes(1);
    });
  });
});
