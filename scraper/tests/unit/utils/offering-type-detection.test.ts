import { describe, it, expect } from 'vitest';
import {
  detectOfferingType,
  isOfferingType,
  OFFERING_TYPES,
} from '../../../src/utils/data-validation.js';

/**
 * T-228: REITs and InvITs were being stored (and shown to retail users) as IPOs.
 *
 * The detector correctly RECOGNISED them but emitted the display spellings
 * 'REIT' / 'InvIT', which are not members of the `offering_type` DB enum
 * ('REITS' / 'INVITS'). The pipeline writes the detected value onto the record
 * via `Object.assign(data, autoFixesApplied)`, so an invalid value made the
 * auto-fix a silent no-op: the mismatch warning re-fired every cycle and the
 * row stayed 'IPO'.
 *
 * These tests pin the CONTRACT that makes that impossible: whatever the
 * detector returns must be a real enum member.
 */

const ipo = (companyName: string, offeringType = 'IPO') =>
  ({ companyName, offeringType }) as any;

describe('detectOfferingType — emits canonical DB enum values (T-228)', () => {
  it('classifies a REIT as REITS (not the display spelling "REIT")', () => {
    const r = detectOfferingType(ipo('Bagmane Prime Office REIT (Bagmane REIT)'), 'CHITTORGARH');
    expect(r.detectedType).toBe('REITS');
    expect(r.confidence).toBe('HIGH');
  });

  it('classifies an InvIT as INVITS (not the display spelling "InvIT")', () => {
    const r = detectOfferingType(ipo('Cube Highways Trust (Cube Highways Trust InvIT)'), 'CHITTORGARH');
    expect(r.detectedType).toBe('INVITS');
    expect(r.confidence).toBe('HIGH');
  });

  it('classifies the spelled-out trust names too', () => {
    expect(detectOfferingType(ipo('Some Real Estate Investment Trust'), 'NSE').detectedType).toBe('REITS');
    expect(detectOfferingType(ipo('Some Infrastructure Investment Trust'), 'NSE').detectedType).toBe('INVITS');
  });

  it('classifies the real-world names from the failing cycle', () => {
    expect(detectOfferingType(ipo('Citius Transnet Investment Trust (Citius Transnet InvIT IPO)'), 'CHITTORGARH').detectedType).toBe('INVITS');
  });

  it('still detects RIGHTS issues', () => {
    expect(detectOfferingType(ipo('Acme Ltd Rights Issue'), 'BSE').detectedType).toBe('RIGHTS');
  });

  it('defaults an ordinary company to IPO', () => {
    expect(detectOfferingType(ipo('Symbiotec Pharmalab Ltd.'), 'NSE').detectedType).toBe('IPO');
  });

  /**
   * The regression guard: whatever branch fires, the value must be writable to
   * the enum column. This is what actually prevents a repeat of the bug class.
   */
  it('NEVER returns a value outside the offering_type enum', () => {
    const names = [
      'Bagmane Prime Office REIT (Bagmane REIT)',
      'Cube Highways Trust (Cube Highways Trust InvIT)',
      'Citius Transnet Investment Trust (Citius Transnet InvIT IPO)',
      'Kwick Forensic Solutions Ltd.',
      'Acme Ltd Rights Issue',
      'Ordinary Widgets Ltd.',
      '',
    ];
    for (const n of names) {
      const { detectedType } = detectOfferingType(ipo(n), 'ANY');
      if (detectedType !== null) {
        expect(OFFERING_TYPES).toContain(detectedType);
      }
    }
  });

  it('passes through a source-supplied type only when it is a real enum member', () => {
    const ok = detectOfferingType(ipo('Some Bond Issue Co', 'NCD'), 'CHITTORGARH');
    expect(ok.detectedType).toBe('NCD');
    expect(ok.confidence).toBe('MEDIUM');
  });

  it('refuses to echo back an UNRECOGNISED source-supplied type', () => {
    // An unknown string must not become an auto-fix that corrupts the column.
    const bad = detectOfferingType(ipo('Mystery Instrument Co', 'REIT'), 'CHITTORGARH');
    expect(bad.detectedType).toBeNull();
    expect(bad.reason).toMatch(/not a recognised offering type/i);
  });
});

describe('isOfferingType — enum membership guard', () => {
  it('accepts every declared enum member', () => {
    for (const t of OFFERING_TYPES) expect(isOfferingType(t)).toBe(true);
  });

  it('rejects the display spellings that caused the bug', () => {
    expect(isOfferingType('REIT')).toBe(false);
    expect(isOfferingType('InvIT')).toBe(false);
    expect(isOfferingType('reits')).toBe(false); // case-sensitive, matches pg enum
  });
});
