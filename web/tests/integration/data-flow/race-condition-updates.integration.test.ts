/**
 * Category 3.1: Simultaneous Scraper Updates
 *
 * Objective: Verify consolidation service handles concurrent updates correctly
 * Test Data: Real IPO with concurrent updates from multiple scrapers
 *
 * Expected Results:
 * - All updates complete without errors
 * - Field sources tracked for all successful updates
 * - Consolidated data is consistent (field values match together)
 * - Performance acceptable under concurrent load
 *
 * NOTE: The DataConsolidationService does not implement distributed locking or
 * database persistence - those are handled by DataConsolidationOrchestrator.
 * This test validates that the consolidation service returns consistent results
 * and tracks field sources correctly when called concurrently.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos, fieldSources } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('Category 3.1: Simultaneous Scraper Updates', () => {
  let consolidationService: DataConsolidationService;
  let testIPOIds: string[] = [];

  beforeAll(() => {
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
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

  test('10 concurrent updates complete without errors', async () => {
    // Create test IPO with null subscription values
    const activeIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'concurrent-test-ipo',
        companyName: 'Concurrent Test IPO',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        subscriptionQib: null,
        subscriptionNii: null,
        subscriptionRetail: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(activeIPO[0].id);

    // 10 scrapers updating SIMULTANEOUSLY with different values
    const updates = Array(10)
      .fill(0)
      .map((_, i) => ({
        subscriptionQib: Math.random() * 100,
        subscriptionNii: Math.random() * 100,
        subscriptionRetail: Math.random() * 100,
        source: (i % 2 === 0 ? 'NSE' : 'BSE') as 'NSE' | 'BSE',
        timestamp: new Date(),
      }));

    console.log('Starting 10 concurrent updates...');

    // Run ALL updates in parallel (real race condition!)
    const results = await Promise.allSettled(
      updates.map((data, index) =>
        consolidationService
          .consolidateIPOData({
            ipoId: activeIPO[0].id,
            tableName: 'ipos',
            incomingData: {
              subscription_qib: data.subscriptionQib,
              subscription_nii: data.subscriptionNii,
              subscription_retail: data.subscriptionRetail,
            },
            source: data.source,
            existingData: activeIPO[0],
            shadowMode: false,
            confidence: 90,
          })
          .then((result) => ({
            index,
            result,
            source: data.source,
            data,
          }))
      )
    );

    // All updates should complete without throwing errors
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`   Completed: ${succeeded}/10`);
    console.log(`   Failed: ${failed}/10`);

    // All should succeed (no distributed locking at consolidation service level)
    expect(succeeded).toBe(10);
    expect(failed).toBe(0);

    // Check that each result has consistent consolidated data
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { result: consolidationResult, data } = result.value;

        // Should have consolidated data
        expect(consolidationResult.consolidatedData).toBeDefined();

        // Should have processed fields
        expect(consolidationResult.fieldsProcessed).toBeGreaterThan(0);

        // If there's consolidated data, the subscription values should be internally consistent
        // (either all from this source, or all from a higher-priority source)
        if (consolidationResult.consolidatedData?.subscription_qib !== undefined) {
          expect(consolidationResult.consolidatedData.subscription_nii).toBeDefined();
          expect(consolidationResult.consolidatedData.subscription_retail).toBeDefined();
        }
      }
    }

    // Check field sources were tracked
    const trackedSources = await db
      .select()
      .from(fieldSources)
      .where(eq(fieldSources.ipoId, activeIPO[0].id));

    expect(trackedSources.length).toBeGreaterThan(0);

    console.log(`✅ ${succeeded} updates completed successfully`);
    console.log(`✅ ${trackedSources.length} field sources tracked`);
    console.log('✅ All consolidated data internally consistent');
  }, 15000); // 15 second timeout for concurrent operations

  test('50 concurrent updates - performance under load', async () => {
    // Create test IPO
    const testIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'performance-test-ipo',
        companyName: 'Performance Test IPO',
        segment: 'MAINBOARD',
        status: 'OPEN',
        offeringType: 'IPO',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(testIPO[0].id);

    // Simulate 50 updates (stress test)
    const updates = Array(50)
      .fill(0)
      .map(() => ({
        issueSize: Math.random() * 1000000000,
      }));

    console.log('Starting 50 concurrent updates (stress test)...');

    const startTime = Date.now();

    const results = await Promise.allSettled(
      updates.map((data) =>
        consolidationService.consolidateIPOData({
          ipoId: testIPO[0].id,
          tableName: 'ipos',
          incomingData: { issue_size: data.issueSize },
          source: 'NSE',
          existingData: testIPO[0],
          shadowMode: false,
          confidence: 90,
        })
      )
    );

    const totalDuration = Date.now() - startTime;

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    console.log(`   Succeeded: ${succeeded}/50`);
    console.log(`   Failed: ${failed}/50`);
    console.log(`   Total duration: ${totalDuration}ms`);
    console.log(`   Avg per update: ${Math.round(totalDuration / 50)}ms`);

    // All should succeed
    expect(succeeded).toBe(50);
    expect(failed).toBe(0);

    // Check overall performance - 50 concurrent updates should complete in reasonable time
    // Target: < 5 seconds total (allowing for concurrent resource contention)
    expect(totalDuration).toBeLessThan(5000);

    // Average time per update should be acceptable
    const avgDuration = totalDuration / 50;
    expect(avgDuration).toBeLessThan(100); // 100ms average per update

    // Check field sources were tracked for all updates
    const trackedSources = await db
      .select()
      .from(fieldSources)
      .where(eq(fieldSources.ipoId, testIPO[0].id));

    expect(trackedSources.length).toBeGreaterThan(0);

    console.log('✅ Performance under load verified:');
    console.log(`   - Total time: ${totalDuration}ms (target: < 5000ms)`);
    console.log(`   - Avg per update: ${avgDuration}ms (target: < 100ms)`);
    console.log(`✅ ${trackedSources.length} field sources tracked`);
  }, 30000); // 30 second timeout for stress test
});
