/**
 * Unit tests for Chittorgarh listing-performance scraper (B1).
 *
 * Source: Chittorgarh report 25 (ipo-listing-date-check-status-price-bse-nse) — provides the REAL
 * day-1 "Close Price on Listing", listing gain%, current BSE/NSE price, current gain%, plus
 * ISIN / scrip code / symbol. Fixture is a verbatim row captured live 2026-06-17.
 */
import { describe, it, expect } from 'vitest';
import {
  parseGainSpan,
  parseListingReportRows,
  type ChittorgarhListingRow,
} from '../../../src/scrapers/chittorgarh-listing-scraper.js';

const REAL_ROW = {
  '~id': 2289,
  Company: 'Gujarat Kidney & Super Speciality Ltd.',
  'Issue Category': 'Mainboard',
  'Listing Date': '30-Dec-2025',
  ISIN: 'INE0V0W01025',
  'BSE Scrip Code': 544666,
  'NSE Symbol': 'GKSL',
  '~urlrewrite_folder_name': 'gujarat-kidney-and-super-speciality-ipo',
  'Issue Price (Rs.)': '114.00',
  'Close Price on Listing (Rs.)': 104.54,
  '% Gain/Loss (Issue price v/s close price on Listing)':
    '<span class="text-danger d-block text-end">-8.3</span>',
  'Current Price <br>at BSE (Rs.)': 110.2,
  'Current Price <br>at NSE (Rs.)': 110.5,
  'Gain / Loss (%)': '<span class="text-danger d-block text-end">-3.2</span>',
  '~isin': 'INE0V0W01025',
  '~bse_script_code': 544666,
  '~nse_symbol': 'GKSL',
};

describe('chittorgarh-listing-scraper', () => {
  describe('parseGainSpan', () => {
    it('extracts a signed number from a styled span', () => {
      expect(parseGainSpan('<span class="text-danger d-block text-end">-8.3</span>')).toBe(-8.3);
      expect(parseGainSpan('<span class="text-success">5.54</span>')).toBe(5.54);
    });
    it('handles a bare number and rejects junk', () => {
      expect(parseGainSpan('12.5')).toBe(12.5);
      expect(parseGainSpan('')).toBeNull();
      expect(parseGainSpan('NA')).toBeNull();
      expect(parseGainSpan(null)).toBeNull();
    });
  });

  describe('parseListingReportRows', () => {
    it('parses a real row into a typed listing row with day-1 + current prices', () => {
      const rows = parseListingReportRows([REAL_ROW]);
      expect(rows).toHaveLength(1);
      const r = rows[0] as ChittorgarhListingRow;
      expect(r.companyName).toBe('Gujarat Kidney & Super Speciality Ltd.');
      expect(r.isin).toBe('INE0V0W01025');
      expect(r.bseScripCode).toBe('544666');
      expect(r.nseSymbol).toBe('GKSL');
      expect(r.issuePrice).toBe(114);
      expect(r.listingClose).toBe(104.54); // REAL day-1 close — satisfies NOT-NULL listing_price
      expect(r.listingGainPct).toBe(-8.3);
      expect(r.currentBse).toBe(110.2);
      expect(r.currentGainPct).toBe(-3.2);
    });
    it('skips a row with no day-1 listing close (honest — listing_perf requires it)', () => {
      const rows = parseListingReportRows([{ ...REAL_ROW, 'Close Price on Listing (Rs.)': '' }]);
      expect(rows).toHaveLength(0);
    });
    it('handles empty/garbage input', () => {
      expect(parseListingReportRows([])).toEqual([]);
      expect(parseListingReportRows(null as unknown as any[])).toEqual([]);
    });
  });
});
