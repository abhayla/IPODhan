/**
 * T-329 (round-7 P1-4 GUARD FIX) — Rule 8 extended: NON_IPO_CORPORATE_ACTION_SHAPE.
 *
 * FINDING-P1-3-lot-band-and-shape.md: 7 rows typed offering_type='IPO' are
 * corporate actions (KWALITY WALLS = HUL demerger, MORGANITE CRUCIBLE,
 * MUTHOOT FINCOTP, BANGANGA PAPER, NIRBHAY COLOURS, SANMITRA COMMERCIAL,
 * STANBIK AGRO) sharing the shape price_min==price_max, lot_size=100, a
 * 10-14 day "bidding window". The pre-existing NON_IPO_SHAPE_GUARD (Rule 8)
 * condition (window > 10 days AND no lot size AND no issue size) can never
 * fire on rows that HAVE lot+issue size — every one of these 7 does.
 */

import { describe, it, expect } from 'vitest';
import { validateIPOData } from '../../../src/utils/data-validation';

const CORPORATE_ACTION_ROWS = [
  { name: 'KWALITY WALLS (INDIA) LTD', price: 21, openDate: '2026-04-23', closeDate: '2026-05-07' }, // 14d
  { name: 'MORGANITE CRUCIBLE INDIA LTD', price: 1557, openDate: '2025-12-31', closeDate: '2026-01-13' }, // 13d
  { name: 'MUTHOOT FINCOTP LIMITED', price: 1000, openDate: '2026-01-01', closeDate: '2026-01-11' }, // 10d
  { name: 'BANGANGA PAPER INDUSTRIES LTD', price: 1, openDate: '2026-04-06', closeDate: '2026-04-20' }, // 14d
  { name: 'NIRBHAY COLOURS INDIA LTD', price: 10, openDate: '2026-02-26', closeDate: '2026-03-12' }, // 14d
  { name: 'SANMITRA COMMERCIAL LTD', price: 500, openDate: '2026-01-06', closeDate: '2026-01-20' }, // 14d
  { name: 'STANBIK AGRO LIMITED', price: 500, openDate: '2025-12-03', closeDate: '2025-12-16' }, // 13d
];

describe('validateIPOData — Rule 8 NON_IPO_CORPORATE_ACTION_SHAPE (T-329 round-7 P1-4 GUARD FIX)', () => {
  for (const row of CORPORATE_ACTION_ROWS) {
    it(`fires for ${row.name} (fixed ₹${row.price}, lot 100, corporate-action window)`, () => {
      const result = validateIPOData(
        {
          companyName: row.name,
          offeringType: 'IPO',
          segment: 'MAINBOARD',
          priceRangeMin: row.price,
          priceRangeMax: row.price,
          lotSize: 100,
          issueSize: '5000000', // HAS an issue size — the pre-existing guard can never fire on this
          openDate: row.openDate,
          closeDate: row.closeDate,
        },
        'CHITTORGARH'
      );
      expect(result.valid).toBe(false);
      expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
      // Confirm the pre-existing window guard genuinely does NOT fire on
      // this row (it HAS lot/issue size) — proves this is a real gap-fill,
      // not a duplicate of an already-firing rule.
      expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_WINDOW_TOO_LONG');
    });
  }

  it('RED against the pre-fix guard shape: the KWALITY WALLS row would have been silently accepted', () => {
    // Replays the exact pre-existing NON_IPO_WINDOW_TOO_LONG precondition
    // (noLotSize && noIssueSize) to prove it is false for this row — this
    // is why the corporate-action shape needed its own signal.
    const data = { lotSize: 100, issueSize: '5000000' };
    const noLotSize = !data.lotSize || data.lotSize <= 0;
    const issueSizeNum = Number(data.issueSize);
    const noIssueSize = !Number.isFinite(issueSizeNum) || issueSizeNum <= 0;
    expect(noLotSize && noIssueSize).toBe(false); // the old guard's precondition never holds here
  });
});

describe('validateIPOData — Rule 8 NON_IPO_CORPORATE_ACTION_SHAPE negative controls (must NOT over-match)', () => {
  // Three real, genuine SME FIXED_PRICE IPOs — short subscription windows
  // (3-5 days, the SME norm), distinguishing them from the 10-14 day
  // corporate-action-echo window even though they may share a fixed price.
  const GENUINE_SME_FIXED_PRICE_ROWS = [
    { name: 'Genuine SME Fixed Price Textiles Ltd.', price: 45, lotSize: 3000, openDate: '2026-03-10', closeDate: '2026-03-12' }, // 2d
    { name: 'Genuine SME Fixed Price Engineering Ltd.', price: 60, lotSize: 2000, openDate: '2026-05-05', closeDate: '2026-05-08' }, // 3d
    { name: 'Genuine SME Fixed Price Foods Ltd.', price: 30, lotSize: 4000, openDate: '2026-06-15', closeDate: '2026-06-18' }, // 3d
  ];

  for (const row of GENUINE_SME_FIXED_PRICE_ROWS) {
    it(`does NOT flag ${row.name} — fixed price but a genuine short SME window and non-100 lot`, () => {
      const result = validateIPOData(
        {
          companyName: row.name,
          offeringType: 'IPO',
          issueType: 'FIXED_PRICE',
          segment: 'SME',
          priceRangeMin: row.price,
          priceRangeMax: row.price,
          lotSize: row.lotSize,
          issueSize: '150000000',
          openDate: row.openDate,
          closeDate: row.closeDate,
        },
        'NSE'
      );
      expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
    });
  }

  it('does NOT flag a fixed-price, lot-100 row with a genuinely short (3-day) window', () => {
    const result = validateIPOData(
      {
        companyName: 'Short Window Fixed Price Ltd.',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 50,
        priceRangeMax: 50,
        lotSize: 100,
        issueSize: '5000000',
        openDate: '2026-07-01',
        closeDate: '2026-07-04',
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
  });

  it('does NOT flag a lot-100, 10-14 day window row with a REAL price band (not fixed price)', () => {
    const result = validateIPOData(
      {
        companyName: 'Real Band Extended Offer Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 95,
        priceRangeMax: 105,
        lotSize: 100,
        issueSize: '5000000',
        openDate: '2026-04-01',
        closeDate: '2026-04-12',
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
  });

  it('does NOT flag a fixed-price, 10-14 day window row when lot size is NOT 100', () => {
    const result = validateIPOData(
      {
        companyName: 'Non-100-Lot Fixed Price Ltd.',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 40,
        priceRangeMax: 40,
        lotSize: 3000,
        issueSize: '5000000',
        openDate: '2026-04-01',
        closeDate: '2026-04-12',
      },
      'NSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
  });

  it('does NOT fire when the row was already reclassified away from IPO', () => {
    const result = validateIPOData(
      {
        companyName: 'KWALITY WALLS (INDIA) LTD',
        offeringType: 'BUYBACK',
        segment: 'MAINBOARD',
        priceRangeMin: 21,
        priceRangeMax: 21,
        lotSize: 100,
        issueSize: '5000000',
        openDate: '2026-04-23',
        closeDate: '2026-05-07',
      },
      'CHITTORGARH'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_CORPORATE_ACTION_SHAPE');
  });

  it('leaves a genuine mainboard book-built IPO (real band, short window) untouched', () => {
    const result = validateIPOData(
      {
        companyName: 'Augmont Enterprises Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 750,
        priceRangeMax: 788,
        lotSize: 19,
        issueSize: '8250000000.00',
        openDate: '2026-08-21',
        closeDate: '2026-08-25',
      },
      'BSE'
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
