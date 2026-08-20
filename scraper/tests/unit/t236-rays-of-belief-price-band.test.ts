/**
 * T-236: confirm the two live-VPS "skipped by validation" companies are KEPT
 * on the current merged code (main / T-228, commit cae19580).
 *
 * The T-228C checker captured a real VPS scraper cycle
 * (D:\Abhay\GetWorkDone\evidence\2026-08-20-T-228C\vps-cycle-zoderrors.txt,
 * 2026-08-20 16:01 UTC) showing five CHITTORGARH records dropped by
 * validation: three trusts (out of scope here - see t228-source-health-and-
 * classification.test.ts) and two ordinary companies, `Rays of Belief Ltd.`
 * and `Kwick Forensic Solutions Ltd.`, both rejected with an identical Zod
 * error shape:
 *
 *   { path: ['priceRangeMin'], code: 'too_small', minimum: 0, inclusive: false,
 *     message: 'Price range min must be positive' }
 *   (same for priceRangeMax)
 *
 * That evidence was captured against the DEPLOYED VPS copy, which at the
 * time of this test still has the PRE-T-228 code: `git log` is unavailable
 * on C:\Apps\IPODhan\current (files are copied, not a git checkout), but a
 * direct read of the deployed source confirms it:
 *   - scraper/src/scrapers/chittorgarh-scraper.ts line 367 on the VPS reads
 *     `priceRangeMin: price.min,` with NO `> 0 ? ... : undefined` guard.
 *   - scraper/src/utils/data-validation.ts on the VPS still emits the
 *     display labels `detectedType: 'InvIT'` / `'REIT'` (the sibling T-228
 *     defect), not the canonical `'INVITS'`/`'REITS'` - and the evidence log
 *     itself shows that exact sibling bug still firing in the same cycle.
 *     Both facts place the evidence squarely on the pre-fix deploy.
 *
 * On main (this checkout), chittorgarh-scraper.ts converts an unannounced
 * price (Chittorgarh returns a blank "Issue Price" string, which
 * parseChittorgarhPrice() turns into { min: 0, max: 0 }) into `undefined`
 * before the record ever reaches the schema. This test proves that record
 * shape - the exact shape validateChittorgarhIPOData() receives in
 * production - now passes Stage 2 schema validation for both companies.
 */
import { describe, it, expect } from 'vitest';
import { validateChittorgarhIPOData } from '../../src/utils/validators.js';

function chittorgarhFixture(companyName: string) {
  // Mirrors what scraper/src/scrapers/chittorgarh-scraper.ts (main, post-T-228)
  // actually produces for a Chittorgarh row whose "Issue Price (Rs.)" cell is
  // blank: parseChittorgarhPrice('') -> { min: 0, max: 0 }, then the
  // `price.min > 0 ? price.min : undefined` guard (line 372-373) omits the
  // field entirely rather than passing the literal 0 downstream.
  return {
    companyName,
    dataSource: 'CHITTORGARH' as const,
    issueSize: 250000000,
    priceRangeMin: undefined,
    priceRangeMax: undefined,
    openDate: '2026-09-01',
    closeDate: '2026-09-03',
    listingExchange: 'BSE' as const,
    segment: 'SME' as const,
    offeringType: 'IPO' as const,
    status: 'UPCOMING' as const,
  };
}

describe('T-236 / Rays of Belief and Kwick Forensic are kept on main', () => {
  it('Rays of Belief Ltd. passes Stage-2 schema validation with an unannounced price band', () => {
    const result = validateChittorgarhIPOData(chittorgarhFixture('Rays of Belief Ltd.'));
    expect(result.success).toBe(true);
    expect(result.data?.companyName).toBe('Rays of Belief Ltd.');
  });

  it('Kwick Forensic Solutions Ltd. passes Stage-2 schema validation with an unannounced price band', () => {
    const result = validateChittorgarhIPOData(chittorgarhFixture('Kwick Forensic Solutions Ltd.'));
    expect(result.success).toBe(true);
    expect(result.data?.companyName).toBe('Kwick Forensic Solutions Ltd.');
  });

  it('fails against the pre-T-228 shape (literal 0 instead of undefined) - proves this is a real regression guard', () => {
    // This is what the OLD (still-deployed) chittorgarh-scraper.ts produced:
    // `priceRangeMin: price.min` with no guard, i.e. a literal 0 reaches the schema.
    const preFixShape = {
      ...chittorgarhFixture('Rays of Belief Ltd.'),
      priceRangeMin: 0,
      priceRangeMax: 0,
    };
    const result = validateChittorgarhIPOData(preFixShape);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(
      expect.arrayContaining(['priceRangeMin', 'priceRangeMax'])
    );
  });
});
