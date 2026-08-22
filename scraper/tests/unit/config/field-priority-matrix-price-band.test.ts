import { describe, it, expect } from 'vitest';
import { FIELD_PRIORITY_MATRIX, getFieldRules } from '../../../src/config/field-priority-matrix.js';

/**
 * F5 (T-264 P2-1) — the matrix registered the price band under snake_case
 * `price_band_min`/`price_band_max`, but consolidation actually keys on
 * camelCase `priceRangeMin`/`priceRangeMax` (nse-scraper-orchestrator-v2.ts
 * writes these; field_sources confirmed it in prod). Without the camelCase
 * twin, getFieldRules('priceRangeMin') fell through to the DEFAULT rule (no
 * validation, no confidence gate), so a stale single-price write was never
 * re-consolidated once NSE started carrying the real range — 232/267 IPO
 * rows (87%) ended up with price_range_min = price_range_max.
 *
 * NB: assert against FIELD_PRIORITY_MATRIX directly — getFieldRules()
 * returns a generic default for unknown keys, so it can't prove an entry is
 * actually registered (same caveat as the identifiers test).
 */
describe('field priority matrix — price band camelCase keys registered (F5)', () => {
  for (const f of ['price_band_min', 'price_band_max', 'priceRangeMin', 'priceRangeMax']) {
    it(`registers ${f} explicitly with ADMIN-first source priority`, () => {
      expect(FIELD_PRIORITY_MATRIX[f], `${f} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
      const sources = FIELD_PRIORITY_MATRIX[f].sources;
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]).toBe('ADMIN');
    });
  }

  it('keeps the camelCase keys in sync with their snake_case twin (same sources/validation)', () => {
    expect(FIELD_PRIORITY_MATRIX.priceRangeMin.sources).toEqual(
      FIELD_PRIORITY_MATRIX.price_band_min.sources
    );
    expect(FIELD_PRIORITY_MATRIX.priceRangeMax.sources).toEqual(
      FIELD_PRIORITY_MATRIX.price_band_max.sources
    );
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
});
