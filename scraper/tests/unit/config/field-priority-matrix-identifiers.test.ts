import { describe, it, expect } from 'vitest';
import { FIELD_PRIORITY_MATRIX, getFieldRules } from '../../../src/config/field-priority-matrix.js';

/**
 * B7 — `isin`, `symbol`, `allotment_date` were MISSING from the field-priority matrix, so
 * consolidation silently dropped them (a missing entry falls back to a generic default and the
 * field effectively never wins from a real source). They MUST be registered explicitly:
 * NSE-first for the exchange identifiers (isin/symbol), Moneycontrol-first for allotment_date,
 * with the camelCase variant where the consolidation service keys on it.
 *
 * NB: assert against FIELD_PRIORITY_MATRIX directly — getFieldRules() returns a generic default
 * for unknown keys, so it can't prove an entry is actually registered.
 *
 * W-55: `allotment_date` was merged into the single canonical `allotmentDate` entry (the
 * snake_case duplicate is deleted, not kept as a second rule object — see
 * field-priority-matrix-camelcase-siblings.test.ts). `FIELD_PRIORITY_MATRIX['allotment_date']`
 * is therefore intentionally `undefined`; assert its registration via `getFieldRules()` (which
 * normalises the snake_case key to the camelCase entry) instead of the direct matrix index.
 */
describe('field priority matrix — identifiers + allotment_date registered (B7)', () => {
  for (const f of ['isin', 'symbol', 'allotmentDate']) {
    it(`registers ${f} explicitly with ADMIN-first source priority`, () => {
      expect(FIELD_PRIORITY_MATRIX[f], `${f} missing from FIELD_PRIORITY_MATRIX`).toBeDefined();
      const sources = FIELD_PRIORITY_MATRIX[f].sources;
      expect(sources.length).toBeGreaterThan(0);
      expect(sources[0]).toBe('ADMIN'); // ADMIN always wins
    });
  }

  it('registers allotment_date explicitly (via the normalising getFieldRules lookup) with ADMIN-first source priority', () => {
    const rules = getFieldRules('allotment_date');
    const sources = rules.sources;
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0]).toBe('ADMIN'); // ADMIN always wins
  });

  it('ranks NSE first (after ADMIN) for exchange identifiers (isin/symbol)', () => {
    for (const f of ['isin', 'symbol']) {
      const order = FIELD_PRIORITY_MATRIX[f].sources;
      expect(order.indexOf('NSE')).toBeGreaterThan(-1);
      expect(order.indexOf('NSE')).toBeLessThan(order.indexOf('BSE'));
    }
  });

  it('ranks Moneycontrol first (after ADMIN) for allotment_date', () => {
    for (const f of ['allotment_date', 'allotmentDate']) {
      const order = getFieldRules(f).sources;
      expect(order[1]).toBe('MONEYCONTROL');
    }
  });

  it('treats allotment_date as a date field', () => {
    expect(getFieldRules('allotment_date').normalization).toBe('date');
    expect(getFieldRules('allotmentDate').normalization).toBe('date');
  });
});
