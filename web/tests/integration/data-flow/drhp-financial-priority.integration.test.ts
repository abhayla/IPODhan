/**
 * Category 4.1: DRHP Wins for Financial Data
 *
 * Objective: Verify DRHP beats NSE/BSE for revenue/profit fields
 * Test Data: Real IPO with DRHP document
 *
 * Expected Results:
 * - ✅ DRHP wins over NSE/BSE for financial data
 * - ✅ NSE rejected with LOWER_PRIORITY
 * - ✅ Field sources show DRHP as provider
 * - ✅ Admin can override low-confidence DRHP
 *
 * **Why This Matters**:
 * DRHP (Draft Red Herring Prospectus) is the official regulatory document
 * filed with SEBI. It contains audited financial data that has legal standing.
 * When DRHP provides financial figures, those should ALWAYS beat scraper data
 * from NSE/BSE, because the prospectus is the authoritative source of truth.
 *
 * This test validates the foundation of our data integrity architecture.
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

describe('Category 4.1: DRHP Wins for Financial Data', () => {
  let consolidationService: DataConsolidationService;
  const testIPOIds: string[] = [];

  beforeAll(() => {
    // Initialize consolidation service with repositories
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    const dataConflictsRepo = new DataConflictsRepository(db, redis);
    consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);
  });

  afterAll(async () => {
    // Cleanup: Delete test IPOs
    if (testIPOIds.length > 0) {
      console.log(`\n🧹 Cleaning up ${testIPOIds.length} test IPOs...`);

      for (const ipoId of testIPOIds) {
        // Delete field sources first (foreign key constraint)
        await db.delete(fieldSources).where(eq(fieldSources.ipoId, ipoId));

        // Delete IPO
        await db.delete(ipos).where(eq(ipos.id, ipoId));
      }

      console.log('✅ Cleanup complete');
    }
  });

  test('DRHP beats NSE for revenue/profit (core priority matrix validation)', async () => {
    console.log('\n🧪 Test: DRHP Priority over NSE for Financial Data');

    // Create test IPO with null financial data
    const testIPO = await db.insert(ipos).values({
      id: uuidv4(),
      slug: 'drhp-priority-test-revenue',
      companyName: 'DRHP Priority Test Corp',
      segment: 'MAINBOARD',
      status: 'UPCOMING',
      offeringType: 'IPO',
      revenueFy2024: null,
      profitFy2024: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    testIPOIds.push(testIPO[0].id);
    console.log(`  📝 Created test IPO: ${testIPO[0].companyName} (ID: ${testIPO[0].id.substring(0, 8)}...)`);

    // Simulate DRHP extraction (high confidence - 94%)
    const drhpData = {
      revenueFy2024: 1000000000,  // ₹1000 Cr from DRHP
      profitFy2024: 150000000,     // ₹150 Cr from DRHP
    };

    console.log('  📄 DRHP provides financial data:');
    console.log(`     Revenue FY2024: ₹${(drhpData.revenueFy2024 / 10000000).toFixed(2)} Cr`);
    console.log(`     Profit FY2024: ₹${(drhpData.profitFy2024 / 10000000).toFixed(2)} Cr`);

    const drhpResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: drhpData,
      source: 'DRHP',
      confidence: 94,  // High confidence from automated DRHP parser
      existingData: testIPO[0],
      shadowMode: true  // Shadow mode - returns decisions without writing
    });

    console.log(`  ✅ DRHP consolidation: ${drhpResult.fieldsUpdated} fields updated`);

    // Verify DRHP data chosen in consolidatedData
    expect(drhpResult.consolidatedData).toBeDefined();
    expect(drhpResult.consolidatedData!.revenueFy2024).toBe(1000000000);
    expect(drhpResult.consolidatedData!.profitFy2024).toBe(150000000);
    console.log('  ✅ DRHP values chosen in consolidatedData');

    // NSE provides DIFFERENT values (should lose due to lower priority)
    const nseData = {
      revenueFy2024: 950000000,   // ₹950 Cr (5% lower than DRHP)
      profitFy2024: 140000000,    // ₹140 Cr (₹10 Cr less than DRHP)
    };

    console.log('\n  🌐 NSE attempts to update with different values:');
    console.log(`     Revenue FY2024: ₹${(nseData.revenueFy2024 / 10000000).toFixed(2)} Cr`);
    console.log(`     Profit FY2024: ₹${(nseData.profitFy2024 / 10000000).toFixed(2)} Cr`);

    // Simulate that DRHP data was applied (update existingData for next test)
    const currentIPO = {
      ...testIPO[0],
      revenueFy2024: '1000000000.00',
      profitFy2024: '150000000.00',
    };

    const nseResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: nseData,
      source: 'NSE',
      confidence: 90,  // NSE also has high confidence
      existingData: currentIPO,
      shadowMode: true  // Shadow mode
    });

    console.log(`  🔒 NSE consolidation: ${nseResult.fieldsUpdated} fields updated (should be 0)`);
    console.log(`  ⚠️  Conflicts detected: ${nseResult.conflictsDetected}`);

    // CRITICAL: DRHP MUST win (higher priority in field matrix)
    expect(nseResult.consolidatedData).toBeDefined();
    expect(nseResult.consolidatedData!.revenueFy2024).toBe(1000000000);  // DRHP value retained
    expect(nseResult.consolidatedData!.profitFy2024).toBe(150000000);    // DRHP value retained
    console.log('  ✅ DRHP values retained (NSE rejected)');

    // Verify field results show DRHP as chosen source
    const revenueFieldResult = drhpResult.fieldResults.find(fr => fr.fieldName === 'revenueFy2024');
    expect(revenueFieldResult).toBeDefined();
    expect(revenueFieldResult?.chosenSource).toBe('DRHP');
    expect(revenueFieldResult?.finalValue).toBe(1000000000);
    console.log(`  ✅ Field result: revenueFy2024 → ${revenueFieldResult?.chosenSource} chosen`);

    const profitFieldResult = drhpResult.fieldResults.find(fr => fr.fieldName === 'profitFy2024');
    expect(profitFieldResult).toBeDefined();
    expect(profitFieldResult?.chosenSource).toBe('DRHP');
    expect(profitFieldResult?.finalValue).toBe(150000000);
    console.log(`  ✅ Field result: profitFy2024 → ${profitFieldResult?.chosenSource} chosen`);

    // Verify NSE rejection details in field results
    expect(nseResult.fieldResults.length).toBeGreaterThan(0);

    const nseRevenueResult = nseResult.fieldResults.find(fr => fr.fieldName === 'revenueFy2024');
    expect(nseRevenueResult).toBeDefined();
    expect(nseRevenueResult?.hadConflict).toBe(true);
    expect(nseRevenueResult?.chosenSource).toBe('DRHP'); // DRHP chosen, not NSE

    if (nseRevenueResult?.rejectedSources) {
      const nseRejection = nseRevenueResult.rejectedSources.find(rs => rs.source === 'NSE');
      expect(nseRejection).toBeDefined();
      expect(nseRejection?.reason).toContain('PRIORITY'); // Should mention priority
      console.log(`  ✅ NSE rejection reason: ${nseRejection?.reason}`);
    }

    console.log('\n  🎯 Test Result: DRHP successfully maintains priority over NSE for financial data');
  }, 30000); // 30s timeout

  test('DRHP with low confidence can be overridden by Admin', async () => {
    console.log('\n🧪 Test: Admin Override of Low-Confidence DRHP');

    const testIPO = await db.insert(ipos).values({
      id: uuidv4(),
      slug: 'low-confidence-drhp-test',
      companyName: 'Low Confidence DRHP Test Corp',
      segment: 'MAINBOARD',
      status: 'UPCOMING',
      offeringType: 'IPO',
      revenueFy2024: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    testIPOIds.push(testIPO[0].id);
    console.log(`  📝 Created test IPO: ${testIPO[0].companyName} (ID: ${testIPO[0].id.substring(0, 8)}...)`);

    // DRHP with LOW confidence (60% - below 80% threshold)
    const lowConfidenceDRHPData = {
      revenueFy2024: 500000000,  // ₹500 Cr
    };

    console.log('  📄 DRHP provides data with LOW confidence (60%):');
    console.log(`     Revenue FY2024: ₹${(lowConfidenceDRHPData.revenueFy2024 / 10000000).toFixed(2)} Cr`);

    const drhpResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: lowConfidenceDRHPData,
      source: 'DRHP',
      confidence: 60,  // Below 80% confidence threshold
      existingData: testIPO[0],
      shadowMode: true  // Shadow mode
    });

    // Verify low-confidence DRHP data chosen
    expect(drhpResult.consolidatedData).toBeDefined();
    expect(drhpResult.consolidatedData!.revenueFy2024).toBe(500000000);
    console.log('  ✅ Low-confidence DRHP value chosen in consolidatedData');

    // Simulate that DRHP data was applied
    const currentIPO = {
      ...testIPO[0],
      revenueFy2024: '500000000.00',
    };

    // Admin provides authoritative override
    const adminData = {
      revenueFy2024: 550000000,  // ₹550 Cr (corrected by admin)
    };

    console.log('\n  👤 Admin overrides with corrected value:');
    console.log(`     Revenue FY2024: ₹${(adminData.revenueFy2024 / 10000000).toFixed(2)} Cr`);

    const adminResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: adminData,
      source: 'ADMIN',
      confidence: 100,  // Admin always has 100% confidence
      existingData: currentIPO,
      shadowMode: true  // Shadow mode
    });

    console.log(`  ✅ Admin consolidation: ${adminResult.fieldsUpdated} field(s) updated`);

    // CRITICAL: Admin MUST win (highest priority + 100% confidence)
    expect(adminResult.consolidatedData).toBeDefined();
    expect(adminResult.consolidatedData!.revenueFy2024).toBe(550000000);  // Admin value
    console.log('  ✅ Admin override successful');

    // Verify field result shows ADMIN as chosen source
    const adminRevenueResult = adminResult.fieldResults.find(fr => fr.fieldName === 'revenueFy2024');
    expect(adminRevenueResult).toBeDefined();
    expect(adminRevenueResult?.chosenSource).toBe('ADMIN');
    expect(adminRevenueResult?.finalValue).toBe(550000000);
    console.log(`  ✅ Field result: revenueFy2024 → ${adminRevenueResult?.chosenSource} (100% confidence)`);

    console.log('\n  🎯 Test Result: Admin successfully overrides low-confidence DRHP data');
  }, 30000); // 30s timeout

  test('DRHP beats BSE for profit data (secondary source test)', async () => {
    console.log('\n🧪 Test: DRHP Priority over BSE for Profit Data');

    const testIPO = await db.insert(ipos).values({
      id: uuidv4(),
      slug: 'drhp-vs-bse-profit-test',
      companyName: 'DRHP vs BSE Test Corp',
      segment: 'SME',
      status: 'UPCOMING',
      offeringType: 'IPO',
      profitFy2023: null,
      profitFy2024: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    testIPOIds.push(testIPO[0].id);
    console.log(`  📝 Created test IPO: ${testIPO[0].companyName} (ID: ${testIPO[0].id.substring(0, 8)}...)`);

    // BSE provides profit data first
    const bseData = {
      profitFy2023: 80000000,   // ₹80 Cr
      profitFy2024: 95000000,   // ₹95 Cr
    };

    console.log('  🏦 BSE provides profit data:');
    console.log(`     Profit FY2023: ₹${(bseData.profitFy2023 / 10000000).toFixed(2)} Cr`);
    console.log(`     Profit FY2024: ₹${(bseData.profitFy2024 / 10000000).toFixed(2)} Cr`);

    const bseResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: bseData,
      source: 'BSE',
      confidence: 85,
      existingData: testIPO[0],
      shadowMode: true  // Shadow mode
    });

    // Verify BSE data chosen
    expect(bseResult.consolidatedData).toBeDefined();
    expect(bseResult.consolidatedData!.profitFy2023).toBe(80000000);
    expect(bseResult.consolidatedData!.profitFy2024).toBe(95000000);
    console.log('  ✅ BSE values chosen in consolidatedData');

    // Simulate that BSE data was applied
    const currentIPO = {
      ...testIPO[0],
      profitFy2023: '80000000.00',
      profitFy2024: '95000000.00',
    };

    // DRHP provides DIFFERENT profit values (should win)
    const drhpData = {
      profitFy2023: 82000000,   // ₹82 Cr (₹2 Cr more than BSE)
      profitFy2024: 97000000,   // ₹97 Cr (₹2 Cr more than BSE)
    };

    console.log('\n  📄 DRHP provides different profit data:');
    console.log(`     Profit FY2023: ₹${(drhpData.profitFy2023 / 10000000).toFixed(2)} Cr`);
    console.log(`     Profit FY2024: ₹${(drhpData.profitFy2024 / 10000000).toFixed(2)} Cr`);

    const drhpResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: drhpData,
      source: 'DRHP',
      confidence: 93,
      existingData: currentIPO,
      shadowMode: true  // Shadow mode
    });

    console.log(`  🔄 DRHP consolidation: ${drhpResult.fieldsUpdated} field(s) updated`);
    console.log(`  ⚠️  Conflicts detected: ${drhpResult.conflictsDetected}`);

    // CRITICAL: DRHP MUST win over BSE
    expect(drhpResult.consolidatedData).toBeDefined();
    expect(drhpResult.consolidatedData!.profitFy2023).toBe(82000000);  // DRHP value
    expect(drhpResult.consolidatedData!.profitFy2024).toBe(97000000);  // DRHP value
    console.log('  ✅ DRHP values override BSE values');

    // Verify field results show DRHP as chosen source
    const profitFy2023Result = drhpResult.fieldResults.find(fr => fr.fieldName === 'profitFy2023');
    expect(profitFy2023Result).toBeDefined();
    expect(profitFy2023Result?.chosenSource).toBe('DRHP');
    expect(profitFy2023Result?.finalValue).toBe(82000000);
    console.log(`  ✅ Field result: profitFy2023 → ${profitFy2023Result?.chosenSource}`);

    const profitFy2024Result = drhpResult.fieldResults.find(fr => fr.fieldName === 'profitFy2024');
    expect(profitFy2024Result).toBeDefined();
    expect(profitFy2024Result?.chosenSource).toBe('DRHP');
    expect(profitFy2024Result?.finalValue).toBe(97000000);
    console.log(`  ✅ Field result: profitFy2024 → ${profitFy2024Result?.chosenSource}`);

    console.log('\n  🎯 Test Result: DRHP successfully overrides BSE for profit data');
  }, 30000); // 30s timeout
});
