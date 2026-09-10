import { describe, it, expect } from 'vitest';
import { REPORT82_PAGE_SIZE } from '../../../src/scrapers/chittorgarh-scraper.js';

/**
 * Report 82 accepts exactly one page size. This test exists because the value
 * looks like a harmless tuning constant and is not one.
 *
 * Measured against the live endpoint on 2026-09-11 (read-only):
 *   perPage=10  -> HTTP 200, 231 rows (the whole report; page size is ignored)
 *   perPage=20  -> HTTP 200, 0 rows, error "Invalid API Call2026-20-01"
 *   perPage=50  -> HTTP 200, 0 rows, error "Invalid API Call2026-50-01"
 *   perPage=100 -> HTTP 200, 0 rows, error "Invalid API Call2026-100-01"
 *   perPage=300 -> HTTP 200, 0 rows, error "Invalid API Call2026-300-01"
 *
 * The old default was 100 - a call that returns nothing, with a 200 status, and
 * reads as "no IPOs today". It never fired only because the single caller passed
 * 10 by hand. Raising this to fetch "more rows per call" fetches zero.
 */
describe('report 82 page size', () => {
  it('is 10, the only value the endpoint accepts', () => {
    expect(REPORT82_PAGE_SIZE).toBe(10);
  });

  it('is not one of the values measured to return zero rows', () => {
    expect([20, 50, 100, 300]).not.toContain(REPORT82_PAGE_SIZE);
  });
});
