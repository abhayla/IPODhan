/**
 * Tests for Offering Type Detection Utility
 * Story 11.8: Restructure Category Field into Segment + Offering Type
 */

import { describe, it, expect } from 'vitest';
import {
  detectOfferingTypeFromSymbol,
  detectSegmentFromExchange,
  detectOfferingTypeFromBSEType,
  detectOfferingTypeFromBSEIRFlag,
  detectOfferingType,
  resolveOfferingTypeKeepingClassification,
} from '../../../src/utils/detect-offering-type';

describe('resolveOfferingTypeKeepingClassification (anti-repollution guard)', () => {
  it('keeps an existing corporate-action type over an incoming generic IPO', () => {
    // The cron re-pollution case: existing TENDER, scraper says IPO → keep TENDER
    expect(resolveOfferingTypeKeepingClassification('TENDER', 'IPO')).toBe('TENDER');
    expect(resolveOfferingTypeKeepingClassification('BUYBACK', 'IPO')).toBe('BUYBACK');
    expect(resolveOfferingTypeKeepingClassification('RIGHTS', 'IPO')).toBe('RIGHTS');
    expect(resolveOfferingTypeKeepingClassification('NCD', 'IPO')).toBe('NCD');
  });

  it('lets a more-specific incoming type override an existing IPO', () => {
    expect(resolveOfferingTypeKeepingClassification('IPO', 'RIGHTS')).toBe('RIGHTS');
  });

  it('does not block IPO→IPO or a genuine non-IPO→non-IPO change', () => {
    expect(resolveOfferingTypeKeepingClassification('IPO', 'IPO')).toBe('IPO');
    expect(resolveOfferingTypeKeepingClassification('TENDER', 'BUYBACK')).toBe('BUYBACK');
  });

  it('uses incoming when there is no existing classification', () => {
    expect(resolveOfferingTypeKeepingClassification(null, 'IPO')).toBe('IPO');
    expect(resolveOfferingTypeKeepingClassification(undefined, 'RIGHTS')).toBe('RIGHTS');
  });
});

describe('detectOfferingTypeFromBSEIRFlag (authoritative BSE classification)', () => {
  it('classifies a genuine public issue as IPO', () => {
    expect(detectOfferingTypeFromBSEIRFlag('IPO', 'Book Building')).toBe('IPO');
  });

  it('classifies a takeover open offer (OTB/Takeover) as TENDER — not IPO', () => {
    // Real prod pollution: SARDA PROTEINS, RESTAURANT BRANDS, OXFORD INDUSTRIES, etc.
    expect(detectOfferingTypeFromBSEIRFlag('OTB', 'Takeover')).toBe('TENDER');
  });

  it('classifies an OTB buyback (e.g. WIPRO) as BUYBACK — not IPO', () => {
    expect(detectOfferingTypeFromBSEIRFlag('OTB', 'Buyback - Tender Offer')).toBe('BUYBACK');
  });

  it('classifies a Debt Public Issue (DPI) as NCD', () => {
    expect(detectOfferingTypeFromBSEIRFlag('DPI', 'Debt Issue')).toBe('NCD');
  });

  it('classifies a Rights Issue (RI) as RIGHTS', () => {
    expect(detectOfferingTypeFromBSEIRFlag('RI', 'RI')).toBe('RIGHTS');
  });

  it('returns null for an unknown flag (e.g. CMN) — never guesses IPO', () => {
    expect(detectOfferingTypeFromBSEIRFlag('CMN', 'CMN')).toBeNull();
  });

  it('returns null for empty/missing flag', () => {
    expect(detectOfferingTypeFromBSEIRFlag('', '')).toBeNull();
    expect(detectOfferingTypeFromBSEIRFlag(null, null)).toBeNull();
  });

  it('is case- and whitespace-insensitive', () => {
    expect(detectOfferingTypeFromBSEIRFlag(' otb ', 'takeover')).toBe('TENDER');
  });
});

describe('detectOfferingTypeFromSymbol', () => {
  describe('TENDER offer detection', () => {
    it('should detect TENDER from TDR suffix', () => {
      expect(detectOfferingTypeFromSymbol('3IINFOLTDR')).toBe('TENDER');
    });

    it('should detect TENDER from TENDER keyword', () => {
      expect(detectOfferingTypeFromSymbol('COMPANY-TENDER')).toBe('TENDER');
    });

    it('should detect TENDER case-insensitively', () => {
      expect(detectOfferingTypeFromSymbol('companyTdr')).toBe('TENDER');
      expect(detectOfferingTypeFromSymbol('COMPANYtender')).toBe('TENDER');
    });

    it('should detect TENDER with whitespace', () => {
      expect(detectOfferingTypeFromSymbol('  3IINFOLTDR  ')).toBe('TENDER');
    });
  });

  describe('BUYBACK detection', () => {
    it('should detect BUYBACK from symbol', () => {
      expect(detectOfferingTypeFromSymbol('COMPANY-BUYBACK')).toBe('BUYBACK');
    });

    it('should detect BUYBACK case-insensitively', () => {
      expect(detectOfferingTypeFromSymbol('COMPANYBuyback')).toBe('BUYBACK');
    });
  });

  describe('DELISTING detection', () => {
    it('should detect DELISTING from symbol', () => {
      expect(detectOfferingTypeFromSymbol('COMPANY-DELISTING')).toBe('DELISTING');
    });

    it('should detect DELISTING case-insensitively', () => {
      expect(detectOfferingTypeFromSymbol('COMPANYdelisting')).toBe('DELISTING');
    });
  });

  describe('IPO (default) detection', () => {
    it('should return IPO for normal symbol', () => {
      expect(detectOfferingTypeFromSymbol('ACMELTD')).toBe('IPO');
    });

    it('should return IPO for symbol without special suffix', () => {
      expect(detectOfferingTypeFromSymbol('COMPANYNAME')).toBe('IPO');
    });

    it('should return IPO for empty string', () => {
      expect(detectOfferingTypeFromSymbol('')).toBe('IPO');
    });

    it('should return IPO for null/undefined', () => {
      expect(detectOfferingTypeFromSymbol(null as any)).toBe('IPO');
      expect(detectOfferingTypeFromSymbol(undefined as any)).toBe('IPO');
    });
  });
});

describe('detectSegmentFromExchange', () => {
  describe('MAINBOARD detection', () => {
    it('should detect MAINBOARD from NSE', () => {
      expect(detectSegmentFromExchange(['NSE'])).toBe('MAINBOARD');
    });

    it('should detect MAINBOARD from BSE-MAIN', () => {
      expect(detectSegmentFromExchange(['BSE-MAIN'])).toBe('MAINBOARD');
    });

    it('should detect MAINBOARD from NSE + BSE', () => {
      expect(detectSegmentFromExchange(['NSE', 'BSE'])).toBe('MAINBOARD');
    });

    it('should return MAINBOARD for empty array', () => {
      expect(detectSegmentFromExchange([])).toBe('MAINBOARD');
    });

    it('should return MAINBOARD for null/undefined', () => {
      expect(detectSegmentFromExchange(null as any)).toBe('MAINBOARD');
      expect(detectSegmentFromExchange(undefined as any)).toBe('MAINBOARD');
    });
  });

  describe('SME detection', () => {
    it('should detect SME from NSE-SME', () => {
      expect(detectSegmentFromExchange(['NSE-SME'])).toBe('SME');
    });

    it('should detect SME from BSE-SME', () => {
      expect(detectSegmentFromExchange(['BSE-SME'])).toBe('SME');
    });

    it('should detect SME from EMERGE platform', () => {
      expect(detectSegmentFromExchange(['NSE EMERGE'])).toBe('SME');
    });

    it('should detect SME case-insensitively', () => {
      expect(detectSegmentFromExchange(['nse-sme'])).toBe('SME');
      expect(detectSegmentFromExchange(['bse-sme'])).toBe('SME');
    });

    it('should detect SME from mixed exchanges (one SME)', () => {
      expect(detectSegmentFromExchange(['NSE', 'BSE-SME'])).toBe('SME');
    });

    it('should detect SME with whitespace', () => {
      expect(detectSegmentFromExchange(['  NSE-SME  '])).toBe('SME');
    });
  });
});

describe('detectOfferingTypeFromBSEType', () => {
  it('should detect RIGHTS from BSE type', () => {
    expect(detectOfferingTypeFromBSEType('RIGHTS ISSUE')).toBe('RIGHTS');
    expect(detectOfferingTypeFromBSEType('Rights Issue')).toBe('RIGHTS');
  });

  it('should detect NCD from BSE type', () => {
    expect(detectOfferingTypeFromBSEType('NCD')).toBe('NCD');
    expect(detectOfferingTypeFromBSEType('NON-CONVERTIBLE DEBENTURE')).toBe('NCD');
  });

  it('should detect BONDS from BSE type', () => {
    expect(detectOfferingTypeFromBSEType('BOND')).toBe('BONDS');
    expect(detectOfferingTypeFromBSEType('Corporate Bond')).toBe('BONDS');
  });

  it('should detect FPO from BSE type', () => {
    expect(detectOfferingTypeFromBSEType('FPO')).toBe('FPO');
    expect(detectOfferingTypeFromBSEType('FOLLOW-ON PUBLIC OFFER')).toBe('FPO');
  });

  it('should detect OFS from BSE type', () => {
    expect(detectOfferingTypeFromBSEType('OFS')).toBe('OFS');
    expect(detectOfferingTypeFromBSEType('OFFER FOR SALE')).toBe('OFS');
  });

  it('should return IPO for unknown BSE type', () => {
    expect(detectOfferingTypeFromBSEType('UNKNOWN')).toBe('IPO');
  });

  it('should return IPO for empty/null BSE type', () => {
    expect(detectOfferingTypeFromBSEType('')).toBe('IPO');
    expect(detectOfferingTypeFromBSEType(null as any)).toBe('IPO');
  });
});

describe('detectOfferingType (comprehensive)', () => {
  it('should prioritize symbol detection over BSE type', () => {
    // Symbol says TENDER, BSE says something else → should be TENDER
    expect(detectOfferingType({ symbol: '3IINFOLTDR', bseType: 'IPO' })).toBe('TENDER');
  });

  it('should use BSE type when symbol has no special suffix', () => {
    expect(detectOfferingType({ symbol: 'ACME', bseType: 'RIGHTS ISSUE' })).toBe('RIGHTS');
  });

  it('should return IPO when neither symbol nor BSE type are special', () => {
    expect(detectOfferingType({ symbol: 'ACME', bseType: 'IPO' })).toBe('IPO');
    expect(detectOfferingType({ symbol: 'ACME', bseType: null })).toBe('IPO');
  });

  it('should handle edge cases', () => {
    expect(detectOfferingType({ symbol: '', bseType: '' })).toBe('IPO');
    expect(detectOfferingType({ symbol: null as any, bseType: null })).toBe('IPO');
  });
});

describe('Real-world test cases', () => {
  it('should correctly identify 3i Infotech TENDER offer', () => {
    // This is the bug from the story!
    expect(detectOfferingTypeFromSymbol('3IINFOLTDR')).toBe('TENDER');
  });

  it('should correctly identify normal IPO', () => {
    expect(detectOfferingType({ symbol: '3IINFOTECHLTD', bseType: null })).toBe('IPO');
  });

  it('should handle BSE Rights Issue', () => {
    expect(detectOfferingType({ symbol: 'COMPANY', bseType: 'Rights Issue' })).toBe('RIGHTS');
  });

  it('should detect SME from NSE EMERGE', () => {
    expect(detectSegmentFromExchange(['NSE EMERGE'])).toBe('SME');
  });
});

describe('detectOfferingTypeFromBSEType — BSE SHORT codes (#23 pollution recurrence)', () => {
  // BSE serves short codes (OTB/DPI/RI) in "Type of Issue"; the long-word matches
  // never hit them, so buybacks (Zydus, Garware), debt issues (Muthoot, Kosamattam)
  // and rights issues were ingested as offering_type='IPO'. Pin the mapping.
  it('maps OTB (Offer To Buy: takeover / buyback tender) to TENDER, never IPO', () => {
    expect(detectOfferingTypeFromBSEType('OTB')).toBe('TENDER');
    expect(detectOfferingTypeFromBSEType('OTB - Buy Back')).toBe('TENDER');
    expect(detectOfferingTypeFromBSEType('otb')).toBe('TENDER');
  });

  it('maps DPI / Debt Issue to NCD, never IPO', () => {
    expect(detectOfferingTypeFromBSEType('DPI')).toBe('NCD');
    expect(detectOfferingTypeFromBSEType('Debt Issue')).toBe('NCD');
  });

  it('maps the RI short code to RIGHTS, never IPO', () => {
    expect(detectOfferingTypeFromBSEType('RI')).toBe('RIGHTS');
  });

  it('does not false-match short codes inside longer labels', () => {
    expect(detectOfferingTypeFromBSEType('IPO')).toBe('IPO');
    expect(detectOfferingTypeFromBSEType('Book Building')).toBe('IPO');
    expect(detectOfferingTypeFromBSEType('UNKNOWN')).toBe('IPO');
  });

  it('classifies the real polluted rows via the combined path', () => {
    expect(detectOfferingType({ symbol: 'ZYDUSLIFE', bseType: 'OTB' })).toBe('TENDER');
    expect(detectOfferingType({ symbol: '', bseType: 'DPI' })).toBe('NCD');
    expect(detectOfferingType({ symbol: 'OASIS SECURITIES LTD', bseType: 'RI' })).toBe('RIGHTS');
  });
});
