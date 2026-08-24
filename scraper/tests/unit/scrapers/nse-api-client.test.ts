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
import { parsePriceRange } from '../../../src/scrapers/nse-api-client.js';

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
