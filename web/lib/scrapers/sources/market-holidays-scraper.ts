/**
 * Market Holidays Scraper
 *
 * Scrapes market holiday data from NSE and BSE official websites
 *
 * Sources:
 * - NSE: https://www.nseindia.com/regulations/trading-holidays
 * - BSE: https://www.bseindia.com/static/about/Market_Holidays.aspx
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
import { marketHolidays } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export interface MarketHoliday {
  date: Date;
  description: string;
  exchange: 'NSE' | 'BSE' | 'BOTH';
  type: 'TRADING' | 'SETTLEMENT';
  year: number;
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
  private parseNSEJSON(data: any, year: number): MarketHoliday[] {
    const holidays: MarketHoliday[] = [];

    if (!data || !data.CBM) return holidays;

    for (const holiday of data.CBM) {
      const date = parseDate(holiday.tradingDate);
      if (!date || date.getFullYear() !== year) continue;

      holidays.push({
        date,
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
   */
  private async scrapeBSE(year: number): Promise<MarketHoliday[]> {
    try {
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
      const key = `${holiday.date.toISOString().split('T')[0]}-${holiday.type}`;
      holidayMap.set(key, holiday);
    }

    // Merge BSE holidays
    for (const holiday of bseHolidays) {
      const key = `${holiday.date.toISOString().split('T')[0]}-${holiday.type}`;
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
              eq(marketHolidays.date, holiday.date.toISOString().split('T')[0]),
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
                eq(marketHolidays.date, holiday.date.toISOString().split('T')[0]),
                eq(marketHolidays.exchange, holiday.exchange)
              )
            );
        } else {
          // Insert new
          await db.insert(marketHolidays).values({
            date: holiday.date.toISOString().split('T')[0],
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
