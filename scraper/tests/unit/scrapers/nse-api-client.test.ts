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

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parsePriceRange, computeNSEIssueSizeRupees } from '../../../src/scrapers/nse-api-client.js';
import { parseNSEDate, determineStatus } from '../../../src/scrapers/nse-api-client.js';
import { istDateIso } from '../../../src/scheduler/due-step-cycle.js';

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

/**
 * T-455 (issue #242, round-7 P3-1): NSE's `current-issue` list endpoint
 * carries no `sector`/`industry` field on any real captured payload — the
 * mapper used to read `data.sector`, which was always `undefined`, so the
 * DB column stayed 0/N filled while the matrix and a backfill-script header
 * both claimed NSE as the working source. This pins the real (not
 * hand-typed) fixture shape and guards against a future re-introduction of
 * a phantom-field read.
 */
describe('transformIPOData sector (T-455 fix, real NSE fixture)', () => {
  it('never emits a sector key from the real NSE current-issue payload (phantom field)', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const fixture = (await import('../../fixtures/nse/ipo-current-issue.live-2026-08-22.json', { with: { type: 'json' } })).default;
    const record = Array.isArray(fixture) ? fixture[0] : fixture;
    expect(record.sector).toBeUndefined(); // sanity: the real payload has no such field
    const result = transformIPOData(record, 'ipo');
    expect(result.sector).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result, 'sector')).toBe(false);
  });

  it('still stays undefined even if a source object happens to carry a `sector` key (no accidental read remains)', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const data = {
      companyName: 'Test Co',
      symbol: 'TEST',
      series: 'EQ',
      issueSize: '1000000',
      issuePrice: '95 to 99',
      issueStartDate: '24-Aug-2026',
      issueEndDate: '27-Aug-2026',
      status: 'Active',
      sector: 'Should Never Be Read',
    };
    const result = transformIPOData(data, 'ipo');
    expect(result.sector).toBeUndefined();
  });
});

describe('nse-api-client today derivation uses the IST day (#687 slice 2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('determineStatus classifies a row opening today-in-IST as OPEN, not UPCOMING (real, known dates)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'));
    expect(istDateIso(new Date())).toBe('2026-09-16');

    // No statusStr supplied -> falls through to the date ladder. Both dates
    // are real (known) values here, so the date ladder is expected to apply.
    const status = determineStatus(null, '2026-09-16', '2026-09-18');
    expect(status).toBe('OPEN');
  });
});

/**
 * #963 (Tier A review of PR #949, item 7 S4): `parseNSEDate` returned
 * `istDateIso(new Date())` (today's IST date) for a null/empty/unparseable
 * NSE date, so `transformIPOData` stored open === close === today and
 * `determineStatus` derived OPEN from that fabricated pair. The opening-day
 * discovery job (`opening-day-discovery.ts` `selectOpeningToday`) then
 * selected the row by exactly that made-up value, and `narrowNse`'s
 * `!row.openDate` guard was dead code as a result. Class (registered):
 * absence-written-as-a-sentinel-value — a missing date must stay absent
 * (undefined), never a stand-in value, for EVERY caller of `parseNSEDate`
 * and `determineStatus` (mapper + opening-day check), across all offering
 * types and segments.
 */
describe('parseNSEDate leaves a missing/unparseable date absent, never today (#963 fix)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined (not today) for null/undefined/empty/garbage input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T20:30:00Z'));
    expect(istDateIso(new Date())).toBe('2026-09-16'); // sanity: today would be 2026-09-16 if fabricated

    expect(parseNSEDate(null)).toBeUndefined();
    expect(parseNSEDate(undefined)).toBeUndefined();
    expect(parseNSEDate('')).toBeUndefined();
    expect(parseNSEDate('   ')).toBeUndefined();
    expect(parseNSEDate('-')).toBeUndefined();
    expect(parseNSEDate('not-a-real-date-at-all-####')).toBeUndefined();
  });

  it('still parses a real DD-MMM-YYYY date exactly (regression: valid input unaffected)', () => {
    expect(parseNSEDate('24-Aug-2026')).toBe('2026-08-24');
  });

  it('still parses a real DD/MM/YYYY date exactly (regression: valid input unaffected)', () => {
    expect(parseNSEDate('24/08/2026')).toBe('2026-08-24');
  });
});

describe('determineStatus never infers OPEN/CLOSED from a missing date (#963 fix)', () => {
  it('returns UPCOMING (not OPEN) when no status text and BOTH dates are missing', () => {
    expect(determineStatus(null, undefined, undefined)).toBe('UPCOMING');
    expect(determineStatus(undefined, undefined, undefined)).toBe('UPCOMING');
  });

  it('returns UPCOMING (not OPEN/CLOSED) when no status text and only one date is missing', () => {
    expect(determineStatus(null, undefined, '2026-09-18')).toBe('UPCOMING');
    expect(determineStatus(null, '2026-09-16', undefined)).toBe('UPCOMING');
  });

  it('still uses the explicit NSE status text even when both dates are missing (unaffected)', () => {
    expect(determineStatus('Active', undefined, undefined)).toBe('OPEN');
    expect(determineStatus('Closed', undefined, undefined)).toBe('CLOSED');
  });
});

describe('transformIPOData leaves openDate/closeDate absent instead of fabricating today (#963 fix, real NSE mapper)', () => {
  it('a row with issueStartDate/issueEndDate null (derived from a real capture with dates blanked) gets openDate/closeDate undefined and status UPCOMING, never OPEN from a fabricated date', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    // Derived from the real captured fixture
    // tests/fixtures/nse/ipo-current-issue.live-2026-08-22.json, with only
    // issueStartDate/issueEndDate overwritten to null to reproduce NSE
    // listing an IPO before its dates are fixed (no such row exists in
    // today's live capture — every captured row already has both dates).
    const fixture = (await import('../../fixtures/nse/ipo-current-issue.live-2026-08-22.json', { with: { type: 'json' } })).default;
    const record = { ...(Array.isArray(fixture) ? fixture[0] : fixture) };
    record.issueStartDate = null;
    record.issueEndDate = null;
    delete record.status; // no status text either, to force the date ladder

    const result = transformIPOData(record, 'ipo');

    expect(result.openDate).toBeUndefined();
    expect(result.closeDate).toBeUndefined();
    expect(result.status).toBe('UPCOMING');
    expect(result.status).not.toBe('OPEN');
  });

  it('a row with a real status string and blank dates still reads status from the status text (unaffected)', async () => {
    const { transformIPOData } = await import('../../../src/scrapers/nse-api-client.js');
    const fixture = (await import('../../fixtures/nse/ipo-current-issue.live-2026-08-22.json', { with: { type: 'json' } })).default;
    const record = { ...(Array.isArray(fixture) ? fixture[0] : fixture) };
    record.issueStartDate = '';
    record.issueEndDate = undefined;
    record.status = 'Active';

    const result = transformIPOData(record, 'ipo');

    expect(result.openDate).toBeUndefined();
    expect(result.closeDate).toBeUndefined();
    expect(result.status).toBe('OPEN');
  });
});
