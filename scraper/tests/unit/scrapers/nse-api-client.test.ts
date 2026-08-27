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
describe('computeNSEIssueSizeRupees (T-329 fix)', () => {
  it('Annu Projects replay: converts the share count to rupees using the upper price band', () => {
    const data = { companyName: 'Annu Projects Limited', issueSize: '17683000', noOfSharesOffered: '1.7683E7' };
    expect(computeNSEIssueSizeRupees(data, 99, 95)).toBe(1750617000);
  });

  it('Priority Jewels replay: 4,575,000 sh x Rs200 = Rs91.5 Cr, not the raw share count', () => {
    const data = { companyName: 'Priority Jewels Limited', issueSize: '4575000', noOfSharesOffered: '4575000' };
    expect(computeNSEIssueSizeRupees(data, 200, 190)).toBe(915000000);
  });

  it('prefers noOfSharesOffered over issueSize as the share-count source', () => {
    // issueSize and noOfSharesOffered disagree — noOfSharesOffered is NSE's
    // correctly-named field for the share count and must win.
    const data = { issueSize: '999', noOfSharesOffered: '17683000' };
    expect(computeNSEIssueSizeRupees(data, 99, 95)).toBe(1750617000);
  });

  it('falls back to priceRangeMin when priceRangeMax is unavailable', () => {
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
    expect(result.issueSize).not.toBe(17683000);
    expect(result.issueSize).toBe(1750617000);
  });
});

/**
 * T-331 P3-1 - ROOT CAUSE of "sector empty for all 251 IPOs".
 *
 * The field-priority matrix names NSE as the primary source for `sector`
 * ("Industry sector - NSE/exchange classification; feeds peer discovery"), and
 * backfill-description-sector.ts states outright that "NSE is the intended
 * source (nse-api-client reads it)". Both are wrong.
 *
 * `transformIPOData(data: any, ...)` reads `data.sector`. The string "sector"
 * appears EXACTLY ONCE in the whole NSE client - that read. It is declared in
 * NO NSE interface, and NSE does not return it. The `any` on the parameter is
 * what let an untyped read of a non-existent field compile and ship.
 *
 * Consequences, both live in prod:
 *   - sector is 0/251. BSE explicitly has none ("Not available in BSE main
 *     table"); no other scraper writes it. There is NO working source.
 *   - peer-companies-job filters to IPOs that HAVE a sector, so it is starved
 *     by the same bug - the "sector -> peers cascade" the matrix comment warns
 *     about.
 *
 * These tests pin the ACTUAL behaviour so nobody "fixes" sector by assuming the
 * NSE path works. They are characterization tests, not a fix: they must be
 * UPDATED, not deleted, by whoever wires a real source (see the P3-1 issue).
 */
describe('transformIPOData sector (T-331 P3-1 root cause: NSE has no sector field)', () => {
  it('yields undefined sector for a realistic NSE payload - NSE never supplies one', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    // Every field here is one NSE genuinely returns. There is no `sector`.
    const data = {
      companyName: 'Annu Projects Limited',
      symbol: 'ANNU',
      series: 'EQ',
      issueSize: '17683000',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      isin: 'INE0ABC01011',
      lotSize: '150',
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.sector).toBeUndefined();
  });

  it('would carry a sector through IF NSE ever started returning one - the read itself is not broken', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const result = transformIPOData(
      { companyName: 'X Ltd', symbol: 'X', series: 'EQ', issuePrice: '10', status: 'Active', sector: '  Pharmaceuticals  ' },
      'ipo'
    );
    // Proves the mapping is wired correctly and the defect is purely that the
    // upstream field does not exist - so the fix is a SOURCE, not this line.
    expect(result.sector).toBe('Pharmaceuticals');
  });

  it('never writes a blank sector - an empty upstream value becomes undefined, not ""', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const result = transformIPOData(
      { companyName: 'X Ltd', symbol: 'X', series: 'EQ', issuePrice: '10', status: 'Active', sector: '   ' },
      'ipo'
    );
    // A blank would plant an empty string that blocks a real backfill later -
    // the same trap bse-scraper.ts calls out in its own comment.
    expect(result.sector).toBeUndefined();
  });
});
