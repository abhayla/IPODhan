/**
 * T-434 F4 — the filing source's RANK, not just its presence.
 *
 * Round 1 added DRHP to four fields and asserted nothing about where it sat in
 * each list. `getSourcePriority` returns the array INDEX, so a review mutation
 * that moved DRHP from last to second in `listingDate` stayed green — the whole
 * point of putting it last (a printed, indicative ad date must never override a
 * live exchange date) was unenforced. These tests pin the ordering itself.
 */
import { describe, it, expect } from 'vitest';
import { getSourcePriority } from '../../../src/config/field-priority-matrix.js';

describe('field-priority-matrix — the filing source outranks the exchanges where the document is authoritative', () => {
  // The offer document PRINTS these. The exchanges publish derived or default
  // values that are demonstrably wrong (Deepa Jewellers: issue size from a
  // share count, face value defaulted to 10 against a printed Rs 2).
  it.each(['issueSize', 'faceValue'])(
    'ranks DRHP above NSE and BSE for %s',
    (field) => {
      expect(getSourcePriority(field, 'DRHP')).toBeGreaterThanOrEqual(0);
      expect(getSourcePriority(field, 'DRHP')).toBeLessThan(getSourcePriority(field, 'NSE'));
      expect(getSourcePriority(field, 'DRHP')).toBeLessThan(getSourcePriority(field, 'BSE'));
    }
  );

  it('still lets an admin override beat the filing on issueSize and faceValue', () => {
    for (const field of ['issueSize', 'faceValue']) {
      expect(getSourcePriority(field, 'ADMIN')).toBeLessThan(getSourcePriority(field, 'DRHP'));
    }
  });
});

describe('field-priority-matrix — the filing source ranks BELOW the exchanges on timeline dates', () => {
  // The ad prints an INDICATIVE timeline; the exchanges publish the actual one
  // and revise it after the ad goes to press. DRHP is present so a filing can
  // fill an EMPTY date, and last so it can never override a live exchange date.
  it.each(['listingDate', 'allotmentDate'])(
    'ranks NSE and BSE above DRHP for %s',
    (field) => {
      expect(getSourcePriority(field, 'DRHP')).toBeGreaterThanOrEqual(0);
      expect(getSourcePriority(field, 'NSE')).toBeLessThan(getSourcePriority(field, 'DRHP'));
      expect(getSourcePriority(field, 'BSE')).toBeLessThan(getSourcePriority(field, 'DRHP'));
    }
  );

  it('places DRHP last on both timeline fields, so no scraped source loses to it', () => {
    for (const field of ['listingDate', 'allotmentDate']) {
      const drhp = getSourcePriority(field, 'DRHP');
      for (const other of ['ADMIN', 'NSE', 'BSE', 'MONEYCONTROL', 'CHITTORGARH'] as const) {
        const rank = getSourcePriority(field, other);
        if (rank >= 0) expect(rank).toBeLessThan(drhp);
      }
    }
  });
});

describe('field-priority-matrix — a source absent from a field scores -1', () => {
  it('returns -1 for a source not listed, which is what silently dropped the filing write', () => {
    // This is the failure mode the round-1 live run hit: faceValue had no DRHP
    // entry, getSourcePriority returned -1, and the filing lost to NSE's 10.
    expect(getSourcePriority('issueSize', 'API_FALLBACK')).toBe(-1);
  });
});

describe('field-priority-matrix — W-117 (review round 1): the filing beats the AGGREGATORS but NOT the exchanges for bidding-window dates', () => {
  // NSE/BSE publish extensions to the open/close window after the RHP/
  // price-band ad is printed - the ad is never updated when a window is
  // extended, so DRHP must sit BELOW NSE/BSE (same rule as
  // listingDate/allotmentDate already document) and ABOVE MONEYCONTROL/
  // CHITTORGARH, which previously had no standing at all (or, for
  // Moneycontrol, W-116's fabricated open/close dates outranked everything).
  it.each(['open_date', 'openDate', 'close_date', 'closeDate'])(
    'ranks NSE and BSE above DRHP for %s',
    (field) => {
      const drhp = getSourcePriority(field, 'DRHP');
      expect(drhp).toBeGreaterThanOrEqual(0);
      expect(getSourcePriority(field, 'NSE')).toBeLessThan(drhp);
      expect(getSourcePriority(field, 'BSE')).toBeLessThan(drhp);
    }
  );

  it.each(['open_date', 'openDate', 'close_date', 'closeDate'])(
    'ranks DRHP above MONEYCONTROL and CHITTORGARH for %s',
    (field) => {
      const drhp = getSourcePriority(field, 'DRHP');
      expect(drhp).toBeLessThan(getSourcePriority(field, 'MONEYCONTROL'));
      expect(drhp).toBeLessThan(getSourcePriority(field, 'CHITTORGARH'));
    }
  );

  it.each(['open_date', 'openDate', 'close_date', 'closeDate'])(
    'still lets an admin override beat everything, including the exchanges, for %s',
    (field) => {
      const admin = getSourcePriority(field, 'ADMIN');
      for (const other of ['NSE', 'BSE', 'DRHP', 'MONEYCONTROL', 'CHITTORGARH'] as const) {
        expect(admin).toBeLessThan(getSourcePriority(field, other));
      }
    }
  );

  it.each(['closeDate', 'close_date'])(
    'resolves a real bidding-window extension: NSE beats DRHP for %s (NSE "2026-09-05" vs DRHP "2026-09-03" -> NSE wins)',
    (field) => {
      // The exchanges published an EXTENSION past the printed ad's date;
      // the ad was never revised. Lower index = higher priority.
      expect(getSourcePriority(field, 'NSE')).toBeLessThan(getSourcePriority(field, 'DRHP'));
    }
  );

  it('resolves a real conflict: DRHP still beats MONEYCONTROL on openDate/closeDate', () => {
    for (const field of ['openDate', 'closeDate']) {
      // DRHP '2026-09-03' vs MONEYCONTROL '2026-09-05' -> DRHP wins.
      expect(getSourcePriority(field, 'DRHP')).toBeLessThan(getSourcePriority(field, 'MONEYCONTROL'));
    }
  });

  it('honestly documents the current limit: CHITTORGARH does NOT outrank MONEYCONTROL', () => {
    // CHITTORGARH '2026-09-03' vs MONEYCONTROL '2026-09-05' -> MONEYCONTROL
    // still wins by SOURCE_PRIORITY today. This is by design until a
    // date-substance guard exists to prefer the value that was actually
    // read over one merely present in a lower-trust scrape - CHITTORGARH is
    // added here only so it has STANDING at all (previously absent, scoring
    // -1 and losing to everything), not to outrank Moneycontrol.
    for (const field of ['openDate', 'closeDate']) {
      expect(getSourcePriority(field, 'CHITTORGARH')).toBeGreaterThan(
        getSourcePriority(field, 'MONEYCONTROL')
      );
    }
  });
});
