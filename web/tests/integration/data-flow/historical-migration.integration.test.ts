/**
 * Category 1.1: Historical Data Migration Validation
 *
 * Objective: Verify Phase 0 backfill populated field_sources for existing IPOs
 * Test Data: All existing production IPOs created before 2025-11-07
 *
 * Expected Results:
 * - All existing IPOs have field_sources entries
 * - Confidence scores: ADMIN=100%, API_FALLBACK=60%, NSE/BSE/DRHP=90-95%
 * - Zero NULL source tracking for active fields
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { ipos, fieldSources } from '@/lib/db';
import { sql, eq, and, desc, lt } from 'drizzle-orm';

describe('Category 1.1: Historical Data Migration', () => {
  let testIPOs: any[] = [];

  beforeAll(async () => {
    // Query REAL production data created before 2025-11-07
    testIPOs = await db
      .select({
        id: ipos.id,
        companyName: ipos.companyName,
        createdAt: ipos.createdAt,
        status: ipos.status,
      })
      .from(ipos)
      .where(sql`created_at < '2025-11-07'`)
      .orderBy(desc(ipos.createdAt))
      .limit(100); // Test first 100 for performance

    console.log(`\n📊 Testing ${testIPOs.length} real IPOs from production database`);
  });

  test('All existing IPOs have field_sources entries', async () => {
    // Track statistics
    const stats = {
      total: testIPOs.length,
      withFieldSources: 0,
      withoutFieldSources: 0,
      totalFieldsTracked: 0,
    };

    for (const ipo of testIPOs) {
      // Every IPO should have field source tracking
      const fieldSourcesForIPO = await db
        .select()
        .from(fieldSources)
        .where(eq(fieldSources.ipoId, ipo.id));

      if (fieldSourcesForIPO.length > 0) {
        stats.withFieldSources++;
        stats.totalFieldsTracked += fieldSourcesForIPO.length;
      } else {
        stats.withoutFieldSources++;
        console.warn(`⚠️  IPO without field sources: ${ipo.companyName} (${ipo.id})`);
      }

      // Must have at least one field tracked
      expect(fieldSourcesForIPO.length).toBeGreaterThan(0);

      // Check source values are valid (from scraperSourceEnum)
      const sources = fieldSourcesForIPO.map(fs => fs.source);
      const validSources = ['ADMIN', 'DRHP', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH', 'API_FALLBACK'];

      for (const source of sources) {
        expect(validSources).toContain(source);
      }

      // Check confidence scores
      for (const fs of fieldSourcesForIPO) {
        expect(fs.confidence).toBeGreaterThanOrEqual(0);
        expect(fs.confidence).toBeLessThanOrEqual(100);

        // Verify confidence by source type
        if (fs.source === 'ADMIN') {
          expect(fs.confidence).toBe(100);
        }
        // Historical data (backfilled) should have 60% confidence
        if (fs.source === 'API_FALLBACK') {
          expect(fs.confidence).toBe(60);
        }
        // NSE/BSE from scrapers should be 90-100%
        if (fs.source === 'NSE' || fs.source === 'BSE') {
          expect(fs.confidence).toBeGreaterThanOrEqual(90);
          expect(fs.confidence).toBeLessThanOrEqual(100);
        }
      }
    }

    // Print statistics
    console.log(`\n✅ Field Sources Statistics:`);
    console.log(`   Total IPOs tested: ${stats.total}`);
    console.log(`   IPOs with field sources: ${stats.withFieldSources}`);
    console.log(`   IPOs without field sources: ${stats.withoutFieldSources}`);
    console.log(`   Total fields tracked: ${stats.totalFieldsTracked}`);
    console.log(`   Average fields per IPO: ${(stats.totalFieldsTracked / stats.withFieldSources).toFixed(2)}`);

    // All IPOs should have field sources
    expect(stats.withFieldSources).toBe(stats.total);
    expect(stats.withoutFieldSources).toBe(0);
  });

  test('No NULL source tracking for active fields', async () => {
    // Check that no IPOs have NULL or empty field_sources metadata
    // Note: The field_sources table tracks each field individually,
    // so we're checking that important fields have source tracking

    const iposWithoutFieldSources: any[] = [];

    for (const ipo of testIPOs.slice(0, 50)) {  // Test subset for performance
      const fieldSourcesForIPO = await db
        .select()
        .from(fieldSources)
        .where(eq(fieldSources.ipoId, ipo.id));

      if (fieldSourcesForIPO.length === 0) {
        iposWithoutFieldSources.push(ipo);
      }
    }

    // Should have zero IPOs without field sources
    if (iposWithoutFieldSources.length > 0) {
      console.error(`\n❌ ${iposWithoutFieldSources.length} IPOs without field sources:`);
      iposWithoutFieldSources.slice(0, 5).forEach(ipo => {
        console.error(`   - ${ipo.companyName} (${ipo.id})`);
      });
    }

    expect(iposWithoutFieldSources.length).toBe(0);
  });

  test('Field source distribution is reasonable', async () => {
    // Aggregate field source statistics across all test IPOs
    const sourceDistribution: Record<string, number> = {};
    let totalFields = 0;

    for (const ipo of testIPOs.slice(0, 50)) {  // Test subset
      const fieldSourcesForIPO = await db
        .select()
        .from(fieldSources)
        .where(eq(fieldSources.ipoId, ipo.id));

      for (const fs of fieldSourcesForIPO) {
        sourceDistribution[fs.source] = (sourceDistribution[fs.source] || 0) + 1;
        totalFields++;
      }
    }

    console.log(`\n📊 Source Distribution:`);
    Object.entries(sourceDistribution)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        const percentage = ((count / totalFields) * 100).toFixed(2);
        console.log(`   ${source}: ${count} (${percentage}%)`);
      });

    // For historical data (backfilled), API_FALLBACK should be dominant
    const apiFallbackCount = sourceDistribution['API_FALLBACK'] || 0;
    const apiFallbackPercentage = (apiFallbackCount / totalFields) * 100;

    const nseCount = sourceDistribution['NSE'] || 0;
    const bseCount = sourceDistribution['BSE'] || 0;
    const exchangePercentage = ((nseCount + bseCount) / totalFields) * 100;

    console.log(`\n   API_FALLBACK (historical): ${apiFallbackPercentage.toFixed(2)}%`);
    console.log(`   NSE + BSE combined: ${exchangePercentage.toFixed(2)}%`);

    // For backfilled historical data, expect API_FALLBACK to be majority
    // (since most IPOs were created before Phase 0 implementation)
    expect(apiFallbackPercentage).toBeGreaterThan(50);
  });
});
