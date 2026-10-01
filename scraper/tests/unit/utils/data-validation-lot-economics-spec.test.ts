/**
 * #721: Rule 9 (lot economics) matches spec §1.2 row 4 / §1.11 exactly, and a payload with no
 * segment is judged against the §2.8 INFERRED segment instead of being skipped.
 *
 *   MAINBOARD  ₹10,000 <= lot x cap <= ₹15,000
 *   SME        lot x cap >= ₹1,00,000 per lot; NO per-lot upper bound
 *   no segment SME when lot x cap >= ₹50,000 and the IPO is not on two exchanges, else MAINBOARD
 *
 * Real rows behind the cases (ipodhan_staging, docs/design/probes/lot-economics-rule9-spec.out.json):
 * narmadesh-brass-industries-ltd (SME, FIXED_PRICE, lot 100 x 515 = 51,500), twinkle-papers-ltd
 * (no segment, NSE+BSE, lot 2000 x 69 = 1,38,000), dhanwel-hybird-seeds-ltd (no segment, BSE,
 * lot 1200 x 99 = 1,18,800).
 */
import { describe, it, expect } from 'vitest';
import {
  validateIPOData,
  inferSegmentFromLotValue,
  SEBI_RETAIL_WINDOW,
} from '../../../src/utils/data-validation';

const rule9 = (r: ReturnType<typeof validateIPOData>) =>
  r.errors.filter((e) => e.rule.startsWith('LOT_ECONOMICS_IMPOSSIBLE')).map((e) => e.rule);

describe('#721 Rule 9 bounds are the spec §1.2 row 4 bounds', () => {
  it('SME has no per-lot upper bound: lot 1000 x Rs250 = Rs2,50,000 is accepted', () => {
    const r = validateIPOData({ companyName: 'X', segment: 'SME', offeringType: 'IPO', lotSize: 1000, priceRangeMin: 240, priceRangeMax: 250 });
    expect(rule9(r)).toEqual([]);
    expect(SEBI_RETAIL_WINDOW.SME.max).toBe(Number.POSITIVE_INFINITY);
  });

  it('MAINBOARD upper bound is Rs15,000: lot 50 x Rs310 = Rs15,500 is refused', () => {
    const r = validateIPOData({ companyName: 'X', segment: 'MAINBOARD', offeringType: 'IPO', lotSize: 50, priceRangeMin: 300, priceRangeMax: 310 });
    expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD']);
  });

  it('MAINBOARD at exactly Rs15,000 (Tata Technologies 30 x 500) is accepted', () => {
    const r = validateIPOData({ companyName: 'X', segment: 'MAINBOARD', offeringType: 'IPO', lotSize: 30, priceRangeMin: 475, priceRangeMax: 500 });
    expect(rule9(r)).toEqual([]);
  });

  it('a FIXED_PRICE SME issue is judged too: narmadesh-brass lot 100 x Rs515 = Rs51,500 is refused', () => {
    const r = validateIPOData({ companyName: 'X', segment: 'SME', offeringType: 'IPO', issueType: 'FIXED_PRICE', lotSize: 100, priceRangeMin: 515, priceRangeMax: 515 });
    expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_SME']);
  });
});

describe('#721 a missing segment is inferred (§2.8), not skipped', () => {
  it('inferSegmentFromLotValue: >= Rs50,000 on one exchange is SME, two exchanges is MAINBOARD, below is MAINBOARD', () => {
    expect(inferSegmentFromLotValue(1200, 99, ['BSE'])).toBe('SME');
    expect(inferSegmentFromLotValue(1200, 99, null)).toBe('SME');
    expect(inferSegmentFromLotValue(2000, 69, ['NSE', 'BSE'])).toBe('MAINBOARD');
    expect(inferSegmentFromLotValue(100, 140, ['BSE'])).toBe('MAINBOARD');
    expect(inferSegmentFromLotValue(null, 140, ['BSE'])).toBeNull();
    expect(inferSegmentFromLotValue(100, 0, ['BSE'])).toBeNull();
  });

  it('the issue #721 shape: lot 8 x Rs12,500 = Rs1,00,000 on NSE+BSE with no segment is refused as MAINBOARD', () => {
    const r = validateIPOData({ companyName: 'X', offeringType: 'IPO', lotSize: 8, priceRangeMin: 12000, priceRangeMax: 12500, listingExchanges: ['NSE', 'BSE'] });
    expect(r.valid).toBe(false);
    expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD']);
    expect(r.errors.find((e) => e.rule === 'LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD')?.message).toMatch(/inferred/);
  });

  it('no segment, lot 100 x Rs300 = Rs30,000 (between the windows) is refused', () => {
    const r = validateIPOData({ companyName: 'X', offeringType: 'IPO', lotSize: 100, priceRangeMin: 290, priceRangeMax: 300 });
    expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD']);
  });

  it('no segment, one exchange, lot 100 x Rs700 = Rs70,000 is inferred SME and refused (below Rs1,00,000)', () => {
    const r = validateIPOData({ companyName: 'X', offeringType: 'IPO', lotSize: 100, priceRangeMin: 690, priceRangeMax: 700, listingExchanges: ['BSE'] });
    expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_SME']);
  });

  it('no segment, one exchange, dhanwel lot 1200 x Rs99 = Rs1,18,800 is accepted as SME', () => {
    const r = validateIPOData({ companyName: 'X', offeringType: 'IPO', lotSize: 1200, priceRangeMin: 95, priceRangeMax: 99, listingExchanges: ['BSE'] });
    expect(rule9(r)).toEqual([]);
  });

  it('no segment, a sub-10 lot inside the MAINBOARD window (NSE lot 8 x Rs1,785 = Rs14,280) is still accepted by Rule 1 and Rule 9', () => {
    const r = validateIPOData({ companyName: 'X', offeringType: 'IPO', lotSize: 8, priceRangeMin: 1700, priceRangeMax: 1785 });
    expect(r.errors).toEqual([]);
  });

  it('a sourced segment governs, and a disagreement with the inference is flagged as a warning', () => {
    // sri-priyanka-geo-commex: SME, NSE+BSE, lot 600 x Rs212 = Rs1,27,200 (inference says MAINBOARD)
    const r = validateIPOData({ companyName: 'X', segment: 'SME', offeringType: 'IPO', lotSize: 600, priceRangeMin: 212, priceRangeMax: 212, listingExchanges: ['NSE', 'BSE'] });
    expect(rule9(r)).toEqual([]);
    expect(r.warnings.map((w) => w.rule)).toContain('SEGMENT_INFERENCE_DISAGREES');
  });
});

describe('#721 Rule 9 judges equity public issues only (§1.11)', () => {
  for (const offeringType of ['NCD', 'RIGHTS', 'INVITS', 'REITS', 'OFS', 'BUYBACK', 'TENDER']) {
    it(`does not judge ${offeringType} (lot x price is not a retail application there)`, () => {
      const r = validateIPOData({ companyName: 'X', offeringType, lotSize: 100, priceRangeMin: 300, priceRangeMax: 300 });
      expect(rule9(r)).toEqual([]);
    });
  }

  it('judges FPO and an unknown offering type', () => {
    for (const offeringType of ['FPO', undefined, null, 'UNKNOWN']) {
      const r = validateIPOData({ companyName: 'X', offeringType, lotSize: 100, priceRangeMin: 290, priceRangeMax: 300 } as any);
      expect(rule9(r)).toEqual(['LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD']);
    }
  });
});
