/**
 * Integration Tests for Enhanced Financial Metrics (Story 11.12)
 *
 * Tests the complete data flow from database to UI:
 * - Repository fetching enhanced financial data
 * - Cache behavior for financial data
 * - API endpoint returning enhanced metrics
 * - Data transformation and YoY calculations
 *
 * @requires PostgreSQL + Redis
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { getRedisClient } from '@/lib/cache/redis-client';
import { FinancialDataRepository } from '@/lib/repositories/financial-data-repository';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { financialData, ipos } from '@/lib/db';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';
import type { FinancialDataInsert } from '@/lib/repositories/types';

describe('Enhanced Financial Metrics Integration', () => {
  const redis = getRedisClient();
  let testIPOId: string;
  let testSlug: string;

  beforeEach(async () => {
    // Create test IPO
    const [ipo] = await db
      .insert(ipos)
      .values({
        companyName: 'Test Enhanced Metrics Corp',
        slug: generateIPOSlug('Test Enhanced Metrics Corp'),
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        status: 'OPEN',
      })
      .returning();

    testIPOId = ipo.id;
    testSlug = ipo.slug;
  });

  afterEach(async () => {
    // Cleanup: Delete test data
    await db.delete(financialData).where(eq(financialData.ipoId, testIPOId));
    await db.delete(ipos).where(eq(ipos.id, testIPOId));

    // Clear cache
    await redis.flushdb();
  });

  describe('FinancialDataRepository - Enhanced Fields', () => {
    it('should store and retrieve all 10 enhanced financial fields', async () => {
      const repository = new FinancialDataRepository(db, redis);

      // Insert financial data with all enhanced fields
      const testData: FinancialDataInsert = {
        ipoId: testIPOId,
        // Multi-year EBITDA
        ebitdaFy2022: 150.5,
        ebitdaFy2023: 175.25,
        ebitdaFy2024: 200.0,
        // Multi-year Total Income
        totalIncomeFy2022: 1000.0,
        totalIncomeFy2023: 1200.0,
        totalIncomeFy2024: 1500.0,
        // Financial Ratios
        totalBorrowings: 5000.0,
        currentRatio: 1.85,
        quickRatio: 1.52,
        inventoryTurnover: 4.2,
        // Existing fields for completeness
        revenueFy2022: 950.0,
        revenueFy2023: 1150.0,
        revenueFy2024: 1450.0,
        profitFy2022: 100.0,
        profitFy2023: 125.0,
        profitFy2024: 180.0,
      };

      const inserted = await repository.upsert(testData);
      expect(inserted).toBeDefined();

      // Retrieve and verify all fields are present
      const retrieved = await repository.findByIPO(testIPOId);
      expect(retrieved).toBeDefined();
      expect(retrieved).not.toBeNull();

      // Verify EBITDA fields
      expect(Number(retrieved!.ebitdaFy2022)).toBe(150.5);
      expect(Number(retrieved!.ebitdaFy2023)).toBe(175.25);
      expect(Number(retrieved!.ebitdaFy2024)).toBe(200.0);

      // Verify Total Income fields
      expect(Number(retrieved!.totalIncomeFy2022)).toBe(1000.0);
      expect(Number(retrieved!.totalIncomeFy2023)).toBe(1200.0);
      expect(Number(retrieved!.totalIncomeFy2024)).toBe(1500.0);

      // Verify Financial Ratios
      expect(Number(retrieved!.totalBorrowings)).toBe(5000.0);
      expect(Number(retrieved!.currentRatio)).toBe(1.85);
      expect(Number(retrieved!.quickRatio)).toBe(1.52);
      expect(Number(retrieved!.inventoryTurnover)).toBe(4.2);
    });

    it('should handle null values for optional enhanced fields', async () => {
      const repository = new FinancialDataRepository(db, redis);

      // Insert with minimal data (all enhanced fields null)
      const minimalData: FinancialDataInsert = {
        ipoId: testIPOId,
        revenueFy2024: 1000.0,
      };

      await repository.upsert(minimalData);

      const retrieved = await repository.findByIPO(testIPOId);
      expect(retrieved).toBeDefined();

      // All enhanced fields should be null
      expect(retrieved!.ebitdaFy2022).toBeNull();
      expect(retrieved!.ebitdaFy2023).toBeNull();
      expect(retrieved!.ebitdaFy2024).toBeNull();
      expect(retrieved!.totalIncomeFy2022).toBeNull();
      expect(retrieved!.totalIncomeFy2023).toBeNull();
      expect(retrieved!.totalIncomeFy2024).toBeNull();
      expect(retrieved!.totalBorrowings).toBeNull();
      expect(retrieved!.currentRatio).toBeNull();
      expect(retrieved!.quickRatio).toBeNull();
      expect(retrieved!.inventoryTurnover).toBeNull();
    });

    it('should cache enhanced financial data correctly', async () => {
      const repository = new FinancialDataRepository(db, redis);

      const testData: FinancialDataInsert = {
        ipoId: testIPOId,
        ebitdaFy2024: 200.0,
        currentRatio: 1.85,
      };

      await repository.upsert(testData);

      // First fetch - should hit DB and cache
      const firstFetch = await repository.findByIPO(testIPOId);
      expect(firstFetch).toBeDefined();

      // Second fetch - should hit cache
      const secondFetch = await repository.findByIPO(testIPOId);
      expect(secondFetch).toBeDefined();

      // Values should match
      expect(Number(secondFetch!.ebitdaFy2024)).toBe(200.0);
      expect(Number(secondFetch!.currentRatio)).toBe(1.85);
    });

    it('should invalidate cache on update', async () => {
      const repository = new FinancialDataRepository(db, redis);

      // Initial insert
      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2024: 200.0,
      });

      // Fetch to populate cache
      const initial = await repository.findByIPO(testIPOId);
      expect(Number(initial!.ebitdaFy2024)).toBe(200.0);

      // Update
      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2024: 250.0,
      });

      // Fetch again - should get updated value (cache invalidated)
      const updated = await repository.findByIPO(testIPOId);
      expect(Number(updated!.ebitdaFy2024)).toBe(250.0);
    });
  });

  describe('API Endpoint Integration', () => {
    it('should return enhanced financial data via IPO detail API', async () => {
      const ipoRepository = new IPORepository(db, redis);
      const financialRepository = new FinancialDataRepository(db, redis);

      // Insert financial data
      await financialRepository.upsert({
        ipoId: testIPOId,
        revenueFy2022: 1000.0,
        revenueFy2023: 1200.0,
        revenueFy2024: 1500.0,
        ebitdaFy2022: 150.0,
        ebitdaFy2023: 180.0,
        ebitdaFy2024: 225.0,
        totalIncomeFy2024: 1600.0,
        currentRatio: 1.75,
        quickRatio: 1.45,
      });

      // Fetch IPO with relations
      const ipoWithRelations = await ipoRepository.findBySlugWithRelations(testSlug);
      expect(ipoWithRelations).toBeDefined();
      expect(ipoWithRelations?.financialData).toBeDefined();

      const financial = ipoWithRelations!.financialData!;
      expect(Number(financial.ebitdaFy2022)).toBe(150.0);
      expect(Number(financial.ebitdaFy2023)).toBe(180.0);
      expect(Number(financial.ebitdaFy2024)).toBe(225.0);
      expect(Number(financial.currentRatio)).toBe(1.75);
      expect(Number(financial.quickRatio)).toBe(1.45);
    });
  });

  describe('YoY Growth Calculation', () => {
    it('should support accurate YoY growth calculations', async () => {
      const repository = new FinancialDataRepository(db, redis);

      // Insert data for YoY calculation
      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2022: 100.0,
        ebitdaFy2023: 120.0, // +20% growth
        ebitdaFy2024: 150.0, // +25% growth
        totalIncomeFy2022: 1000.0,
        totalIncomeFy2023: 900.0, // -10% decline
        totalIncomeFy2024: 1080.0, // +20% recovery
      });

      const data = await repository.findByIPO(testIPOId);
      expect(data).toBeDefined();

      // Component would calculate:
      // EBITDA FY2023: (120 - 100) / 100 * 100 = 20%
      const ebitdaGrowth2023 = ((Number(data!.ebitdaFy2023!) - Number(data!.ebitdaFy2022!)) / Number(data!.ebitdaFy2022!)) * 100;
      expect(ebitdaGrowth2023).toBeCloseTo(20, 1);

      // EBITDA FY2024: (150 - 120) / 120 * 100 = 25%
      const ebitdaGrowth2024 = ((Number(data!.ebitdaFy2024!) - Number(data!.ebitdaFy2023!)) / Number(data!.ebitdaFy2023!)) * 100;
      expect(ebitdaGrowth2024).toBeCloseTo(25, 1);

      // Total Income FY2023: (900 - 1000) / 1000 * 100 = -10%
      const incomeGrowth2023 = ((Number(data!.totalIncomeFy2023!) - Number(data!.totalIncomeFy2022!)) / Number(data!.totalIncomeFy2022!)) * 100;
      expect(incomeGrowth2023).toBeCloseTo(-10, 1);
    });
  });

  describe('Performance Requirements', () => {
    it('should retrieve enhanced financial data in <50ms from cache', async () => {
      const repository = new FinancialDataRepository(db, redis);

      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2024: 200.0,
        currentRatio: 1.85,
      });

      // Warm up cache
      await repository.findByIPO(testIPOId);

      // Measure cache hit performance
      const start = Date.now();
      const cached = await repository.findByIPO(testIPOId);
      const duration = Date.now() - start;

      expect(cached).toBeDefined();
      expect(duration).toBeLessThan(50); // Story 11.12 requirement: <50ms cache hit
    });

    it('should retrieve enhanced financial data in <100ms from database', async () => {
      const repository = new FinancialDataRepository(db, redis);

      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2024: 200.0,
        currentRatio: 1.85,
      });

      // Clear cache to force DB query
      await redis.flushdb();

      // Measure DB query performance
      const start = Date.now();
      const fromDb = await repository.findByIPO(testIPOId);
      const duration = Date.now() - start;

      expect(fromDb).toBeDefined();
      expect(duration).toBeLessThan(100); // Story 11.12 requirement: <100ms DB query
    });
  });

  describe('Data Validation', () => {
    it('should accept positive decimal values for ratios', async () => {
      const repository = new FinancialDataRepository(db, redis);

      await repository.upsert({
        ipoId: testIPOId,
        currentRatio: 2.45,
        quickRatio: 1.89,
        inventoryTurnover: 6.73,
      });

      const data = await repository.findByIPO(testIPOId);
      expect(Number(data!.currentRatio)).toBe(2.45);
      expect(Number(data!.quickRatio)).toBe(1.89);
      expect(Number(data!.inventoryTurnover)).toBe(6.73);
    });

    it('should store negative EBITDA values (losses)', async () => {
      const repository = new FinancialDataRepository(db, redis);

      await repository.upsert({
        ipoId: testIPOId,
        ebitdaFy2022: -50.0,
        ebitdaFy2023: -25.0,
        ebitdaFy2024: 10.0, // Recovery
      });

      const data = await repository.findByIPO(testIPOId);
      expect(Number(data!.ebitdaFy2022)).toBe(-50.0);
      expect(Number(data!.ebitdaFy2023)).toBe(-25.0);
      expect(Number(data!.ebitdaFy2024)).toBe(10.0);
    });
  });
});
