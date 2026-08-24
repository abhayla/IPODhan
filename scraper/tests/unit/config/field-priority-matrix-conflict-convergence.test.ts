import { describe, it, expect } from 'vitest';
import {
  FIELD_PRIORITY_MATRIX,
  getFieldRules,
} from '../../../src/config/field-priority-matrix.js';
import { normalize, areEquivalent } from '../../../src/services/normalization-engine.js';

/**
 * T-309 (T-305 round-6 P3) — root cause of the non-converging conflict churn.
 *
 * `issueSize` and `faceValue` were both entirely absent from
 * FIELD_PRIORITY_MATRIX, so getFieldRules() fell through to the DEFAULT rule
 * (`normalization: 'none'`). Two sources reporting the SAME true value in a
 * different shape (issueSize as Cr-text vs a raw-rupee number; a numeric
 * string vs a number) could never pass areEquivalent()'s strict typeof-gated
 * comparison — every 30-min cycle re-detected the same standing "conflict"
 * forever instead of converging once the true value was resolved.
 *
 * These tests prove, using the SAME functions the consolidation service
 * calls (`getFieldRules` -> `normalize` -> `areEquivalent`), that the
 * previously-unregistered fields now converge on real prod-shaped value
 * pairs pulled from the T-305 review evidence.
 */
describe('field priority matrix — issueSize/faceValue registered (T-309 conflict convergence)', () => {
  for (const f of ['issueSize', 'faceValue']) {
    it(`registers ${f} explicitly (was previously falling through to the DEFAULT no-op rule)`, () => {
      expect(FIELD_PRIORITY_MATRIX[f], `${f} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
      expect(FIELD_PRIORITY_MATRIX[f].sources[0]).toBe('ADMIN');
      expect(FIELD_PRIORITY_MATRIX[f].normalization).not.toBe('none');
    });
  }

  describe('issueSize converges across the real shape mismatches from prod', () => {
    const rules = getFieldRules('issueSize');

    it('Cr-suffixed text vs a raw-rupee number (bse-detail-scraper "basic units, not crores")', () => {
      const nseShape = normalize('issueSize', '45.5 Cr', rules); // e.g. Chittorgarh/NSE text
      const bseShape = normalize('issueSize', 455000000, rules); // BSE raw rupees
      expect(areEquivalent(nseShape, bseShape)).toBe(true);
    });

    it('a bare crore-scale number (no "Cr" suffix) vs the same value as raw rupees', () => {
      // This is the exact camelCase-vs-snake_case heuristic bug: before the
      // fix, `normalizeCurrency`'s small-number-is-crores heuristic tested
      // `fieldName.includes('issue_size')`, which never matched the real
      // camelCase field name `issueSize` passed by the consolidation service.
      const bareCrores = normalize('issueSize', 45.5, rules);
      const rawRupees = normalize('issueSize', 455000000, rules);
      expect(areEquivalent(bareCrores, rawRupees)).toBe(true);
    });

    it('a numeric string vs a number for the same rupee amount', () => {
      const asString = normalize('issueSize', '455000000', rules);
      const asNumber = normalize('issueSize', 455000000, rules);
      expect(areEquivalent(asString, asNumber)).toBe(true);
    });
  });

  describe('faceValue converges across type-shape mismatches', () => {
    const rules = getFieldRules('faceValue');

    it('a numeric string vs a number for the same face value', () => {
      expect(areEquivalent(normalize('faceValue', '10', rules), normalize('faceValue', 10, rules))).toBe(true);
    });
  });
});
