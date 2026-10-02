import { describe, it, expect } from 'vitest';
import {
  verifyDocumentIdentity,
  readCins,
  readCoverDatedDate,
  parseFilingDate,
} from '../../../src/services/document-identity-binding.js';

/**
 * PR #1464 fix round 1 (MAJOR): a SEBI/company-rung document is bound to the IPO by CIN and by its
 * filing date before it is stored (OD-34 as amended by OD-89). Real shapes: NSE (staging
 * 2026-10-02: cin U67120MH1992PLC069769, open 2026-09-17, close 2026-09-21, listing 2026-09-24) and
 * its final Prospectus, SEBI document 104637, listed "Sep 22, 2026" (F-125).
 */
const NSE = {
  cin: 'U67120MH1992PLC069769',
  openDate: '2026-09-17',
  closeDate: '2026-09-21',
  listingDate: '2026-09-24',
};
const NSE_COVER =
  'NATIONAL STOCK EXCHANGE OF INDIA LIMITED Corporate Identity Number: U67120MH1992PLC069769 ' +
  'PROSPECTUS Dated September 22, 2026';

describe('verifyDocumentIdentity', () => {
  it('accepts NSE 104637 (CIN on the cover matches, SEBI date inside the window)', () => {
    expect(
      verifyDocumentIdentity({
        source: 'SEBI',
        docType: 'PROSPECTUS',
        ipo: NSE,
        coverText: NSE_COVER,
        filingDate: parseFilingDate('Sep 22, 2026'),
      })
    ).toEqual({ verdict: 'bound', by: 'cin+date' });
  });

  it('refuses a same-name Prospectus whose cover CIN is a different company', () => {
    const v = verifyDocumentIdentity({
      source: 'SEBI',
      docType: 'PROSPECTUS',
      ipo: NSE,
      coverText: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED CIN: U74999DL2001PLC110000 PROSPECTUS',
      filingDate: parseFilingDate('Sep 22, 2026'),
    });
    expect(v).toMatchObject({ verdict: 'refused', reason: 'identity_cin_mismatch' });
  });

  it('refuses a same-name Prospectus filed years before the IPO (no CIN printed)', () => {
    const v = verifyDocumentIdentity({
      source: 'SEBI',
      docType: 'PROSPECTUS',
      ipo: NSE,
      coverText: 'NATIONAL STOCK EXCHANGE OF INDIA LIMITED PROSPECTUS',
      filingDate: parseFilingDate('Mar 10, 2021'),
    });
    expect(v).toMatchObject({ verdict: 'refused', reason: 'identity_date_outside_window' });
    expect((v as { detail: string }).detail).toBe('filed 2021-03-10 outside 2026-07-19..2026-10-24');
  });

  it('a CIN match does not excuse a years-old filing date', () => {
    const v = verifyDocumentIdentity({
      source: 'SEBI',
      docType: 'PROSPECTUS',
      ipo: NSE,
      coverText: NSE_COVER,
      filingDate: parseFilingDate('Mar 10, 2021'),
    });
    expect(v).toMatchObject({ verdict: 'refused', reason: 'identity_date_outside_window' });
  });

  it('fails closed when neither a CIN nor a date can bind a post-close type', () => {
    expect(
      verifyDocumentIdentity({
        source: 'COMPANY',
        docType: 'BASIS_OF_ALLOTMENT_AD',
        ipo: { cin: null, openDate: null, closeDate: null, listingDate: null },
        coverText: 'Acme Industries Limited basis of allotment',
      })
    ).toMatchObject({ verdict: 'refused', reason: 'identity_unverified' });
    // a stored CIN with a scanned cover (no text) and no date is unverified too
    expect(
      verifyDocumentIdentity({ source: 'SEBI', docType: 'PROSPECTUS', ipo: { cin: NSE.cin }, coverText: '' })
    ).toMatchObject({ verdict: 'refused', reason: 'identity_unverified' });
  });

  it('binds by date alone when the IPO has no stored CIN (11 of 43 LISTED staging rows)', () => {
    expect(
      verifyDocumentIdentity({
        source: 'SEBI',
        docType: 'PROSPECTUS',
        ipo: { ...NSE, cin: null },
        coverText: 'no cin here',
        filingDate: parseFilingDate('Sep 22, 2026'),
      })
    ).toEqual({ verdict: 'bound', by: 'date' });
  });

  it('a fixed-price Prospectus filed before the open is inside the window', () => {
    expect(
      verifyDocumentIdentity({
        source: 'COMPANY',
        docType: 'PROSPECTUS',
        ipo: { cin: null, openDate: '2026-09-17', closeDate: '2026-09-19', listingDate: null },
        coverText: 'Prospectus dated August 28, 2026',
      })
    ).toEqual({ verdict: 'bound', by: 'date' });
  });

  it('identity, not the offering type, decides: an FPO Prospectus binds the same way', () => {
    expect(
      verifyDocumentIdentity({
        source: 'SEBI',
        docType: 'PROSPECTUS',
        ipo: { cin: 'L65910MH1993PLC070000', openDate: '2026-09-01', closeDate: '2026-09-03', listingDate: null },
        coverText: 'FOLLOW-ON PUBLIC OFFER CIN L65910MH1993PLC070000',
      })
    ).toEqual({ verdict: 'bound', by: 'cin' });
  });

  it('other SEBI types are refused only on a positive CIN mismatch (a DRHP has no date window)', () => {
    expect(
      verifyDocumentIdentity({ source: 'SEBI', docType: 'DRHP', ipo: { cin: null }, coverText: 'draft' })
    ).toEqual({ verdict: 'not_checked' });
    expect(
      verifyDocumentIdentity({
        source: 'SEBI',
        docType: 'DRHP',
        ipo: NSE,
        coverText: 'CIN U74999DL2001PLC110000',
        filingDate: parseFilingDate('Jun 18, 2026'),
      })
    ).toMatchObject({ verdict: 'refused', reason: 'identity_cin_mismatch' });
  });

  it('exchange documents are not checked here', () => {
    expect(verifyDocumentIdentity({ source: 'NSE', docType: 'PROSPECTUS', ipo: {}, coverText: '' })).toEqual({
      verdict: 'not_checked',
    });
  });
});

describe('readers', () => {
  it('reads CINs and dates in the shapes printed', () => {
    expect(readCins(NSE_COVER)).toEqual(['U67120MH1992PLC069769']);
    expect(readCoverDatedDate(NSE_COVER)?.toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(readCoverDatedDate('Prospectus Dated: 22nd September, 2026')?.toISOString().slice(0, 10)).toBe('2026-09-22');
    expect(parseFilingDate('Sep 31, 2026')).toBeNull();
  });
});
