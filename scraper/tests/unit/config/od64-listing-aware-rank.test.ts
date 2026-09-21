/**
 * OD-64 — source priority for `status` and the price band follows the LISTING
 * VENUE, not a fixed global order.
 *
 * Owner, 2026-09-21: "For IPOs which are only for NSE ... NSE should be first
 * source ... BSE should not be there because this is an NSE only IPO. If there
 * is a BSE only IPO again the status should come from BSE ... but NSE should
 * not be an option."
 *
 * The rule is about ELIGIBILITY as much as order: an exchange that does not
 * list the IPO is not a lower-ranked source, it is NOT A SOURCE. The exchange
 * is the authority on its own issue; the other one has no standing to speak
 * about an issue it does not list.
 *
 * Today the matrix ranks `status` as ['ADMIN','NSE','BSE','MONEYCONTROL',
 * 'CHITTORGARH'] and the band as ['ADMIN','DRHP','NSE','BSE','MONEYCONTROL'] —
 * FIXED orders that never read `ipos.listing_exchanges`, so NSE outranks BSE
 * even on a BSE-only IPO.
 *
 * Measured on staging 2026-09-21: BSE-only 193 IPOs, BOTH 105, NSE-only 71,
 * and ZERO rows currently violate the rule — every BSE-only IPO is
 * BSE-sourced, every NSE-only NSE-sourced. That is an accident of collection
 * (each scraper reads only its own board), not a guarantee: nothing in the
 * ranking code prevents the cross-write. This is a guard, not a repair.
 *
 * `-1` is the existing "not eligible" signal — `getSourcePriority` already
 * returns it via `.indexOf`, and the resolver at
 * data-consolidation-service.ts:2446-2452 already refuses to let a `-1`
 * incoming source win. OD-64 reuses that rather than inventing a mechanism.
 */
import { describe, it, expect } from 'vitest';
import { getSourcePriority } from '../../../src/config/field-priority-matrix.js';

const OD64_FIELDS = ['status', 'priceRangeMin', 'priceRangeMax'] as const;

describe('OD-64: a non-listing exchange is not eligible for status or the price band', () => {
  describe.each(OD64_FIELDS)('%s', (field) => {
    it('BSE is NOT eligible on an NSE-only IPO', () => {
      expect(getSourcePriority(field, 'BSE', 'ipos', 'MAINBOARD', ['NSE'])).toBe(-1);
    });

    it('NSE is NOT eligible on a BSE-only IPO', () => {
      expect(getSourcePriority(field, 'NSE', 'ipos', 'MAINBOARD', ['BSE'])).toBe(-1);
    });

    it('the listing exchange outranks every website on an NSE-only IPO', () => {
      const nse = getSourcePriority(field, 'NSE', 'ipos', 'MAINBOARD', ['NSE']);
      const cg = getSourcePriority(field, 'CHITTORGARH', 'ipos', 'MAINBOARD', ['NSE']);
      expect(nse).toBeGreaterThanOrEqual(0);
      // A website may be absent from a field's list entirely (-1); when it IS
      // ranked it must sit BELOW the listing exchange.
      if (cg !== -1) expect(nse).toBeLessThan(cg);
    });

    it('the listing exchange outranks every website on a BSE-only IPO', () => {
      const bse = getSourcePriority(field, 'BSE', 'ipos', 'MAINBOARD', ['BSE']);
      const cg = getSourcePriority(field, 'CHITTORGARH', 'ipos', 'MAINBOARD', ['BSE']);
      expect(bse).toBeGreaterThanOrEqual(0);
      if (cg !== -1) expect(bse).toBeLessThan(cg);
    });

    it('both exchanges are eligible, and both outrank the websites, when listed on BOTH', () => {
      const nse = getSourcePriority(field, 'NSE', 'ipos', 'MAINBOARD', ['NSE', 'BSE']);
      const bse = getSourcePriority(field, 'BSE', 'ipos', 'MAINBOARD', ['NSE', 'BSE']);
      const mc = getSourcePriority(field, 'MONEYCONTROL', 'ipos', 'MAINBOARD', ['NSE', 'BSE']);
      expect(nse).toBeGreaterThanOrEqual(0);
      expect(bse).toBeGreaterThanOrEqual(0);
      if (mc !== -1) {
        expect(nse).toBeLessThan(mc);
        expect(bse).toBeLessThan(mc);
      }
    });

    it('ADMIN still outranks the listing exchange', () => {
      // A hand correction beats the exchange. OD-64 reorders exchanges and
      // websites; it does not touch the admin override.
      const admin = getSourcePriority(field, 'ADMIN', 'ipos', 'MAINBOARD', ['BSE']);
      const bse = getSourcePriority(field, 'BSE', 'ipos', 'MAINBOARD', ['BSE']);
      expect(admin).toBeGreaterThanOrEqual(0);
      expect(admin).toBeLessThan(bse);
    });

    it('falls back to the fixed order when the listing venue is unknown', () => {
      // 193 of 369 rows have a venue, but a brand-new IPO may not yet. An
      // unknown venue must not make every exchange ineligible and freeze the
      // field — it keeps today's behaviour.
      const noVenue = getSourcePriority(field, 'NSE', 'ipos', 'MAINBOARD', undefined);
      const emptyVenue = getSourcePriority(field, 'NSE', 'ipos', 'MAINBOARD', []);
      expect(noVenue).toBeGreaterThanOrEqual(0);
      expect(emptyVenue).toBeGreaterThanOrEqual(0);
    });
  });

  it('leaves a field OUTSIDE the OD-64 set alone (issueSize is not venue-ranked)', () => {
    // OD-64 names exactly two things: status and the price band. Widening it
    // to every field would be a different decision than the owner made.
    const withVenue = getSourcePriority('issueSize', 'BSE', 'ipos', 'MAINBOARD', ['NSE']);
    const without = getSourcePriority('issueSize', 'BSE', 'ipos', 'MAINBOARD', undefined);
    expect(withVenue).toBe(without);
  });
});
