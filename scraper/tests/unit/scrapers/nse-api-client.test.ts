/**
 * Unit tests for the price-band parsing fix in nse-api-client.ts (T-308,
 * round-6 P1, checker finding F1).
 *
 * NSE is field-priority rank #2 (above Moneycontrol) and this is the
 * PRIMARY (non-fallback) NSE data path — `parsePriceRange` previously wrote
 * a lone single-price string into BOTH priceRangeMin and priceRangeMax,
 * silently collapsing a real book-built band once NSE stopped publishing a
 * range at close/listing. `parsePriceRange` is exported here purely for
 * this direct unit test (no other behavior change).
 */

import { describe, it, expect } from 'vitest';
import { parsePriceRange, computeNSEIssueSizeRupees } from '../../../src/scrapers/nse-api-client.js';

describe('nse-api-client parsePriceRange (T-308 fix)', () => {
  it('parses a genuine "X to Y" range', () => {
    expect(parsePriceRange('Rs.100 to Rs.106')).toEqual({ min: 100, max: 106 });
  });

  it('parses a genuine "X - Y" range', () => {
    expect(parsePriceRange('253 - 266')).toEqual({ min: 253, max: 266 });
  });

  it('leaves a lone single price undefined instead of collapsing min===max', () => {
    expect(parsePriceRange('106')).toEqual({ min: undefined, max: undefined });
    expect(parsePriceRange('Rs.106')).toEqual({ min: undefined, max: undefined });
  });

  it('returns undefined band for null/missing input', () => {
    expect(parsePriceRange(null)).toEqual({ min: undefined, max: undefined });
    expect(parsePriceRange(undefined)).toEqual({ min: undefined, max: undefined });
  });

  it('returns undefined band for unparseable input', () => {
    expect(parsePriceRange('N/A')).toEqual({ min: undefined, max: undefined });
  });
});

/**
 * T-329 (round-7 P1-3): NSE's `issueSize` field is byte-identical to
 * `noOfSharesOffered` — a SHARE COUNT, never rupees. The old code wrote
 * `parseFloat(data.issueSize)` straight into the rupee column `ipos.issue_size`.
 * Live fixture (fetched from the prod box, 2026-08-26):
 *   Annu Projects: {"issueSize":"17683000","noOfSharesOffered":"1.7683E7"}, priceRangeMax 99
 *   -> true rupee issue size = 17,683,000 x 99 = 1,750,617,000 (Rs175.06 Cr,
 *      matches IPOWatch's independently reported "Rs175 Cr").
 * The bug wrote 17,683,000 verbatim into the rupee column ("Rs1.77 Cr").
 */
describe('computeNSEIssueSizeRupees (T-329 fix; W-109 floor-price fix)', () => {
  it('Annu Projects replay: converts the share count to rupees using the FLOOR price', () => {
    // W-109: the exchange share count is the count AT THE FLOOR — floor x
    // shares is the number that exists in the filing, not cap x shares.
    const data = { companyName: 'Annu Projects Limited', issueSize: '17683000', noOfSharesOffered: '1.7683E7' };
    expect(computeNSEIssueSizeRupees(data, 99, 95)).toBe(1679885000);
  });

  it('Priority Jewels replay: 4,575,000 sh x Rs190 floor = Rs86.925 Cr, not the raw share count', () => {
    const data = { companyName: 'Priority Jewels Limited', issueSize: '4575000', noOfSharesOffered: '4575000' };
    expect(computeNSEIssueSizeRupees(data, 200, 190)).toBe(869250000);
  });

  it('prefers noOfSharesOffered over issueSize as the share-count source', () => {
    // issueSize and noOfSharesOffered disagree — noOfSharesOffered is NSE's
    // correctly-named field for the share count and must win.
    const data = { issueSize: '999', noOfSharesOffered: '17683000' };
    expect(computeNSEIssueSizeRupees(data, 99, 95)).toBe(1679885000);
  });

  it('W-109 (round-8, Glass Wall Systems): floor-priced total, never the cap-priced total', () => {
    // 23,702,094 sh (the exchange's floor-priced count) x band 172-182.
    // Real filing total (floor): 23,702,094 x 172 = 4,076,760,168.
    // The old cap-multiplied bug: 23,702,094 x 182 = 4,313,781,108 — appears
    // nowhere in the filing and must never be produced again.
    const data = { companyName: 'Glass Wall Systems Limited', noOfSharesOffered: '23702094' };
    expect(computeNSEIssueSizeRupees(data, 182, 172)).toBe(4076760168);
    expect(computeNSEIssueSizeRupees(data, 182, 172)).not.toBe(4313781108);
  });

  it('falls back to priceRangeMax when priceRangeMin (the floor) is unavailable', () => {
    const data = { issueSize: '17683000' };
    expect(computeNSEIssueSizeRupees(data, 99, undefined)).toBe(1750617000);
  });

  it('uses priceRangeMin directly when priceRangeMax is unavailable', () => {
    const data = { issueSize: '17683000' };
    expect(computeNSEIssueSizeRupees(data, undefined, 95)).toBe(1679885000);
  });

  it('returns undefined (never the raw share count) when no price band is known yet', () => {
    const data = { companyName: 'Lumino Industries Limited', issueSize: '63205127', noOfSharesOffered: '63205127' };
    expect(computeNSEIssueSizeRupees(data, undefined, undefined)).toBeUndefined();
  });

  it('returns undefined for a non-numeric or missing share count', () => {
    expect(computeNSEIssueSizeRupees({}, 99, 95)).toBeUndefined();
    expect(computeNSEIssueSizeRupees({ issueSize: 'N/A' }, 99, 95)).toBeUndefined();
    expect(computeNSEIssueSizeRupees({ issueSize: '0' }, 99, 95)).toBeUndefined();
  });
});

/**
 * T-329: the old code path — `transformIPOData` must never write a raw
 * share count into the rupee `issueSize` field of the returned ScrapedIPO.
 */
describe('transformIPOData issueSize (T-329 fix, RED against the old parseFloat(data.issueSize) code)', () => {
  it('Annu Projects: emits the rupee-converted issue size, not the share count', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const data = {
      companyName: 'Annu Projects Limited',
      symbol: 'ANNU',
      series: 'EQ',
      issueSize: '17683000',
      noOfSharesOffered: '1.7683E7',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
    };
    const result = transformIPOData(data, 'ipo');
    // The bug: issueSize === 17683000 (the raw share count). The fix: a real
    // rupee value (or undefined) — never equal to the share count itself.
    // W-109: the rupee value uses the FLOOR price (95), not the cap (99).
    expect(result.issueSize).not.toBe(17683000);
    expect(result.issueSize).toBe(1679885000);
  });
});
