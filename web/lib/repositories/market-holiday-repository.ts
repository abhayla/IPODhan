/**
 * Market Holiday Repository
 *
 * Handles database operations for Market Holiday entities with Redis caching.
 * Story 5.4: Market Holidays Calendar
 */

import { eq, and, gte, lte, or, asc } from 'drizzle-orm';
import { BaseRepository } from './base-repository';
import { marketHolidays } from '../db';
import type { MarketHoliday, Exchange } from '../db/types';

export interface HolidayFilters {
  year?: number;
  exchange?: 'ALL' | 'NSE' | 'BSE';
  upcoming?: boolean;
}

export class MarketHolidayRepository extends BaseRepository {
  private readonly CACHE_TTL = 2592000; // 30 days in seconds (as per Story 5.4 requirements)

  /**
   * Find all holidays with optional filters
   * Uses Redis cache with 30-day TTL
   *
   * @param filters - Optional filters for year, exchange, and upcoming
   * @returns Array of market holidays sorted by date
   */
  async findAll(filters?: HolidayFilters): Promise<MarketHoliday[]> {
    const cacheKey = this.generateCacheKey(filters);

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findAllMarketHolidays',
          async () => {
            let query = this.db.select().from(marketHolidays);

            // Apply filters
            if (filters?.year) {
              query = query.where(eq(marketHolidays.year, filters.year)) as typeof query;
            }

            if (filters?.exchange && filters.exchange !== 'ALL') {
              // Filter by specific exchange or BOTH
              const exchangeFilter = or(
                eq(marketHolidays.exchange, filters.exchange as Exchange),
                eq(marketHolidays.exchange, 'BOTH')
              );
              query = query.where(exchangeFilter) as typeof query;
            }

            if (filters?.upcoming) {
              // Get current date in YYYY-MM-DD format
              const today = new Date().toISOString().split('T')[0];
              query = query.where(gte(marketHolidays.date, today)) as typeof query;
            }

            // Sort by date ascending (chronological order)
            const results = await query.orderBy(asc(marketHolidays.date));
            return results;
          },
          { filters }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find upcoming holidays
   *
   * @param limit - Maximum number of holidays to return (default: 5)
   * @returns Array of upcoming market holidays
   */
  async findUpcoming(limit: number = 5): Promise<MarketHoliday[]> {
    const cacheKey = `market_holidays:upcoming:${limit}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findUpcomingMarketHolidays',
          async () => {
            const today = new Date().toISOString().split('T')[0];

            const results = await this.db
              .select()
              .from(marketHolidays)
              .where(gte(marketHolidays.date, today))
              .orderBy(asc(marketHolidays.date))
              .limit(limit);

            return results;
          },
          { limit }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find holidays by year
   *
   * @param year - Year to filter holidays (e.g., 2024, 2025, 2026)
   * @returns Array of market holidays for the specified year
   */
  async findByYear(year: number): Promise<MarketHoliday[]> {
    const cacheKey = `market_holidays:year:${year}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findMarketHolidaysByYear',
          async () => {
            const results = await this.db
              .select()
              .from(marketHolidays)
              .where(eq(marketHolidays.year, year))
              .orderBy(asc(marketHolidays.date));

            return results;
          },
          { year }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find holidays by exchange
   *
   * @param exchange - Exchange to filter (NSE, BSE, or BOTH)
   * @returns Array of market holidays for the specified exchange
   */
  async findByExchange(exchange: Exchange): Promise<MarketHoliday[]> {
    const cacheKey = `market_holidays:exchange:${exchange}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findMarketHolidaysByExchange',
          async () => {
            // If exchange is BOTH, return holidays for that exchange
            // Otherwise, return holidays for the specific exchange OR BOTH
            const exchangeFilter =
              exchange === 'BOTH'
                ? eq(marketHolidays.exchange, 'BOTH')
                : or(
                    eq(marketHolidays.exchange, exchange),
                    eq(marketHolidays.exchange, 'BOTH')
                  );

            const results = await this.db
              .select()
              .from(marketHolidays)
              .where(exchangeFilter)
              .orderBy(asc(marketHolidays.date));

            return results;
          },
          { exchange }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Find holidays within a date range
   *
   * @param startDate - Start date (YYYY-MM-DD)
   * @param endDate - End date (YYYY-MM-DD)
   * @returns Array of market holidays within the date range
   */
  async findByDateRange(startDate: string, endDate: string): Promise<MarketHoliday[]> {
    const cacheKey = `market_holidays:range:${startDate}:${endDate}`;

    return this.getFromCache(
      cacheKey,
      async () => {
        return this.executeQuery(
          'findMarketHolidaysByDateRange',
          async () => {
            const results = await this.db
              .select()
              .from(marketHolidays)
              .where(
                and(
                  gte(marketHolidays.date, startDate),
                  lte(marketHolidays.date, endDate)
                )
              )
              .orderBy(asc(marketHolidays.date));

            return results;
          },
          { startDate, endDate }
        );
      },
      this.CACHE_TTL
    );
  }

  /**
   * Invalidate all market holiday caches
   * Called when holiday data is updated (admin operations)
   */
  async invalidateHolidayCache(): Promise<void> {
    const patterns: string[] = ['market_holidays:*'];
    await this.invalidateCache([], patterns);
  }

  /**
   * Generate cache key based on filters
   */
  private generateCacheKey(filters?: HolidayFilters): string {
    if (!filters) {
      return 'market_holidays:all';
    }

    const parts = ['market_holidays'];

    if (filters.year) {
      parts.push(`year:${filters.year}`);
    }

    if (filters.exchange && filters.exchange !== 'ALL') {
      parts.push(`exchange:${filters.exchange}`);
    }

    if (filters.upcoming) {
      parts.push('upcoming');
    }

    return parts.join(':');
  }
}
