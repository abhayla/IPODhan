/**
 * Unit tests for chittorgarh-scraper.ts
 *
 * The scraper was rewritten 2025-10-17 from HTML/Cheerio table parsing to
 * API-based data fetching (see the header comment in
 * src/scrapers/chittorgarh-scraper.ts). These tests mock
 * `retryWithExponentialBackoff` to resolve a `ChittorgarhAPIResponse`-shaped
 * object (the JSON the Chittorgarh report API actually returns), not a
 * Cheerio `$` — the old HTML-table mocks in this file were stale and, since
 * `scrapeChittorgarhIPOs` never touched `apiData.reportTableData` on a
 * Cheerio object, most of them were accidentally "passing" on an empty
 * result rather than exercising the real parsing path.
 *
 * GMP extraction (gmp/gmpPercentage/gmpUpdatedAt/validateGMP) is NOT tested
 * here anymore: the API rewrite intentionally dropped it from this scraper
 * ("GMP data NOT available on list page" - source header comment), the IPO
 * object hardcodes gmp/gmpPercentage/gmpUpdatedAt to undefined, and
 * validateGMP is no longer called from this file at all (GMP is sourced
 * exclusively from investorgain-gmp-orchestrator now). The one remaining
 * GMP test below asserts the fields stay undefined, matching current code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeChittorgarhIPOs } from '../../../src/scrapers/chittorgarh-scraper.js';
import * as scraperUtils from '../../../src/utils/scraper-utils.js';

/** Build one Chittorgarh API record with sane defaults, override as needed. */
function apiRecord(overrides: Record<string, string> = {}) {
  return {
    'Company': '<a href="/ipo/abc-company/1/">ABC Company Limited</a>',
    'Opening Date': 'Tue, Oct 07, 2025',
    'Closing Date': 'Thu, Oct 09, 2025',
    'Listing Date': '',
    'Issue Price (Rs.)': '250.00 to 260.00',
    'Total Issue Amount (Incl.Firm reservations) (Rs.cr.)': '1000.00',
    'Listing at': 'BSE, NSE',
    'Lead Manager': '<a href="/lead-manager/xyz-capital/">XYZ Capital</a>',
    '~Issue_Open_Date': '2025-10-07T00:00:00.000Z',
    '~IssueCloseDate': '2025-10-09T00:00:00.000Z',
    '~ListingDate': '',
    ...overrides,
  };
}

function mockApiResponse(reportTableData: unknown[]) {
  vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue({
    msg: 1,
    sSearchWhere: '',
    reportTableData,
  });
}

describe('chittorgarh-scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scrapeChittorgarhIPOs', () => {
    it('should successfully parse IPO data from a mock API response', async () => {
      mockApiResponse([apiRecord()]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('ABC Company Limited');
      expect(result.ipos[0].issueSize).toBe(10000000000); // 1000 Cr
      expect(result.ipos[0].priceRangeMin).toBe(250);
      expect(result.ipos[0].priceRangeMax).toBe(260);
      expect(result.ipos[0].openDate).toBe('2025-10-07');
      expect(result.ipos[0].closeDate).toBe('2025-10-09');
      expect(result.ipos[0].listingExchange).toBe('BOTH');
      expect(result.ipos[0].segment).toBe('MAINBOARD');
      expect(result.ipos[0].offeringType).toBe('IPO');
      expect(result.ipos[0].leadManagers).toEqual(['XYZ Capital']);
      expect(result.ipos[0].dataSource).toBe('CHITTORGARH');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle missing GMP data gracefully (GMP is not sourced from Chittorgarh anymore)', async () => {
      mockApiResponse([apiRecord()]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].gmp).toBeUndefined();
      expect(result.ipos[0].gmpPercentage).toBeUndefined();
      expect(result.ipos[0].gmpUpdatedAt).toBeUndefined();
    });

    it('should handle an empty report table', async () => {
      mockApiResponse([]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('No IPO data found');
    });

    it('should surface an API-level error without throwing', async () => {
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue({
        msg: 0,
        sSearchWhere: '',
        reportTableData: undefined as any,
        error: 'Invalid report parameters',
      } as any);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('Chittorgarh API error: Invalid report parameters');
    });

    it('should skip a record with a missing company name', async () => {
      mockApiResponse([
        apiRecord({ 'Company': '' }),
        apiRecord({ 'Company': '<a href="/ipo/complete-company/2/">Complete Company</a>' }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      // Only the record with a company name should be parsed
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Complete Company');
    });

    it('should skip a record with a missing open date', async () => {
      mockApiResponse([
        apiRecord({ 'Opening Date': '', '~Issue_Open_Date': '' }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
    });

    it('should determine status as OPEN for a currently-trading IPO', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const iso = (d: Date) => d.toISOString();

      mockApiResponse([
        apiRecord({
          'Company': '<a href="/ipo/live-ipo/3/">Live IPO</a>',
          '~Issue_Open_Date': iso(yesterday),
          '~IssueCloseDate': iso(tomorrow),
        }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('OPEN');
    });

    // W-116b (review round 1): determineStatus() used to require BOTH
    // openDate and closeDate before checking listingDate at all, so a row
    // with a past listing date but an empty close-date column (Chittorgarh's
    // own column, not fabricated per W-116b) read UPCOMING instead of
    // LISTED. The listing check now runs first.
    it('should determine status as LISTED when closeDate is missing but listingDate is in the past', async () => {
      const pastListing = new Date();
      pastListing.setDate(pastListing.getDate() - 30);

      mockApiResponse([
        apiRecord({
          'Company': '<a href="/ipo/listed-no-close/4/">Listed No Close IPO</a>',
          'Closing Date': '',
          '~IssueCloseDate': '',
          'Listing Date': 'past',
          '~ListingDate': pastListing.toISOString(),
        }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].closeDate).toBeUndefined();
      expect(result.ipos[0].status).toBe('LISTED');
    });

    it('should identify SME segment when "Listing at" mentions SME', async () => {
      mockApiResponse([
        apiRecord({
          'Company': '<a href="/ipo/sme-company/4/">SME Company</a>',
          'Listing at': 'NSE SME',
        }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].segment).toBe('SME');
      expect(result.ipos[0].listingExchange).toBe('NSE');
    });

    it('should detect a business trust (InvIT) and null out the segment (T-287F2)', async () => {
      mockApiResponse([
        apiRecord({
          'Company': '<a href="/ipo/example-invit/5/">Example InvIT</a>',
        }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].segment).toBeNull();
      expect(result.ipos[0].offeringType).toBe('INVITS');
    });

    it('should handle scraping errors gracefully', async () => {
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('Scraper error: Network timeout');
    });

    it('should skip a record that throws while parsing but keep the others', async () => {
      mockApiResponse([
        apiRecord({ 'Company': '<a href="/ipo/valid-company/6/">Valid Company</a>' }),
        // A truthy-but-non-string Company value passes extractTextFromAnchor()'s
        // `if (!html) return ''` guard but then throws on `html.replace` (not a
        // function on a number) - exercising the per-record try/catch in
        // scrapeChittorgarhIPOs, unlike an empty/falsy Company which is just
        // silently skipped (see the "missing company name" test above).
        apiRecord({ 'Company': 12345 as any }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Valid Company');
      expect(result.errors.length).toBeGreaterThan(0);
    });

    // W-116b: this used to default closeDate to openDate + 3 days and emit
    // the guess as if it were scraped (same class as W-116's Moneycontrol
    // fabricated open/close dates). A source must never emit a value it did
    // not read - omit closeDate instead so a higher-priority source
    // (DRHP/NSE/BSE) can fill it via field-priority-matrix.
    it('never fabricates a close date from open date + 3 days when Closing Date is missing', async () => {
      mockApiResponse([
        apiRecord({
          'Company': '<a href="/ipo/single-date-ipo/7/">Single Date IPO</a>',
          'Closing Date': '',
          '~IssueCloseDate': '',
        }),
      ]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].openDate).toBe('2025-10-07');
      expect(result.ipos[0].closeDate).toBeUndefined();
    });

    it('keeps a genuine close date when the source actually provides one', async () => {
      mockApiResponse([apiRecord()]);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].openDate).toBeTruthy();
      expect(result.ipos[0].closeDate).toBe('2025-10-09');
    });
  });
});
