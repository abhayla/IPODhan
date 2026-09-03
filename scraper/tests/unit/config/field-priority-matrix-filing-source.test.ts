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
