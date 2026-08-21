/**
 * GitHub #139 — listing-performance planning core.
 *
 * Root cause: the updater read `nseData.listingPrice`, a field NSE's
 * /api/public-past-issues has NEVER returned (verified live: 0 of 1411 records
 * carry it). So `listing_price` and `listing_gain_percent` were null for EVERY
 * IPO, and prod's NOT NULL columns rejected all 243 upserts, every cycle.
 *
 * The fix sources the real day-1 close from Chittorgarh report-25 and SKIPS an
 * IPO with no usable price instead of attempting a doomed all-null write.
 */
import { describe, it, expect } from 'vitest';
import { planListingPerformanceUpdates } from '../../../src/scrapers/listing-performance-plan.js';
import type { ChittorgarhListingRow } from '../../../src/scrapers/chittorgarh-listing-scraper.js';
import type { StuckIpo } from '../../../src/services/listing-reconciliation.js';

const ipo = (over: Partial<StuckIpo> = {}): StuckIpo => ({
  id: 'ipo-1',
  companyName: 'Shiprocket Ltd.',
  slug: 'shiprocket-ltd',
  symbol: 'SHIPROCKET',
  isin: 'INE0TEST01011',
  segment: 'MAINBOARD',
  offeringType: 'IPO',
  status: 'LISTED',
  openDate: '2026-08-12',
  closeDate: '2026-08-14',
  listingDate: '2026-08-19',
  priceRangeMax: 97,
  issueSize: 100,
  ...over,
});

const cgRow = (over: Partial<ChittorgarhListingRow> = {}): ChittorgarhListingRow => ({
  companyName: 'Shiprocket Ltd.',
  slug: 'shiprocket-ltd',
  isin: 'INE0TEST01011',
  bseScripCode: '544999',
  nseSymbol: 'SHIPROCKET',
  listingDate: '19-Aug-2026',
  issuePrice: 97,
  listingClose: 122.5,
  listingGainPct: 26.29,
  currentBse: 130,
  currentNse: 130.4,
  currentGainPct: 34.02,
  ...over,
});

describe('planListingPerformanceUpdates (#139)', () => {
  it('produces a record with a REAL day-1 listing price, never null', () => {
    const { records } = planListingPerformanceUpdates([ipo()], [cgRow()]);

    expect(records).toHaveLength(1);
    expect(records[0].record.listingPrice).toBe(122.5);
    expect(records[0].record.issuePrice).toBe(97);
    // (122.5 - 97) / 97 * 100 = 26.29%
    expect(records[0].record.listingGainPercent).toBe('26.29');
  });

  it('NEVER emits a record whose listing_price is null (the 23502 that broke prod)', () => {
    const { records } = planListingPerformanceUpdates(
      [ipo(), ipo({ id: 'ipo-2', companyName: 'No Match Ltd.', slug: 'no-match', isin: 'INE0NOMATCH1', symbol: 'NOMATCH' })],
      [cgRow()]
    );

    for (const r of records) {
      expect(r.record.listingPrice).not.toBeNull();
      expect(r.record.listingPrice).not.toBeUndefined();
    }
  });

  it('SKIPS an unmatched IPO instead of counting it as a failure', () => {
    const unmatched = ipo({ id: 'ipo-2', companyName: 'No Match Ltd.', slug: 'no-match', isin: 'INE0NOMATCH1', symbol: 'NOMATCH' });

    const { records, skipped } = planListingPerformanceUpdates([ipo(), unmatched], [cgRow()]);

    expect(records.map(r => r.ipo.id)).toEqual(['ipo-1']);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ ipoId: 'ipo-2', reason: 'no-listing-source-match' });
  });

  it('matches by ISIN even when the symbol disagrees (highest-confidence key wins)', () => {
    const renamed = ipo({ symbol: 'OLDSYM' });

    const { records } = planListingPerformanceUpdates([renamed], [cgRow()]);

    expect(records).toHaveLength(1);
    expect(records[0].matchMethod).toBe('isin');
  });

  it('rejects an implausible listing gain rather than publishing garbage', () => {
    // 97 -> 9999 would be a +10,208% "gain": a source/parse defect, not a real IPO.
    const { records, skipped } = planListingPerformanceUpdates([ipo()], [cgRow({ listingClose: 9999, listingGainPct: null })]);

    expect(records).toHaveLength(0);
    expect(skipped[0]).toMatchObject({ ipoId: 'ipo-1', reason: 'implausible-listing-gain' });
  });

  it('is a no-op (all skipped, zero records) when the source returns nothing', () => {
    const { records, skipped } = planListingPerformanceUpdates([ipo()], []);

    expect(records).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });
});
