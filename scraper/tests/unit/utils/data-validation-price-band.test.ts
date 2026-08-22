import { describe, it, expect } from 'vitest';
import { validateIPOData } from '../../../src/utils/data-validation.js';

/**
 * T-276 (round-2 P1-1): `PRICE_BAND` appeared ZERO times in the validation
 * tests. `validation: { min: 1, max: 100000 }` happily passes `300 / 300`, and
 * `PRICE_BAND_TOO_WIDE_*` only guards the upper side — nothing guarded a band
 * of width ZERO. 223 of 271 prod IPO rows carried `min === max`, which the site
 * renders as "Price Band ₹300" for what is really a ₹285–₹300 book-built issue.
 *
 * A zero-width band is legitimate for a FIXED_PRICE issue, so the rule is a
 * WARNING (surfacing, not blocking) and is suppressed when the issue type says
 * fixed price.
 */
describe('T-276 price-band validation rules', () => {
  const base = { companyName: 'Tempsens Instruments (India) Limited', segment: 'MAINBOARD', offeringType: 'IPO' };

  it('flags a zero-width band on a book-built issue (min === max)', () => {
    const r = validateIPOData({ ...base, priceRangeMin: 300, priceRangeMax: 300 }, 'NSE');
    expect(r.warnings.map(w => w.rule)).toContain('PRICE_BAND_DEGENERATE');
  });

  it('flags a zero-width band when the issue type is unknown (cannot assume fixed price)', () => {
    const r = validateIPOData({ ...base, priceRangeMin: 479, priceRangeMax: 479, issueType: null }, 'BSE');
    expect(r.warnings.map(w => w.rule)).toContain('PRICE_BAND_DEGENERATE');
  });

  it('does NOT flag a zero-width band on a declared FIXED_PRICE issue', () => {
    const r = validateIPOData({ ...base, segment: 'SME', priceRangeMin: 61, priceRangeMax: 61, issueType: 'FIXED_PRICE' }, 'NSE');
    expect(r.warnings.map(w => w.rule)).not.toContain('PRICE_BAND_DEGENERATE');
  });

  it('does NOT flag a real band (min < max)', () => {
    const r = validateIPOData({ ...base, priceRangeMin: 285, priceRangeMax: 300 }, 'NSE');
    expect(r.warnings.map(w => w.rule)).not.toContain('PRICE_BAND_DEGENERATE');
    expect(r.errors.map(e => e.rule)).not.toContain('PRICE_BAND_INVERTED');
  });

  it('errors on an INVERTED band (min > max) — never a valid issue', () => {
    const r = validateIPOData({ ...base, priceRangeMin: 300, priceRangeMax: 285 }, 'NSE');
    expect(r.errors.map(e => e.rule)).toContain('PRICE_BAND_INVERTED');
    expect(r.valid).toBe(false);
  });

  it('keeps the existing SEBI width ceiling working for MAINBOARD', () => {
    const r = validateIPOData({ ...base, priceRangeMin: 100, priceRangeMax: 200 }, 'NSE');
    expect(r.errors.map(e => e.rule)).toContain('PRICE_BAND_TOO_WIDE_MAINBOARD');
  });

  it('does not fire on a missing band (null is not a degenerate band)', () => {
    const r = validateIPOData({ ...base, priceRangeMin: null, priceRangeMax: null }, 'NSE');
    expect(r.warnings.map(w => w.rule)).not.toContain('PRICE_BAND_DEGENERATE');
    expect(r.errors.map(e => e.rule)).not.toContain('PRICE_BAND_INVERTED');
  });
});
