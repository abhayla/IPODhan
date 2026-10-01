/**
 * Market Holidays Scraper
 *
 * Scrapes market holiday data from NSE and BSE official websites
 *
 * Sources (see docs/URLs-Tracker.md for current URLs):
 * - NSE: https://www.nseindia.com/api/holiday-master?type=trading (WORKING)
 * - BSE: No working URL found (deprecated, returns 404)
 *
 * Features:
 * - Scrapes both trading and settlement holidays
 * - Handles multiple years
 * - Deduplicates data from both exchanges
 * - Stores in database with proper conflict resolution
 */

import { BaseScraper, type ScraperResult } from '../base-scraper';
import { extractTable, parseDate, cleanText } from '../utils/parser';
import { db } from '@/lib/db';
import { marketHolidays } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

export interface MarketHoliday {
  date: Date;
  /** The IST calendar date as YYYY-MM-DD — what is stored. Never derived through toISOString (F-220). */
  dateIso: string;
  description: string;
  exchange: 'NSE' | 'BSE' | 'BOTH';
  type: 'TRADING' | 'SETTLEMENT';
  year: number;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * NSE's "15-Jan-2026" -> "2026-01-15" from its day/month/year components (F-220: the old code
 * sent an IST-midnight Date through toISOString and stored the day before). Same rule as
 * scripts/lib/nse-holiday-calendar.mjs parseNseTradingDate; a parity test over the real NSE
 * fixture keeps the two from drifting.
 */
export function nseTradingDateToIso(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const m = /^\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*$/.exec(text);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** A Date's calendar date in IST (Asia/Kolkata), YYYY-MM-DD — for the HTML fallbacks that parse to a Date. */
export function toIstCalendarDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export class MarketHolidaysScraper extends BaseScraper<MarketHoliday[]> {
  constructor() {
    super({
      name: 'MarketHolidaysScraper',
      baseUrl: 'https://www.nseindia.com',
      rateLimit: 1, // 1 request per second
      timeout: 30000,
      retries: 3,
    });
  }

  /**
   * Main scrape method
   */
  async scrape(year: number = new Date().getFullYear()): Promise<ScraperResult<MarketHoliday[]>> {
    try {
      this.logStart(`Scraping market holidays for year ${year}`);

      const nseHolidays = await this.scrapeNSE(year);
      const bseHolidays = await this.scrapeBSE(year);

      // Merge and deduplicate
      const allHolidays = this.mergeHolidays(nseHolidays, bseHolidays);

      // Store in database
      await this.storeHolidays(allHolidays);

      this.logComplete(allHolidays.length);
      return this.createSuccessResult(allHolidays);
    } catch (error) {
      this.logError(error as Error);
      return this.createErrorResult(error as Error);
    }
  }

  /**
   * Scrape NSE holidays
   */
  private async scrapeNSE(year: number): Promise<MarketHoliday[]> {
    try {
      // NSE provides holidays data
      // Note: This is a placeholder - actual implementation depends on NSE website structure
      // NSE might provide JSON API or HTML table

      const url = 'https://www.nseindia.com/api/holiday-master?type=trading';

      try {
        // Try JSON API first
        const data = await this.fetchJSON<any>(url, {
          headers: {
            'Accept': 'application/json',
          },
        });

        return this.parseNSEJSON(data, year);
      } catch (jsonError) {
        // Fallback to HTML scraping
        this.logStart('NSE JSON API failed, falling back to HTML scraping');
        return await this.scrapeNSEHTML(year);
      }
    } catch (error) {
      this.logError(`NSE scraping failed: ${error}`);
      return [];
    }
  }

  /**
   * Parse NSE JSON response
   */
  parseNSEJSON(data: any, year: number): MarketHoliday[] {
    const holidays: MarketHoliday[] = [];

    // CM = the capital-market (equity) segment; CBM is corporate bonds.
    if (!data || !Array.isArray(data.CM)) return holidays;

    for (const holiday of data.CM) {
      const dateIso = nseTradingDateToIso(holiday.tradingDate);
      if (!dateIso || Number(dateIso.slice(0, 4)) !== year) continue;
      const [y, m, d] = dateIso.split('-').map(Number);

      holidays.push({
        date: new Date(Date.UTC(y, m - 1, d)),
        dateIso,
        description: cleanText(holiday.description || 'Trading Holiday'),
        exchange: 'NSE',
        type: 'TRADING',
        year,
      });
    }

    return holidays;
  }

  /**
   * Scrape NSE from HTML (fallback)
   */
  private async scrapeNSEHTML(year: number): Promise<MarketHoliday[]> {
    const url = 'https://www.nseindia.com/regulations/trading-holidays';
    const $ = await this.fetchHTML(url);
    const holidays: MarketHoliday[] = [];

    // Look for holiday table
    const tables = extractTable($, 'table');

    for (const row of tables) {
      const date = parseDate(row['Date'] || row['Trading Date'] || '');
      if (!date || date.getFullYear() !== year) continue;

      const description = cleanText(
        row['Description'] || row['Holiday'] || row['Occasion'] || 'Trading Holiday'
      );

      holidays.push({
        date,
        dateIso: toIstCalendarDate(date),
        description,
        exchange: 'NSE',
        type: 'TRADING',
        year,
      });
    }

    return holidays;
  }

  /**
   * Scrape BSE holidays
   * NOTE: BSE URL is currently deprecated (404) - see docs/URLs-Tracker.md
   * This method will return empty array until a new BSE URL is found
   */
  private async scrapeBSE(year: number): Promise<MarketHoliday[]> {
    try {
      // DEPRECATED: This URL returns 404 as of 2025 - no replacement found
      // Alternative: Use NSE API only
      const url = 'https://www.bseindia.com/static/about/Market_Holidays.aspx';
      const $ = await this.fetchHTML(url);
      const holidays: MarketHoliday[] = [];

      // BSE typically has tables for each year
      const tables = extractTable($, 'table');

      for (const row of tables) {
        const date = parseDate(row['Date'] || row['Day & Date'] || '');
        if (!date || date.getFullYear() !== year) continue;

        const description = cleanText(
          row['Description'] || row['Holiday'] || row['Occasion'] || 'Trading Holiday'
        );

        // Check if it's a settlement holiday
        const isSettlement = description.toLowerCase().includes('settlement') ||
                            row['Type']?.toLowerCase().includes('settlement');

        holidays.push({
          date,
          dateIso: toIstCalendarDate(date),
          description,
          exchange: 'BSE',
          type: isSettlement ? 'SETTLEMENT' : 'TRADING',
          year,
        });
      }

      return holidays;
    } catch (error) {
      this.logError(`BSE scraping failed: ${error}`);
      return [];
    }
  }

  /**
   * Merge holidays from both exchanges and mark common holidays
   */
  private mergeHolidays(nseHolidays: MarketHoliday[], bseHolidays: MarketHoliday[]): MarketHoliday[] {
    const merged: MarketHoliday[] = [];
    const holidayMap = new Map<string, MarketHoliday>();

    // Add NSE holidays
    for (const holiday of nseHolidays) {
      const key = `${holiday.dateIso}-${holiday.type}`;
      holidayMap.set(key, holiday);
    }

    // Merge BSE holidays
    for (const holiday of bseHolidays) {
      const key = `${holiday.dateIso}-${holiday.type}`;
      const existing = holidayMap.get(key);

      if (existing) {
        // Holiday exists on both exchanges
        existing.exchange = 'BOTH';
        // Use more detailed description if BSE provides it
        if (holiday.description.length > existing.description.length) {
          existing.description = holiday.description;
        }
      } else {
        holidayMap.set(key, holiday);
      }
    }

    // Convert map to array
    return Array.from(holidayMap.values());
  }

  /**
   * Store holidays in database with upsert logic
   */
  private async storeHolidays(holidays: MarketHoliday[]): Promise<void> {
    for (const holiday of holidays) {
      try {
        // Check if holiday already exists
        const existing = await db.select()
          .from(marketHolidays)
          .where(
            and(
              eq(marketHolidays.date, holiday.dateIso),
              eq(marketHolidays.exchange, holiday.exchange)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          // Update existing
          await db.update(marketHolidays)
            .set({
              description: holiday.description,
              type: holiday.type,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(marketHolidays.date, holiday.dateIso),
                eq(marketHolidays.exchange, holiday.exchange)
              )
            );
        } else {
          // Insert new
          await db.insert(marketHolidays).values({
            date: holiday.dateIso,
            description: holiday.description,
            exchange: holiday.exchange,
            type: holiday.type,
            year: holiday.year,
          });
        }
      } catch (error) {
        this.logError(`Failed to store holiday: ${error}`);
        // Continue with next holiday
      }
    }
  }

  /**
   * Scrape multiple years at once
   */
  async scrapeMultipleYears(years: number[]): Promise<ScraperResult<MarketHoliday[]>> {
    const allHolidays: MarketHoliday[] = [];

    for (const year of years) {
      const result = await this.scrape(year);
      if (result.success && result.data) {
        allHolidays.push(...result.data);
      }
      // Rate limiting between years
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return this.createSuccessResult(allHolidays);
  }
}

// Export singleton instance
export const marketHolidaysScraper = new MarketHolidaysScraper();
