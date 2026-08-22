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

  it("strips a trailing ' IPO'/' FPO' instrument label (#42 — CG display names)", () => {
    expect(sanitizeDisplayCompanyName('Twinkle Papers IPO')).toBe('Twinkle Papers');
    expect(sanitizeDisplayCompanyName('Sri Priyanka Geo Commex IPO')).toBe('Sri Priyanka Geo Commex');
    expect(sanitizeDisplayCompanyName('Acme FPO')).toBe('Acme');
    // never mid-name, only the trailing label
    expect(sanitizeDisplayCompanyName('IPO Advisors Ltd')).toBe('IPO Advisors Ltd');
  });

  /**
   * P3-1 (round-2 review, T-278): a redundant trailing parenthetical
   * descriptor ("Ltd. (Company Name IPO)") leaked into the stored display
   * name and the 76-char public slug. It must be stripped, but the legal
   * suffix + a genuinely mid-string parenthetical ("(India)") must survive.
   */
  it('strips a redundant trailing parenthetical descriptor (#42/#16, P3-1)', () => {
    expect(sanitizeDisplayCompanyName('Complete Sports & Management India Ltd. (Complete Sports and Management IPO)')).toBe(
      'Complete Sports & Management India Ltd.'
    );
    expect(sanitizeDisplayCompanyName('Citius Transnet Investment Trust (Citius Transnet InvIT IPO)')).toBe(
      'Citius Transnet Investment Trust'
    );
  });

  it('strips a trailing status code even when it trails a redundant parenthetical (P3-1 — "Ltd. (X IPO) O")', () => {
    expect(sanitizeDisplayCompanyName('G.V.Electricals Ltd. (G.V. Electricals IPO) O')).toBe('G.V.Electricals Ltd.');
    expect(sanitizeDisplayCompanyName('G.V.Electricals Ltd. (G.V. Electricals IPO) P')).toBe('G.V.Electricals Ltd.');
    expect(sanitizeDisplayCompanyName('G.V.Electricals Ltd. (G.V. Electricals IPO) LT')).toBe('G.V.Electricals Ltd.');
    expect(sanitizeDisplayCompanyName('G.V.Electricals Ltd. (G.V. Electricals IPO) CT')).toBe('G.V.Electricals Ltd.');
    expect(sanitizeDisplayCompanyName('H.R.Hygiene Products Ltd. (H.R. Hygiene Products IPO) O')).toBe(
      'H.R.Hygiene Products Ltd.'
    );
  });

  it('does not strip a genuine mid-string parenthetical that precedes the legal suffix', () => {
    expect(sanitizeDisplayCompanyName('Horizon Reclaim (India) Ltd.')).toBe('Horizon Reclaim (India) Ltd.');
    expect(sanitizeDisplayCompanyName('Shree Balaji (Mala) Textiles Limited')).toBe('Shree Balaji (Mala) Textiles Limited');
  });
});
