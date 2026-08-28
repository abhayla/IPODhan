import { describe, it, expect } from 'vitest';
import {
  judgeCoverText,
  countAlphanumeric,
  extractCoverText,
  MIN_COVER_ALNUM_CHARS,
} from '../../../src/services/pdf-cover-text.js';

/**
 * T-403 M1. The cover-page company check (matrix §3 step 4) was implemented in
 * the verifier but never supplied with text, so it silently never ran and F8 —
 * storing another company's filing — was unguarded in production.
 */
describe('judgeCoverText — usable vs mojibake', () => {
  it('accepts a real cover page', () => {
    // Verbatim opening of the Skyways RHP cover, page 1.
    const cover =
      '(Please scan this QR Code to view the RHP) RED HERRING PROSPECTUS Dated: August 11, 2026 ' +
      '(This Red Herring Prospectus will be updated upon filing with the RoC) Read with Section 32 ' +
      'of the Companies Act 2013 SKYWAYS AIR SERVICES LIMITED Our Company was incorporated as ' +
      'Skyways Air Services Private Limited at New Delhi';
    const result = judgeCoverText(cover);
    expect(result.usable).toBe(true);
    if (result.usable) expect(result.alnum).toBeGreaterThan(MIN_COVER_ALNUM_CHARS);
  });

  it('REJECTS a font-subsetted newspaper ad as unusable, not as a wrong company', () => {
    // Measured on the real acceptance set: Skyways' 10,621-character price-band
    // ad text layer yielded SIX alphanumeric characters. Judging a company name
    // against that would throw away a perfectly good filing.
    const mojibake = '�� '.repeat(2000) + 'ab12';
    const result = judgeCoverText(mojibake);
    expect(result.usable).toBe(false);
    if (!result.usable) {
      expect(result.reason).toBe('no_text_layer');
      expect(result.detail).toContain('alphanumeric');
    }
  });

  it('treats an empty text layer (scanned PDF) as unusable', () => {
    expect(judgeCoverText('').usable).toBe(false);
    expect(judgeCoverText('   ').usable).toBe(false);
  });

  it('countAlphanumeric ignores punctuation and whitespace', () => {
    expect(countAlphanumeric('ab-12 !!')).toBe(4);
    expect(countAlphanumeric('')).toBe(0);
  });
});

describe('extractCoverText — never throws', () => {
  it('returns extract_failed for bytes that are not a PDF', async () => {
    const result = await extractCoverText(Buffer.from('not a pdf at all'));
    expect(result.usable).toBe(false);
    if (!result.usable) expect(['extract_failed', 'no_text_layer']).toContain(result.reason);
  }, 60_000);
});
