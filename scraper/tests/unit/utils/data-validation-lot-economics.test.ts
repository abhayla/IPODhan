/**
 * T-329 (round-7 P1-4 INVARIANT) — Rule 9: Lot-Economics Invariant.
 *
 * FINDING-P1-3-lot-band-and-shape.md: SEBI caps a retail mainboard
 * application at ~Rs15,000, so lot_size x upper band must land in
 * ~Rs10k-16k. Rule 4 (MIN_INVESTMENT_*) already flags this shape but only
 * WARNS — it never blocks persistence, so 10 rows with an arithmetically
 * impossible "minimum investment" render on the live site today. Rule 9
 * hard-rejects the same shape.
 */

import { describe, it, expect } from 'vitest';
import { validateIPOData } from '../../../src/utils/data-validation';

// The 10 live violators from plausibility.txt LOT_BAND_INCOHERENT(_SME).
const MAINBOARD_VIOLATORS = [
  { name: 'ICICI Prudential Asset Management Company Limited', lotSize: 100, priceRangeMax: 2165 },
  { name: 'STALLION INDIA FLUOROCHEMICALS LTD', lotSize: 4000, priceRangeMax: 90 },
  { name: 'MORGANITE CRUCIBLE INDIA LTD', lotSize: 100, priceRangeMax: 1557 },
  { name: 'MUTHOOT FINCOTP LIMITED', lotSize: 100, priceRangeMax: 1000 },
  { name: 'BANGANGA PAPER INDUSTRIES LTD', lotSize: 100, priceRangeMax: 1 },
  { name: 'NIRBHAY COLOURS INDIA LTD', lotSize: 100, priceRangeMax: 10 },
  { name: 'KWALITY WALLS (INDIA) LTD', lotSize: 100, priceRangeMax: 21 },
  { name: 'AAA TECHNOLOGIES LTD', lotSize: 100, priceRangeMax: 42 },
];

const SME_VIOLATORS = [
  { name: 'MARUTI INTERIOR PRODUCTS LTD', lotSize: 1000, priceRangeMax: 10 },
  { name: 'Narmadesh Brass Industries Ltd.', lotSize: 100, priceRangeMax: 515 },
];

describe('validateIPOData — Rule 9 LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD (T-329 round-7 P1-4)', () => {
  for (const v of MAINBOARD_VIOLATORS) {
    it(`rejects ${v.name} (${v.lotSize} x ${v.priceRangeMax} = ₹${(v.lotSize * v.priceRangeMax).toLocaleString('en-IN')})`, () => {
      const result = validateIPOData(
        {
          companyName: v.name,
          offeringType: 'IPO',
          segment: 'MAINBOARD',
          priceRangeMin: v.priceRangeMax,
          priceRangeMax: v.priceRangeMax,
          lotSize: v.lotSize,
        },
        'NSE'
      );
      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.rule)).toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    });
  }

  it('accepts a genuine MAINBOARD lot/band within the SEBI retail range (lot 100 x Rs120 = Rs12,000)', () => {
    const result = validateIPOData(
      {
        companyName: 'Genuine Mainboard IPO Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 110,
        priceRangeMax: 120,
        lotSize: 100,
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });

  it('does not reject a MAINBOARD FIXED_PRICE issue outside the book-built retail band', () => {
    const result = validateIPOData(
      {
        companyName: 'Fixed Price Corporate Action Ltd.',
        offeringType: 'IPO',
        issueType: 'FIXED_PRICE',
        segment: 'MAINBOARD',
        priceRangeMin: 21,
        priceRangeMax: 21,
        lotSize: 100,
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });
});

describe('validateIPOData — Rule 9 LOT_ECONOMICS_IMPOSSIBLE_SME (T-329 round-7 P1-4)', () => {
  for (const v of SME_VIOLATORS) {
    it(`rejects ${v.name} (${v.lotSize} x ${v.priceRangeMax} = ₹${(v.lotSize * v.priceRangeMax).toLocaleString('en-IN')})`, () => {
      const result = validateIPOData(
        {
          companyName: v.name,
          offeringType: 'IPO',
          segment: 'SME',
          priceRangeMin: v.priceRangeMax,
          priceRangeMax: v.priceRangeMax,
          lotSize: v.lotSize,
        },
        'NSE'
      );
      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.rule)).toContain('LOT_ECONOMICS_IMPOSSIBLE_SME');
    });
  }

  it('accepts a genuine SME lot/band within the SEBI retail range (lot 1200 x Rs95 = Rs1,14,000 — Trust Fintech shape)', () => {
    const result = validateIPOData(
      {
        companyName: 'Trust Fintech Limited',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 91,
        priceRangeMax: 95,
        lotSize: 1200,
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_SME');
  });
});

describe('validateIPOData — Rule 9 is bounded (no false positives)', () => {
  it('does not fire when lotSize is missing', () => {
    const result = validateIPOData(
      { companyName: 'No Lot Yet Ltd.', offeringType: 'IPO', segment: 'MAINBOARD', priceRangeMax: 100 },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });

  it('does not fire when priceRangeMax is missing', () => {
    const result = validateIPOData(
      { companyName: 'No Band Yet Ltd.', offeringType: 'IPO', segment: 'MAINBOARD', lotSize: 100 },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });

  it('does not fire for an unknown/absent segment (nothing to check against)', () => {
    const result = validateIPOData(
      { companyName: 'No Segment Ltd.', offeringType: 'IPO', priceRangeMax: 21, lotSize: 100 },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_ECONOMICS_IMPOSSIBLE_SME');
  });

  it('evaluates lotSize/priceRangeMax whenever both are present, regardless of offeringType (matches Rule 4 MIN_INVESTMENT_* behavior)', () => {
    const result = validateIPOData(
      { companyName: 'Rights Issue Co.', offeringType: 'RIGHTS', segment: 'MAINBOARD', priceRangeMax: 21, lotSize: 100 },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });
});
