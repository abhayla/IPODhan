/**
 * T-228 regressions: three defects that made every scraper cycle exit 1.
 *
 * 1. Investorgain's v1 report API was retired for a v2 path with a different
 *    segment order, and the financial-year label was computed with the wrong
 *    rollover month.
 * 2. The offering-type auto-fixer emitted display labels ('InvIT' / 'REIT')
 *    into a field constrained to the DB enum ('INVITS' / 'REITS'), so every
 *    real trust it correctly detected was then rejected outright.
 * 3. An unannounced price band arrived as 0 and was passed to a
 *    positive-number schema, dropping the entire IPO record.
 */
import { describe, it, expect } from 'vitest';
import { getFinancialYearLabel } from '../../src/scrapers/investorgain-gmp-scraper.js';
import { detectOfferingType } from '../../src/utils/data-validation.js';
import { ScrapedIPOSchema } from '../../src/utils/validators.js';

describe('T-228 / Investorgain financial-year label', () => {
  it('uses the April rollover, not the calendar year', () => {
    expect(getFinancialYearLabel(new Date('2026-08-20T00:00:00Z'))).toBe('2026-27');
    expect(getFinancialYearLabel(new Date('2026-04-01T00:00:00Z'))).toBe('2026-27');
    // The old module-level constant said 2026-27 here, which is the previous FY.
    expect(getFinancialYearLabel(new Date('2026-02-10T00:00:00Z'))).toBe('2025-26');
    expect(getFinancialYearLabel(new Date('2026-03-31T00:00:00Z'))).toBe('2025-26');
  });

  it('zero-pads the second half of the label at the century boundary', () => {
    expect(getFinancialYearLabel(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });
});

describe('T-228 / trust classification uses canonical enum values', () => {
  const enumValues = ScrapedIPOSchema.shape.offeringType;

  it('detects an InvIT as INVITS and that value survives schema validation', () => {
    const detected = detectOfferingType(
      { companyName: 'Cube Highways Trust (Cube Highways Trust InvIT)' } as never,
      'CHITTORGARH'
    );
    expect(detected.detectedType).toBe('INVITS');
    expect(enumValues.safeParse(detected.detectedType).success).toBe(true);
  });

  it('detects a REIT as REITS and that value survives schema validation', () => {
    const detected = detectOfferingType(
      { companyName: 'Bagmane Prime Office REIT (Bagmane REIT)' } as never,
      'CHITTORGARH'
    );
    expect(detected.detectedType).toBe('REITS');
    expect(enumValues.safeParse(detected.detectedType).success).toBe(true);
  });

  it('rejects the old display labels so the regression cannot silently return', () => {
    expect(enumValues.safeParse('InvIT').success).toBe(false);
    expect(enumValues.safeParse('REIT').success).toBe(false);
  });

  it('still classifies an ordinary company as IPO', () => {
    const detected = detectOfferingType(
      { companyName: 'Annu Projects Ltd.' } as never,
      'CHITTORGARH'
    );
    expect(detected.detectedType).toBe('IPO');
  });
});

describe('T-228 / an unannounced price band must not drop the record', () => {
  const baseIPO = {
    companyName: 'Rays of Belief Ltd.',
    issueSize: 250000000,
    openDate: '2026-09-01',
    closeDate: '2026-09-03',
    listingExchange: 'BSE' as const,
    segment: 'SME' as const,
    offeringType: 'IPO' as const,
    status: 'UPCOMING' as const,
  };

  it('accepts a record whose price band is not published yet', () => {
    const result = ScrapedIPOSchema.safeParse({
      ...baseIPO,
      priceRangeMin: undefined,
      priceRangeMax: undefined,
    });
    expect(result.success).toBe(true);
  });

  // T-236 supersedes this: the T-228 design assumed every caller would
  // normalize 0 -> undefined before reaching this schema (chittorgarh-scraper.ts
  // does, at line 372-373). It didn't hold - chittorgarh-rights-debt-adapter.ts
  // (line 341-342) passes price.min/price.max raw, so a literal 0 DOES reach
  // this schema in production and dropped a real IPO (Rays of Belief Ltd.,
  // Kwick Forensic Solutions Ltd. - see t236-rays-of-belief-price-band.test.ts).
  // The schema now normalizes 0 -> undefined itself, so every caller is safe
  // regardless of whether it normalizes first.
  it('normalizes a zero price band to unannounced, so 0 can never masquerade as a real price', () => {
    const result = ScrapedIPOSchema.safeParse({
      ...baseIPO,
      priceRangeMin: 0,
      priceRangeMax: 0,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.priceRangeMin).toBeUndefined();
    expect(result.success && result.data.priceRangeMax).toBeUndefined();
  });
});
