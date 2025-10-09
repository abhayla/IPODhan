/**
 * Unit tests for moneycontrol-scraper.ts
 * Tests: HTML parsing with Cheerio, data extraction, retry logic, error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeMoneycontrolIPOs } from '../../../src/scrapers/moneycontrol-scraper.js';
import * as scraperUtils from '../../../src/utils/scraper-utils.js';
import * as cheerio from 'cheerio';

describe('moneycontrol-scraper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scrapeMoneycontrolIPOs', () => {
    it('should successfully parse IPO data from mock HTML', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table class="bl_12">
                <tbody>
                  <tr>
                    <td><a href="/company/abc">ABC Company Limited</a></td>
                  </tr>
                  <tr>
                    <td>Issue Size</td><td>₹1000 Cr</td>
                  </tr>
                  <tr>
                    <td>Price Range</td><td>250 - 260</td>
                  </tr>
                  <tr>
                    <td>Open</td><td>10-Oct-2025 - 12-Oct-2025</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);

      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('ABC Company Limited');
      expect(result.ipos[0].issueSize).toBe(10000000000); // 1000 Cr
      expect(result.ipos[0].priceRangeMin).toBe(250);
      expect(result.ipos[0].priceRangeMax).toBe(260);
      expect(result.ipos[0].dataSource).toBe('MONEYCONTROL');
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty IPO list', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <!-- No rows with bl_12 class -->
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('No IPO data found');
    });

    it('should extract rating when present', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/xyz">XYZ Company</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹500 Cr</td>
                  <td>Price Range</td>
                  <td>100 - 110</td>
                  <td>Open</td>
                  <td>15-Nov-2025 - 17-Nov-2025</td>
                  <td class="star-rating">4.5</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].rating).toBe(4.5);
    });

    it('should extract listing gains when present', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/xyz">XYZ Company</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹500 Cr</td>
                  <td>Price Range</td>
                  <td>100 - 110</td>
                  <td>Open</td>
                  <td>15-Nov-2025 - 17-Nov-2025</td>
                  <td>Listing Gains</td>
                  <td>+15.5%</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].listingGains).toBe(15.5);
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
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/live">Live IPO Company</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹1000 Cr</td>
                  <td>Price Range</td>
                  <td>250 - 260</td>
                  <td>Open</td>
                  <td>${formatDate(yesterday)} - ${formatDate(tomorrow)}</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('LIVE');
    });

    it('should determine status as UPCOMING for future IPOs', async () => {
      const future1 = new Date();
      future1.setDate(future1.getDate() + 10);
      const future2 = new Date();
      future2.setDate(future2.getDate() + 12);

      const formatDate = (date: Date) => {
        const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
        return date.toLocaleDateString('en-GB', options);
      };

      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/upcoming">Upcoming IPO</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹500 Cr</td>
                  <td>Price Range</td>
                  <td>100 - 110</td>
                  <td>Open</td>
                  <td>${formatDate(future1)} - ${formatDate(future2)}</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].status).toBe('UPCOMING');
    });

    it('should skip rows with missing required fields', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/incomplete">Incomplete IPO</a>
                  </td>
                  <td>Price Range</td>
                  <td>100 - 110</td>
                  <!-- Missing Issue Size and Dates -->
                </tr>
                <tr class="bl_12">
                  <td>
                    <a href="/company/complete">Complete IPO</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹1000 Cr</td>
                  <td>Price Range</td>
                  <td>250 - 260</td>
                  <td>Open</td>
                  <td>10-Oct-2025 - 12-Oct-2025</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      // Only complete IPO should be included
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Complete IPO');
    });

    it('should identify SME category when mentioned', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/sme">SME Company</a>
                    <span>SME</span>
                  </td>
                  <td>Issue Size</td>
                  <td>₹100 Cr</td>
                  <td>Price Range</td>
                  <td>50 - 55</td>
                  <td>Open</td>
                  <td>10-Oct-2025 - 12-Oct-2025</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].category).toBe('SME');
    });

    it('should handle scraping errors gracefully', async () => {
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockRejectedValue(
        new Error('Network error')
      );

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(0);
      expect(result.errors).toContain('Scraper error: Network error');
    });

    it('should handle parsing errors for individual rows', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/valid">Valid Company</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹1000 Cr</td>
                  <td>Price Range</td>
                  <td>250 - 260</td>
                  <td>Open</td>
                  <td>10-Oct-2025 - 12-Oct-2025</td>
                </tr>
                <tr class="bl_12">
                  <!-- Invalid row structure that will cause parsing error -->
                  <td><a>Invalid</a></td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      // Valid IPO should be parsed, invalid skipped
      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].companyName).toBe('Valid Company');
    });

    it('should validate rating within 0-5 range', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/test">Test Company</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹500 Cr</td>
                  <td>Price Range</td>
                  <td>100 - 110</td>
                  <td>Open</td>
                  <td>15-Nov-2025 - 17-Nov-2025</td>
                  <td class="star-rating">10.5</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      // Invalid rating (>5) should be undefined
      expect(result.ipos[0].rating).toBeUndefined();
    });

    it('should handle price range with single value', async () => {
      const mockHtml = `
        <html>
          <body>
            <div class="pcorporate">
              <table>
                <tr class="bl_12">
                  <td>
                    <a href="/company/fixed">Fixed Price IPO</a>
                  </td>
                  <td>Issue Size</td>
                  <td>₹1000 Cr</td>
                  <td>Price Range</td>
                  <td>250</td>
                  <td>Open</td>
                  <td>10-Oct-2025 - 12-Oct-2025</td>
                </tr>
              </table>
            </div>
          </body>
        </html>
      `;

      const $ = cheerio.load(mockHtml);
      vi.spyOn(scraperUtils, 'retryWithExponentialBackoff').mockResolvedValue($);

      const result = await scrapeMoneycontrolIPOs();

      expect(result.ipos).toHaveLength(1);
      expect(result.ipos[0].priceRangeMin).toBe(0); // No valid range parsed
      expect(result.ipos[0].priceRangeMax).toBe(0);
    });
  });
});
