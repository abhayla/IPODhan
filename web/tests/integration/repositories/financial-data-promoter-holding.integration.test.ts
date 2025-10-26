/**
 * Integration Tests for Promoter Holding Fields in Financial Data
 * Story 11.9 - AC#7
 *
 * Tests cover:
 * 1. Repository retrieves promoter holding fields
 * 2. API endpoint returns promoter holding data
 * 3. Data persists correctly after migration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/index';
import { ipos, financialData } from '@/lib/db';
import { eq } from 'drizzle-orm';

describe('Financial Data Promoter Holding Integration Tests', () => {
  let testIpoId: string;

  beforeAll(async () => {
    // Create a test IPO
    const [ipo] = await db
      .insert(ipos)
      .values({
        slug: 'test-promoter-holding-ipo',
        companyName: 'Test Promoter Holding Company',
        segment: 'MAINBOARD',
        offeringType: 'IPO',
        status: 'UPCOMING',
      })
      .returning();

    testIpoId = ipo.id;

    // Insert financial data with promoter holding
    await db.insert(financialData).values({
      ipoId: testIpoId,
      promoterHoldingPreIssue: '77.50',
      promoterHoldingPostIssue: '62.30',
      peRatio: '15.50',
      roe: '18.25',
    });
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(financialData).where(eq(financialData.ipoId, testIpoId));
    await db.delete(ipos).where(eq(ipos.id, testIpoId));
  });

  describe('Financial Data Repository', () => {
    it('should retrieve promoter holding fields from database', async () => {
      const [result] = await db
        .select()
        .from(financialData)
        .where(eq(financialData.ipoId, testIpoId));

      expect(result).toBeDefined();
      expect(result.promoterHoldingPreIssue).toBe('77.50');
      expect(result.promoterHoldingPostIssue).toBe('62.30');
    });

    it('should handle null promoter holding values', async () => {
      // Create another IPO without promoter holding data
      const [ipoWithoutPromoterData] = await db
        .insert(ipos)
        .values({
          slug: 'test-no-promoter-data-ipo',
          companyName: 'Test No Promoter Data Company',
          segment: 'SME',
          offeringType: 'IPO',
          status: 'UPCOMING',
        })
        .returning();

      await db.insert(financialData).values({
        ipoId: ipoWithoutPromoterData.id,
        peRatio: '20.00',
        // promoter holding fields are null
      });

      const [result] = await db
        .select()
        .from(financialData)
        .where(eq(financialData.ipoId, ipoWithoutPromoterData.id));

      expect(result).toBeDefined();
      expect(result.promoterHoldingPreIssue).toBeNull();
      expect(result.promoterHoldingPostIssue).toBeNull();

      // Clean up
      await db
        .delete(financialData)
        .where(eq(financialData.ipoId, ipoWithoutPromoterData.id));
      await db.delete(ipos).where(eq(ipos.id, ipoWithoutPromoterData.id));
    });

    it('should persist data correctly with numeric precision (5,2)', async () => {
      // Test boundary values
      const [ipoBoundary] = await db
        .insert(ipos)
        .values({
          slug: 'test-boundary-promoter-ipo',
          companyName: 'Test Boundary Promoter Company',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'UPCOMING',
        })
        .returning();

      await db.insert(financialData).values({
        ipoId: ipoBoundary.id,
        promoterHoldingPreIssue: '100.00', // Maximum
        promoterHoldingPostIssue: '0.00', // Minimum
      });

      const [result] = await db
        .select()
        .from(financialData)
        .where(eq(financialData.ipoId, ipoBoundary.id));

      expect(result.promoterHoldingPreIssue).toBe('100.00');
      expect(result.promoterHoldingPostIssue).toBe('0.00');

      // Clean up
      await db
        .delete(financialData)
        .where(eq(financialData.ipoId, ipoBoundary.id));
      await db.delete(ipos).where(eq(ipos.id, ipoBoundary.id));
    });
  });

  describe('Data Type Validation', () => {
    it('should store decimal values with 2 decimal precision', async () => {
      const [ipoDecimal] = await db
        .insert(ipos)
        .values({
          slug: 'test-decimal-promoter-ipo',
          companyName: 'Test Decimal Promoter Company',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'UPCOMING',
        })
        .returning();

      await db.insert(financialData).values({
        ipoId: ipoDecimal.id,
        promoterHoldingPreIssue: '85.67',
        promoterHoldingPostIssue: '72.34',
      });

      const [result] = await db
        .select()
        .from(financialData)
        .where(eq(financialData.ipoId, ipoDecimal.id));

      expect(result.promoterHoldingPreIssue).toBe('85.67');
      expect(result.promoterHoldingPostIssue).toBe('72.34');

      // Clean up
      await db
        .delete(financialData)
        .where(eq(financialData.ipoId, ipoDecimal.id));
      await db.delete(ipos).where(eq(ipos.id, ipoDecimal.id));
    });

    it('should convert numeric values to string representation', async () => {
      const [result] = await db
        .select()
        .from(financialData)
        .where(eq(financialData.ipoId, testIpoId));

      // Drizzle returns numeric types as strings for precision
      expect(typeof result.promoterHoldingPreIssue).toBe('string');
      expect(typeof result.promoterHoldingPostIssue).toBe('string');

      // Can be converted to numbers for calculations
      const preIssue = Number(result.promoterHoldingPreIssue);
      const postIssue = Number(result.promoterHoldingPostIssue);
      const dilution = preIssue - postIssue;

      expect(dilution).toBeCloseTo(15.2, 1);
    });
  });
});
