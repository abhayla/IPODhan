/**
 * Tests for Offering Type Detection Utility
 * Story 11.8: Restructure Category Field into Segment + Offering Type
 */

import { describe, it, expect } from 'vitest';
import {
  detectOfferingTypeFromSymbol,
  detectSegmentFromExchange,
  detectOfferingTypeFromBSEType,
  detectOfferingType,
} from '../../../src/utils/detect-offering-type';

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
    expect(detectOfferingType('3IINFOLTDR', 'IPO')).toBe('TENDER');
  });

  it('should use BSE type when symbol has no special suffix', () => {
    expect(detectOfferingType('ACME', 'RIGHTS ISSUE')).toBe('RIGHTS');
  });

  it('should return IPO when neither symbol nor BSE type are special', () => {
    expect(detectOfferingType('ACME', 'IPO')).toBe('IPO');
    expect(detectOfferingType('ACME', null)).toBe('IPO');
  });

  it('should handle edge cases', () => {
    expect(detectOfferingType('', '')).toBe('IPO');
    expect(detectOfferingType(null as any, null)).toBe('IPO');
  });
});

describe('Real-world test cases', () => {
  it('should correctly identify 3i Infotech TENDER offer', () => {
    // This is the bug from the story!
    expect(detectOfferingTypeFromSymbol('3IINFOLTDR')).toBe('TENDER');
  });

  it('should correctly identify normal IPO', () => {
    expect(detectOfferingType('3IINFOTECHLTD', null)).toBe('IPO');
  });

  it('should handle BSE Rights Issue', () => {
    expect(detectOfferingType('COMPANY', 'Rights Issue')).toBe('RIGHTS');
  });

  it('should detect SME from NSE EMERGE', () => {
    expect(detectSegmentFromExchange(['NSE EMERGE'])).toBe('SME');
  });
});
