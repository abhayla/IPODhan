import { describe, it, expect } from 'vitest';
import { normalizeReceiptValue } from '../../../config/plan-supersession-rule.mjs';
import { normalizeSuggestionValue } from '@ipodhan/shared/services/suggestion-admin-save-close';

/**
 * #1300: a suggestion's proposed value is stored by the scraper's `normalizeReceiptValue`; the admin
 * save compares its saved value with the shared `normalizeSuggestionValue`. Two definitions of one
 * concept, held equal here on every value shape a field can carry.
 */
describe('#1300 suggestion value normaliser parity (scraper receipt vs shared admin-save close)', () => {
  const cases: unknown[] = [
    null, undefined, 0, 10, 10.5, -3, Number.NaN, Number.POSITIVE_INFINITY, true, false,
    '10.00', ' 875 ', '-0.50', '', '   ', 'abc', ' Some Text ', '2026-10-01', '2026-10-01T00:00:00Z', '2026-10-01T00:00:00.000Z',
    '2026-10-01T05:30:00Z', new Date('2026-10-01T00:00:00Z'), { b: 1, a: [2, { d: 1, c: 2 }] }, ['x', 'y'],
  ];
  it.each(cases.map((c) => [c]))('%j normalises the same way', (v) => {
    expect(normalizeSuggestionValue(v)).toBe(normalizeReceiptValue(v));
  });
});
