/**
 * Tests for Data Validation Utility — Rule 8 (Non-IPO Shape Guard, issues #140/#141)
 */

import { describe, it, expect } from 'vitest';
import { validateIPOData } from '../../../src/utils/data-validation';

describe('validateIPOData — Rule 8 NON_IPO_WINDOW_TOO_LONG (issue #141)', () => {
  it('rejects the ADVENZYMES shape: offeringType=IPO, 98-day window, null lot size, zero issue size', () => {
    const result = validateIPOData(
      {
        companyName: 'ADVENZYMES',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 500,
        priceRangeMax: 500,
        lotSize: null,
        issueSize: '0.00',
        openDate: '2026-08-14',
        closeDate: '2026-11-20',
      },
      'BSE'
    );
    expect(result.valid).toBe(false);
    const rules = result.errors.map((e) => e.rule);
    expect(rules).toContain('NON_IPO_WINDOW_TOO_LONG');
    expect(rules).toContain('NON_IPO_SCRIP_CODE_NAME');
  });

  it('rejects the LIGHT OF LIFE TRUST shape: offeringType=IPO, 11-day window, no price band, no lot/issue size', () => {
    const result = validateIPOData(
      {
        companyName: 'LIGHT OF LIFE TRUST',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: null,
        priceRangeMax: null,
        lotSize: null,
        issueSize: '0.00',
        openDate: '2026-08-10',
        closeDate: '2026-08-21',
      },
      'BSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_WINDOW_TOO_LONG');
    // Multi-word name is NOT a bare scrip code — only the window/substance rule fires.
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_SCRIP_CODE_NAME');
  });

  it('does NOT reject a >10-day window when lot size and issue size ARE populated (a real, if unusual, extension)', () => {
    const result = validateIPOData(
      {
        companyName: 'Genuine Extended Offer Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 100,
        priceRangeMax: 105,
        lotSize: 100,
        issueSize: '500000000',
        openDate: '2026-08-01',
        closeDate: '2026-08-15',
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_WINDOW_TOO_LONG');
  });

  it('does NOT fire when the row was already reclassified away from IPO (e.g. RIGHTS, TENDER, NCD)', () => {
    for (const offeringType of ['RIGHTS', 'TENDER', 'NCD']) {
      const result = validateIPOData(
        {
          companyName: 'SOME CORPORATE ACTION LTD',
          offeringType,
          segment: 'MAINBOARD',
          lotSize: null,
          issueSize: '0.00',
          openDate: '2026-08-09',
          closeDate: '2026-08-31',
        },
        'BSE'
      );
      expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_WINDOW_TOO_LONG');
    }
  });

  it('leaves a genuine short-window mainboard/SME IPO untouched', () => {
    const result = validateIPOData(
      {
        companyName: 'Augmont Enterprises Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 750,
        priceRangeMax: 788,
        lotSize: 19,
        issueSize: '8250000000.00',
        openDate: '2026-08-21',
        closeDate: '2026-08-25',
      },
      'BSE'
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('validateIPOData — Rule 8 NON_IPO_SCRIP_CODE_NAME (issue #140)', () => {
  it('rejects a bare exchange scrip code as companyName (SIS shape)', () => {
    const result = validateIPOData(
      {
        companyName: 'SIS',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 479,
        priceRangeMax: 479,
        lotSize: null,
        openDate: '2026-08-13',
        closeDate: '2026-11-20',
      },
      'BSE'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_SCRIP_CODE_NAME');
  });

  it('does NOT reject a normal titled company name with a legal suffix', () => {
    const result = validateIPOData(
      {
        companyName: 'Tempsens Instruments (India) Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 300,
        priceRangeMax: 300,
        lotSize: 50,
        issueSize: '6500000000.00',
        openDate: '2026-08-20',
        closeDate: '2026-08-24',
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_SCRIP_CODE_NAME');
  });

  it('does not flag a bare scrip code once already reclassified away from IPO', () => {
    const result = validateIPOData(
      {
        companyName: 'SIS',
        offeringType: 'TENDER',
        segment: 'MAINBOARD',
        openDate: '2026-08-13',
        closeDate: '2026-11-20',
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_SCRIP_CODE_NAME');
  });
});

describe('validateIPOData — Rule 8 NON_IPO_TRUST_SHAPE (P2-2, T-277)', () => {
  // Real prod rows (evidence: verify-cube.mjs query, 2026-08-22) that wrote
  // offering_type='IPO' because their company name carries no "InvIT"/"REIT"
  // substring for Rule 2's narrower detector to match — this is the gap
  // NON_IPO_TRUST_SHAPE closes, complementing (not duplicating) Rule 2.
  it('rejects a bare "Trust"-named InvIT written with offeringType=IPO (Cube Highways Trust)', () => {
    const result = validateIPOData(
      {
        companyName: 'Cube Highways Trust',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 152,
        priceRangeMax: 152,
      },
      'CHITTORGARH'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_TRUST_SHAPE');
  });

  it('rejects a bare "Investment Trust"-named InvIT written with offeringType=IPO (Raajmarg Infra Investment Trust)', () => {
    const result = validateIPOData(
      {
        companyName: 'Raajmarg Infra Investment Trust',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
      },
      'CHITTORGARH'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_TRUST_SHAPE');
  });

  it('does NOT flag a trust name once auto-fixed away from IPO by Rule 2', () => {
    // Rule 2 (offering-type detection) sets autoFixes.offeringType='INVITS' with
    // HIGH confidence for this exact name, so the effective type is no longer
    // 'IPO' by the time Rule 8 runs — this is the normal, already-working path.
    const result = validateIPOData(
      {
        companyName: 'Citius Transnet InvIT',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
      },
      'CHITTORGARH'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_TRUST_SHAPE');
    expect(result.autoFixes?.offeringType).toBe('INVITS');
  });

  it('does NOT flag a normal equity IPO with no trust/REIT signal', () => {
    const result = validateIPOData(
      {
        companyName: 'Tempsens Instruments (India) Ltd.',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 285,
        priceRangeMax: 300,
        lotSize: 50,
        issueSize: '6500000000.00',
      },
      'BSE'
    );
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_TRUST_SHAPE');
  });

  // T-277F checker finding #2: the bare /\btrust\b/i ERROR rejected a REAL
  // company. "Trust Fintech Limited" is a genuine NSE Emerge SME IPO
  // (Mar-2024) — the word "Trust" is part of its brand name, followed by its
  // OWN legal suffix ("Fintech Limited"), not a bare business-trust name.
  it('MUST pass a real company whose name merely contains "Trust" (Trust Fintech Limited)', () => {
    const result = validateIPOData(
      {
        companyName: 'Trust Fintech Limited',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 91,
        priceRangeMax: 95,
        lotSize: 1200,
        issueSize: '4700000000.00',
        openDate: '2024-03-14',
        closeDate: '2024-03-18',
      },
      'BSE'
    );
    expect(result.valid).toBe(true);
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_TRUST_SHAPE');
    // The mid-name "Trust" token is a WARN, not silently ignored either.
    expect(result.warnings.map((e) => e.rule)).toContain('NON_IPO_TRUST_SHAPE_WARN');
  });

  it('still rejects the structural "ends in bare Trust" shape (Cube Highways Trust) as an ERROR', () => {
    const result = validateIPOData(
      {
        companyName: 'Cube Highways Trust',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
        priceRangeMin: 152,
        priceRangeMax: 152,
      },
      'CHITTORGARH'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_TRUST_SHAPE');
  });

  // T-277F2 checker round-2 finding #3: "Investment Trust" is a structural
  // legal-entity-type token even when it does NOT land at the very end of the
  // name. Real prod row (currently offering_type='REITS', listed 2026-04-23) —
  // round-1 verified this shape as REJECTED; round-2's mid-name-only ERROR
  // check regressed it to a bare WARN. Must be an ERROR again.
  it('rejects the mid-name "Investment Trust" shape (Property Share Investment Trust-Propshare Celestia)', () => {
    const result = validateIPOData(
      {
        companyName: 'Property Share Investment Trust-Propshare Celestia',
        offeringType: 'IPO',
        segment: 'MAINBOARD',
      },
      'CHITTORGARH'
    );
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.rule)).toContain('NON_IPO_TRUST_SHAPE');
  });

  // Guard against the mid-name fix over-firing: "Trust Fintech Limited" has
  // NO "Investment Trust" substring anywhere, so it must still PASS as an
  // ordinary company (companion to the earlier "MUST pass" test above).
  it('does NOT flag "Trust Fintech Limited" via the mid-name Investment Trust check', () => {
    const result = validateIPOData(
      {
        companyName: 'Trust Fintech Limited',
        offeringType: 'IPO',
        segment: 'SME',
        priceRangeMin: 91,
        priceRangeMax: 95,
        lotSize: 1200,
        issueSize: '4700000000.00',
        openDate: '2024-03-14',
        closeDate: '2024-03-18',
      },
      'BSE'
    );
    expect(result.valid).toBe(true);
    expect(result.errors.map((e) => e.rule)).not.toContain('NON_IPO_TRUST_SHAPE');
  });
});
