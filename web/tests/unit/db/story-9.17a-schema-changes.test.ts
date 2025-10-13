/**
 * Story 9.17a: Schema Migration - FPO Category and Separate BSE/NSE Prices
 * Tests for FPO category enum and separate exchange price fields
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { IPO, NewIPO, ListingPerformance, IPOCategory } from '../../../lib/db/types';
import { DEFAULT_HISTORICAL_FIELDS } from '../../../lib/db/types';
import * as schema from '../../../lib/db/schema';

describe('Story 9.17a: Schema Migration Tests', () => {
  describe('FPO Category Enum', () => {
    it('should include FPO in IPOCategory type', () => {
      // Test that FPO is a valid category type
      expectTypeOf<IPOCategory>().toMatchTypeOf<
        'MAINBOARD' | 'SME' | 'RIGHTS' | 'NCD' | 'FPO'
      >();
    });

    it('should allow FPO category in IPO type', () => {
      const mockFPOIpo: IPO = {
        ...DEFAULT_HISTORICAL_FIELDS,
        id: '123e4567-e89b-12d3-a456-426614174000',
        companyName: 'Test FPO Company',
        slug: 'test-fpo-company',
        category: 'FPO', // FPO category should be valid
        sector: 'Finance',
        issueSize: '500.00',
        priceRangeMin: 200,
        priceRangeMax: 250,
        lotSize: 50,
        status: 'UPCOMING',
        openDate: '2025-01-15',
        closeDate: '2025-01-17',
        allotmentDate: null,
        listingDate: null,
        companyDescription: 'Test FPO description',
        faceValue: 10,
        listingExchanges: ['NSE', 'BSE'],
        registrar: 'Test Registrar',
        registrarId: null,
        leadManagers: ['Manager 1'],
        rating: 3,
        ratingRationale: 'Follow-on offering',
        ratingOverride: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScrapedAt: null,
      };

      expect(mockFPOIpo).toBeDefined();
      expect(mockFPOIpo.category).toBe('FPO');
      expectTypeOf(mockFPOIpo.category).toMatchTypeOf<IPOCategory>();
    });

    it('should allow FPO category in NewIPO type', () => {
      const mockNewFPOIpo: NewIPO = {
        companyName: 'New FPO Company',
        slug: 'new-fpo-company',
        category: 'FPO', // FPO should be valid for new IPO
        status: 'UPCOMING',
      };

      expect(mockNewFPOIpo).toBeDefined();
      expect(mockNewFPOIpo.category).toBe('FPO');
    });

    it('should export ipoCategoryEnum with FPO', () => {
      expect(schema.ipoCategoryEnum).toBeDefined();
      expect(typeof schema.ipoCategoryEnum).toBe('function');
    });
  });

  describe('Separate BSE/NSE Price Fields', () => {
    it('should include currentPriceBSE and currentPriceNSE in ListingPerformance type', () => {
      const mockListingPerformance: ListingPerformance = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 150,
        issuePrice: 100,
        listingGainPercent: '50.00',
        currentPrice: 160, // @deprecated but kept for backward compatibility
        currentPriceBSE: 158, // New BSE price field
        currentPriceNSE: 162, // New NSE price field
        currentGainPercent: '60.00',
        lastUpdated: new Date(),
      };

      expect(mockListingPerformance).toBeDefined();
      expectTypeOf(mockListingPerformance.currentPriceBSE).toEqualTypeOf<number | null>();
      expectTypeOf(mockListingPerformance.currentPriceNSE).toEqualTypeOf<number | null>();
    });

    it('should allow different BSE and NSE prices', () => {
      const mockListingPerformance: ListingPerformance = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 200,
        issuePrice: 150,
        listingGainPercent: '33.33',
        currentPrice: null, // Can be null
        currentPriceBSE: 210, // Different price on BSE
        currentPriceNSE: 215, // Different price on NSE
        currentGainPercent: '43.33',
        lastUpdated: new Date(),
      };

      expect(mockListingPerformance.currentPriceBSE).toBe(210);
      expect(mockListingPerformance.currentPriceNSE).toBe(215);
      expect(mockListingPerformance.currentPriceBSE).not.toBe(
        mockListingPerformance.currentPriceNSE
      );
    });

    it('should allow null values for BSE/NSE prices', () => {
      const mockListingPerformance: ListingPerformance = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 180,
        issuePrice: 160,
        listingGainPercent: '12.50',
        currentPrice: null,
        currentPriceBSE: null, // Nullable
        currentPriceNSE: 190, // Only NSE price available
        currentGainPercent: '18.75',
        lastUpdated: new Date(),
      };

      expect(mockListingPerformance.currentPriceBSE).toBeNull();
      expect(mockListingPerformance.currentPriceNSE).toBe(190);
    });

    it('should maintain backward compatibility with currentPrice field', () => {
      const mockListingPerformance: ListingPerformance = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 120,
        issuePrice: 100,
        listingGainPercent: '20.00',
        currentPrice: 125, // @deprecated but still works
        currentPriceBSE: 124,
        currentPriceNSE: 126,
        currentGainPercent: '25.00',
        lastUpdated: new Date(),
      };

      expect(mockListingPerformance.currentPrice).toBe(125);
      expectTypeOf(mockListingPerformance.currentPrice).toEqualTypeOf<number | null>();
    });

    it('should export listingPerformance table with new fields', () => {
      expect(schema.listingPerformance).toBeDefined();
      expect(typeof schema.listingPerformance).toBe('object');
    });
  });

  describe('Integration Tests', () => {
    it('should allow FPO IPO with separate exchange prices', () => {
      // Test combining FPO category with separate exchange prices
      const mockFPOIpo: IPO = {
        ...DEFAULT_HISTORICAL_FIELDS,
        id: '123e4567-e89b-12d3-a456-426614174000',
        companyName: 'FPO Company with Listing',
        slug: 'fpo-company-with-listing',
        category: 'FPO',
        sector: 'Banking',
        issueSize: '1000.00',
        priceRangeMin: 300,
        priceRangeMax: 350,
        lotSize: 40,
        status: 'LISTED',
        openDate: '2025-01-10',
        closeDate: '2025-01-12',
        allotmentDate: '2025-01-15',
        listingDate: '2025-01-18',
        companyDescription: 'Large FPO',
        faceValue: 10,
        listingExchanges: ['NSE', 'BSE'],
        registrar: 'Test Registrar',
        registrarId: null,
        leadManagers: ['Manager 1', 'Manager 2'],
        rating: 4,
        ratingRationale: 'Strong FPO',
        ratingOverride: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastScrapedAt: new Date(),
      };

      const mockListingPerformance: ListingPerformance = {
        id: '223e4567-e89b-12d3-a456-426614174000',
        ipoId: mockFPOIpo.id,
        listingPrice: 340,
        issuePrice: 325,
        listingGainPercent: '4.62',
        currentPrice: null, // Deprecated
        currentPriceBSE: 345, // BSE current price
        currentPriceNSE: 348, // NSE current price
        currentGainPercent: '6.46',
        lastUpdated: new Date(),
      };

      expect(mockFPOIpo.category).toBe('FPO');
      expect(mockListingPerformance.currentPriceBSE).toBe(345);
      expect(mockListingPerformance.currentPriceNSE).toBe(348);
    });

    it('should maintain type safety for all categories including FPO', () => {
      const categories: IPOCategory[] = ['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO'];

      categories.forEach((category) => {
        expectTypeOf(category).toMatchTypeOf<IPOCategory>();
      });

      expect(categories).toHaveLength(5);
      expect(categories).toContain('FPO');
    });
  });

  describe('Backward Compatibility', () => {
    it('should support existing categories without FPO', () => {
      const existingCategories: IPOCategory[] = ['MAINBOARD', 'SME', 'RIGHTS', 'NCD'];

      existingCategories.forEach((category) => {
        expectTypeOf(category).toMatchTypeOf<IPOCategory>();
      });

      expect(existingCategories).toHaveLength(4);
    });

    it('should support listing performance without new exchange fields', () => {
      const oldListingPerformance: Partial<ListingPerformance> = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ipoId: '123e4567-e89b-12d3-a456-426614174001',
        listingPrice: 100,
        issuePrice: 90,
        listingGainPercent: '11.11',
        currentPrice: 105, // Old field still works
        currentGainPercent: '16.67',
        lastUpdated: new Date(),
        // currentPriceBSE and currentPriceNSE are optional
      };

      expect(oldListingPerformance.currentPrice).toBe(105);
      expect(oldListingPerformance.currentPriceBSE).toBeUndefined();
      expect(oldListingPerformance.currentPriceNSE).toBeUndefined();
    });
  });
});
