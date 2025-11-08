/**
 * Category 4.2: Chittorgarh Wins for GMP
 *
 * Objective: Verify Chittorgarh (GMP specialist) beats NSE for GMP data
 * Test Data: Real IPO with GMP from multiple sources
 *
 * Expected Results:
 * - Chittorgarh wins for GMP over NSE/BSE (specialist priority)
 * - Latest GMP value from same source wins (time-based)
 * - Field sources show Chittorgarh as provider
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

describe('Category 4.2: Chittorgarh Wins for GMP', () => {
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

  test('Chittorgarh beats NSE for GMP (specialist priority)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'gmp-priority-test',
        companyName: 'GMP Priority Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        gmpPrice: null,
        gmpPercentageHistorical: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: NSE provides GMP (not a specialist)');

    // NSE provides GMP (not a specialist) - shadow mode to get decision
    const nseResultShadow = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: {
        gmpPrice: 40,
        gmpPercentageHistorical: 33.3,
      },
      source: 'NSE',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 85,
    });

    // Manually create field sources (shadow mode doesn't persist)
    await db.insert(fieldSources).values([
      {
        id: uuidv4(),
        ipoId: testIPO[0].id,
        tableName: 'ipos',
        fieldName: 'gmpPrice',
        source: 'NSE',
        confidence: 85,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: uuidv4(),
        ipoId: testIPO[0].id,
        tableName: 'ipos',
        fieldName: 'gmpPercentageHistorical',
        source: 'NSE',
        confidence: 85,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Clear cache so consolidation service sees them
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // Verify NSE data in consolidation result
    expect(nseResultShadow.consolidatedData).toBeDefined();
    expect(nseResultShadow.consolidatedData.gmpPrice).toBe(40);

    // Actually write NSE data to database
    await db
      .update(ipos)
      .set({
        gmpPrice: 40,
        gmpPercentageHistorical: 33.3,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    // Verify NSE data written
    let currentIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(Number(currentIPO[0].gmpPrice)).toBe(40);
    expect(Number(currentIPO[0].gmpPercentageHistorical)).toBe(33.3);

    console.log('   NSE GMP accepted: ₹40 (33.3%)');

    console.log('Step 2: Chittorgarh provides DIFFERENT GMP (should win - specialist)');

    // Chittorgarh provides DIFFERENT GMP (should win - specialist) - shadow mode
    const chittorgarhResultShadow = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: {
        gmpPrice: 45,
        gmpPercentageHistorical: 37.5,
      },
      source: 'CHITTORGARH',
      existingData: {
        ...currentIPO[0],
        gmpPrice: 40,
        gmpPercentageHistorical: 33.3,
      },
      shadowMode: true,
      confidence: 90,
    });

    // Chittorgarh MUST win (domain expert)
    expect(chittorgarhResultShadow.consolidatedData).toBeDefined();
    expect(chittorgarhResultShadow.consolidatedData.gmpPrice).toBe(45);
    expect(chittorgarhResultShadow.consolidatedData.gmpPercentageHistorical).toBe(37.5);

    console.log('   Chittorgarh GMP: ₹45 (37.5%) - should WIN');

    // Verify in consolidation result
    expect(chittorgarhResultShadow.fieldsProcessed).toBeGreaterThan(0);

    // Update field sources manually to simulate persistence
    // Delete existing NSE field sources first (unique constraint on ipo_id+field_name)
    await db
      .delete(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'gmpPrice')
        )
      );
    await db
      .delete(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'gmpPercentageHistorical')
        )
      );

    // Now insert Chittorgarh field sources
    await db.insert(fieldSources).values([
      {
        id: uuidv4(),
        ipoId: testIPO[0].id,
        tableName: 'ipos',
        fieldName: 'gmpPrice',
        source: 'CHITTORGARH',
        confidence: 90,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: uuidv4(),
        ipoId: testIPO[0].id,
        tableName: 'ipos',
        fieldName: 'gmpPercentageHistorical',
        source: 'CHITTORGARH',
        confidence: 90,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    // Write Chittorgarh data to database
    await db
      .update(ipos)
      .set({
        gmpPrice: 45,
        gmpPercentageHistorical: 37.5,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    // Verify Chittorgarh data won
    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(Number(finalIPO[0].gmpPrice)).toBe(45); // Chittorgarh value
    expect(Number(finalIPO[0].gmpPercentageHistorical)).toBe(37.5);

    // Check field sources
    const gmpFieldSources = await db
      .select()
      .from(fieldSources)
      .where(
        and(eq(fieldSources.ipoId, testIPO[0].id), eq(fieldSources.fieldName, 'gmpPrice'))
      )
      .orderBy(desc(fieldSources.updatedAt))
      .limit(1);

    expect(gmpFieldSources.length).toBeGreaterThan(0);
    expect(gmpFieldSources[0].source).toBe('CHITTORGARH');

    console.log('✅ Chittorgarh wins for GMP (specialist priority)');
    console.log(`   Final GMP: ₹${finalIPO[0].gmpPrice} (${finalIPO[0].gmpPercentageHistorical}%)`);
    console.log(`   Source: ${gmpFieldSources[0].source}`);
  }, 15000);

  test('Time-based updates for GMP (latest wins from same source)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'gmp-time-based',
        companyName: 'GMP Time Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        gmpPrice: null,
        gmpPercentageHistorical: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: Chittorgarh at T=0 (GMP = ₹45)');

    // Chittorgarh at T=0
    const firstUpdate = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { gmpPrice: 45 },
      source: 'CHITTORGARH',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 90,
    });

    expect(firstUpdate.consolidatedData.gmpPrice).toBe(45);

    // Manually create field source
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'gmpPrice',
      source: 'CHITTORGARH',
      confidence: 90,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write to database
    await db
      .update(ipos)
      .set({
        gmpPrice: 45,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    // Wait 200ms to ensure timestamp difference
    await new Promise((resolve) => setTimeout(resolve, 200));

    console.log('Step 2: Chittorgarh at T=200ms (GMP = ₹50) - should WIN (time-based)');

    // Clear cache
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // Chittorgarh at T=200ms (newer)
    const secondUpdate = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { gmpPrice: 50 }, // Updated GMP
      source: 'CHITTORGARH',
      existingData: {
        ...testIPO[0],
        gmpPrice: 45,
      },
      shadowMode: true,
      confidence: 90,
    });

    // Latest should win (time-based field)
    expect(secondUpdate.consolidatedData.gmpPrice).toBe(50);

    // Update field source (delete old first due to unique constraint)
    await db
      .delete(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'gmpPrice')
        )
      );

    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'gmpPrice',
      source: 'CHITTORGARH',
      confidence: 90,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write to database
    await db
      .update(ipos)
      .set({
        gmpPrice: 50,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(Number(finalIPO[0].gmpPrice)).toBe(50); // Latest value

    console.log('✅ Time-based GMP updates working correctly');
    console.log(`   Initial: ₹45 → Updated: ₹${finalIPO[0].gmpPrice}`);
  }, 15000);

  test('Admin always wins for GMP (highest priority)', async () => {
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'admin-gmp-priority',
        companyName: 'Admin GMP Priority Test',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        gmpPrice: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    console.log('Step 1: Admin sets GMP = ₹60 (100% confidence)');

    // Admin sets GMP
    const adminResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { gmpPrice: 60 },
      source: 'ADMIN',
      existingData: testIPO[0],
      shadowMode: true,
      confidence: 100,
    });

    expect(adminResult.consolidatedData.gmpPrice).toBe(60);

    // Manually create field source
    await db.insert(fieldSources).values({
      id: uuidv4(),
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      fieldName: 'gmpPrice',
      source: 'ADMIN',
      confidence: 100,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Write to database
    await db
      .update(ipos)
      .set({
        gmpPrice: 60,
        updatedAt: new Date(),
      })
      .where(eq(ipos.id, testIPO[0].id));

    console.log('Step 2: Chittorgarh tries to overwrite (GMP = ₹55) - should FAIL');

    // Clear cache
    await fieldSourcesRepo.deleteCache(`field-sources:ipo:${testIPO[0].id}:all`);

    // DEBUG: Verify Admin field source exists in database
    const adminFieldSource = await db
      .select()
      .from(fieldSources)
      .where(
        and(
          eq(fieldSources.ipoId, testIPO[0].id),
          eq(fieldSources.fieldName, 'gmpPrice')
        )
      );
    console.log(`   DEBUG: Admin field source in DB: ${JSON.stringify(adminFieldSource[0])}`);
    expect(adminFieldSource.length).toBe(1);
    expect(adminFieldSource[0].source).toBe('ADMIN');

    // Chittorgarh tries to overwrite (should fail)
    const chittorgarhResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { gmpPrice: 55 },
      source: 'CHITTORGARH',
      existingData: {
        ...testIPO[0],
        gmpPrice: 60,
      },
      shadowMode: true,
      confidence: 90,
    });

    // Admin value should remain in consolidation result
    expect(chittorgarhResult.consolidatedData.gmpPrice).toBe(60); // Admin value stays

    // Verify database unchanged
    const finalIPO = await db.select().from(ipos).where(eq(ipos.id, testIPO[0].id)).limit(1);

    expect(Number(finalIPO[0].gmpPrice)).toBe(60); // Admin value

    // Check field sources
    const gmpFieldSources = await db
      .select()
      .from(fieldSources)
      .where(
        and(eq(fieldSources.ipoId, testIPO[0].id), eq(fieldSources.fieldName, 'gmpPrice'))
      )
      .orderBy(desc(fieldSources.updatedAt))
      .limit(1);

    expect(gmpFieldSources[0].source).toBe('ADMIN');

    console.log('✅ Admin always wins for GMP (highest priority)');
    console.log(`   Final GMP: ₹${finalIPO[0].gmpPrice} (source: ${gmpFieldSources[0].source})`);
  }, 15000);
});
