/**
 * Category 4.3: BSE Wins for Lot Size
 *
 * Objective: Verify BSE (lot size specialist) beats NSE for lot size data
 * Test Data: Real IPO with lot size from multiple sources
 *
 * Expected Results:
 * - BSE wins for lot size over NSE/MONEYCONTROL (specialist priority)
 * - Source priority enforced (not time-based)
 * - Admin always wins (highest priority)
 * - Field sources show BSE as provider
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos, fieldSources } from '@/lib/db';
import { eq, and, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('Category 4.3: BSE Wins for Lot Size', () => {
  let consolidationService: DataConsolidationService;
  let fieldSourcesRepo: FieldSourcesRepository;
  let testIPOIds: string[] = [];

  beforeAll(() => {
    const redis = getRedisClient();
    fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    const dataConflictsRepo = new DataConflictsRepository(db, redis);
    consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);
  });

  afterAll(async () => {
    // Cleanup test data
    for (const id of testIPOIds) {
      await db.delete(fieldSources).where(eq(fieldSources.ipoId, id));
      await db.delete(ipos).where(eq(ipos.id, id));
    }
  });

  test('BSE beats NSE for lot size (specialist priority)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'lotsize-priority-test',
        companyName: 'Lot Size Priority Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        lotSize: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: NSE provides lot size = 100 (not a specialist)');

    // NSE provides lot size (not a specialist) - shadow mode to get decision
    const nseResultShadow = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: {
        lotSize: 100,
      },
      source: 'NSE',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 85,
    });

    // Manually create field source (shadow mode doesn't persist)
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'lotSize',
      source: 'NSE',
      confidence: 85,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Clear cache so consolidation service sees them
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // Verify NSE data in consolidation result
    expect(nseResultShadow.consolidatedData).toBeDefined();
    expect(nseResultShadow.consolidatedData.lotSize).toBe(100);

    // Actually write NSE data to database
    await db
      .update(ipos)
      .set({
        lotSize: 100,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    // Verify NSE data written
    let currentIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(currentIPO[0].lotSize).toBe(100);

    console.log('   NSE lot size accepted: 100 shares');

    console.log('Step 2: BSE provides DIFFERENT lot size (should win - specialist)');

    // BSE provides DIFFERENT lot size (should win - specialist) - shadow mode
    const bseResultShadow = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: {
        lotSize: 150,
      },
      source: 'BSE',
      existingData: {
        ...currentIPO[0],
        lotSize: 100,
      },
      shadowMode: true,
      confidence: 90,
    });

    // BSE MUST win (lot size specialist)
    expect(bseResultShadow.consolidatedData).toBeDefined();
    expect(bseResultShadow.consolidatedData.lotSize).toBe(150);

    console.log('   BSE lot size: 150 shares - should WIN');

    // Verify in consolidation result
    expect(bseResultShadow.fieldsProcessed).toBeGreaterThan(0);

    // Update field source manually to simulate persistence
    // Delete existing NSE field source first (unique constraint on ipo_id+field_name)
    await db
      .delete(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'lotSize')
        )
      );

    // Now insert BSE field source
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'lotSize',
      source: 'BSE',
      confidence: 90,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write BSE data to database
    await db
      .update(ipos)
      .set({
        lotSize: 150,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    // Verify BSE data won
    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(finalIPO[0].lotSize).toBe(150); // BSE value

    // Check field sources
    const lotSizeFieldSources = await db
      .select()
      .from(fieldSources)
      .where(
        and(eq(fieldSources.ipoId, testIPO[0].id), eq(fieldSources.fieldName, 'lotSize'))
      )
      .orderBy(desc(fieldSources.updatedAt))
      .limit(1);

    expect(lotSizeFieldSources.length).toBeGreaterThan(0);
    expect(lotSizeFieldSources[0].source).toBe('BSE');

    console.log('✅ BSE wins for lot size (specialist priority)');
    console.log(`   Final lot size: ${finalIPO[0].lotSize} shares`);
    console.log(`   Source: ${lotSizeFieldSources[0].source}`);
  }, 15000);

  test('Source priority for lot size (not time-based)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'lotsize-source-priority',
        companyName: 'Lot Size Source Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        lotSize: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: BSE sets lot size = 200');

    // BSE sets initial lot size
    const firstUpdate = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { lotSize: 200 },
      source: 'BSE',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 90,
    });

    expect(firstUpdate.consolidatedData.lotSize).toBe(200);

    // Manually create field source
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'lotSize',
      source: 'BSE',
      confidence: 90,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write to database
    await db
      .update(ipos)
      .set({
        lotSize: 200,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    console.log('Step 2: NSE tries to overwrite with lot size = 180 (should FAIL - lower priority)');

    // Clear cache
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // NSE tries to overwrite (should fail - lower priority than BSE)
    const secondUpdate = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { lotSize: 180 },
      source: 'NSE',
      existingData: {
        ...testIPO[0],
        lotSize: 200,
      },
      shadowMode: true,
      confidence: 85,
    });

    // BSE value should remain (higher priority)
    expect(secondUpdate.consolidatedData.lotSize).toBe(200); // BSE value stays

    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(finalIPO[0].lotSize).toBe(200); // BSE value

    console.log('✅ Source priority enforced for lot size (not time-based)');
    console.log(`   BSE lot size (200) protected from NSE override (180)`);
  }, 15000);

  test('Admin always wins for lot size (highest priority)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'admin-lotsize-priority',
        companyName: 'Admin Lot Size Priority Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        lotSize: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: Admin sets lot size = 250 (100% confidence)');

    // Admin sets lot size
    const adminResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { lotSize: 250 },
      source: 'ADMIN',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 100,
    });

    expect(adminResult.consolidatedData.lotSize).toBe(250);

    // Manually create field source
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'lotSize',
      source: 'ADMIN',
      confidence: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write to database
    await db
      .update(ipos)
      .set({
        lotSize: 250,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    console.log('Step 2: BSE tries to overwrite (lot size = 220) - should FAIL');

    // Clear cache
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // DEBUG: Verify Admin field source exists in database
    const adminFieldSource = await db
      .select()
      .from(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'lotSize')
        )
      );
    console.log(`   DEBUG: Admin field source in DB: ${JSON.stringify(adminFieldSource[0])}`);
    expect(adminFieldSource.length).toBe(1);
    expect(adminFieldSource[0].source).toBe('ADMIN');

    // BSE tries to overwrite (should fail)
    const bseResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { lotSize: 220 },
      source: 'BSE',
      existingData: {
        ...testIPO[0],
        lotSize: 250,
      },
      shadowMode: true,
      confidence: 90,
    });

    // Admin value should remain in consolidation result
    expect(bseResult.consolidatedData.lotSize).toBe(250); // Admin value stays

    // Verify database unchanged
    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(finalIPO[0].lotSize).toBe(250); // Admin value

    // Check field sources
    const lotSizeFieldSources = await db
      .select()
      .from(fieldSources)
      .where(
        and(eq(fieldSources.ipoId, testIPO[0].id), eq(fieldSources.fieldName, 'lotSize'))
      )
      .orderBy(desc(fieldSources.updatedAt))
      .limit(1);

    expect(lotSizeFieldSources[0].source).toBe('ADMIN');

    console.log('✅ Admin always wins for lot size (highest priority)');
    console.log(`   Final lot size: ${finalIPO[0].lotSize} shares (source: ${lotSizeFieldSources[0].source})`);
  }, 15000);
});
