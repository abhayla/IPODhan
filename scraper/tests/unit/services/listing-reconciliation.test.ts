/**
 * GitHub #70 / #36 — listing reconciliation pure logic.
 *
 * Tests matching a Chittorgarh report-25 row to a stuck IPO (ISIN > symbol > slug
 * > name), the deterministic listing-gain computation, and the upsertIPO /
 * listing_performance payload builders — across >=7 IPOs of different types
 * (mainboard ISIN, mainboard symbol, slug-only, name-variant, SME, null-symbol
 * guard, non-match), per the owner's "7 IPOs of different types" directive.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeNameForMatch,
  parseCgListingDate,
  computeListingGainPct,
  isPlausibleListingGain,
  matchListingRowToIpo,
  findBestListingMatch,
  buildListingScrapedIPO,
  buildListingPerformanceRecord,
  type StuckIpo,
} from '../../../src/services/listing-reconciliation.js';
import type { ChittorgarhListingRow } from '../../../src/scrapers/chittorgarh-listing-scraper.js';

function cgRow(p: Partial<ChittorgarhListingRow>): ChittorgarhListingRow {
  return {
    companyName: 'Test Co Ltd.',
    slug: null,
    isin: null,
    bseScripCode: null,
    nseSymbol: null,
    listingDate: '30-Dec-2025',
    issuePrice: 100,
    listingClose: 120,
    listingGainPct: 20,
    currentBse: 130,
    currentNse: 131,
    currentGainPct: 30,
    ...p,
  };
}
function stuck(p: Partial<StuckIpo>): StuckIpo {
  return {
    id: 'id-1', companyName: 'Test Co Ltd.', slug: 'test-co', symbol: null, isin: null,
    segment: 'MAINBOARD', offeringType: 'IPO', status: 'CLOSED',
    openDate: '2025-12-20', closeDate: '2025-12-24', listingDate: null,
    priceRangeMax: 100, issueSize: '1000000000',
    ...p,
  };
}

describe('normalizeNameForMatch', () => {
  it('normalizes legal suffixes/punctuation so variants collapse', () => {
    expect(normalizeNameForMatch('Acme Industries Ltd.')).toBe(normalizeNameForMatch('ACME INDUSTRIES LIMITED'));
    expect(normalizeNameForMatch('A & B Pvt Ltd')).toBe('a and b');
  });
});

describe('computeListingGainPct + plausibility', () => {
  it('computes gain and guards divide-by-zero', () => {
    expect(computeListingGainPct(100, 120)).toBe(20);
    expect(computeListingGainPct(114, 104.54)).toBeCloseTo(-8.3, 1);
    expect(computeListingGainPct(0, 120)).toBeNull();
    expect(computeListingGainPct(null, 120)).toBeNull();
    expect(computeListingGainPct(100, null)).toBeNull();
  });
  it('flags implausible gains', () => {
    expect(isPlausibleListingGain(20)).toBe(true);
    expect(isPlausibleListingGain(-8.3)).toBe(true);
    expect(isPlausibleListingGain(null)).toBe(true);
    expect(isPlausibleListingGain(5000)).toBe(false);
    expect(isPlausibleListingGain(-99)).toBe(false);
  });
});

describe('parseCgListingDate', () => {
  it('converts CG date to ISO', () => {
    expect(parseCgListingDate('30-Dec-2025')).toBe('2025-12-30');
    expect(parseCgListingDate('')).toBeNull();
    expect(parseCgListingDate('not a date')).toBeNull();
  });
});

describe('matchListingRowToIpo — 7 IPO types', () => {
  it('1. mainboard by ISIN (highest confidence)', () => {
    expect(matchListingRowToIpo(stuck({ isin: 'INE0V0W01025' }), cgRow({ isin: 'ine0v0w01025' }))).toBe('isin');
  });
  it('2. mainboard by NSE symbol (case-insensitive)', () => {
    expect(matchListingRowToIpo(stuck({ symbol: 'gksl' }), cgRow({ nseSymbol: 'GKSL' }))).toBe('symbol');
  });
  it('3. by slug', () => {
    expect(matchListingRowToIpo(stuck({ slug: 'gujarat-kidney-ipo' }), cgRow({ slug: 'gujarat-kidney-ipo' }))).toBe('slug');
  });
  it('4. by normalized company name (Ltd. vs Limited)', () => {
    expect(matchListingRowToIpo(stuck({ companyName: 'Gujarat Kidney Ltd.' }), cgRow({ companyName: 'GUJARAT KIDNEY LIMITED' }))).toBe('name');
  });
  it('5. SME match by symbol', () => {
    expect(matchListingRowToIpo(stuck({ segment: 'SME', symbol: 'MDRCL' }), cgRow({ nseSymbol: 'MDRCL' }))).toBe('symbol');
  });
  it('6. null-symbol IPO does NOT false-match a row by empty symbol', () => {
    expect(matchListingRowToIpo(stuck({ symbol: null, companyName: 'Foo Ltd' }), cgRow({ nseSymbol: null, companyName: 'Bar Ltd' }))).toBeNull();
  });
  it('7. genuinely different company -> no match', () => {
    expect(matchListingRowToIpo(stuck({ companyName: 'Alpha Ltd', symbol: 'ALPHA', isin: 'INE111A01011', slug: 'alpha' }),
      cgRow({ companyName: 'Beta Ltd', nseSymbol: 'BETA', isin: 'INE222B02022', slug: 'beta' }))).toBeNull();
  });
});

describe('findBestListingMatch picks highest-confidence row', () => {
  it('prefers ISIN over name when multiple rows match', () => {
    const ipo = stuck({ isin: 'INE0V0W01025', companyName: 'Gujarat Kidney Ltd' });
    const rows = [
      cgRow({ companyName: 'Gujarat Kidney Limited', listingClose: 99 }), // name match
      cgRow({ isin: 'INE0V0W01025', listingClose: 104.54 }),             // isin match
    ];
    const best = findBestListingMatch(ipo, rows);
    expect(best?.method).toBe('isin');
    expect(best?.row.listingClose).toBe(104.54);
  });
  it('returns null when nothing matches', () => {
    expect(findBestListingMatch(stuck({ symbol: 'X', isin: 'INE000X01010', slug: 'x', companyName: 'X Ltd' }), [cgRow({ companyName: 'Y Ltd', nseSymbol: 'Y' })])).toBeNull();
  });
});

describe('buildListingScrapedIPO (upsertIPO payload)', () => {
  it('advances to LISTED with the real listing date, preserving offering type/segment', () => {
    const ipo = stuck({ segment: 'SME', offeringType: 'IPO', symbol: 'GKSL', isin: null });
    const payload = buildListingScrapedIPO(ipo, cgRow({ nseSymbol: 'GKSL', bseScripCode: '544666', listingDate: '30-Dec-2025' }));
    expect(payload.status).toBe('LISTED');
    expect(payload.listingDate).toBe('2025-12-30');
    expect(payload.segment).toBe('SME');
    expect(payload.offeringType).toBe('IPO');
    expect(['NSE', 'BSE', 'BOTH']).toContain(payload.listingExchange);
    expect(payload.companyName).toBe(ipo.companyName);
  });
  it('throws on an unparseable listing date (never fabricates one)', () => {
    expect(() => buildListingScrapedIPO(stuck({}), cgRow({ listingDate: 'garbage' }))).toThrow();
  });
});

describe('buildListingPerformanceRecord', () => {
  it('uses day-1 close as listing price and computes a consistent gain', () => {
    const rec = buildListingPerformanceRecord(stuck({ id: 'ipo-7' }), cgRow({ issuePrice: 114, listingClose: 104.54, listingGainPct: -8.3 }));
    expect(rec.ipoId).toBe('ipo-7');
    expect(rec.listingPrice).toBe(105); // rounded day-1 close
    expect(rec.issuePrice).toBe(114);
    expect(parseFloat(rec.listingGainPercent as string)).toBeCloseTo(-7.9, 0); // computed from rounded close
    expect(rec.dataSource).toBe('SCRAPER');
  });
  it('falls back to price_range_max for issue price when CG lacks it', () => {
    const rec = buildListingPerformanceRecord(stuck({ priceRangeMax: 200 }), cgRow({ issuePrice: null, listingClose: 250 }));
    expect(rec.issuePrice).toBe(200);
    expect(parseFloat(rec.listingGainPercent as string)).toBeCloseTo(25, 0);
  });
});
