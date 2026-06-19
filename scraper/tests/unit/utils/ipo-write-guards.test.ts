import { describe, it, expect } from 'vitest';
import { coercePositiveOrNull, sanitizeIpoDates, sanitizeRegistrar } from '../../../src/utils/validators';

// Write-path integrity guards (contract Stage A.5 / C-5). These run at the
// persistence boundary so a bad scrape cannot store a domain-absurd value that
// the coverage audit would falsely count as "covered".

describe('coercePositiveOrNull (issue_size etc. — 0 is "unknown", not a real value)', () => {
  it('returns null for 0 / negative / NaN / absent', () => {
    expect(coercePositiveOrNull(0)).toBeNull();
    expect(coercePositiveOrNull(-5)).toBeNull();
    expect(coercePositiveOrNull(null)).toBeNull();
    expect(coercePositiveOrNull(undefined)).toBeNull();
    expect(coercePositiveOrNull(NaN)).toBeNull();
  });
  it('passes through a positive number (string or number)', () => {
    expect(coercePositiveOrNull(500)).toBe(500);
    expect(coercePositiveOrNull('123.45' as unknown as number)).toBe(123.45);
  });
});

describe('sanitizeIpoDates (#41/#52 date-stomp guard)', () => {
  it('leaves a consistent recent IPO untouched', () => {
    const d = { openDate: '2025-10-15', closeDate: '2025-10-18', allotmentDate: '2025-10-21', listingDate: '2025-10-25' };
    expect(sanitizeIpoDates(d)).toEqual(d);
  });

  it('leaves a future UPCOMING IPO (no allotment anchor yet) untouched', () => {
    const d = { openDate: '2026-08-01', closeDate: '2026-08-04', allotmentDate: null, listingDate: null };
    expect(sanitizeIpoDates(d)).toEqual(d);
  });

  it('nulls open/close that contradict a present allotment anchor by years (the stomp signature)', () => {
    // Real WINDLAS case: allotment 2021 (true), open/close stomped to 2026 by a current scrape.
    const r = sanitizeIpoDates({ openDate: '2026-04-30', closeDate: '2026-05-07', allotmentDate: '2021-08-11', listingDate: null });
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
    expect(r.allotmentDate).toBe('2021-08-11'); // anchor preserved
  });

  it('uses listing_date as the anchor when allotment is absent', () => {
    const r = sanitizeIpoDates({ openDate: '2026-04-30', closeDate: '2026-05-07', allotmentDate: null, listingDate: '2021-08-20' });
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
  });

  it('nulls an open>close inversion', () => {
    const r = sanitizeIpoDates({ openDate: '2025-10-20', closeDate: '2025-10-15', allotmentDate: null, listingDate: null });
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
  });

  it('accepts Date objects as well as strings', () => {
    const r = sanitizeIpoDates({ openDate: new Date('2026-04-30'), closeDate: new Date('2026-05-07'), allotmentDate: new Date('2021-08-11') });
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
  });

  it('does NOT null when within one year of the anchor (normal allotment lag)', () => {
    const d = { openDate: '2024-12-30', closeDate: '2025-01-02', allotmentDate: '2025-01-05', listingDate: null };
    expect(sanitizeIpoDates(d)).toEqual(d);
  });

  it('nulls a 1-year stomp where allotment precedes close (STALLION case, no listing)', () => {
    // allotment 2025-01-21 is real; close stomped to 2026-02-26 (only 1 calendar year off
    // but ordering-impossible: close must precede allotment).
    const r = sanitizeIpoDates({ openDate: '2026-02-13', closeDate: '2026-02-26', allotmentDate: '2025-01-21', listingDate: null });
    expect(r.closeDate).toBeNull();
    expect(r.openDate).toBeNull();
  });

  it('when listing CORROBORATES open/close, nulls the bad allotment instead (Leapfrog case)', () => {
    // Current IPO: open/close in June are real (listing 06-24 confirms close 06-19);
    // the allotment 04-28 is the outlier (before open) and must be the one dropped.
    const r = sanitizeIpoDates({ openDate: '2026-06-17', closeDate: '2026-06-19', allotmentDate: '2026-04-28', listingDate: '2026-06-24' });
    expect(r.openDate).toBe('2026-06-17');   // preserved
    expect(r.closeDate).toBe('2026-06-19');  // preserved
    expect(r.allotmentDate).toBeNull();      // the real outlier
    expect(r.listingDate).toBe('2026-06-24');
  });
});

describe('sanitizeRegistrar (#45 — strip address/contact pollution, not variant-collapse)', () => {
  it('returns null for empty/absent', () => {
    expect(sanitizeRegistrar(null)).toBeNull();
    expect(sanitizeRegistrar('')).toBeNull();
  });
  it('strips a ^-delimited address block', () => {
    expect(sanitizeRegistrar('CAMEO CORPORATE SERVICES LTD.^Subramanian Building,1,Club House Road,Chennai,Tamil Nadu- 600002'))
      .toBe('CAMEO CORPORATE SERVICES LTD.');
    expect(sanitizeRegistrar('MAS SERVICES LIMITED^T-34, 2nd Floor, Okhla Industrial AreaPhase - II,New Delhi 110 020'))
      .toBe('MAS SERVICES LIMITED');
  });
  it('picks the registrar-name segment from tab-delimited garbage', () => {
    expect(sanitizeRegistrar('1\tKfin Technologies Limited\tM Murali Krishna\tTel.: +91 4067162222 E-mail:acjkel.ipo@kfintech.com'))
      .toBe('Kfin Technologies Limited');
  });
  it('re-spaces a glued legal suffix', () => {
    expect(sanitizeRegistrar('KFin TechnologiesLimited')).toBe('KFin Technologies Limited');
  });
  it('leaves a clean registrar unchanged', () => {
    expect(sanitizeRegistrar('Link Intime India Private Limited')).toBe('Link Intime India Private Limited');
  });
});
