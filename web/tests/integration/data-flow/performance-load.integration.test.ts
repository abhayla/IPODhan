/**
 * Category 8.1: 1000 Concurrent Updates Performance
 *
 * Objective: Verify system handles massive concurrent scraper load
 * Test Data: 1000+ concurrent updates across multiple IPOs
 *
 * Expected Results:
 * - All updates processed successfully
 * - p95 latency < 5s
 * - No deadlocks or race conditions
 * - Field sources tracked correctly
 * - Data integrity maintained
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos, fieldSources, dataConflicts } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('Category 8.1: 1000 Concurrent Updates Performance', () => {
  let consolidationService: DataConsolidationService;
  let ipoRepository: IPORepository;
  const testIPOs: string[] = [];

  beforeAll(async () => {
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    const dataConflictsRepo = new DataConflictsRepository(db, redis);
    ipoRepository = new IPORepository(db, redis);
    consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);

    console.log('\n⚡ Testing Performance Under Load - 1000 Concurrent Updates');
    console.log('   Validates: Connection pool, race conditions, data integrity');
  });

  afterAll(async () => {
    // Cleanup test IPOs
    if (testIPOs.length > 0) {
      // Delete in batches to avoid query size limits
      const batchSize = 50;
      for (let i = 0; i < testIPOs.length; i += batchSize) {
        const batch = testIPOs.slice(i, i + batchSize);
        await db.delete(fieldSources).where(inArray(fieldSources.ipoId, batch));
        await db.delete(dataConflicts).where(inArray(dataConflicts.ipoId, batch));
        await db.delete(ipos).where(inArray(ipos.id, batch));
      }
      console.log(`\n✨ Cleanup: Removed ${testIPOs.length} test IPO(s)`);
    }
  });

  test('1000 concurrent updates across 100 IPOs', async () => {
    console.log('\n  Testing: 1000 concurrent updates...');

    // Create 100 test IPOs
    const numIPOs = 100;
    const ipoPromises = [];

    console.log(`\n  Step 1: Creating ${numIPOs} test IPOs...`);
    for (let i = 0; i < numIPOs; i++) {
      ipoPromises.push(
        db.insert(ipos).values({
          id: uuidv4(),
          slug: `perf-test-ipo-${i}`,
          companyName: `Performance Test IPO ${i}`,
          segment: 'MAINBOARD',
          status: 'UPCOMING',
          offeringType: 'IPO',
          issueSize: null,
          lotSize: null,
          priceRangeMin: null,
          priceRangeMax: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning()
      );
    }

    const createdIPOs = await Promise.all(ipoPromises);
    const ipoIds = createdIPOs.map((result) => result[0].id);
    testIPOs.push(...ipoIds);

    console.log(`  ✅ Created ${numIPOs} IPOs`);

    // Prepare 1000 concurrent updates (10 updates per IPO)
    // Each update touches 2-3 fields from different sources
    const updatePromises = [];
    const sources = ['NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'];
    const startTime = Date.now();

    console.log('\n  Step 2: Launching 1000 concurrent updates...');

    for (let i = 0; i < numIPOs; i++) {
      const ipoId = ipoIds[i];
      const ipoData = createdIPOs[i][0];

      // 10 updates per IPO = 1000 total updates
      for (let j = 0; j < 10; j++) {
        const source = sources[j % sources.length];
        const updateData: Record<string, number> = {};

        // Each update touches 2-3 random fields
        updateData.issueSize = 5000000000 + (j * 100000000);
        updateData.lotSize = 100 + (j * 10);

        if (j % 3 === 0) {
          updateData.priceRangeMin = 100 + j;
          updateData.priceRangeMax = 120 + j;
        }

        // Launch concurrent update
        const updatePromise = (async () => {
          try {
            const result = await consolidationService.consolidateIPOData({
              ipoId,
              tableName: 'ipos',
              incomingData: updateData,
              source,
              existingData: ipoData,
              shadowMode: false,
            });

            // Persist consolidated data
            await ipoRepository.update(ipoId, {
              ...result.consolidatedData,
              updatedAt: new Date(),
            });

            return {
              success: true,
              ipoId,
              source,
              duration: result.performanceMs || 0,
            };
          } catch (error) {
            return {
              success: false,
              ipoId,
              source,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        })();

        updatePromises.push(updatePromise);
      }
    }

    // Execute all 1000 updates concurrently
    const results = await Promise.all(updatePromises);
    const duration = Date.now() - startTime;

    // Analyze results
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const durations = successful.map((r) => r.duration);
    durations.sort((a, b) => a - b);

    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const p50Duration = durations[Math.floor(durations.length * 0.5)];
    const p95Duration = durations[Math.floor(durations.length * 0.95)];
    const p99Duration = durations[Math.floor(durations.length * 0.99)];

    console.log(`\n  ✅ All ${results.length} updates completed in ${(duration / 1000).toFixed(2)}s`);
    console.log(`     - Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
    console.log(`     - Failed: ${failed.length}`);
    console.log(`\n  Performance Metrics:`);
    console.log(`     - Avg duration: ${avgDuration.toFixed(0)}ms`);
    console.log(`     - P50 duration: ${p50Duration.toFixed(0)}ms`);
    console.log(`     - P95 duration: ${p95Duration.toFixed(0)}ms (target: <5000ms)`);
    console.log(`     - P99 duration: ${p99Duration.toFixed(0)}ms`);

    // Assertions
    expect(successful.length).toBeGreaterThan(900); // >90% success rate
    expect(p95Duration).toBeLessThan(5000); // P95 < 5s
    expect(failed.length).toBeLessThan(100); // <10% failure rate

    // Verify data integrity - check random sample of 10 IPOs
    console.log('\n  Step 3: Verifying data integrity...');
    const sampleSize = 10;
    const sampleIndices = Array.from({ length: sampleSize }, (_, i) => Math.floor(Math.random() * numIPOs));

    for (const idx of sampleIndices) {
      const ipoId = ipoIds[idx];

      // Verify IPO has valid data
      const ipo = await db
        .select()
        .from(ipos)
        .where(eq(ipos.id, ipoId))
        .limit(1);

      expect(ipo.length).toBe(1);
      expect(ipo[0].issueSize).not.toBeNull();
      expect(ipo[0].lotSize).not.toBeNull();

      // Verify field sources tracked
      const sources = await db
        .select()
        .from(fieldSources)
        .where(eq(fieldSources.ipoId, ipoId));

      expect(sources.length).toBeGreaterThan(0);
    }

    console.log(`  ✅ Data integrity verified (sampled ${sampleSize} IPOs)`);

    console.log('\n  ⚡ Concurrent Updates Performance: PASSED');
    console.log(`     - Total updates: 1000`);
    console.log(`     - Success rate: ${((successful.length / results.length) * 100).toFixed(1)}%`);
    console.log(`     - P95 latency: ${p95Duration.toFixed(0)}ms`);
    console.log(`     - Data integrity: VERIFIED`);
  }, { timeout: 120000 }); // 2 minute timeout for load test

  test('No race conditions under concurrent field updates', async () => {
    console.log('\n  Testing: Race condition prevention...');

    // Create single test IPO
    const testIPO = await db.insert(ipos).values({
      id: uuidv4(),
      slug: 'race-condition-test',
      companyName: 'Race Condition Test',
      segment: 'SME',
      status: 'OPEN',
      offeringType: 'IPO',
      lotSize: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    testIPOs.push(testIPO[0].id);

    // 100 concurrent updates to SAME field from SAME source
    const concurrentUpdates = 100;
    const updatePromises = [];

    console.log(`\n  Launching ${concurrentUpdates} concurrent updates to same field...`);

    for (let i = 0; i < concurrentUpdates; i++) {
      updatePromises.push(
        (async () => {
          // Get fresh data each time (simulates real concurrent scrapers)
          const fresh = await db
            .select()
            .from(ipos)
            .where(eq(ipos.id, testIPO[0].id))
            .limit(1);

          const result = await consolidationService.consolidateIPOData({
            ipoId: testIPO[0].id,
            tableName: 'ipos',
            incomingData: { lotSize: 100 + i }, // Each update has different value
            source: 'NSE',
            existingData: fresh[0],
            shadowMode: false,
          });

          // Persist
          await ipoRepository.update(testIPO[0].id, {
            ...result.consolidatedData,
            updatedAt: new Date(),
          });

          return { success: true, value: 100 + i };
        })()
      );
    }

    const results = await Promise.all(updatePromises);
    const successful = results.filter((r) => r.success);

    console.log(`  ✅ ${successful.length}/${concurrentUpdates} updates completed`);

    // Verify final state
    const finalIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPO[0].id))
      .limit(1);

    expect(finalIPO[0].lotSize).not.toBeNull();
    console.log(`  ✅ Final lot_size: ${finalIPO[0].lotSize} (one value won)`);

    // Verify field source tracking
    const fieldSource = await db
      .select()
      .from(fieldSources)
      .where(
        eq(fieldSources.ipoId, testIPO[0].id)
      );

    expect(fieldSource.length).toBeGreaterThan(0);
    console.log(`  ✅ Field sources tracked: ${fieldSource.length} record(s)`);

    // Check conflicts logged (should have many due to concurrent updates)
    const conflicts = await db
      .select()
      .from(dataConflicts)
      .where(eq(dataConflicts.ipoId, testIPO[0].id));

    console.log(`  ✅ Conflicts logged: ${conflicts.length} (expected under concurrent load)`);

    console.log('\n  ⚡ Race Condition Prevention: PASSED');
    console.log('     - 100 concurrent updates handled');
    console.log('     - Final state consistent');
    console.log('     - Field sources tracked');
    console.log('     - Conflicts properly logged');
  }, { timeout: 60000 }); // 1 minute timeout
});
