import { describe, it, expect } from 'vitest';
import { FIELD_PRIORITY_MATRIX } from '../../../src/config/field-priority-matrix.js';
import { validateValue } from '../../../src/services/normalization-engine.js';

/**
 * Stage 1 round 3 — the matrix carried a SECOND, silently-enforced copy of
 * the "legal minimum lot is 10" rule on `lot_size`/`lotSize`
 * (`validation: { min: 10 }`). SEBI sets no such floor: a high-priced issue
 * can legally have a lot under 10 shares (e.g. lot=8 at a ~1700-1785 band).
 * `validateValue` only ever sees the bare number, never the price band, so
 * it can only ever be a PLAUSIBILITY guard (reject absurd values), never the
 * legal-lot check — that lives in `validateIPOData` (SEBI_RETAIL_WINDOW).
 *
 * These tests pin the matrix entry at `min: 1` and guard against the same
 * class reappearing under a new key name.
 */
describe('field priority matrix — lot_size/lotSize plausibility floor (stage 1 round 3)', () => {
  it('lot_size accepts a legal sub-10 lot (8)', () => {
    expect(validateValue(8, FIELD_PRIORITY_MATRIX.lot_size)).toBe(true);
  });

  it('lotSize accepts a legal sub-10 lot (8)', () => {
    expect(validateValue(8, FIELD_PRIORITY_MATRIX.lotSize)).toBe(true);
  });

  it('lot_size rejects 0 (absurd, below the plausibility floor)', () => {
    expect(validateValue(0, FIELD_PRIORITY_MATRIX.lot_size)).toBe(false);
  });

  it('lotSize rejects 0 (absurd, below the plausibility floor)', () => {
    expect(validateValue(0, FIELD_PRIORITY_MATRIX.lotSize)).toBe(false);
  });

  it('lot_size rejects 100001 (above the plausibility ceiling)', () => {
    expect(validateValue(100001, FIELD_PRIORITY_MATRIX.lot_size)).toBe(false);
  });

  it('lotSize rejects 100001 (above the plausibility ceiling)', () => {
    expect(validateValue(100001, FIELD_PRIORITY_MATRIX.lotSize)).toBe(false);
  });

  it('no matrix key matching /lot/i carries a validation.min above 1 (class guard)', () => {
    const offenders = Object.entries(FIELD_PRIORITY_MATRIX)
      .filter(([key]) => /lot/i.test(key))
      .filter(([, rule]) => (rule.validation?.min ?? 0) > 1)
      .map(([key, rule]) => `${key} (min=${rule.validation?.min})`);

    expect(offenders, `lot-related matrix entries with min > 1: ${offenders.join(', ')}`).toEqual([]);
  });
});
