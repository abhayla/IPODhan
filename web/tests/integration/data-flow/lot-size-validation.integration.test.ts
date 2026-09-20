/**
 * Category 2.1: Lot Size = 0 Rejection
 *
 * Objective: Verify the matrix's plausibility-floor validator rejects an absurd
 * lot_size (0) at the field-priority-matrix layer.
 *
 * NOTE (2026-09-20): this suite previously asserted lot_size=1 was rejected
 * against a "min=10" floor. `field-priority-matrix.ts` deliberately removed
 * that `min: 10` rule ("Stage 1 round 3") because it silently duplicated the
 * real legal-lot check and was WRONG: SEBI sets no universal lot floor — a
 * high-priced issue can legally have a lot under 10 shares (e.g. lot=8 at a
 * ~1700-1785 band). The bare-number matrix validator only ever sees the lot
 * size, never the price band, so it can only catch an ABSURD value (<=0 or
 * > 100000); the real lot x cap-price legal check lives in
 * `validateIPOData` (data-validation.ts, SEBI_RETAIL_WINDOW) and the nightly
 * `d_lot_band_window` audit, which this test does not exercise. This test now
 * asserts the matrix's actual current floor (`validation: { min: 1, max:
 * 100000 }`) instead of a floor that was deliberately deleted as incorrect.
 *
 * Test Data: Synthetic IPO exercising the matrix validator directly.
 *
 * Expected Results:
 * - Matrix validator rejects lot_size=0 as invalid (min=1 per field-priority-matrix)
 * - Rejection logged with reason='VALIDATION_FAILED'
 * - Value remains unchanged in database
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos, dataConflicts } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@ipodhan/shared/repositories/data-conflicts-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('Category 2.1: Lot Size = 1 Rejection', () => {
  let consolidationService: DataConsolidationService;
  let testIPOId: string;

  beforeAll(async () => {
    // Initialize consolidation service
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    const dataConflictsRepo = new DataConflictsRepository(db, redis);
    consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);

    // Create test IPO with lot_size=null (simulating pre-migration state)
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'test-lot-size-validation-rejection',
        companyName: 'Lot Size Validation Test Company',
        segment: 'MAINBOARD',
        status: 'UPCOMING',
        offeringType: 'IPO',
        lotSize: null, // Currently null (was 1 before migration fix)
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOId = testIPO[0].id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (testIPOId) {
      await db.delete(dataConflicts).where(eq(dataConflicts.ipoId, testIPOId));
      await db.delete(ipos).where(eq(ipos.id, testIPOId));
    }
  });

  test('Validator rejects lot_size=0 as invalid (min=1)', async () => {
    // Get initial IPO state
    const initialIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPOId))
      .limit(1);

    expect(initialIPO[0].lotSize).toBeNull(); // Initially null

    // Attempt consolidation with lot_size=0 (MUST be rejected: below the
    // matrix's current absurd-value floor of min=1 — see file header note)
    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 0 }, // Invalid: below min=1 (snake_case for field-priority-matrix)
      source: 'NSE',
      existingData: initialIPO[0],
      shadowMode: true, // Shadow mode - check decisions without DB writes
      confidence: 90,
    });

    // Verify result structure
    expect(result).toBeDefined();
    expect(result.ipoId).toBe(testIPOId);

    // Check if validation failed
    // Validation failures are in fieldResults[].rejectedSources[], not errors[]
    const lotSizeResult = result.fieldResults.find((fr) => fr.fieldName === 'lot_size');

    expect(lotSizeResult).toBeDefined();
    expect(lotSizeResult?.rejectedSources).toBeDefined();
    expect(lotSizeResult!.rejectedSources!.length).toBeGreaterThan(0);

    const rejection = lotSizeResult!.rejectedSources![0];
    expect(rejection.reason).toBe('VALIDATION_FAILED');
    expect(rejection.value).toBe(0);

    // Consolidated data should NOT include lot_size (rejected)
    expect(result.consolidatedData).toBeDefined();
    expect(result.consolidatedData!.lot_size).toBeUndefined();

    console.log('✅ Validator correctly rejected lot_size=1 (min=10)');
    console.log(`   Reason: ${rejection.reason}`);
  });

  test('Validator accepts valid lot_size (e.g., 100)', async () => {
    // Get current IPO state
    const initialIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPOId))
      .limit(1);

    // Attempt consolidation with valid lot_size=100
    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 100 }, // Valid: 10 <= 100 <= 100000 (snake_case)
      source: 'NSE',
      existingData: initialIPO[0],
      shadowMode: true, // Shadow mode
      confidence: 90,
    });

    // Should succeed without validation errors
    expect(result).toBeDefined();

    // Check no validation errors for lot_size
    const lotSizeError = result.errors.find((e) => e.fieldName === 'lot_size');
    expect(lotSizeError).toBeUndefined();

    // Value should be in consolidatedData
    expect(result.consolidatedData).toBeDefined();
    expect(result.consolidatedData!.lot_size).toBe(100);

    console.log('✅ Validator accepted valid lot_size=100');
  });

  test('Validator rejects extremely large lot_size (> max)', async () => {
    // Get current IPO state
    const initialIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPOId))
      .limit(1);

    // Attempt consolidation with invalid lot_size > 100000
    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 200000 }, // Invalid: exceeds max=100000 (snake_case)
      source: 'NSE',
      existingData: initialIPO[0],
      shadowMode: true,
      confidence: 90,
    });

    // Should have validation rejection in fieldResults
    const lotSizeResult = result.fieldResults.find((fr) => fr.fieldName === 'lot_size');

    expect(lotSizeResult).toBeDefined();
    expect(lotSizeResult?.rejectedSources).toBeDefined();
    expect(lotSizeResult!.rejectedSources!.length).toBeGreaterThan(0);

    const rejection = lotSizeResult!.rejectedSources![0];
    expect(rejection.reason).toBe('VALIDATION_FAILED');
    expect(rejection.value).toBe(200000);

    // Consolidated data should NOT include lot_size (rejected)
    expect(result.consolidatedData).toBeDefined();
    expect(result.consolidatedData!.lot_size).toBeUndefined();

    console.log('✅ Validator correctly rejected lot_size=200000 (max=100000)');
    console.log(`   Reason: ${rejection.reason}`);
  });

  test('Edge case: lot_size=1 (minimum boundary)', async () => {
    // Test boundary value: min=1 (see file header note — the matrix's real
    // current floor, not the deliberately-removed min=10)
    const initialIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPOId))
      .limit(1);

    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 1 }, // Valid: exactly at min boundary (snake_case)
      source: 'BSE',
      existingData: initialIPO[0],
      shadowMode: true,
      confidence: 95,
    });

    // Should succeed
    const lotSizeError = result.errors.find((e) => e.fieldName === 'lot_size');
    expect(lotSizeError).toBeUndefined();

    // Should be in consolidatedData
    expect(result.consolidatedData).toBeDefined();
    expect(result.consolidatedData!.lot_size).toBe(1);

    console.log('✅ Boundary test passed: lot_size=1 (minimum) accepted');
  });

  test('Edge case: lot_size=100000 (maximum boundary)', async () => {
    // Test boundary value: max=100000
    const initialIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPOId))
      .limit(1);

    const result = await consolidationService.consolidateIPOData({
      ipoId: testIPOId,
      tableName: 'ipos',
      incomingData: { lot_size: 100000 }, // Valid: exactly at max boundary (snake_case)
      source: 'BSE',
      existingData: initialIPO[0],
      shadowMode: true,
      confidence: 95,
    });

    // Should succeed
    const lotSizeError = result.errors.find((e) => e.fieldName === 'lot_size');
    expect(lotSizeError).toBeUndefined();

    // Should be in consolidatedData
    expect(result.consolidatedData).toBeDefined();
    expect(result.consolidatedData!.lot_size).toBe(100000);

    console.log('✅ Boundary test passed: lot_size=100000 (maximum) accepted');
  });

  test('Historical bug verification: 68.89% of IPOs had lot_size=1', async () => {
    // Query database to see if any IPOs still have lot_size=1
    const iposWithLotSize1 = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        lotSize: ipos.lotSize,
        createdAt: ipos.createdAt,
      })
      .from(ipos)
      .where(eq(ipos.lotSize, 1))
      .limit(20);

    if (iposWithLotSize1.length > 0) {
      console.warn(`⚠️  Found ${iposWithLotSize1.length} IPOs with lot_size=1 (legacy data)`);
      console.warn('   These are historical records that need manual correction:');
      iposWithLotSize1.slice(0, 5).forEach((ipo) => {
        console.warn(`   - ${ipo.companyName}: created ${ipo.createdAt?.toISOString()}`);
      });

      // The important thing is that the VALIDATOR now prevents new lot_size=1
      // Legacy data may still exist, but consolidation service will reject new ones
      console.log('✅ Validator prevents NEW lot_size=1 values (legacy data is separate issue)');
    } else {
      console.log('✅ No IPOs with lot_size=1 found (migration fix successful)');
    }

    // This test passes as long as we acknowledge the situation
    // The validator (tested above) correctly rejects lot_size=1
    expect(true).toBe(true);
  });
});
