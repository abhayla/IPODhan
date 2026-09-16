/**
 * Lot-size floor derives from the SEBI retail window, not a fixed 10.
 *
 * RCA: scraper/src/utils/data-validation.ts Rule 1 rejected any lot_size < 10
 * as "Likely scraper error" — but SEBI ICDR Reg 32(1) sizes the retail lot by
 * VALUE (lot x cap price inside the retail application window), so a
 * high-priced mainboard issue legally has a lot under 10. Live sample:
 * NATIONAL STOCK EXCHANGE OF INDIA LIMITED (BSE source), band
 * Rs1,700-1,785, lot 8 -> 8 x 1,785 = Rs14,280, inside the
 * Rs10,000-16,000 MAINBOARD window (scripts/lib/substance-checks.mjs
 * MAINBOARD_LOT_ECONOMICS_MIN/MAX, and Rule 9's own 10000/16000 below).
 * Every staging cycle logged "lot_size = 8 is below minimum threshold (10)"
 * for this row and the row's lot_size stayed NULL.
 *
 * This test is RED on main (the fixed "< 10" floor rejects the NSE row
 * unconditionally) and GREEN after Rule 1 is changed to consult the same
 * SEBI-window rule Rule 9 already encodes.
 */

import { describe, it, expect } from 'vitest';
import { validateIPOData, SEBI_RETAIL_WINDOW } from '../../../src/utils/data-validation';
import {
  MAINBOARD_LOT_ECONOMICS_MIN,
  MAINBOARD_LOT_ECONOMICS_MAX,
  SME_LOT_ECONOMICS_MIN,
  SME_LOT_ECONOMICS_MAX,
} from '../../../../scripts/lib/substance-checks.mjs';

describe('validateIPOData — Rule 1 lot-size floor derives from the SEBI retail window (staging NSE row)', () => {
  it('accepts the NATIONAL STOCK EXCHANGE OF INDIA LIMITED shape: MAINBOARD, band 1700-1785, lot 8 (=> Rs14,280, inside window)', () => {
    const result = validateIPOData(
      {
        companyName: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 1700,
        priceRangeMax: 1785,
        lotSize: 8,
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_SIZE_TOO_LOW');
  });

  it('still refuses a lot of 8 at a low cap price (Rs100) — Rs800 is nowhere near the SEBI window', () => {
    const result = validateIPOData(
      {
        companyName: 'Implausible Low-Value Lot Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 100,
        priceRangeMax: 100,
        lotSize: 8,
      },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');
  });

  it('accepts an SME shape with a sub-10 lot whose minimum investment lands in the SME window (lot 9 x Rs12,000 = Rs1,08,000)', () => {
    const result = validateIPOData(
      {
        companyName: 'High-Priced SME Shape Ltd.',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 11500,
        priceRangeMax: 12000,
        lotSize: 9,
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('LOT_SIZE_TOO_LOW');
  });

  it('still refuses an SME sub-10 lot outside the SME window (lot 9 x Rs100 = Rs900)', () => {
    const result = validateIPOData(
      {
        companyName: 'Implausible SME Lot Ltd.',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 100,
        priceRangeMax: 100,
        lotSize: 9,
      },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');
  });

  it('falls back to the fixed numeric floor when no price band is on record (nothing to check the lot against)', () => {
    const result = validateIPOData(
      { companyName: 'No Band Sub-10 Lot Ltd.', offeringType: 'IPO', segment: 'MAINBOARD', lotSize: 8 },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');
  });

  it('a genuinely absurd lot (0 or negative) is still "Likely scraper error", never window-exempted', () => {
    const result = validateIPOData(
      {
        companyName: 'Zero Lot Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 1700,
        priceRangeMax: 1785,
        lotSize: 0,
      },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');
  });

  it('a FIXED_PRICE issue is exempt from the window carve-out (same exemption Rule 9 uses) and falls back to the numeric floor', () => {
    const result = validateIPOData(
      {
        companyName: 'Fixed Price Sub-10 Lot Ltd.',
        offeringType: 'IPO',
        issueType: 'FIXED_PRICE',
        segment: 'MAINBOARD',
        priceRangeMin: 1785,
        priceRangeMax: 1785,
        lotSize: 8,
      },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');
  });

  it('the exported SEBI_RETAIL_WINDOW constants agree with substance-checks.mjs (single source of truth, kept in sync by hand)', () => {
    expect(SEBI_RETAIL_WINDOW.MAINBOARD.min).toBe(MAINBOARD_LOT_ECONOMICS_MIN);
    expect(SEBI_RETAIL_WINDOW.MAINBOARD.max).toBe(MAINBOARD_LOT_ECONOMICS_MAX);
    expect(SEBI_RETAIL_WINDOW.SME.min).toBe(SME_LOT_ECONOMICS_MIN);
    expect(SEBI_RETAIL_WINDOW.SME.max).toBe(SME_LOT_ECONOMICS_MAX);
  });
});

describe('validateIPOData — Rule 9 reads SEBI_RETAIL_WINDOW, not inline literals (review round 1)', () => {
  it('Rule 9 trips LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD just below the window floor (lot 100 x Rs99 = Rs9,900 < Rs10,000)', () => {
    const result = validateIPOData(
      {
        companyName: 'Just Under The Window Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 90,
        priceRangeMax: 99,
        lotSize: 100,
      },
      'NSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
    const err = result.errors.find((e) => e.rule === 'LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD')!;
    expect(err.message).toContain('₹9,900');
    expect(err.message).toContain('falls outside the SEBI ICDR Reg 32(1) retail range (~₹10,000-₹16,000)');
  });

  it('a change to SEBI_RETAIL_WINDOW.MAINBOARD.min is observed by BOTH Rule 1 and Rule 9 at the same boundary (minInvestment = 9,999, just below min)', () => {
    // Rule 1: lot under 10, window-explained only if inside [min,max] -> 9,999 is
    // OUTSIDE (below) the window, so Rule 1 still refuses it as LOT_SIZE_TOO_LOW.
    const rule1Result = validateIPOData(
      {
        companyName: 'Boundary Sub-10 Lot Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 900,
        priceRangeMax: 1111,
        lotSize: 9, // 9 x 1111 = 9,999
      },
      'NSE'
    );
    expect(rule1Result.valid).toBe(false);
    expect(rule1Result.errors.map((e) => e.rule)).toContain('LOT_SIZE_TOO_LOW');

    // Rule 9: lot >= 10, minInvestment = 9,999 (lot 111 x cap 90.081 -> use an
    // exact figure instead: lot 101 x cap 99 = 9,999) -> also outside the
    // window, rejected by LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD. Both rules key
    // off the same SEBI_RETAIL_WINDOW.MAINBOARD boundary — a change to that
    // constant moves both verdicts together.
    const rule9Result = validateIPOData(
      {
        companyName: 'Boundary Lot-Economics Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 90,
        priceRangeMax: 99,
        lotSize: 101, // 101 x 99 = 9,999
      },
      'NSE'
    );
    expect(rule9Result.valid).toBe(false);
    expect(rule9Result.errors.map((e) => e.rule)).toContain('LOT_ECONOMICS_IMPOSSIBLE_MAINBOARD');
  });
});

describe('validateIPOData — Rule 1 names the missing-segment reason distinctly from the missing-band reason (review round 1 MINOR)', () => {
  it('gives a segment-specific reason when the band IS present but segment is missing', () => {
    const result = validateIPOData(
      { companyName: 'No Segment Sub-10 Lot Ltd.', offeringType: 'IPO', priceRangeMin: 1700, priceRangeMax: 1785, lotSize: 8 },
      'NSE'
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.rule === 'LOT_SIZE_TOO_LOW')!;
    expect(err.message).toContain('no segment (MAINBOARD/SME) is on record');
    expect(err.message).not.toContain('no price band is on record');
  });

  it('keeps the original missing-band reason when the band itself is absent', () => {
    const result = validateIPOData(
      { companyName: 'No Band Sub-10 Lot Ltd2.', offeringType: 'IPO', segment: 'MAINBOARD', lotSize: 8 },
      'NSE'
    );
    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.rule === 'LOT_SIZE_TOO_LOW')!;
    expect(err.message).toContain('no price band is on record');
  });
});
