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
  type ChittorgarhProspectusRow,
} from '../../../src/scrapers/chittorgarh-document-scraper.js';

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
});
