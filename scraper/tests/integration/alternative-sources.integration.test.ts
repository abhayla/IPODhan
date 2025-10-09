/**
 * Integration tests for alternative data sources (Moneycontrol & Chittorgarh)
 * Tests: Full workflow, data merging, deduplication, orchestrators
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMoneycontrolIPOs } from '../../src/scrapers/moneycontrol-scraper.js';
import { scrapeChittorgarhIPOs } from '../../src/scrapers/chittorgarh-scraper.js';
import { deduplicateIPOs, mergeIPOData, type IPOWithSources } from '../../src/services/data-merger.js';
import type { ScrapedIPO, MoneycontrolIPO, ChittorgarhIPO } from '../../src/utils/validators.js';

describe('alternative-sources-integration', () => {
  describe('Full workflow with mock data', () => {
    it('should merge data from NSE, Moneycontrol, and Chittorgarh', () => {
      // Simulate data from different sources for the same IPO
      const nseIPO: ScrapedIPO = {
        companyName: 'ABC Technologies Limited',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        sector: 'Technology',
        lotSize: 50
      };

      const moneycontrolIPO: MoneycontrolIPO = {
        companyName: 'ABC Technologies Ltd',
        issueSize: 1050000000, // Slightly different
        priceRangeMin: 255, // Slightly different
        priceRangeMax: 265,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'BOTH',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'MONEYCONTROL',
        rating: 4.5,
        listingGains: 15.5
      };

      const chittorgarhIPO: ChittorgarhIPO = {
        companyName: 'ABC Technologies',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'BOTH',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'CHITTORGARH',
        gmp: 50,
        gmpPercentage: 19.23,
        gmpUpdatedAt: '2025-10-09T10:00:00Z'
      };

      // Merge all three sources
      const ipos = [
        { data: nseIPO, source: 'NSE' as const },
        { data: moneycontrolIPO, source: 'MONEYCONTROL' as const },
        { data: chittorgarhIPO, source: 'CHITTORGARH' as const }
      ];

      const merged = deduplicateIPOs(ipos);

      // Should have 1 merged IPO
      expect(merged).toHaveLength(1);

      const mergedIPO = merged[0];

      // NSE data should be preserved (highest priority)
      expect(mergedIPO.companyName).toBe('ABC Technologies Limited');
      expect(mergedIPO.issueSize).toBe(1000000000);
      expect(mergedIPO.priceRangeMin).toBe(250);

      // Supplementary data from Moneycontrol
      expect(mergedIPO.rating).toBe(4.5);
      expect(mergedIPO.listingGains).toBe(15.5);

      // GMP data from Chittorgarh
      expect(mergedIPO.gmp).toBe(50);
      expect(mergedIPO.gmpPercentage).toBe(19.23);

      // All sources tracked
      expect(mergedIPO.dataSources).toContain('NSE');
      expect(mergedIPO.dataSources).toContain('MONEYCONTROL');
      expect(mergedIPO.dataSources).toContain('CHITTORGARH');
    });

    it('should handle multiple distinct IPOs from different sources', () => {
      const nseIPO: ScrapedIPO = {
        companyName: 'TechCorp Limited',
        issueSize: 500000000,
        priceRangeMin: 100,
        priceRangeMax: 110,
        openDate: '2025-11-01',
        closeDate: '2025-11-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const bseIPO: ScrapedIPO = {
        companyName: 'FinanceCorp Ltd',
        issueSize: 200000000,
        priceRangeMin: 50,
        priceRangeMax: 55,
        openDate: '2025-11-05',
        closeDate: '2025-11-07',
        listingExchange: 'BSE',
        category: 'SME',
        status: 'UPCOMING'
      };

      const moneycontrolIPO: MoneycontrolIPO = {
        companyName: 'TechCorp Limited',
        issueSize: 500000000,
        priceRangeMin: 100,
        priceRangeMax: 110,
        openDate: '2025-11-01',
        closeDate: '2025-11-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'MONEYCONTROL',
        rating: 4.0
      };

      const ipos = [
        { data: nseIPO, source: 'NSE' as const },
        { data: bseIPO, source: 'BSE' as const },
        { data: moneycontrolIPO, source: 'MONEYCONTROL' as const }
      ];

      const merged = deduplicateIPOs(ipos);

      // Should have 2 distinct IPOs
      expect(merged).toHaveLength(2);

      // TechCorp merged with Moneycontrol data
      const techCorp = merged.find(ipo => ipo.companyName.includes('TechCorp'));
      expect(techCorp).toBeDefined();
      expect(techCorp!.dataSources).toContain('NSE');
      expect(techCorp!.dataSources).toContain('MONEYCONTROL');
      expect(techCorp!.rating).toBe(4.0);

      // FinanceCorp separate
      const financeCorp = merged.find(ipo => ipo.companyName.includes('FinanceCorp'));
      expect(financeCorp).toBeDefined();
      expect(financeCorp!.dataSources).toEqual(['BSE']);
    });

    it('should prioritize NSE over Moneycontrol for core data', () => {
      const nseIPO: ScrapedIPO = {
        companyName: 'Reliance Industries Limited',
        issueSize: 2000000000,
        priceRangeMin: 300,
        priceRangeMax: 320,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const moneycontrolIPO: MoneycontrolIPO = {
        companyName: 'Reliance Industries Ltd', // Slightly different name
        issueSize: 2100000000, // Different issue size
        priceRangeMin: 310, // Different price
        priceRangeMax: 330,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'BOTH',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'MONEYCONTROL',
        rating: 5.0
      };

      const ipos = [
        { data: nseIPO, source: 'NSE' as const },
        { data: moneycontrolIPO, source: 'MONEYCONTROL' as const }
      ];

      const merged = deduplicateIPOs(ipos);

      expect(merged).toHaveLength(1);

      // NSE data should be preserved
      expect(merged[0].companyName).toBe('Reliance Industries Limited');
      expect(merged[0].issueSize).toBe(2000000000);
      expect(merged[0].priceRangeMin).toBe(300);
      expect(merged[0].priceRangeMax).toBe(320);

      // Moneycontrol supplementary data added
      expect(merged[0].rating).toBe(5.0);
    });

    it('should preserve GMP data from Chittorgarh regardless of priority', () => {
      const nseIPO: ScrapedIPO = {
        companyName: 'XYZ Corporation',
        issueSize: 800000000,
        priceRangeMin: 150,
        priceRangeMax: 160,
        openDate: '2025-11-10',
        closeDate: '2025-11-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const chittorgarhIPO: ChittorgarhIPO = {
        companyName: 'XYZ Corporation',
        issueSize: 800000000,
        priceRangeMin: 150,
        priceRangeMax: 160,
        openDate: '2025-11-10',
        closeDate: '2025-11-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'CHITTORGARH',
        gmp: 30,
        gmpPercentage: 18.75,
        gmpUpdatedAt: '2025-11-09T12:00:00Z'
      };

      const ipos = [
        { data: nseIPO, source: 'NSE' as const },
        { data: chittorgarhIPO, source: 'CHITTORGARH' as const }
      ];

      const merged = deduplicateIPOs(ipos);

      expect(merged).toHaveLength(1);

      // NSE core data preserved
      expect(merged[0].companyName).toBe('XYZ Corporation');

      // GMP data from Chittorgarh added
      expect(merged[0].gmp).toBe(30);
      expect(merged[0].gmpPercentage).toBe(18.75);
      expect(merged[0].gmpUpdatedAt).toBe('2025-11-09T12:00:00Z');
    });

    it('should supplement missing fields from lower priority sources', () => {
      const nseIPOMinimal: ScrapedIPO = {
        companyName: 'MinimalData Corp',
        issueSize: 500000000,
        priceRangeMin: 100,
        priceRangeMax: 110,
        openDate: '2025-11-15',
        closeDate: '2025-11-17',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
        // Missing: sector, lotSize, registrar
      };

      const bseIPO: ScrapedIPO = {
        companyName: 'MinimalData Corporation',
        issueSize: 500000000,
        priceRangeMin: 100,
        priceRangeMax: 110,
        openDate: '2025-11-15',
        closeDate: '2025-11-17',
        listingExchange: 'BSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        sector: 'Healthcare',
        lotSize: 100,
        registrar: 'KFin Technologies'
      };

      const ipos = [
        { data: nseIPOMinimal, source: 'NSE' as const },
        { data: bseIPO, source: 'BSE' as const }
      ];

      const merged = deduplicateIPOs(ipos);

      expect(merged).toHaveLength(1);

      // NSE name preserved
      expect(merged[0].companyName).toBe('MinimalData Corp');

      // Missing fields supplemented from BSE
      expect(merged[0].sector).toBe('Healthcare');
      expect(merged[0].lotSize).toBe(100);
      expect(merged[0].registrar).toBe('KFin Technologies');
    });
  });

  describe('End-to-end deduplication scenarios', () => {
    it('should handle fuzzy matching for similar company names', () => {
      const variations = [
        {
          data: {
            companyName: 'Tata Consultancy Services Limited',
            issueSize: 1000000000,
            priceRangeMin: 250,
            priceRangeMax: 260,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'NSE',
            category: 'MAINBOARD',
            status: 'UPCOMING'
          } as ScrapedIPO,
          source: 'NSE' as const
        },
        {
          data: {
            companyName: 'Tata Consultancy Services Ltd',
            issueSize: 1000000000,
            priceRangeMin: 250,
            priceRangeMax: 260,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'BSE',
            category: 'MAINBOARD',
            status: 'UPCOMING'
          } as ScrapedIPO,
          source: 'BSE' as const
        },
        {
          data: {
            companyName: 'TCS Limited',
            issueSize: 1000000000,
            priceRangeMin: 250,
            priceRangeMax: 260,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'NSE',
            category: 'MAINBOARD',
            status: 'UPCOMING',
            dataSource: 'MONEYCONTROL'
          } as MoneycontrolIPO,
          source: 'MONEYCONTROL' as const
        }
      ];

      const merged = deduplicateIPOs(variations);

      // First two should merge, third might not (different name)
      expect(merged.length).toBeGreaterThan(0);
      expect(merged.length).toBeLessThanOrEqual(2);

      // Check that similar names were merged
      const tcs = merged.find(ipo => ipo.companyName.includes('Tata'));
      if (tcs) {
        expect(tcs.dataSources.length).toBeGreaterThan(1);
      }
    });

    it('should handle empty arrays', () => {
      const merged = deduplicateIPOs([]);
      expect(merged).toEqual([]);
    });

    it('should handle single source data', () => {
      const singleIPO = [
        {
          data: {
            companyName: 'SingleSource IPO',
            issueSize: 500000000,
            priceRangeMin: 100,
            priceRangeMax: 110,
            openDate: '2025-11-01',
            closeDate: '2025-11-03',
            listingExchange: 'NSE',
            category: 'MAINBOARD',
            status: 'UPCOMING'
          } as ScrapedIPO,
          source: 'NSE' as const
        }
      ];

      const merged = deduplicateIPOs(singleIPO);

      expect(merged).toHaveLength(1);
      expect(merged[0].dataSources).toEqual(['NSE']);
    });
  });

  describe('Priority-based merging edge cases', () => {
    it('should handle API_FALLBACK data correctly', () => {
      const apiIPO: IPOWithSources = {
        companyName: 'Fallback Company',
        issueSize: 300000000,
        priceRangeMin: 80,
        priceRangeMax: 90,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSources: ['API_FALLBACK']
      };

      const nseIPO: ScrapedIPO = {
        companyName: 'Fallback Company Ltd',
        issueSize: 320000000, // Different value
        priceRangeMin: 85,
        priceRangeMax: 95,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'LIVE' // Different status
      };

      const merged = mergeIPOData(apiIPO, nseIPO, 'NSE');

      // NSE data should override API_FALLBACK (higher priority)
      expect(merged.issueSize).toBe(320000000);
      expect(merged.priceRangeMin).toBe(85);
      expect(merged.status).toBe('LIVE');

      expect(merged.dataSources).toContain('NSE');
      expect(merged.dataSources).toContain('API_FALLBACK');
    });

    it('should not override higher priority data with lower priority', () => {
      const nseIPO: IPOWithSources = {
        companyName: 'Priority Test Corp',
        issueSize: 1000000000,
        priceRangeMin: 200,
        priceRangeMax: 210,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'LIVE',
        dataSources: ['NSE']
      };

      const chittorgarhIPO: ChittorgarhIPO = {
        companyName: 'Priority Test Corporation',
        issueSize: 1100000000, // Different
        priceRangeMin: 210, // Different
        priceRangeMax: 220,
        openDate: '2025-12-01',
        closeDate: '2025-12-03',
        listingExchange: 'BOTH',
        category: 'MAINBOARD',
        status: 'UPCOMING', // Different
        dataSource: 'CHITTORGARH',
        gmp: 40,
        gmpPercentage: 19.05,
        gmpUpdatedAt: '2025-11-30T10:00:00Z'
      };

      const merged = mergeIPOData(nseIPO, chittorgarhIPO, 'CHITTORGARH');

      // NSE core data should be preserved
      expect(merged.issueSize).toBe(1000000000);
      expect(merged.priceRangeMin).toBe(200);
      expect(merged.status).toBe('LIVE');

      // GMP data should be added
      expect(merged.gmp).toBe(40);
      expect(merged.gmpPercentage).toBe(19.05);
    });
  });
});
