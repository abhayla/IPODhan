/**
 * Unit Tests: Rights/Debt Issue Enrichment Scraper
 *
 * Story: 11.1 - Implement Rights/Debt IPO Detail Scraper
 * Created: 2025-10-17
 *
 * Test Coverage:
 * - Fuzzy matching algorithm (85% similarity threshold)
 * - Company name normalization
 * - Data merging logic
 * - Data validation
 * - Edge cases and error handling
 */

import { describe, it, expect } from 'vitest';
import type { ScrapedIPO } from '../../../src/utils/validators.js';
import {
  findBestMatch,
  mergeEnrichmentData,
  validateEnrichmentData,
  type RightsDebtEnrichmentData,
} from '../../../src/scrapers/rights-debt-enrichment-scraper.js';

describe('Rights/Debt Enrichment Scraper', () => {
  describe('findBestMatch', () => {
    const mockEnrichmentData: RightsDebtEnrichmentData[] = [
      {
        companyName: 'HDFC Bank Limited',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'Test Registrar',
        leadManagers: ['Manager 1'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      },
      {
        companyName: 'Tata Motors Company Ltd',
        issueSize: 200000000,
        lotSize: 100,
        faceValue: 5,
        priceRangeMin: 200,
        priceRangeMax: 250,
        openDate: '2025-10-05',
        closeDate: '2025-10-15',
        registrar: 'Another Registrar',
        leadManagers: ['Manager 2'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      },
    ];

    it('should find exact match (100% similarity)', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'HDFC Bank Limited',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const match = findBestMatch(bseIPO, mockEnrichmentData);

      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('HDFC Bank Limited');
    });

    it('should find fuzzy match with normalized names', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'HDFC BANK LTD',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const match = findBestMatch(bseIPO, mockEnrichmentData);

      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('HDFC Bank Limited');
    });

    it('should find match with case differences', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'tata motors company',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-05',
        closeDate: '2025-10-15',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const match = findBestMatch(bseIPO, mockEnrichmentData);

      expect(match).not.toBeNull();
      expect(match?.companyName).toBe('Tata Motors Company Ltd');
    });

    it('should return null when similarity < 85%', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'Reliance Industries',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const match = findBestMatch(bseIPO, mockEnrichmentData);

      expect(match).toBeNull();
    });

    it('should return null for empty enrichment data', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'HDFC Bank Limited',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const match = findBestMatch(bseIPO, []);

      expect(match).toBeNull();
    });
  });

  describe('mergeEnrichmentData', () => {
    it('should merge missing issue size', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'TEST IPO',
        issueSize: 0, // Missing
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const enrichment: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO LTD',
        issueSize: 500000000,
        lotSize: 50,
        faceValue: 5,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'Test Registrar',
        leadManagers: ['Manager 1'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const merged = mergeEnrichmentData(bseIPO, enrichment);

      expect(merged.issueSize).toBe(500000000);
    });

    it('should merge default lot size (100) with actual value', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'TEST IPO',
        issueSize: 100000000,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100, // Default
        faceValue: 10,
      };

      const enrichment: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO LTD',
        issueSize: 500000000,
        lotSize: 75, // Actual value
        faceValue: 5,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'Test Registrar',
        leadManagers: null,
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const merged = mergeEnrichmentData(bseIPO, enrichment);

      expect(merged.lotSize).toBe(75);
    });

    it('should merge default face value (10) with actual value', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'TEST IPO',
        issueSize: 100000000,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10, // Default
      };

      const enrichment: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO LTD',
        issueSize: 500000000,
        lotSize: 75,
        faceValue: 2, // Actual value
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null,
        leadManagers: null,
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const merged = mergeEnrichmentData(bseIPO, enrichment);

      expect(merged.faceValue).toBe(2);
    });

    it('should NOT overwrite existing non-default values', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'TEST IPO',
        issueSize: 300000000, // Already set
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 50, // Already set
        faceValue: 5, // Already set
      };

      const enrichment: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO LTD',
        issueSize: 500000000,
        lotSize: 75,
        faceValue: 2,
        priceRangeMin: 150,
        priceRangeMax: 180,
        openDate: '2025-10-02',
        closeDate: '2025-10-11',
        registrar: 'Test Registrar',
        leadManagers: ['Manager 1'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const merged = mergeEnrichmentData(bseIPO, enrichment);

      // Should NOT overwrite existing values
      expect(merged.issueSize).toBe(300000000); // Original
      expect(merged.lotSize).toBe(50); // Original
      expect(merged.faceValue).toBe(5); // Original
    });

    it('should add registrar and lead managers', () => {
      const bseIPO: ScrapedIPO = {
        companyName: 'TEST IPO',
        issueSize: 0,
        priceRangeMin: 0,
        priceRangeMax: 0,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        listingExchange: 'BSE',
        category: 'RIGHTS',
        sector: '',
        status: 'OPEN',
        lotSize: 100,
        faceValue: 10,
      };

      const enrichment: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO LTD',
        issueSize: 500000000,
        lotSize: 75,
        faceValue: 2,
        priceRangeMin: 150,
        priceRangeMax: 180,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'KFin Technologies Limited',
        leadManagers: ['DAM Capital', 'Motilal Oswal'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const merged = mergeEnrichmentData(bseIPO, enrichment);

      expect((merged as any).registrar).toBe('KFin Technologies Limited');
      expect((merged as any).leadManagers).toEqual(['DAM Capital', 'Motilal Oswal']);
      expect((merged as any).enrichmentSource).toBe('CHITTORGARH');
    });
  });

  describe('validateEnrichmentData', () => {
    it('should validate correct data', () => {
      const validData: RightsDebtEnrichmentData = {
        companyName: 'VALID IPO LIMITED',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: 'Valid Registrar',
        leadManagers: ['Manager 1'],
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(validData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty company name', () => {
      const invalidData: RightsDebtEnrichmentData = {
        companyName: '',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null,
        leadManagers: null,
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(invalidData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing company name');
    });

    it('should reject negative values', () => {
      const invalidData: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO',
        issueSize: -100,
        lotSize: -50,
        faceValue: -10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null,
        leadManagers: null,
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(invalidData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid issue size (negative)');
      expect(result.errors).toContain('Invalid lot size (negative)');
      expect(result.errors).toContain('Invalid face value (negative)');
    });

    it('should reject invalid price range (min > max)', () => {
      const invalidData: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 150,
        priceRangeMax: 100, // Invalid: min > max
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null,
        leadManagers: null,
        category: 'RIGHTS',
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(invalidData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid price range (min > max)');
    });

    it('should reject invalid category', () => {
      const invalidData: RightsDebtEnrichmentData = {
        companyName: 'TEST IPO',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null,
        leadManagers: null,
        category: 'INVALID' as any,
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(invalidData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid category: INVALID (must be RIGHTS or NCD)');
    });

    it('should allow null registrar and leadManagers', () => {
      const validData: RightsDebtEnrichmentData = {
        companyName: 'VALID IPO',
        issueSize: 100000000,
        lotSize: 50,
        faceValue: 10,
        priceRangeMin: 100,
        priceRangeMax: 120,
        openDate: '2025-10-01',
        closeDate: '2025-10-10',
        registrar: null, // Optional
        leadManagers: null, // Optional
        category: 'NCD',
        dataSource: 'CHITTORGARH',
      };

      const result = validateEnrichmentData(validData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
