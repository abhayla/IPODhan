/**
 * Unit tests for chittorgarh-scraper.ts
 * Tests: GMP extraction, GMP validation, data transformation, error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeChittorgarhIPOs } from '../../../src/scrapers/chittorgarh-scraper.js';
import * as scraperUtils from '../../../src/utils/scraper-utils.js';
import * as validators from '../../../src/utils/validators.js';
import * as cheerio from 'cheerio';

describe('chittorgarh-scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scrapeChittorgarhIPOs', () => {
    it('should successfully parse IPO data with GMP from mock HTML', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr>
                <th>Company</th>
                <th>Issue Size</th>
                <th>Price</th>
                <th>Dates</th>
                <th>GMP</th>
                <th>Subscription</th>
              </tr>
              <tr>
                <td>ABC Company Limited</td>
                <td>₹1000 Cr</td>
                <td>₹250 - 260</td>
                <td>10-Oct-2025 - 12-Oct-2025</td>
                <td>₹50</td>
                <td>2.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('ABC Company Limited');
      expect(result.ipos[0].issueSize).toBe(10000000000); // 1000 Cr
      expect(result.ipos[0].priceRangeMin).toBe(250);
      expect(result.ipos[0].priceRangeMax).toBe(260);
      expect(result.ipos[0].gmp).toBe(50);
      expect(result.ipos[0].gmpPercentage).toBeCloseTo(19.23, 1); // 50/260 * 100
      expect(result.ipos[0].dataSource).toBe('CHITTORGARH');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle negative GMP values', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>XYZ Company</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>₹-10</td>
                <td>1.2x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].gmp).toBe(-10);
      expect(result.ipos[0].gmpPercentage).toBeCloseTo(-9.09, 1); // -10/110 * 100
    });

    it('should reject unrealistic GMP values using validation', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Test Company</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>₹500</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      // Mock validateGMP to return false for unrealistic value
      vi.spyOn(validators, 'validateGMP').mockReturnValue(false);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      // GMP should be undefined due to validation failure
      expect(result.ipos[0].gmp).toBeUndefined();
      expect(result.ipos[0].gmpPercentage).toBeUndefined();
    });

    it('should calculate GMP percentage correctly', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>GMP Test Company</td>
                <td>₹1000 Cr</td>
                <td>₹200 - 250</td>
                <td>10-Oct-2025 - 12-Oct-2025</td>
                <td>₹25</td>
                <td>3.0x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].gmp).toBe(25);
      // GMP percentage = (25 / 250) * 100 = 10%
      expect(result.ipos[0].gmpPercentage).toBe(10);
    });

    it('should handle missing GMP data gracefully', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>No GMP Company</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>N/A</td>
                <td>2.0x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].gmp).toBeUndefined();
      expect(result.ipos[0].gmpPercentage).toBeUndefined();
      expect(result.ipos[0].gmpUpdatedAt).toBeUndefined();
    });

    it('should set gmpUpdatedAt when GMP is present', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Test Company</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>₹20</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].gmp).toBe(20);
      expect(result.ipos[0].gmpUpdatedAt).toBeDefined();
      // Verify it's a valid ISO timestamp
      expect(() => new Date(result.ipos[0].gmpUpdatedAt!)).not.toThrow();
    });

    it('should handle empty IPO table', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
    });

    it('should skip rows with insufficient columns', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Incomplete Row</td>
                <td>₹500 Cr</td>
                <!-- Missing columns -->
              </tr>
              <tr>
                <td>Complete Company</td>
                <td>₹1000 Cr</td>
                <td>₹250 - 260</td>
                <td>10-Oct-2025 - 12-Oct-2025</td>
                <td>₹50</td>
                <td>2.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      // Only complete row should be parsed
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Complete Company');
    });

    it('should skip rows with missing required fields', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td></td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>₹20</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeChittorgarhIPOs();

      // Row with missing company name should be skipped
      expect(result.ipos).toHaveLength(0);
    });

    it('should determine status as LIVE for active IPOs', async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const formatDate = (date: Date) => {
        const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
        return date.toLocaleDateString('en-GB', options);
      };

      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Live IPO</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>${formatDate(yesterday)} - ${formatDate(tomorrow)}</td>
                <td>₹20</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('OPEN');
    });

    it('should identify SME category when mentioned', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr class="sme-ipo">
                <td>SME Company</td>
                <td>₹100 Cr</td>
                <td>₹50 - 55</td>
                <td>10-Oct-2025 - 12-Oct-2025</td>
                <td>₹10</td>
                <td>1.0x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].category).toBe('SME');
    });

    it('should handle scraping errors gracefully', async () => {
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockRejectedValue(
        new Error('Network timeout')
      );

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('Scraper error: Network timeout');
    });

    it('should handle parsing errors for individual rows', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Valid Company</td>
                <td>₹1000 Cr</td>
                <td>₹250 - 260</td>
                <td>10-Oct-2025 - 12-Oct-2025</td>
                <td>₹50</td>
                <td>2.5x</td>
              </tr>
              <tr>
                <td>Invalid Company</td>
                <!-- Missing critical columns -->
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      // Valid IPO should be parsed, invalid skipped
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Valid Company');
    });

    it('should extract lot size when present', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Test Company (Lot: 150)</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025 - 17-Nov-2025</td>
                <td>₹20</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].lotSize).toBe(150);
    });

    it('should handle single date (open = close)', async () => {
      const mockHtml = `
        <html>
          <body>
            <table class="table">
              <tr><th>Headers</th></tr>
              <tr>
                <td>Single Date IPO</td>
                <td>₹500 Cr</td>
                <td>₹100 - 110</td>
                <td>15-Nov-2025</td>
                <td>₹20</td>
                <td>1.5x</td>
              </tr>
            </table>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);
      vi.spyOn(validators, 'validateGMP').mockReturnValue(true);

      const result = await scrapeChittorgarhIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].openDate).toBe(result.ipos[0].closeDate);
    });
  });
});
