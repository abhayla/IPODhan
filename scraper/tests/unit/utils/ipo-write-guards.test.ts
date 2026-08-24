import { describe, it, expect } from 'vitest';
import { coercePositiveOrNull, sanitizeIpoDates, sanitizeRegistrar, sanitizeLeadManagers, sanitizeIpoWriteFields } from '../../../src/utils/validators';

describe('sanitizeLeadManagers (T-299 P2-8 — strip a tab-split contact block, keep only company names)', () => {
  it('returns null for null/undefined/empty', () => {
    expect(sanitizeLeadManagers(null)).toBeNull();
    expect(sanitizeLeadManagers(undefined)).toBeNull();
    expect(sanitizeLeadManagers([])).toBeNull();
  });

  it('passes through a clean single-BRLM array unchanged', () => {
    expect(sanitizeLeadManagers(['ICICI Securities Limited'])).toEqual([
      'ICICI Securities Limited',
    ]);
  });

  it('passes through multiple clean company names', () => {
    expect(
      sanitizeLeadManagers(['ICICI Securities Limited', 'Kotak Mahindra Capital Company Limited'])
    ).toEqual(['ICICI Securities Limited', 'Kotak Mahindra Capital Company Limited']);
  });

  it('strips the real prod tempsens compliance-contact pollution (T-296 P2-8 raw payload)', () => {
    // Verbatim from prod `ipos.lead_managers` for tempsens-instruments-india-ltd
    // (db-leadmanagers-polluted.txt) — a compliance-officer contact table's rows
    // (company + person name, then person + phone/email) got captured as the
    // lead_managers array instead of just the BRLM.
    const polluted = [
      'ICICI Securities Limited\tKishan Rastogi',
      'Rahul Sharma\tTel: +91 22 6807 7100E-mail: tempsens.ipo@icicisecurities.com',
    ];
    expect(sanitizeLeadManagers(polluted)).toEqual(['ICICI Securities Limited']);
  });

  it('deduplicates repeated company names across entries', () => {
    expect(
      sanitizeLeadManagers(['ICICI Securities Limited\tKishan Rastogi', 'ICICI Securities Limited'])
    ).toEqual(['ICICI Securities Limited']);
  });

  it('returns null when nothing survives the company-keyword filter', () => {
    expect(sanitizeLeadManagers(['Kishan Rastogi\tRahul Sharma'])).toBeNull();
  });
});

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

  it('when listing is only mildly/near-term inconsistent with a self-coherent open/close pair, nulls the bad listing instead (T-306 F2, kwality-walls-india-ltd shape)', () => {
    // Real T-299 prod row: open 2026-04-23 / close 2026-05-07 are a genuine,
    // self-consistent near-term IPO window; listing 2026-02-16 is the outlier
    // (~80 days before close, not a years-old stale anchor). The T-299 manual
    // repair nulled the listing and KEPT open/close — the write-path sanitizer
    // must resolve the same shape the same way, or a re-scrape re-corrupts the row.
    const r = sanitizeIpoDates({ openDate: '2026-04-23', closeDate: '2026-05-07', allotmentDate: null, listingDate: '2026-02-16' });
    expect(r.openDate).toBe('2026-04-23');   // preserved
    expect(r.closeDate).toBe('2026-05-07');  // preserved
    expect(r.listingDate).toBeNull();        // the real outlier, not open/close
  });

  it('still anchors on a listing that is FAR (years) in the past — the WINDLAS stomp signature, not the kwality shape', () => {
    const r = sanitizeIpoDates({ openDate: '2026-04-30', closeDate: '2026-05-07', allotmentDate: null, listingDate: '2021-08-20' });
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
    expect(r.listingDate).toBe('2021-08-20'); // stable anchor preserved
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

describe('sanitizeIpoWriteFields (#42/#45/#52 — the consolidation-output write choke)', () => {
  // The create path sanitizes fields inline, but the consolidation UPDATE path
  // writes the per-field merged `consolidatedData` directly via ipoRepository.update
  // WITHOUT re-sanitizing — so a merged winning value re-introduces pollution the
  // create path had removed. This choke re-applies all three sanitizers to the
  // consolidated record just before the write.

  it('strips a trailing status token from a merged company_name (#42)', () => {
    const r = sanitizeIpoWriteFields({ companyName: 'Leapfrog Engineering Services Ltd. O' });
    expect(r.companyName).toBe('Leapfrog Engineering Services Ltd.');
  });

  it('strips address pollution from a merged registrar (#45)', () => {
    const r = sanitizeIpoWriteFields({
      registrar: 'MAS SERVICES LIMITED^T-34, 2nd Floor, Okhla Industrial AreaPhase - II,New Delhi 110 020',
    });
    expect(r.registrar).toBe('MAS SERVICES LIMITED');
  });

  it('nulls the incoherent date from a merged date set (#52 close>allotment)', () => {
    // Consolidation merged a 2026 close onto a 2020 historical allotment.
    const r = sanitizeIpoWriteFields({
      openDate: '2026-04-01',
      closeDate: '2026-05-01',
      allotmentDate: '2020-10-01',
      listingDate: null,
    });
    // open/close stomped the historical allotment anchor -> both nulled.
    expect(r.openDate).toBeNull();
    expect(r.closeDate).toBeNull();
    expect(r.allotmentDate).toBe('2020-10-01');
  });

  it('only touches the fields present (does not invent keys)', () => {
    const r = sanitizeIpoWriteFields({ issueSize: '500', segment: 'MAINBOARD' } as any);
    expect(r).not.toHaveProperty('companyName');
    expect(r).not.toHaveProperty('registrar');
    expect((r as any).issueSize).toBe('500');
  });

  it('does not mutate the input object', () => {
    const input: any = { companyName: 'X Ltd. O', registrar: 'A^addr' };
    sanitizeIpoWriteFields(input);
    expect(input.companyName).toBe('X Ltd. O');
    expect(input.registrar).toBe('A^addr');
  });

  it('leaves a clean consolidated record unchanged', () => {
    const clean = {
      companyName: 'Acme Industries Limited',
      registrar: 'Link Intime India Private Limited',
      openDate: '2025-10-15',
      closeDate: '2025-10-18',
      allotmentDate: '2025-10-21',
      listingDate: '2025-10-25',
    };
    expect(sanitizeIpoWriteFields({ ...clean })).toEqual(clean);
  });
});

describe('sanitizeIpoWriteFields — empty-string sector normalization (#89 sector=0% root cause)', () => {
  it("normalizes sector '' to undefined so the column is left untouched", () => {
    const r = sanitizeIpoWriteFields({ companyName: 'Acme Ltd', sector: '' });
    expect(r.sector).toBeUndefined();
  });

  it('trims whitespace-only sector to undefined', () => {
    const r = sanitizeIpoWriteFields({ companyName: 'Acme Ltd', sector: '   ' });
    expect(r.sector).toBeUndefined();
  });

  it('passes a real sector through trimmed', () => {
    const r = sanitizeIpoWriteFields({ companyName: 'Acme Ltd', sector: ' Pharmaceuticals ' });
    expect(r.sector).toBe('Pharmaceuticals');
  });

  it('leaves records without a sector key untouched (partial update never invents keys)', () => {
    const r = sanitizeIpoWriteFields({ companyName: 'Acme Ltd' });
    expect('sector' in r).toBe(false);
  });
});
