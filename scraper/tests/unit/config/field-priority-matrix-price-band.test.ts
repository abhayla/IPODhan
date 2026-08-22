import { describe, it, expect } from 'vitest';
import {
  FIELD_PRIORITY_MATRIX,
  allowsSameSourceRefresh,
  getFieldRules,
} from '../../../src/config/field-priority-matrix.js';

/**
 * F5 (T-264 P2-1) — the matrix registered the price band under snake_case
 * `price_band_min`/`price_band_max`, but consolidation actually keys on
 * camelCase `priceRangeMin`/`priceRangeMax` (data-persister.ts and
 * data-consolidation-orchestrator.ts both build camelCase payloads;
 * `field_sources` in prod contains ONLY the camelCase names). T-264 added the
 * camelCase twin but left the snake_case one in place.
 *
 * T-276 (round-2 P3-4) removed the dead twin: two names for one field is not
 * a harmless alias, it is live ambiguity — `cross-source-disagreement-monitor`
 * filtered `data_conflicts.field_name` on the snake_case names and could
 * therefore never fire a price-band alert.
 *
 * NB: assert against FIELD_PRIORITY_MATRIX directly — getFieldRules()
 * returns a generic default for unknown keys, so it can't prove an entry is
 * actually registered (same caveat as the identifiers test).
 */
describe('field priority matrix — one price-band naming scheme (T-276 / F5)', () => {
  for (const f of ['priceRangeMin', 'priceRangeMax']) {
    it(`registers ${f} explicitly with ADMIN-first source priority`, () => {
      expect(FIELD_PRIORITY_MATRIX[f], `${f} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
      const sources = FIELD_PRIORITY_MATRIX[f].sources;
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]).toBe('ADMIN');
    });
  }

  it('no longer carries the dead snake_case twin (nothing consolidates under it)', () => {
    expect(FIELD_PRIORITY_MATRIX.price_band_min).toBeUndefined();
    expect(FIELD_PRIORITY_MATRIX.price_band_max).toBeUndefined();
  });

  it('is a numeric field with a validation range (not the DEFAULT no-op rule)', () => {
    for (const f of ['priceRangeMin', 'priceRangeMax']) {
      const rules = getFieldRules(f);
      expect(rules.normalization).toBe('number');
      expect(rules.validation).toBeDefined();
      expect(rules.validation?.min).toBe(1);
      expect(rules.validation?.max).toBe(100000);
    }
  });

  it('opts the price band into same-source refresh for its authoritative sources only', () => {
    for (const f of ['priceRangeMin', 'priceRangeMax']) {
      expect(FIELD_PRIORITY_MATRIX[f].sameSourceRefresh).toBe(true);
      expect(allowsSameSourceRefresh(f, 'NSE')).toBe(true);
      expect(allowsSameSourceRefresh(f, 'BSE')).toBe(true);
      // CHITTORGARH is not in the price-band source list — it must not be able
      // to overwrite its own earlier value on this field.
      expect(allowsSameSourceRefresh(f, 'CHITTORGARH')).toBe(false);
    }
  });

  // T-278 P3-7 (#165 F1): MONEYCONTROL and DRHP are listed as valid
  // cross-source priority fallbacks for the price band, but neither is an
  // exchange that "republishes a corrected band mid-issue" — so neither may
  // exercise same-source refresh, even though both appear in `sources`.
  it('narrows same-source refresh to the exchange sources — MONEYCONTROL/DRHP may not self-refresh (#165 F1)', () => {
    for (const f of ['priceRangeMin', 'priceRangeMax']) {
      expect(FIELD_PRIORITY_MATRIX[f].sources).toContain('MONEYCONTROL');
      expect(FIELD_PRIORITY_MATRIX[f].sources).toContain('DRHP');
      expect(allowsSameSourceRefresh(f, 'MONEYCONTROL')).toBe(false);
      expect(allowsSameSourceRefresh(f, 'DRHP')).toBe(false);
    }
  });

  it('does not silently enable same-source refresh for unrelated fields', () => {
    expect(allowsSameSourceRefresh('faceValue', 'NSE')).toBe(false);
    expect(allowsSameSourceRefresh('companyName', 'NSE')).toBe(false);
  });
});
