import { describe, it, expect } from 'vitest';
import { normalizeCompanyNameForMatching } from '../../../src/services/data-persister.js';

/**
 * Guards the normalized-name keystone (GitHub #16 + GMP/subscription matching):
 * scrape artifacts that append a status code after the legal suffix
 * ("Ltd. O", "Ltd. LT", "Ltd. CT", "Ltd. P", "Ltd IPO") must collapse to the
 * SAME canonical key as the clean name, so duplicate rows reconcile and
 * GMP/subscription rows match by name.
 */
describe('normalizeCompanyNameForMatching', () => {
  it.each([
    // [variant, clean] pairs that MUST produce the same key (real #16 cases)
    ['SUSAN ELECTRICALS INDIA LIMITED', 'Susan Electricals India Ltd. O'],
    ['Horizon Reclaim (India) Limited', 'Horizon Reclaim (India) Ltd. O'],
    ['Hexagon Nutrition Ltd.', 'Hexagon Nutrition Ltd. LT'],
    ['Hexagon Nutrition Ltd.', 'Hexagon Nutrition IPO'],
    ['Utkal Speciality Industries India Ltd IPO', 'Utkal Speciality Industries India Ltd. CT'],
    ['Utkal Speciality Industries India Ltd IPO', 'Utkal Speciality Industries India Ltd. P'],
  ])('collapses "%s" and "%s" to the same key', (a, b) => {
    expect(normalizeCompanyNameForMatching(a)).toBe(normalizeCompanyNameForMatching(b));
    expect(normalizeCompanyNameForMatching(a).length).toBeGreaterThan(0);
  });

  it('does NOT over-fold a real name ending in a 3-letter token', () => {
    // "BSL" is 3 chars and not after a stripped suffix -> must be preserved
    expect(normalizeCompanyNameForMatching('Tata Steel BSL Limited')).toBe('tata steel bsl');
  });

  it('does NOT strip a short token that is part of the name (not after a suffix)', () => {
    expect(normalizeCompanyNameForMatching('3i Infotech Limited')).toBe('3i infotech');
  });

  it('handles empty/blank input', () => {
    expect(normalizeCompanyNameForMatching('')).toBe('');
    expect(normalizeCompanyNameForMatching('   ')).toBe('');
  });
});
