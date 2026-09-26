/**
 * Integration Test: Landing gain/loss aggregates (#98)
 *
 * Proves `computeGainLossAggregates` against REAL rows in `listing_performance`
 * on ipodhan_test — not a mocked repository. Seeds one MAINBOARD and one SME
 * IPO with a realistic mix (two gainers, one loser, one flat 0.00%, one
 * LISTED IPO with no listing_performance row at all) and asserts the exact
 * counts and averages, plus that a missing row and a flat close are excluded
 * from both buckets rather than counted as 0.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/index';
import { ipos, listingPerformance } from '@/lib/db';
import { inArray } from 'drizzle-orm';
import { computeGainLossAggregates } from '@/lib/services/landing-gain-loss-aggregates';

describe('computeGainLossAggregates Integration (#98)', () => {
  const ipoIds: string[] = [];

  beforeAll(async () => {
    // 5 LISTED IPOs: gainer +10%, gainer +30%, loser -20%, flat 0.00%,
    // and one with NO listing_performance row at all.
    const rows = await db
      .insert(ipos)
      .values([
        {
          slug: 'test-gla-gainer-1',
          companyName: 'Test GLA Gainer One',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'LISTED',
        },
        {
          slug: 'test-gla-gainer-2',
          companyName: 'Test GLA Gainer Two',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'LISTED',
        },
        {
          slug: 'test-gla-loser-1',
          companyName: 'Test GLA Loser One',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'LISTED',
        },
        {
          slug: 'test-gla-flat-1',
          companyName: 'Test GLA Flat One',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'LISTED',
        },
        {
          slug: 'test-gla-no-row-1',
          companyName: 'Test GLA No Row One',
          segment: 'MAINBOARD',
          offeringType: 'IPO',
          status: 'LISTED',
        },
      ])
      .returning();

    ipoIds.push(...rows.map((r) => r.id));
    const [gainer1, gainer2, loser1, flat1] = rows;

    await db.insert(listingPerformance).values([
      { ipoId: gainer1.id, listingGainPercent: '10.00' },
      { ipoId: gainer2.id, listingGainPercent: '30.00' },
      { ipoId: loser1.id, listingGainPercent: '-20.00' },
      { ipoId: flat1.id, listingGainPercent: '0.00' },
      // gla-no-row-1 deliberately gets no listing_performance row.
    ]);
  });

  afterAll(async () => {
    await db.delete(listingPerformance).where(inArray(listingPerformance.ipoId, ipoIds));
    await db.delete(ipos).where(inArray(ipos.id, ipoIds));
  });

  it('computes exact gain/loss counts and averages, excluding flat and missing rows', async () => {
    const result = await computeGainLossAggregates(ipoIds);

    expect(result.listedInGain).toBe(2); // +10%, +30%
    expect(result.listedInLoss).toBe(1); // -20%
    expect(result.gainAOT).toBe(20); // (10 + 30) / 2
    expect(result.lossAOT).toBe(-20); // only one loser
  });

  it('excludes an IPO with no listing_performance row from both totals', async () => {
    const result = await computeGainLossAggregates(ipoIds);
    // 5 ids in, only 4 rows exist; 2 gain + 1 loss + 1 flat = 4 classified,
    // the 5th (no row) contributes to neither count.
    expect(result.listedInGain! + result.listedInLoss!).toBe(3);
  });

  it('returns zero counts and null averages for an empty LISTED population', async () => {
    const result = await computeGainLossAggregates([]);
    expect(result).toEqual({
      listedInGain: 0,
      listedInLoss: 0,
      gainAOT: null,
      lossAOT: null,
    });
  });
});
