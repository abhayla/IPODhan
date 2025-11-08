/**
 * Category 6.1: Currency Format Variations
 *
 * Objective: Verify all Indian currency formats normalize to same value
 * Test Data: Real currency strings from scrapers
 *
 * Expected Results:
 * - All currency formats normalize correctly
 * - Equivalent values detected (no false conflicts)
 * - Context-aware conversion (500 → 5000000000 for issueSize)
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { normalizeCurrency } from '../../../../scraper/src/services/normalization-engine';
import { DataConsolidationService } from '../../../../scraper/src/services/data-consolidation-service';
import { FieldSourcesRepository } from '@/lib/repositories/field-sources-repository';
import { DataConflictsRepository } from '@/lib/repositories/data-conflicts-repository';
import { IPORepository } from '@/lib/repositories/ipo-repository';
import { getRedisClient } from '@/lib/cache/redis-client';

describe('Category 6.1: Currency Normalization', () => {
  let consolidationService: DataConsolidationService;
  let ipoRepository: IPORepository;
  const testIPOs: string[] = [];

  beforeAll(async () => {
    const redis = getRedisClient();
    const fieldSourcesRepo = new FieldSourcesRepository(db, redis);
    const dataConflictsRepo = new DataConflictsRepository(db, redis);
    ipoRepository = new IPORepository(db, redis);
    consolidationService = new DataConsolidationService(fieldSourcesRepo, dataConflictsRepo);

    console.log('\n💰 Testing Currency Normalization');
    console.log('   Validates: ₹, Rs., INR, Cr, Lakhs, Million formats');
  });

  afterAll(async () => {
    // Cleanup test IPOs
    if (testIPOs.length > 0) {
      await db.delete(ipos).where(eq(ipos.id, testIPOs[0]));
      console.log(`\n✨ Cleanup: Removed ${testIPOs.length} test IPO(s)`);
    }
  });

  test('All currency formats normalize to same value', () => {
    console.log('\n  Testing: Currency format normalization...');

    // Real currency strings from different scrapers
    const currencyVariations = [
      { input: '₹500 Cr', expected: 5000000000, desc: 'Rupee symbol + Cr' },
      { input: '500 Crores', expected: 5000000000, desc: 'Plain Crores' },
      { input: 'Rs 500 crore', expected: 5000000000, desc: 'Rs + crore' },
      { input: 'INR 500 Cr', expected: 5000000000, desc: 'INR prefix' },
      { input: '500', expected: 5000000000, desc: 'Plain number (context-aware)' },
      { input: '5000000000', expected: 5000000000, desc: 'Already normalized' },
      { input: '₹5,000 Cr', expected: 50000000000, desc: 'With comma separator' },
      { input: '₹500.50 Cr', expected: 5005000000, desc: 'With decimals' },
      { input: '50 Lakh', expected: 5000000, desc: 'Lakhs format' },
      { input: '₹50 Lakhs', expected: 5000000, desc: 'Rupee + Lakhs' },
    ];

    for (const testCase of currencyVariations) {
      // Use snake_case field name as expected by normalization engine
      const normalized = normalizeCurrency(testCase.input, 'issue_size');

      expect(normalized).toBe(testCase.expected);

      console.log(`  ✅ ${testCase.desc}: "${testCase.input}" → ₹${(normalized / 10000000).toFixed(2)} Cr`);
    }

    console.log('\n  💰 Currency Normalization: PASSED');
    console.log('     - 10 format variations tested');
    console.log('     - Context-aware conversion working');
    console.log('     - Decimal and comma handling correct');
  });

  test('Equivalent currency values detected (no false conflicts)', async () => {
    console.log('\n  Testing: Equivalent currency detection...');

    // Create test IPO
    const testIPO = await db.insert(ipos).values({
      id: uuidv4(),
      slug: 'currency-equivalence-test',
      companyName: 'Currency Equivalence Test',
      segment: 'MAINBOARD',
      status: 'UPCOMING',
      offeringType: 'IPO',
      issueSize: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning();

    testIPOs.push(testIPO[0].id);

    // NSE provides: "₹500 Cr" - but we need to pass normalized number
    // The consolidation service expects normalized data, not raw scraper strings
    const nseNormalized = normalizeCurrency('500 Cr', 'issue_size');

    const nseResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { issueSize: nseNormalized },
      source: 'NSE',
      existingData: testIPO[0],
      shadowMode: false,
    });

    // Persist NSE data
    await ipoRepository.update(testIPO[0].id, {
      ...nseResult.consolidatedData,
      updatedAt: new Date(),
    });

    console.log(`  📊 NSE: "500 Cr" → ${nseNormalized} → persisted`);

    // Get fresh data
    const freshIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPO[0].id))
      .limit(1);

    // BSE provides: "500 Crores" (same value, different format)
    const bseNormalized = normalizeCurrency('500 Crores', 'issue_size');

    const bseResult = await consolidationService.consolidateIPOData({
      ipoId: testIPO[0].id,
      tableName: 'ipos',
      incomingData: { issueSize: bseNormalized },
      source: 'BSE',
      existingData: freshIPO[0],
      shadowMode: false,
    });

    // Persist BSE data
    await ipoRepository.update(testIPO[0].id, {
      ...bseResult.consolidatedData,
      updatedAt: new Date(),
    });

    console.log(`  📊 BSE: "500 Crores" → ${bseNormalized} → persisted`);

    // Should detect as EQUIVALENT (no conflict or INFO-level conflict)
    // The consolidation service might still log it, but it won't be a WARNING/CRITICAL
    expect(bseResult.conflictsDetected).toBeLessThanOrEqual(1);

    if (bseResult.conflictsDetected > 0) {
      // If a conflict was detected, verify it's low severity (equivalent values)
      expect(bseResult.conflictsBySeverity.CRITICAL).toBe(0);
      expect(bseResult.conflictsBySeverity.WARNING).toBe(0);
      console.log(`  ✅ Equivalent values: ${bseResult.conflictsDetected} INFO-level conflict logged`);
    } else {
      console.log('  ✅ Equivalent values: No conflicts detected');
    }

    // Verify final value is correct (normalized)
    const finalIPO = await db
      .select()
      .from(ipos)
      .where(eq(ipos.id, testIPO[0].id))
      .limit(1);

    const finalValue = parseFloat(finalIPO[0].issueSize || '0');
    expect(finalValue).toBe(5000000000);
    console.log(`  ✅ Final value: ₹${(finalValue / 10000000).toFixed(2)} Cr (correct)`);

    console.log('\n  💰 Equivalence Detection: PASSED');
    console.log('     - Different formats detected as equivalent');
    console.log('     - No false conflict warnings');
    console.log('     - Value correctly normalized in database');
  });

  test('Context-aware currency conversion', () => {
    console.log('\n  Testing: Context-aware currency conversion...');

    // Small numbers in financial fields should be interpreted as crores
    // Field names must be snake_case as expected by normalization engine
    const contextTests = [
      {
        value: '500',
        field: 'issue_size',
        expected: 5000000000,
        desc: 'issue_size: 500 → 500 Cr'
      },
      {
        value: '1000',
        field: 'revenue',
        expected: 10000000000,
        desc: 'revenue: 1000 → 1000 Cr'
      },
      {
        value: '50',
        field: 'profit',
        expected: 500000000,
        desc: 'profit: 50 → 50 Cr'
      },
      {
        value: '5000000000',
        field: 'issue_size',
        expected: 5000000000,
        desc: 'Already in rupees → unchanged'
      },
    ];

    for (const testCase of contextTests) {
      const normalized = normalizeCurrency(testCase.value, testCase.field);

      expect(normalized).toBe(testCase.expected);

      console.log(`  ✅ ${testCase.desc}: ${testCase.value} → ₹${(normalized / 10000000).toFixed(2)} Cr`);
    }

    console.log('\n  💰 Context-Aware Conversion: PASSED');
    console.log('     - Financial fields auto-convert small numbers to crores');
    console.log('     - Large numbers remain unchanged');
    console.log('     - Field context properly detected');
  });
});
