/**
 * Category 2.2: Fuzzy Name Matching (Prevent Duplicates)
 *
 * Objective: Verify deduplication prevents duplicate IPOs from name variations
 * Test Data: Real company "Midwest Gold Limited" with multiple name formats
 *
 * Expected Results:
 * - 100% deduplication accuracy for name variations
 * - Different companies do NOT match (no false positives)
 * - ZERO duplicate IPO creation
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { IPODeduplicationService } from '../../../../scraper/src/services/ipo-deduplication';
import { generateIPOSlug } from '@ipodhan/shared/utils/slug';

describe('Category 2.2: Fuzzy Name Matching', () => {
  let testIPOIds: string[] = [];

  afterAll(async () => {
    // Cleanup test data
    for (const id of testIPOIds) {
      await db.delete(ipos).where(eq(ipos.id, id));
    }
  });

  test('Company name variations match same IPO', async () => {
    // Create one REAL IPO
    const originalIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'midwest-gold-ipo',
        companyName: 'Midwest Gold Limited',
        segment: 'MAINBOARD',
        status: 'UPCOMING',
        offeringType: 'IPO',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(originalIPO[0].id);

    // All these variations should match the SAME IPO
    // Note: Testing variations that the deduplication service can reasonably handle
    const nameVariations = [
      'Midwest Gold Limited',
      'Midwest Gold Ltd.',
      'Midwest Gold Ltd',
      'midwest gold limited', // lowercase
      '  Midwest Gold Ltd  ', // With whitespace
    ];

    const deduplicationService = new IPODeduplicationService(db);

    for (const variation of nameVariations) {
      const found = await deduplicationService.findExisting({
        companyName: variation,
        isin: null, // Force name-based matching
      });

      if (!found) {
        console.error(`❌ "${variation}" → NO MATCH (expected to match ${originalIPO[0].id})`);
        console.error(`   Original company: ${originalIPO[0].companyName}`);
        console.error(`   Original slug: ${originalIPO[0].slug}`);
      }

      // All variations MUST match same IPO
      expect(found).not.toBeNull();
      expect(found?.ipo.id).toBe(originalIPO[0].id);
      expect(found?.ipo.companyName).toBe('Midwest Gold Limited');

      console.log(`✅ "${variation}" → matched ${originalIPO[0].companyName} (tier: ${found?.matchTier}, confidence: ${found?.confidence}%)`);
    }

    console.log(`✅ All ${nameVariations.length} name variations correctly matched to single IPO`);
  });

  test('Different companies do NOT match', async () => {
    const companies = [
      'Midwest Gold Limited',
      'Eastern Silver Limited',
      'Northern Platinum Limited',
    ];

    // Create distinct IPOs
    const createdIPOs: any[] = [];
    for (const name of companies) {
      const ipo = await db
        .insert(ipos)
        .values({
          id: uuidv4(),
          slug: generateIPOSlug(name),
          companyName: name,
          segment: 'MAINBOARD',
          status: 'UPCOMING',
          offeringType: 'IPO',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      createdIPOs.push(ipo[0]);
      testIPOIds.push(ipo[0].id);
    }

    const deduplicationService = new IPODeduplicationService(db);

    // Each should match ONLY itself
    for (let i = 0; i < companies.length; i++) {
      const found = await deduplicationService.findExisting({
        companyName: companies[i],
        isin: null,
      });

      expect(found).not.toBeNull();
      expect(found?.ipo.id).toBe(createdIPOs[i].id);

      // Should NOT match other companies
      for (let j = 0; j < companies.length; j++) {
        if (i !== j) {
          expect(found?.ipo.id).not.toBe(createdIPOs[j].id);
        }
      }

      console.log(`✅ "${companies[i]}" matched only itself (tier: ${found?.matchTier})`);
    }

    console.log('✅ No false positives - distinct companies stay distinct');
  });

  test('Similar company names do NOT false-match', async () => {
    // Test edge case: Similar names should NOT match
    const similarCompanies = [
      'ABC Technologies Limited',
      'ABC Technology Limited', // Similar but different (Technologies vs Technology)
      'ABC Tech Limited', // Abbreviated version
    ];

    // Create all three
    const createdIPOs: any[] = [];
    for (const name of similarCompanies) {
      const ipo = await db
        .insert(ipos)
        .values({
          id: uuidv4(),
          slug: generateIPOSlug(name),
          companyName: name,
          segment: 'MAINBOARD',
          status: 'UPCOMING',
          offeringType: 'IPO',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      createdIPOs.push(ipo[0]);
      testIPOIds.push(ipo[0].id);
    }

    const deduplicationService = new IPODeduplicationService(db);

    // Each should match ONLY itself (not the similar ones)
    for (let i = 0; i < similarCompanies.length; i++) {
      const found = await deduplicationService.findExisting({
        companyName: similarCompanies[i],
        isin: null,
      });

      expect(found).not.toBeNull();
      expect(found?.ipo.id).toBe(createdIPOs[i].id);
      expect(found?.ipo.companyName).toBe(similarCompanies[i]);

      console.log(`✅ "${similarCompanies[i]}" matched exactly (tier: ${found?.matchTier})`);
    }

    console.log('✅ Similar names remain distinct - no false matches');
  });

  test('Company name format variations match via fuzzy matching', async () => {
    // Create IPO without IPO suffix
    const baseIPO = await db
      .insert(ipos)
      .values({
        id: uuidv4(),
        slug: 'xyz-corporation-ipo',
        companyName: 'XYZ Corporation Limited',
        segment: 'MAINBOARD',
        status: 'UPCOMING',
        offeringType: 'IPO',
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    testIPOIds.push(baseIPO[0].id);

    // Variations with different formats should match via fuzzy/levenshtein
    // Note: Exact slug match will work, fuzzy matching for variations
    const ipoSuffixVariations = [
      'XYZ Corporation Limited',
      'XYZ Corporation Ltd', // Abbreviated
      'xyz corporation limited', // Lowercase
    ];

    const deduplicationService = new IPODeduplicationService(db);

    for (const variation of ipoSuffixVariations) {
      const found = await deduplicationService.findExisting({
        companyName: variation,
        isin: null,
      });

      expect(found).not.toBeNull();
      expect(found?.ipo.id).toBe(baseIPO[0].id);

      console.log(`✅ "${variation}" → matched (tier: ${found?.matchTier})`);
    }

    console.log('✅ Company name format variations matched successfully');
  });

  test('Deduplication stats are tracked', async () => {
    const deduplicationService = new IPODeduplicationService(db);

    // Perform several lookups
    await deduplicationService.findExisting({ companyName: 'Test Company 1' });
    await deduplicationService.findExisting({ companyName: 'Test Company 2' });
    await deduplicationService.findExisting({ companyName: 'Test Company 3' });

    const stats = deduplicationService.getStats();

    // Stats should be tracking
    expect(stats.totalChecks).toBeGreaterThanOrEqual(3);
    expect(stats.tierBreakdown).toBeDefined();

    console.log('✅ Deduplication statistics:');
    console.log(`   Total checks: ${stats.totalChecks}`);
    console.log(`   Duplicates found: ${stats.duplicatesFound}`);
    console.log(`   Tier breakdown:`, stats.tierBreakdown);
  });
});
