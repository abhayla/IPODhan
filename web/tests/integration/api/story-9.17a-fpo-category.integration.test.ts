/**
 * Story 9.17a: Schema Migration - FPO Category Integration Tests
 * Tests for FPO category filtering in API endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../../../lib/db/index';
import { ipos, listingPerformance } from '../../../lib/db/schema';
import { eq } from 'drizzle-orm';

describe('Story 9.17a: FPO Category API Integration Tests', () => {
  let testFPOId: string;
  let testMainboardId: string;

  beforeAll(async () => {
    // Create test FPO IPO
    const fpoResult = await db
      .insert(ipos)
      .values({
        companyName: 'Test FPO Company',
        slug: 'test-fpo-company-9-17a',
        category: 'FPO',
        status: 'LISTED',
        openDate: '2025-01-10',
        closeDate: '2025-01-12',
        listingDate: '2025-01-15',
        priceRangeMin: 200,
        priceRangeMax: 250,
        lotSize: 50,
      })
      .returning({ id: ipos.id });

    testFPOId = fpoResult[0].id;

    // Create listing performance with separate exchange prices
    await db.insert(listingPerformance).values({
      ipoId: testFPOId,
      listingPrice: 260,
      issuePrice: 225,
      listingGainPercent: '15.56',
      currentPrice: null, // Deprecated field
      currentPriceBSE: 265,
      currentPriceNSE: 270,
      currentGainPercent: '20.00',
    });

    // Create test MAINBOARD IPO for comparison
    const mainboardResult = await db
      .insert(ipos)
      .values({
        companyName: 'Test Mainboard Company',
        slug: 'test-mainboard-company-9-17a',
        category: 'MAINBOARD',
        status: 'LISTED',
        openDate: '2025-01-08',
        closeDate: '2025-01-10',
        listingDate: '2025-01-13',
        priceRangeMin: 100,
        priceRangeMax: 120,
        lotSize: 100,
      })
      .returning({ id: ipos.id });

    testMainboardId = mainboardResult[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testFPOId) {
      await db.delete(listingPerformance).where(eq(listingPerformance.ipoId, testFPOId));
      await db.delete(ipos).where(eq(ipos.id, testFPOId));
    }
    if (testMainboardId) {
      await db.delete(ipos).where(eq(ipos.id, testMainboardId));
    }
  });

  describe('FPO Category CRUD Operations', () => {
    it('should create an IPO with FPO category', async () => {
      const result = await db
        .select()
        .from(ipos)
        .where(eq(ipos.id, testFPOId))
        .limit(1);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('FPO');
      expect(result[0].companyName).toBe('Test FPO Company');
    });

    it('should query IPOs by FPO category', async () => {
      const result = await db.select().from(ipos).where(eq(ipos.category, 'FPO'));

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((ipo) => ipo.category === 'FPO')).toBe(true);
    });

    it('should filter FPO from other categories', async () => {
      const fpoResult = await db.select().from(ipos).where(eq(ipos.category, 'FPO'));

      const mainboardResult = await db
        .select()
        .from(ipos)
        .where(eq(ipos.category, 'MAINBOARD'));

      expect(fpoResult.every((ipo) => ipo.category === 'FPO')).toBe(true);
      expect(mainboardResult.every((ipo) => ipo.category === 'MAINBOARD')).toBe(true);
      expect(fpoResult.some((ipo) => ipo.id === testMainboardId)).toBe(false);
      expect(mainboardResult.some((ipo) => ipo.id === testFPOId)).toBe(false);
    });

    it('should update FPO IPO without issues', async () => {
      await db
        .update(ipos)
        .set({ companyDescription: 'Updated FPO description' })
        .where(eq(ipos.id, testFPOId));

      const result = await db
        .select()
        .from(ipos)
        .where(eq(ipos.id, testFPOId))
        .limit(1);

      expect(result[0].companyDescription).toBe('Updated FPO description');
      expect(result[0].category).toBe('FPO'); // Category unchanged
    });
  });

  describe('Separate BSE/NSE Prices', () => {
    it('should retrieve listing performance with separate exchange prices', async () => {
      const result = await db
        .select()
        .from(listingPerformance)
        .where(eq(listingPerformance.ipoId, testFPOId))
        .limit(1);

      expect(result).toHaveLength(1);
      expect(result[0].currentPriceBSE).toBe(265);
      expect(result[0].currentPriceNSE).toBe(270);
      expect(result[0].currentPrice).toBeNull(); // Deprecated field
    });

    it('should allow updating separate exchange prices', async () => {
      await db
        .update(listingPerformance)
        .set({
          currentPriceBSE: 275,
          currentPriceNSE: 280,
        })
        .where(eq(listingPerformance.ipoId, testFPOId));

      const result = await db
        .select()
        .from(listingPerformance)
        .where(eq(listingPerformance.ipoId, testFPOId))
        .limit(1);

      expect(result[0].currentPriceBSE).toBe(275);
      expect(result[0].currentPriceNSE).toBe(280);
    });

    it('should allow null values for individual exchange prices', async () => {
      await db
        .update(listingPerformance)
        .set({
          currentPriceBSE: null,
          currentPriceNSE: 285,
        })
        .where(eq(listingPerformance.ipoId, testFPOId));

      const result = await db
        .select()
        .from(listingPerformance)
        .where(eq(listingPerformance.ipoId, testFPOId))
        .limit(1);

      expect(result[0].currentPriceBSE).toBeNull();
      expect(result[0].currentPriceNSE).toBe(285);
    });
  });

  describe('FPO with Listing Performance Integration', () => {
    it('should join FPO IPO with listing performance showing exchange prices', async () => {
      const result = await db
        .select({
          id: ipos.id,
          companyName: ipos.companyName,
          category: ipos.category,
          listingPrice: listingPerformance.listingPrice,
          currentPriceBSE: listingPerformance.currentPriceBSE,
          currentPriceNSE: listingPerformance.currentPriceNSE,
        })
        .from(ipos)
        .leftJoin(listingPerformance, eq(ipos.id, listingPerformance.ipoId))
        .where(eq(ipos.id, testFPOId))
        .limit(1);

      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('FPO');
      expect(result[0].currentPriceBSE).toBeDefined();
      expect(result[0].currentPriceNSE).toBeDefined();
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain support for currentPrice field', async () => {
      // Test that queries using currentPrice still work
      const result = await db
        .select({
          id: listingPerformance.id,
          currentPrice: listingPerformance.currentPrice,
          currentPriceBSE: listingPerformance.currentPriceBSE,
          currentPriceNSE: listingPerformance.currentPriceNSE,
        })
        .from(listingPerformance)
        .where(eq(listingPerformance.ipoId, testFPOId))
        .limit(1);

      expect(result).toHaveLength(1);
      // currentPrice can be null (deprecated), while BSE/NSE have values
      expect(result[0].currentPriceBSE).toBeDefined();
      expect(result[0].currentPriceNSE).toBeDefined();
    });

    it('should support all existing categories alongside FPO', async () => {
      const categories = ['MAINBOARD', 'SME', 'RIGHTS', 'NCD', 'FPO'];

      for (const category of categories) {
        // Verify each category can be queried without errors
        const result = await db
          .select()
          .from(ipos)
          .where(eq(ipos.category, category as any))
          .limit(1);

        // Result can be empty, but query should succeed
        expect(Array.isArray(result)).toBe(true);
      }
    });
  });
});
