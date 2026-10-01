/**
 * Unit Tests for Chittorgarh Document (DRHP/RHP/Prospectus) Scraper
 *
 * Source of truth: Chittorgarh report 20 (`ipo_prospectus_document_drhp_rhp_pdf`),
 * which lists each IPO with a `Prospectus (pdf)` HTML anchor pointing at the real PDF URL,
 * plus `~isin` / `~bse_script_code` / `~nse_symbol` / `~URLRewrite_Folder_Name`.
 * Fixtures below are verbatim shapes captured live on 2026-06-16.
 */
import { describe, it, expect } from 'vitest';
import {
  extractAnchorHref,
  detectProspectusDocType,
  parseProspectusReportRows,
  resolveProspectusRowType,
  type ChittorgarhProspectusRow,
} from '../../../src/scrapers/chittorgarh-document-scraper.js';
import { classifyOfferDocumentCover } from '../../../src/services/document-classifier.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// #1417: REAL cover text (pdf-parse page 1) of Chittorgarh-linked PDFs whose URL file name names no
// offer-document type, captured from the live links 2026-10-02 (staging rows, stored PROSPECTUS by default).
const FIXTURE_DIR = fileURLToPath(new URL('../../fixtures/chittorgarh-untyped-covers/', import.meta.url));
const fixture = (name: string): string => readFileSync(FIXTURE_DIR + name, 'utf8');

// Verbatim row from report 20 (2026-06-16)
const REAL_ROW = {
  '~id': 2276,
  Company: 'Modern Diagnostic & Research Centre Ltd.',
  'Issue Type': 'IPO',
  Exchange: 'BSE SME',
  'Opening Date': '31-Dec-2025',
  'Prospectus (pdf)':
    '<a class="keep-link-export" href="https://beelinemb.com/wp-content/uploads/2026/01/PROSPECTUS_MODERN.pdf" target="_blank" rel="noopener noreferrer" title="Download Prospectus of Modern Diagnostic & Research Centre Ltd."><i class="fa fa-file-pdf"></i></a>',
  '~URLRewrite_Folder_Name': 'modern-diagnostic-ipo',
  '~isin': 'INE1HK501016',
  '~bse_script_code': 544673,
  '~nse_symbol': '',
};

describe('chittorgarh-document-scraper', () => {
  describe('extractAnchorHref', () => {
    it('extracts the real PDF URL from a report anchor cell', () => {
      expect(extractAnchorHref(REAL_ROW['Prospectus (pdf)'])).toBe(
        'https://beelinemb.com/wp-content/uploads/2026/01/PROSPECTUS_MODERN.pdf'
      );
    });
    it('returns null when there is no href', () => {
      expect(extractAnchorHref('<i class="fa fa-file-pdf"></i>')).toBeNull();
      expect(extractAnchorHref('')).toBeNull();
      expect(extractAnchorHref(null as unknown as string)).toBeNull();
    });
    it('returns null for a non-pdf href (only real document links count)', () => {
      expect(extractAnchorHref('<a href="https://x.com/page.html">x</a>')).toBeNull();
    });
  });

  describe('detectProspectusDocType', () => {
    it('classifies a DRHP url as DRHP', () => {
      expect(detectProspectusDocType('https://x.com/COMPANY_DRHP.pdf', 'BSE')).toBe('DRHP');
    });
    it('classifies an RHP url as RHP', () => {
      expect(detectProspectusDocType('https://x.com/company-rhp-final.pdf', 'NSE')).toBe('RHP');
    });
    it('#1116: classifies by the FILE NAME, not a folder named RHP (Gabion, real URL)', () => {
      // Real report-20 URL stored on staging/prod 2026-06-16; the PDF cover reads
      // "PROSPECTUS Dated: January 9, 2026" -- a final Prospectus in an /RHP/ folder.
      expect(
        detectProspectusDocType('https://gabionindia.com//wp-content/themes/gabion/RHP/Final%20Prospectus.pdf', 'BSE')
      ).toBe('PROSPECTUS');
    });
    it('#1116: a draft file name still wins over a folder name', () => {
      expect(detectProspectusDocType('https://x.com/RHP/Company_DRHP.pdf', 'BSE')).toBe('DRHP');
    });
    it('#1116/#1417: a file name that names no type is NOT typed from the folder and NOT defaulted (null)', () => {
      expect(detectProspectusDocType('https://x.com/RHP/Annual_Report_2026.pdf', 'BSE')).toBeNull();
      expect(detectProspectusDocType('https://x.com/DRHP/Annual_Report_2026.pdf', 'BSE')).toBeNull();
    });
    it('#1417: real staging file names that name no type are null (never defaulted to PROSPECTUS)', () => {
      for (const u of [
        'https://hemadmin.hemsecurities.com/images/Files/offer/997.pdf',
        'https://nsearchives.nseindia.com/corporate/FP_INE0P8B01020_25FEB2026.pdf',
        'https://www.manilam.com//uploads/investors/42/42.pdf',
        'https://www.sebi.gov.in/web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770955551279.pdf#page=1&zoom=page-width,-16,842',
      ]) {
        expect(detectProspectusDocType(u, 'NSE')).toBeNull();
      }
    });
    it('defaults to PROSPECTUS for a generic prospectus pdf', () => {
      expect(detectProspectusDocType('https://beelinemb.com/PROSPECTUS_MODERN.pdf', 'BSE')).toBe(
        'PROSPECTUS'
      );
    });
  });

  describe('parseProspectusReportRows', () => {
    it('parses a real report row into a typed row with the pdf url + identifiers', () => {
      const rows = parseProspectusReportRows([REAL_ROW]);
      expect(rows).toHaveLength(1);
      const r = rows[0] as ChittorgarhProspectusRow;
      expect(r.companyName).toBe('Modern Diagnostic & Research Centre Ltd.');
      expect(r.pdfUrl).toBe(
        'https://beelinemb.com/wp-content/uploads/2026/01/PROSPECTUS_MODERN.pdf'
      );
      expect(r.isin).toBe('INE1HK501016');
      expect(r.bseScripCode).toBe('544673');
      expect(r.slug).toBe('modern-diagnostic-ipo');
      expect(r.docType).toBe('PROSPECTUS');
    });
    it('skips rows with no usable pdf url (honesty — never invents a document)', () => {
      const rows = parseProspectusReportRows([
        { ...REAL_ROW, 'Prospectus (pdf)': '<i class="fa fa-file-pdf"></i>' },
      ]);
      expect(rows).toHaveLength(0);
    });
    it('handles an empty report safely', () => {
      expect(parseProspectusReportRows([])).toEqual([]);
      expect(parseProspectusReportRows(null as unknown as any[])).toEqual([]);
    });
  });

  describe('classifyOfferDocumentCover (#1417, real covers)', () => {
    it('types a real final-prospectus cover whose URL name was "997.pdf" as PROSPECTUS', () => {
      expect(classifyOfferDocumentCover(fixture('adisoft-997.cover.txt'))).toBe('PROSPECTUS');
    });
    it('types a real final-prospectus cover whose URL name was "FP_INE...pdf" as PROSPECTUS', () => {
      expect(classifyOfferDocumentCover(fixture('gaudium-fp-ine0p8b01020.cover.txt'))).toBe('PROSPECTUS');
    });
    it('a real cover that names no offer-document type in its title position is null (QR note only)', () => {
      expect(classifyOfferDocumentCover(fixture('fractal-sebi-viewer.cover.txt'))).toBeNull();
    });
    it('a QR note naming "Draft Red Herring Prospectus" does not type a non-offer cover', () => {
      expect(classifyOfferDocumentCover('ANNUAL REPORT 2025-26\nACME LIMITED\nNotice of AGM')).toBeNull();
      expect(classifyOfferDocumentCover('')).toBeNull();
    });
    it('types DRHP / RHP covers by their title, ahead of the bare word Prospectus', () => {
      expect(classifyOfferDocumentCover('DRAFT RED HERRING PROSPECTUS\nDated: May 1, 2026\nACME LIMITED')).toBe('DRHP');
      expect(classifyOfferDocumentCover('RED HERRING PROSPECTUS\nDated: May 1, 2026\nACME LIMITED')).toBe('RHP');
    });
    it('types three more real final-prospectus covers (pdftotext page 1) as PROSPECTUS', () => {
      expect(classifyOfferDocumentCover(fixture('kwick-forensic-prospectus.cover.txt'))).toBe('PROSPECTUS');
      expect(classifyOfferDocumentCover(fixture('digilogic-prospectus.cover.txt'))).toBe('PROSPECTUS');
      expect(classifyOfferDocumentCover(fixture('modern-diagnostic-prospectus.cover.txt'))).toBe('PROSPECTUS');
    });
    it('types a real RHP cover as RHP (QR note says "view the RHP")', () => {
      expect(classifyOfferDocumentCover(fixture('dove-soft-rhp.cover.txt'))).toBe('RHP');
    });
    it('a final prospectus whose cover says "to be read with the Red Herring Prospectus dated" stays PROSPECTUS (own title decides)', () => {
      const real = fixture('adisoft-997.cover.txt');
      const withRef = real.replace(
        'Dated: April 28, 2026\n',
        'Dated: April 28, 2026\nThis Prospectus is to be read with the Red Herring Prospectus dated April 10, 2026\n'
      );
      expect(withRef).not.toBe(real);
      expect(classifyOfferDocumentCover(withRef)).toBe('PROSPECTUS');
    });
    it('a notice / annual report / addendum that merely mentions the RHP is never an offer document', () => {
      expect(classifyOfferDocumentCover('NOTICE\nACME LIMITED\nThe Red Herring Prospectus dated May 1, 2026 has been filed with the RoC')).toBeNull();
      expect(classifyOfferDocumentCover('ANNUAL REPORT 2025-26\nACME LIMITED\nRed Herring Prospectus\nDated: May 1, 2026')).toBeNull();
      expect(classifyOfferDocumentCover('CORRIGENDUM\nto the Red Herring Prospectus dated May 1, 2026')).toBeNull();
      expect(classifyOfferDocumentCover('ADVERTISEMENT\nACME LIMITED\nthe Red Herring Prospectus dated May 1, 2026')).toBeNull();
    });
    it('an addendum / abridged prospectus / advertisement cover is not an offer document', () => {
      expect(classifyOfferDocumentCover('ADDENDUM TO THE PROSPECTUS\nDated: May 1, 2026')).toBeNull();
      expect(classifyOfferDocumentCover('ABRIDGED PROSPECTUS\nACME LIMITED')).toBeNull();
    });
  });

  describe('resolveProspectusRowType (#1417): untyped file name is typed by the cover, never defaulted', () => {
    const row = (pdfUrl: string): ChittorgarhProspectusRow => ({
      companyName: 'X Ltd', slug: 'x', isin: null, bseScripCode: null, nseSymbol: null,
      exchange: 'NSE', issueType: null, openDate: null, pdfUrl, docType: null,
    });
    const pdf = Buffer.from('%PDF-1.7 fake');
    it('types the row from the cover text', async () => {
      const out = await resolveProspectusRowType(row('https://h.com/997.pdf'), {
        fetchPdf: async () => pdf,
        coverText: async () => ({ usable: true, text: fixture('adisoft-997.cover.txt'), alnum: 999 }),
      });
      expect(out).toEqual({ ok: true, docType: 'PROSPECTUS' });
    });
    it('a real HTML maintenance page behind a .pdf link is not a document (reason not_pdf)', async () => {
      const out = await resolveProspectusRowType(row('https://www.manilam.com//uploads/investors/42/42.pdf'), {
        fetchPdf: async () => readFileSync(FIXTURE_DIR + 'manilam-42.html'),
        coverText: async () => { throw new Error('must not read the cover of a non-PDF'); },
      });
      expect(out).toEqual({ ok: false, reason: 'not_pdf' });
    });
    it('an unreadable or title-less cover is unclassified, not PROSPECTUS', async () => {
      const noText = await resolveProspectusRowType(row('https://h.com/a.pdf'), {
        fetchPdf: async () => pdf,
        coverText: async () => ({ usable: false, reason: 'no_text_layer', detail: 'x' }),
      });
      expect(noText).toEqual({ ok: false, reason: 'cover_unreadable' });
      const noTitle = await resolveProspectusRowType(row('https://h.com/a.pdf'), {
        fetchPdf: async () => pdf,
        coverText: async () => ({ usable: true, text: fixture('fractal-sebi-viewer.cover.txt'), alnum: 999 }),
      });
      expect(noTitle).toEqual({ ok: false, reason: 'cover_names_no_offer_type' });
    });
    it('a download failure is reported, never typed', async () => {
      const out = await resolveProspectusRowType(row('https://h.com/a.pdf'), {
        fetchPdf: async () => null,
        coverText: async () => { throw new Error('unused'); },
      });
      expect(out).toEqual({ ok: false, reason: 'fetch_failed' });
    });
    it('a row already typed by its file name is returned as-is without any fetch', async () => {
      const out = await resolveProspectusRowType({ ...row('https://x.com/a_DRHP.pdf'), docType: 'DRHP' }, {
        fetchPdf: async () => { throw new Error('no fetch'); },
        coverText: async () => { throw new Error('no cover'); },
      });
      expect(out).toEqual({ ok: true, docType: 'DRHP' });
    });
  });
});
