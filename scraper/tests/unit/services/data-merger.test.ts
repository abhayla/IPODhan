/**
 * Unit tests for data-merger.ts
 * Tests: source priority merging, deduplication logic, fuzzy matching
 */

import { describe, it, expect } from 'vitest';
import {
  findMatchingIPO,
  mergeIPOData,
  deduplicateIPOs,
  SOURCE_PRIORITY,
  type IPOWithSources
} from '../../../src/services/data-merger.js';
import type { ScrapedIPO, MoneycontrolIPO, ChittorgarhIPO } from '../../../src/utils/validators.js';

describe('data-merger', () => {
  describe('SOURCE_PRIORITY', () => {
    it('should have correct priority order (NSE > BSE > MONEYCONTROL > CHITTORGARH > API_FALLBACK)', () => {
      expect(SOURCE_PRIORITY.NSE).toBe(1);
      expect(SOURCE_PRIORITY.BSE).toBe(2);
      expect(SOURCE_PRIORITY.MONEYCONTROL).toBe(3);
      expect(SOURCE_PRIORITY.CHITTORGARH).toBe(4);
      expect(SOURCE_PRIORITY.API_FALLBACK).toBe(5);
    });
  });

  describe('findMatchingIPO', () => {
    const existingIPOs: IPOWithSources[] = [
      {
        companyName: 'Tata Consultancy Services Limited',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSources: ['NSE']
      },
      {
        companyName: 'Reliance Industries Ltd',
        issueSize: 2000000000,
        priceRangeMin: 300,
        priceRangeMax: 320,
        openDate: '2025-10-15',
        closeDate: '2025-10-17',
        listingExchange: 'BSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSources: ['BSE']
      }
    ];

    it('should find exact normalized match', () => {
      const match = findMatchingIPO('Tata Consultancy Services Ltd', existingIPOs);
      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('Tata Consultancy Services Limited');
    });

    it('should find match ignoring case differences', () => {
      const match = findMatchingIPO('TATA CONSULTANCY SERVICES LIMITED', existingIPOs);
      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('Tata Consultancy Services Limited');
    });

    it('should find match with different suffixes', () => {
      const match = findMatchingIPO('Reliance Industries Incorporated', existingIPOs);
      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('Reliance Industries Ltd');
    });

    it('should find fuzzy match for similar names', () => {
      const match = findMatchingIPO('Tata Consultancy Service Limited', existingIPOs);
      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('Tata Consultancy Services Limited');
    });

    it('should return null when no match found', () => {
      const match = findMatchingIPO('Infosys Technologies', existingIPOs);
      expect(match).toBeNull();
    });

    it('should return null for empty company name', () => {
      const match = findMatchingIPO('', existingIPOs);
      expect(match).toBeNull();
    });
  });

  describe('mergeIPOData', () => {
    const nseIPO: IPOWithSources = {
      companyName: 'ABC Company Limited',
      issueSize: 1000000000,
      priceRangeMin: 250,
      priceRangeMax: 260,
      openDate: '2025-10-10',
      closeDate: '2025-10-12',
      listingExchange: 'NSE',
      category: 'MAINBOARD',
      status: 'UPCOMING',
      sector: 'Technology',
      lotSize: 50,
      dataSources: ['NSE']
    };

    it('should create new IPO when no existing data', () => {
      const newData: ScrapedIPO = {
        companyName: 'XYZ Company Ltd',
        issueSize: 500000000,
        priceRangeMin: 100,
        priceRangeMax: 110,
        openDate: '2025-11-01',
        closeDate: '2025-11-03',
        listingExchange: 'BSE',
        category: 'SME',
        status: 'UPCOMING'
      };

      const result = mergeIPOData(null, newData, 'BSE');

      expect(result.companyName).toBe('XYZ Company Ltd');
      expect(result.dataSources).toEqual(['BSE']);
    });

    it('should preserve NSE data when merging with lower priority source', () => {
      const moneycontrolData: MoneycontrolIPO = {
        companyName: 'ABC Company Ltd',
        issueSize: 1100000000, // Different value
        priceRangeMin: 255, // Different value
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

      const result = mergeIPOData(nseIPO, moneycontrolData, 'MONEYCONTROL');

      // NSE data preserved (higher priority)
      expect(result.companyName).toBe('ABC Company Limited');
      expect(result.issueSize).toBe(1000000000);
      expect(result.priceRangeMin).toBe(250);

      // Moneycontrol-specific data added
      expect(result.rating).toBe(4.5);
      expect(result.listingGains).toBe(15.5);

      // Sources tracked
      expect(result.dataSources).toContain('NSE');
      expect(result.dataSources).toContain('MONEYCONTROL');
    });

    it('should override existing data with higher priority source', () => {
      const apiIPO: IPOWithSources = {
        companyName: 'ABC Company',
        issueSize: 900000000,
        priceRangeMin: 240,
        priceRangeMax: 250,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSources: ['API_FALLBACK']
      };

      const nseData: ScrapedIPO = {
        companyName: 'ABC Company Limited',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'OPEN'
      };

      const result = mergeIPOData(apiIPO, nseData, 'NSE');

      // NSE data used (higher priority)
      expect(result.companyName).toBe('ABC Company Limited');
      expect(result.issueSize).toBe(1000000000);
      expect(result.priceRangeMin).toBe(250);
      expect(result.status).toBe('OPEN');

      expect(result.dataSources).toContain('NSE');
      expect(result.dataSources).toContain('API_FALLBACK');
    });

    it('should supplement missing fields from lower priority sources', () => {
      const nseIPOMinimal: IPOWithSources = {
        companyName: 'ABC Company Limited',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSources: ['NSE']
        // Missing: sector, lotSize, registrar
      };

      const bseData: ScrapedIPO = {
        companyName: 'ABC Company Ltd',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'BSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        sector: 'Technology',
        lotSize: 50,
        registrar: 'Link Intime India'
      };

      const result = mergeIPOData(nseIPOMinimal, bseData, 'BSE');

      // Core data preserved from NSE
      expect(result.companyName).toBe('ABC Company Limited');

      // Missing fields supplemented from BSE
      expect(result.sector).toBe('Technology');
      expect(result.lotSize).toBe(50);
      expect(result.registrar).toBe('Link Intime India');
    });

    it('should always merge GMP data from Chittorgarh', () => {
      const chittorgarhData: ChittorgarhIPO = {
        companyName: 'ABC Company Ltd',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'NSE',
        category: 'MAINBOARD',
        status: 'UPCOMING',
        dataSource: 'CHITTORGARH',
        gmp: 50,
        gmpPercentage: 20,
        gmpUpdatedAt: '2025-10-09T10:00:00Z'
      };

      const result = mergeIPOData(nseIPO, chittorgarhData, 'CHITTORGARH');

      // NSE core data preserved
      expect(result.companyName).toBe('ABC Company Limited');

      // GMP data added
      expect(result.gmp).toBe(50);
      expect(result.gmpPercentage).toBe(20);
      expect(result.gmpUpdatedAt).toBe('2025-10-09T10:00:00Z');
    });

    it('should not duplicate sources in dataSources array', () => {
      const result1 = mergeIPOData(nseIPO, nseIPO, 'NSE');
      // When merging NSE IPO with itself, sources may include all available if IPO has dataSource field
      expect(result1.dataSources).toContain('NSE');

      const bseData: ScrapedIPO = {
        companyName: 'ABC Company Ltd',
        issueSize: 1000000000,
        priceRangeMin: 250,
        priceRangeMax: 260,
        openDate: '2025-10-10',
        closeDate: '2025-10-12',
        listingExchange: 'BSE',
        category: 'MAINBOARD',
        status: 'UPCOMING'
      };

      const result2 = mergeIPOData(result1, bseData, 'BSE');
      // Result may contain all sources from result1 plus BSE
      expect(result2.dataSources).toContain('NSE');
      expect(result2.dataSources).toContain('BSE');

      // Try adding BSE again
      const result3 = mergeIPOData(result2, bseData, 'BSE');
      // Check that BSE is not duplicated
      const bseCount = result3.dataSources.filter(s => s === 'BSE').length;
      expect(bseCount).toBe(1);
    });
  });

  describe('deduplicateIPOs', () => {
    it('should deduplicate IPOs from multiple sources', () => {
      const ipos = [
        {
          data: {
            companyName: 'ABC Company Limited',
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
            companyName: 'ABC Company Ltd',
            issueSize: 1050000000,
            priceRangeMin: 255,
            priceRangeMax: 265,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'BSE',
            category: 'MAINBOARD',
            status: 'UPCOMING',
            sector: 'Technology'
          } as ScrapedIPO,
          source: 'BSE' as const
        },
        {
          data: {
            companyName: 'XYZ Corporation',
            issueSize: 500000000,
            priceRangeMin: 100,
            priceRangeMax: 110,
            openDate: '2025-11-01',
            closeDate: '2025-11-03',
            listingExchange: 'NSE',
            category: 'SME',
            status: 'UPCOMING'
          } as ScrapedIPO,
          source: 'NSE' as const
        }
      ];

      const result = deduplicateIPOs(ipos);

      // Should have 2 unique IPOs (ABC merged, XYZ separate)
      expect(result).toHaveLength(2);

      // Find ABC Company
      const abc = result.find(ipo => ipo.companyName.includes('ABC'));
      expect(abc).toBeDefined();
      expect(abc!.dataSources).toContain('NSE');
      expect(abc!.dataSources).toContain('BSE');
      expect(abc!.companyName).toBe('ABC Company Limited'); // NSE name preserved
      expect(abc!.sector).toBe('Technology'); // BSE sector supplemented

      // Find XYZ Corporation
      const xyz = result.find(ipo => ipo.companyName === 'XYZ Corporation');
      expect(xyz).toBeDefined();
      expect(xyz!.dataSources).toEqual(['NSE']);
    });

    it('should handle empty array', () => {
      const result = deduplicateIPOs([]);
      expect(result).toEqual([]);
    });

    it('should handle single IPO', () => {
      const ipos = [
        {
          data: {
            companyName: 'ABC Company',
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
        }
      ];

      const result = deduplicateIPOs(ipos);
      expect(result).toHaveLength(1);
      expect(result[0].dataSources).toEqual(['NSE']);
    });

    it('should merge supplementary data from Moneycontrol and Chittorgarh', () => {
      const ipos = [
        {
          data: {
            companyName: 'ABC Company Limited',
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
            companyName: 'ABC Company Ltd',
            issueSize: 1000000000,
            priceRangeMin: 250,
            priceRangeMax: 260,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'NSE',
            category: 'MAINBOARD',
            status: 'UPCOMING',
            dataSource: 'MONEYCONTROL',
            rating: 4.5,
            listingGains: 15
          } as MoneycontrolIPO,
          source: 'MONEYCONTROL' as const
        },
        {
          data: {
            companyName: 'ABC Company',
            issueSize: 1000000000,
            priceRangeMin: 250,
            priceRangeMax: 260,
            openDate: '2025-10-10',
            closeDate: '2025-10-12',
            listingExchange: 'NSE',
            category: 'MAINBOARD',
            status: 'UPCOMING',
            dataSource: 'CHITTORGARH',
            gmp: 50,
            gmpPercentage: 20,
            gmpUpdatedAt: '2025-10-09T10:00:00Z'
          } as ChittorgarhIPO,
          source: 'CHITTORGARH' as const
        }
      ];

      const result = deduplicateIPOs(ipos);

      expect(result).toHaveLength(1);
      const merged = result[0];

      expect(merged.dataSources).toContain('NSE');
      expect(merged.dataSources).toContain('MONEYCONTROL');
      expect(merged.dataSources).toContain('CHITTORGARH');

      expect(merged.rating).toBe(4.5);
      expect(merged.listingGains).toBe(15);
      expect(merged.gmp).toBe(50);
      expect(merged.gmpPercentage).toBe(20);
    });
  });
});
