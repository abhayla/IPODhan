import { describe, it, expect } from 'vitest';
import { sanitizeDisplayCompanyName } from '@ipodhan/shared/utils/company-name-normalizer';

/**
 * Guards the DISPLAY-name sanitizer (GitHub #42). Unlike the matching normalizer
 * (which strips the legal suffix to build a dedup key), the display sanitizer
 * KEEPS the legal suffix but strips the trailing 1-2 letter status/category code
 * a few sources append after it ("Ltd. O", "Ltd. P", "Ltd. LT", "Ltd. CT").
 *
 * This is the single canonical sanitizer applied at the IPORepository write
 * choke point so EVERY write path (create / update / consolidation) stores a
 * clean display name — closing the bypass that re-introduced the smells.
 */
describe('sanitizeDisplayCompanyName', () => {
  it.each([
    ['Clay Craft India Ltd. O', 'Clay Craft India Ltd.'],
    ['Diksha Polymers Ltd. O', 'Diksha Polymers Ltd.'],
    ['Horizon Reclaim (India) Ltd. P', 'Horizon Reclaim (India) Ltd.'],
    ['Susan Electricals India Ltd. P', 'Susan Electricals India Ltd.'],
    ['Utkal Speciality Industries India Ltd. LT', 'Utkal Speciality Industries India Ltd.'],
    ['Hexagon Nutrition Ltd. CT', 'Hexagon Nutrition Ltd.'],
    ['KFin Technologies Limited O', 'KFin Technologies Limited'],
  ])('strips the trailing status token from "%s" -> "%s"', (raw, clean) => {
    expect(sanitizeDisplayCompanyName(raw)).toBe(clean);
  });

  it('leaves a clean name untouched', () => {
    expect(sanitizeDisplayCompanyName('Acme Limited')).toBe('Acme Limited');
    expect(sanitizeDisplayCompanyName('Tata Steel BSL Limited')).toBe('Tata Steel BSL Limited');
  });

  it('strips HTML tags and angle brackets', () => {
    expect(sanitizeDisplayCompanyName('<b>Acme</b> Ltd')).toBe('Acme Ltd');
  });

  it('handles empty/blank input', () => {
    expect(sanitizeDisplayCompanyName('')).toBe('');
    expect(sanitizeDisplayCompanyName('   ')).toBe('');
  });

  it('caps length at 200 chars', () => {
    expect(sanitizeDisplayCompanyName('A'.repeat(250)).length).toBe(200);
  });
});
